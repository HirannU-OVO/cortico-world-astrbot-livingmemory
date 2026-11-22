/**
 * render 必须在 3 秒内返回或超时返回 null，且不抛错。
 * 与「同批率」分开验收，互不替代。
 */
import assert from 'node:assert/strict';

const { LivingMemoryWorld } = await import('../src/index.ts');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeWorld(searchImpl) {
  const world = new LivingMemoryWorld({
    cfg: { enabled: true, bridgeUrl: 'http://127.0.0.1:6198', timeoutMs: 5000, recallTopK: 3 },
    timezone: 'Asia/Shanghai',
  });
  world.client = { search: searchImpl };
  world.lastHealth = { memory_share_mode: 'shared', default_persona_id: '测试人格' };
  world.recentInboundSession = '测试人格:FriendMessage:1';
  world.host = { log: { info() {}, warn() {}, debug() {}, error() {} }, store: { latestCursor: () => 0 } };
  return world;
}

// 1) 检索超时 → 3 秒内返回 null
{
  const world = makeWorld(async () => {
    await sleep(10_000);
    return [{ content: '不该等到这里' }];
  });
  const t0 = Date.now();
  const out = await world.renderLiveRecall(3, ['测试查询'], '测试人格:FriendMessage:1');
  const dt = Date.now() - t0;
  assert.equal(out, null, '超时应返回 null');
  assert.ok(dt < 3500, `应在 3 秒内返回，实测 ${dt}ms`);
  console.log(`✓ 超时用例：${dt}ms 返回 null`);
}

// 2) 检索抛错 → 返回 null，不抛出
{
  const world = makeWorld(async () => {
    throw new Error('模拟桥接异常');
  });
  const out = await world.renderLiveRecall(3, ['测试查询'], '测试人格:FriendMessage:1');
  assert.equal(out, null, '异常应返回 null');
  console.log('✓ 异常用例：返回 null，未抛出');
}

// 3) 快速返回 → 正常产出
{
  const world = makeWorld(async () => [
    { id: 1, content: '小林喜欢看海', metadata: { create_time: Date.now() / 1000 } },
  ]);
  const out = await world.renderLiveRecall(3, ['看海'], '测试人格:FriendMessage:1');
  assert.ok(out && typeof out.text === 'string', '应返回文本');
  assert.ok(out.text.includes('看海') || out.text.includes('长期记忆'));
  console.log('✓ 正常用例：返回文本');
}

console.log('✓ render 3 秒自兜底：全部通过');

// 4) 跨会话投递：排块会话与当前批次不一致 → 丢弃
{
  const world = makeWorld(async () => [
    { id: 1, content: '只属于私聊的记忆', metadata: { create_time: Date.now() / 1000 } },
  ]);
  world.recentInboundSession = '测试人格:GroupMessage:123456789';
  const out = await world.renderLiveRecall(3, ['私聊查询'], '测试人格:FriendMessage:1');
  assert.equal(out, null, '私聊召回块不能投到群批次');
  console.log('✓ 跨会话投递丢弃用例通过');
}

// 5) seed 按会话记录
{
  const world = makeWorld(async () => [
    { id: 1, content: '私聊记忆', metadata: { create_time: Date.now() / 1000 } },
  ]);
  world.recentInboundSession = '测试人格:FriendMessage:1';
  await world.renderLiveRecall(3, ['私聊查询'], '测试人格:FriendMessage:1');
  assert.equal(world.sessionSeedDone.has('测试人格:FriendMessage:1'), true);
  assert.equal(world.sessionSeedDone.has('测试人格:GroupMessage:123456789'), false);
  console.log('✓ seed 按会话记录用例通过');
}

// 6) 启动首批无批次：放行
{
  const world = makeWorld(async () => [
    { id: 1, content: '启动首批记忆', metadata: { create_time: Date.now() / 1000 } },
  ]);
  world.recentInboundSession = '';
  world.batchBoundaryReason = 'startup';
  const out = await world.renderLiveRecall(3, ['启动'], '测试人格:FriendMessage:1');
  assert.ok(out && typeof out.text === 'string', '启动首批应放行');
  assert.equal(world.recentInboundSession, '测试人格:FriendMessage:1');
  console.log('✓ 启动首批放行用例通过');
}

// 7) handoff 首批无批次：放行
{
  const world = makeWorld(async () => [
    { id: 1, content: '交接后记忆', metadata: { create_time: Date.now() / 1000 } },
  ]);
  world.recentInboundSession = '';
  world.batchBoundaryReason = 'handoff';
  const out = await world.renderLiveRecall(3, ['交接'], '测试人格:FriendMessage:1');
  assert.ok(out && typeof out.text === 'string', '交接后首批应放行');
  console.log('✓ 交接后首批放行用例通过');
}

// 8) 未探测：召回跳过
{
  const world = makeWorld(async () => {
    throw new Error('不该检索');
  });
  world.lastHealth = null;
  const out = await world.buildRecallText(['查询'], 3, 100, { has: () => false, add: () => {} }, '测试人格:FriendMessage:1');
  assert.equal(out, null, '未探测时应跳过召回');
  console.log('✓ 未探测跳过召回用例通过');
}

// 9) 未探测：写入跳过
{
  const world = makeWorld(async () => []);
  world.lastHealth = null;
  let pushed = 0;
  world.client.pushChat = async () => { pushed += 1; return 1; };
  world.host.store.latestCursor = () => 1;
  world.lastCursor = 0;
  const n = await world.captureIncoming();
  assert.equal(n, 0, '未探测时应跳过写入');
  assert.equal(pushed, 0, '未探测时不应调用 pushChat');
  console.log('✓ 未探测跳过写入用例通过');
}

