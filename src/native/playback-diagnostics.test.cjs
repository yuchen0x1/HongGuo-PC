const assert = require('node:assert/strict');
const { test } = require('node:test');
const { routeDiagnostic, safeCode, sanitizePlaybackDiagnostics, updatePlaybackRoute, playbackFailureMessage, createPlaybackDiagnostics } = require('./playback-diagnostics');
const { getPlaybackProfile, UPSTREAM_PLAYBACK_PROFILE } = require('./playback-profiles');
const { OFFICIAL_WEB_PROFILE } = require('./official-web-playback');

test('route diagnostics preserve only known source and playback-stage fields', () => {
  const diagnostic = sanitizePlaybackDiagnostics({
    source: 'app',
    stage: 'first-frame',
    mediaRead: 'complete',
    mediaDecoded: 'passed',
    firstFrame: 'passed',
    sourceTrace: [
      routeDiagnostic('web', { attempted: true, status: 'failed', code: 'PREVIEW_ONLY' }),
      routeDiagnostic('app', {
        attempted: true, status: 'ready', initialization: 'completed',
        anonymousAccess: 'request-accepted', mediaAddress: true, mediaRead: 'complete',
      }),
    ],
    url: 'https://signed.invalid/video?token=secret',
    deviceId: 'private-device',
  });

  assert.equal(diagnostic.source, 'app');
  assert.equal(diagnostic.stage, 'first-frame');
  assert.equal(diagnostic.routes[0].code, 'PREVIEW_ONLY');
  assert.equal(diagnostic.routes[1].initialization, 'completed');
  assert.equal(diagnostic.routes[1].anonymousAccess, 'request-accepted');
  assert.doesNotMatch(JSON.stringify(diagnostic), /signed\.invalid|token=|secret|private-device/);
});

test('playback errors use evidence-based user text without guessing auth or signature causes', () => {
  for (const error of [
    { code: 'EMPTY_RESPONSE' },
    { code: 'DEVICE_REGISTRATION_FAILED' },
    { code: 'BUSINESS_REJECTED' },
    { code: 'SOURCE_UNAVAILABLE', sources: [{ source: 'app', code: 'EMPTY_RESPONSE', message: '签名失败 https://secret.invalid' }] },
  ]) {
    const message = playbackFailureMessage(error);
    assert.equal(message, '当前内容暂时无法播放，请稍后重试。');
    assert.doesNotMatch(message, /签名|设备鉴权|空响应|secret\.invalid/);
  }

  assert.equal(playbackFailureMessage({ code: 'ACCOUNT_REQUIRED' }), '当前内容需要红果官方账号授权。');
  assert.equal(playbackFailureMessage({ code: 'SOURCE_REMOVED' }), '该来源已移除，无法继续播放。');
  assert.equal(playbackFailureMessage({ code: 'PREVIEW_ONLY' }), '官网目前只提供预览，无法作为完整一集播放。');
  assert.equal(playbackFailureMessage({ code: 'NO_COMPATIBLE_SOURCE' }), '当前内容暂不支持此设备可用的视频格式。');
  assert.equal(playbackFailureMessage({ code: 'ETIMEDOUT' }), '网络连接失败，请检查网络后重试。');
  assert.equal(playbackFailureMessage({ code: 'TRANSCODE_FAILED' }), '本机未能生成兼容视频，请重新连接片源或稍后重试。');
});

test('media and first-frame results update only the matching provider route', () => {
  const initial = {
    source: 'app',
    routes: [routeDiagnostic('web', { attempted: true, status: 'failed', code: 'PREVIEW_ONLY' }),
      routeDiagnostic('app', { attempted: true, status: 'address-found', mediaAddress: true })],
  };
  const updated = updatePlaybackRoute(initial, 'app', {
    status: 'ready', mediaRead: 'partial', mediaDecoded: 'passed', firstFrame: 'passed',
  }, { stage: 'first-frame', mediaRead: 'partial', mediaDecoded: 'passed', firstFrame: 'passed' });

  assert.equal(updated.routes[0].status, 'failed');
  assert.equal(updated.routes[1].status, 'ready');
  assert.equal(updated.routes[1].firstFrame, 'passed');
  assert.equal(updated.stage, 'first-frame');
});

