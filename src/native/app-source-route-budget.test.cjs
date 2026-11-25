// SPDX-License-Identifier: GPL-3.0-only
// Offline request construction and scheduling checks; no SDK or media is executed.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { gunzipSync } = require('node:zlib');
const { MODEL_PROFILE, UPSTREAM_PLAYBACK_PROFILE } = require('./playback-profiles');

const vid = '7100000000000401';
const otherVid = '7100000000000402';
const routeId = 'upstream-grouped-b';
const expectedRoutes = [
  'preload-primary', 'preload-alternate', 'video-tab', routeId,
  'upstream-player-b', 'upstream-player-a', 'upstream-model-a', 'upstream-model-c',
];
const identity = Object.freeze({
  device_id: '1000000000000401', iid: '1000000000000402',
  cdid: '00000000-0000-4000-8000-000000000403',
});
const mediaUrl = 'https://qznovelvod.com/offline-route-budget-fixture.mp4';
const clearModel = () => ({
  video_id: 'synthetic-route-budget-asset', video_duration: 61.25,
  video_list: [{ codec_type: 'h264', width: 1080, height: 1920,
    main_url: mediaUrl, encrypt_info: { encrypt: false } }],
});
const jsonResponse = value => ({ status: 200, headers: {}, data: JSON.stringify(value) });
const modelResponse = (value = clearModel(), mappedVid = vid) => jsonResponse({
  code: 0, data: { '1004': { [mappedVid]: { video_model: value } } },
});
const emptyResponse = () => ({ status: 200, headers: {}, data: '' });

function fixture(transport) {
  const filename = require.resolve('./app-source');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const calls = [];
  const events = [];
  const protectedWork = { derive: 0, decrypt: 0, dependencies: [] };
  const startedAt = 1795616400000;
  let clock = startedAt;
  let registrations = 0;
  const source = `${fs.readFileSync(filename, 'utf8')}\n
    deriveContentKey = () => {
      __protectedWork.derive++;
      throw new Error('The ordinary candidate must not derive protected keys');
    };
    decryptSpadeUrl = () => {
      __protectedWork.decrypt++;
      throw new Error('The ordinary candidate must not decrypt protected addresses');
    };
  `;
  vm.runInNewContext(source, {
    module, Buffer, URL, URLSearchParams, AbortController, AbortSignal,
    process: { env: {} }, console, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return clock; } },
    __protectedWork: protectedWork,
    require(name) {
      if (/child_process|sdk-playback|openhongguo|sdk-helper/.test(name)) {
        protectedWork.dependencies.push(name);
        assert.fail(`Offline candidate scheduling must not load ${name}`);
      }
      if (name === './playback-device') return {
        createPlaybackIdentityManager: localRequire('./playback-device').createPlaybackIdentityManager,
        registerPlaybackDevice: async () => { registrations++; return identity; },
      };
      if (name === 'node:timers/promises') return {
        setTimeout: async (ms, value, options) => {
          if (options?.signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' });
          clock += ms;
          return value;
        },
      };
      if (name === 'axios') return async config => {
        calls.push({ ...config, requestedAt: clock });
        return transport(config, calls.length, ms => { clock += ms; });
      };
      return localRequire(name);
    },
  }, { filename });
  return {
    ...module.exports, calls, events, protectedWork, startedAt,
    get registrations() { return registrations; },
    get now() { return clock; },
    run(options = {}) {
      return module.exports.fetchAppPlayUrl(vid, {
        ...options, onPlaybackEvent: event => events.push(event),
      });
    },
  };
}

function assertOrdinaryOnly(f) {
  assert.deepEqual(f.protectedWork, { derive: 0, decrypt: 0, dependencies: [] });
  assert.equal(f.registrations, 1);
}

