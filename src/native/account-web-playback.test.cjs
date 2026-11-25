const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createAccountService, secureSessionStore } = require('./account-session');
const { OFFICIAL_WEB_PROFILE } = require('./official-web-playback');

const origin = 'https://hongguoduanju.com';
const endpoint = '/api/video/protected/play-info';
const ids = { seriesId: '12345', vid: '67890' };
const privateCookie = 'sessionid=PRIVATE_COOKIE_FIXTURE; passport_csrf_token=PRIVATE_CSRF_FIXTURE';
const privateMedia = 'https://cdn.example/PRIVATE_MEDIA_FIXTURE?signature=PRIVATE_SIGN_FIXTURE';
const response = payload => ({ status: 200, headers: {}, data: JSON.stringify(payload) });
const accepted = () => response({ base_resp: { StatusCode: 0 }, play_info: { main_url: privateMedia,
  aes_key: 'PRIVATE_KEY_FIXTURE', license_url: 'https://license.example/PRIVATE_LICENSE_FIXTURE' },
  device_id: 'PRIVATE_DEVICE_FIXTURE', user_id: 'PRIVATE_ACCOUNT_FIXTURE' });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function encryption() {
  const transform = value => Buffer.from(value).map(byte => byte ^ 0x5a);
  return { isEncryptionAvailable: () => true, encryptString: value => transform(Buffer.from(value)),
    decryptString: value => transform(value).toString('utf8') };
}

function serviceWithProfile(profile) {
  const filename = require.resolve('./account-session');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, Buffer, URL, AbortSignal, AbortController, setTimeout, clearTimeout,
    require: dependency => dependency === './official-web-playback'
      ? { OFFICIAL_WEB_PROFILE: profile } : localRequire(dependency),
  }, { filename });
  return module.exports.createAccountService;
}

function fixture(t, { seeded = true, saved = {}, accountResponse,
  apiResponse = ({ options }) => options.explicitCookie ? accepted() : response({ base_resp: { StatusCode: 1001 } }),
  create = createAccountService } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-web-playback-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'account-session.bin');
  const safeStorage = encryption();
  if (seeded) secureSessionStore({ filePath, safeStorage }).save({ cookie: privateCookie,
    deviceId: 'PRIVATE_DEVICE_FIXTURE', installId: 'PRIVATE_INSTALL_FIXTURE', cdid: 'PRIVATE_CDID_FIXTURE',
    profile: { id: '42', nickname: 'PRIVATE_ACCOUNT_FIXTURE' }, ...saved });
  const calls = [];
  const service = create({ filePath, safeStorage, webRequest: async (url, options) => {
    const request = { url, options };
    calls.push(request);
    assert.equal(new URL(url).origin, origin);
    if (new URL(url).pathname === '/passport/account/info/v2/') {
      return accountResponse || response({ message: 'success', data: { user_id_str: '42', name: 'fixture' } });
    }
    return apiResponse(request);
  } });
  return { service, calls, apiCalls: () => calls.filter(call => new URL(call.url).pathname === endpoint) };
}

test('official web probe sends the verified 720p profile and identical bodies with account authentication first', async t => {
  const f = fixture(t);
  const result = await f.service.probeOfficialWebPlaybackApi(ids);
  const calls = f.apiCalls();
  assert.equal(f.calls.length, 3, 'verify the session once, then perform one bounded comparison');
  assert.equal(calls.length, 2);
  assert.deepEqual(OFFICIAL_WEB_PROFILE.query, { aid: 8662 });
  assert.equal(OFFICIAL_WEB_PROFILE.playInfoDefinition, '720p');
  for (const [index, call] of calls.entries()) {
    const url = new URL(call.url);
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, endpoint);
    assert.deepEqual([...url.searchParams], [['aid', '8662']]);
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.body, JSON.stringify({ series_id: ids.seriesId, item_id: ids.vid, definition: '720p' }));
    assert.equal(call.options.headers['Content-Type'], 'application/json');
    assert.equal(call.options.headers['X-Xs-From-Web'], '1');
    assert.equal(call.options.headers.Origin, origin);
    assert.equal(call.options.headers.Referer, `${origin}/player/${ids.seriesId}/${ids.vid}`);
    assert.equal(call.options.headers['User-Agent'], f.calls[0].options.headers['User-Agent']);
    assert.equal(call.options.explicitCookie, index === 0);
    assert.equal(call.options.headers.Cookie, index === 0 ? privateCookie : undefined);
    assert.deepEqual(Object.keys(call.options.headers).sort(), [
      'Content-Type', 'Origin', 'Referer', 'User-Agent', 'X-Xs-From-Web', ...(index === 0 ? ['Cookie'] : []),
    ].sort());
  }
  assert.equal(result.authenticated.businessAccepted, true);
  assert.equal(result.authenticated.mediaConfigured, true);
  assert.equal(result.authenticated.encryptedPlayerRequired, true);
  assert.equal(result.webCookieAuthorization, 'media-config-access-changed');
  assert.equal(result.fullEpisodePlaybackVerified, false);
  assert.equal((await f.service.getPlaybackContext()).playbackAuthorization, 'unverified');
});

for (const status of [401, 403, 429]) {
  test(`authenticated HTTP ${status} stops without an anonymous retry`, async t => {
    const f = fixture(t, { apiResponse: () => ({ status, headers: {}, data: 'PRIVATE_REJECTION_FIXTURE' }) });
    const result = await f.service.probeOfficialWebPlaybackApi(ids);
    assert.equal(f.apiCalls().length, 1);
    assert.equal(f.apiCalls()[0].options.explicitCookie, true);
    assert.equal(result.authenticated.status, status);
    assert.deepEqual(result.anonymous, { skipped: 'explicit-rejection' });
    assert.equal(result.webCookieAuthorization, 'not-demonstrated');
    assert.equal(result.fullEpisodePlaybackVerified, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REJECTION_FIXTURE/);
  });
}

