const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  createAccountService, secureSessionStore, parseQr, parseHistory, safeMessage, CookieJar,
} = require('./account-session');
const { preserveLargeJsonIntegers } = require('./app-source');

function webPayload(data) {
  return { status: 200, headers: {}, data: JSON.stringify({ message: 'success', data }) };
}

function fakeEncryption() {
  const key = Buffer.from('hongguo-account-fixture');
  const transform = value => Buffer.from(value).map((byte, index) => byte ^ key[index % key.length]);
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => transform(Buffer.from(value, 'utf8')),
    decryptString: value => transform(value).toString('utf8'),
  };
}

test('account history parser keeps current APP rows with display metadata', () => {
  const rows = parseHistory({
    message: 'SUCCESS',
    data: { data_list: [
      { book_id: '1001', book_id_str: '1001', book_name: '春日来信', thumb_url: 'https://p9-reading-sign.fqnovelpic.com/novel-pic/cover~tplv-shrink:1200:0.heic?x=1', vid: '9001', vid_index: 3, current_play_position: 45000, duration: 90000, episode_cnt: 24, read_timestamp_ms: 1700000000000 },
      { book_id: '1002', book_name: '旧剧', vid: '9002', vid_index: 1, read_timestamp_ms: 1800000000000 },
      { book_id: 'bad', vid: '9003' },
      { book_id: '1003', book_name: '已删除', vid: '9004', is_delete: true },
    ] },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].series_id, '1002');
  assert.equal(rows[1].currentTime, 45);
  assert.equal(rows.find(row => row.series_id === '1001').series_title, '春日来信');
  assert.equal(rows.find(row => row.series_id === '1001').total, 24);
  assert.equal(rows.find(row => row.series_id === '1001').cover, 'https://p3-novel.byteimg.com/novel-pic/cover~tplv-shrink:320:0.webp');
});

test('large account episode IDs stay exact strings', () => {
  const raw = '{"vid":7390123456789012345,"other":7390123456789012345}';
  const preserved = preserveLargeJsonIntegers(raw, ['vid']);
  assert.equal(JSON.parse(preserved).vid, '7390123456789012345');
  assert.equal(typeof JSON.parse(preserved).other, 'number');
});

test('QR payload accepts server image data without exposing cookies', () => {
  const qr = parseQr({ message: 'success', data: { token: 'fixture-token', qrcode: '[image omitted]', expire_time: 180 } });
  assert.equal(qr.token, 'fixture-token');
  assert.match(qr.image, /^data:image\/png;base64,/);
  assert.equal(qr.expiresIn, 180);
});