function assertRequestBudgets(f, deadline = f.startedAt + MODEL_PROFILE.timeout.modelTotalMs) {
  for (const call of f.calls) {
    assert.ok(call.timeout > 0, 'no expired candidate is dispatched');
    assert.ok(call.timeout <= MODEL_PROFILE.timeout.requestMs, 'each transport keeps its single-request upper bound');
    assert.ok(call.requestedAt + call.timeout <= deadline, 'a new candidate or retry cannot extend the total deadline');
  }
}

test('PR17 grouped candidate constructs only the recorded HTTPS route and ordinary signed gzip request', () => {
  const f = fixture(() => assert.fail('Request construction must not dispatch'));
  const request = f.upstreamPlaybackRequest(routeId, identity, vid);
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://api5-normal-sinfonlineb.fqnovel.com');
  assert.equal(url.pathname, '/novel/player/multi_video_model/v1/');
  assert.equal(request.method, 'POST');
  assert.equal(url.searchParams.get('version_code'), UPSTREAM_PLAYBACK_PROFILE.app.version_code);
  assert.equal(url.searchParams.get('device_id'), identity.device_id);
  assert.equal(request.headers['Content-Encoding'], 'gzip');
  assert.ok(request.headers['x-medusa']);
  assert.ok(request.headers['x-helios']);
  assert.ok(request.headers['x-ss-stub']);
  assert.ok(!Object.keys(request.headers).some(name => /^(?:cookie|authorization)$/i.test(name)));
  assert.deepEqual(JSON.parse(gunzipSync(request.body).toString('utf8')), {
    ...UPSTREAM_PLAYBACK_PROFILE.playerBody, mixed_video_id_map: { '1004': [vid] },
  });
  assert.equal(f.calls.length, 0);
  assert.equal(f.registrations, 0);
  assert.deepEqual(f.protectedWork, { derive: 0, decrypt: 0, dependencies: [] });
});

test('the recorded grouped candidate follows the original three routes and accepts only its clear model', async () => {
  const f = fixture((_config, count) => count <= 3 ? emptyResponse() : modelResponse());
  const result = await f.run();
  assert.equal(result.routeId, routeId);
  assert.equal(result.profileId, UPSTREAM_PLAYBACK_PROFILE.id);
  assert.equal(result.profileVersion, UPSTREAM_PLAYBACK_PROFILE.version);
  assert.equal(result.url, mediaUrl);
  assert.equal(result.contentKey, null);
  assert.deepEqual(f.events.map(event => event.routeId), expectedRoutes.slice(0, 4));
  assert.equal(f.calls.length, 4);
  assertRequestBudgets(f);
  assertOrdinaryOnly(f);
});

test('slow empty candidates do not consume a shared first-request deadline', async () => {
  const f = fixture((_config, count, advance) => {
    if (count <= 3) { advance(4000); return emptyResponse(); }
    return modelResponse();
  });
  const result = await f.run();
  assert.equal(result.routeId, routeId);
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[3].requestedAt, f.startedAt + 12000);
  assert.ok(f.calls[3].timeout >= MODEL_PROFILE.timeout.minimumRouteMs);
  assertRequestBudgets(f);
  assertOrdinaryOnly(f);
});

test('exhausting the model budget cannot dispatch an additional compatibility candidate', async () => {
  const f = fixture((_config, count, advance) => {
    advance(count <= 3 ? 6000 : 2000);
    return emptyResponse();
  });
  await assert.rejects(f.run(), error => ['EMPTY_RESPONSE', 'ETIMEDOUT'].includes(error.code));
  assert.equal(f.calls.length, 4);
  assert.deepEqual(f.events.map(event => event.routeId), expectedRoutes.slice(0, 4));
  assertRequestBudgets(f);
  assertOrdinaryOnly(f);
});

test('a shorter caller deadline is preserved across empty candidates', async () => {
  const f = fixture((_config, _count, advance) => { advance(3000); return emptyResponse(); });
  const deadline = f.startedAt + 9000;
  await assert.rejects(f.run({ deadline }), error => ['EMPTY_RESPONSE', 'ETIMEDOUT'].includes(error.code));
  assert.equal(f.calls.length, 3);
  assertRequestBudgets(f, deadline);
  assertOrdinaryOnly(f);
});

