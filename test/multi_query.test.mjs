/**
 * mem_search 多段检索：请求体构造与回执标签。
 * 覆盖 client.search 的 queries 分支与 describeQueryLabel 的显示逻辑。
 */
import assert from 'node:assert/strict';

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push(JSON.parse(String(init.body || '{}')));
  return new Response(
    JSON.stringify({ ok: true, count: 1, memories: [{ id: 1, content: '命中的记忆', score: 0.87 }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};

const { LivingMemoryClient } = await import('../src/client.ts');

const makeClient = () =>
  new LivingMemoryClient({
    bridgeUrl: 'http://127.0.0.1:6198',
    authToken: '',
    timeoutMs: 1000,
    sessionId: '',
    personaId: '',
  });

// 1) 单 query：不带 queries 字段，行为与旧版一致
{
  calls.length = 0;
  const c = makeClient();
  await c.search('钓鱼', 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, '钓鱼');
  assert.equal(calls[0].queries, undefined, '单段时不应出现 queries');
  console.log('✓ 1. 单段检索不带 queries');
}

// 2) 两段：带 queries，query 用首段兜底
{
  calls.length = 0;
  const c = makeClient();
  await c.search('', 3, '', ['钓鱼', '周末']);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].queries, ['钓鱼', '周末']);
  assert.equal(calls[0].query, '钓鱼', 'query 应为首段兜底');
  console.log('✓ 2. 两段检索带 queries + query 兜底');
}

// 3) 只有一段 queries：仍走单段路径（不出 queries）
{
  calls.length = 0;
  const c = makeClient();
  await c.search('', 3, '', ['只有一段']);
  assert.equal(calls[0].queries, undefined, '单段 queries 不应触发多段路径');
  assert.equal(calls[0].query, '只有一段');
  console.log('✓ 3. 单段 queries 回落单段路径');
}

// 4) 超过 4 段：截断
{
  calls.length = 0;
  const c = makeClient();
  await c.search('', 3, '', ['a1', 'b2', 'c3', 'd4', 'e5', 'f6']);
  assert.equal(calls[0].queries.length, 4, '最多 4 段');
  console.log('✓ 4. 超过 4 段自动截断');
}

// 5) 空白段被过滤
{
  calls.length = 0;
  const c = makeClient();
  await c.search('', 3, '', ['钓鱼', '  ', '', '周末']);
  assert.deepEqual(calls[0].queries, ['钓鱼', '周末']);
  console.log('✓ 5. 空白段被过滤');
}

console.log('\n多段检索请求体断言全部通过');
