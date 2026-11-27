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
  // 1. 剥离群聊上下文包装块，避免旁路上下文混入发言正文
  let cleaned = text.replace(/\[群聊上下文\s*·\s*[^\]]*\][\s\S]*?\[\/群聊上下文\]\s*/gu, '');
  // 2. 剥离预取/主动召回拼进正文的【相关记忆】/【长期记忆】注入块，严禁回流进长期记忆
  cleaned = cleaned.replace(/\n*\s*【(?:相关记忆|长期记忆)】[\s\S]*$/u, '');
  // 3. 剥离被回显的 LivingMemory 工具回执块
  cleaned = cleaned.replace(/\n*\s*【LivingMemory\s+(?:记忆检索结果|记忆召回|记忆证据|桥接状态)[^\n]*】[\s\S]*$/u, '');
  // 4. AstrBot/QQ 事件文本会附带 world 生成的回复工具提示，不是用户原话
  cleaned = cleaned
    .replace(/\n?[（(](?:回(?:这条)?用|回[：:]|主动搭话[：:])[^\n]*$/u, '')
    .trim();
  return cleaned;
}

function isPureInjectedMemoryLine(text: string): boolean {
  const s = text.trim();
  return (
    !s ||
    /^-\s*\[20\d{2}-\d{2}-\d{2}\b/.test(s) ||
    /^-\s*\[(?:以前·)?\d{1,2}月\d{1,2}日\]/.test(s) ||
    /^【(?:相关记忆|长期记忆)】/.test(s) ||
    /^用户档案[：:]/.test(s) ||
    /^【LivingMemory\s+(?:记忆检索结果|记忆召回|记忆证据|桥接状态)/.test(s) ||
    /^\[(?:system|唤醒器|应用更新|群聊上下文\b)/i.test(s)
  );
}

function textOfUserEvent(event: EventEnvelope): string {
  const meta = (event.meta || {}) as Meta;
  if (event.type === 'astrbot.message') {
    const body = metaString(meta, 'body');
    if (body) {
      const cleaned = stripWorldSuffix(body);
      return isPureInjectedMemoryLine(cleaned) ? '' : cleaned;
    }
  }
  if (event.type === 'desktop-pet.message' || event.type === 'desktop-pet.speech') {
    const body = metaString(meta, 'text') || metaString(meta, 'body');
    if (body) {
      const cleaned = stripWorldSuffix(body);
      return isPureInjectedMemoryLine(cleaned) ? '' : cleaned;
    }
  }
  if (event.type === 'qq.message') {
    // 优先取元数据里的原始正文，避免解析格式化后的头部与注入块
    const rawBody = metaString(meta, 'text') || metaString(meta, 'content') || metaString(meta, 'body');
    if (rawBody) {
      const cleaned = stripWorldSuffix(rawBody);
      return isPureInjectedMemoryLine(cleaned) ? '' : cleaned;
    }
  }
  // 回退解析格式化后的 event.text：只剥离行首【QQ...】包装头，绝不做全局中文冒号切片
  let body = stripWorldSuffix((event.text || '').trim());
  body = body.replace(/^【QQ[^】]*】\s*/u, '').trim();
  const mid = metaString(meta, 'platformMessageId');
  if (mid && body.startsWith(`#${mid}`)) {
    body = body.slice(mid.length + 1).trim();
  }
  return isPureInjectedMemoryLine(body) ? '' : body;
}

/**
 * 返回 null 表示这个事件不应该进入长期记忆。
 */
export function eventToTurn(event: EventEnvelope): ChatTurn | null {
  if (event.origin === 'internal') return null;

  const meta = (event.meta || {}) as Meta;
  if (meta.noCapture === true) return null;

  // 由桥接输入通道预先写入的入站消息，桌宠侧不再重复捕获，
  // 避免同一条消息双写并回流成新的记忆。
  if (event.source === 'pet-brain' || meta.mount === 'cortico-world-pet-brain') {
    return null;
  }

  const type = event.type || '';

  if (type === 'desktop-pet.self' && metaString(meta, 'kind') === 'say') {
    const content = stripWorldSuffix((event.text || '').trim());
    return content && !isPureInjectedMemoryLine(content) ? { role: 'assistant', content } : null;
  }

  if (!USER_MESSAGE_TYPES.has(type)) return null;
  if ((type === 'astrbot.message' || type === 'qq.message') && meta.notice === true) return null;
  if (type === 'qq.message') {
    const postType = metaString(meta, 'post_type').toLowerCase();
    if (postType && postType !== 'message') return null;
  }

  const content = textOfUserEvent(event);
  const umo = metaString(meta, 'umo');
  return content ? { role: 'user', content, ...(umo ? { umo } : {}) } : null;
}
