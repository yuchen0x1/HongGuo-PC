// SPDX-License-Identifier: GPL-3.0-only
// Synthetic clear models only; transport, registration and signing are replaced.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const vid = '7100000000000501';
const assetId = 'synthetic-identity-asset';
const duration = 120;
const fallbackUrl = 'https://api5-normal-sinfonlineb.fqnovel.com/offline-identity-fallback';
const mediaUrl = 'https://qznovelvod.com/offline-identity-fixture.mp4';
const row = () => ({ codec_type: 'h264', width: 1080, height: 1920,
  main_url: mediaUrl, encrypt_info: { encrypt: false } });
const model = overrides => ({ video_id: assetId, video_duration: duration,
  video_list: [row()], ...overrides });
const reference = overrides => model({ video_list: undefined, fallback_api: fallbackUrl, ...overrides });

function fixture(initial = model(), fallback, { unkeyed = false, modelElapsedMs = 0 } = {}) {
  const filename = require.resolve('./app-source');
  const localRequire = createRequire(filename);
  const module = { exports: {} }, calls = [];
  const startedAt = Date.now();
  let clock = startedAt;
  const forbiddenCalls = { derive: 0, decrypt: 0 };
  vm.runInNewContext(`${fs.readFileSync(filename, 'utf8')}\n
    deriveContentKey = () => { __forbiddenCalls.derive++; throw new Error('Unexpected key derivation'); };
    decryptSpadeUrl = () => { __forbiddenCalls.decrypt++; throw new Error('Unexpected URL decryption'); };
  `, {
    module, Buffer, URL, URLSearchParams, AbortController, AbortSignal,
    setTimeout, clearTimeout, process: { env: {} }, __forbiddenCalls: forbiddenCalls,
    Date: class extends Date { static now() { return clock; } },
    require(name) {
      if (name === './playback-device') return {
        createPlaybackIdentityManager: () => ({
          acquire: async () => ({ device_id: '1000000000000501', iid: '1000000000000502',
            cdid: '00000000-0000-4000-8000-000000000503' }),
          status: () => ({ state: 'ready' }),
        }),
        registerPlaybackDevice: () => assert.fail('Registration must remain mocked'),
      };
      if (name === './playback-v5') return { signPlaybackV5: ({ base }) => ({ url: base, headers: {} }) };
      if (name === './playback-signature') return { signPlayer: () => assert.fail('Signing must remain mocked') };
      if (name === 'axios') return async config => {
        calls.push(config);
        if (config.url !== fallbackUrl) clock += modelElapsedMs;
        return { status: 200, headers: {}, data: JSON.stringify(config.url === fallbackUrl
          ? { code: 0, video_info: { data: fallback } }
          : { code: 0, data: unkeyed ? { video_model: initial } : { [vid]: { video_model: initial } } }) };
      };
      return localRequire(name);
    },
  }, { filename });
  return { calls, forbiddenCalls, startedAt, run: options => module.exports.fetchAppPlayUrl(vid, options) };
}

function assertClearOnly(f, expectedCalls) {
  assert.equal(f.calls.length, expectedCalls);
  assert.deepEqual(f.forbiddenCalls, { derive: 0, decrypt: 0 });
}

test('non-inline fallback accepts the same explicitly clear full-length asset', async () => {
  const f = fixture(reference(), model());
  const result = await f.run();
  assert.equal(result.vid, vid);
  assert.equal(result.url, mediaUrl);
  assert.equal(result.contentKey, null);
  assertClearOnly(f, 2);
});

for (const [name, patch] of [
  ['different asset', { video_id: 'synthetic-different-asset' }],
  ['missing asset', { video_id: undefined }],
  ['numeric asset', { video_id: 123 }],
  ['preview duration', { video_duration: 9 }],
  ['missing duration', { video_duration: undefined }],
  ['zero duration', { video_duration: 0 }],
  ['duration outside tolerance', { video_duration: duration + 0.501 }],
  ['unknown encryption', { video_list: [{ ...row(), encrypt_info: undefined }] }],
]) {
  test(`non-inline fallback rejects ${name}`, async () => {
    const f = fixture(reference(), model(patch));
    await assert.rejects(f.run(), { code: 'INVALID_RESPONSE' });
    assertClearOnly(f, 2);
  });
}

