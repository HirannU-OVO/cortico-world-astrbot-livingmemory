/**
 * index.ts - LivingMemory 桌宠极速直连扩展主入口
 * 支持从 Bridge /api/tools/manifest 动态生成全部 mem_* 工具 (B-01 ~ B-05)
 */

import type { EventEnvelope, ToolDef, World, WorldHost, WorldLamp, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import type { WorldContext, WorldDefinition } from 'cortico/world.ts';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  buildStatusConfigGroup,
  LIVINGMEMORY_CONFIG_GROUPS,
  LIVINGMEMORY_DEFAULTS,
  type LivingMemoryConfig,
} from './config.ts';
import {
  LivingMemoryClient,
  type ChatTurn,
  type LivingMemoryHealth,
  type ManifestToolDef,
  type ManifestResponse,
} from './client.ts';
import { eventToTurn } from './capture.ts';
import { EXTENSION_VERSION } from './version.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

/** 用户正文事件类型：只有这些进检索 query。 */
const USER_MESSAGE_TYPES = new Set([
  'astrbot.message',
  'qq.message',
  'desktop-pet.message',
  'desktop-pet.speech',
]);

/**
 * 近期已投过的记忆正文（LRU）。
 * 容量必须不小于单轮条数，否则同一轮注入的条目会把自己挤出窗口，去重当场失效。
 */
class RecentRecallWindow {
  private capacity: number;
  private readonly order: string[] = [];
  private readonly seen = new Set<string>();

  /**
   * @param capacity 窗口容量
   * @param floor    容量下限：必须不小于该批次单轮条数，
   *                 否则同一轮注入的条目会把自己挤出窗口，去重当场失效
   */
  constructor({ capacity = 15, floor = 3 }: { capacity?: number; floor?: number } = {}) {
    this.capacity = Math.max(capacity, floor, 1);
  }

  has(key: string): boolean {
    return this.seen.has(key);
  }

  add(key: string): void {
    if (!key || this.seen.has(key)) return;
    this.seen.add(key);
    this.order.push(key);
    while (this.order.length > this.capacity) {
      const removed = this.order.shift();
      if (removed) this.seen.delete(removed);
    }
  }

  get size(): number {
    return this.order.length;
  }

  keys(): string[] {
    return [...this.order];
  }

  /** 清空窗口；上下文重建后旧注入已消失，重新开账。 */
  clear(): void {
    this.order.length = 0;
    this.seen.clear();
  }

  /** 调整容量并裁剪多余条目；面板热更新用。 */
  setCapacity(next: number): void {
    const target = Math.max(1, Math.floor(next));
    while (this.order.length > target) {
      const removed = this.order.shift();
      if (removed) this.seen.delete(removed);
    }
    this.capacity = target;
  }

  get currentCapacity(): number {
    return this.capacity;
  }
}

/** 记忆发生时间标签；超过一周加「以前·」前缀，让模型自己判断新旧。 */
function formatDateTag(raw: unknown): string {
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  const ms = value > 1e11 ? value : value * 1000;
  const when = new Date(ms);
  if (Number.isNaN(when.getTime())) return '';
  const dayLabel = `${when.getMonth() + 1}月${when.getDate()}日`;
  const ageDays = (Date.now() - ms) / 86400000;
  return ageDays > 7 ? `以前·${dayLabel}` : dayLabel;
}

