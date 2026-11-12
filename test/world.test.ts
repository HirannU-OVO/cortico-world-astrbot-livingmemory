/**
 * test/world.test.ts - 验证 World 扩展从 Manifest 动态生成 ToolDef 及错误处理
 */

import { LivingMemoryWorld } from '../src/index.ts';
import { LIVINGMEMORY_DEFAULTS } from '../src/config.ts';
import type { ManifestResponse } from '../src/client.ts';

// 模拟 WorldHost
const mockHost: any = {
  store: {
    latestCursor: () => 0,
    range: () => [],
  },
  log: {
    info: (msg: string) => console.log('  [Host INFO]', msg),
    warn: (msg: string) => console.log('  [Host WARN]', msg),
  },
  isPaused: () => false,
};

async function run() {
  console.log('=== World 扩展动态工具面与热更新验证 ===');

  const world = new LivingMemoryWorld({
    cfg: {
      ...LIVINGMEMORY_DEFAULTS,
      bridgeUrl: 'http://127.0.0.1:19999', // 模拟离线端点
    },
  } as any);

  // 1. 验证启动前兜底工具
  const initTools = world.tools();
  console.log('1. 初始/离线兜底工具集:', initTools.map((t) => t.name).join(', '));
  if (initTools.length !== 3) {
    throw new Error(`Expected 3 fallback tools, got ${initTools.length}`);
  }

  // 2. 模拟 Manifest 返回完整可用工具面
  const mockManifest: ManifestResponse = {
    ok: true,
    schema_version: 'coopanion.memory-bridge.v1',
    tools_schema_version: 'coopanion.livingmemory.tools.v1',
    revision: 'rev_test_001',
    bridge_version: '0.2.1',
    upstream_version: '2.10.0',
    tools: [
      {
        name: 'mem_search',
        endpoint: '/api/memory/search',
        http_method: 'POST',
        capability: 'search',
        mode: 'direct',
        permission: 'member',
        description: '检索长期记忆',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
      {
        name: 'mem_record',
        endpoint: '/api/memory/add',
        http_method: 'POST',
        capability: 'memory',
        mode: 'direct',
        permission: 'member',
        description: '轻量直写记忆',
        parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
      },
      {
        name: 'mem_memorize',
        endpoint: '/api/memory/memorize',
        http_method: 'POST',
        capability: 'memorize',
        mode: 'processed',
        permission: 'member',
        description: '深度记忆沉淀',
        parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
      },
      {
        name: 'mem_recall',
        endpoint: '/api/memory/recall',
        http_method: 'POST',
        capability: 'recall',
        mode: 'agentic',
        permission: 'member',
        description: '精准回忆召回',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
      {
        name: 'mem_status',
        endpoint: '/api/health',
        http_method: 'GET',
        capability: 'status',
        mode: 'direct',
        permission: 'member',
        description: '自检记忆状态',
        parameters: { type: 'object', properties: {} },
      },
    ],
    catalog: [],
  };

  // 注入 mock 客户端
  const client = (world as any).client;
  client.getManifest = async () => mockManifest;

  await world.start(mockHost);
  await world.syncManifestTools();

  const dynamicTools = world.tools();
  const toolNames = dynamicTools.map((t) => t.name);
  console.log('2. 同步 Manifest 后动态工具集:', toolNames.join(', '));
  if (dynamicTools.length !== 5) {
    throw new Error(`Expected 5 dynamic tools, got ${dynamicTools.length}`);
  }
  if (!toolNames.includes('mem_memorize') || !toolNames.includes('mem_recall')) {
    throw new Error('Expected mem_memorize and mem_recall in dynamic tools');
  }

  // 3. 验证动态调用 handler 格式化
  client.callTool = async (name: string, endpoint: string, method: string, args: any) => {
    if (name === 'mem_memorize') {
      return { ok: true, memory_id: 8888, topics: ['旅行', '海边'] };
    }
    if (name === 'mem_recall') {
      return { ok: true, count: 1, results: [{ id: 8888, content: '羽羽喜欢看海' }] };
    }
    return { ok: true };
  };

  const memTool = dynamicTools.find((t) => t.name === 'mem_memorize')!;
  const memRes = await memTool.handler({ content: '测试记忆' });
  console.log('3. mem_memorize 执行回执:', memRes);
  if (!memRes.includes('8888') || !memRes.includes('旅行、海边')) {
    throw new Error('mem_memorize output formatting mismatch');
  }

  const recallTool = dynamicTools.find((t) => t.name === 'mem_recall')!;
  const recallRes = await recallTool.handler({ query: '看海' });
  console.log('4. mem_recall 执行回执:', recallRes);
  if (!recallRes.includes('羽羽喜欢看海')) {
    throw new Error('mem_recall output formatting mismatch');
  }

  // 4. 验证错误码人性化处理 (LM-E2E-18 ~ 20)
  client.callTool = async () => {
    const err: any = new Error('Field unknown');
    err.code = 'unknown_field';
    err.field = 'target_user_id';
    err.reason = "Allowed: ['query']";
    throw err;
  };
  const errRes = await memTool.handler({ target_user_id: 123 });
  console.log('5. 未知字段错误人性化提示:', errRes);
  if (!errRes.includes('未知参数「target_user_id」')) {
    throw new Error('Unknown field error formatting mismatch');
  }

  // 5. 验证热更新 (LM-E2E-06): 当 revision 变化，新增 mem_forget 时自动热更新
  mockManifest.revision = 'rev_test_002';
  mockManifest.tools.push({
    name: 'mem_forget',
    endpoint: '/api/memory/forget',
    http_method: 'POST',
    capability: 'forget',
    mode: 'archive',
    permission: 'admin',
    description: '归档记忆',
    parameters: { type: 'object', properties: { memory_ids: { type: 'array' } }, required: ['memory_ids'] },
  });

  await world.syncManifestTools();
  const updatedTools = world.tools();
  const updatedNames = updatedTools.map((t) => t.name);
  console.log('6. 热更新后工具集 (rev_test_002):', updatedNames.join(', '));
  if (!updatedNames.includes('mem_forget') || updatedTools.length !== 6) {
    throw new Error('Hot reload failed to register mem_forget');
  }

  await world.stop();
  console.log('✓ All World extension tests passed successfully!');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