for (const [name, patch] of [
  ['missing asset', { video_id: undefined }],
  ['blank asset', { video_id: ' ' }],
  ['numeric asset', { video_id: 123 }],
  ['missing duration', { video_duration: undefined }],
  ['zero duration', { video_duration: 0 }],
]) {
  test(`an unconfirmed non-inline reference rejects ${name} before fallback`, async () => {
    const f = fixture(reference(patch), model());
    await assert.rejects(f.run(), { code: 'INVALID_RESPONSE' });
    assertClearOnly(f, 1);
  });
}

test('non-inline fallback accepts bounded duration rounding without changing request limits', async () => {
  const f = fixture(reference(), model({ video_duration: duration + 0.5 }));
  const result = await f.run();
  assert.equal(result.url, mediaUrl);
  assertClearOnly(f, 2);
  assert.equal(f.calls[1].signal, f.calls[0].signal);
  assert.ok(f.calls[1].timeout <= f.calls[0].timeout);
});

test('a slow model response leaves an independent fallback request cap inside the original total budget', async () => {
  const f = fixture(reference(), model(), { modelElapsedMs: 11000 });
  await f.run();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].timeout, 12000);
  assert.equal(f.calls[1].timeout, 9000);
  assertClearOnly(f, 2);
});

test('the independent fallback cap cannot extend a shorter caller deadline', async () => {
  const f = fixture(reference(), model(), { modelElapsedMs: 11000 });
  await f.run({ deadline: f.startedAt + 14000 });
  assert.equal(f.calls[1].timeout, 3000);
  assertClearOnly(f, 2);
});

test('an exhausted caller deadline cannot dispatch a fallback request', async () => {
  const f = fixture(reference(), model(), { modelElapsedMs: 11000 });
  await assert.rejects(f.run({ deadline: f.startedAt + 11000 }), { code: 'ETIMEDOUT' });
  assertClearOnly(f, 1);
});

for (const [extension, format] of [['mp4', 'mp4'], ['m3u8', 'hls']]) {
  test(`the clear model preserves the media format evidenced by .${extension}`, async () => {
    const f = fixture(model({ video_list: [{ ...row(), main_url: `https://qznovelvod.com/fixture.${extension}?signed=opaque` }] }));
    const result = await f.run();
    assert.equal(result.format, format);
    assert.equal(result.variants[0].format, format);
    assertClearOnly(f, 1);
  });
}

test('a DASH manifest is rejected explicitly instead of being delivered as an MP4', async () => {
  const f = fixture(model({ video_list: [{ ...row(), main_url: 'https://qznovelvod.com/fixture.mpd' }] }));
  await assert.rejects(f.run(), { code: 'UNSUPPORTED_MEDIA_FORMAT', faultCode: 'MEDIA_FORMAT_UNSUPPORTED' });
  assertClearOnly(f, 1);
});

for (const [name, options] of [
  ['no independent expectation', undefined],
  ['only expected duration', { expectedDuration: duration }],
  ['only expected asset', { expectedVideoId: assetId }],
  ['a different expected asset', { expectedVideoId: 'synthetic-other-asset', expectedDuration: duration }],
  ['a different expected duration', { expectedVideoId: assetId, expectedDuration: 240 }],
  ['an invalid expected duration', { expectedVideoId: assetId, expectedDuration: 0 }],
]) {
  test(`an unkeyed model rejects ${name}`, async () => {
    const f = fixture(model(), undefined, { unkeyed: true });
    await assert.rejects(f.run(options), { code: 'INVALID_RESPONSE' });
    assertClearOnly(f, 1);
  });
}

test('an unkeyed model requires both independent matching asset and full duration', async () => {
  const f = fixture(model(), undefined, { unkeyed: true });
  const result = await f.run({ expectedVideoId: assetId, expectedDuration: duration });
  assert.equal(result.vid, vid);
  assert.equal(result.url, mediaUrl);
  assert.equal(result.contentKey, null);
  assertClearOnly(f, 1);
});

for (const [name, options] of [
  ['a different expected asset', { expectedVideoId: 'synthetic-other-asset' }],
  ['a different expected duration', { expectedDuration: 240 }],
  ['an invalid expected duration', { expectedDuration: 0 }],
]) {
  test(`a keyed default model still rejects ${name}`, async () => {
    const f = fixture(model());
    await assert.rejects(f.run(options), { code: 'INVALID_RESPONSE' });
    assertClearOnly(f, 1);
  });
}

test('an exactly keyed clear model remains compatible without independent media metadata', async () => {
  const f = fixture(model({ video_id: undefined, video_duration: undefined }));
  const result = await f.run();
  assert.equal(result.vid, vid);
  assert.equal(result.url, mediaUrl);
  assertClearOnly(f, 1);
});
