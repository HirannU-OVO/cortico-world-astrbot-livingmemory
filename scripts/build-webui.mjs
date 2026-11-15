/**
 * 构建桥接状态页前端产物：esbuild 打包 client.ts，再复制样式。
 * 用 node 脚本包装，避免 npm scripts 对带引号的绝对路径解析不一致。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const esbuild = process.env.ESBUILD_PATH
  || 'D:/Tools/Coopanion/resources/app/node_modules/@esbuild/win32-x64/esbuild.exe';

if (!existsSync(esbuild)) {
  console.error(`找不到 esbuild：${esbuild}\n可用 ESBUILD_PATH 环境变量覆盖。`);
  process.exit(2);
}

mkdirSync(join(root, 'dist'), { recursive: true });
execFileSync(esbuild, [
  join(root, 'src/webui/client.ts'),
  '--bundle',
  '--format=esm',
  '--platform=browser',
  '--target=es2022',
  `--outfile=${join(root, 'dist/webui.js')}`,
  '--loader:.css=css',
], { stdio: 'inherit' });

copyFileSync(join(root, 'src/webui/style.css'), join(root, 'dist/webui.css'));
console.log('前端产物已生成：dist/webui.js, dist/webui.css');
