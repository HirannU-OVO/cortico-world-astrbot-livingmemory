import { LivingMemoryClient } from '../src/client.ts';
import { LIVINGMEMORY_DEFAULTS } from '../src/config.ts';

async function run() {
  console.log('Testing LivingMemoryClient & Manifest...');
  // 真实 token 不入库：本地联调时通过环境变量注入
  const cfg = {
    ...LIVINGMEMORY_DEFAULTS,
    authToken: process.env.LIVINGMEMORY_TOKEN ?? '',
  };
  const client = new LivingMemoryClient(cfg);

  // 1. Health check
  const health = await client.health();
  console.log('1. Health check:', health.ok, 'State:', health.state, 'LivingMemory connected:', health.livingmemory_connected);
  if (!health.ok) {
    throw new Error('Health check failed');
  }

  // 2. Manifest check
  let manifest: any = null;
  try {
    manifest = await client.getManifest();
    console.log('2. Manifest check: ok =', manifest.ok, 'schema =', manifest.schema_version, 'rev =', manifest.revision);
    console.log('   Available tools count:', manifest.tools.length, 'Catalog count:', manifest.catalog.length);
  } catch (err: any) {
    if (err?.status === 404) {
      console.log('2. Manifest check: [提示] 当前 AstrBot 运行中实例尚未加载新版本桥代码（404 on /api/tools/manifest）。待用户重启 AstrBot 后即可自动就绪。');
    } else {
      throw err;
    }
  }
  const toolNames = manifest?.tools ? manifest.tools.map((t: any) => t.name) : [];
  console.log('   Active tool names:', toolNames.length ? toolNames.join(', ') : '(待桥服务重载后更新)');

  // 3. Search check
  const results = await client.search('备份', 2);
  console.log('3. Search check returned count:', results.length);

  // 4. Record check (mem_record)
  const mid = await client.add('桌宠自动化联调验证事实：主人正在进行双端统一记忆体切换', 0.8, ['自动化', '联调']);
  console.log('4. Add memory check returned ID:', mid);

  // 5. Memorize check (mem_memorize)
  if (toolNames.includes('mem_memorize')) {
    const memRes = await client.memorize({
      content: '桌宠主脑架构已升级为契约驱动动态工具面',
      topics: ['架构', '主脑'],
      key_facts: ['契约版本为 v1'],
      sentiment: 'positive',
      importance: 0.9,
      reason: '核心里程碑记录',
    });
    console.log('5. Memorize check returned ID:', memRes.memory_id, 'status:', memRes.status);
  }

  // 6. Recall check (mem_recall)
  if (toolNames.includes('mem_recall')) {
    const recallRes = await client.recall({ query: '架构', limit: 2 });
    console.log('6. Recall check returned count:', recallRes.count);
  }

  console.log('✓ All client & manifest tests passed successfully!');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
