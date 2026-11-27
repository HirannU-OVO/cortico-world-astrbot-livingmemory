/**
 * 构建桥接状态页前端产物：esbuild 打包 client.ts，再复制样式。
 *
 * 优先用 esbuild 的 Node API（`npm i -D esbuild` 之后即可用，跨平台、不需要 spawn 命令行），
 * 没有再回落到 CLI 二进制（可用 ESBUILD_PATH 指定，或宿主 Electron 自带的那份）。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, 'src/webui/client.ts');
const outfile = join(root, 'dist/webui.js');

mkdirSync(join(root, 'dist'), { recursive: true });

async function viaApi() {
  const { build } = await import('esbuild');
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile,
    loader: { '.css': 'css' },
  });
}

function viaCli() {
  const esbuild =
    process.env.ESBUILD_PATH ||
    [
      join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild'),
      join(root, '..', '..', '..', '..', 'resources', 'app', 'node_modules', '@esbuild', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'esbuild.exe' : 'esbuild'),
    ].find((p) => existsSync(p)) ||
    '';
  if (!esbuild || !existsSync(esbuild)) return false;
  execFileSync(esbuild, [entry, '--bundle', '--format=esm', '--platform=browser', '--target=es2022', `--outfile=${outfile}`, '--loader:.css=css'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return true;
}

try {
  await viaApi();
} catch {
  if (!viaCli()) {
    console.error('找不到 esbuild：请先 `npm i -D esbuild`，或用 ESBUILD_PATH 指定 esbuild 可执行文件。');
    process.exit(2);
  }
}

copyFileSync(join(root, 'src/webui/style.css'), join(root, 'dist/webui.css'));
console.log('前端产物已生成：dist/webui.js, dist/webui.css');
