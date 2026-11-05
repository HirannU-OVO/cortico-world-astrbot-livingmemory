/**
 * client.ts - LivingMemory Bridge 本地 REST 客户端
 */

import type { LivingMemoryConfig } from './config.ts';

export interface MemorySearchResult {
  id: number | null;
  content: string;
  score: number;
  metadata?: Record<string, any>;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

export class LivingMemoryClient {
  private readonly config: LivingMemoryConfig;

  constructor(config: LivingMemoryConfig) {
    this.config = config;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.bridgeUrl.replace(/\/+$/, '')}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

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
        throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async health(): Promise<{ ok: boolean; livingmemory_connected: boolean; stats?: any }> {
    return this.request('/api/health', { method: 'GET' });
  }

  async search(query: string, limit = 5): Promise<MemorySearchResult[]> {
    const data = await this.request<{ ok: boolean; count: number; memories: MemorySearchResult[]; error?: string }>(
      '/api/memory/search',
      {
        method: 'POST',
        body: JSON.stringify({
          query,
          limit,
          ...(this.config.sessionId ? { session_id: this.config.sessionId } : {}),
          ...(this.config.personaId ? { persona_id: this.config.personaId } : {}),
        }),
      },
    );

    if (!data.ok) {
      throw new Error(data.error || '检索记忆失败');
    }

    return data.memories || [];
  }

  async add(content: string, importance = 0.6, metadata: Record<string, any> = {}): Promise<number> {
    const data = await this.request<{ ok: boolean; memory_id: number; error?: string }>(
      '/api/memory/add',
      {
        method: 'POST',
        body: JSON.stringify({
          content,
          importance,
          ...(this.config.sessionId ? { session_id: this.config.sessionId } : {}),
          ...(this.config.personaId ? { persona_id: this.config.personaId } : {}),
          metadata: {
            source: 'coopanion_pet',
            ...metadata,
          },
        }),
      },
    );

    if (!data.ok) {
      throw new Error(data.error || '添加记忆失败');
    }

    return data.memory_id;
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
