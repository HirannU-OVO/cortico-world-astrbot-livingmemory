/**
 * 成对插件兼容用例：桌宠升级但桥没升级时，检索必须仍可用。
 * 覆盖 persona_id 参数被老桥拒绝（additionalProperties:false → 422）的场景。
 */
import assert from 'node:assert/strict';

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(String(init.body || '{}'));
  calls.push(body);
  // 模拟老桥：不认识 persona_id，直接按 strict schema 拒绝
  if ('persona_id' in body) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'unknown_field',
        field: 'persona_id',
        message: "参数错误: 存在未知参数「persona_id」",
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }
  return new Response(
    JSON.stringify({ ok: true, count: 1, memories: [{ id: 1, content: '旧桥返回的记忆' }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};

const { LivingMemoryClient } = await import('../src/client.ts');

const client = new LivingMemoryClient({
  bridgeUrl: 'http://127.0.0.1:6198',
  authToken: '',
  timeoutMs: 1000,
  sessionId: 'group:123',
  personaId: '大肥鱼',
});

const out = await client.search('测试', 3, '大肥鱼');

assert.equal(out.length, 1, '老桥场景下仍应拿到结果');
assert.equal(calls.length, 2, '应发生一次带 persona_id 的失败重试');
assert.equal(calls[0].persona_id, '大肥鱼', '首次请求带 persona_id');
assert.equal(calls[1].persona_id, undefined, '重试时不带 persona_id');
assert.equal(calls[1].session_id, 'group:123', '其余参数保持不变');

// 第二次调用应直接不带 persona_id（已记住不支持）
calls.length = 0;
await client.search('再测一次', 3, '大肥鱼');
assert.equal(calls.length, 1, '后续只发一次');
assert.equal(calls[0].persona_id, undefined, '后续不再带 persona_id');

console.log('✓ 桥兼容用例通过：老桥拒收 persona_id 时自动降级，检索不受影响');