/** 从事件批里挑出用户正文，过滤 internal、自身 recall 与系统通知。 */
function pickUserTexts(events: unknown[]): string[] {
  const texts: string[] = [];
  for (const raw of events) {
    const e = raw as {
      type?: string;
      origin?: string;
      text?: string;
      meta?: Record<string, unknown>;
    };
    if (!e || e.origin === 'internal') continue;
    if (!e.type || !USER_MESSAGE_TYPES.has(e.type)) continue;
    const body =
      String((e.meta as any)?.body || (e.meta as any)?.text || e.text || '').trim();
    // AstrBot/QQ 事件正文尾部会带「回这条用 xxx」的提示，不是用户原话
    const cleaned = body
      .replace(/\n?（回这条用[^\n]*$/u, '')
      .replace(/\n?\(回这条用[^\n]*$/u, '')
      .trim();
    if (cleaned.length >= 2) texts.push(cleaned);
  }
  return texts;
}

export class LivingMemoryWorld implements World {
  readonly id = 'livingmemory';
  private host: WorldHost | null = null;
  private client: LivingMemoryClient;
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  /** 独立的召回轮询：与自动收集解耦（AC-12） */
  private recallTimer: ReturnType<typeof setInterval> | null = null;
  /** 召回轮询自己的游标 */
  private lastRecallTickCursor = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastCursor = 0;
  /** 连续推送失败次数：超过阈值才跳过这一批，避免桥长时间不可用时永久卡住。 */
  private pushFailStreak = 0;
  /**
   * 已投过的记忆正文（LRU 8）。
   * 容量保持较小，使旧条目能周期性滑出、后续轮次仍可命中；
   * floor 只做「不小于单轮条数」的保护，不按开场批条数撑大窗口。
   */
  private readonly liveRecall = new RecentRecallWindow({ capacity: 8, floor: 5 });
  /** 预热阶段算好的开场召回文本；第一批直接带上，不再现检索 */
  private warmRecallText = '';
  /** 实时召回已消费到的事件水位 */
  private lastHandledCursor = 0;
  /** 是否已恢复过投递状态 */
  private recallHydrated = false;
  /** 已认到的事件水位；重启后只补扫这之后的部分 */
  private recallCursor = 0;
  /** 本次会话的开场批次是否已投过 */
  private sessionSeedDone = false;
  /** 投递状态落盘位置：跨重启复用，避免每次冷启动全表扫事件流 */
  private readonly recallStatePath = join(homedir(), '.coopanion', 'livingmemory-recall.json');
  private readonly cfg: LivingMemoryConfig;
  private readonly ctx: WorldContext<LivingMemoryConfig>;

  /** 运行态健康与能力缓存：供 webUi 同步渲染面板，不阻塞页面加载 */
  private lastHealth: LivingMemoryHealth | null = null;
  private lastError: string | null = null;
  private probeCount = 0;
  private isProbing = false;

  /** 动态工具集合与清单状态 (B-01 ~ B-05) */
  private activeTools: ToolDef[] = [];
  private manifestRevision = '';
  private manifestCatalog: ManifestToolDef[] = [];
  private syncManifestPromise: Promise<void> | null = null;

  constructor(ctx: WorldContext<LivingMemoryConfig>) {
    this.ctx = ctx;
    this.cfg = { ...LIVINGMEMORY_DEFAULTS, ...(ctx.cfg || {}) };
    this.client = new LivingMemoryClient(this.cfg);

    // 默认工具初始化兜底
    this.activeTools = this.fallbackTools();

    // 实例初始化时立即启动首次异步探测，预热健康缓存
    void this.probeHealth();
  }

  /**
   * 异步探测桥接服务状态并更新缓存
   */
  async probeHealth(): Promise<LivingMemoryHealth | null> {
    if (this.isProbing) return this.lastHealth;
    this.isProbing = true;
    try {
      const health = await this.client.health();
      this.lastHealth = health;
      this.lastError = null;
      this.probeCount++;
      return health;
    } catch (err: any) {
      this.lastHealth = null;
      this.lastError = err?.message || String(err);
      this.probeCount++;
      return null;
    } finally {
      this.isProbing = false;
    }
  }

  /**
   * 从 Bridge /api/tools/manifest 同步动态工具面 (B-01 ~ B-05)
   */
  async syncManifestTools(): Promise<void> {
    if (this.syncManifestPromise) {
      return this.syncManifestPromise;
    }

    this.syncManifestPromise = (async () => {
      try {
        const manifest: ManifestResponse = await this.client.getManifest();
        if (!manifest || !manifest.ok) {
          return;
        }

        // 校验 schema 契约版本 (LM-E2E-17 / B-01)
        if (manifest.schema_version !== 'coopanion.memory-bridge.v1') {
          this.lastError = `schema_mismatch: 桥端协议版本 (${manifest.schema_version}) 与桌宠不匹配`;
          this.host?.log?.warn?.(`[LivingMemory] ${this.lastError}`);
          this.activeTools = this.fallbackTools();
          return;
        }

        // 若 revision 产生变化则重建动态工具表 (B-04 热更新)
        if (manifest.revision && manifest.revision !== this.manifestRevision) {
          this.manifestRevision = manifest.revision;
          this.manifestCatalog = manifest.catalog || [];

          const dynamicTools: ToolDef[] = [];
          for (const tool of manifest.tools || []) {
            dynamicTools.push(this.buildDynamicToolDef(tool));
          }

          if (dynamicTools.length > 0) {
            this.activeTools = dynamicTools;
            this.host?.log?.info?.(
              `[LivingMemory] 动态工具集已热更新 (rev: ${manifest.revision}, 可用工具数: ${dynamicTools.length}: ${dynamicTools.map((t) => t.name).join(', ')})`,
            );
          } else {
            // 上游 pending 时保持最小工具集兜底 (B-05)
            this.activeTools = this.fallbackTools();
          }
        }
      } catch (err: any) {
        // 失败时保持现有工具集或 fallback 最小三件套兜底
        if (!this.activeTools.length) {
          this.activeTools = this.fallbackTools();
        }
      } finally {
        this.syncManifestPromise = null;
      }
    })();

    return this.syncManifestPromise;
  }

  /**
   * 根据 ManifestToolDef 动态生成标准 ToolDef (B-02)
   */
  private buildDynamicToolDef(tool: ManifestToolDef): ToolDef {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      tags: tool.tags || (tool.http_method.toUpperCase() === 'GET' ? ['read'] : ['write']),
      handler: async (args: Record<string, any>) => {
        return await this.handleDynamicTool(tool, args);
      },
    };
  }

  /**
   * 动态工具执行分发与回执结构化 (A-03 ~ A-07, B-02)
   */
  private async handleDynamicTool(tool: ManifestToolDef, args: Record<string, any>): Promise<string> {
    try {
      const res = await this.client.callTool(tool.name, tool.endpoint, tool.http_method, args);

      // 针对各工具进行人性化输出格式化
      if (tool.name === 'mem_search') {
        const query = String(args.query || '').trim();
        const results = res.memories || res.results || [];
        if (!results.length) {
          return `未检索到与「${query}」相关的长期记忆。`;
        }
        const lines = results.map((r: any, i: number) => {
          const scorePct = Math.round((r.score || 0) * 100);
          return `${i + 1}. [相关度 ${scorePct}%] ${r.content}`;
        });
        return `【LivingMemory 记忆检索结果（关键词：${query}）】\n${lines.join('\n')}`;
      }

      if (tool.name === 'mem_record') {
        return `OK 已成功将该记忆沉淀至 LivingMemory（记录编号 ID: ${res.memory_id}）。`;
      }

      if (tool.name === 'mem_memorize') {
        const topics = res.topics && res.topics.length ? `，主题: ${res.topics.join('、')}` : '';
        return `OK 深度记忆已结构化沉淀至 LivingMemory（记录编号 ID: ${res.memory_id}${topics}）。`;
      }

      if (tool.name === 'mem_recall') {
        const query = String(args.query || '').trim();
        const results = res.results || [];
        if (!results.length) {
          return `未检索到与「${query}」相关的长期记忆。`;
        }
        const lines = results.map((r: any, i: number) => {
          return `${i + 1}. [ID: ${r.id}] ${r.content}`;
        });
        return `【LivingMemory 记忆召回（关键词：${query}，共 ${results.length} 条）】\n${lines.join('\n')}`;
      }

      if (tool.name === 'mem_evidence') {
        const facts = (res.facts || []).map((f: any, i: number) => `${i + 1}. ${f}`).join('\n');
        let text = `【LivingMemory 记忆证据 (ID: ${args.memory_id})】\n事实列表:\n${facts || '暂无结构化事实'}`;
        if (res.source_messages && res.source_messages.length) {
          text += `\n保留原文:\n` + res.source_messages.map((m: any) => `[${m.role}] ${m.content}`).join('\n');
        }
        if (res.next_cursor) {
          text += `\n(续读游标: ${res.next_cursor})`;
        }
        return text;
      }

      if (tool.name === 'mem_forget') {
        const ids = (res.memory_ids || []).join(', ');
        return `OK 成功将 ${res.archived_count} 条记忆安全归档（IDs: ${ids}）。管理员可从 WebUI 随时恢复。`;
      }

      if (tool.name === 'mem_status') {
        return this.formatStatus(res);
      }

      return JSON.stringify(res, null, 2);
    } catch (err: any) {
      const code = err?.code;
      if (code === 'unknown_field') {
        return `⚠ 参数错误: 存在未知参数「${err.field}」，允许参数为 ${err.reason || '详见工具描述'}`;
      }
      if (code === 'missing_field') {
        return `⚠ 参数错误: 缺少必填参数「${err.field}」`;
      }
      if (code === 'invalid_type') {
        return `⚠ 参数类型错误: ${err.message}`;
      }
      if (code === 'tool_disabled') {
        return `⚠ 工具当前在上游配置中已关闭: ${err.message}`;
      }
      if (code === 'tool_not_ready') {
        return `⚠ 记忆桥接尚未就绪: ${err.message}`;
      }
      if (code === 'permission_denied') {
        return `⚠ 权限不足: ${err.message}`;
      }
      if (code === 'tool_removed') {
        return `⚠ 工具已被移除: ${err.message}`;
      }
      return `⚠ 记忆操作失败: ${err?.message || err}`;
    }
  }

  /**
   * 格式化健康自检输出
   */
  private formatStatus(health: LivingMemoryHealth): string {
    this.lastHealth = health;
    this.lastError = null;

    const usage =
      health.usage_mode === 'local'
        ? '纯桌宠（独立记忆库）'
        : health.usage_mode === 'qq'
          ? '接入 QQ（共用会话与记忆库）'
          : String(health.usage_mode || '未填');
    const share = health.memory_share_mode === 'pet_only' ? '桌宠单独记（隔离）' : '一起记（共用图谱）';

    const caps = health.upstream_capabilities || {};
    const capKeys = Object.keys(caps);
    const capSummary = capKeys.length
      ? capKeys.map((k) => `${caps[k].label}: ${caps[k].enabled ? '正常' : `不可用(${caps[k].reason})`}`).join(' · ')
      : '就绪';

    const lines = [
      '【LivingMemory 桥接状态】',
      `插件版本：桌宠直连 v${EXTENSION_VERSION} | 桥端 ${health.version ? `v${health.version}` : '已就绪'}`,
      `运行状态：${health.state || 'running'} (PID: ${health.pid || '未知'})`,
      '桥接服务：正常连通',
      `上游记忆库：${health.livingmemory_connected ? `已连接 (${health.upstream_version ? `v${health.upstream_version}` : '就绪'})` : '未连接（先确认上游插件已安装并启用）'}`,
      `使用场景：${usage}`,
      `记忆共享模式：${share}`,
      `各项能力：${capSummary}`,
      `默认会话：${health.default_session_id || '未填'}`,
      `默认人格：${health.default_persona_id || '未识别'}`,
      `桌宠人格：${health.pet_persona_id || '未识别'}`,
    ];

    if (health.upstream_capability_warning) {
      lines.push(`⚠️ 上游能力提示：${health.upstream_capability_warning}`);
    }
    if (health.identity_warning) {
      lines.push(`⚠️ 身份提示：${health.identity_warning}`);
    }
    if (health.persona_warning) {
      lines.push(`⚠️ 人格提示：${health.persona_warning}`);
    }

    return lines.join('\n');
  }

  /**
   * 兜底最小工具三件套 (B-01 / B-05)
   */
  private fallbackTools(): ToolDef[] {
    return [
      {
        name: 'mem_search',
        description: '检索 LivingMemory 长期记忆库与知识图谱。支持多路混合语义召回、实体关系关联以及对话事实匹配。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', description: '检索关键词或查询问题' },
            limit: { type: 'integer', description: '返回条数，默认 5 条' },
          },
          required: ['query'],
        },
        tags: ['read'],
        handler: async (args: Record<string, any>) => {
          const query = String(args.query || '').trim();
          if (!query) return '⚠ 错误：query 不能为空。';
          const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
          try {
            const results = await this.client.search(query, limit);
            if (!results.length) return `未检索到与「${query}」相关的长期记忆。`;
            const lines = results.map((r, i) => `${i + 1}. [相关度 ${Math.round((r.score || 0) * 100)}%] ${r.content}`);
            return `【LivingMemory 记忆检索结果（关键词：${query}）】\n${lines.join('\n')}`;
          } catch (e: any) {
            return `⚠ 记忆检索暂时不可用: ${e?.message ?? e}`;
          }
        },
      },
      {
        name: 'mem_record',
        description: '向 LivingMemory 显式沉淀并记录重要事实、偏好、事件或人际关系（轻量直写，自动建图）。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', description: '要记录的记忆事实、重要事件或设定内容' },
            importance: { type: 'number', description: '重要性程度，0.0 至 1.0 之间，默认 0.6' },
            topics: { type: 'array', items: { type: 'string' }, description: '主题词列表（1~5 个）' },
          },
          required: ['content'],
        },
        tags: ['write'],
        handler: async (args: Record<string, any>) => {
          const content = String(args.content || '').trim();
          if (!content) return '⚠ 错误：content 不能为空。';
          const importance = Math.max(0.1, Math.min(1.0, Number(args.importance) || 0.6));
          const topics = Array.isArray(args.topics)
            ? args.topics.map((t: any) => String(t || '').trim()).filter(Boolean).slice(0, 5)
            : [];
          try {
            const memId = await this.client.add(content, importance, topics);
            return `OK 已成功将该记忆沉淀至 LivingMemory（记录编号 ID: ${memId}）。`;
          } catch (e: any) {
            return `⚠ 记忆记录失败: ${e?.message ?? e}`;
          }
        },
      },
      {
        name: 'mem_status',
        description: '自检记忆桥接服务与上游记忆库的连通性、各工具可用性及运行状态。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        tags: ['read'],
        handler: async () => {
          try {
            const health = await this.client.health();
            return this.formatStatus(health);
          } catch (e: any) {
            this.lastHealth = null;
            this.lastError = e?.message ?? String(e);
            return `⚠ 桥接自检失败：${e?.message ?? e}`;
          }
        },
      },
    ];
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;

    // 挂载后立即同步动态工具集与健康状态
    void this.probeHealth();
    await this.syncManifestTools();

    // 启动定时健康巡检与工具面热重载（每 30 秒探测并比对 revision，B-04）
    this.healthTimer = setInterval(() => {
      void this.probeHealth();
      void this.syncManifestTools();
    }, 30_000);
    this.healthTimer.unref?.();

    // 对话流自动捕获：从当前游标起步，不回溯历史
    try {
      this.lastCursor = (host.store?.latestCursor?.() ?? 0) || 0;
      // 召回轮询同样从当前水位起步：从 0 起步会在重启后先重放整段历史，
      // 导致重启后第一条消息落到「历史回放」之后，seed 与首条消息不同批。
      this.lastRecallTickCursor = this.lastCursor;
      this.lastHandledCursor = this.lastCursor;
    } catch {
      this.lastCursor = 0;
      this.lastRecallTickCursor = 0;
      this.lastHandledCursor = 0;
    }

    this.normalizeRecallConfig();

    // 预热：回填 + 预取开场召回文本 + 立刻挂一个 deferred 占位。
    // 只回填不够——批投出时若队列里没有 deferred 项，render 不会被调用，
    // 记忆只能等下一次批，表现为「重启后第一条消息没有记忆」。
    try {
      this.hydrateRecallFingerprints();
      await this.warmupRecall();
    } catch (err) {
      this.host?.log?.warn?.('启动预热失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // AC-12：召回与写入解耦。关掉自动收集时，实时召回仍要独立轮询。
    const recallOn =
      this.liveCfg('sessionSeedRecall', true) !== false ||
      !(this.cfg.autoRecall === false || String(this.cfg.autoRecall ?? '').trim().toLowerCase() === 'off');
    if (recallOn) {
      // 召回轮询与写入解耦，且必须明显快于批安静期（quietGapMs=2500ms）：
      // pushDeferred 只有在该批尚未投递时入队才会落进同一批。
      // 3 秒轮询与 2.5 秒安静期互相竞争，实测同批率仅 50%；降到 1 秒提高命中。
      // 不改变用户的 captureIntervalMs 配置。
      const recallInterval = 1000;
      this.recallTimer = setInterval(() => {
        void this.recallTick();
      }, recallInterval);
      this.recallTimer.unref?.();
    }

    if (this.cfg.autoCapture) {
      const interval = Math.max(10_000, this.cfg.captureIntervalMs || 30_000);
      this.captureTimer = setInterval(() => {
        void this.captureIncoming();
      }, interval);
      this.captureTimer.unref?.();
    }
  }

  /** 停止：宿主会 await 这个返回值，必须是 Promise */
  async stop(): Promise<void> {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
    if (this.recallTimer) {
      clearInterval(this.recallTimer);
      this.recallTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.host = null;
  }

  envPromptVars(): Record<string, string> | null {
    return {};
  }

  webUi(_language?: Language): WorldWebUiDecl {
    if (this.probeCount === 0 && !this.isProbing) {
      void this.probeHealth();
      void this.syncManifestTools();
    }

    const h = this.lastHealth;
    const connected = !!h && h.ok;
    const lmConnected = !!h && h.livingmemory_connected;
    const usage = h?.usage_mode === 'local' ? '纯桌宠' : '接入 QQ';
    const share = h?.memory_share_mode === 'pet_only' ? '单独记' : '一起记';

    const disabledCaps = Object.values(h?.upstream_capabilities || {}).filter((c) => !c.enabled);
    const capsOk = !!h && disabledCaps.length === 0;

    const lamps: WorldLamp[] = [
      {
        label: '记忆桥接',
        state: connected ? (lmConnected ? (capsOk ? 'online' : 'loading') : 'loading') : (this.probeCount === 0 ? 'loading' : 'offline'),
        hint: connected
          ? (lmConnected
              ? (capsOk ? `正常 · ${usage} (${share})` : `部分能力降级 (${disabledCaps.map((c) => c.label).join('、')}不可用)`)
              : '桥接已连 · 上游记忆库未就绪')
          : (this.probeCount === 0 ? '正在检测桥接状态' : (this.lastError || '未连接到 AstrBot 桥接服务')),
      },
    ];

    const badges: Array<{ label: string; value: string | number; tone?: 'on' | 'off' | 'plain' }> = [
      { label: '版本', value: `v${EXTENSION_VERSION}`, tone: 'plain' },
    ];
    if (connected) {
      badges.push({ label: '桥接', value: '正常', tone: 'on' });
      badges.push({
        label: '记忆库',
        value: lmConnected ? (h.upstream_version ? `v${h.upstream_version}` : '已就绪') : '未连接',
        tone: lmConnected ? 'on' : 'off',
      });
      badges.push({ label: '工具面', value: `${this.activeTools.length} 个可用`, tone: 'plain' });
      badges.push({ label: '能力', value: capsOk ? '完整' : `${disabledCaps.length}项降级`, tone: capsOk ? 'on' : 'off' });
    } else {
      badges.push({ label: '桥接', value: this.probeCount === 0 ? '检测中' : '未连接', tone: this.probeCount === 0 ? 'plain' : 'off' });
    }

    return {
      lamps,
      badges,
      promptDocs: [
        {
          key: 'worlds.livingmemory.envPrompt',
          title: 'LivingMemory · 环境提示词',
          description: '进 system 前缀的那一段：检索时机、记录纪律与称谓约定。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt' as const,
          vars: [],
        },
      ],
      config: [
        buildStatusConfigGroup(this.lastHealth, this.lastError, this.cfg.bridgeUrl, this.probeCount === 0),
        ...LIVINGMEMORY_CONFIG_GROUPS,
      ],
    };
  }

  /**
   * 暴露给桌宠主脑的工具集（从 manifest 动态加载，B-02）
   */
  tools(): ToolDef[] {
    return this.activeTools.length > 0 ? this.activeTools : this.fallbackTools();
  }

  /** 读取落盘的投递状态；缺失或损坏时返回 false。 */
  private loadRecallState(): boolean {
    try {
      if (!existsSync(this.recallStatePath)) return false;
      const raw = JSON.parse(readFileSync(this.recallStatePath, 'utf8'));
      // 旧版落盘是永久指纹表（fingerprints），窗口语义变了，视为无效并重新回填
      if (!Array.isArray(raw?.recent)) return false;
      // 旧版落盘有 seed/live 两套，合并进单一窗口
      const merged = [
        ...(Array.isArray(raw.live) ? raw.live : []),
        ...(Array.isArray(raw.seed) ? raw.seed : []),
      ];
      for (const item of merged) {
        const text = String(item || '').trim();
        if (text) this.liveRecall.add(text);
      }
      if (!merged.length) return false;
      this.recallCursor = Number(raw?.cursor) || 0;
      // 实时召回从落盘水位起步，不重扫历史
      if (this.recallCursor > this.lastHandledCursor) {
        this.lastHandledCursor = this.recallCursor;
      }
      this.host?.log?.info?.(
        `已从落盘恢复近期记忆 ${this.liveRecall.size} 条（水位 ${this.recallCursor}）`,
      );
      return true;
    } catch (err) {
      this.host?.log?.warn?.('读取投递状态失败', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /** 落盘投递状态（LRU 窗口 + 水位）。 */
  private saveRecallState(): void {
    try {
      const dir = dirname(this.recallStatePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      // AC-22：临时文件 + rename 原子替换，避免中断留下半写 JSON
      const payload = JSON.stringify(
        {
          version: 3,
          cursor: this.recallCursor,
          live: this.liveRecall.keys(),
        },
        null,
        0,
      );
      const tmpPath = `${this.recallStatePath}.tmp`;
      writeFileSync(tmpPath, payload, 'utf8');
      renameSync(tmpPath, this.recallStatePath);
    } catch (err) {
      this.host?.log?.warn?.('写入投递状态失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 恢复投递状态：以落盘为主，缺失时只回填一次近期条目，不做全表扫描。
   * 冷启动不应随事件流体积变慢。
   */
  private hydrateRecallFingerprints(): void {
    if (this.recallHydrated) return;
    this.recallHydrated = true;
    if (this.loadRecallState()) return;
    const store = (this.host as any)?.store;
    const latest = store?.latestCursor?.() ?? 0;
    if (!store?.range || !latest) return;
    try {
      const from = Math.max(0, latest - 2000);
      const events = store.range({ fromCursor: from, toCursor: latest }) ?? [];
      let recallEvents = 0;
      for (const event of events) {
        if (event?.type !== 'livingmemory.recall') continue;
        recallEvents += 1;
        const target = this.liveRecall;
        for (const line of String(event.text || '').split('\n')) {
          if (!line.startsWith('- ')) continue;
          const body = line.slice(2).replace(/^\[[^\]]*\]\s*/, '').slice(0, 120).trim();
          if (body) target.add(body);
        }
      }
      this.recallCursor = latest;
      this.lastHandledCursor = latest;
      this.saveRecallState();
      this.host?.log?.info?.(
        `已回填近期记忆 ${this.liveRecall.size} 条（扫 ${events.length} 条事件，注入事件 ${recallEvents} 条）`,
      );
    } catch (err) {
      this.host?.log?.warn?.('回填投递状态失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 上下文交接：刷新窗口与开场标记，游标用当前水位而不是清零。 */
  private onHandoffEnded(): void {
    this.sessionSeedDone = false;
    this.recallHydrated = true;
    // 上下文重建后旧的注入内容已不在上下文里，窗口一并清零，
    // 让开场批能重新投一轮（与上游「每轮摘掉再投」的语义对齐）
    this.liveRecall.clear();
    const latest = (this.host as any)?.store?.latestCursor?.() ?? 0;
    if (latest > 0) {
      this.recallCursor = latest;
      this.lastHandledCursor = latest;
    }
    this.saveRecallState();
    this.host?.log?.info?.(`上下文交接，开场批次将重新投递（水位 ${this.recallCursor}）`);
  }

  /**
   * E-08 老配置迁移：把历史默认值归一到当前口径。
   * 只在命中旧默认值时改，用户显式设过别的值不动。
   */
  private normalizeRecallConfig(): void {
    const changes: string[] = [];
    const rawTopK = Number(this.cfg.recallTopK);
    if (rawTopK === 20) {
      this.cfg.recallTopK = 3;
      changes.push('recallTopK 20→3');
    }
    const rawMaxChars = Number(this.cfg.recallMaxChars);
    if (rawMaxChars === 800) {
      this.cfg.recallMaxChars = 350;
      changes.push('recallMaxChars 800→350');
    }
    if (!Number(this.cfg.sessionSeedMaxChars)) {
      this.cfg.sessionSeedMaxChars = 400;
      changes.push('sessionSeedMaxChars 缺失→400');
    }
    const seedTopK = Number(this.cfg.sessionSeedTopK);
    if (!Number.isFinite(seedTopK) || seedTopK <= 0) {
      this.cfg.sessionSeedTopK = 20;
      changes.push('sessionSeedTopK 缺失→20');
    }
    if (changes.length) {
      this.host?.log?.info?.(`记忆配置已迁移到新口径: ${changes.join('，')}`);
    }
  }

  /** 独立召回轮询：只做注入，不写记忆库。 */
  private async recallTick(): Promise<void> {
    const host = this.host as any;
    if (!host) return;
    if (host.isPaused?.() === true) return;
    const store = host.store;
    const to = store?.latestCursor?.() ?? 0;
    if (!store?.range || to <= this.lastRecallTickCursor) return;

    let events: EventEnvelope[] = [];
    try {
      events = store.range({ fromCursor: this.lastRecallTickCursor + 1, toCursor: to }) ?? [];
    } catch {
      return;
    }
    this.lastRecallTickCursor = to;

    const turns: ChatTurn[] = [];
    for (const e of events) {
      const turn = eventToTurn(e);
      if (!turn) continue;
      const content = String(turn.content || '').trim();
      if (!content) continue;
      turns.push({
        ...turn,
        content,
        timestamp: typeof e.ts === 'number' ? e.ts / 1000 : Date.now() / 1000,
      });
    }
    if (!turns.length) return;
    await this.maybeSeedAndSchedule(turns);
  }

  /**
   * 启动预热：预先算好开场召回文本，并立刻挂一个 deferred 占位。
   * 占位必须在「第一条消息到达之前」入队，piggyback 不会自己触发投递，
   * 它会随第一条消息所在批一起消费——render 直接用缓存文本，秒返回。
   */
  private async warmupRecall(): Promise<void> {
    const host = this.host as any;
    if (!host?.pushDeferred) return;
    const store = host.store;
    const latest = store?.latestCursor?.() ?? 0;

    // query 取最近一段用户对话，热身时没有当前消息
    let texts: string[] = [];
    if (store?.range && latest > 0) {
      try {
        const from = Math.max(0, latest - 200);
        const events = store.range({ fromCursor: from, toCursor: latest }) ?? [];
        texts = pickUserTexts(events).slice(-2);
      } catch {
        texts = [];
      }
    }
    if (texts.length) {
      const built = await this.buildRecallText(
        texts,
        Math.max(1, Math.min(50, Number(this.liveCfg('sessionSeedTopK', 20)) || 20)),
        Math.max(100, Number(this.liveCfg('sessionSeedMaxChars', 400)) || 400),
        this.liveRecall,
      );
      if (built) {
        this.warmRecallText = built.text;
        this.host?.log?.info?.(
          `预热开场召回文本 ${built.count} 条 ${built.used} 字，已挂 deferred 占位`,
        );
      }
    }

    // 即使没算到内容也要挂占位：占位的作用是保证第一批有 render
    host.pushDeferred(
      {
        type: 'livingmemory.recall',
        source: this.id,
        origin: 'external',
        senderKey: 'livingmemory.recall',
        meta: { kind: 'recall', batch: 'warmup' },
        render: async () => {
          if (!this.warmRecallText) {
            this.host?.log?.info?.('预热召回渲染：无可投内容（返回 null）');
            return null;
          }
          const text = this.warmRecallText;
          this.warmRecallText = '';
          this.sessionSeedDone = true;
          this.host?.log?.info?.(
            `预热召回渲染：直接投出缓存 ${text.length} 字（不等检索）`,
          );
          return { text };
        },
      },
      { trigger: 'piggyback' },
    );
  }

  /** 面板改动后无需重载：优先读宿主的实时配置，回落到构造快照。 */
  private liveCfg<K extends keyof LivingMemoryConfig>(
    key: K,
    fallback: LivingMemoryConfig[K],
  ): LivingMemoryConfig[K] {
    const live = (this.ctx as { cfg?: Partial<LivingMemoryConfig> })?.cfg?.[key];
    if (live !== undefined && live !== null) return live;
    const snap = this.cfg?.[key];
    return snap !== undefined && snap !== null ? snap : fallback;
  }

  /** 按面板当前值校准去重窗口；容量变化时裁剪已有条目。 */
  private syncWindowCapacity(): void {
    const cap = Math.max(1, Number(this.liveCfg('recallWindowCapacity', 8)) || 8);
    const floor = Math.max(1, Number(this.liveCfg('recallWindowFloor', 5)) || 5);
    const target = Math.max(cap, floor);
    if (target === this.liveRecall.currentCapacity) return;
    this.liveRecall.setCapacity(target);
    this.host?.log?.info?.(`去重窗口容量调整为 ${target}（capacity=${cap} floor=${floor}）`);
  }

  /** 每轮入口：只走一条延迟渲染的路，首轮用宽口径，后续用窄口径。 */
  private async maybeSeedAndSchedule(turns: ChatTurn[]): Promise<void> {
    this.syncWindowCapacity();
    const liveRaw = this.liveCfg('autoRecall', true) as unknown;
    const wantLive = !(
      liveRaw === false || String(liveRaw ?? '').trim().toLowerCase() === 'off'
    );
    const wantSeed = this.liveCfg('sessionSeedRecall', true) !== false && !this.sessionSeedDone;
    if (!wantLive && !wantSeed) return;

    // AC-18：只把 2 小时内的上一轮拼进 query，避免把几天前的旧话硬接上
    const maxAgeMs = 2 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const userTexts = turns
      .filter((turn) => turn.role === 'user')
      .filter((turn) => {
        const ts = Number(turn.timestamp) * 1000;
        if (!Number.isFinite(ts) || ts <= 0) return true;
        return nowMs - ts <= maxAgeMs;
      })
      .map((turn) => String(turn.content || '').replace(/\s+/g, ' ').trim())
      .filter((text) => text.length >= 2);
    if (!userTexts.length) return;

    this.scheduleLiveRecall(userTexts);
  }

  /**
   * 实时批次：延迟渲染，随当轮批次一起投递。
   * render 在宿主投递批内被 await；返回 null 时既不落库也不投递。
   */
  private scheduleLiveRecall(userTexts: string[]): void {
    const host = this.host as any;
    if (!host?.pushDeferred) {
      this.host?.log?.warn?.('宿主不支持 pushDeferred，实时召回跳过');
      return;
    }
    const topK = Math.max(1, Math.min(20, Number(this.liveCfg('recallTopK', 3)) || 3));
    host.pushDeferred(
      {
        type: 'livingmemory.recall',
        source: this.id,
        origin: 'external',
        senderKey: 'livingmemory.recall',
        meta: { kind: 'recall', batch: 'live' },
        render: () => this.renderLiveRecall(topK, userTexts),
      },
      { trigger: 'piggyback' },
    );
  }

  /** 渲染实时批次；自带超时与异常兜底，任何失败都返回 null。 */
  private async renderLiveRecall(
    topK: number,
    userTexts: string[],
  ): Promise<{ text: string } | null> {
    // 首轮用开场口径（宽），之后用实时口径（窄）；两条预算各算各的
    const isFirst = !this.sessionSeedDone;
    const effectiveTopK = isFirst
      ? Math.max(1, Math.min(50, Number(this.liveCfg('sessionSeedTopK', 20)) || 20))
      : topK;
    const effectiveBudget = isFirst
      ? Math.max(100, Number(this.liveCfg('sessionSeedMaxChars', 400)) || 400)
      : Math.max(100, Number(this.liveCfg('recallMaxChars', 350)) || 350);
    const deadlineMs = 3000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const guard = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deadlineMs);
        timer.unref?.();
      });
      const built = await Promise.race([
        this.buildLiveRecall(effectiveTopK, userTexts, effectiveBudget),
        guard,
      ]);
      if (!built) {
        this.host?.log?.info?.('实时召回渲染完成：无可投内容（返回 null）');
        return null;
      }
      this.host?.log?.info?.(
        `实时召回渲染完成：count=${built.count} chars=${built.used}（随批投递）`,
      );
      return { text: built.text };
    } catch (err) {
      this.host?.log?.warn?.('实时召回渲染失败，本批不投递', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 从事件流取本批用户正文并检索；无正文或无命中时返回 null。 */
  private async buildLiveRecall(
    topK: number,
    userTexts: string[],
    budgetChars: number,
  ): Promise<{ text: string; count: number; used: number } | null> {
    if (!userTexts.length) return null;
    const latest = (this.host as any)?.store?.latestCursor?.() ?? 0;
    if (latest > this.lastHandledCursor) this.lastHandledCursor = latest;

    const built = await this.buildRecallText(userTexts, topK, budgetChars, this.liveRecall);
    if (built) this.sessionSeedDone = true;
    return built;
  }

  /** 该段记忆是否已投过（单一窗口）。 */
  private alreadyDelivered(preview: string): boolean {
    return this.liveRecall.has(preview);
  }

  /** 检索、去重、格式化；无可用内容时返回 null。 */
  private async buildRecallText(
    userTexts: string[],
    limit: number,
    budgetChars: number,
    target: RecentRecallWindow,
  ): Promise<{ text: string; count: number; used: number; fingerprints: string[] } | null> {
    const header =
      '【长期记忆】以下是你和对方过去真实发生过的事，相关时自然用上，' +
      '不要向对方复述「我查到」「记忆里说」，就当自己记得：\n';
    const budget = budgetChars - header.length;
    const query = userTexts.slice(-2).join(' ').slice(0, 300);

    const searchStart = Date.now();
    let memories: Array<{
      id?: number | null;
      content?: string;
      metadata?: Record<string, unknown>;
    }> = [];
    try {
      memories = (await this.client.search(query, limit, String(this.liveCfg('personaId', '') || ''))) || [];
      const elapsed = Date.now() - searchStart;
      if (elapsed > 1500) {
        this.host?.log?.warn?.(`记忆检索较慢 ${elapsed}ms，limit=${limit} 命中=${memories.length}`);
      }
    } catch (err) {
      this.host?.log?.warn?.('自动召回检索失败，本批不注入记忆', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (!memories.length) return null;

    const lines: string[] = [];
    const fresh: string[] = [];
    let used = 0;
    for (const memory of memories.slice(0, limit)) {
      const raw = String(memory.content || '').replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      // 指纹取「截断后实际写进上下文」的那段正文，与从事件流恢复时的口径一致
      const preview = raw.length > 120 ? `${raw.slice(0, 119)}…` : raw;
      if (this.alreadyDelivered(preview)) continue;

      // 桥端只保证 id/content/score/metadata，时间统一取 metadata.create_time
      const tag = formatDateTag((memory.metadata as any)?.create_time);
      const head = tag ? `[${tag}] ` : '';
      const room = budget - used - 3 - head.length;
      if (room < 20) break;
      const part = raw.length > room ? `${raw.slice(0, room - 1)}…` : raw;
      lines.push(`- ${head}${part}`);
      fresh.push(preview);
      // 时间标签也占额度，漏算就会让整条超出上限
      used += head.length + part.length + 3;
    }
    if (!lines.length) return null;

    for (const fp of fresh) target.add(fp);
    return { text: header + lines.join('\n'), count: fresh.length, used, fingerprints: fresh };
  }

  /** 记录当前水位并落盘。 */
  private persistRecallCursor(): void {
    const latest = (this.host as any)?.store?.latestCursor?.() ?? 0;
    if (latest > this.recallCursor) this.recallCursor = latest;
    this.saveRecallState();
  }

  private async captureIncoming(): Promise<number> {
    const host = this.host as any;
    if (!host) return 0;
    if (host.isPaused?.() === true) return 0;
    const store = host.store;
    if (!store || !store.range) return 0;

    const to = (store.latestCursor?.() ?? this.lastCursor) || 0;
    if (!Number.isFinite(to) || to <= this.lastCursor) return 0;

    const events = (store.range({ fromCursor: this.lastCursor + 1, toCursor: to }) ?? []) as EventEnvelope[];
    if (!events.length) {
      this.lastCursor = to;
      return 0;
    }

    const turns: ChatTurn[] = [];
    for (const e of events) {
      const turn = eventToTurn(e);
      if (!turn) continue;
      const content = turn.content.trim();
      if (!content || content.length < (this.cfg.captureMinLength || 2)) continue;
      turns.push({
        ...turn,
        content,
        timestamp: typeof e.ts === 'number' ? e.ts / 1000 : Date.now() / 1000,
      });
    }

    if (!turns.length) {
      this.lastCursor = to;
      return 0;
    }


    try {
      const recorded = await this.client.pushChat(turns);
      this.lastCursor = to;
      this.pushFailStreak = 0;
      return recorded;
    } catch {
      this.pushFailStreak += 1;
      if (this.pushFailStreak >= 5) {
        this.host?.log?.warn?.(`[LivingMemory] 连续 ${this.pushFailStreak} 次推送失败，跳过游标 ${this.lastCursor + 1}~${to} 的 ${turns.length} 条对话`);
        this.lastCursor = to;
        this.pushFailStreak = 0;
      }
      return 0;
    }
  }
}

export const LIVINGMEMORY_WORLD: WorldDefinition<LivingMemoryConfig> = {
  id: 'livingmemory',
  label: 'LivingMemory 桌宠直连',
  defaults: () => ({ ...LIVINGMEMORY_DEFAULTS }),
  create(ctx: WorldContext<LivingMemoryConfig>) {
    return new LivingMemoryWorld(ctx);
  },
};

export const id = LIVINGMEMORY_WORLD.id;
export const label = LIVINGMEMORY_WORLD.label;
export const defaults = LIVINGMEMORY_WORLD.defaults;
export const create = LIVINGMEMORY_WORLD.create;

export default LIVINGMEMORY_WORLD;
