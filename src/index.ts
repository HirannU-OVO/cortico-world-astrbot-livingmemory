/**
 * index.ts - LivingMemory 桌宠极速直连扩展主入口
 * 支持从 Bridge /api/tools/manifest 动态生成全部 mem_* 工具 (B-01 ~ B-05)
 */

import type { EventEnvelope, ToolDef, World, WorldHost, WorldLamp, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import type { WorldContext, WorldDefinition } from 'cortico/world.ts';
import { fileURLToPath } from 'node:url';

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

export class LivingMemoryWorld implements World {
  readonly id = 'livingmemory';
  private host: WorldHost | null = null;
  private client: LivingMemoryClient;
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastCursor = 0;
  /** 连续推送失败次数：超过阈值才跳过这一批，避免桥长时间不可用时永久卡住。 */
  private pushFailStreak = 0;
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
    } catch {
      this.lastCursor = 0;
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
