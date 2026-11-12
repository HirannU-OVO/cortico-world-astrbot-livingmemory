/**
 * 把 Coopanion 事件转成真正的人机对话轮次。
 *
 * 事件流里不只有对话：world 提示词、handoff、工具活动、系统通知也会进入
 * store。以前只按 author/sender/role 判断，实际 EventEnvelope 没有这些字段，
 * 结果所有事件都被当成用户发言。这里按 origin/type/meta 明确区分：
 * - origin=internal 的事件一律不是用户说话；
 * - desktop-pet.self + kind=say 是桌宠发言；
 * - astrbot.message / qq.message / desktop-pet.message / desktop-pet.speech 是用户消息；
 * - 工具活动、系统提示、handoff、answer 等非对话事件直接跳过。
 */

import type { EventEnvelope } from 'cortico/core/types.ts';
import type { ChatTurn } from './client.ts';

type Meta = Record<string, unknown>;

const USER_MESSAGE_TYPES = new Set([
  'astrbot.message',
  'qq.message',
  'desktop-pet.message',
  'desktop-pet.speech',
]);

function metaString(meta: Meta | undefined, key: string): string {
  const value = meta?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function stripWorldSuffix(text: string): string {
  // AstrBot/QQ 事件文本会附带 world 生成的回复工具提示，不是用户原话。
  return text
    .replace(/\n?（回这条用[^\n]*$/u, '')
    .replace(/\n?\(回这条用[^\n]*$/u, '')
    .trim();
}

function textOfUserEvent(event: EventEnvelope): string {
  const meta = (event.meta || {}) as Meta;
  if (event.type === 'astrbot.message') {
    const body = metaString(meta, 'body');
    if (body) return stripWorldSuffix(body);
  }
  if (event.type === 'desktop-pet.message' || event.type === 'desktop-pet.speech') {
    const body = metaString(meta, 'text') || metaString(meta, 'body');
    if (body) return stripWorldSuffix(body);
  }
  // qq.message 只有格式化后的 text；去掉 【QQ...】 头与消息号，保留正文。
  const text = stripWorldSuffix((event.text || '').trim());
  const colon = text.indexOf('：');
  let body = (colon >= 0 ? text.slice(colon + 1) : text).trim();
  const mid = metaString(meta, 'platformMessageId');
  if (mid && body.startsWith(`#${mid}`)) {
    body = body.slice(mid.length + 1).trim();
  }
  return body;
}

/**
 * 返回 null 表示这个事件不应该进入长期记忆。
 */
export function eventToTurn(event: EventEnvelope): ChatTurn | null {
  if (event.origin === 'internal') return null;

  const meta = (event.meta || {}) as Meta;
  const type = event.type || '';

  if (type === 'desktop-pet.self' && metaString(meta, 'kind') === 'say') {
    const content = (event.text || '').trim();
    return content ? { role: 'assistant', content } : null;
  }

  if (!USER_MESSAGE_TYPES.has(type)) return null;
  if (type === 'astrbot.message' && meta.notice === true) return null;

  const content = textOfUserEvent(event);
  return content ? { role: 'user', content } : null;
}
