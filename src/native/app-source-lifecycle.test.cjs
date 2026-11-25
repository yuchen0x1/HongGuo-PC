const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createPlaybackIdentityManager } = require('./playback-device');

const vid = '12345';
const response = () => ({ status: 200, headers: {}, data: JSON.stringify({ code: 0, data: {
  [vid]: { video_model: { video_list: [{ codec_type: 'h264', width: 1080, height: 1920,
    main_url: 'https://qznovelvod.com/synthetic.mp4', encrypt_info: { encrypt: false } }] } },
} }) });

function fixture(transport, register) {
  const module = { exports: {} }, calls = [];
  let registrations = 0;
  const identity = Object.freeze({ device_id: '1234567890123456', iid: '1234567890123457', cdid: '00000000-0000-4000-8000-000000000003' });
  vm.runInNewContext(fs.readFileSync(require.resolve('./app-source'), 'utf8'), {
    module, Buffer, URL, AbortSignal, AbortController, setTimeout, clearTimeout,
    require(name) {
      if (name === './playback-device') return { createPlaybackIdentityManager, registerPlaybackDevice: async (...args) => {
        registrations++;
        return register ? register(...args) : identity;
      } };
      if (name === 'axios') return async config => { calls.push(config); return transport(config, calls.length); };
      return require(name);
    },
  }, { filename: require.resolve('./app-source') });
  return { ...module.exports, calls, get registrations() { return registrations; } };
}

test('transient source failure retries once with the same identity and reports safe evidence', async () => {
  const f = fixture(async (_config, count) => {
    if (count === 1) throw Object.assign(new Error('PRIVATE_COOKIE_OR_URL'), { code: 'ECONNRESET' });
    return response();
  });
  const events = [];
  const result = await f.fetchAppPlayUrl(vid, { onPlaybackEvent: event => events.push(event) });
  assert.equal(f.calls.length, 2);
  assert.equal(f.registrations, 1);
  assert.equal(result.sourceRecoveryCount, 1);
  assert.equal(result.routeId, 'preload-primary');
  assert.equal(new URL(f.calls[0].url).searchParams.get('device_id'), new URL(f.calls[1].url).searchParams.get('device_id'));
  assert.equal(events[0].code, 'ECONNRESET');
  assert.equal(events[1].modelValid, true);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|1234567890123456|00000000-0000-4000-8000-000000000003|https|Cookie/);
});

test('repeated network timeout is bounded without a new registration or compatibility-route loop', async () => {
  const f = fixture(async () => { throw Object.assign(new Error('PRIVATE'), { code: 'ETIMEDOUT' }); });
  await assert.rejects(f.fetchAppPlayUrl(vid), { code: 'ETIMEDOUT' });
  assert.equal(f.calls.length, 2);
  assert.equal(f.registrations, 1);
});

for (const status of [401, 403, 429]) {
  test(`HTTP ${status} stops before retry, fallback or identity refresh`, async () => {
    const f = fixture(async () => ({ status, headers: {}, data: 'PRIVATE' }));
    await assert.rejects(f.fetchAppPlayUrl(vid), error => error.status === status);
    assert.equal(f.calls.length, 1);
    assert.equal(f.registrations, 1);
  });
}

test('HTTP 200 empty body walks one official ladder and does not relabel identity or login state', async () => {
  const f = fixture(async () => ({ status: 200, headers: {}, data: '' }));
  const events = [];
  await assert.rejects(f.fetchAppPlayUrl(vid, { onPlaybackEvent: value => events.push(value) }), { code: 'EMPTY_RESPONSE' });
  assert.equal(f.calls.length, 8);
  assert.equal(f.registrations, 1);
  assert.deepEqual(events.map(event => event.routeId), [
    'preload-primary', 'preload-alternate', 'video-tab',
    'upstream-grouped-b', 'upstream-player-b', 'upstream-player-a', 'upstream-model-a', 'upstream-model-c',
  ]);
  assert.ok(events.every(event => event.code === 'EMPTY_RESPONSE' && !event.modelValid));
  assert.equal(f.getPlaybackIdentityStatus().state, 'ready');
});

test('source cancellation aborts the active transport and prevents retries', async () => {
  let activeSignal, started;
  const entered = new Promise(resolve => { started = resolve; });
  const f = fixture(async config => {
    activeSignal = config.signal;
    started();
    return new Promise((resolve, reject) => config.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'ERR_CANCELED' })), { once: true }));
  });
  const controller = new AbortController();
  const pending = f.fetchAppPlayUrl(vid, { signal: controller.signal });
  await entered;
  controller.abort();
  await assert.rejects(pending, { code: 'ERR_CANCELED' });
  assert.equal(activeSignal.aborted, true);
  assert.equal(f.calls.length, 1);
});

test('a deadline expires while queued and does not dispatch a late background request', async () => {
  let finish, started;
  const entered = new Promise(resolve => { started = resolve; });
  const f = fixture(async () => {
    started();
    return new Promise(resolve => { finish = () => resolve(response()); });
  });
  const first = f.fetchAppPlayUrl(vid);
  await entered;
  const second = f.fetchAppPlayUrl(vid, { deadline: Date.now() + 20 });
  const keeper = setTimeout(() => {}, 100);
  try { await assert.rejects(second, { code: 'ETIMEDOUT' }); }
  finally { clearTimeout(keeper); }
  finish();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  assert.equal(f.registrations, 1);
});