test('updating a provider preserves an earlier skipped route with the same source label', () => {
  const initial = {
    routes: [
      routeDiagnostic('web', { status: 'skipped' }),
      routeDiagnostic('app', { attempted: true, status: 'failed', code: 'EMPTY_RESPONSE' }),
      routeDiagnostic('web', { attempted: true, status: 'address-found', mediaAddress: true }),
    ],
  };
  const updated = updatePlaybackRoute(initial, 'web', { status: 'ready', mediaRead: 'partial' });

  assert.deepEqual(updated.routes.map(route => route.status), ['skipped', 'failed', 'ready']);
  assert.equal(updated.routes[0].attempted, false);
});

test('updating a provider keeps earlier failed attempts immutable', () => {
  const initial = {
    routes: [
      routeDiagnostic('web', { attempted: true, status: 'failed', code: 'HTTP_404' }),
      routeDiagnostic('app', { attempted: true, status: 'failed', code: 'EMPTY_RESPONSE' }),
      routeDiagnostic('web', { attempted: true, status: 'address-found', mediaAddress: true }),
    ],
  };
  const updated = updatePlaybackRoute(initial, 'web', { status: 'media-failed', code: 'MEDIA_TRANSFER_ERROR' });

  assert.deepEqual(updated.routes.map(route => route.status), ['failed', 'failed', 'media-failed']);
  assert.equal(updated.routes[0].code, 'HTTP_404');
  assert.equal(updated.routes[2].code, 'MEDIA_TRANSFER_ERROR');
});

test('only known diagnostic codes cross the renderer boundary', () => {
  assert.equal(safeCode('MEDIA_DECODE_ERROR'), 'MEDIA_DECODE_ERROR');
  assert.equal(safeCode('ERR_STREAM_PREMATURE_CLOSE'), 'ERR_STREAM_PREMATURE_CLOSE');
  assert.equal(safeCode('API_TOKEN:TOP_SECRET'), '');
  assert.equal(safeCode('https://signed.invalid'), '');
  assert.equal(sanitizePlaybackDiagnostics({ code: 'API_TOKEN:TOP_SECRET' }).code, undefined);
});

test('website episode unavailability crosses diagnostics as a fixed stop reason without claiming account permissions', () => {
  const code = 'WEB_EPISODE_UNAVAILABLE';
  assert.equal(safeCode(code), code);
  const diagnostic = sanitizePlaybackDiagnostics({ code, faultCode: code,
    routes: [routeDiagnostic('web', { attempted: true, status: 'failed', code, message: 'token=secret' })],
    message: 'Cookie=secret', url: 'https://signed.invalid/?token=secret' });
  assert.equal(diagnostic.code, code);
  assert.equal(diagnostic.faultCode, code);
  assert.equal(diagnostic.routes[0].code, code);
  for (const error of [{ code }, { faultCode: code }, { code: 'SOURCE_UNAVAILABLE',
    sources: [{ source: 'app', code: 'EMPTY_RESPONSE' }, { source: 'web', code, message: 'Cookie=secret' }] }]) {
    const message = playbackFailureMessage(error);
    assert.equal(message, '官网当前播放入口不提供本集，请在官方客户端查看可用播放方式。');
    assert.doesNotMatch(message, /登录|扫码|付费|DRM|无权|权限|Cookie|secret/);
  }
  const collector = createPlaybackDiagnostics();
  collector.record({ event: 'source-failure', sourceRoute: 'web', faultCode: code, message: 'token=secret' });
  const snapshot = collector.snapshot();
  assert.equal(snapshot.lastErrorCode, code);
  assert.equal(snapshot.faults[code], 1);
  assert.doesNotMatch(JSON.stringify({ diagnostic, snapshot }), /Cookie|token=|secret|signed\.invalid/);
});