test('encrypted session store never writes the raw cookie', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-account-store-'));
  const file = path.join(root, 'account-session.bin');
  try {
    const store = secureSessionStore({ filePath: file, safeStorage: fakeEncryption() });
    const session = { cookie: 'sessionid=private-fixture', deviceId: '1', installId: '2', cdid: '00000000-0000-4000-8000-000000000003' };
    store.save(session);
    assert.ok(!fs.readFileSync(file, 'utf8').includes('private-fixture'));
    assert.deepEqual(store.load(), session);
    store.clear();
    assert.equal(fs.existsSync(file), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('restore returns a cached profile before background session verification finishes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-account-cache-'));
  const file = path.join(root, 'account-session.bin');
  const encryption = fakeEncryption();
  let verificationFinished = false;
  try {
    secureSessionStore({ filePath: file, safeStorage: encryption }).save({
      cookie: 'sessionid=private-fixture',
      deviceId: '7000000000000000001',
      installId: '7000000000000000002',
      cdid: '00000000-0000-4000-8000-000000000003',
      profile: { id: '42', nickname: '缓存账号' },
    });
    const service = createAccountService({
      filePath: file, safeStorage: encryption,
      webRequest: async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        verificationFinished = true;
        throw new Error('temporary network failure');
      },
    });
    const status = await service.status();
    assert.equal(status.signedIn, true);
    assert.equal(status.account.nickname, '缓存账号');
    assert.equal(status.sessionValidity, 'unverified');
    assert.equal(status.playbackAuthorization, 'unverified');
    assert.equal(verificationFinished, false);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(verificationFinished, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('website QR flow verifies account, loads APP history and keeps credentials out of renderer data', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-account-flow-'));
  const file = path.join(root, 'account-session.bin');
  const webCalls = [];
    let activeVerificationCalls = 0;
    let maxActiveVerificationCalls = 0;
  try {
    const webRequest = async (url, options) => {
      webCalls.push({ url, cookie: options.headers.Cookie || '' });
      if (url.includes('/passport/web/get_qrcode/')) {
        return { status: 200, headers: { 'set-cookie': ['passport_csrf_token=csrf-fixture; Path=/; Secure'] }, data: JSON.stringify({
          message: 'SUCCESS', data: { token: 'login-token', qrcode: '[image omitted]', expire_time: 180 },
        }) };
      }
      if (url.includes('/passport/web/check_qrconnect/')) {
        return { status: 200, headers: {}, data: JSON.stringify({
          message: 'SUCCESS', data: { status: '3', redirect_url: '/passport/web/redirect' },
        }) };
      }
      if (url.includes('/passport/web/redirect')) {
        return { status: 200, headers: { 'set-cookie': ['sessionid=private-session; Path=/; Secure'] }, data: 'ok' };
      }
      if (url.includes('/passport/account/info/v2/')) {
        activeVerificationCalls++;
        maxActiveVerificationCalls = Math.max(maxActiveVerificationCalls, activeVerificationCalls);
        await new Promise(resolve => setTimeout(resolve, 60));
        activeVerificationCalls--;
        return { status: 200, headers: {}, data: JSON.stringify({
          message: 'SUCCESS', data: { user_id_str: '42', name: '测试账号' },
        }) };
      }
      throw new Error(`Unexpected website request: ${url}`);
    };
    const accountRequest = async (url, options) => {
      assert.deepEqual(options.preserveLargeIntegerFields, ['vid', 'video_id', 'item_id']);
      if (url.includes('/reading/bookapi/read_history/list/v1/')) return { code: 0, data: { data_list: [
        { book_id: '1001', book_name: '测试短剧', thumb_url: 'https://img.example/test.jpg', vid: '9001', vid_index: 2, current_play_position: 30000, duration: 60000, episode_cnt: 8, read_timestamp_ms: 1700000000000 },
      ] } };
      throw new Error(`Unexpected account request: ${url}`);
    };
    const service = createAccountService({
      filePath: file, safeStorage: fakeEncryption(), webRequest, accountRequest,
      identityRequest: async () => {
        activeVerificationCalls++;
        maxActiveVerificationCalls = Math.max(maxActiveVerificationCalls, activeVerificationCalls);
        await new Promise(resolve => setTimeout(resolve, 60));
        activeVerificationCalls--;
        return { device_id: '7000000000000000001', iid: '7000000000000000002', cdid: '00000000-0000-4000-8000-000000000003' };
      },
    });
    const started = await service.startLogin();
    assert.equal(started.success, true);
    assert.match(started.image, /^data:image\/png;base64,/);
    const signedIn = await service.pollLogin(started.loginId);
    assert.equal(signedIn.status, 'signed-in');
    assert.equal(signedIn.account.nickname, '测试账号');
    assert.ok(!JSON.stringify(signedIn).includes('private-session'));
    const history = await service.history({ refresh: true });
    assert.equal(history.results.length, 1);
    assert.equal(service.row('1001').episode_id, '9001');
    assert.ok(fs.existsSync(file));
    assert.ok(webCalls.some(call => call.cookie.includes('passport_csrf_token=csrf-fixture')));
    assert.ok(webCalls.some(call => call.url.includes('/passport/account/info/v2/') && call.cookie.includes('sessionid=private-session')));
    assert.equal(maxActiveVerificationCalls, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const action of ['cancelLogin', 'logout']) test(`${action} prevents a pending confirmation from saving credentials`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'hg-login-cancel-'));
  let release, entered;
  const gate = new Promise(resolve=>release=resolve), waiting=new Promise(resolve=>entered=resolve);
  const filePath=path.join(root,'session.bin');
  const service=createAccountService({filePath,safeStorage:fakeEncryption(),identityRequest:async()=>({device_id:'1',iid:'2',cdid:'fixture'}),webRequest:async url=>{
    if(url.includes('get_qrcode'))return webPayload({token:'fixture',qrcode:'fixture',expire_time:180});
    if(url.includes('check_qrconnect'))return {...webPayload({status:'3'}),headers:{'set-cookie':['sessionid=fixture; Path=/']}};
    entered();await gate;return webPayload({user_id_str:'42',name:'Fixture'});
  }});
  try {const qr=await service.startLogin();const pending=service.pollLogin(qr.loginId);await waiting;await service[action](qr.loginId);release();assert.equal((await pending).status,'cancelled');assert.equal((await service.status()).signedIn,false);assert.equal(fs.existsSync(filePath),false);}finally{release();fs.rmSync(root,{recursive:true,force:true});}
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function accountFixture(t, overrides = {}, saved = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-session-regression-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'account-session.bin');
  const safeStorage = fakeEncryption();
  const stored = secureSessionStore({ filePath, safeStorage });
  stored.save({ cookie: 'sessionid=private-fixture; passport_csrf_token=private-csrf',
    deviceId: '7000000000000000001', installId: '7000000000000000002',
    cdid: '00000000-0000-4000-8000-000000000003', profile: { id: '42', nickname: '缓存账号' }, ...saved });
  const service = createAccountService({ filePath, safeStorage,
    webRequest: async () => webPayload({ user_id_str: '42', name: '验证账号' }), ...overrides });
  return { service, filePath, stored };
}

test('playback remains anonymous without an account and never requests credentials', async t => {
  const fixture = accountFixture(t, { webRequest: () => assert.fail('anonymous account must not make a request') });
  fixture.stored.clear();
  const context = await fixture.service.getPlaybackContext();
  assert.equal(context.signedIn, false);
  assert.equal(context.sessionValidity, 'anonymous');
  assert.equal(context.authorizationMode, 'anonymous-device');
  assert.equal(context.accountLinked, false);
});

test('encrypted legacy state is verified after restart and associated locally without exposing IDs', async t => {
  let calls = 0;
  const fixture = accountFixture(t, { webRequest: async () => { calls++; return webPayload({ user_id_str: '42', name: '验证账号' }); } });
  const context = await fixture.service.getPlaybackContext();
  assert.equal(context.sessionValidity, 'valid');
  assert.equal(context.accountLinked, true);
  assert.deepEqual(context.deviceAssociation, { status: 'linked', kind: 'local-only', platformVerified: false });
  assert.equal(context.playbackAuthorization, 'unverified');
  const serialized = JSON.stringify(context);
  for (const value of ['private-fixture', 'private-csrf', '7000000000000000001', '00000000-0000-4000-8000-000000000003', '验证账号']) assert.ok(!serialized.includes(value));
  await fixture.service.getPlaybackContext();
  assert.equal(calls, 1);
  assert.equal(fixture.stored.load().schemaVersion, 2);
});

for (const [status, code, validity] of [[401, 'ACCOUNT_EXPIRED', 'expired'], [403, 'ACCOUNT_UNAUTHORIZED', 'invalid']]) {
  test(`HTTP ${status} invalidates the account rather than presenting cached login as verified`, async t => {
    let expired = 0;
    const fixture = accountFixture(t, { webRequest: async () => ({ status, headers: {}, data: '' }), onAccountExpired: () => expired++ });
    const result = await fixture.service.checkSession();
    assert.equal(result.signedIn, false);
    assert.equal(result.sessionValidity, validity);
    assert.equal(result.lastErrorCode, code);
    assert.equal(expired, 1);
    assert.equal(fs.existsSync(fixture.filePath), false);
    assert.equal((await fixture.service.getPlaybackContext()).authorizationMode, 'anonymous-device');
  });
}

test('known Cookie expiry is handled before making an authenticated request', async t => {
  const fixture = accountFixture(t, { webRequest: () => assert.fail('expired Cookie must not be sent') }, {
    cookieMetadata: [{ name: 'sessionid', domain: 'hongguoduanju.com', path: '/', secure: true, expiresAt: Date.now() - 1000 }],
  });
  const result = await fixture.service.checkSession();
  assert.equal(result.sessionValidity, 'expired');
  assert.equal(result.lastErrorCode, 'ACCOUNT_EXPIRED');
  assert.equal(fs.existsSync(fixture.filePath), false);
});

test('explicit official expired-session response clears cached login', async t => {
  const fixture = accountFixture(t, { webRequest: async () => webPayload({ description: '登录已过期，请重新登录' }) });
  const result = await fixture.service.checkSession();
  assert.equal(result.lastErrorCode, 'ACCOUNT_EXPIRED');
  assert.equal(result.signedIn, false);
});

test('a successful response without a real account ID cannot create a signed-in session', async t => {
  const fixture = accountFixture(t, { webRequest: async () => webPayload({ user_id_str: '0' }) });
  const result = await fixture.service.checkSession();
  assert.equal(result.lastErrorCode, 'ACCOUNT_UNAUTHORIZED');
  assert.equal(result.signedIn, false);
});

test('session verification persists server Cookie rotation and expiry only through encrypted storage', async t => {
  const expiry = Date.now() + 3600000;
  const fixture = accountFixture(t, { webRequest: async (_url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Cookie.includes('private-fixture'), true);
    return { ...webPayload({ user_id_str: '42' }), headers: { 'set-cookie': [
      `sessionid=rotated-private; Path=/; Secure; Expires=${new Date(expiry).toUTCString()}`,
      'passport_csrf_token=; Path=/; Max-Age=0',
    ] } };
  } });
  const result = await fixture.service.checkSession();
  assert.equal(result.sessionValidity, 'valid');
  assert.ok(Math.abs(result.expiresAt - expiry) < 1000);
  assert.equal(fixture.stored.load().cookie, 'sessionid=rotated-private');
  assert.ok(!fs.readFileSync(fixture.filePath, 'utf8').includes('rotated-private'));
  assert.ok(!JSON.stringify(result).includes('rotated-private'));
});

test('transient account failure preserves credentials but explicitly marks validity unavailable', async t => {
  let failed = true;
  const fixture = accountFixture(t, { webRequest: async () => {
    if (failed) throw Object.assign(new Error('Cookie: sessionid=never-log-this'), { code: 'ETIMEDOUT' });
    return webPayload({ user_id_str: '42' });
  } });
  const result = await fixture.service.checkSession();
  assert.equal(result.signedIn, true);
  assert.equal(result.sessionValidity, 'unavailable');
  assert.equal(result.lastErrorCode, 'NETWORK_TIMEOUT');
  assert.equal(fs.existsSync(fixture.filePath), true);
  failed = false;
  assert.equal((await fixture.service.refreshSession()).sessionValidity, 'valid');
});

test('rate limiting stops automatic and concurrent forced account retries until the cooldown ends', async t => {
  let calls = 0, clock = Date.now();
  const fixture = accountFixture(t, { now: () => clock, webRequest: async () => { calls++; return { status: 429, headers: {}, data: '' }; } });
  assert.equal((await fixture.service.checkSession()).lastErrorCode, 'API_RATE_LIMITED');
  await Promise.all(Array.from({ length: 8 }, () => fixture.service.refreshSession()));
  assert.equal(calls, 1);
  clock += 60001;
  await fixture.service.checkSession();
  assert.equal(calls, 2);
});

test('concurrent account refresh uses one verification and one Cookie rotation', async t => {
  const entered = deferred(), gate = deferred();
  let calls = 0;
  const fixture = accountFixture(t, { webRequest: async () => { calls++; entered.resolve(); await gate.promise; return webPayload({ user_id_str: '42' }); } });
  const results = Array.from({ length: 12 }, () => fixture.service.refreshSession());
  await entered.promise;
  assert.equal(calls, 1);
  gate.resolve();
  for (const result of await Promise.all(results)) assert.equal(result.sessionValidity, 'valid');
});

test('cancelling one account refresh consumer does not cancel another consumer', async t => {
  const entered = deferred(), gate = deferred(), controller = new AbortController();
  let requestSignal;
  const fixture = accountFixture(t, { webRequest: async (_url, options) => {
    requestSignal = options.signal; entered.resolve(); await gate.promise; return webPayload({ user_id_str: '42' });
  } });
  const cancelled = fixture.service.checkSession({ signal: controller.signal });
  const surviving = fixture.service.checkSession();
  await entered.promise;
  controller.abort();
  await assert.rejects(cancelled, { code: 'ERR_CANCELED' });
  assert.equal(requestSignal.aborted, false);
  gate.resolve();
  assert.equal((await surviving).sessionValidity, 'valid');
});

test('cancelling the last account refresh consumer aborts the transport', async t => {
  const entered = deferred(), gate = deferred(), controller = new AbortController();
  let requestSignal;
  const fixture = accountFixture(t, { webRequest: async (_url, options) => {
    requestSignal = options.signal; entered.resolve(); await gate.promise; return webPayload({ user_id_str: '42' });
  } });
  const pending = fixture.service.checkSession({ signal: controller.signal });
  await entered.promise;
  controller.abort();
  await assert.rejects(pending, { code: 'ERR_CANCELED' });
  assert.equal(requestSignal.aborted, true);
  gate.resolve();
});

test('logout prevents late verification from restoring credentials and permits anonymous playback', async t => {
  const entered = deferred(), gate = deferred();
  const fixture = accountFixture(t, { webRequest: async () => { entered.resolve(); await gate.promise; return webPayload({ user_id_str: '42' }); } });
  const pending = fixture.service.checkSession();
  await entered.promise;
  const loggedOut = await fixture.service.logout();
  assert.equal(loggedOut.signedIn, false);
  gate.resolve();
  assert.equal((await pending).signedIn, false);
  assert.equal(fs.existsSync(fixture.filePath), false);
  assert.equal((await fixture.service.getPlaybackContext()).sessionValidity, 'anonymous');
});

for (const lockedFile of ['credentials', 'temporary']) {
  test(`logout reports ${lockedFile} deletion failure and revoked state cannot restore after restart`, async t => {
    const fixture = accountFixture(t);
    assert.equal((await fixture.service.checkSession()).sessionValidity, 'valid');
    const temporary = `${fixture.filePath}.tmp`;
    const revoked = `${fixture.filePath}.revoked`;
    if (lockedFile === 'temporary') fs.copyFileSync(fixture.filePath, temporary);
    const lockedPath = lockedFile === 'credentials' ? fixture.filePath : temporary;
    const unlink = fs.unlinkSync;
    let blocked = true;
    t.mock.method(fs, 'unlinkSync', function(target, ...args) {
      if (blocked && target === lockedPath) {
        throw Object.assign(new Error('private-fixture must not escape a filesystem failure'), { code: 'EACCES' });
      }
      return unlink.call(this, target, ...args);
    });

    await assert.rejects(fixture.service.logout(), { code: 'ACCOUNT_STORAGE_ERROR' });
    const status = await fixture.service.status();
    assert.equal(status.signedIn, false);
    assert.equal(status.lastErrorCode, 'ACCOUNT_STORAGE_ERROR');
    assert.ok(status.storageWarning);
    assert.doesNotMatch(JSON.stringify(status), /private-fixture/);
    assert.equal(fs.existsSync(lockedPath), true, 'the fixture must retain the file whose deletion failed');
    assert.equal(fs.readFileSync(revoked, 'utf8'), 'revoked\n');
    assert.equal(fixture.stored.load(), null, 'revocation must take precedence over decryption');

    const restarted = createAccountService({ filePath: fixture.filePath, safeStorage: fakeEncryption(),
      webRequest: () => assert.fail('a revoked account must never be verified after restart') });
    const restored = await restarted.checkSession();
    assert.equal(restored.signedIn, false);
    assert.equal(restored.sessionValidity, 'anonymous');
    await assert.rejects(restarted.logout(), { code: 'ACCOUNT_STORAGE_ERROR' });

    blocked = false;
    assert.equal((await restarted.logout()).success, true, 'logout must allow retrying the failed cleanup');
    for (const target of [fixture.filePath, temporary, revoked]) assert.equal(fs.existsSync(target), false);
  });
}

test('a revoked store remains blocked until a new encrypted session is committed', t => {
  const fixture = accountFixture(t);
  const unlink = fs.unlinkSync;
  let blocked = true;
  t.mock.method(fs, 'unlinkSync', function(target, ...args) {
    if (blocked && target === fixture.filePath) throw Object.assign(new Error('locked fixture'), { code: 'EACCES' });
    return unlink.call(this, target, ...args);
  });
  assert.throws(() => fixture.stored.clear(), { code: 'ACCOUNT_STORAGE_ERROR' });
  assert.equal(fixture.stored.load(), null);
  const unavailable = secureSessionStore({ filePath: fixture.filePath, safeStorage: { isEncryptionAvailable: () => false } });
  assert.throws(() => unavailable.save({ cookie: 'sessionid=not-persisted' }), { code: 'ACCOUNT_STORAGE_UNAVAILABLE' });
  assert.equal(fixture.stored.load(), null);

  blocked = false;
  fixture.stored.save({ cookie: 'sessionid=new-private-fixture', profile: { id: '99', nickname: 'replacement' } });
  assert.equal(fs.existsSync(`${fixture.filePath}.revoked`), false);
  assert.equal(fixture.stored.load().cookie, 'sessionid=new-private-fixture');
  assert.doesNotMatch(fs.readFileSync(fixture.filePath, 'utf8'), /new-private-fixture/);
});

test('logout can delete credentials when a revocation marker cannot be created', async t => {
  const fixture = accountFixture(t);
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', function(target, ...args) {
    if (target === `${fixture.filePath}.revoked`) throw Object.assign(new Error('marker denied'), { code: 'EACCES' });
    return open.call(this, target, ...args);
  });
  const result = await fixture.service.logout();
  assert.equal(result.success, true);
  assert.equal(result.signedIn, false);
  assert.equal(fs.existsSync(fixture.filePath), false);
});

