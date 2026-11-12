/**
 * E-07 用例：证明运行时 personaId 真的进入桥接检索请求体。
 * 拦截 fetch，断言 POST /api/memory/search 的 body 含 persona_id。
 */
import assert from 'node:assert/strict';

const captured = [];
globalThis.fetch = async (url, init = {}) => {
  captured.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
  return new Response(
    JSON.stringify({ ok: true, count: 0, memories: [] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};

const { LivingMemoryClient } = await import('../src/client.ts');

const client = new LivingMemoryClient({
  bridgeUrl: 'http://127.0.0.1:6198',
  authToken: 'token-x',
  timeoutMs: 1000,
  sessionId: 'group:123',
  personaId: 'default_persona',
});

// 1) 显式传 personaId
await client.search('测试查询', 3, '大肥鱼');
assert.equal(captured.length, 1, '应发出一次检索请求');
assert.ok(captured[0].url.endsWith('/api/memory/search'), 'URL 应为 /api/memory/search');
assert.equal(captured[0].body.persona_id, '大肥鱼', 'persona_id 必须透传');
assert.equal(captured[0].body.query, '测试查询');
assert.equal(captured[0].body.limit, 3);
assert.equal(captured[0].body.session_id, 'group:123');

// 2) 不传 personaId 时不应出现该字段
captured.length = 0;
await client.search('第二问');
assert.equal(captured[0].body.persona_id, undefined, '未传时不得带空 persona_id');

console.log('✓ E-07 persona_id 透传用例通过：显式传入 1 条，未传时省略');
