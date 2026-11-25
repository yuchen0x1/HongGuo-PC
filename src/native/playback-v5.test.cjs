// SPDX-License-Identifier: GPL-3.0-only
// Offline signer checks use synthetic identities and deterministic randomness.
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { gzipSync } = require('node:zlib');
const { MODEL_PROFILE, UPSTREAM_PLAYBACK_PROFILE } = require('./playback-profiles');

const now = 1795564800000;
const values = {
  ...MODEL_PROFILE.app, device_id: '7000000000000000001', iid: '7000000000000000002',
  cdid: '00000000-0000-4000-8000-000000000003',
};
const body = gzipSync(Buffer.from(JSON.stringify({ fixture: true })));
const options = { base: MODEL_PROFILE.routes[0].endpoint, values, body, now };

function load() {
  const module = { exports: {} };
  const fixedCrypto = { ...crypto, randomBytes: size => Buffer.alloc(size, 7) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'playback-v5.js'), 'utf8'), {
    module, Buffer, URL, Date: { now: () => now },
    require(name) { return name === 'node:crypto' ? fixedCrypto : require(name); },
  }, { filename: 'playback-v5.js' });
  return module.exports.signPlaybackV5;
}

test('the default signature remains identical to the explicit original bundled profile', () => {
  const sign = load();
  const defaultSigned = sign(options);
  const explicitSigned = sign({ ...options, profileId: MODEL_PROFILE.id });
  assert.equal(defaultSigned.url, explicitSigned.url);
  assert.deepEqual(defaultSigned.headers, explicitSigned.headers);
  assert.equal(new URL(defaultSigned.url).searchParams.get('version_code'), '74532');
  assert.match(defaultSigned.headers['x-medusa'], /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(defaultSigned.headers['x-ss-stub'], crypto.createHash('md5').update(body).digest('hex').toUpperCase());
});

test('the source-only enum changes the Medusa field without altering the signed request bytes', () => {
  const sign = load();
  const original = sign(options);
  const upstream = sign({ ...options, profileId: UPSTREAM_PLAYBACK_PROFILE.id });
  assert.equal(upstream.url, original.url);
  assert.equal(upstream.headers['x-helios'], original.headers['x-helios']);
  assert.equal(upstream.headers['x-khronos'], original.headers['x-khronos']);
  assert.equal(upstream.headers['x-ss-stub'], original.headers['x-ss-stub']);
  assert.notEqual(upstream.headers['x-medusa'], original.headers['x-medusa']);
  const sourceRequest = sign({ ...options, base: UPSTREAM_PLAYBACK_PROFILE.routes[0].endpoint,
    values: { ...values, ...UPSTREAM_PLAYBACK_PROFILE.app }, profileId: UPSTREAM_PLAYBACK_PROFILE.id });
  assert.equal(new URL(sourceRequest.url).searchParams.get('version_code'), '74332');
  assert.equal(new URL(sourceRequest.url).searchParams.get('device_id'), values.device_id);
});

test('signing rejects arbitrary profile objects and field21 overrides before accessing their values', () => {
  const sign = load();
  for (const profileId of ['remote-config', '', 377, null, {}, { ...UPSTREAM_PLAYBACK_PROFILE }]) {
    assert.throws(() => sign({ ...options, profileId }), /Unknown bundled playback signing profile/);
  }
  for (const name of ['field21', 'medusaField21']) {
    const input = { ...options };
    Object.defineProperty(input, name, { enumerable: true, get() { assert.fail('must not read remote override'); } });
    assert.throws(() => sign(input), /not field21 overrides/);
  }
});

test('both bundled profiles retain bounded gzip and no-body signing validation', () => {
  const sign = load();
  for (const profile of [MODEL_PROFILE, UPSTREAM_PLAYBACK_PROFILE]) {
    const selected = { ...options, profileId: profile.id };
    for (const invalid of [undefined, Buffer.from('{}'), Buffer.from('1f8b08', 'hex'), Buffer.alloc(2 * 1024 * 1024 + 1)]) {
      assert.throws(() => sign({ ...selected, body: invalid }), /gzip Buffer/);
    }
    assert.throws(() => sign({ ...selected, values: { ...values, device_id: '0' } }), /positive decimal string/);
    assert.throws(() => sign({ ...selected, base: 'http://example.invalid/' }), /HTTPS/);
    const noBody = sign({ ...selected, body: null });
    assert.equal(noBody.headers['x-ss-stub'], undefined);
    assert.ok(noBody.headers['x-medusa']);
  }
});
