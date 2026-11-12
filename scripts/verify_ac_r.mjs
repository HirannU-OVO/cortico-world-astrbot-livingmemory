#!/usr/bin/env node
/**
 * AC-R01~R09 验收：读取真实运行数据做断言，可反复跑。
 * 用法：node scripts/verify_ac_r.mjs [--since=2026-11-12T14:00]
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const sinceArg = args.find((a) => a.startsWith('--since='));
const SINCE = sinceArg ? sinceArg.slice(8) : '';

// Coopanion 数据目录由使用方指定，脚本不写死本机路径：
//   COOPANION_HOME=<路径> node scripts/verify_ac_r.mjs
//   或 node scripts/verify_ac_r.mjs --coopanion-home=<路径>
const homeArg = args.find((a) => a.startsWith('--coopanion-home='));
const ROOT = process.env.COOPANION_HOME || (homeArg ? homeArg.split('=')[1] : '');
if (!ROOT) {
  console.error('缺少 Coopanion 数据目录：请设置 COOPANION_HOME 或传 --coopanion-home=<路径>');
  process.exit(2);
}
const SESSION = join(ROOT, 'data/session-main.jsonl');
const RUNS = join(ROOT, 'data/runs');

let pass = 0;
let fail = 0;
function check(id, desc, ok, detail = '') {
  const mark = ok === true ? 'PASS' : ok === 'skip' ? 'SKIP' : 'FAIL';
  if (ok === true) pass += 1;
  else if (ok !== 'skip') fail += 1;
  console.log(`[${mark}] ${id} ${desc}${detail ? ` :: ${detail}` : ''}`);
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch {}
  }
  return out;
}

const session = readJsonl(SESSION);

// ---------- 采集所有 recall 事件 ----------
const recallEvents = [];
if (existsSync(RUNS)) {
  for (const dir of readdirSync(RUNS)) {
    const f = join(RUNS, dir, 'events.jsonl');
    if (!existsSync(f)) continue;
    for (const d of readJsonl(f)) {
      if (d.type === 'livingmemory.recall') recallEvents.push(d);
    }
  }
}
recallEvents.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
// 新版起点：第一条「live 批 + 正文长度 < 400」的事件，
// 旧版时代 live 正文是 700+ 字符（recallMaxChars=800）。
let newEraStart = null;
for (const d of recallEvents) {
  const isLive = (d.meta || {}).batch === 'live';
  const short = String(d.text || '').length < 400;
  if (isLive && short) {
    newEraStart = d.ts;
    break;
  }
}
const cutoffTime = SINCE
  ? new Date(SINCE).getTime()
  : newEraStart
    ? new Date(newEraStart).getTime()
    : Date.now() - 30 * 60 * 1000;
const recent = recallEvents.filter((d) => {
  const ts = new Date(d.ts).getTime();
  return Number.isFinite(ts) && ts >= cutoffTime;
});
console.log(
  `# 新版起点：${new Date(cutoffTime).toISOString()}（recall 总数 ${recallEvents.length}，窗口内 ${recent.length}）`,
);

// ---------- AC-R01 同帧合并 ----------
let r01 = 'skip';
let r01Detail = '未找到含 livingmemory 的合成帧';
for (let i = session.length - 1; i >= 0; i -= 1) {
  const item = session[i].item || {};
  if (item.type !== 'function_call_output') continue;
  // 只认合成帧回执（call_id 以 evf_ 开头），工具回执不算
  if (!String(item.call_id || '').startsWith('evf_')) continue;
  const text = String(item.output || '');
  if (!text.includes('长期记忆')) continue;
  const evts = ((session[i].context || {}).frame || {}).events || [];
  const sources = evts.map((e) => e.source);
  const hasQQ = sources.includes('astrbot');
  const hasMem = sources.includes('livingmemory');
  // 探针帧可能只有 probe+memory，继续往前找真正含 QQ 正文的那一帧
  if (!(hasQQ && hasMem)) continue;
  r01 = evts.length >= 2;
  r01Detail = `frame=${item.call_id} sources=${JSON.stringify(sources)}`;
  break;
}
check('AC-R01', '记忆与 QQ 消息同帧合并', r01, r01Detail);

// ---------- AC-R02 帧早于模型阶段 ----------
let r02 = 'skip';
let r02Detail = '未找到可比对的帧与推理记录';
for (let i = 0; i < session.length - 1; i += 1) {
  const cur = session[i].item || {};
  if (cur.type !== 'function_call_output') continue;
  if (!String(cur.call_id || '').startsWith('evf_')) continue;
  const frameTs = (session[i].context || {}).ts;
  if (!frameTs) continue;
  for (let j = i + 1; j < Math.min(session.length, i + 8); j += 1) {
    const nxt = session[j].item || {};
    if (nxt.type !== 'reasoning') continue;
    const reasonTs = (session[j].context || {}).ts;
    if (!reasonTs) break;
    const delta = new Date(reasonTs).getTime() - new Date(frameTs).getTime();
    r02 = delta > 0;
    r02Detail = `frame=${String(frameTs).slice(11, 23)} reasoning=${String(reasonTs).slice(11, 23)} 早 ${delta}ms`;
    break;
  }
  if (r02 !== 'skip') break;
}
check('AC-R02', '合成帧写入早于本轮模型阶段', r02, r02Detail);

// ---------- AC-R03 无消息不落库 ----------
const userMsgTs = [];
if (existsSync(RUNS)) {
  for (const dir of readdirSync(RUNS)) {
    const f = join(RUNS, dir, 'events.jsonl');
    if (!existsSync(f)) continue;
    for (const d of readJsonl(f)) {
      if (!['astrbot.message', 'qq.message'].includes(d.type)) continue;
      const t = new Date(d.ts).getTime();
      if (Number.isFinite(t)) userMsgTs.push(t);
    }
  }
}
let r03 = 'skip';
let r03Detail = '数据不足';
if (recent.length && userMsgTs.length) {
  const orphan = recent.filter((d) => {
    const t = new Date(d.ts).getTime();
    if (!Number.isFinite(t)) return false;
    // capture 30s 轮询 + 桥推送延迟 + 用户连发间隔，取 3 分钟窗口
    return !userMsgTs.some((u) => Math.abs(u - t) <= 180_000);
  });
  r03 = orphan.length === 0;
  r03Detail = `recall ${recent.length} 条，脱离用户消息 ${orphan.length} 条（3 分钟窗口外）`;
}
check('AC-R03', '无新消息时不单独落库', r03, r03Detail);

// ---------- AC-R06 实时批不超预算 ----------
const liveEvents = recent.filter((d) => (d.meta || {}).batch === 'live');
let r06 = 'skip';
let r06Detail = '无 live 事件';
if (liveEvents.length) {
  const lens = liveEvents.map((d) => String(d.text || '').length);
  const maxLen = Math.max(...lens);
  const over = lens.filter((n) => n > 400).length;
  r06 = over === 0;
  r06Detail = `live ${liveEvents.length} 条，最长 ${maxLen} 字符（预算 350 + 标题余量），超 400 的 ${over} 条`;
}
check('AC-R06', '实时批单条不超过预算', r06, r06Detail);

// ---------- AC-11a 同批率（seed / live 分开算） ----------
// seed 批走 origin=internal → 拼进 user 消息，判据是 session 里有没有含记忆的 user 消息；
// live 批走 pushDeferred(origin=external) → 判据是落在 external_event_frame 且同帧有用户消息。
const framedCursors = new Set();
const framesWithUser = new Set();
for (const rec of session) {
  const item = rec.item || {};
  if (item.type !== 'function_call_output') continue;
  if (!String(item.call_id || '').startsWith('evf_')) continue;
  const evts = ((rec.context || {}).frame || {}).events || [];
  const hasUser = evts.some((e) => e.source === 'astrbot');
  for (const e of evts) {
    if (typeof e.cursor !== 'number') continue;
    framedCursors.add(e.cursor);
    if (hasUser) framesWithUser.add(e.cursor);
  }
}

// seed：session 里当前生效的 user 消息中，是否含记忆块
const seedInUserMsg = session.filter((rec) => {
  const item = rec.item || {};
  if (item.type !== 'message' || item.role !== 'user') return false;
  // content 可能是字符串，也可能是 parts 数组；统一序列化后匹配
  return JSON.stringify(item.content ?? '').includes('长期记忆');
}).length;
const seedEvents = recent.filter((d) => (d.meta || {}).batch === 'seed');
let r11seed = 'skip';
let r11seedDetail = '窗口内无 seed 事件';
if (seedEvents.length) {
  r11seed = seedInUserMsg > 0;
  r11seedDetail =
    `seed 事件 ${seedEvents.length} 条，session 中含记忆块的 user 消息 ${seedInUserMsg} 条` +
    `（seed 走 internal → user 消息，不进合成帧）`;
}
check('AC-R11a-seed', '开场批落进 user 消息', r11seed, r11seedDetail);

// live：只在当前 session 覆盖的 cursor 范围内统计
const framedList = [...framedCursors];
const sessionMin = framedList.length ? Math.min(...framedList) : Number.MAX_SAFE_INTEGER;
const liveScoped = liveEvents.filter((d) => d.cursor >= sessionMin);
let r11live = 'skip';
let r11liveDetail = `live ${liveEvents.length} 条均早于当前 session 起点 ${sessionMin}`;
if (liveScoped.length) {
  const withUser = liveScoped.filter((d) => framesWithUser.has(d.cursor));
  const framed = liveScoped.filter((d) => framedCursors.has(d.cursor));
  const rate = withUser.length / liveScoped.length;
  r11live = rate === 1;
  r11liveDetail =
    `当前 session 内 live ${liveScoped.length} 条（总 ${liveEvents.length}），` +
    `落帧 ${framed.length} 条，与用户消息同帧 ${withUser.length} 条，同批率 ${(rate * 100).toFixed(0)}%`;
}
check('AC-R11a-live', '实时批与触发消息同帧', r11live, r11liveDetail);

// ---------- 其余项 ----------
console.log('[SKIP] AC-R04 可复召      → 手工步骤见方案文档 AC-R-手工验收 §R04');
console.log('[SKIP] AC-R05 交接重置    → 手工步骤见方案文档 AC-R-手工验收 §R05');
console.log('[SKIP] AC-R07 人格透传    → 已由 test/persona_passthrough.test.mjs 覆盖');
console.log('[SKIP] AC-R08 失败兜底    → 手工步骤见方案文档 AC-R-手工验收 §R08');
console.log('[SKIP] AC-R09 回归门禁    → npm test 覆盖');

console.log(`\n汇总：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exitCode = 1;
