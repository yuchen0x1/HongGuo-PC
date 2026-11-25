const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const pkg = require('../../package.json');
const { cleanupAccountProfiles, runAccountUninstall } = require('./account-uninstall');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'build/account-uninstall.nsh'), 'utf8');
const nsisRoot = path.dirname(require.resolve('app-builder-lib/templates/nsis/uninstaller.nsh'));

test('installer calls the packaged account-only helper without deleting all app data', () => {
  assert.equal(pkg.build.nsis.include, 'build/account-uninstall.nsh');
  assert.notEqual(pkg.build.nsis.deleteAppDataOnUninstall, true);
  assert.equal(pkg.name, 'hongguo-downloader');
  assert.match(source, /!macro customUnInstall\s/);
  assert.match(source, /ExecWait '"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" --uninstall-account-data' \$hgAccountUninstallResult/);
  assert.doesNotMatch(source, /\bRMDir\b|\bDelete\b|\bDeleteRegKey\b/i);
  assert.doesNotMatch(source, /data\.json|danmaku-client\.json|downloads|nas/i);
  const definitions = fs.readFileSync(path.join(nsisRoot, 'common.nsh'), 'utf8');
  assert.match(definitions, /!define APP_EXECUTABLE_FILENAME "\$\{PRODUCT_FILENAME\}\.exe"/);
});

test('update flags bypass account cleanup before the actual NSIS template removes installed files', () => {
  const hook = source.slice(source.indexOf('!macro customUnInstall'));
  assert.ok(hook.indexOf('${IfNot} ${isUpdated}') < hook.indexOf('ExecWait'));
  const install = fs.readFileSync(path.join(nsisRoot, 'include/installUtil.nsh'), 'utf8');
  assert.match(install, /StrCpy \$0 "\$0 --updated"/);
  const uninstall = fs.readFileSync(path.join(nsisRoot, 'uninstaller.nsh'), 'utf8');
  assert.ok(uninstall.indexOf('!insertmacro customUnInstall') < uninstall.indexOf('RMDir /r $INSTDIR'));
  assert.match(source, /\$hgAccountUninstallResult != "0"[\s\S]*?SetErrorLevel 1\s+Abort/);
  assert.match(source, /\$\{If\} \$\{Errors\}\s+StrCpy \$hgAccountUninstallResult "1"/);
});

test('the packaged entry isolates uninstall mode and still loads the complete normal main', () => {
  assert.equal(pkg.main, 'src/native/app-entry.cjs');
  assert.ok(pkg.build.files.includes('src/native/**/*'));
  assert.ok(pkg.build.files.includes('main.js'));
  const entry = fs.readFileSync(path.join(root, pkg.main), 'utf8');
  for (const uninstall of [false, true]) {
    const calls = [];
    vm.runInNewContext(entry, { require: name => {
      calls.push(name);
      if (name === 'electron') return { app: { commandLine: { hasSwitch: switchName => {
        assert.equal(switchName, 'uninstall-account-data');
        return uninstall;
      } } } };
      if (name === './account-uninstall') return { runAccountUninstall: () => calls.push('cleanup') };
      assert.equal(name, '../../main.js');
      return {};
    } });
    assert.deepEqual(calls, uninstall ? ['electron', './account-uninstall', 'cleanup'] : ['electron', '../../main.js']);
  }
});

