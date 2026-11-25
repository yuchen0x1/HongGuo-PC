const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAccountService, secureSessionStore } = require('./account-session');

const ids = { seriesId: '1001', vid: '9001' };
const response = (data, headers = {}) => ({ status: 200, headers, data: JSON.stringify(data) });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const probes = [
  ['page', 'probeOfficialPlayback', 'official-web-player'],
  ['web-api', 'probeOfficialWebPlaybackApi', 'official-web-play-info'],
  ['app', 'probeOfficialAppPlayback', 'official-app-preload'],
];

function fixture(t, kind) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-probe-lifecycle-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'account-session.bin');
  const transform = value => Buffer.from(value).map(byte => byte ^ 0x5a);
  const safeStorage = { isEncryptionAvailable: () => true,
    encryptString: value => transform(Buffer.from(value)), decryptString: value => transform(value).toString('utf8') };
  const identity = { device_id: '7000000000000000001', iid: '7000000000000000002',
    cdid: '00000000-0000-4000-8000-000000000003' };
  secureSessionStore({ filePath, safeStorage }).save({ cookie: 'sessionid=synthetic-initial',
    profile: { id: '42', nickname: 'fixture' }, deviceId: identity.device_id, installId: identity.iid, cdid: identity.cdid });
  const entered = deferred(), gate = deferred();
  let accountId = '42', accountStatus = 200, verifications = 0, probeCalls = 0, requestSignal;
  const awaitProbe = async (authenticated, signal) => {
    probeCalls++;
    if (authenticated) { requestSignal = signal; entered.resolve(); await gate.promise; }
  };
  const service = createAccountService({ filePath, safeStorage, identityRequest: async () => identity,
    webRequest: async (url, options) => {
      if (url.includes('/passport/')) {
        verifications++;
        return accountStatus !== 200 ? { status: accountStatus, headers: {}, data: '' }
          : response({ message: 'success', data: { user_id_str: accountId, name: 'fixture' } },
            { 'set-cookie': [`sessionid=synthetic-rotation-${verifications}; Path=/; Secure`] });
      }
      await awaitProbe(options.explicitCookie, options.signal);
      if (kind === 'page') {
        const data = { series_id: ids.seriesId, vid: ids.vid, isSuccess: true,
          seriesDetail: { series_id: ids.seriesId }, protectedPlayback: true };
        return { status: 200, headers: {}, data: `<script>window._ROUTER_DATA = ${JSON.stringify({
          loaderData: { 'player_(series_id)/(vid)/page': data },
        })}</script>` };
      }
      return response({ base_resp: { StatusCode: 0 }, play_info: { main_url: 'https://media.invalid/synthetic' } });
    },
    playbackProbeRequest: async () => ({
      url: 'https://reading.snssdk.com/novel/player/multi_video_model/preload/v1',
      options: { method: 'POST', headers: {}, data: Buffer.from('synthetic-body') },
    }),
    accountRequest: async (_url, options, _deadline, signal) => {
      await awaitProbe(!!options.headers.Cookie, signal);
      return { code: 0, data: { [ids.vid]: { video_model: { video_list: {
        first: { main_url: 'https://media.invalid/synthetic' },
      } } } } };
    },
  });
  return { service, entered: entered.promise, release: gate.resolve,
    replaceAccount() { accountId = '99'; }, expireAccount() { accountStatus = 401; },
    requestAborted: () => requestSignal?.aborted, probeCalls: () => probeCalls };
}

for (const [kind, method, route] of probes) {
  test(`${kind} authorization probe survives same-account Cookie refresh`, async t => {
    const f = fixture(t, kind);
    const pending = f.service[method](ids);
    await f.entered;
    const before = await f.service.getPlaybackContext();
    assert.equal((await f.service.refreshSession()).sessionValidity, 'valid');
    const after = await f.service.getPlaybackContext();
    assert.equal(after.accountGeneration, before.accountGeneration);
    assert.equal(f.requestAborted(), false);
    f.release();
    assert.equal((await pending).route, route);
    assert.equal(f.probeCalls(), 2);
  });

  for (const action of ['logout', 'replace-account', 'expire-account']) {
    test(`${kind} authorization probe cancels after ${action}`, async t => {
      const f = fixture(t, kind);
      const pending = f.service[method](ids).then(
        () => ({ completed: true }), error => ({ errorCode: error.code }));
      await f.entered;
      const before = await f.service.getPlaybackContext();
      if (action === 'logout') await f.service.logout();
      else if (action === 'replace-account') {
        f.replaceAccount();
        const result = await f.service.completeWebLogin('sessionid=synthetic-replacement');
        assert.equal(result.account.id, '99');
      } else {
        f.expireAccount();
        assert.equal((await f.service.refreshSession()).sessionValidity, 'expired');
      }
      assert.equal(f.requestAborted(), true);
      f.release();
      assert.deepEqual(await pending, { errorCode: 'ERR_CANCELED' });
      const after = await f.service.getPlaybackContext();
      assert.ok(after.accountGeneration > before.accountGeneration);
      assert.equal(after.signedIn, action === 'replace-account');
    });
  }
}
