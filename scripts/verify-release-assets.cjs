const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { buildMetadata } = require('./write-latest-yml.cjs');
const { version } = require('../package.json');

function verify(dir, receipt) {
  const installer = `hongguo-downloader-${version.replace(/\.0$/, '')}-win-x64-setup.exe`;
  const manifest = 'latest.yml';
  assert.deepEqual(fs.readdirSync(dir).sort(), [installer, manifest], 'Expected one Windows installer and latest.yml');
  const assets = [installer, manifest].map(name => {
    const file = path.join(dir, name);
    assert(fs.lstatSync(file).isFile(), `${name} must be a regular file`);
    const bytes = fs.readFileSync(file);
    return { name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  assert.equal(receipt.version, version);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.crossVersionUpgradeTested, true);
  assert.equal(receipt.sameVersionAccountRetentionTested, true, 'Same-version account retention must pass');
  assert.equal(receipt.accountUpgradeRetentionTested, true, 'Account upgrade retention must pass');
  assert.equal(receipt.accountUninstallTested, true, 'Account uninstall cleanup must pass');
  assert.deepEqual(receipt.installer, assets[0], 'The exact candidate installer must match the install-test receipt');
  const metadata = fs.readFileSync(path.join(dir, manifest), 'utf8');
  const date = /^releaseDate: '([^']+)'$/m.exec(metadata)?.[1];
  assert(date, 'Missing release date');
  assert.equal(metadata, buildMetadata(path.join(dir, installer), date), 'latest.yml does not match the tested EXE');
  return assets;
}

if (require.main === module) {
  const [, , directory, receiptPath] = process.argv;
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  console.log(JSON.stringify(verify(directory, receipt), null, 2));
}

module.exports = { verify };
