/**
 * config.ts - LivingMemory 桌宠扩展配置项与状态卡片声明
 */

import type { ConfigGroup } from 'cortico/core/types.ts';
import type { LivingMemoryHealth } from './client.ts';
import { EXTENSION_VERSION } from './version.ts';

export interface LivingMemoryConfig {
  enabled: boolean;
  bridgeUrl: string;
  /** 桥的鉴权 token（与 AstrBot 侧 auth_token 一致；留空表示桥未开校验） */
  authToken: string;
  timeoutMs: number;
  sessionId: string;
  /** 桥端按人格隔离检索时使用的人格 ID；留空则跟随桥端默认人格 */
  personaId: string;
  autoCapture: boolean;
  captureIntervalMs: number;
  captureMinLength: number;
  /** 实时召回：开着就每轮用户消息都检索注入 */
  autoRecall: boolean;
  /** 单轮实时召回的检索上限（条数） */
  recallTopK: number;
  /** 会话开场单独带一批长期记忆：每次会话建立都重新带，不与实时召回共用去重账 */
  sessionSeedRecall: boolean;
  /** 会话开场那批的检索上限（条数） */
  sessionSeedTopK: number;
  /** 实时批的记忆文本总长上限（字符） */
  recallMaxChars: number;
  /** 去重窗口容量：投过多少条后旧的滑出；调小可让记忆更频繁地重新命中 */
  recallWindowCapacity: number;
  /** 去重窗口容量下限：不小于单轮条数即可，避免同轮条目把自己挤掉 */
  recallWindowFloor: number;
  /** 开场批的记忆文本总长上限（字符），与实时批分开算 */
  sessionSeedMaxChars: number;
}

export const LIVINGMEMORY_DEFAULTS: LivingMemoryConfig = {
  enabled: true,
  bridgeUrl: 'http://127.0.0.1:6198',
  authToken: '',
  timeoutMs: 5000,
  // 留空 = 用桥端配置的默认会话，普通用户装完即可用，不必先知道 umo 格式
  sessionId: '',
  // 留空 = 用桥端默认人格，普通用户不用填
  personaId: '',
  autoCapture: true,
  captureIntervalMs: 30000,
  // 2 会把「嗯」「哦」这类附和也推进去，产生大量噪声记忆
  captureMinLength: 6,
  // 实时召回：每轮都带相关记忆，重复由指纹去重挡住
  autoRecall: true,
  recallTopK: 3,
  // 会话开场那批单独算：每次会话建立都重新带一次，不走永久去重
  sessionSeedRecall: true,
  sessionSeedTopK: 20,
  // 单批上限：实时批按这档压，开场批另按 sessionSeedMaxChars
  recallMaxChars: 350,
  sessionSeedMaxChars: 400,
  // 调试用：窗口越小，同一段记忆越早滑出、越容易被重新命中
  recallWindowCapacity: 8,
  recallWindowFloor: 5,
};

/**
 * 生成配置栏顶部的状态卡片组（置于配置列表 index 0）
 * 包含：桥接状态、上游记忆库就绪情况、运行场景模式、上游各项能力状态与绑定信息
 */
