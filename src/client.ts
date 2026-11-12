/**
 * client.ts - LivingMemory Bridge 本地 REST 客户端
 * 严格对齐协议契约 (coopanion.memory-bridge.v1)
 */

import type { LivingMemoryConfig } from './config.ts';

export interface MemorySearchResult {
  id: number | null;
  content: string;
  score: number;
  metadata?: Record<string, any>;
  importance?: number;
  session_id?: string;
  persona_id?: string;
  create_time?: number;
  source_messages?: any[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

export interface UpstreamCapabilityInfo {
  label: string;
  enabled: boolean;
  reason: string;
  pending?: boolean;
}

export interface LivingMemoryHealth {
  ok: boolean;
  state?: string;
  bridge_instance_id?: string;
  pid?: number;
  started_at?: number;
  schema_version?: string;
  tools_schema_version?: string;
  plugin_version?: string;
  upstream?: {
    ready: boolean;
    version?: string;
    capabilities?: Record<string, any>;
  };
  plugin?: string;
  version?: string;
  upstream_version?: string;
  upstream_capabilities?: Record<string, UpstreamCapabilityInfo>;
  upstream_capability_warning?: string | null;
  livingmemory_connected: boolean;
  reflection_available?: boolean;
  auto_reflection?: boolean;
  usage_mode?: string;
  memory_share_mode?: string;
  default_session_id?: string;
  default_persona_id?: string;
  pet_persona_id?: string;
  persona_filtering?: boolean;
  persona_filtering_warning?: string | null;
  mode_state?: string;
  resolved_session_id?: string;
  resolved_persona_id?: string;
  resolved_adapter_id?: string;
  platform_type?: string;
  persona_source?: string;
  identity_source?: string;
  bot_identity?: {
    id?: string;
    name?: string;
    aliases?: string[];
  };
  user_identity?: {
    id?: string;
    name?: string;
  };
  identity_warning?: string | null;
  persona_warning?: string | null;
  stats?: Record<string, any>;
}

export interface ManifestToolDef {
  name: string;
  endpoint: string;
  http_method: string;
  capability: string;
  mode: string;
  permission: string;
  tags?: string[];
  description: string;
  parameters: Record<string, any>;
  available?: boolean;
  reason?: string;
}

export interface ManifestResponse {
  ok: boolean;
  schema_version: string;
  tools_schema_version: string;
  revision: string;
  bridge_version: string;
  upstream_version: string;
  tools: ManifestToolDef[];
  catalog: ManifestToolDef[];
}

export class LivingMemoryClient {
  private readonly config: LivingMemoryConfig;
  /** 桥端不支持 persona_id 时置真，后续请求不再带该字段 */
  private personaUnsupported = false;
  /** 降级告警一次，避免每轮刷日志 */
  private personaWarned = false;

  constructor(config: LivingMemoryConfig) {
    this.config = config;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.bridgeUrl.replace(/\/+$/, '')}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs || 5000);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : {}),
          ...(options.headers || {}),
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let errJson: any = null;
        try {
          errJson = JSON.parse(text);
        } catch {}
        const msg = errJson?.message || errJson?.error || text || res.statusText;
        const err = new Error(`HTTP ${res.status}: ${msg}`);
        (err as any).code = errJson?.code;
        (err as any).field = errJson?.field;
        (err as any).tool = errJson?.tool;
        (err as any).reason = errJson?.reason;
        (err as any).status = res.status;
        throw err;
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async health(): Promise<LivingMemoryHealth> {
    return this.request<LivingMemoryHealth>('/api/health', { method: 'GET' });
  }

  async getManifest(): Promise<ManifestResponse> {
    return this.request<ManifestResponse>('/api/tools/manifest', { method: 'GET' });
  }

