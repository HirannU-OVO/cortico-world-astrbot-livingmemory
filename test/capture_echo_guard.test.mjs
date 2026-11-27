/**
 * test/capture_echo_guard.test.mjs - 防止注入记忆回流、工具/系统块回显与双写回归测试
 */
import assert from 'node:assert/strict';
import { eventToTurn } from '../src/capture.ts';

// 1. 来自 pet-brain 的 qq.message 应直接跳过（已由桥接输入网关直写，防止双写与回流）
{
  const turn = eventToTurn({
    type: 'qq.message',
    source: 'pet-brain',
    origin: 'external',
    ts: Date.now(),
    text: '【QQ私聊 | 测试用户 (100000001) | mid:123】你好\n\n【相关记忆】\n- [2026-11-10 10:36] 测试用户说：白天高峰不要派助手改代码',
    meta: { mount: 'cortico-world-pet-brain', umo: 'aiocqhttp:FriendMessage:100000001' },
  });
  assert.equal(turn, null, 'pet-brain qq.message must be skipped by autoCapture');
}

// 2. 非 pet-brain 来源携带【相关记忆】和中文冒号时，不应被中文冒号误切片，且必须剥离注入块
{
  const turn = eventToTurn({
    type: 'qq.message',
    source: 'other-adapter',
    origin: 'external',
    ts: Date.now(),
    text: '【QQ私聊 | 测试用户 (100000001) | mid:456】还是在技能里写清楚吧\n\n【相关记忆】\n- [2026-11-10 10:36] 测试用户在 11-10 10:36 说：白天高峰时段不要派助手改代码',
    meta: { umo: 'aiocqhttp:FriendMessage:100000001' },
  });
  assert.deepEqual(turn, {
    role: 'user',
    content: '还是在技能里写清楚吧',
    umo: 'aiocqhttp:FriendMessage:100000001',
  });
}

// 3. 纯注入记忆行（含 YYYY-MM-DD、M月D日、用户档案）与 noCapture=true 必须被拦截
{
  assert.equal(
    eventToTurn({
      type: 'qq.message',
      source: 'other-adapter',
      origin: 'external',
      ts: Date.now(),
      text: '【相关记忆】\n- [2026-11-10 10:36] 白天高峰不许派助手',
      meta: {},
    }),
    null,
  );
  assert.equal(
    eventToTurn({
      type: 'astrbot.message',
      source: 'astrbot',
      origin: 'external',
      ts: Date.now(),
      text: '',
      meta: { body: '- [11月26日] 之前测试过的记录\n', umo: 'aiocqhttp:FriendMessage:100000001' },
    }),
    null,
    'buildRecallText bullet line in astrbot.message must be blocked',
  );
  assert.equal(
    eventToTurn({
      type: 'desktop-pet.message',
      source: 'desktop-pet',
      origin: 'external',
      ts: Date.now(),
      text: '',
      meta: { text: '- [以前·11月2日] 以前记录过的旧事' },
    }),
    null,
    'buildRecallText old bullet line in desktop-pet.message must be blocked',
  );
  assert.equal(
    eventToTurn({
      type: 'desktop-pet.message',
      source: 'desktop-pet',
      origin: 'external',
      ts: Date.now(),
      text: '你好',
      meta: { noCapture: true },
    }),
    null,
  );
}

// 4. 工具回执、系统块、群聊上下文包装与非消息通知必须被剥离或拦截
{
  assert.equal(
    eventToTurn({
      type: 'desktop-pet.self',
      source: 'desktop-pet',
      origin: 'external',
      ts: Date.now(),
      text: '【LivingMemory 记忆检索结果（关键词：测试）】\n1. [相关度 90%] 旧记忆',
      meta: { kind: 'say' },
    }),
    null,
    'echoed LivingMemory tool output in desktop-pet.self must be blocked',
  );
  assert.equal(
    eventToTurn({
      type: 'desktop-pet.self',
      source: 'desktop-pet',
      origin: 'external',
      ts: Date.now(),
      text: '[system] 3 new events',
      meta: { kind: 'say' },
    }),
    null,
    'echoed system block in desktop-pet.self must be blocked',
  );
  const cleaned = eventToTurn({
    type: 'qq.message',
    source: 'other-adapter',
    origin: 'external',
    ts: Date.now(),
    text: '',
    meta: {
      text: '[群聊上下文 · 上次我开口之后]\n[10:00] 路人: 早上好\n[/群聊上下文]\n今天吃什么\n（回：qq_send_message）',
      umo: 'aiocqhttp:GroupMessage:123456789',
    },
  });
  assert.deepEqual(cleaned, {
    role: 'user',
    content: '今天吃什么',
    umo: 'aiocqhttp:GroupMessage:123456789',
  });
  assert.equal(
    eventToTurn({
      type: 'qq.message',
      source: 'other-adapter',
      origin: 'external',
      ts: Date.now(),
      text: '群公告更新',
      meta: { post_type: 'notice', umo: 'aiocqhttp:GroupMessage:123456789' },
    }),
    null,
    'non-message qq.message notice must be skipped',
  );
}

console.log('✓ capture_echo_guard.test.mjs passed');
