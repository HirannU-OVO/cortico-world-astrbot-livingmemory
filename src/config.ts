/**
 * config.ts - LivingMemory 桌宠扩展配置项
 */

export interface LivingMemoryConfig {
  bridgeUrl: string;
  /** 桥的鉴权 token（与 AstrBot 侧 auth_token 一致；留空表示桥未开校验） */
  authToken: string;
  timeoutMs: number;
  sessionId: string;
  autoCapture: boolean;
  captureIntervalMs: number;
  captureMinLength: number;
}

export const LIVINGMEMORY_DEFAULTS: LivingMemoryConfig = {
  bridgeUrl: 'http://127.0.0.1:6198',
  authToken: '',
  timeoutMs: 5000,
  // 留空 = 用桥端配置的默认会话，普通用户装完即可用，不必先知道 umo 格式
  sessionId: '',
  autoCapture: true,
  captureIntervalMs: 30000,
  // 2 会把「嗯」「哦」这类附和也推进去，产生大量噪声记忆
  captureMinLength: 6,
};

/**
 * 面板分两组：基础（连接两项）+ 高级（默认即推荐，改前先读说明）。
 * 全部项都展示——出问题时用户能看到「有哪些开关存在」，而不是来问开发者。
 */
export const LIVINGMEMORY_CONFIG_GROUPS = [
  {
    id: 'livingmemory-basic',
    owner: 'world:livingmemory' as const,
    schema: {
      type: 'object' as const,
      title: '连接',
      description: '桌宠通过本机服务读写 AstrBot 的记忆库。默认值通常不用改；改完需重载扩展。',
      properties: {
        'worlds.livingmemory.bridgeUrl': {
          type: 'string' as const,
          title: 'AstrBot 的地址',
          description: '填 AstrBot 那边显示的服务地址；没改过端口就不用动',
          'x-hot': false,
        },
        'worlds.livingmemory.authToken': {
          type: 'string' as const,
          title: '校验 token',
          description: '和 AstrBot 插件 astrbot_plugin_coopanion_livingmemory 的「校验 token」填同一串。留空表示不校验——端口暴露在公网时不要留空。',
          'x-warning': true,
         'x-hot': false,
        },
      },
    },
  },
  {
    id: 'livingmemory-advanced',
    owner: 'world:livingmemory' as const,
    schema: {
      type: 'object' as const,
      title: '高级',
      description: '默认值即可正常使用；改完需重载扩展。',
      properties: {
        'worlds.livingmemory.autoCapture': {
          type: 'boolean' as const,
          title: '自动收集桌宠对话',
          description: '开启后，桌宠的日常聊天会定期送去 AstrBot 整理成记忆',
         'x-hot': false,
        },
        'worlds.livingmemory.captureMinLength': {
          type: 'integer' as const,
          title: '最短记录字数',
          description: '少于这个字数的发言不送，避免把「嗯」「哦」记下来',
          minimum: 0,
          maximum: 100,
          'x-suffix': '字',
         'x-hot': false,
        },
        'worlds.livingmemory.captureIntervalMs': {
          type: 'integer' as const,
          title: '多久同步一次',
          description: '每隔这么多毫秒把新对话送一次',
          minimum: 10000,
          maximum: 600000,
          'x-suffix': 'ms',
         'x-hot': false,
        },
        'worlds.livingmemory.timeoutMs': {
          type: 'integer' as const,
          title: '等待超时',
          description: 'AstrBot 回得慢时调大；单位是毫秒',
          minimum: 1000,
          maximum: 60000,
          'x-suffix': 'ms',
         'x-hot': false,
        },
        'worlds.livingmemory.sessionId': {
          type: 'string' as const,
          title: '记忆存到哪个会话',
          description: '桌宠的对话存进哪个会话；留空就跟着 AstrBot 那边，平时不用填',
         'x-hot': false,
        },
      },
    },
  },
];
