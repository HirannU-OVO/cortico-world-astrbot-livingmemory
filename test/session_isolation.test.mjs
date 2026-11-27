/**
 * test/session_isolation.test.mjs - 会话隔离、预热防串线与缺省会话保护回归测试
 */
import assert from 'node:assert/strict';

const { LivingMemoryWorld } = await import('../src/index.ts');

function makeWorld(cfgOverrides = {}) {
  const world = new LivingMemoryWorld({
    cfg: {
      enabled: true,
      bridgeUrl: 'http://127.0.0.1:6198',
      timeoutMs: 5000,
      captureMinLength: 2,
      ...cfgOverrides,
    },
    timezone: 'Asia/Shanghai',
  });
  world.lastHealth = {
    ok: true,
    livingmemory_connected: true,
    usage_mode: 'qq',
    memory_share_mode: 'shared',
    default_persona_id: '测试人格',
    default_session_id: '测试人格:FriendMessage:100000001',
  };
  world.host = {
    log: { info() {}, warn() {}, debug() {}, error() {} },
    store: { latestCursor: () => 0, range: () => [] },
    isPaused: () => false,
  };
  return world;
}

// 1. umo 优先于旧显式 sessionId；非法 umo 返回 null，不回落到显式或默认私聊会话
{
  const world = makeWorld({ sessionId: '测试人格:FriendMessage:100000001' });
  assert.equal(
    world.resolveSession('aiocqhttp:GroupMessage:123456789'),
    '测试人格:GroupMessage:123456789',
    'group umo must override legacy explicit private sessionId',
  );
  assert.equal(
    world.resolveSession('aiocqhttp:Notice:123'),
    null,
    'invalid umo must return null rather than falling back',
  );
  assert.equal(
    world.resolveSession(''),
    '测试人格:FriendMessage:100000001',
    'empty umo falls back to explicit sessionId',
  );
  console.log('✓ 1. resolveSession umo priority & invalid-umo guard passed');
}

// 2. warmupRecall 在非纯桌宠模式下，历史仅含 pet-brain/无 umo 事件时不得回落默认私聊并注入群聊
{
  const world = makeWorld();
  let searched = 0;
  world.client = {
    search: async () => {
      searched += 1;
      return [{ id: 1, content: '主人私聊秘密记忆', metadata: { create_time: Date.now() / 1000 } }];
    },
  };
  let deferredItem = null;
  world.host = {
    log: { info() {}, warn() {}, debug() {}, error() {} },
    pushDeferred: (item) => {
      deferredItem = item;
    },
    store: {
      latestCursor: () => 2,
      range: () => [
        {
          type: 'qq.message',
          source: 'pet-brain',
          origin: 'external',
          ts: Date.now(),
          text: '群聊测试消息',
          meta: { mount: 'cortico-world-pet-brain', umo: 'aiocqhttp:GroupMessage:123456789' },
        },
      ],
    },
  };
  await world.warmupRecall();
  assert.equal(searched, 0, 'warmupRecall must not search default private session when no non-pet-brain umo exists');
  assert.ok(deferredItem, 'deferred placeholder should still be registered');
  const rendered = await deferredItem.render();
  assert.equal(rendered, null, 'warmup render must return null');
  console.log('✓ 2. warmupRecall no-private-fallback guard passed');
}

// 3. warmupRecall 即使有历史私聊文本，若首条待投批是 pet-brain 或群聊，render 必须丢弃
{
  const world = makeWorld();
  world.client = {
    search: async () => [
      { id: 1, content: '私聊记忆内容', metadata: { create_time: Date.now() / 1000 } },
    ],
  };
  let deferredItem = null;
  const storeEvents = [
    {
      cursor: 1,
      type: 'astrbot.message',
      source: 'astrbot',
      origin: 'external',
      ts: Date.now(),
      text: '私聊历史消息',
      meta: { body: '私聊历史消息', umo: 'aiocqhttp:FriendMessage:100000001' },
    },
  ];
  world.lastRecallTickCursor = 1;
  world.host = {
    log: { info() {}, warn() {}, debug() {}, error() {} },
    pushDeferred: (item) => {
      deferredItem = item;
    },
    store: {
      latestCursor: () => storeEvents.length,
      range: ({ fromCursor, toCursor }) =>
        storeEvents.filter((e) => e.cursor >= fromCursor && e.cursor <= toCursor),
    },
  };
  await world.warmupRecall();
  // 在 recallTick 还没跑之前，来了一条 pet-brain 群消息
  storeEvents.push({
    cursor: 2,
    type: 'qq.message',
    source: 'pet-brain',
    origin: 'external',
    ts: Date.now(),
    text: '群里有人说话',
    meta: { mount: 'cortico-world-pet-brain', umo: 'aiocqhttp:GroupMessage:999888777' },
  });
  const rendered = await deferredItem.render();
  assert.equal(rendered, null, 'private warmup must not leak into incoming pet-brain/group batch');
  console.log('✓ 3. warmupRecall cross-session render guard passed');
}