test('protected media retains only its safe reason and directs users to an official authorized player', () => {
  const code = 'DRM_UNSUPPORTED';
  assert.equal(safeCode(code), code);
  const diagnostic = sanitizePlaybackDiagnostics({ code, faultCode: code,
    routes: [routeDiagnostic('app', { attempted: true, status: 'failed', code, message: 'Cookie=secret' })],
    message: 'token=secret', key: 'private-key', url: 'https://signed.invalid/?token=secret' });
  assert.equal(diagnostic.code, code);
  assert.equal(diagnostic.faultCode, undefined);
  assert.equal(diagnostic.routes[0].code, code);
  for (const error of [{ code }, { faultCode: code }, { code, faultCode: 'CODEC_UNSUPPORTED' },
    { code: 'SOURCE_UNAVAILABLE', sources: [{ code: 'WEB_EPISODE_UNAVAILABLE' }, { source: 'app', code }] },
    { sources: [{ sources: [{ code }] }] }]) {
    assert.equal(playbackFailureMessage(error), '本集返回受保护或加密片源，请使用官方授权播放器。');
  }
  const collector = createPlaybackDiagnostics();
  collector.record({ event: 'source-failure', sourceRoute: 'app', code, faultCode: 'CODEC_UNSUPPORTED',
    message: 'Cookie=secret', key: 'private-key' });
  const snapshot = collector.snapshot();
  assert.equal(snapshot.lastErrorCode, code);
  assert.equal(snapshot.events.at(-1).code, code);
  assert.equal(snapshot.events.at(-1).faultCode, undefined);
  assert.equal(snapshot.faults.CODEC_UNSUPPORTED, 0);
  assert.equal(snapshot.counts.playbackSuccesses, 0);
  assert.doesNotMatch(JSON.stringify({ diagnostic, snapshot }), /Cookie|token=|secret|private-key|signed\.invalid/);
});

test('diagnostic report omits credentials, identities, raw errors and signed addresses in every supplied field', () => {
  let now = 1000;
  const collector = createPlaybackDiagnostics({ appVersion: '6.33.0', now: () => now });
  const secret = 'PRIVATE_SENTINEL_8675309';
  const supplied = Object.fromEntries(['cookie', 'ck', 'password', 'token', 'sessionid', 'device_id', 'iid', 'cdid', 'url', 'headers', 'signature', 'key', 'message', 'path'].map(key => [key, secret]));
  collector.record({ event: 'source-start', ...supplied });
  collector.record({ event: 'source-attempt', sourceRoute: 'app', routeId: 'preload-primary', ...supplied });
  collector.record({ event: 'source-failure', sourceRoute: 'app', faultCode: 'API_EMPTY_RESPONSE', requestDurationMs: 312, ...supplied });
  collector.record({ event: secret, sourceRoute: 'app', faultCode: 'API_EMPTY_RESPONSE' });
  collector.record({ event: 'failure', sourceRoute: secret, routeId: secret, profileId: secret, profileVersion: secret, faultCode: secret, ...supplied });
  const result = collector.snapshot({ account: { signedIn: true, sessionValidity: 'valid', account: { id: secret, nickname: secret }, ...supplied },
    device: { state: 'ready', ...supplied }, profile: { id: secret, version: secret, ...supplied } });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.equal(result.accountState, 'signed-in');
  assert.equal(result.sessionValidity, 'valid');
  assert.equal(result.deviceState, 'ready');
  assert.equal(result.counts.sourceAttempts, 1);
  assert.equal(result.counts.sourceFailures, 1);
  assert.equal(result.lastErrorCode, 'API_EMPTY_RESPONSE');
  assert.equal(result.requestDurationMs, 312);
  assert.equal(result.profileId, getPlaybackProfile().id);
  assert.equal(result.events.length, 4);
});