test('Cookie scope rejects unrelated domains, malicious headers and expired values', () => {
  const jar = new CookieJar('sessionid=private-fixture');
  jar.absorb({ 'set-cookie': ['sessionid=stolen; Domain=evil.example; Path=/', 'host_only=private-host; Path=/; Secure'] });
  assert.ok(jar.header().includes('sessionid=private-fixture'));
  assert.ok(!jar.header('https://sub.hongguoduanju.com/').includes('host_only'));
  assert.throws(() => jar.header('https://hongguoduanju.com.evil.example/'), { code: 'SECURITY_BLOCKED' });
  assert.throws(() => new CookieJar('sessionid=a\r\nAuthorization: token'), { code: 'ACCOUNT_UNAUTHORIZED' });
  jar.absorb({ 'set-cookie': ['sessionid=deleted; Path=/; Max-Age=0'] });
  assert.equal(jar.hasSession(), false);
});

test('safe account errors never echo Cookie, tokens, account IDs or signed media addresses', () => {
  const message = safeMessage(new Error('sessionid=secret; sid_tt=secret; csrf=secret; CK=secret device_id=7000000000000000001 https://cdn.example/v?sign=secret'));
  assert.equal(message, '账号操作失败，请稍后重试');
  assert.ok(!message.includes('secret'));
});

