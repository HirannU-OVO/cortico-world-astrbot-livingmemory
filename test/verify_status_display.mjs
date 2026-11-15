/**
 * 桥接状态页数据源与 WebUI 声明的断言。
 * 状态已从配置页拆出，独立为 panels.bridge，由 invokePanel('bridge','status') 供数。
 */
import assert from 'node:assert/strict';

const { LivingMemoryWorld } = await import('../src/index.ts');

function makeWorld(health, opts = {}) {
  const world = new LivingMemoryWorld({
    cfg: { enabled: true, bridgeUrl: 'http://127.0.0.1:6198', timeoutMs: 5000 },
    timezone: 'Asia/Shanghai',
  });
  world.host = { log: { info() {}, warn() {}, debug() {}, error() {} }, store: { latestCursor: () => 0 } };
  world.lastHealth = health;
  world.lastError = opts.error || null;
  world.probeCount = opts.probeCount ?? 1;
  world.isProbing = !!opts.isProbing;
  world.activeTools = opts.tools || [];
  return world;
}

// ---------- 1. 初始检测中 ----------
{
  const world = makeWorld(null, { probeCount: 0, isProbing: true });
  const s = world.invokePanel('bridge', 'status');
  assert.equal(s.ok, false);
  assert.equal(s.probing, true);
  assert.equal(s.bridgeUrl, 'http://127.0.0.1:6198');
  console.log('✓ 1. 检测中状态');
}

// ---------- 2. 未连接 ----------
{
  const world = makeWorld(null, { error: 'connect ECONNREFUSED 127.0.0.1:6198' });
  const s = world.invokePanel('bridge', 'status');
  assert.equal(s.ok, false);
  assert.match(s.error, /ECONNREFUSED/);
  console.log('✓ 2. 未连接状态带错误详情');
}

// ---------- 3. 完全正常 ----------
{
  const world = makeWorld({
    ok: true, livingmemory_connected: true, version: '0.2.2', upstream_version: '2.13.0',
    usage_mode: 'qq', memory_share_mode: 'shared',
    default_session_id: 'group:987654321', default_persona_id: '大肥鱼', pet_persona_id: '小肥鱼',
    upstream_capabilities: {
      a: { label: '上游插件', enabled: true },
      b: { label: '记忆引擎', enabled: true },
      c: { label: '对话管理', enabled: true },
    },
  }, { tools: [1, 2, 3] });
  const s = world.invokePanel('bridge', 'status');
  assert.equal(s.ok, true);
  assert.equal(s.upstreamConnected, true);
  assert.equal(s.capsTotal, 3);
  assert.equal(s.capsDisabled, 0);
  assert.equal(s.toolsCount, 3);
  assert.equal(s.sessionId, 'group:987654321');
  assert.equal(s.warnings.length, 0);
  console.log('✓ 3. 正常状态：能力 3/3、工具 3 个');
}

// ---------- 4. 部分能力降级 ----------
{
  const world = makeWorld({
    ok: true, livingmemory_connected: true, version: '0.2.2', upstream_version: '2.13.0',
    usage_mode: 'local', memory_share_mode: 'pet_only',
    upstream_capabilities: {
      a: { label: '上游插件', enabled: true },
      c: { label: '对话管理', enabled: false },
    },
    upstream_capability_warning: '上游版本不匹配，对话管理暂时降级',
  });
  const s = world.invokePanel('bridge', 'status');
  assert.equal(s.capsDisabled, 1);
  assert.equal(s.warnings.length, 1);
  assert.equal(s.warnings[0].kind, '能力');
  assert.equal(s.usageLabel, '纯桌宠模式');
  assert.equal(s.shareLabel, '桌宠单独记');
  console.log('✓ 4. 降级状态：1 项不可用 + 1 条警告');
}

// ---------- 5. 未知方法应抛错 ----------
{
  const world = makeWorld(null);
  assert.throws(() => world.invokePanel('bridge', 'nope'), /未知的面板方法/);
  console.log('✓ 5. 未知面板方法被拒绝');
}

// ---------- 6. WebUI 声明：状态页与配置页分离 ----------
{
  const world = makeWorld({
    ok: true, livingmemory_connected: true, version: '0.2.2',
    usage_mode: 'qq', memory_share_mode: 'shared',
    upstream_capabilities: { a: { label: '记忆引擎', enabled: true } },
  });
  const ui = world.webUi();
  assert.ok(Array.isArray(ui.panels), 'ui.panels 必须是数组');
  const bridge = ui.panels.find((p) => p.id === 'bridge');
  assert.ok(bridge, '必须声明 bridge 面板');
  assert.deepEqual(bridge.getMethods, ['status']);
  assert.equal(typeof ui.invoke, 'function', '必须提供 invoke 分发');
  const invoked = ui.invoke('bridge', 'status', []);
  assert.equal(invoked.ok, true);
  console.log('✓ 6. 面板声明与 invoke 分发正确');
}

// ---------- 7. 配置页不再包含状态卡片 ----------
{
  const world = makeWorld({
    ok: true, livingmemory_connected: true, version: '0.2.2',
    usage_mode: 'qq', memory_share_mode: 'shared',
    upstream_capabilities: { a: { label: '记忆引擎', enabled: true } },
  });
  const ui = world.webUi();
  const ids = ui.config.map((g) => g.id);
  assert.ok(!ids.includes('livingmemory-status'), '配置页不应再出现状态卡片');
  assert.ok(!ids.some((id) => id.startsWith('livingmemory-warn')), '警告卡片也不应留在配置页');
  assert.ok(ids.includes('livingmemory-recall'), '配置分组应仍在');
  console.log('✓ 7. 配置页只剩配置项，状态已完全迁出');
}

console.log('\nAll status panel assertions PASSED cleanly!');
