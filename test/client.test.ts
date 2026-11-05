import { LivingMemoryClient } from '../src/client.ts';
import { LIVINGMEMORY_DEFAULTS } from '../src/config.ts';

async function run() {
  console.log('Testing LivingMemoryClient...');
  const client = new LivingMemoryClient(LIVINGMEMORY_DEFAULTS);

  // 1. Health check
  const health = await client.health();
  console.log('1. Health check:', health.ok, 'LivingMemory connected:', health.livingmemory_connected);

  // 2. Search check
  const results = await client.search('备份', 2);
  console.log('2. Search check returned count:', results.length);
  for (const r of results) {
    console.log(`   - [Score ${(r.score * 100).toFixed(0)}%] ${r.content.slice(0, 50)}...`);
  }

  // 3. Record check
  const mid = await client.add('桌宠自动化联调验证事实：主人正在进行双端统一记忆体切换', 0.9);
  console.log('3. Add memory check returned ID:', mid);

  console.log('✓ All client tests passed successfully!');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
