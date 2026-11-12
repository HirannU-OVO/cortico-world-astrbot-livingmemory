/**
 * AC-11b：render 必须在 3 秒内返回或超时返回 null，且不抛错。
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
  const out = await world.renderLiveRecall(3, ['测试查询']);
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
  const out = await world.renderLiveRecall(3, ['测试查询']);
  assert.equal(out, null, '异常应返回 null');
  console.log('✓ 异常用例：返回 null，未抛出');
}

// 3) 快速返回 → 正常产出
{
  const world = makeWorld(async () => [
    { id: 1, content: '羽羽喜欢看海', metadata: { create_time: Date.now() / 1000 } },
  ]);
  const out = await world.renderLiveRecall(3, ['看海']);
  assert.ok(out && typeof out.text === 'string', '应返回文本');
  assert.ok(out.text.includes('看海') || out.text.includes('长期记忆'));
  console.log('✓ 正常用例：返回文本');
}

console.log('✓ AC-11b render 3 秒自兜底：全部通过');