  async search(
    query: string,
    limit = 5,
    personaId = '',
  ): Promise<MemorySearchResult[]> {
    const build = (withPersona: boolean) =>
      JSON.stringify({
        query,
        limit,
        ...(this.config.sessionId ? { session_id: this.config.sessionId } : {}),
        // 桥端按人格隔离检索；不透传时运行时 personaId 不生效
        ...(withPersona && personaId && !this.personaUnsupported
          ? { persona_id: personaId }
          : {}),
      });

    const call = async (withPersona: boolean) => {
      const data = await this.request<{
        ok: boolean;
        count: number;
        memories: MemorySearchResult[];
        error?: string;
      }>('/api/memory/search', { method: 'POST', body: build(withPersona) });
      if (!data.ok) throw new Error(data.error || '检索记忆失败');
      return data.memories || [];
    };

    try {
      return await call(true);
    } catch (err) {
      // 老版本桥的 mem_search 不接受 persona_id（contract 为
      // additionalProperties:false，会直接 422）。这里按字段名识别并
      // 去掉该参数重试一次，保证桌宠升级、桥没升级时仍能检索。
      const field = (err as { field?: string })?.field;
      if (personaId && field === 'persona_id') {
        this.personaUnsupported = true;
        if (!this.personaWarned) {
          this.personaWarned = true;
          console.warn(
            '[LivingMemory] 桥端版本不支持 persona_id，已自动降级为不传该参数（检索功能不受影响）',
          );
        }
        return await call(false);
      }
      throw err;
    }
  }

  async add(content: string, importance = 0.6, topics?: string[]): Promise<number> {
    const payload: Record<string, any> = {
      content,
      importance,
      ...(this.config.sessionId ? { session_id: this.config.sessionId } : {}),
    };
    if (topics && topics.length) {
      payload.topics = topics;
    }
    const data = await this.request<{ ok: boolean; memory_id: number; error?: string }>(
      '/api/memory/add',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (!data.ok) {
      throw new Error(data.error || '添加记忆失败');
    }

    return data.memory_id;
  }

  async memorize(params: {
    content: string;
    topics?: string[];
    key_facts?: string[];
    sentiment?: string;
    importance?: number;
    reason?: string;
  }): Promise<{ ok: boolean; memory_id: number; content: string; importance: number; topics: string[]; status: string }> {
    const payload: Record<string, any> = {
      content: params.content,
      ...(this.config.sessionId ? { session_id: this.config.sessionId } : {}),
    };
    if (params.topics?.length) payload.topics = params.topics;
    if (params.key_facts?.length) payload.key_facts = params.key_facts;
    if (params.sentiment) payload.sentiment = params.sentiment;
    if (typeof params.importance === 'number') payload.importance = params.importance;
    if (params.reason) payload.reason = params.reason;

    return this.request('/api/memory/memorize', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async recall(params: {
    query: string;
    limit?: number;
    include_source?: boolean;
    target?: string;
    start_time?: number;
    end_time?: number;
  }): Promise<{ ok: boolean; query: string; count: number; results: MemorySearchResult[] }> {
    const payload: Record<string, any> = {
      query: params.query,
      ...(this.config.sessionId ? { session_id: this.config.sessionId } : {}),
    };
    if (typeof params.limit === 'number') payload.limit = params.limit;
    if (typeof params.include_source === 'boolean') payload.include_source = params.include_source;
    if (params.target) payload.target = params.target;
    if (typeof params.start_time === 'number') payload.start_time = params.start_time;
    if (typeof params.end_time === 'number') payload.end_time = params.end_time;

    return this.request('/api/memory/recall', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async evidence(params: {
    memory_id: number;
    include_source?: boolean;
    cursor?: string;
  }): Promise<Record<string, any>> {
    const payload: Record<string, any> = {
      memory_id: params.memory_id,
    };
    if (typeof params.include_source === 'boolean') payload.include_source = params.include_source;
    if (params.cursor) payload.cursor = params.cursor;

    return this.request('/api/memory/evidence', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async forget(params: {
    memory_ids: number[];
    reason?: string;
  }): Promise<{ ok: boolean; action: string; archived_count: number; memory_ids: number[] }> {
    const payload: Record<string, any> = {
      memory_ids: params.memory_ids,
    };
    if (params.reason) payload.reason = params.reason;

    return this.request('/api/memory/forget', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async callTool(
    toolName: string,
    endpoint: string,
    httpMethod: string,
    args: Record<string, any>,
  ): Promise<any> {
    if (httpMethod.toUpperCase() === 'GET') {
      return this.request(endpoint, { method: 'GET' });
    }
    const payload = {
      ...args,
      ...(this.config.sessionId && !args.session_id ? { session_id: this.config.sessionId } : {}),
    };
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async pushChat(turns: ChatTurn[]): Promise<number> {
    if (!turns.length) return 0;
    const data = await this.request<{ ok: boolean; recorded: number; error?: string }>(
      '/api/memory/chat',
      {
        method: 'POST',
        body: JSON.stringify({
          turns,
          ...(this.config.sessionId ? { session_id: this.config.sessionId } : {}),
        }),
      },
    );

    return data.ok ? data.recorded : 0;
  }
}