export function buildStatusConfigGroup(
  health: LivingMemoryHealth | null,
  error?: string | null,
  bridgeUrl?: string,
  isInitial?: boolean,
): ConfigGroup {
  const targetUrl = bridgeUrl || LIVINGMEMORY_DEFAULTS.bridgeUrl;

  if (!health) {
    if (isInitial) {
      return {
        id: 'livingmemory-status',
        owner: 'world:livingmemory',
        schema: {
          type: 'object',
          title: '⏳ 桥接状态检测中...',
          description: `正在探测 AstrBot 记忆桥接服务 (${targetUrl})，请稍候...`,
          properties: {},
        },
      };
    }
    return {
      id: 'livingmemory-status',
      owner: 'world:livingmemory',
      schema: {
        type: 'object',
        title: '🔴 桥接服务未连接',
        description:
          `未连接到 AstrBot 记忆桥接服务 (${targetUrl})。\n` +
          '【排查建议】\n' +
          '1. 请确认 AstrBot 正在运行，且已在插件管理中启用 astrbot_plugin_coopanion_livingmemory 插件；\n' +
          '2. 请确认下方「AstrBot 的地址」端口与 AstrBot 侧配置一致（默认 6198）；\n' +
          '3. 若 AstrBot 侧设置了「校验 token」，请确保下方 token 与之完全匹配。' +
          (error ? `\n（错误详情: ${error}）` : ''),
        properties: {},
      },
    };
  }

  const lmConnected = health.livingmemory_connected;
  const caps = health.upstream_capabilities || {};
  const capKeys = Object.keys(caps);
  const disabledCaps = capKeys.filter((k) => caps[k] && !caps[k].enabled);
  const allCapsOk = capKeys.length > 0 && disabledCaps.length === 0;

  let title = '';
  if (!lmConnected) {
    title = '🟡 桥接已连通 · 上游记忆库未就绪';
  } else if (!allCapsOk && disabledCaps.length > 0) {
    title = '🟡 桥接正常 · 部分上游能力降级';
  } else {
    title = '🟢 桥接正常 · 记忆库与能力就绪';
  }

  const usageLabel = health.usage_mode === 'local' ? '纯桌宠模式（独立会话与记忆库）' : '接入 QQ 模式（桌宠与 QQ 智能体共用）';
  const shareLabel = health.memory_share_mode === 'pet_only' ? '桌宠单独记（记忆库隔离）' : '一起记（共用知识图谱与记忆库）';
  const upstreamVer = health.upstream_version ? `v${health.upstream_version}` : '已连接';

  const capList = capKeys
    .map((k) => {
      const c = caps[k];
      return c.enabled ? `${c.label} ✓` : `${c.label} ✗`;
    })
    .join('  ·  ');

  const lines: string[] = [
    `【版本标识】桌宠插件: v${EXTENSION_VERSION}  |  桥接服务: ${health.version ? `v${health.version}` : '已连通'}  |  上游记忆库: ${upstreamVer}`,
    `【服务与记忆库】桥接连接正常  |  上游 LivingMemory: ${lmConnected ? `已连接 (${upstreamVer})` : '未连接 ⚠️'}`,
    `【运行模式】${usageLabel}  |  记忆共享: ${shareLabel}`,
    capList ? `【各项能力】${capList}` : '',
    `【绑定上下文】会话: ${health.default_session_id || '默认会话'}  |  默认人格: ${health.default_persona_id || '未指定'}  |  桌宠人格: ${health.pet_persona_id || '跟随'}`,
  ].filter(Boolean);

  if (health.upstream_capability_warning) {
    lines.push(`⚠️ 能力提示: ${health.upstream_capability_warning}`);
  }
  if (health.identity_warning) {
    lines.push(`⚠️ 身份提示: ${health.identity_warning}`);
  }
  if (health.persona_warning) {
    lines.push(`⚠️ 人格提示: ${health.persona_warning}`);
  }

  return {
    id: 'livingmemory-status',
    owner: 'world:livingmemory',
    schema: {
      type: 'object',
      title,
      description: lines.join('\n'),
      properties: {},
    },
  };
}

/**
 * 基础配置组与高级配置组
 */
