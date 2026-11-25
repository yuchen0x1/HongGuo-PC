const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');

function fixture(t, { storeFailure = false, cookieFailure = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-account-logout-ipc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.resolve(__dirname, '../../main.js');
  const localRequire = createRequire(source);
  const handlers = {}, events = [], calls = [], warnings = [];
  const cookieFailures = new Set(Array.isArray(cookieFailure) ? cookieFailure : [cookieFailure]);
  const failure = () => Object.assign(new Error('PRIVATE_ACCOUNT_COOKIE_FIXTURE'), { code: 'ACCOUNT_STORAGE_ERROR' });
  const manager = { setAccountSession() {}, invalidateAccount() { calls.push('invalidate-playback'); } };
  const app = new EventEmitter();
  Object.assign(app, { getVersion: () => 'test', getPath: () => root,
    commandLine: { appendSwitch() {}, hasSwitch: () => true },
    requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) });
  const session = {
    fromPartition: () => ({ clearStorageData: async () => {
      calls.push('clear-account-jar');
      if (cookieFailures.has('account')) throw failure();
    } }),
    defaultSession: { cookies: {
      get: async () => {
        calls.push('read-legacy-jar');
        if (cookieFailures.has('list')) throw failure();
        return [
          { domain: '.hongguoduanju.com', path: '/', name: 'sessionid' },
          { domain: 'login.hongguoduanju.com', path: '/passport/', name: 'sessionid_ss' },
          { domain: 'unrelated.example', path: '/', name: 'unrelated' },
          { domain: 'hongguoduanju.com.unrelated.example', path: '/', name: 'lookalike' },
          { domain: 'not-hongguoduanju.com', path: '/', name: 'suffix-lookalike' },
        ];
      },
      remove: async (url, name) => {
        calls.push({ remove: name, origin: new URL(url).origin });
        if (cookieFailures.has('legacy') && name === 'sessionid') throw failure();
      },
    } },
  };
  const context = vm.createContext({ __dirname: path.dirname(source), process, Buffer, URL, Response, Request, Headers,
    AbortController, AbortSignal, setTimeout, clearTimeout,
    console: { log() {}, error() {}, warn: (...values) => warnings.push(values.join(' ')) },
    require: name => name === 'electron'
      ? { app, session, ipcMain: { handle: (key, handler) => { handlers[key] = handler; } },
        protocol: { registerSchemesAsPrivileged() {} } }
      : name === './src/store' ? { getSettings: () => ({ root }) }
      : name === './src/native/hongguo' ? { ...localRequire(name), getPlaybackManager: () => manager }
      : localRequire(name),
    fixtureService: { logout: async () => {
      calls.push('logout-service');
      if (storeFailure) throw failure();
      return { success: true, signedIn: false, account: null, sessionValidity: 'anonymous' };
    } },
    captureEvent: (channel, data) => events.push({ channel, data }),
  });
  vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
  require('../../scripts/fixtures/trusted-ipc.cjs')(context, handlers);
  vm.runInContext('getAccountService = () => fixtureService; sendToRenderer = captureEvent; getAccountWebSession(); accountResumePositions.set("fixture", { currentTime: 10 });', context);
  return { handlers, calls, events, warnings,
    clearCookies: () => vm.runInContext('clearAccountCookies()', context),
    resumeCount: () => vm.runInContext('accountResumePositions.size', context) };
}

function assertCleanupAttempted(f) {
  assert.equal(f.calls.filter(call => call === 'invalidate-playback').length, 1);
  assert.equal(f.calls.filter(call => call === 'clear-account-jar').length, 1);
  assert.equal(f.calls.filter(call => call === 'read-legacy-jar').length, 1);
  assert.equal(f.resumeCount(), 0);
  assert.deepEqual(f.calls.filter(call => typeof call === 'object'), [
    { remove: 'sessionid', origin: 'https://hongguoduanju.com' },
    { remove: 'sessionid_ss', origin: 'https://login.hongguoduanju.com' },
  ]);
  assert.equal(JSON.stringify(f.events), JSON.stringify([{ channel: 'account-updated', data: { signedIn: false } }]));
  assert.doesNotMatch(JSON.stringify(f.warnings), /PRIVATE_ACCOUNT_COOKIE_FIXTURE/);
}

test('logout IPC preserves a credential-store failure while still clearing browser state and playback association', async t => {
  const f = fixture(t, { storeFailure: true });
  const result = await f.handlers['logout-account']({});
  assert.equal(result.success, false);
  assert.ok(result.error);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ACCOUNT_COOKIE_FIXTURE/);
  assertCleanupAttempted(f);
});

for (const cookieFailure of ['account', 'legacy']) {
  test(`logout IPC reports ${cookieFailure} Cookie cleanup failure and still attempts the remaining cleanup`, async t => {
    const f = fixture(t, { cookieFailure });
    const result = await f.handlers['logout-account']({});
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ACCOUNT_COOKIE_FIXTURE/);
    assertCleanupAttempted(f);
  });
}

test('logout IPC reports success after all cleanup succeeds', async t => {
  const f = fixture(t);
  const result = await f.handlers['logout-account']({});
  assert.equal(result.success, true);
  assert.equal(result.signedIn, false);
  assertCleanupAttempted(f);
});

test('Cookie cleanup aggregates independent failures without exposing original exceptions', async t => {
  const f = fixture(t, { cookieFailure: ['account', 'legacy'] });
  await assert.rejects(f.clearCookies(), error => {
    assert.equal(error.code, 'ACCOUNT_STORAGE_ERROR');
    assert.equal(error.failedOperations, 2);
    assert.doesNotMatch(error.message + JSON.stringify(error), /PRIVATE_ACCOUNT_COOKIE_FIXTURE/);
    return true;
  });
  assert.equal(f.calls.filter(call => typeof call === 'object').length, 2, 'each official Cookie must still be attempted');
});

test('a failed legacy Cookie listing cannot skip account-session cleanup', async t => {
  const f = fixture(t, { cookieFailure: 'list' });
  const result = await f.handlers['logout-account']({});
  assert.equal(result.success, false);
  assert.equal(f.calls.filter(call => call === 'clear-account-jar').length, 1);
  assert.equal(f.calls.filter(call => call === 'read-legacy-jar').length, 1);
  assert.equal(f.calls.filter(call => typeof call === 'object').length, 0);
  assert.equal(f.resumeCount(), 0);
  assert.equal(f.events[0].data.signedIn, false);
});
