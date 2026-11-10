/**
 * 写出 Windows 更新元数据 latest.yml，内容严格对应给定安装包的字节。
 *
 * 为什么必须随 Release 发布：
 *   v6.2–v6.6 的安装版内置 electron-updater。它下载更新前会先取 Release 里的
 *   latest.yml（通道文件）来获得安装包文件名、大小与 SHA512；缺少该文件时
 *   6.6 等旧版客户端点「下载更新」会直接得到 ERR_UPDATER_CHANNEL_FILE_NOT_FOUND。
 *
 * 用法：node scripts/write-latest-yml.cjs <安装包路径> [输出目录]
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');

function buildMetadata(installerPath, releaseDate) {
  const bytes = fs.readFileSync(installerPath);
  if (!bytes.length) throw new Error(`安装包为空：${installerPath}`);
  const name = path.basename(installerPath);
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  return [
    `version: ${pkg.version}`,
    'files:',
    `  - url: ${name}`,
    `    sha512: ${sha512}`,
    `    size: ${bytes.length}`,
    `path: ${name}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date(releaseDate).toISOString()}'`,
    '',
  ].join('\n');
}

function main() {
  const installer = process.argv[2];
  if (!installer) throw new Error('用法：node scripts/write-latest-yml.cjs <安装包路径> [输出目录]');
  const source = path.resolve(installer);
  if (!fs.existsSync(source)) throw new Error(`未找到安装包：${source}`);
  const outDir = path.resolve(process.argv[3] || path.dirname(source));
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, 'latest.yml');
  fs.writeFileSync(target, buildMetadata(source, fs.statSync(source).mtimeMs));
  console.log(`已写出更新元数据 → ${target}`);
}

module.exports = { buildMetadata };

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}