test('a basic-text safeStorage backend cannot persist credentials', t => {
  const fixture = accountFixture(t);
  const store = secureSessionStore({ filePath: fixture.filePath, safeStorage: { ...fakeEncryption(), getSelectedStorageBackend: () => 'basic_text' } });
  assert.throws(() => store.save({ cookie: 'sessionid=must-stay-private' }), { code: 'ACCOUNT_STORAGE_UNAVAILABLE' });
});

test('official playback authorization probe distinguishes anonymous and authenticated requests without claiming App or full media authorization', async t => {
  const pageCalls = [];
  const fixture = accountFixture(t, { webRequest: async (url, options) => {
    assert.equal(new URL(url).hostname, 'hongguoduanju.com');
    if (url.includes('/passport/')) return webPayload({ user_id_str: '42' });
    pageCalls.push({ cookie: options.headers.Cookie, explicitCookie: options.explicitCookie, credentials: options.credentials });
    const router = { loaderData: { 'player_(series_id)/(vid)/page': { series_id: '1001', vid: '9001',
      seriesDetail: { series_id: '1001' }, protectedPlayback: true, publicVideoSeo: { available: true, itemId: '9001', seriesId: '1001',
        signedUrl: 'https://cdn.example/media?sign=must-not-export' } } } };
    return { status: 200, headers: {}, data: `<script>window._ROUTER_DATA = ${JSON.stringify(router)}</script>` };
  } });
  const result = await fixture.service.probeOfficialPlayback({ seriesId: '1001', vid: '9001' });
  assert.equal(pageCalls.length, 2);
  assert.equal(pageCalls[0].cookie, undefined);
  assert.equal(pageCalls[0].explicitCookie, false);
  assert.equal(pageCalls[1].cookie.includes('private-fixture'), true);
  assert.ok(pageCalls.every(row => row.credentials === 'omit'));
  assert.equal(result.anonymous.identityMatches, true);
  assert.equal(result.authenticated.identityMatches, true);
  assert.equal(result.webCookieAuthorization, 'not-demonstrated');
  assert.equal(result.appCookieAuthorization, 'not-tested');
  assert.equal(result.fullEpisodePlaybackVerified, false);
  assert.ok(!JSON.stringify(result).includes('must-not-export'));
  assert.ok(!JSON.stringify(result).includes('private-fixture'));
});

