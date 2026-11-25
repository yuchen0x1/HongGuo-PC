const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const vid = '7701643128951802904';
const otherVid = '7701643128951802905';
const assetId = 'synthetic-media-asset';
const mediaUrl = 'https://qznovelvod.com/upstream-clear-fixture.mp4';
const duration = 56.007;
const routeIds = ['upstream-grouped-b', 'upstream-player-b', 'upstream-player-a', 'upstream-model-a', 'upstream-model-c'];
const allRouteIds = ['preload-primary', 'preload-alternate', 'video-tab', ...routeIds];
const identity = Object.freeze({
  device_id: '1000000000000001', iid: '1000000000000002',
  cdid: '12345678-1234-4234-8234-123456789abc',
});

const row = (overrides = {}) => ({
  codec_type: 'h264', quality_desc: '1080p', width: 1080, height: 1920,
  main_url: mediaUrl, encrypt_info: { encrypt: false }, ...overrides,
});
const model = (overrides = {}) => ({
  video_id: assetId, video_duration: duration, video_list: [row()], ...overrides,
});
const jsonResponse = body => ({ status: 200, headers: {}, data: JSON.stringify(body) });
const modelResponse = (value = model(), mappedVid = vid) => jsonResponse({
  code: 0, data: { [mappedVid]: { video_model: value } },
});
const emptyResponse = () => ({ status: 200, headers: {}, data: '' });

function fixture(transport = () => assert.fail('A parser must not dispatch a request')) {
  const filename = require.resolve('./app-source');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const calls = [];
  const forbiddenDependencies = [];
  const cryptoCalls = { derive: 0, decrypt: 0 };
  let registrations = 0;
  // Trap the existing key functions inside this VM without production test hooks.
  const source = `${fs.readFileSync(filename, 'utf8')}\n
    deriveContentKey = () => {
      __cryptoCalls.derive++;
      throw new Error('Protected key derivation must not run for upstream candidates');
    };
    decryptSpadeUrl = () => {
      __cryptoCalls.decrypt++;
      throw new Error('Protected URL decryption must not run for upstream candidates');
    };
  `;
  vm.runInNewContext(source, {
    module, Buffer, URL, URLSearchParams, AbortSignal, AbortController,
    process: { env: {} }, console, setTimeout, clearTimeout, __cryptoCalls: cryptoCalls,
    require(name) {
      if (/child_process|sdk-playback|openhongguo|sdk-helper/.test(name)) {
        forbiddenDependencies.push(name);
        assert.fail(`The clear candidate path must not load ${name}`);
      }
      if (name === './playback-device') return {
        createPlaybackIdentityManager: localRequire('./playback-device').createPlaybackIdentityManager,
        registerPlaybackDevice: async () => { registrations++; return identity; },
      };
      if (name === 'axios') return async config => {
        calls.push(config);
        return transport(config, calls.length);
      };
      return localRequire(name);
    },
  }, { filename });
  return {
    ...module.exports, calls, cryptoCalls, forbiddenDependencies,
    get registrations() { return registrations; },
  };
}

function assertNoProtectedWork(f) {
  assert.deepEqual(f.cryptoCalls, { derive: 0, decrypt: 0 });
  assert.deepEqual(f.forbiddenDependencies, []);
}