// 4. 群聊上下文中的 desktop-pet.self (pet_say) 不得归属到默认私聊会话
{
  const world = makeWorld();
  const pushed = [];
  world.client = {
    pushChat: async (turns, sid) => {
      pushed.push({ sid, turns });
      return turns.length;
    },
  };
  world.host.store = {
    latestCursor: () => 4,
    range: () => [
      {
        type: 'qq.message',
        source: 'pet-brain',
        origin: 'external',
        ts: Date.now(),
        text: '群聊问题',
        meta: { mount: 'cortico-world-pet-brain', umo: 'aiocqhttp:GroupMessage:123456789' },
      },
      {
        type: 'desktop-pet.self',
        source: 'desktop-pet',
        origin: 'external',
        ts: Date.now(),
        text: '这是在群聊上下文里随口嘀咕的一句话',
        meta: { kind: 'say' },
      },
      {
        type: 'desktop-pet.message',
        source: 'desktop-pet',
        origin: 'external',
        ts: Date.now(),
        text: '桌宠私聊提问',
        meta: { text: '桌宠私聊提问' },
      },
      {
        type: 'desktop-pet.self',
        source: 'desktop-pet',
        origin: 'external',
        ts: Date.now(),
        text: '桌宠私聊回答',
        meta: { kind: 'say' },
      },
    ],
  };
  world.lastCursor = 0;
  await world.captureIncoming();
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].sid, '测试人格:FriendMessage:100000001');
  assert.deepEqual(
    pushed[0].turns.map((t) => `${t.role}:${t.content}`),
    ['user:桌宠私聊提问', 'assistant:桌宠私聊回答'],
    'pet_say during group chat must be skipped, while pet_say after desktop-pet.message is captured',
  );
  console.log('✓ 4. desktop-pet.self group-to-private cross-talk guard passed');
}

// 5. maybeSeedAndSchedule 同批多会话时，query 只取目标会话的 userTexts
{
  const world = makeWorld();
  let scheduledTexts = null;
  world.scheduleLiveRecall = (userTexts) => {
    scheduledTexts = userTexts;
  };
  await world.maybeSeedAndSchedule([
    { role: 'user', content: '私聊秘密内容', session_id: '测试人格:FriendMessage:100000001' },
    { role: 'user', content: '群聊当前话题', session_id: '测试人格:GroupMessage:123456789' },
  ]);
  assert.deepEqual(scheduledTexts, ['群聊当前话题'], 'must not mix private query text into group recall');
  console.log('✓ 5. maybeSeedAndSchedule per-session query isolation passed');
}

// 6. 工具缺少 session_id 时，mem_search / mem_recall / mem_evidence 一致返回 missing_session 提示
{
  const world = makeWorld();
  world.client.callTool = async () => ({
    ok: true,
    count: 0,
    memories: [],
    results: [],
    code: 'missing_session',
    warning: '调用方未提供 session',
  });
  for (const name of ['mem_search', 'mem_recall', 'mem_evidence']) {
    const out = await world.handleDynamicTool(
      { name, endpoint: '/api/memory/search', http_method: 'POST', parameters: {} },
      { query: '测试', memory_id: 1 },
    );
    assert.match(out, /缺少会话作用域/, `${name} should report missing_session consistently`);
  }
  console.log('✓ 6. handleDynamicTool missing_session consistency passed');
}

console.log('\nAll session isolation assertions PASSED cleanly!');