test('official App authorization probe compares the same signed request while keeping all credentials and models private', async t => {
  const calls = [];
  const body = Buffer.from('same-original-gzip-body');
  const signed = { url: 'https://reading.snssdk.com/novel/player/multi_video_model/preload/v1?device_id=sensitive-device',
    options: { method: 'POST', headers: { 'x-medusa': 'private-signature' }, data: body } };
  const fixture = accountFixture(t, { playbackProbeRequest: async () => signed,
    accountRequest: async (url, options) => {
      calls.push({ url, options });
      if (!options.headers.Cookie) throw Object.assign(new Error('never export this body'), { code: 'EMPTY_RESPONSE', status: 200 });
      return { code: 0, data: { '9001': { video_model: { video_list: { first: { main_url: 'https://cdn.example/media?signature=sensitive' } } } } } };
    } });
  const result = await fixture.service.probeOfficialAppPlayback({ vid: '9001' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
  assert.equal(calls[0].options.data, body);
  assert.equal(calls[1].options.data, body);
  assert.equal(calls[0].options.headers.Cookie, undefined);
  assert.equal(calls[1].options.headers.Cookie.includes('private-fixture'), true);
  assert.equal(calls[0].options.headers['x-medusa'], calls[1].options.headers['x-medusa']);
  assert.ok(calls.every(row => row.options.maxRedirects === 0));
  assert.equal(result.anonymous.errorCode, 'API_EMPTY_RESPONSE');
  assert.equal(result.authenticated.episodeMatches, true);
  assert.equal(result.appCookieAuthorization, 'model-access-changed');
  assert.equal(result.fullEpisodePlaybackVerified, false);
  assert.equal((await fixture.service.getPlaybackContext()).playbackAuthorization, 'unverified');
  for (const value of ['sensitive', 'private-fixture', 'private-signature', 'main_url', 'device_id']) assert.ok(!JSON.stringify(result).includes(value));
});

for (const status of [401, 403, 429]) test(`official App authorization probe stops after HTTP ${status} without replaying credentials`, async t => {
  let calls = 0;
  const fixture = accountFixture(t, {
    playbackProbeRequest: async () => ({ url: 'https://reading.snssdk.com/novel/player/multi_video_model/preload/v1',
      options: { method: 'POST', headers: {}, data: Buffer.from('original-body') } }),
    accountRequest: async () => { calls++; throw Object.assign(new Error('private error'), { status }); },
  });
  const result = await fixture.service.probeOfficialAppPlayback({ vid: '9001' });
  assert.equal(calls, 1);
  assert.deepEqual(result.authenticated, { skipped: 'explicit-rejection' });
  assert.equal(result.appCookieAuthorization, 'not-demonstrated');
});

for (const url of ['https://reading.snssdk.com/unknown', 'https://evil.example/novel/player/multi_video_model/preload/v1',
  'https://reading.snssdk.com.evil.example/novel/player/multi_video_model/preload/v1',
  'https://user:secret@reading.snssdk.com/novel/player/multi_video_model/preload/v1']) {
  test(`official App authorization probe rejects an untrusted target before sending any request: ${new URL(url).hostname}`, async t => {
    const fixture = accountFixture(t, {
      playbackProbeRequest: async () => ({ url, options: { method: 'POST', headers: {}, data: Buffer.from('original-body') } }),
      accountRequest: () => assert.fail('credentials must not leave the official playback allowlist'),
    });
    await assert.rejects(fixture.service.probeOfficialAppPlayback({ vid: '9001' }), { code: 'SECURITY_BLOCKED' });
  });
}

test('logout aborts an in-flight account history request and discards its late result', async t => {
  const entered = deferred(), gate = deferred();
  let requestSignal;
  const fixture = accountFixture(t, { accountRequest: async (_url, _options, _deadline, signal) => {
    requestSignal = signal; entered.resolve(); await gate.promise; return { code: 0, data: { data_list: [] } };
  } });
  const pending = fixture.service.refreshHistory();
  await entered.promise;
  await fixture.service.logout();
  assert.equal(requestSignal.aborted, true);
  await assert.rejects(pending, { code: 'ERR_CANCELED' });
  gate.resolve();
  assert.equal(fixture.service.row('1001'), null);
});

test('successful website login is retained when independent device registration fails and history initializes it later', async t => {
  let registrations = 0;
  const fixture = accountFixture(t, { identityRequest: async () => {
    registrations++;
    if (registrations === 1) throw new Error('temporary registration failure');
    return { device_id: '7000000000000000001', iid: '7000000000000000002', cdid: '00000000-0000-4000-8000-000000000003' };
  }, accountRequest: async () => ({ code: 0, data: { data_list: [] } }) });
  const result = await fixture.service.completeWebLogin('sessionid=new-valid-cookie');
  assert.equal(result.status, 'signed-in');
  assert.equal(result.sessionValidity, 'valid');
  assert.equal(result.deviceAssociation.status, 'unlinked');
  assert.equal((await fixture.service.refreshHistory()).success, true);
  assert.equal(registrations, 2);
  assert.equal((await fixture.service.status()).deviceAssociation.status, 'linked');
});

test('an ephemeral new login cannot restore the previous account after a failed encrypted save', async t => {
  const fixture = accountFixture(t, { identityRequest: async () => ({ device_id: '7000000000000000001', iid: '7000000000000000002', cdid: '00000000-0000-4000-8000-000000000003' }) });
  const encryptionUnavailable = { isEncryptionAvailable: () => false };
  const service = createAccountService({ filePath: fixture.filePath, safeStorage: encryptionUnavailable,
    identityRequest: async () => ({ device_id: '7000000000000000001', iid: '7000000000000000002', cdid: '00000000-0000-4000-8000-000000000003' }),
    webRequest: async () => webPayload({ user_id_str: '99', name: '临时账号' }) });
  const result = await service.completeWebLogin('sessionid=ephemeral-new-cookie');
  assert.equal(result.signedIn, true);
  assert.equal(result.account.id, '99');
  assert.ok(result.storageWarning);
  assert.equal(fs.existsSync(fixture.filePath), false);
});