test('a network retry retains the original model budget and anonymous identity', async () => {
  const f = fixture((_config, count, advance) => {
    advance(count === 1 ? 7000 : 4000);
    if (count === 1) throw Object.assign(new Error('synthetic connection reset'), { code: 'ECONNRESET' });
    return emptyResponse();
  });
  await assert.rejects(f.run(), error => ['EMPTY_RESPONSE', 'ETIMEDOUT'].includes(error.code));
  assert.equal(f.calls.length, 4);
  assertRequestBudgets(f);
  assertOrdinaryOnly(f);
});

test('all empty responses walk exactly one eight-route ladder without rotating devices', async () => {
  const f = fixture(emptyResponse);
  await assert.rejects(f.run(), { code: 'EMPTY_RESPONSE' });
  assert.equal(f.calls.length, expectedRoutes.length);
  assert.deepEqual(f.events.map(event => event.routeId), expectedRoutes);
  assert.ok(f.events.every(event => event.code === 'EMPTY_RESPONSE' && !event.modelValid));
  assertRequestBudgets(f);
  assertOrdinaryOnly(f);
});

for (const status of [401, 403, 429]) {
  test(`grouped HTTP ${status} is terminal without another candidate or device registration`, async () => {
    const f = fixture((_config, count) => count <= 3 ? emptyResponse()
      : { status, headers: {}, data: 'SYNTHETIC_DENIAL' });
    await assert.rejects(f.run(), error => error.status === status);
    assert.equal(f.calls.length, 4);
    assert.equal(f.events.at(-1).routeId, routeId);
    assert.equal(f.events.at(-1).modelValid, false);
    assertOrdinaryOnly(f);
  });
}

for (const [name, response, code] of [
  ['business denial', jsonResponse({ code: 403 }), 'BUSINESS_REJECTED'],
  ['malformed JSON', { status: 200, headers: {}, data: '{not JSON}' }, 'INVALID_RESPONSE'],
  ['wrong episode mapping', modelResponse(clearModel(), otherVid), 'MISSING_MODEL'],
  ['missing model', jsonResponse({ code: 0, data: {} }), 'MISSING_MODEL'],
  ['unknown encryption state', modelResponse({ ...clearModel(), video_list: [{
    codec_type: 'h264', width: 1080, height: 1920, main_url: mediaUrl,
  }] }), 'INVALID_RESPONSE'],
  ['protected model', modelResponse({ ...clearModel(), protected: true }), 'DRM_UNSUPPORTED'],
]) {
  test(`a grouped ${name} stops before later candidates and key processing`, async () => {
    const f = fixture((_config, count) => count <= 3 ? emptyResponse() : response);
    await assert.rejects(f.run(), { code });
    assert.equal(f.calls.length, 4);
    assert.equal(f.events.at(-1).routeId, routeId);
    assert.equal(f.events.at(-1).modelValid, false);
    assertOrdinaryOnly(f);
  });
}

test('cancelling the grouped request aborts its transport and stops the candidate ladder', async () => {
  let activeSignal;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const f = fixture((config, count) => {
    if (count <= 3) return emptyResponse();
    activeSignal = config.signal;
    started();
    return new Promise((_resolve, reject) => config.signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('synthetic cancellation'), { code: 'ERR_CANCELED' }));
    }, { once: true }));
  });
  const controller = new AbortController();
  const pending = f.run({ signal: controller.signal });
  await entered;
  assert.ok(activeSignal && !activeSignal.aborted);
  const activeUrl = new URL(f.calls.at(-1).url);
  controller.abort();
  await assert.rejects(pending, { code: 'ERR_CANCELED' });
  assert.equal(activeUrl.pathname, '/novel/player/multi_video_model/v1/');
  assert.equal(activeSignal.aborted, true);
  assert.equal(f.calls.length, 4);
  assertOrdinaryOnly(f);
});