// 10) 探测到 pet_only：正常召回
{
  const world = makeWorld(async () => [
    { id: 1, content: '桌宠自己的记忆', metadata: { create_time: Date.now() / 1000 } },
  ]);
  world.lastHealth = { memory_share_mode: 'pet_only', default_persona_id: '测试人格' };
  world.recentInboundSession = '测试人格:FriendMessage:1#pet';
  const out = await world.renderLiveRecall(3, ['查询'], '测试人格:FriendMessage:1#pet');
  assert.ok(out && typeof out.text === 'string', 'pet_only 应正常召回');
  console.log('✓ 探测到 pet_only 正常召回用例通过');
}

// 11) pushChat 混合批次不带顶层 session；同会话批次带
{
  const { LivingMemoryClient } = await import('../src/client.ts');
  const client = new LivingMemoryClient({
    bridgeUrl: 'http://127.0.0.1:9', authToken: '', timeoutMs: 1000, sessionId: '', personaId: '',
  });
  let body = null;
  client.request = async (_endpoint, opts) => {
    body = JSON.parse(opts.body);
    return { ok: true, recorded: 1 };
  };
  await client.pushChat([
    { role: 'user', content: 'a', session_id: 's:GroupMessage:1' },
    { role: 'user', content: 'b', session_id: 's:FriendMessage:2' },
  ], 's:GroupMessage:1');
  assert.equal(body.session_id, undefined, '混合批次不能带顶层 session');
  await client.pushChat([
    { role: 'user', content: 'a', session_id: 's:GroupMessage:1' },
    { role: 'user', content: 'b', session_id: 's:GroupMessage:1' },
  ], 's:GroupMessage:1');
  assert.equal(body.session_id, 's:GroupMessage:1', '同会话批次应带顶层 session');
  console.log('✓ pushChat 顶层 session 用例通过');
}

// 12) captureIncoming 按 session 分组推送
{
  const world = makeWorld(async () => []);
  world.lastHealth = { memory_share_mode: 'shared', default_persona_id: '测试人格' };
  const calls = [];
  world.client.pushChat = async (turns, sid) => { calls.push([sid, turns.length]); return turns.length; };
  world.host.store = {
    latestCursor: () => 2,
    range: () => [
      { type: 'astrbot.message', origin: 'external', ts: 1, text: 'private text', meta: { body: 'private text', umo: 'aiocqhttp:FriendMessage:1' } },
      { type: 'astrbot.message', origin: 'external', ts: 2, text: 'group text', meta: { body: 'group text', umo: 'aiocqhttp:GroupMessage:2' } },
    ],
  };
  world.lastCursor = 0;
  await world.captureIncoming();
  assert.equal(calls.length, 2, '不同会话应分两次 pushChat');
  assert.deepEqual(calls.sort(), [['测试人格:FriendMessage:1', 1], ['测试人格:GroupMessage:2', 1]]);
  console.log('✓ captureIncoming 按会话分组用例通过');
}

// 13) 显式配置补齐空 turn；配置为空时保持跳过
{
  const { LivingMemoryClient } = await import('../src/client.ts');
  const mk = (sessionId) => new LivingMemoryClient({
    bridgeUrl: 'http://127.0.0.1:9', authToken: '', timeoutMs: 1000, sessionId, personaId: '',
  });
  let body = null;
  const forced = mk('测试人格:FriendMessage:1');
  forced.request = async (_e, opts) => { body = JSON.parse(opts.body); return { ok: true, recorded: 1 }; };
  await forced.pushChat([{ role: 'user', content: 'no session' }], '');
  assert.equal(body.turns[0].session_id, '测试人格:FriendMessage:1', '显式配置应补齐 turn');
  assert.equal(body.session_id, '测试人格:FriendMessage:1', '补齐后同会话应带顶层');

  const empty = mk('');
  empty.request = async (_e, opts) => { body = JSON.parse(opts.body); return { ok: true, recorded: 1 }; };
  await empty.pushChat([{ role: 'user', content: 'no session' }], '');
  assert.equal(body.turns[0].session_id, undefined, '配置为空时 turn 不应被补');
  assert.equal(body.session_id, undefined, '配置为空时不应带顶层');
  console.log('✓ pushChat 显式配置补齐用例通过');
}

// 14) 同轮多排：只保留最新 inbound 会话的召回
{
  const seen = [];
  const world = makeWorld(async (_q, _limit, _kw, _persona, sessionId) => {
    seen.push(sessionId);
    return [{ id: 1, content: '同轮记忆', metadata: { create_time: Date.now() / 1000 } }];
  });
  world.lastHealth = { memory_share_mode: 'shared', default_persona_id: '测试人格' };
  world.recentInboundSession = '测试人格:GroupMessage:2';
  world.liveRecallEpoch = 2;
  const stale = await world.renderLiveRecall(3, ['查询'], '测试人格:FriendMessage:1', 1);
  assert.equal(stale, null, '旧会话排块应丢弃');
  const live = await world.renderLiveRecall(3, ['查询'], '测试人格:GroupMessage:2', 2);
  assert.ok(live && typeof live.text === 'string', '当前 inbound 会话应渲染');
  assert.deepEqual(seen, ['测试人格:GroupMessage:2'], '只应检索当前 inbound 会话');
  console.log('✓ 同轮多排只保留 inbound 会话用例通过');
}