test('address discovery never counts as decoded playback and recovery count survives new source requests', () => {
  let now = 1000;
  const collector = createPlaybackDiagnostics({ appVersion: '6.33.0', now: () => now });
  collector.record({ event: 'source-start' });
  collector.record({ event: 'source-attempt', sourceRoute: 'app' });
  collector.record({ event: 'source-success', sourceRoute: 'app' });
  assert.equal(collector.snapshot().lastSourceAt, 1000);
  assert.equal(collector.snapshot().lastSuccessAt, null);
  assert.equal(collector.snapshot().decoderStatus, 'pending');
  now = 2000;
  collector.record({ event: 'recovery', faultCode: 'CDN_UNAVAILABLE' });
  collector.record({ event: 'source-start' });
  assert.equal(collector.snapshot().recoveryCount, 1);
  collector.record({ event: 'playback-success', decoderStatus: 'native' });
  assert.equal(collector.snapshot().lastSuccessAt, 2000);
  assert.equal(collector.snapshot().mediaStatus, 'playing');
  assert.equal(collector.snapshot().decoderStatus, 'native');
  assert.equal(collector.snapshot().counts.playbackSuccesses, 1);
  collector.resetMedia();
  assert.equal(collector.snapshot().recoveryCount, 0);
  assert.equal(collector.snapshot().counts.recoveries, 1);
});

test('diagnostics keep a bounded detached event history and normalize account manager validity without leaking identities', () => {
  const collector = createPlaybackDiagnostics({ appVersion: 'cookie=private' });
  for (let i = 0; i < 90; i++) collector.record({ event: 'media-state', mediaStatus: 'buffering', decoderStatus: 'native' });
  const first = collector.snapshot({ account: { signedIn: false, sessionValidity: 'anonymous' } });
  assert.equal(first.appVersion, 'unknown');
  assert.equal(first.sessionValidity, 'none');
  assert.equal(first.events.length, 40);
  first.events[0].event = 'private'; first.counts.sourceAttempts = 500;
  assert.equal(collector.snapshot().events[0].event, 'media-state');
  assert.equal(collector.snapshot().counts.sourceAttempts, 0);
  assert.equal(collector.snapshot({ account: { signedIn: true, sessionValidity: 'unverified' } }).sessionValidity, 'unchecked');
  assert.equal(collector.snapshot({ account: { signedIn: true, sessionValidity: 'valid', checking: true } }).sessionValidity, 'checking');
  const expired = collector.snapshot({ account: { signedIn: false, sessionValidity: 'expired' } });
  assert.equal(expired.accountState, 'expired');
  assert.equal(expired.playbackAuthorization, 'unverified');
});

test('switching provider clears a stale App subroute instead of attributing it to website or local media', () => {
  const collector = createPlaybackDiagnostics();
  collector.record({ event: 'source-success', sourceRoute: 'app', routeId: 'preload-primary' });
  assert.equal(collector.snapshot().routeId, 'preload-primary');
  collector.record({ event: 'source-success', sourceRoute: 'web' });
  assert.equal(collector.snapshot().routeId, '');
  collector.record({ event: 'media-state', sourceRoute: 'local', routeId: 'preload-primary' });
  assert.equal(collector.snapshot().routeId, '');
});

test('versioned provider observations retain bounded per-route outcomes without claiming media success', () => {
  const collector = createPlaybackDiagnostics();
  const profile = getPlaybackProfile();
  collector.record({ type: 'source-request', profileId: profile.id, profileVersion: profile.version,
    routeId: 'preload-primary', code: 'EMPTY_RESPONSE', elapsedMs: 212, status: 200, modelValid: false,
    url: 'https://signed.invalid/?token=private' });
  collector.record({ type: 'source-request', routeId: 'preload-alternate', code: '', elapsedMs: 300, status: 200, modelValid: true });
  const snapshot = collector.snapshot();
  assert.equal(snapshot.counts.sourceAttempts, 2);
  assert.equal(snapshot.counts.sourceSuccesses, 0);
  assert.equal(snapshot.lastSuccessAt, null);
  assert.equal(snapshot.requestRoutes[0].lastFaultCode, 'API_EMPTY_RESPONSE');
  assert.equal(snapshot.requestRoutes[0].failures, 1);
  assert.equal(snapshot.requestRoutes[1].modelAcceptanceRate, 1);
  assert.equal(snapshot.requestRoutes[1].lastRequestDurationMs, 300);
  assert.equal(snapshot.routeId, 'preload-alternate');
  assert.doesNotMatch(JSON.stringify(snapshot), /signed\.invalid|token=private/);
});

