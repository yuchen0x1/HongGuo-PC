// Compile and execute the real NSIS hook with an inert fixture helper in temp dirs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { NsisScriptGenerator } = require('app-builder-lib/out/targets/nsis/nsisScriptGenerator');
assert.equal(process.platform, 'win32');
const ROOT = path.resolve(__dirname, '..');
function flag(name) {
  const index = process.argv.indexOf(name);
  assert.ok(index >= 0 && process.argv[index + 1], `${name} is required.`);
  return path.resolve(process.argv[index + 1]);
}
const compiler = flag('--makensis');
const plugins = flag('--plugins');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-account-hook-'));
const evidence = { passed: false, fixtureOnly: true, installedApplicationAccessed: false, checks: [] };
try {
  const generated = new NsisScriptGenerator();
  generated.flags(['updated']);
  const flagsFile = path.join(directory, 'flags.nsh');
  fs.writeFileSync(flagsFile, generated.build());
  const fixtureExe = path.join(directory, 'fixture-harness.exe');
  const nsisInclude = path.dirname(require.resolve('app-builder-lib/templates/nsis/include/StdUtils.nsh'));
  const compile = spawnSync(compiler, ['/V2', `/DFIXTURE_FLAGS=${flagsFile}`, `/DACCOUNT_HOOK=${path.join(ROOT, 'build/account-uninstall.nsh')}`,
    `/DFIXTURE_EXE=${fixtureExe}`, `/X!addincludedir "${nsisInclude}"`, `/X!addplugindir /x86-unicode "${plugins}"`,
    path.join(ROOT, 'scripts/fixtures/account-uninstall-hook.nsi')], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (compile.status !== 0) process.stderr.write(compile.stdout + compile.stderr);
  assert.equal(compile.status, 0, 'The actual NSIS hook must compile.');
  for (const name of ['update', 'uninstall', 'helper-failure', 'launch-failure']) {
    const target = path.join(directory, name);
    fs.mkdirSync(target);
    fs.copyFileSync(fixtureExe, path.join(target, 'fixture-harness.exe'));
    if (name !== 'launch-failure') fs.copyFileSync(fixtureExe, path.join(target, 'fixture-helper.exe'));
    fs.writeFileSync(path.join(target, 'account-session.bin'), 'synthetic-encrypted-account');
    fs.writeFileSync(path.join(target, 'data.json'), 'settings-keep');
    fs.writeFileSync(path.join(target, 'download.mp4'), 'download-keep');
    if (name === 'helper-failure' || name === 'update') fs.writeFileSync(path.join(target, 'helper-fails'), 'fail');
    const args = ['/S'];
    if (name === 'update') args.push('--updated');
    const result = spawnSync(path.join(target, 'fixture-harness.exe'), args, { timeout: 15000, windowsHide: true });
    const success = name === 'update' || name === 'uninstall';
    assert.equal(result.status, success ? 0 : 1, `${name} must produce the correct status.`);
    assert.equal(fs.existsSync(path.join(target, 'cleanup-called')), name === 'uninstall' || name === 'helper-failure');
    assert.equal(fs.existsSync(path.join(target, 'uninstall-continued')), success);
    assert.equal(fs.existsSync(path.join(target, 'account-session.bin')), name !== 'uninstall');
    assert.equal(fs.readFileSync(path.join(target, 'data.json'), 'utf8'), 'settings-keep');
    assert.equal(fs.readFileSync(path.join(target, 'download.mp4'), 'utf8'), 'download-keep');
    evidence.checks.push({ scenario: name, passed: true });
  }
  evidence.passed = true;
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'dist/account-uninstall-hook.json'), JSON.stringify(evidence, null, 2));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('hongguo-account-hook-'));
  fs.rmSync(directory, { recursive: true, force: true });
}
