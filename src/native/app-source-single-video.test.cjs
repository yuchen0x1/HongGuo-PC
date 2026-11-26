// SPDX-License-Identifier: GPL-3.0-only
// Offline regression for the verified single-video model route. Transport, device
// registration and signing are replaced; media bytes stay synthetic.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const vid = '7100000000000701';
const assetId = 'synthetic-single-video-asset';
const duration = 79.97;
const mediaUrl = 'https://v95-aw-reading-video.qznovelvod.com/synthetic-path-without-suffix';
const contentKeyHex = '11'.repeat(16);
const spadeFor = key => {
  // deriveContentKey is replaced below; only presence of spade_a matters here.
  return key;
};
const row = () => ({ main_url: mediaUrl, encrypt_info: { encrypt: 1, spade_a: spadeFor('spade') },
  video_meta: { width: 720, height: 1280, codec_type: 'h264' } });
const singleVideoModel = overrides => ({ status: 10, message: 'success', video_id: assetId,
  video_duration: duration, media_type: 'video', video_list: [row()], ...overrides });
const empty = () => ({ status: 200, headers: {}, data: '' });
const singleVideoResponse = overrides => ({ status: 200, headers: {},
  data: JSON.stringify({ code: 0, data: { video_model: JSON.stringify(singleVideoModel(overrides)) } }) });

function fixture(transport) {
  const filename = require.resolve('./app-source');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const calls = [];
  const events = [];
  const startedAt = 1795616400000;
  let clock = startedAt;
  let registrations = 0;
  vm.runInNewContext(`${fs.readFileSync(filename, 'utf8')}\n
    deriveContentKey = () => Buffer.from(__contentKeyHex, 'hex');
    decryptSpadeUrl = () => { throw new Error('single-video models expose plain addresses'); };
  `, {
    module, Buffer, URL, URLSearchParams, AbortController, AbortSignal,
    process: { env: {} }, console, setTimeout, clearTimeout,
    __contentKeyHex: contentKeyHex,
    Date: class extends Date { static now() { return clock; } },
    require(name) {
      if (name === './playback-device') return {
        createPlaybackIdentityManager: () => ({
          acquire: async () => ({ device_id: '1000000000000701', iid: '1000000000000702',
            cdid: '00000000-0000-4000-8000-000000000703' }),
          status: () => ({ state: 'ready' }),
        }),
        registerPlaybackDevice: async () => { registrations++; return {}; },
      };
      if (name === 'node:timers/promises') return {
        setTimeout: async (ms, value) => { clock += ms; return value; },
      };
      if (name === 'axios') return async config => {
        calls.push(config);
        return transport(config, calls.length);
      };
      return localRequire(name);
    },
  }, { filename });
  return {
    ...module.exports, calls, events, startedAt,
    get registrations() { return registrations; },
    run(options = {}) {
      return module.exports.fetchAppPlayUrl(vid, { ...options, onPlaybackEvent: event => events.push(event) });
    },
  };
}

const singleVideoOnly = (config, count) => {
  if (count <= 3) return empty();
  if (new URL(config.url).pathname === '/novel/player/video_model/v1/') return singleVideoResponse();
  return empty();
};

test('the single-video route returns the requested episode with its full duration and media key', async () => {
  const f = fixture(singleVideoOnly);
  const result = await f.run();
  assert.equal(result.vid, vid);
  assert.equal(result.routeId, 'app-video-model');
  assert.equal(result.url, mediaUrl);
  assert.equal(result.format, 'mp4');
  assert.equal(result.contentKey, contentKeyHex);
  assert.equal(result.duration, duration);
  assert.equal(result.codec, 'h264');
  assert.equal(f.calls.length, 4, 'preload candidates stay ahead of the verified route');
  const request = f.calls[3];
  assert.ok(String(request.url).startsWith('https://reading.snssdk.com/novel/player/video_model/v1/'));
  assert.equal(request.method, 'POST');
  const body = JSON.parse(require('node:zlib').gunzipSync(request.data).toString('utf8'));
  assert.equal(body.video_id, vid);
  assert.equal(body.content_type, 1);
  assert.equal(body.dr_scene, 'preload');
  assert.deepEqual(f.events.map(event => event.code), ['EMPTY_RESPONSE', 'EMPTY_RESPONSE', 'EMPTY_RESPONSE', '']);
});

test('the single-video route rejects a business denial instead of inventing media', async () => {
  const f = fixture((config, count) => count <= 3 ? empty()
    : { status: 200, headers: {}, data: JSON.stringify({ code: 100103, message: 'denied' }) });
  await assert.rejects(f.run(), error => error.code === 'BUSINESS_REJECTED');
});

test('the single-video route rejects a body without a media model', async () => {
  const f = fixture((config, count) => count <= 3 ? empty()
    : { status: 200, headers: {}, data: JSON.stringify({ code: 0, data: {} }) });
  await assert.rejects(f.run(), error => ['MISSING_MODEL', 'INVALID_RESPONSE'].includes(error.code));
});

test('an empty single-video body still walks the remaining source-only candidates', async () => {
  const f = fixture(() => empty());
  await assert.rejects(f.run(), { code: 'EMPTY_RESPONSE' });
  assert.equal(f.events.at(-1).routeId, 'upstream-model-c');
  assert.equal(f.calls.length, 9, 'one ladder of nine candidates, no repeated round');
});

test('a media address outside the supported CDN domain stays blocked', async () => {
  const f = fixture((config, count) => count <= 3 ? empty()
    : singleVideoResponse({ video_list: [{ ...row(), main_url: 'https://private.example.com/synthetic.mp4' }] }));
  await assert.rejects(f.run(), error => error.code === 'SECURITY_BLOCKED');
});