test('the web diagnostic exports only allowlisted scalar evidence and never DRM material or media URLs', async t => {
  const f = fixture(t);
  const result = await f.service.probeOfficialWebPlaybackApi(ids);
  assert.deepEqual(Object.keys(result).sort(), ['checkedAt', 'route', 'authenticated', 'anonymous',
    'sameRequestProfile', 'sameBody', 'webCookieAuthorization', 'fullEpisodePlaybackVerified'].sort());
  for (const branch of [result.authenticated, result.anonymous]) {
    assert.deepEqual(Object.keys(branch).sort(), ['status', 'elapsedMs', 'responseShape',
      'businessAccepted', 'mediaConfigured', 'encryptedPlayerRequired'].sort());
    assert.ok(Object.values(branch).every(value => ['boolean', 'number', 'string'].includes(typeof value)));
  }
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|https?:\/\/|sessionid=|aes_key|main_url|license_url|device_id|user_id/);
});

test('a transport failure is sanitized and cannot trigger the anonymous comparison', async t => {
  const f = fixture(t, { apiResponse: () => {
    throw Object.assign(new Error(`${privateCookie} ${privateMedia} PRIVATE_KEY_FIXTURE`), { code: 'ECONNRESET' });
  } });
  await assert.rejects(f.service.probeOfficialWebPlaybackApi(ids), error => {
    assert.equal(error.code, 'NETWORK_DISCONNECTED');
    assert.doesNotMatch(error.message + JSON.stringify(error), /PRIVATE_|https?:\/\/|sessionid=/);
    return true;
  });
  assert.equal(f.apiCalls().length, 1);
});

test('a pre-cancelled probe sends no account or playback requests', async t => {
  const f = fixture(t), controller = new AbortController();
  controller.abort();
  await assert.rejects(f.service.probeOfficialWebPlaybackApi({ ...ids, signal: controller.signal }), { code: 'ERR_CANCELED' });
  assert.equal(f.calls.length, 0);
});

for (const [name, options] of [
  ['anonymous', { seeded: false }],
  ['expired', { saved: { cookieMetadata: [{ name: 'sessionid', domain: 'hongguoduanju.com',
    path: '/', secure: true, expiresAt: Date.now() - 60000 }] } }],
  ['invalid', { saved: { cookie: 'passport_csrf_token=PRIVATE_CSRF_FIXTURE' } }],
  ['officially rejected', { accountResponse: { status: 401, headers: {}, data: '' } }],
]) {
  test(`${name} session cannot start a web playback diagnostic`, async t => {
    const f = fixture(t, options);
    await assert.rejects(f.service.probeOfficialWebPlaybackApi(ids), error => ['ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED'].includes(error.code));
    assert.equal(f.apiCalls().length, 0);
    if (name !== 'officially rejected') assert.equal(f.calls.length, 0);
  });
}

for (const cancellation of ['logout', 'caller']) {
  test(`${cancellation} during authenticated probe aborts transport and prevents a late anonymous request`, { timeout: 2000 }, async t => {
    const entered = deferred(), gate = deferred(), controller = new AbortController();
    let transportSignal;
    const f = fixture(t, { apiResponse: async ({ options }) => {
      transportSignal = options.signal;
      entered.resolve();
      await gate.promise;
      return accepted();
    } });
    const pending = f.service.probeOfficialWebPlaybackApi({ ...ids, signal: controller.signal });
    await entered.promise;
    if (cancellation === 'logout') await f.service.logout();
    else controller.abort();
    await assert.rejects(pending, { code: 'ERR_CANCELED' });
    assert.equal(transportSignal.aborted, true);
    gate.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.apiCalls().length, 1);
    if (cancellation === 'logout') assert.equal((await f.service.status()).signedIn, false);
  });
}

for (const [index, playInfoPath] of [
  'https://unrelated.example/api/video/protected/play-info',
  'http://hongguoduanju.com/api/video/protected/play-info',
  'https://hongguoduanju.com.unrelated.example/api/video/protected/play-info',
  'https://user:PRIVATE_PASSWORD_FIXTURE@hongguoduanju.com/api/video/protected/play-info',
  '/api/video/protected/play-info/extra',
].entries()) {
  test(`untrusted profile case ${index + 1} is rejected before any playback request`, async t => {
    const f = fixture(t, { create: serviceWithProfile({ ...OFFICIAL_WEB_PROFILE, playInfoPath }) });
    await assert.rejects(f.service.probeOfficialWebPlaybackApi(ids), { code: 'SECURITY_BLOCKED' });
    assert.equal(f.calls.length, 1, 'only the official account verification may run');
    assert.equal(f.apiCalls().length, 0);
  });
}

for (const value of [null, 1, [], 'PRIVATE_UNEXPECTED_FIXTURE']) {
  test(`non-object playback JSON (${Array.isArray(value) ? 'array' : typeof value}) is not accepted or echoed`, async t => {
    const f = fixture(t, { apiResponse: () => response(value) });
    const result = await f.service.probeOfficialWebPlaybackApi(ids);
    assert.equal(result.authenticated.responseShape, 'unrecognized');
    assert.equal(result.authenticated.mediaConfigured, false);
    assert.equal(result.authenticated.businessAccepted, false);
    assert.equal(result.webCookieAuthorization, 'not-demonstrated');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_UNEXPECTED_FIXTURE/);
  });
}
