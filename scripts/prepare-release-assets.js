/**
 * 为 GitHub Release 准备唯一的 Windows 安装包资产。
 * 本地产物可能包含中文字符，复制为 ASCII 文件名后再上传。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version.replace(/^(\d+\.\d+)\.0$/, '$1');
const SLUG = pkg.name;
const setupName = `${SLUG}-${VERSION}-win-x64-setup.exe`;

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const source = path.join(DIST, setupName);
  if (!fs.existsSync(source)) {
    throw new Error(`未找到安装包 ${source}，请先生成 Windows NSIS 安装包`);
  }
  fs.copyFileSync(source, path.join(OUT, setupName));
  console.log(`已准备唯一 Windows Release 资产 → ${path.join(OUT, setupName)}`);
}

try { main(); } catch (e) {
  console.error('失败：' + e.message);
  process.exit(1);
}
