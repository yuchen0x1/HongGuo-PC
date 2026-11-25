const assert = require('node:assert/strict');
const test = require('node:test');
const { MODEL_PROFILE, DEVICE_REGISTRATION, createRequestProfileManager } = require('./playback-profiles');
const { inspectPlaybackAuthProbeResponse } = require('./app-source');

test('the versioned request record keeps the jointly verified profile and signature settings together', () => {
  assert.equal(MODEL_PROFILE.app.version_code, '74532');
  assert.equal(MODEL_PROFILE.app.version_name, '7.4.5.32');
  assert.equal(MODEL_PROFILE.signature.medusaField21, 312);
  assert.equal(MODEL_PROFILE.body.dr_scene, 'preload');
  assert.equal(MODEL_PROFILE.body.biz_param.device_level, 2);
  assert.ok(MODEL_PROFILE.routes.every(route => new URL(route.endpoint).protocol === 'https:'));
  assert.ok(Object.isFrozen(MODEL_PROFILE.body.biz_param));
  assert.ok(Object.isFrozen(DEVICE_REGISTRATION.profile.custom));
  assert.equal(DEVICE_REGISTRATION.profile.version_code, 73932, 'registration and request versions have separate recorded lifetimes');
});

test('unknown and incompatible configurations immediately fall back to the last verified bundled record', () => {
  const next = { ...MODEL_PROFILE, id: 'regression-compatible-profile', version: 'test' };
  const rejected = { ...MODEL_PROFILE, id: 'regression-incompatible-profile', app: { ...MODEL_PROFILE.app, version_code: '74332' } };
  const profiles = createRequestProfileManager({ profiles: [MODEL_PROFILE, next, rejected] });
  assert.equal(profiles.select(next.id), next);
  profiles.record({ routeId: 'preload-primary', code: 'INVALID_RESPONSE' });
  assert.equal(profiles.current(), MODEL_PROFILE, 'a response-shape failure restores the previous validated configuration');
  assert.equal(profiles.select('remote-unrecognized-profile'), MODEL_PROFILE);
  assert.equal(profiles.select(rejected.id), MODEL_PROFILE, 'the historically rejected 74332 profile is never a fallback');
  assert.throws(() => createRequestProfileManager({ profiles: [rejected], lastVerifiedId: rejected.id }));
  for (const overrides of [
    { signature: { scheme: 'helios-medusa-v5', medusaField21: 377 } },
    { body: { ...MODEL_PROFILE.body, biz_param: { ...MODEL_PROFILE.body.biz_param, device_level: 3 } } },
    { headers: { ...MODEL_PROFILE.headers, Cookie: 'PRIVATE' } },
    { timeout: { ...MODEL_PROFILE.timeout, totalMs: 300000 } },
  ]) {
    const invalid = { ...MODEL_PROFILE, ...overrides };
    assert.throws(() => createRequestProfileManager({ profiles: [invalid] }), 'unverified wire combinations must fail closed');
  }
});

test('a successful model records evidence separately from media and never retains arbitrary diagnostic strings', () => {
  const profiles = createRequestProfileManager();
  profiles.record({ routeId: 'preload-primary', code: 'EMPTY_RESPONSE', elapsedMs: 45, at: 100 });
  profiles.record({ routeId: 'preload-primary', modelValid: true, elapsedMs: 80, at: 200 });
  profiles.record({ routeId: 'preload-alternate', code: 'PRIVATE_COOKIE_AND_MEDIA_URL', elapsedMs: 9 });
  profiles.record({ routeId: 'PRIVATE_DEVICE_IDENTIFIER', code: 'PRIVATE_RESPONSE' });
  const status = profiles.status();
  assert.equal(status.state, 'verified-this-process');
  assert.equal(status.lastModelSuccessAt, 200);
  assert.equal(status.routes[0].requests, 2);
  assert.equal(status.routes[0].succeeded, 1);
  assert.equal(status.routes[0].failed, 1);
  assert.equal(status.routes[1].lastError, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE|cookie|device_id|signature|mediaUrl|decoded/i);
});

test('account authorization probe inspects only the exact episode and exports boolean structure evidence', () => {
  const vid = '12345';
  const model = { video_list: [{ main_url: 'https://qznovelvod.com/private?token=PRIVATE', spade_a: 'PRIVATE' }] };
  for (const data of [
    { [vid]: { video_model: model } },
    { '1004': { [vid]: { video_model: JSON.stringify(model) } } },
    { video_model_data: { [vid]: { video_model: model } } },
  ]) {
    assert.deepEqual(inspectPlaybackAuthProbeResponse({ code: 0, data }, vid), {
      businessAccepted: true, episodeMatches: true, modelPresent: true, mediaModelPresent: true,
    });
  }
  const mismatch = inspectPlaybackAuthProbeResponse({ data: { other: { video_model: model }, video_model: model } }, vid);
  assert.equal(mismatch.episodeMatches, false);
  assert.equal(mismatch.mediaModelPresent, false);
  assert.equal(inspectPlaybackAuthProbeResponse({ code: 403, data: { [vid]: { video_model: model } } }, vid).businessAccepted, false);
  assert.equal(inspectPlaybackAuthProbeResponse({ data: { [vid]: { video_model: 'not JSON' } } }, vid).modelPresent, false);
  assert.doesNotMatch(JSON.stringify(inspectPlaybackAuthProbeResponse({ data: { [vid]: { video_model: model } } }, vid)), /PRIVATE|qznovelvod/);
});
