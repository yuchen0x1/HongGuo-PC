// Regression check for the current Hongguo playback protocol.
// The upstream player endpoint requires a gzip JSON POST and V5
// Helios/Medusa/Khronos headers; the older video_tab/551 path is no longer
// sufficient for ordinary playback.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { gunzipSync } = require('node:zlib');

const nativeDir = path.join(__dirname, '../src/native');
const vid = '7704685770241477657';
const media = 'https://v3-reading.qznovelvod.com/v5-fixture.mp4';

function load() {
  const calls = [];
  const identity = Object.freeze({
    device_id: '7000000000000000001',
    iid: '7000000000000000002',
    cdid: '00000000-0000-4000-8000-000000000003',
  });
  const axios = async config => {
    calls.push(config);
    assert.equal(config.maxRedirects, 0);
    assert.ok(config.signal);
    assert.equal(config.responseType, 'text');
    if (String(config.url).includes('/service/2/device_register/')) {
      return { status: 200, headers: {}, data: JSON.stringify({
        device_id_str: identity.device_id,
        install_id_str: identity.iid,
      }) };
    }
    assert.equal(config.method, 'POST', 'playback must use the V5 POST endpoint');
    assert.match(config.url, /\/novel\/player\/multi_video_model\/preload\/v1\?/);
    assert.equal(new URL(config.url).searchParams.get('version_code'), '74532');
    assert.equal(new URL(config.url).searchParams.get('version_name'), '7.4.5.32');
    assert.equal(config.headers['Content-Encoding'], 'gzip');
    assert.equal(config.headers['x-helios'] && typeof config.headers['x-helios'], 'string');
    assert.equal(config.headers['x-medusa'] && typeof config.headers['x-medusa'], 'string');
    assert.equal(config.headers['x-khronos'] && typeof config.headers['x-khronos'], 'string');
    assert.equal(config.headers['x-ss-stub'] && typeof config.headers['x-ss-stub'], 'string');
    assert.equal(config.headers['x-argus'], undefined);
    assert.equal(config.headers['x-ladon'], undefined);
    assert.ok(Buffer.isBuffer(config.data));
    const body = JSON.parse(gunzipSync(config.data).toString('utf8'));
    assert.equal(body.dr_scene, 'preload');
    assert.equal(body.biz_param.device_level, 2);
    assert.equal(body.biz_param.disable_video_relate_book, false);
    assert.deepEqual(body.mixed_video_id_map['1004'], [vid]);
    return { status: 200, headers: {}, data: JSON.stringify({
      code: 0,
      data: { [vid]: { video_model: JSON.stringify({
        video_list: [{ main_url: media, codec_type: 'h264', quality_desc: '720P', encrypt_info: { encrypt: false } }],
      }) } },
    }) };
  };
  const context = {
    Buffer, URL, URLSearchParams, AbortSignal,
    module: { exports: {} },
    require(name) {
      if (name === 'axios') return axios;
      if (name === './playback-device') return { createPlaybackIdentityManager: require(path.join(nativeDir, 'playback-device')).createPlaybackIdentityManager,
        registerPlaybackDevice: async () => identity };
      if (name === './playback-profiles') return require(path.join(nativeDir, 'playback-profiles'));
      if (name === './sm3') return require(path.join(nativeDir, 'sm3'));
      if (name === './download-quality') return require(path.join(nativeDir, 'download-quality'));
      if (name === './playback-signature') return require(path.join(nativeDir, 'playback-signature'));
      if (name === './playback-v5') return require(path.join(nativeDir, 'playback-v5'));
      if (name === './request-signal') return require(path.join(nativeDir, 'request-signal'));
      if (name === 'node:zlib' || name === 'node:timers/promises') return require(name);
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(nativeDir, 'app-source.js'), 'utf8'), context, {
    filename: path.join(nativeDir, 'app-source.js'),
  });
  return { fetch: context.module.exports.fetchAppPlayUrl, calls };
}

(async () => {
  const fixture = load();
  const result = await fixture.fetch(vid, { quality: 'auto' });
  assert.equal(result.source, 'app');
  assert.equal(result.url, media);
  assert.equal(fixture.calls.filter(call => String(call.url).includes('/preload/v1?')).length, 1);
  console.log('PASS V5 playback request uses gzip body, current endpoint and signed headers');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