function fixture(t, { failure = '', failedProfile = 'hongguo-downloader' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-uninstall-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = [], jars = new Map();
  for (const name of ['hongguo-downloader', '红果短剧', 'unrelated-app']) {
    const profile = path.join(directory, name);
    fs.mkdirSync(profile);
    for (const filename of ['account-session.bin', 'account-session.bin.tmp', 'account-session.bin.revoked', 'data.json', 'video.mp4']) {
      fs.writeFileSync(path.join(profile, filename), `synthetic-${filename}`);
    }
    jars.set(profile, [
      { domain: '.hongguoduanju.com', name: 'fixture', path: '/' },
      { domain: 'login.hongguoduanju.com', name: 'fixture', path: '/passport/' },
      { domain: '.unrelated.example', name: 'fixture', path: '/' },
      { domain: 'hongguoduanju.com.unrelated.example', name: 'fixture', path: '/' },
      { domain: 'not-hongguoduanju.com', name: 'fixture', path: '/' },
    ]);
  }
  const privateFailure = () => new Error('PRIVATE_COOKIE_FIXTURE_ERROR');
  const app = { getPath: name => { assert.equal(name, 'appData'); return directory; } };
  const session = { fromPath: profile => {
    calls.push({ profile });
    if (failure === 'open' && path.basename(profile) === failedProfile) throw privateFailure();
    let listings = 0;
    return { cookies: {
      get: async () => {
        listings++;
        if (path.basename(profile) === failedProfile && (failure === 'list' || (failure === 'verify' && listings > 1))) throw privateFailure();
        return jars.get(profile);
      },
      remove: async (url, name) => {
        calls.push({ remove: url, name });
        if (failure === 'remove' && path.basename(profile) === failedProfile && new URL(url).hostname === 'hongguoduanju.com') throw privateFailure();
        if (failure === 'retained' && path.basename(profile) === failedProfile) return;
        jars.set(profile, jars.get(profile).filter(cookie =>
          !(cookie.domain.replace(/^\./, '') === new URL(url).hostname && cookie.path === new URL(url).pathname && cookie.name === name)));
      },
      flushStore: async () => {
        calls.push({ flush: profile });
        if (failure === 'flush' && path.basename(profile) === failedProfile) throw privateFailure();
      },
    } };
  } };
  const fsImpl = Object.create(fs);
  fsImpl.unlinkSync = filename => {
    if (failure === 'unlink' && path.basename(path.dirname(filename)) === failedProfile && path.basename(filename) === 'account-session.bin') throw privateFailure();
    fs.unlinkSync(filename);
  };
  return { directory, calls, jars, app, session, fsImpl,
    run: () => cleanupAccountProfiles({ app, session, fsImpl }) };
}

test('account cleanup removes both fixed profiles, persists Cookie changes, and preserves unrelated data', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.run(), { profilesProcessed: 2, officialCookiesRemoved: 4 });
  for (const name of ['hongguo-downloader', '红果短剧']) {
    const profile = path.join(f.directory, name);
    assert.deepEqual(fs.readdirSync(profile).sort(), ['data.json', 'video.mp4']);
    assert.equal(fs.readFileSync(path.join(profile, 'data.json'), 'utf8'), 'synthetic-data.json');
    assert.equal(f.jars.get(profile).length, 3);
    assert.ok(f.calls.some(call => call.flush === profile));
  }
  assert.equal(fs.readdirSync(path.join(f.directory, 'unrelated-app')).length, 5);
  assert.equal(f.jars.get(path.join(f.directory, 'unrelated-app')).length, 5);
});

for (const failure of ['open', 'list', 'remove', 'verify', 'retained', 'flush', 'unlink']) {
  test(`${failure} failure is reported, revocation remains, and the other profile still clears`, async t => {
    const f = fixture(t, { failure });
    await assert.rejects(f.run(), error => {
      assert.equal(error.code, 'ACCOUNT_STORAGE_ERROR');
      assert.doesNotMatch(error.message + JSON.stringify(error), /PRIVATE_COOKIE_FIXTURE_ERROR/);
      return true;
    });
    const failed = path.join(f.directory, 'hongguo-downloader');
    assert.ok(fs.existsSync(path.join(failed, 'account-session.bin.revoked')));
    assert.equal(fs.existsSync(path.join(failed, 'account-session.bin.tmp')), false);
    assert.equal(fs.existsSync(path.join(failed, 'account-session.bin')), failure === 'unlink');
    assert.deepEqual(fs.readdirSync(path.join(f.directory, '红果短剧')).sort(), ['data.json', 'video.mp4']);
    assert.ok(fs.existsSync(path.join(failed, 'data.json')));
  });
}

test('missing app profiles do not get created or cause unrelated profiles to be read', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-uninstall-absent-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'unrelated-app'));
  const result = await cleanupAccountProfiles({ app: { getPath: () => directory },
    session: { fromPath: () => assert.fail('must not open any session') } });
  assert.deepEqual(result, { profilesProcessed: 0, officialCookiesRemoved: 0 });
  assert.deepEqual(fs.readdirSync(directory), ['unrelated-app']);
});

test('uninstall refuses concurrent applications and arbitrary user-data-dir overrides before accessing data', () => {
  for (const overridden of [false, true]) {
    const exits = [];
    runAccountUninstall({ app: { commandLine: { hasSwitch: () => overridden },
      requestSingleInstanceLock: () => false, exit: code => exits.push(code) } });
    assert.deepEqual(exits, [1]);
  }
});
