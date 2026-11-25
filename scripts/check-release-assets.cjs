const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { version } = require('../package.json');
const { buildMetadata } = require('./write-latest-yml.cjs');
const { verify } = require('./verify-release-assets.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-release-assets-'));
try {
  const name = 'hongguo-downloader-' + version.replace(/\.0$/, '') + '-win-x64-setup.exe';
  const installer = path.join(dir, name);
  const manifest = path.join(dir, 'latest.yml');
  const bytes = Buffer.from('installer test fixture');
  const date = '2026-11-18T00:00:00.000Z';
  fs.writeFileSync(installer, bytes);
  const metadata = buildMetadata(installer, date);
  fs.writeFileSync(manifest, metadata);
  const receipt = {
    version, passed: true, crossVersionUpgradeTested: true,
    sameVersionAccountRetentionTested: true, accountUpgradeRetentionTested: true, accountUninstallTested: true,
    installer: { name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
  };

  assert.deepEqual(verify(dir, receipt).map(asset => asset.name), [name, 'latest.yml']);
  assert.throws(() => verify(dir, { ...receipt, passed: false }));
  assert.throws(() => verify(dir, { ...receipt, crossVersionUpgradeTested: false }));
  for (const [flag, message] of [
    ['sameVersionAccountRetentionTested', /Same-version account retention must pass/],
    ['accountUpgradeRetentionTested', /Account upgrade retention must pass/],
    ['accountUninstallTested', /Account uninstall cleanup must pass/],
  ]) {
    assert.throws(() => verify(dir, { ...receipt, [flag]: false }), message);
    const missing = { ...receipt };
    delete missing[flag];
    assert.throws(() => verify(dir, missing), message);
  }
  fs.writeFileSync(manifest, metadata.replace('  - url: ', '  - url: untested-'));
  assert.throws(() => verify(dir, receipt), /does not match/);
  fs.writeFileSync(manifest, metadata);
  fs.writeFileSync(installer, Buffer.alloc(bytes.length, 1));
  assert.throws(() => verify(dir, receipt), /must match the install-test receipt/);
  fs.writeFileSync(path.join(dir, 'unexpected.zip'), '');
  assert.throws(() => verify(dir, receipt), /Expected one Windows installer/);
  console.log('PASS release assets require successful account retention and uninstall checks, the exact tested binary, canonical SHA-512 metadata and two-file asset set');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
