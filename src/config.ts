/**
 * config.ts - LivingMemory 桌宠扩展配置项
 */

export interface LivingMemoryConfig {
  bridgeUrl: string;
  /** 桥的鉴权 token（与 AstrBot 侧 auth_token 一致；留空表示桥未开校验） */
  authToken: string;
  timeoutMs: number;
  sessionId: string;
  personaId: string;
  autoCapture: boolean;
  captureIntervalMs: number;
  captureMinLength: number;
}

export const LIVINGMEMORY_DEFAULTS: LivingMemoryConfig = {
  bridgeUrl: 'http://127.0.0.1:6198',
  authToken: '',
  timeoutMs: 5000,
  // 留空 = 用桥端配置的默认会话 / 人格，普通用户装完即可用，不必先知道 umo 格式
  sessionId: '',
  personaId: '',
  autoCapture: true,
  captureIntervalMs: 30000,
  // 2 会把「嗯」「哦」这类附和也推进去，产生大量噪声记忆
  captureMinLength: 6,
};

/**
 * 面板分两组：基础（连接三项）+ 高级（默认即推荐，改前先读说明）。
 * 全部项都展示——出问题时用户能看到「有哪些开关存在」，而不是来问开发者。
 */
export const LIVINGMEMORY_CONFIG_GROUPS = [
  {
    id: 'livingmemory-basic',
    owner: 'world:livingmemory' as const,
    schema: {
      type: 'object' as const,
      title: '连接',
      description: '桌宠通过本机桥读写 AstrBot 的记忆库。默认值通常不用改；改完需重载扩展。',
      properties: {
        'worlds.livingmemory.bridgeUrl': {
          type: 'string' as const,
          title: '桥地址',
          description: '默认 http://127.0.0.1:6198；桥换过端口才需要改。',
          'x-hot': false,
        },
        'worlds.livingmemory.authToken': {
          type: 'string' as const,
          title: '鉴权令牌',
          description: '桥开了鉴权才填，两边保持一致；否则留空。',
          'x-warning': true,
         'x-hot': false,
        },
        'worlds.livingmemory.sessionId': {
          type: 'string' as const,
          title: '会话（一般留空）',
          description: '留空即用桥端会话。想把记忆分开（如私聊与群各存一份）时才填。',
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
          title: '自动捕获对话',
          description: '关闭后桌宠对话不再进记忆库，只能靠 mem_record 显式记录。',
         'x-hot': false,
        },
        'worlds.livingmemory.captureMinLength': {
          type: 'integer' as const,
          title: '入库存最短字数',
          description: '低于该字数的发言不入库，避免「嗯」「哦」变成噪声。默认 6。',
          minimum: 0,
          maximum: 100,
          'x-suffix': '字',
         'x-hot': false,
        },
        'worlds.livingmemory.captureIntervalMs': {
          type: 'integer' as const,
          title: '捕获间隔',
          description: '多久拉一次新对话，最小 10 秒。默认 30000。',
          minimum: 10000,
          maximum: 600000,
          'x-suffix': 'ms',
         'x-hot': false,
        },
        'worlds.livingmemory.timeoutMs': {
          type: 'integer' as const,
          title: '请求超时',
          description: '单次桥请求超时（毫秒）。桥触发总结后回执稍慢，默认 5000。',
          minimum: 1000,
          maximum: 60000,
          'x-suffix': 'ms',
         'x-hot': false,
        },
        'worlds.livingmemory.personaId': {
          type: 'string' as const,
          title: '人格标签',
          description: '留空用桥端默认；AstrBot 未配人格时仅作分类标签。',
         'x-hot': false,
        },
      },
    },
  },
];
