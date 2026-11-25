const assert = require('node:assert/strict');
const { test } = require('node:test');
const { routeDiagnostic, safeCode, sanitizePlaybackDiagnostics, sanitizePlaybackTrace,
  updatePlaybackRoute, playbackFailureMessage, createPlaybackDiagnostics } = require('./playback-diagnostics');
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
  for (const [error, expected] of [
    [{ code: 'EMPTY_RESPONSE' }, '播放接口返回空内容，未能取得可用片源，请稍后重试。'],
    [{ code: 'DEVICE_REGISTRATION_FAILED' }, '当前内容暂时无法播放，请稍后重试。'],
    [{ code: 'BUSINESS_REJECTED' }, '播放接口返回业务错误，本次已停止重复请求；请查看诊断详情。'],
    [{ code: 'SOURCE_UNAVAILABLE', sources: [{ source: 'app', code: 'EMPTY_RESPONSE', message: '签名失败 https://secret.invalid' }] },
      '播放接口返回空内容，未能取得可用片源，请稍后重试。'],
  ]) {
    const message = playbackFailureMessage(error);
    assert.equal(message, expected);
    assert.doesNotMatch(message, /签名|设备鉴权|登录|扫码|secret\.invalid/);
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
  for (const error of [{ code }, { faultCode: code }]) {
    const message = playbackFailureMessage(error);
    assert.equal(message, '官网当前播放入口不提供本集，请在官方客户端查看可用播放方式。');
    assert.doesNotMatch(message, /登录|扫码|付费|DRM|无权|权限|Cookie|secret/);
  }
  assert.equal(playbackFailureMessage({ code: 'SOURCE_UNAVAILABLE', sources: [
    { source: 'app', code: 'EMPTY_RESPONSE' }, { source: 'web', code, message: 'Cookie=secret' },
  ] }), '官网当前入口未提供本集，App 播放接口返回空响应；尚未取得本集播放源。');
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
      modelValid: index === 0, code: index === 0 ? '' : index === profile.routes.length - 1 ? 'DRM_UNSUPPORTED' : 'EMPTY_RESPONSE' });
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
  assert.equal(snapshot.counts.sourceAttempts, profile.routes.length);
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

test('each foreground play has a private independent diagnostic ID with bounded detached traces', () => {
  const collector = createPlaybackDiagnostics({ now: () => Date.UTC(2026, 10, 26, 4) });
  const requestId = 'private-episode-22-request';
  collector.setForeground(requestId);
  const first = collector.attempt(requestId);
  assert.match(first.diagnosticId, /^PLAY-20261126-[a-f0-9]{12}$/);
  assert.equal(collector.attempt(requestId).diagnosticId, first.diagnosticId);
  assert.deepEqual(first.steps.map(step => step.status), Array(6).fill('not-run'));
  collector.setForeground('other-private-episode-request');
  assert.notEqual(collector.attempt('other-private-episode-request').diagnosticId, first.diagnosticId);
  for (let i = 0; i < 90; i++) collector.record({ requestId, event: 'media-state', stage: 'media' });
  const trace = collector.attempt(requestId);
  assert.equal(trace.events.length, 40);
  trace.events[0].event = 'private'; trace.steps[0].status = 'private';
  assert.equal(collector.attempt(requestId).events[0].event, 'media-state');
  assert.equal(collector.attempt(requestId).steps[0].status, 'not-run');
  assert.doesNotMatch(JSON.stringify(collector.snapshot()), /private-episode|private-episode-request|requestId/);
  for (let i = 0; i < 32; i++) collector.setForeground(`bounded-${i}`);
  assert.deepEqual(collector.attempt(requestId), {}, 'old attempt lookup cannot grow the internal history without bound');
});

test('HTTP 200 empty response proves transport but cannot pass parsing, source validation or playback', () => {
  const collector = createPlaybackDiagnostics({ now: () => 1000 });
  const requestId = 'empty-episode';
  collector.setForeground(requestId);
  collector.record({ requestId, event: 'source-start' });
  collector.record({ requestId, type: 'source-request', sourceRoute: 'app', routeId: 'preload-primary',
    status: 200, code: 'EMPTY_RESPONSE', modelValid: false, elapsedMs: 123 });
  collector.record({ requestId, event: 'source-failure', stage: 'source', faultCode: 'API_EMPTY_RESPONSE', httpStatus: 200 });
  const trace = collector.attempt(requestId);
  assert.deepEqual(trace.steps.map(({ step, status }) => [step, status]), [
    ['source-request', 'passed'], ['response', 'failed'], ['source-validation', 'not-run'],
    ['media-load', 'not-run'], ['decode', 'not-run'], ['first-frame', 'not-run'],
  ]);
  assert.equal(trace.httpStatus, 200);
  assert.equal(trace.events[1].code, 'EMPTY_RESPONSE');
  assert.equal(trace.events[1].faultCode, 'API_EMPTY_RESPONSE');
  assert.equal(trace.events[1].requestDurationMs, 123);
  const snapshot = collector.snapshot();
  assert.equal(snapshot.counts.playbackSuccesses, 0);
  assert.equal(snapshot.lastSuccessAt, null);
  assert.equal(snapshot.lastFailure.diagnosticId, trace.diagnosticId);
});

