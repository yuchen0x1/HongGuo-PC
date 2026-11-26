// Isolated NSIS payload check: installs a built setup into a fresh temporary
// directory and compares the installed files with dist/win-unpacked.
// Usage: node scripts/check-installer-payload.cjs [setup.exe]
// Never runs the uninstaller, so account data and the saved library stay intact.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const STAGED = path.join(ROOT, 'dist', 'win-unpacked');
const productName = require('../package.json').build.productName;
const setup = path.resolve(process.argv[2] || path.join(ROOT, 'dist',
  `hongguo-downloader-${require('../package.json').version.replace(/\.0$/, '')}-win-x64-setup.exe`));
const checks = [
  `${productName}.exe`,
  path.join('resources', 'app.asar'),
  path.join('resources', 'bin', 'ffmpeg.exe'),
  path.join('resources', 'bin', 'ffprobe.exe'),
];
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const target = fs.mkdtempSync(path.join(ROOT, '.local', 'analysis', 'installer-payload-'));
const failure = message => Object.assign(new Error(message), { payload: true });

// CI and source-only checkouts never build the installer; the gate still runs on
// any machine that has a local build to verify.
if (!fs.existsSync(setup) || !fs.existsSync(STAGED)) {
  fs.rmSync(target, { recursive: true, force: true });
  console.log('SKIP installer payload: no local installer build to verify');
  process.exit(0);
}

try {
  const installed = spawnSync(setup, ['/S', `/D=${target}`], { cwd: target, timeout: 300000, encoding: 'utf8' });
  assert.equal(installed.error, undefined, `The installer failed to start: ${installed.error?.message || ''}`);
  assert.equal(installed.status, 0, `The installer exited with ${installed.status}`);

  // The assisted installer may use /D verbatim or add its own app folder.
  const findRoot = directory => {
    if (fs.existsSync(path.join(directory, `${productName}.exe`))) return directory;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      if (fs.existsSync(path.join(child, `${productName}.exe`))) return child;
    }
    return null;
  };
  const installedRoot = findRoot(target);
  if (!installedRoot) throw failure(`The installer did not write ${productName}.exe under ${target}`);

  const results = [];
  for (const relative of checks) {
    const stagedFile = path.join(STAGED, relative);
    const installedFile = path.join(installedRoot, relative);
    assert.ok(fs.existsSync(stagedFile), `Staged file is missing: ${relative}`);
    if (!fs.existsSync(installedFile)) throw failure(`The installer did not write ${relative}`);
    const stagedSize = fs.statSync(stagedFile).size;
    const installedSize = fs.statSync(installedFile).size;
    if (stagedSize !== installedSize) {
      throw failure(`${relative} is ${installedSize} bytes after install but ${stagedSize} bytes in the build (truncated payload)`);
    }
    const stagedSha = digest(stagedFile);
    const installedSha = digest(installedFile);
    if (stagedSha !== installedSha) {
      throw failure(`${relative} differs from the build: ${installedSha} after install, ${stagedSha} in the build`);
    }
    if (relative.endsWith('.exe')) {
      const buffer = fs.readFileSync(installedFile);
      const peOffset = buffer.readInt32LE(0x3c);
      assert.equal(buffer.toString('ascii', peOffset, peOffset + 4), 'PE\0\0', `${relative} is not a PE image`);
      assert.equal(buffer.readUInt16LE(peOffset + 4), 0x8664, `${relative} is not an x64 image`);
    }
    results.push({ file: relative, size: installedSize, sha256: installedSha });
  }

  console.log(JSON.stringify({ setup: path.basename(setup), setupSha256: digest(setup), installed: results }, null, 2));
  console.log(`PASS installer payload: ${results.length} files match the build byte for byte`);
} finally {
  fs.rmSync(target, { recursive: true, force: true });
}