export const LIVINGMEMORY_CONFIG_GROUPS: ConfigGroup[] = [
  {
    id: 'livingmemory-recall',
    owner: 'world:livingmemory',
    schema: {
      type: 'object',
      title: '记忆带出',
      description: '日常最常调的就是这两组：开场带一批当背景，之后每轮再补相关的。',
      properties: {
        'worlds.livingmemory.sessionSeedRecall': {
          type: 'boolean',
          title: '会话开场带一批长期记忆',
          description:
            '每开一次会话，先带出一批宽口径的旧事当背景。这批不受实时召回的去重影响，每次会话都会重新带。',
          'x-hot': false,
        },
        'worlds.livingmemory.sessionSeedTopK': {
          type: 'integer',
          title: '开场带几条',
          description: '开场那批最多带出多少条，仍受「开场每批最多多少字」约束；上限与桥端一致为 20。',
          minimum: 1,
          maximum: 20,
          'x-suffix': '条',
          'x-hot': false,
        },
        'worlds.livingmemory.autoRecall': {
          type: 'boolean',
          title: '实时带出相关记忆',
          description:
            '开启后每轮对话都检索相关旧事。同一段内容只投一次，不会重复堆叠。' +
            '关掉只影响实时召回，不影响上面的开场批次。',
          'x-hot': false,
        },
        'worlds.livingmemory.recallTopK': {
          type: 'integer',
          title: '实时每次几条',
          description: '每轮最多带出多少条相关记忆。条数越多越可能想起细节，但也更占上下文。',
          minimum: 1,
          maximum: 20,
          'x-suffix': '条',
          'x-hot': false,
        },
        'worlds.livingmemory.recallMaxChars': {
          type: 'integer',
          title: '实时每批最多多少字',
          description: '实时召回这一批的文字总长上限，单独计算，与开场批互不影响。',
          minimum: 100,
          maximum: 4000,
          'x-suffix': '字',
          'x-hot': false,
        },
        'worlds.livingmemory.recallWindowCapacity': {
          type: 'integer',
          title: '去重窗口多大',
          description:
            '投过多少条记忆后最早的开始滑出。数值越小，同一段记忆越容易被重新带出；' +
            '数值越大，越不容易重复。改动立即生效，不用重载扩展。',
          minimum: 1,
          maximum: 100,
          'x-suffix': '条',
          'x-hot': true,
        },
        'worlds.livingmemory.recallWindowFloor': {
          type: 'integer',
          title: '去重窗口下限',
          description:
            '窗口至少这么大，防止同一轮投的条目把自己挤出去。一般不小于「实时每次几条」。' +
            '改动立即生效，不用重载扩展。',
          minimum: 1,
          maximum: 100,
          'x-suffix': '条',
          'x-hot': true,
        },
        'worlds.livingmemory.sessionSeedMaxChars': {
          type: 'integer',
          title: '开场每批最多多少字',
          description: '会话开场那批的文字总长上限，单独计算，与实时批互不影响。',
          minimum: 100,
          maximum: 4000,
          'x-suffix': '字',
          'x-hot': false,
        },
      },
    },
  },
  {
    id: 'livingmemory-capture',
    owner: 'world:livingmemory',
    schema: {
      type: 'object',
      title: '记忆收集',
      description: '决定桌宠的聊天怎么进记忆库。',
      properties: {
        'worlds.livingmemory.autoCapture': {
          type: 'boolean',
          title: '自动收集桌宠对话',
          description: '开启后，桌宠的日常聊天会定期送去 AstrBot 整理成记忆',
          'x-hot': false,
        },
        'worlds.livingmemory.captureMinLength': {
          type: 'integer',
          title: '最短记录字数',
          description: '少于这个字数的发言不送，避免把「嗯」「哦」记下来',
          minimum: 0,
          maximum: 100,
          'x-suffix': '字',
          'x-hot': false,
        },
      },
    },
  },
  {
    id: 'livingmemory-advanced',
    owner: 'world:livingmemory',
    schema: {
      type: 'object',
      title: '高级（改完需重载扩展）',
      description: '连接地址、同步频率、超时、会话归属；平时不用动。',
      properties: {
        'worlds.livingmemory.bridgeUrl': {
          type: 'string',
          title: '（高级）AstrBot 的地址',
          description: '填 AstrBot 那边显示的服务地址；没改过端口就不用动',
          'x-hot': false,
        },
        'worlds.livingmemory.authToken': {
          type: 'string',
          title: '（高级）校验 token',
          description:
            '和 AstrBot 插件 astrbot_plugin_coopanion_livingmemory 的「校验 token」填同一串。' +
            '留空表示不校验——端口暴露在公网时不要留空。',
          'x-warning': true,
          'x-hot': false,
        },
        'worlds.livingmemory.captureIntervalMs': {
          type: 'integer',
          title: '（高级）多久同步一次',
          description: '每隔这么多毫秒把新对话送一次',
          minimum: 10000,
          maximum: 600000,
          'x-suffix': 'ms',
          'x-hot': false,
        },
        'worlds.livingmemory.timeoutMs': {
          type: 'integer',
          title: '（高级）等待超时',
          description: 'AstrBot 回得慢时调大；单位是毫秒',
          minimum: 1000,
          maximum: 60000,
          'x-suffix': 'ms',
          'x-hot': false,
        },
        'worlds.livingmemory.sessionId': {
          type: 'string',
          title: '（高级）记忆存到哪个会话',
          description: '桌宠的对话存进哪个会话；留空就跟着 AstrBot 那边，平时不用填',
          'x-hot': false,
        },
        'worlds.livingmemory.personaId': {
          type: 'string',
          title: '（高级）按哪个人格检索',
          description: '桥端按人格隔离记忆时用；留空就跟随桥端默认人格，平时不用填',
          'x-hot': false,
        },
      },
    },
  },
];
