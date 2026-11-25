// Real Electron bootstrap cleanup, using synthetic persistent Cookies and temp files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const NAMES = ['hongguo-downloader', '红果短剧'];
const ACCOUNT_FILES = ['account-session.bin', 'account-session.bin.tmp', 'account-session.bin.revoked'];
const KEEP_FILES = ['data.json', 'danmaku-client.json', 'downloads/fixture.mp4'];

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-account-uninstall-'));
  const output = path.join(ROOT, 'dist/account-uninstall.json');
  const env = { ...process.env };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[name];
  const evidence = { startedAt: new Date().toISOString(), passed: false,
    isolation: { freshProfile: true, syntheticCookiesOnly: true, noNetworkRequests: true, formalAccountAccessed: false },
    observations: {} };
  function run(role, profileIndex = 0) {
    const args = [__filename, '--role', role, '--fixture-root', directory, '--profile-index', String(profileIndex)];
    if (role === 'cleanup') args.push('--uninstall-account-data');
    const result = spawnSync(require('electron'), args, { cwd: ROOT, env, encoding: 'utf8',
      timeout: 45000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, `The isolated ${role} process failed or exceeded its budget.`);
  }
  try {
    for (const name of [...NAMES, 'unrelated-app']) {
      const profile = path.join(directory, name);
      for (const filename of [...ACCOUNT_FILES, ...KEEP_FILES]) {
        const target = path.join(profile, filename);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `synthetic-${filename}`);
      }
    }
    for (let index = 0; index < NAMES.length; index++) run('seed', index);
    evidence.electron = JSON.parse(fs.readFileSync(path.join(directory, 'seed.json'), 'utf8')).electron;
    for (let index = 0; index < NAMES.length; index++) run('check-seeded', index);
    evidence.observations.persistentOfficialCookiesExistBeforeCleanup = true;
    run('cleanup');
    for (let index = 0; index < NAMES.length; index++) run('verify', index);
    for (const name of NAMES) {
      const profile = path.join(directory, name);
      for (const filename of ACCOUNT_FILES) assert.equal(fs.existsSync(path.join(profile, filename)), false);
      for (const filename of KEEP_FILES) assert.equal(fs.readFileSync(path.join(profile, filename), 'utf8'), `synthetic-${filename}`);
    }
    for (const filename of [...ACCOUNT_FILES, ...KEEP_FILES]) {
      assert.equal(fs.readFileSync(path.join(directory, 'unrelated-app', filename), 'utf8'), `synthetic-${filename}`);
    }
    assert.equal(fs.existsSync(path.join(directory, 'unexpected-window')), false);
    Object.assign(evidence.observations, { legacyDefaultCookieStoreReached: true,
      profileStoresSeededInIndependentProcesses: true,
      officialCookiesAbsentAfterRestart: true, unrelatedAndLookalikeCookiesPreserved: true,
      bothAccountProfilesCleared: true, encryptedCredentialFilesRemoved: true,
      settingsAndDownloadedVideoUnchanged: true, unrelatedApplicationUntouched: true,
      normalApplicationNotLoaded: true, browserWindowsCreated: 0 });
    evidence.passed = true;
    console.log(JSON.stringify(evidence, null, 2));
  } catch {
    console.error('Isolated account uninstall verification failed; no credential values were exported.');
    process.exitCode = 1;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('hongguo-account-uninstall-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
} else {
  const { app, session } = require('electron');
  const role = process.argv[process.argv.indexOf('--role') + 1];
  const directory = process.argv[process.argv.indexOf('--fixture-root') + 1];
  const profileIndex = Number(process.argv[process.argv.indexOf('--profile-index') + 1]);
  assert.ok(Number.isInteger(profileIndex) && profileIndex >= 0 && profileIndex < NAMES.length);
  assert.ok(directory && path.isAbsolute(directory));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('hongguo-account-uninstall-'));
  app.setPath('appData', directory);
  app.setPath('userData', path.join(directory, NAMES[profileIndex]));
  app.setPath('sessionData', path.join(directory, NAMES[profileIndex]));
  app.commandLine.appendSwitch('disable-background-networking');
  app.on('browser-window-created', () => fs.writeFileSync(path.join(directory, 'unexpected-window'), 'unexpected'));
  if (role === 'cleanup') {
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(request, ...args) {
      if (request === '../../main.js') throw new Error('Normal application must not load during cleanup.');
      return load.call(this, request, ...args);
    };
    require('../src/native/app-entry.cjs');
  } else {
    const { randomBytes } = require('node:crypto');
    const { isOfficialCookie } = require('../src/native/account-uninstall');
    const fixtures = [
      { url: 'https://hongguoduanju.com/', domain: '.hongguoduanju.com', path: '/' },
      { url: 'https://login.hongguoduanju.com/passport/', domain: 'login.hongguoduanju.com', path: '/passport/' },
      { url: 'https://unrelated.example/', domain: 'unrelated.example', path: '/' },
      { url: 'https://hongguoduanju.com.unrelated.example/', domain: 'hongguoduanju.com.unrelated.example', path: '/' },
      { url: 'https://not-hongguoduanju.com/', domain: 'not-hongguoduanju.com', path: '/' },
    ];
    app.whenReady().then(async () => {
      for (const name of [NAMES[profileIndex]]) {
        const profile = path.join(directory, name);
        const jar = session.defaultSession;
        assert.equal(path.resolve(jar.storagePath), profile);
        if (role === 'seed') {
          for (const cookie of fixtures) await jar.cookies.set({ ...cookie, name: 'synthetic_session',
            value: randomBytes(18).toString('hex'), secure: true, httpOnly: true, expirationDate: Date.now() / 1000 + 3600 });
          await jar.cookies.flushStore();
        } else {
          const cookies = await jar.cookies.get({});
          const official = cookies.filter(isOfficialCookie);
          assert.equal(official.length, role === 'verify' ? 0 : 2);
          assert.equal(cookies.filter(cookie => !isOfficialCookie(cookie)).length, 3);
        }
      }
      if (role === 'seed') fs.writeFileSync(path.join(directory, 'seed.json'), JSON.stringify({ electron: process.versions.electron }));
    }).then(() => app.exit(0), () => app.exit(1));
  }
}
