import assert from 'node:assert/strict';

// Import config and world
const {
  LIVINGMEMORY_CONFIG_GROUPS,
  LIVINGMEMORY_DEFAULTS,
  buildStatusConfigGroup
} = await import('../src/config.ts');

const { LivingMemoryWorld } = await import('../src/index.ts');

console.log('=== 1. Test buildStatusConfigGroup: Initial State ===');
const initialGroup = buildStatusConfigGroup(null, null, 'http://127.0.0.1:6198', true);
assert.equal(initialGroup.id, 'livingmemory-status');
assert.equal(initialGroup.owner, 'world:livingmemory');
assert.match(initialGroup.schema.title, /检测中/);
console.log('Initial title:', initialGroup.schema.title);
console.log('Initial desc:', initialGroup.schema.description);

console.log('\n=== 2. Test buildStatusConfigGroup: Disconnected State ===');
const disconnectedGroup = buildStatusConfigGroup(null, 'connect ECONNREFUSED 127.0.0.1:6198', 'http://127.0.0.1:6198', false);
assert.equal(disconnectedGroup.id, 'livingmemory-status');
assert.match(disconnectedGroup.schema.title, /🔴 桥接服务未连接/);
assert.match(disconnectedGroup.schema.description, /排查建议/);
assert.match(disconnectedGroup.schema.description, /ECONNREFUSED/);
console.log('Disconnected title:', disconnectedGroup.schema.title);
console.log('Disconnected desc:', disconnectedGroup.schema.description);

console.log('\n=== 3. Test buildStatusConfigGroup: Connected & Fully Healthy ===');
const healthyData = {
  ok: true,
  plugin: 'astrbot_plugin_coopanion_livingmemory',
  version: '0.2.1',
  upstream_version: '0.2.8',
  upstream_capabilities: {
    upstream_plugin: { label: '上游插件', enabled: true, reason: '' },
    engine: { label: '记忆引擎', enabled: true, reason: '' },
    conversation_api: { label: '对话管理', enabled: true, reason: '' },
    reflection: { label: '记忆反思', enabled: true, reason: '' },
    conversations_db: { label: '会话数据库', enabled: true, reason: '' },
    livingmemory_db: { label: '记忆数据库', enabled: true, reason: '' },
    persona_migration: { label: '人格迁移', enabled: true, reason: '' },
  },
  upstream_capability_warning: null,
  livingmemory_connected: true,
  usage_mode: 'qq',
  memory_share_mode: 'shared',
  default_session_id: 'group:987654321',
  default_persona_id: 'default_persona',
  pet_persona_id: 'coo_pet',
};

const healthyGroup = buildStatusConfigGroup(healthyData);
assert.match(healthyGroup.schema.title, /🟢 桥接正常/);
assert.match(healthyGroup.schema.description, /版本标识/);
assert.match(healthyGroup.schema.description, /桌宠插件: v0\.2\.1(?![-.\d])/);
assert.match(healthyGroup.schema.description, /接入 QQ 模式/);
assert.match(healthyGroup.schema.description, /一起记/);
assert.match(healthyGroup.schema.description, /记忆引擎 ✓/);
assert.match(healthyGroup.schema.description, /group:987654321/);
console.log('Healthy title:', healthyGroup.schema.title);
console.log('Healthy desc:\n' + healthyGroup.schema.description);

console.log('\n=== 4. Test buildStatusConfigGroup: Upstream Degraded ===');
const degradedData = {
  ...healthyData,
  upstream_capabilities: {
    ...healthyData.upstream_capabilities,
    conversation_api: { label: '对话管理', enabled: false, reason: '上游重构弃用旧接口' },
  },
  upstream_capability_warning: '上游版本 0.2.8 对话管理接口不匹配，暂时降级',
};

const degradedGroup = buildStatusConfigGroup(degradedData);
assert.match(degradedGroup.schema.title, /🟡 桥接正常 · 部分上游能力降级/);
assert.match(degradedGroup.schema.description, /对话管理 ✗/);
assert.match(degradedGroup.schema.description, /能力提示/);
console.log('Degraded title:', degradedGroup.schema.title);
console.log('Degraded desc:\n' + degradedGroup.schema.description);

console.log('\n=== 5. Test buildStatusConfigGroup: Upstream Disconnected ===');
const noUpstreamData = {
  ...healthyData,
  livingmemory_connected: false,
};

const noUpstreamGroup = buildStatusConfigGroup(noUpstreamData);
assert.match(noUpstreamGroup.schema.title, /🟡 桥接已连通 · 上游记忆库未就绪/);
console.log('No upstream title:', noUpstreamGroup.schema.title);
console.log('No upstream desc:\n' + noUpstreamGroup.schema.description);

console.log('\n=== 6. Test LivingMemoryWorld webUi ===');
const mockCtx = {
  id: 'livingmemory',
  cfg: { ...LIVINGMEMORY_DEFAULTS },
  timezone: 'Asia/Shanghai',
  botName: 'test',
  botDir: 'test',
  packageDir: 'test',
  dataDir: 'test',
  repoRoot: 'test',
  secret: () => '',
  storeSecret: () => {},
  persist: () => {},
  restart: async () => {},
};

const world = new LivingMemoryWorld(mockCtx);
const ui = world.webUi('zh');

assert(Array.isArray(ui.lamps), 'ui.lamps must be an array');
assert.equal(ui.lamps[0].label, '记忆桥接');
assert(Array.isArray(ui.badges), 'ui.badges must be an array');
assert(ui.badges.some(b => b.label === '版本' && b.value === 'v0.2.1'), 'Must contain version badge');
assert(Array.isArray(ui.config), 'ui.config must be an array');
assert.equal(ui.config.length, 3, 'Must have status + basic + advanced config groups');
assert.equal(ui.config[0].id, 'livingmemory-status', 'Index 0 MUST be livingmemory-status');
assert.equal(ui.config[1].id, 'livingmemory-basic', 'Index 1 MUST be livingmemory-basic');
assert.equal(ui.config[2].id, 'livingmemory-advanced', 'Index 2 MUST be livingmemory-advanced');

console.log('Lamps:', ui.lamps);
console.log('Badges:', ui.badges);
console.log('Config groups order:', ui.config.map(g => g.id));

console.log('\nAll status display assertions PASSED cleanly!');
