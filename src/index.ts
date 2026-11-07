/**
 * index.ts - LivingMemory 桌宠极速直连扩展主入口
 */

import type { EventEnvelope, ToolDef, World, WorldHost } from 'cortico/core/types.ts';
import type { WorldContext, WorldDefinition } from 'cortico/world.ts';
import { fileURLToPath } from 'node:url';

import { LIVINGMEMORY_CONFIG_GROUPS, LIVINGMEMORY_DEFAULTS, type LivingMemoryConfig } from './config.ts';
import { LivingMemoryClient, type ChatTurn } from './client.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

export class LivingMemoryWorld implements World {
  readonly id = 'livingmemory';
  private host: WorldHost | null = null;
  private client: LivingMemoryClient;
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private lastCursor = 0;
  /** 连续推送失败次数：超过阈值才跳过这一批，避免桥长时间不可用时永久卡住。 */
  private pushFailStreak = 0;
  private readonly cfg: LivingMemoryConfig;
  private readonly ctx: WorldContext<LivingMemoryConfig>;

  constructor(ctx: WorldContext<LivingMemoryConfig>) {
    this.ctx = ctx;
    this.cfg = { ...LIVINGMEMORY_DEFAULTS, ...(ctx.cfg || {}) };
    this.client = new LivingMemoryClient(this.cfg);
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;

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

  /** 停止：宿主会 await 这个返回值，必须是 Promise（同步返回 undefined 会报 reading 'then'）。 */
  async stop(): Promise<void> {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
    this.host = null;
  }

  /**
   * 环境提示词变量。
   * World 接口要求必须实现（宿主每次重建前缀都会调用，缺了会抛
   * 「mod.envPromptVars is not a function」让整个扩展加载失败）。
   * 模板里没有 {{变量}}，返回空对象即保留模板全文。
   * 这里刻意不发起网络请求——前缀重建很频繁，不能拖慢主流程。
   */
  envPromptVars(): Record<string, string> | null {
    return {};
  }

  /** 面板与提示词文档：envPrompt 模板 + 三组配置（连接 / 身份 / 捕获）。 */
  webUi() {
    return {
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
      config: LIVINGMEMORY_CONFIG_GROUPS,
    };
  }

  tools(): ToolDef[] {
    return [
      {
        name: 'mem_search',
        description: '检索 LivingMemory 长期记忆库与知识图谱。支持多路混合语义召回、实体关系关联以及对话事实匹配。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: {
              type: 'string',
              description: '检索关键词或查询问题',
            },
            limit: {
              type: 'number',
              description: '返回条数，默认 5 条',
            },
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
            if (!results.length) {
              return `未检索到与「${query}」相关的长期记忆。`;
            }

            const lines = results.map((r, i) => {
              const scorePct = Math.round((r.score || 0) * 100);
              return `${i + 1}. [相关度 ${scorePct}%] ${r.content}`;
            });

            return `【LivingMemory 记忆检索结果（关键词：${query}）】\n${lines.join('\n')}`;
          } catch (e: any) {
            return `⚠ 记忆检索暂时不可用: ${e?.message ?? e}`;
          }
        },
      },

      {
        name: 'mem_record',
        description: '向 LivingMemory 显式沉淀并记录重要事实、偏好、事件或人际关系。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: {
              type: 'string',
              description: '要记录的记忆事实、重要事件或设定内容',
            },
            importance: {
              type: 'number',
              description: '重要性程度，0.0 至 1.0 之间，默认 0.6',
            },
            topics: {
              type: 'array',
              items: { type: 'string' },
              description:
                '可选：这条记忆的主题词（1~4 个，如「钓鱼」「工作」「生日」）。传入后会参与 LivingMemory 知识图谱建边，以后检索相关话题更容易把这条记忆带出来；不传则由桥自动提取。',
            },
          },
          required: ['content'],
        },
        tags: ['write'],
        handler: async (args: Record<string, any>) => {
          const content = String(args.content || '').trim();
          if (!content) return '⚠ 错误：content 不能为空。';
          const importance = Math.max(0.1, Math.min(1.0, Number(args.importance) || 0.6));
          const topics = Array.isArray(args.topics)
            ? args.topics.map((t: any) => String(t || '').trim()).filter(Boolean).slice(0, 8)
            : [];

          try {
            const memId = await this.client.add(content, importance, topics.length ? { topics } : {});
            return `OK 已成功将该记忆沉淀至 LivingMemory（记录编号 ID: ${memId}）。`;
          } catch (e: any) {
            return `⚠ 记忆记录失败: ${e?.message ?? e}`;
          }
        },
      },

      {
        name: 'mem_status',
        description:
          '自检记忆桥接是否正常：顺带查看上游记忆库有没有连上、当前是接入 QQ 还是纯桌宠。用户问「记忆通不通」「桥连上没有」时调用它，不需要命令行。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        tags: ['read'],
        handler: async () => {
          try {
            const health = await this.client.health();
            const usage =
              health.usage_mode === 'local'
                ? '纯桌宠'
                : health.usage_mode === 'qq'
                  ? '接入 QQ'
                  : String(health.usage_mode || '未填');
            const lines = [
              '【LivingMemory 桥接状态】',
              '桥接：正常',
              `上游记忆库：${health.livingmemory_connected ? '已连接' : '未连接（先确认上游插件已安装并启用）'}`,
              `使用场景：${usage}`,
              `记忆共享模式：${health.memory_share_mode === 'pet_only' ? '桌宠单独记' : '一起记'}`,
              `默认会话：${health.default_session_id || '未填'}`,
              `默认人格：${health.default_persona_id || '未识别'}`,
              `桌宠人格：${health.pet_persona_id || '未识别'}`,
            ];
            return lines.join('\n');
          } catch (e: any) {
            return `⚠ 桥接自检失败：${e?.message ?? e}（检查桥地址、校验 token，以及 AstrBot 侧插件是否在运行）`;
          }
        },
      },
    ];
  }

  /**
   * 自动捕获对话事件并同步至 AstrBot LivingMemory
   */
  private async captureIncoming(): Promise<number> {
    const host = this.host;
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
      const text = (e.text || '').trim();
      if (!text || text.length < (this.cfg.captureMinLength || 2)) continue;

      // 区分用户发声与桌宠发声
      const isBot = (e as any).author === 'bot' || (e as any).sender === 'bot' || (e as any).role === 'assistant';
      turns.push({
        role: isBot ? 'assistant' : 'user',
        content: text,
        timestamp: typeof e.ts === 'number' ? e.ts / 1000 : Date.now() / 1000,
      });
    }

    if (!turns.length) {
      this.lastCursor = to;
      return 0;
    }

    // 关键：只有推送成功才推进游标。失败时保留游标，下一轮重试同一批，避免静默丢对话。
    try {
      const recorded = await this.client.pushChat(turns);
      this.lastCursor = to;
      this.pushFailStreak = 0;
      return recorded;
    } catch {
      this.pushFailStreak += 1;
      // 连续失败过多（桥长时间不可用）才放弃这一批，防止永远卡在同一处
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