test('current recovery budgets replace the display count without erasing cumulative recoveries', () => {
  const collector = createPlaybackDiagnostics();
  collector.record({ event: 'recovery', recoveryCount: 2 });
  assert.equal(collector.snapshot().recoveryCount, 2);
  collector.record({ event: 'source-start' });
  assert.equal(collector.snapshot().recoveryCount, 2);
  collector.record({ event: 'media-state', recoveryCount: 0 });
  assert.equal(collector.snapshot().recoveryCount, 0);
  assert.equal(collector.snapshot().counts.recoveries, 1);
  for (const recoveryCount of [-1, 0.5, Infinity, '4']) collector.record({ event: 'media-state', recoveryCount });
  assert.equal(collector.snapshot().recoveryCount, 0);
});

test('official public website observations keep their profile and metrics after an App configuration snapshot', () => {
  const collector = createPlaybackDiagnostics({ now: () => 1200 });
  const web = { sourceRoute: 'web', routeId: OFFICIAL_WEB_PROFILE.routeId,
    profileId: OFFICIAL_WEB_PROFILE.id, profileVersion: OFFICIAL_WEB_PROFILE.version };
  collector.record({ event: 'source-start' });
  collector.record({ type: 'source-request', ...web, elapsedMs: 320, status: 200, modelValid: true });
  collector.record({ event: 'source-success', ...web, requestDurationMs: 330 });
  const snapshot = collector.snapshot({ profile: getPlaybackProfile() });
  assert.equal(snapshot.sourceRoute, 'web');
  assert.equal(snapshot.routeId, web.routeId);
  assert.equal(snapshot.profileId, web.profileId);
  assert.equal(snapshot.profileVersion, web.profileVersion);
  assert.equal(snapshot.routes.find(route => route.source === 'web').attempts, 1);
  assert.equal(snapshot.routes.find(route => route.source === 'web').successes, 1);
  assert.equal(snapshot.routes.find(route => route.source === 'app').attempts, 0);
  assert.equal(snapshot.requestRoutes.find(route => route.routeId === web.routeId).modelsAccepted, 1);
  assert.equal(snapshot.lastSourceAt, 1200);
  assert.equal(snapshot.lastSuccessAt, null);
  assert.equal(snapshot.counts.playbackSuccesses, 0);
  assert.equal(snapshot.decoderStatus, 'pending');
  assert.equal(snapshot.mediaStatus, 'loading');
});

test('upstream source-only profile routes are measured without certifying playback or overwriting the observed profile', () => {
  const collector = createPlaybackDiagnostics({ now: () => 1200 });
  const profile = UPSTREAM_PLAYBACK_PROFILE;
  for (const [index, route] of profile.routes.entries()) {
    collector.record({ type: 'source-request', sourceRoute: 'app', profileId: profile.id,
      profileVersion: profile.version, routeId: route.id, status: 200, elapsedMs: index + 1,
      modelValid: index === 0, code: index === 0 ? '' : index === 3 ? 'DRM_UNSUPPORTED' : 'EMPTY_RESPONSE' });
  }
  const snapshot = collector.snapshot({ profile: getPlaybackProfile() });
  assert.equal(snapshot.sourceRoute, 'app');
  assert.equal(snapshot.profileId, profile.id);
  assert.equal(snapshot.profileVersion, profile.version);
  assert.equal(snapshot.routeId, profile.routes.at(-1).id);
  assert.equal(snapshot.lastErrorCode, 'DRM_UNSUPPORTED');
  assert.equal(snapshot.playbackAuthorization, 'unverified');
  assert.equal(snapshot.lastSuccessAt, null);
  assert.equal(snapshot.lastSourceAt, null);
  assert.equal(snapshot.counts.sourceAttempts, 4);
  assert.equal(snapshot.counts.sourceSuccesses, 0);
  assert.equal(snapshot.counts.playbackSuccesses, 0);
  for (const [index, route] of profile.routes.entries()) {
    const metrics = snapshot.requestRoutes.find(value => value.routeId === route.id);
    assert.equal(metrics.attempts, 1);
    assert.equal(metrics.modelsAccepted, index === 0 ? 1 : 0);
    assert.equal(metrics.failures, index === 0 ? 0 : 1);
  }
  const protectedRoute = snapshot.requestRoutes.find(value => value.routeId === profile.routes.at(-1).id);
  assert.equal(protectedRoute.lastErrorCode, 'DRM_UNSUPPORTED');
  assert.equal(protectedRoute.lastFaultCode, '');
  assert.equal(profile.evidence.mediaVerified, false);
});