test('the five upstream requests are distinct, bounded public-host profiles without account credentials', () => {
  const f = fixture();
  const requests = routeIds.map(routeId => f.upstreamPlaybackRequest(routeId, identity, vid));
  assert.equal(new Set(requests.map(request => new URL(request.url).origin + new URL(request.url).pathname)).size, 5);
  for (const request of requests) {
    const url = new URL(request.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.username, '');
    assert.equal(url.password, '');
    assert.ok(['fqnovel.com', 'snssdk.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)));
    assert.equal(url.searchParams.get('version_code'), '74332');
    assert.equal(url.searchParams.get('device_id'), identity.device_id);
    assert.equal(url.searchParams.get('iid'), identity.iid);
    assert.ok(['GET', 'POST'].includes(request.method));
    assert.ok(request.headers && typeof request.headers === 'object');
    assert.ok(!Object.keys(request.headers).some(name => /^(?:cookie|authorization)$/i.test(name)));
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.registrations, 0);
  assertNoProtectedWork(f);
});

test('unknown route identifiers cannot create arbitrary upstream requests', () => {
  const f = fixture();
  assert.throws(() => f.upstreamPlaybackRequest('https://127.0.0.1/private', identity, vid));
  assert.equal(f.calls.length, 0);
  assertNoProtectedWork(f);
});

test('clear parser accepts an explicitly clear model with a distinct media asset ID', () => {
  const f = fixture();
  const result = f.parseClearUpstreamModel(model(), vid, {
    expectedVideoId: assetId, expectedDuration: duration, quality: '1080p',
  });
  assert.equal(result.vid, vid);
  assert.equal(result.source, 'app');
  assert.equal(result.url, mediaUrl);
  assert.equal(result.contentKey, null);
  assert.equal(result.expectedDuration, duration);
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.ok(result.variants.length > 0);
  assert.ok(result.variants.every(variant => variant.contentKey === null));
  assert.equal(f.calls.length, 0);
  assertNoProtectedWork(f);
});

for (const clearFlag of [false, 0, '0', 'false']) {
  test(`clear parser permits the explicit clear marker ${JSON.stringify(clearFlag)}`, () => {
    const f = fixture();
    const result = f.parseClearUpstreamModel(model({
      video_list: [row({ encrypt_info: { encrypt: clearFlag } })],
    }), vid);
    assert.equal(result.contentKey, null);
    assert.equal(result.expectedDuration, undefined);
    assert.ok(result.variants.every(variant => variant.expectedDuration === undefined));
    assertNoProtectedWork(f);
  });
}

for (const [name, overrides, options = {}] of [
  ['missing asset ID', { video_id: undefined }],
  ['numeric asset ID', { video_id: 12345 }],
  ['blank asset ID', { video_id: ' ' }],
  ['mismatched asset ID', {}, { expectedVideoId: 'different-asset' }],
  ['missing duration', { video_duration: undefined }],
  ['zero duration', { video_duration: 0 }],
  ['negative duration', { video_duration: -1 }],
  ['non-finite duration', { video_duration: Infinity }],
  ['truncated preview', { video_duration: 10 }, { expectedDuration: duration }],
  ['duration outside tolerance', { video_duration: duration + 0.501 }, { expectedDuration: duration }],
  ['absent encryption state', { video_list: [row({ encrypt_info: undefined })] }],
  ['empty encryption state', { video_list: [row({ encrypt_info: {} })] }],
]) {
  test(`clear parser rejects ${name}`, () => {
    const f = fixture();
    assert.throws(() => f.parseClearUpstreamModel(model(overrides), vid, options), { code: 'INVALID_RESPONSE' });
    assertNoProtectedWork(f);
  });
}

test('small duration rounding differences remain valid with an independent expected duration', () => {
  const f = fixture();
  const result = f.parseClearUpstreamModel(model({ video_duration: 56.006644 }), vid, { expectedDuration: duration });
  assert.equal(result.url, mediaUrl);
  assertNoProtectedWork(f);
});

const protectedPatches = [
  ['top protected flag', value => ({ ...value, protected: true })],
  ['top encrypted flag', value => ({ ...value, encrypted: true })],
  ['top DRM metadata', value => ({ ...value, drm: { scheme: 'synthetic-drm' } })],
  ['top URL key seed', value => ({ ...value, key_seed: 'SYNTHETIC_KEY_SEED' })],
  ['top content key ID', value => ({ ...value, kid: 'SYNTHETIC_KID' })],
  ['top gear key metadata', value => ({ ...value, gear_des_key: 'SYNTHETIC_GEAR_KEY' })],
  ['top authorization metadata', value => ({ ...value, check_info: 'SYNTHETIC_CHECK_INFO' })],
  ['row encryption flag', value => ({ ...value, video_list: [row({ encrypt_info: { encrypt: true } })] })],
  ['row spade', value => ({ ...value, video_list: [row({ spade: 'SYNTHETIC_SPADE' })] })],
  ['row spade_a', value => ({ ...value, video_list: [row({ spade_a: 'SYNTHETIC_SPADE_A' })] })],
  ['nested encryption spade', value => ({ ...value, video_list: [row({ encrypt_info: { encrypt: false, spade_a: 'SYNTHETIC_SPADE_A' } })] })],
  ['nested video metadata key ID', value => ({ ...value, video_list: [row({ video_meta: { kid: 'SYNTHETIC_KID' } })] })],
  ['mixed clear and protected rows', value => ({ ...value, video_list: [row(), row({ encrypt_info: { encrypt: true } })] })],
  ...['0', 'false'].flatMap(flag => [
    [`top key seed string ${flag}`, value => ({ ...value, key_seed: flag })],
    [`row spade string ${flag}`, value => ({ ...value, video_list: [row({ spade_a: flag })] })],
    [`nested spade string ${flag}`, value => ({ ...value, video_list: [row({ encrypt_info: { encrypt: false, spade_a: flag } })] })],
  ]),
];

for (const [name, patch] of protectedPatches) {
  test(`clear parser refuses ${name} before any key processing`, () => {
    const f = fixture();
    assert.throws(() => f.parseClearUpstreamModel(patch(model()), vid), { code: 'DRM_UNSUPPORTED' });
    assert.equal(f.calls.length, 0);
    assertNoProtectedWork(f);
  });
}

for (const [index, routeId] of routeIds.entries()) {
  test(`the empty-response ladder reaches ${routeId} and accepts its clear model`, async () => {
    const f = fixture((_config, count) => count < 4 + index ? emptyResponse() : modelResponse());
    const events = [];
    const result = await f.fetchAppPlayUrl(vid, { onPlaybackEvent: value => events.push(value) });
    assert.equal(result.routeId, routeId);
    assert.equal(result.vid, vid);
    assert.equal(result.url, mediaUrl);
    assert.equal(result.contentKey, null);
    assert.equal(f.calls.length, 4 + index);
    assert.equal(f.registrations, 1);
    assert.deepEqual(events.map(event => event.routeId), allRouteIds.slice(0, 4 + index));
    assertNoProtectedWork(f);
  });
}

test('all eight empty responses exhaust exactly one ladder without resetting the device', async () => {
  const f = fixture(emptyResponse);
  const events = [];
  await assert.rejects(f.fetchAppPlayUrl(vid, { onPlaybackEvent: value => events.push(value) }), { code: 'EMPTY_RESPONSE' });
  assert.equal(f.calls.length, allRouteIds.length);
  assert.equal(f.registrations, 1);
  assert.deepEqual(events.map(event => event.routeId), allRouteIds);
  assert.ok(events.every(event => event.code === 'EMPTY_RESPONSE' && !event.modelValid));
  assertNoProtectedWork(f);
});

test('a wrong outer episode mapping cannot play a clear model from another episode', async () => {
  const f = fixture((_config, count) => count <= 3 ? emptyResponse() : modelResponse(model(), otherVid));
  await assert.rejects(f.fetchAppPlayUrl(vid), error => ['MISSING_MODEL', 'INVALID_RESPONSE'].includes(error.code));
  assert.equal(f.calls.length, 4);
  assert.equal(f.registrations, 1);
  assertNoProtectedWork(f);
});

for (const [name, patch] of protectedPatches) {
  test(`an upstream ${name} is terminal and cannot fall into the legacy key parser`, async () => {
    const f = fixture((_config, count) => count <= 3 ? emptyResponse() : modelResponse(patch(model())));
    await assert.rejects(f.fetchAppPlayUrl(vid), { code: 'DRM_UNSUPPORTED' });
    assert.equal(f.calls.length, 4);
    assert.equal(f.registrations, 1);
    assertNoProtectedWork(f);
  });
}

for (const status of [401, 403, 429]) {
  test(`an upstream HTTP ${status} stops without another candidate or registration`, async () => {
    const f = fixture((_config, count) => count <= 3 ? emptyResponse() : { status, headers: {}, data: 'SYNTHETIC_DENIAL' });
    await assert.rejects(f.fetchAppPlayUrl(vid), error => error.status === status);
    assert.equal(f.calls.length, 4);
    assert.equal(f.registrations, 1);
    assertNoProtectedWork(f);
  });
}

test('an upstream business denial is terminal even though its HTTP status is 200', async () => {
  const f = fixture((_config, count) => count <= 3 ? emptyResponse() : jsonResponse({ code: 403, message: 'SYNTHETIC_DENIAL' }));
  await assert.rejects(f.fetchAppPlayUrl(vid), { code: 'BUSINESS_REJECTED' });
  assert.equal(f.calls.length, 4);
  assert.equal(f.registrations, 1);
  assertNoProtectedWork(f);
});

test('cancelling an active upstream request aborts the transport and prevents later candidates', async () => {
  let activeSignal;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const f = fixture((config, count) => {
    if (count <= 3) return emptyResponse();
    activeSignal = config.signal;
    started();
    return new Promise((_resolve, reject) => config.signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('Synthetic upstream cancellation'), { code: 'ERR_CANCELED' }));
    }, { once: true }));
  });
  const controller = new AbortController();
  const pending = f.fetchAppPlayUrl(vid, { signal: controller.signal });
  await entered;
  assert.ok(activeSignal && !activeSignal.aborted);
  controller.abort();
  await assert.rejects(pending, { code: 'ERR_CANCELED' });
  assert.equal(activeSignal.aborted, true);
  assert.equal(f.calls.length, 4);
  assert.equal(f.registrations, 1);
  assertNoProtectedWork(f);
});