test('source acceptance, media load, decode and rendered first frame remain distinct evidence', () => {
  const collector = createPlaybackDiagnostics({ now: () => 1000 });
  const requestId = 'media-evidence';
  const stages = () => Object.fromEntries(collector.attempt(requestId).steps.map(step => [step.step, step.status]));
  collector.setForeground(requestId);
  collector.record({ requestId, event: 'source-success', sourceRoute: 'web' });
  assert.deepEqual(stages(), { 'source-request': 'passed', response: 'passed', 'source-validation': 'passed',
    'media-load': 'pending', decode: 'not-run', 'first-frame': 'not-run' });
  collector.record({ requestId, event: 'media-state', stage: 'decode', mediaStatus: 'loading' });
  assert.equal(stages().decode, 'pending');
  assert.equal(stages()['first-frame'], 'not-run');
  collector.record({ requestId, event: 'media-state', stage: 'first-frame', mediaStatus: 'buffering' });
  assert.equal(stages()['first-frame'], 'pending');
  assert.equal(collector.snapshot().lastSuccessAt, null);
  collector.record({ requestId, event: 'playback-success', stage: 'first-frame', decoderStatus: 'native' });
  assert(Object.values(stages()).every(status => status === 'passed'));
  collector.record({ requestId, event: 'media-state', stage: 'decode', mediaStatus: 'paused' });
  collector.record({ requestId, event: 'media-state', stage: 'first-frame', mediaStatus: 'playing' });
  assert(Object.values(stages()).every(status => status === 'passed'), 'later state reports cannot undo rendered evidence');
  collector.record({ requestId, event: 'source-start' });
  assert.deepEqual(stages(), { 'source-request': 'pending', response: 'not-run', 'source-validation': 'not-run',
    'media-load': 'not-run', decode: 'not-run', 'first-frame': 'not-run' });
});

test('failure trace preserves actual HTTP status and only foreground failure replaces the recent failure', () => {
  const collector = createPlaybackDiagnostics({ now: () => 1000 });
  collector.setForeground('older');
  collector.setForeground('current');
  collector.record({ requestId: 'current', event: 'failure', stage: 'manifest', code: 'HLS_MANIFEST_FAILED',
    faultCode: 'MANIFEST_LOAD_FAILED', httpStatus: 403 });
  const first = collector.snapshot().lastFailure;
  assert.equal(first.httpStatus, 403);
  assert.deepEqual(first.steps.find(step => step.step === 'media-load'),
    { step: 'media-load', status: 'failed', code: 'HLS_MANIFEST_FAILED', httpStatus: 403 });
  collector.record({ requestId: 'older', event: 'source-failure', faultCode: 'API_EMPTY_RESPONSE', httpStatus: 200 });
  assert.deepEqual(collector.snapshot().lastFailure, first, 'a late prefetch failure cannot replace the current episode failure');
  first.steps[3].code = 'private';
  assert.equal(collector.snapshot().lastFailure.steps[3].code, 'HLS_MANIFEST_FAILED');
});

test('trace sanitization rejects untrusted IDs, arbitrary fields and invalid HTTP statuses', () => {
  const secret = 'Cookie private-token https://signed.invalid';
  const diagnosticId = 'PLAY-20261126-0123456789ab';
  for (const value of [null, false, secret, { diagnosticId: secret }]) assert.deepEqual(sanitizePlaybackTrace(value), {});
  const value = sanitizePlaybackDiagnostics({ diagnosticId, httpStatus: 999, cookie: secret,
    routes: [null, { source: 'app', code: secret, message: secret, httpStatus: 403 }],
    steps: [{ step: 'response', status: 'failed', code: 'INVALID_RESPONSE', httpStatus: 200, message: secret },
      { step: secret, status: 'failed' }],
    events: [{ at: 1000, event: 'source-attempt', sourceRoute: 'app', routeId: 'preload-primary',
      stage: 'source', code: 'INVALID_RESPONSE', httpStatus: 200, message: secret, cookie: secret },
    { at: 1000, event: secret }, { at: -1, event: 'failure' }],
  });
  assert.equal(value.diagnosticId, diagnosticId);
  assert.equal(value.httpStatus, undefined);
  assert.equal(value.routes[1].httpStatus, 403);
  assert.equal(value.events.length, 1);
  assert.equal(value.events[0].code, 'INVALID_RESPONSE');
  assert.deepEqual(value.steps, [{ step: 'response', status: 'failed', code: 'INVALID_RESPONSE', httpStatus: 200 }]);
  assert.doesNotMatch(JSON.stringify(value), /Cookie|private-token|signed\.invalid/);
  assert.doesNotThrow(() => sanitizePlaybackDiagnostics(null));
});

test('media trace keeps safe Axios transport codes alongside manifest and segment faults', () => {
  const collector = createPlaybackDiagnostics({ now: () => 1000 });
  collector.setForeground('manifest-http');
  collector.record({ requestId: 'manifest-http', event: 'failure', stage: 'manifest', code: 'ERR_BAD_REQUEST',
    faultCode: 'MANIFEST_LOAD_FAILED', httpStatus: 403, message: 'Cookie=private-token' });
  const event = collector.attempt('manifest-http').events.at(-1);
  assert.equal(event.code, 'ERR_BAD_REQUEST');
  assert.equal(event.faultCode, 'MANIFEST_LOAD_FAILED');
  assert.equal(event.httpStatus, 403);
  assert.doesNotMatch(JSON.stringify(collector.snapshot()), /Cookie|private-token/);
});