test('profile pairs and subroutes cannot be attributed to another provider', () => {
  const collector = createPlaybackDiagnostics();
  const app = getPlaybackProfile();
  collector.record({ type: 'source-request', sourceRoute: 'web', routeId: 'preload-primary',
    profileId: app.id, profileVersion: OFFICIAL_WEB_PROFILE.version, status: 200, modelValid: true });
  const snapshot = collector.snapshot({ profile: { id: OFFICIAL_WEB_PROFILE.id, version: app.version } });
  assert.equal(snapshot.sourceRoute, 'web');
  assert.equal(snapshot.routeId, '');
  assert.equal(snapshot.profileId, '');
  assert.equal(snapshot.profileVersion, '');
  assert.equal(snapshot.requestRoutes.find(route => route.routeId === 'preload-primary').attempts, 0);
});

test('background source work retains aggregate history without overwriting foreground playback state', () => {
  let now = 1000;
  const collector = createPlaybackDiagnostics({ now: () => now });
  const foreground = 'foreground-private-request', background = 'background-private-request';
  assert.equal(collector.setForeground(foreground), true);
  assert.equal(collector.isForeground(foreground), true);
  assert.equal(collector.isForeground(background), false);
  for (const invalid of [undefined, null, {}, 'bad request', 'a'.repeat(129)]) {
    assert.equal(collector.setForeground(invalid), false);
  }
  const web = { sourceRoute: 'web', routeId: OFFICIAL_WEB_PROFILE.routeId,
    profileId: OFFICIAL_WEB_PROFILE.id, profileVersion: OFFICIAL_WEB_PROFILE.version };
  collector.record({ event: 'source-success', requestId: foreground, ...web, requestDurationMs: 123 });
  collector.record({ event: 'playback-success', requestId: foreground, mediaStatus: 'paused', decoderStatus: 'native', recoveryCount: 2 });
  const before = collector.snapshot();
  now = 2000;
  const app = getPlaybackProfile();
  collector.record({ event: 'source-start', requestId: background });
  collector.record({ type: 'source-request', requestId: background, sourceRoute: 'app', routeId: 'preload-primary',
    profileId: app.id, profileVersion: app.version, elapsedMs: 321, code: 'EMPTY_RESPONSE', status: 200, modelValid: false });
  collector.record({ event: 'source-failure', requestId: background, sourceRoute: 'app', faultCode: 'API_EMPTY_RESPONSE' });
  collector.record({ event: 'failure', sourceRoute: 'app', faultCode: 'NETWORK_TIMEOUT' });
  collector.record({ event: 'recovery', requestId: background, recoveryCount: 9 });
  const after = collector.snapshot({ profile: app });
  for (const key of ['sourceRoute', 'routeId', 'profileId', 'profileVersion', 'mediaStatus', 'decoderStatus',
    'stage', 'lastSourceAt', 'lastSuccessAt', 'lastErrorCode', 'requestDurationMs', 'recoveryCount']) {
    assert.equal(after[key], before[key], `${key} belongs to the foreground`);
  }
  assert.equal(after.counts.sourceAttempts, 1);
  assert.equal(after.counts.sourceFailures, 1);
  assert.equal(after.counts.recoveries, 1);
  assert.equal(after.faults.API_EMPTY_RESPONSE, 1);
  assert.equal(after.faults.NETWORK_TIMEOUT, 1);
  assert.equal(after.requestRoutes.find(route => route.routeId === 'preload-primary').failures, 1);
  assert(after.events.some(event => event.faultCode === 'API_EMPTY_RESPONSE'));
  assert.doesNotMatch(JSON.stringify(after), /foreground-private-request|background-private-request|requestId/);
});
