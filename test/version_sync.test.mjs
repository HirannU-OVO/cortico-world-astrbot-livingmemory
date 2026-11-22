/**
 * 版本号一致性：src/version.ts 的 EXTENSION_VERSION 必须等于 package.json 的 version。
 * 状态面板那行「插件版本：桌宠直连 v…」读的就是它，写死忘了改会让用户看到旧版本号（0.2.5 发布时踩过）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { EXTENSION_VERSION } = await import('../src/version.ts');

assert.equal(
  EXTENSION_VERSION,
  pkg.version,
  `src/version.ts 的 EXTENSION_VERSION(${EXTENSION_VERSION}) 与 package.json 的 version(${pkg.version}) 不一致`,
);
console.log('✓ 面板显示的版本号与 package.json 一致');
