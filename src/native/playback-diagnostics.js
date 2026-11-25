const { FAULT_CODES, isPlaybackFault, isProtectedPlaybackError, classifyPlaybackError, playbackRecoveryPolicy } = require('./playback-errors');
const SOURCES = new Set(['web', 'app', 'api', 'xifan', 'custom']);
const ROUTE_STATUSES = new Set(['skipped', 'failed', 'address-found', 'media-failed', 'ready']);
const INITIALIZATION = new Set(['not-required', 'attempted', 'completed', 'failed', 'unknown']);
const ANONYMOUS_ACCESS = new Set(['explicitly-allowed', 'request-accepted', 'denied', 'unknown']);
const MEDIA_READ = new Set(['not-requested', 'partial', 'complete', 'failed', 'unknown']);
const CHECK_STATUS = new Set(['not-tested', 'passed', 'failed']);
const SAFE_CODES = new Set([
  ...FAULT_CODES,
  'ACCOUNT_REQUIRED', 'ABORT_ERR', 'BUSINESS_REJECTED', 'DEVICE_REGISTRATION_FAILED', 'DRM_UNSUPPORTED',
  'EACCES', 'EBUSY', 'ECONNABORTED', 'ECONNRESET', 'EDQUOT', 'EEXIST', 'EFBIG', 'EIO',
  'EISDIR', 'EMFILE', 'EMLINK', 'ENAMETOOLONG', 'ENETUNREACH', 'ENFILE', 'ENOENT',
  'ENOTDIR', 'ENOSPC', 'ENOTFOUND', 'EPIPE', 'EROFS', 'ETIMEDOUT', 'EAI_AGAIN', 'EPERM',
  'EMPTY_RESPONSE', 'ERR_BAD_REQUEST', 'ERR_BAD_RESPONSE', 'ERR_CANCELED', 'ERR_NETWORK',
  'ERR_STREAM_PREMATURE_CLOSE', 'ERR_WEB_MEDIA_ADDRESS',
  'HTTP_300', 'HTTP_301', 'HTTP_302', 'HTTP_303', 'HTTP_304', 'HTTP_305', 'HTTP_307', 'HTTP_308',
  'HTTP_400', 'HTTP_401', 'HTTP_402', 'HTTP_403', 'HTTP_404', 'HTTP_405', 'HTTP_408',
  'HTTP_409', 'HTTP_410', 'HTTP_413', 'HTTP_416', 'HTTP_422', 'HTTP_429',
  'HTTP_500', 'HTTP_501', 'HTTP_502', 'HTTP_503', 'HTTP_504', 'HTTP_505',
  'INVALID_RESPONSE', 'LOCAL_MEDIA_TOOL_ERROR', 'MEDIA_DECODE_ERROR', 'MEDIA_TOO_LARGE',
  'MEDIA_TRANSFER_ERROR', 'MISSING_MODEL', 'NETWORK_ERROR', 'NO_COMPATIBLE_SOURCE',
  'NO_PLAYABLE_SOURCE', 'PREVIEW_ONLY', 'QUALITY_UNAVAILABLE', 'SECURITY_BLOCKED', 'TRANSCODE_FAILED',
  'SOURCE_REMOVED', 'SOURCE_UNAVAILABLE', 'TIMEOUT',
  'UNSUPPORTED_MEDIA_FORMAT', 'MEDIA_ERR_SRC_NOT_SUPPORTED', 'PLAYER_INTERNAL_ERROR',
  'HLS_MANIFEST_FAILED', 'DASH_MANIFEST_FAILED', 'MANIFEST_FETCH_FAILED', 'HLS_SEGMENT_FAILED', 'DASH_SEGMENT_FAILED',
]);

function safeCode(value) {
  const code = String(value || '');
  return SAFE_CODES.has(code) || /^HTTP_[345]\d{2}$/.test(code) ? code : '';
}

function safeHttpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : 0;
}

const TRACE_STEPS = ['source-request', 'response', 'source-validation', 'media-load', 'decode', 'first-frame'];
const TRACE_STATUSES = new Set(['not-run', 'pending', 'passed', 'failed']);
const TRACE_ROUTE_IDS = new Set(['preload-primary', 'preload-alternate', 'video-tab', 'upstream-grouped-b',
  'upstream-player-b', 'upstream-player-a', 'upstream-model-a', 'upstream-model-c', 'official-web-public-fallback']);
const validDiagnosticId = value => typeof value === 'string' && /^PLAY-\d{8}-[a-f0-9]{12}$/.test(value);

function safeTraceEvent(value) {
  if (!value || !EVENTS.has(value.event)) return null;
  const at = boundedNumber(value.at, 8640000000000000);
  if (at === null) return null;
  const httpStatus = safeHttpStatus(value.httpStatus);
  const requestDurationMs = boundedNumber(value.requestDurationMs, 600000);
  return { at, event: value.event,
    ...(DIAGNOSTIC_SOURCES.has(value.sourceRoute) ? { sourceRoute: value.sourceRoute } : {}),
    ...(TRACE_ROUTE_IDS.has(value.routeId) ? { routeId: value.routeId } : {}),
    ...(STAGES.has(value.stage) ? { stage: value.stage } : {}),
    ...(safeCode(value.code) ? { code: safeCode(value.code) } : {}),
    ...(isPlaybackFault(value.faultCode) ? { faultCode: value.faultCode } : {}),
    ...(httpStatus ? { httpStatus } : {}),
    ...(requestDurationMs !== null ? { requestDurationMs } : {}) };
}

function sanitizePlaybackTrace(value = {}) {
  if (!validDiagnosticId(value?.diagnosticId)) return {};
  const httpStatus = safeHttpStatus(value.httpStatus);
  const steps = (Array.isArray(value.steps) ? value.steps : []).slice(0, 8).flatMap(item => {
    if (!TRACE_STEPS.includes(item?.step) || !TRACE_STATUSES.has(item.status)) return [];
    const status = safeHttpStatus(item.httpStatus);
    return [{ step: item.step, status: item.status,
      ...(safeCode(item.code) ? { code: safeCode(item.code) } : {}), ...(status ? { httpStatus: status } : {}) }];
  });
  return { diagnosticId: value.diagnosticId,
    ...(httpStatus ? { httpStatus } : {}),
    events: (Array.isArray(value.events) ? value.events : []).slice(-40).map(safeTraceEvent).filter(Boolean), steps };
}

function routeDiagnostic(source, values = {}) {
  if (!values || typeof values !== 'object') values = {};
  const name = SOURCES.has(source) ? source : 'unknown';
  const status = ROUTE_STATUSES.has(values.status) ? values.status : 'skipped';
  const initialization = INITIALIZATION.has(values.initialization) ? values.initialization : 'unknown';
  const anonymousAccess = ANONYMOUS_ACCESS.has(values.anonymousAccess) ? values.anonymousAccess : 'unknown';
  return {
    source: name,
    attempted: values.attempted === true,
    status,
    initialization,
    anonymousAccess,
    mediaAddress: values.mediaAddress === true,
    mediaRead: MEDIA_READ.has(values.mediaRead) ? values.mediaRead : 'not-requested',
    mediaDecoded: CHECK_STATUS.has(values.mediaDecoded) ? values.mediaDecoded : 'not-tested',
    firstFrame: CHECK_STATUS.has(values.firstFrame) ? values.firstFrame : 'not-tested',
    ...(safeCode(values.code) ? { code: safeCode(values.code) } : {}),
    ...(safeHttpStatus(values.httpStatus || values.statusCode) ? { httpStatus: safeHttpStatus(values.httpStatus || values.statusCode) } : {}),
  };
}

function sanitizePlaybackDiagnostics(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const routes = Array.isArray(value.routes || value.sourceTrace)
    ? (value.routes || value.sourceTrace).slice(-40).map(route => routeDiagnostic(route?.source, route))
    : [];
  const source = SOURCES.has(value.source) ? value.source : routes.find(route => route.status === 'address-found' || route.status === 'ready')?.source || '';
  const stage = STAGES.has(value.stage) ? value.stage : 'source';
  return {
    ...sanitizePlaybackTrace(value),
    stage,
    source,
    mediaRead: MEDIA_READ.has(value.mediaRead) ? value.mediaRead : 'not-requested',
    mediaDecoded: CHECK_STATUS.has(value.mediaDecoded) ? value.mediaDecoded : 'not-tested',
    firstFrame: CHECK_STATUS.has(value.firstFrame) ? value.firstFrame : 'not-tested',
    ...(safeCode(value.code) ? { code: safeCode(value.code) } : {}),
    ...(isPlaybackFault(value.faultCode) ? { faultCode: value.faultCode } : {}),
    ...(safeHttpStatus(value.httpStatus || value.status) ? { httpStatus: safeHttpStatus(value.httpStatus || value.status) } : {}),
    routes,
  };
}

function updatePlaybackRoute(value, source, updates = {}, fields = {}) {
  const current = sanitizePlaybackDiagnostics(value);
  const routes = current.routes.slice();
  let index = -1;
  for (let i = routes.length - 1; i >= 0; i--) {
    if (routes[i].source === source && routes[i].attempted && routes[i].status !== 'skipped') {
      index = i;
      break;
    }
  }
  if (index >= 0) routes[index] = routeDiagnostic(source, { ...routes[index], ...updates });
  else routes.push(routeDiagnostic(source, { attempted: true, status: 'address-found', mediaAddress: true, ...updates }));
  return sanitizePlaybackDiagnostics({ ...current, ...fields, source, routes });
}

function playbackFailureMessage(error = {}) {
  if (isProtectedPlaybackError(error)) return playbackRecoveryPolicy('DRM_UNSUPPORTED').message;
  const classified = classifyPlaybackError(error);
  if (classified === 'SOURCE_PROVIDERS_FAILED') return playbackRecoveryPolicy(classified).message;
  if (isPlaybackFault(error.faultCode) || isPlaybackFault(error.code)) {
    return playbackRecoveryPolicy(isPlaybackFault(error.faultCode) ? error.faultCode : error.code).message;
  }
  const code = safeCode(error.code);
  const sourceCodes = (Array.isArray(error.sources) ? error.sources : [])
    .map(source => safeCode(source?.code)).filter(Boolean);
  const codes = new Set([code, ...sourceCodes]);

  if (error.requiresAccount === true || code === 'ACCOUNT_REQUIRED') {
    return '当前内容需要红果官方账号授权。';
  }
  if (classified === 'WEB_EPISODE_UNAVAILABLE') {
    return playbackRecoveryPolicy('WEB_EPISODE_UNAVAILABLE').message;
  }
  if (code === 'SOURCE_REMOVED') return '该来源已移除，无法继续播放。';
  if (code === 'PREVIEW_ONLY' || sourceCodes.length === 1 && sourceCodes[0] === 'PREVIEW_ONLY') {
    return '官网目前只提供预览，无法作为完整一集播放。';
  }
  if (codes.has('NO_COMPATIBLE_SOURCE') || codes.has('QUALITY_UNAVAILABLE')) {
    return codes.has('QUALITY_UNAVAILABLE')
      ? '当前所选清晰度暂不可用。'
      : '当前内容暂不支持此设备可用的视频格式。';
  }
  if (['NETWORK_ERROR', 'TIMEOUT', 'ETIMEDOUT', 'ECONNABORTED', 'ERR_NETWORK'].some(value => codes.has(value))) {
    return '网络连接失败，请检查网络后重试。';
  }
  if (codes.has('MEDIA_DECODE_ERROR')) return '本机暂时无法解码该视频，可尝试兼容模式。';
  if (code === 'TRANSCODE_FAILED') return '本机未能生成兼容视频，请重新连接片源或稍后重试。';
  if (code === 'MEDIA_TOO_LARGE') return '当前视频超出在线播放限制，请改用下载后播放。';
  if (code === 'LOCAL_MEDIA_TOOL_ERROR') return '本机媒体组件不可用，请修复安装后重试。';
  if (classified) return playbackRecoveryPolicy(classified).message;
  return '当前内容暂时无法播放，请稍后重试。';
}

const DIAGNOSTIC_SOURCES = new Set([...SOURCES, 'local']);
const ACCOUNT_STATES = new Set(['signed-in', 'signed-out', 'expired', 'unauthorized', 'unknown']);
const SESSION_STATES = new Set(['valid', 'expired', 'invalid', 'unchecked', 'checking', 'unavailable', 'none']);
const DEVICE_STATES = new Set(['uninitialized', 'registering', 'ready', 'expired', 'failed', 'unknown']);
const MEDIA_STATES = new Set(['idle', 'resolving', 'loading', 'ready', 'playing', 'paused', 'buffering', 'ended', 'failed', 'cancelled']);
const DECODER_STATES = new Set(['idle', 'pending', 'native', 'compat', 'unsupported', 'failed']);
const EVENTS = new Set(['source-start', 'source-attempt', 'source-success', 'source-failure', 'recovery', 'media-state', 'playback-success', 'failure', 'cancelled']);
const STAGES = new Set(['source', 'media', 'hls', 'manifest', 'segment', 'decrypt', 'decode', 'first-frame', 'player']);

function boundedNumber(value, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum ? Math.round(value) : null;
}

function createPlaybackDiagnostics({ appVersion = '', now = Date.now } = {}) {
  // Profile identifiers come from the shipped configuration, never from request URLs or remote error text.
  const { getPlaybackProfile, UPSTREAM_PLAYBACK_PROFILE } = require('./playback-profiles');
  const profile = getPlaybackProfile();
  const { OFFICIAL_WEB_PROFILE } = require('./official-web-playback');
  const knownProfiles = new Map([
    [profile.id, { version: profile.version, source: 'app' }],
    [UPSTREAM_PLAYBACK_PROFILE.id, { version: UPSTREAM_PLAYBACK_PROFILE.version, source: 'app' }],
    [OFFICIAL_WEB_PROFILE.id, { version: OFFICIAL_WEB_PROFILE.version, source: 'web' }],
  ]);
  const knownRoutes = new Map([
    ...profile.routes.map(route => [route.id, 'app']),
    ...UPSTREAM_PLAYBACK_PROFILE.routes.map(route => [route.id, 'app']),
    [OFFICIAL_WEB_PROFILE.routeId, 'web'],
  ]);
  const version = /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[a-z]{1,12}\.\d{1,3})?$/.test(appVersion) ? appVersion : 'unknown';
  const state = {
    appVersion: version, accountState: 'unknown', sessionValidity: 'unchecked', deviceState: 'uninitialized',
    playbackAuthorization: 'unverified', accountDeviceAssociation: 'unlinked',
    profileId: profile.id, profileVersion: profile.version, sourceRoute: '', routeId: '',
    lastSourceAt: null, lastSuccessAt: null, lastErrorCode: '', recoveryCount: 0,
    requestDurationMs: null, mediaStatus: 'idle', decoderStatus: 'idle', stage: 'source',
  };
  const counts = { sourceAttempts: 0, sourceSuccesses: 0, sourceFailures: 0, playbackSuccesses: 0, recoveries: 0 };
  const routeCounts = Object.fromEntries([...DIAGNOSTIC_SOURCES].map(source => [source, { attempts: 0, successes: 0, failures: 0 }]));
  const requestRoutes = Object.fromEntries([...knownRoutes.keys()].map(routeId => [routeId,
    { attempts: 0, modelsAccepted: 0, failures: 0, lastFaultCode: '', lastErrorCode: '', lastRequestDurationMs: null }]));
  const faultCounts = Object.fromEntries(FAULT_CODES.map(code => [code, 0]));
  const events = [];
  const attempts = new Map();
  let lastFailure = null;
  let foregroundRequestId = '';
  const validRequestId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  const isForeground = requestId => !!foregroundRequestId && requestId === foregroundRequestId;
  const tick = () => {
    const value = now();
    return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 ? value : Date.now();
  };

  const attempt = requestId => sanitizePlaybackTrace(attempts.get(requestId));
  function beginAttempt(requestId) {
    if (attempts.has(requestId)) return;
    const date = new Date(tick());
    const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const diagnosticId = `PLAY-${day}-${require('node:crypto').randomBytes(6).toString('hex')}`;
    attempts.set(requestId, { diagnosticId, events: [], steps: TRACE_STEPS.map(step => ({ step, status: 'not-run' })) });
    if (attempts.size > 32) attempts.delete(attempts.keys().next().value);
  }

  function recordAttempt(requestId, value, providerRequest, modelValid) {
    const active = attempts.get(requestId);
    if (!active) return;
    active.events.push(value);
    if (active.events.length > 40) active.events.shift();
    if (value.httpStatus) active.httpStatus = value.httpStatus;
    const setStep = (step, status, failure = false) => {
      const index = TRACE_STEPS.indexOf(step);
      active.steps[index] = { step, status,
        ...(failure && (value.code || value.faultCode) ? { code: value.code || value.faultCode } : {}),
        ...(value.httpStatus ? { httpStatus: value.httpStatus } : {}) };
    };
    const markFailure = () => {
      const fault = value.faultCode;
      const step = ['decode', 'first-frame'].includes(value.stage) ? value.stage
        : ['media', 'hls', 'manifest', 'segment', 'decrypt', 'player'].includes(value.stage) ? 'media-load'
          : ['API_PARSE_ERROR', 'API_EMPTY_RESPONSE'].includes(fault) ? 'response'
            : ['SOURCE_EMPTY', 'API_BUSINESS_ERROR', 'MEDIA_FORMAT_UNSUPPORTED'].includes(fault) ? 'source-validation' : 'source-request';
      setStep(step, 'failed', true);
    };
    if (value.event === 'source-start') {
      active.steps = TRACE_STEPS.map(step => ({ step, status: 'not-run' }));
      delete active.httpStatus;
      setStep('source-request', 'pending');
    }
    if (providerRequest) {
      // Receipt of HTTP headers proves transport only. Model acceptance is
      // the separate evidence that response and source validation completed.
      setStep('source-request', value.httpStatus || modelValid ? 'passed' : 'failed', !modelValid);
      if (modelValid) {
        setStep('response', 'passed'); setStep('source-validation', 'passed');
      } else if (['API_PARSE_ERROR', 'API_EMPTY_RESPONSE'].includes(value.faultCode)) setStep('response', 'failed', true);
      else if (['API_BUSINESS_ERROR', 'SOURCE_EMPTY', 'MEDIA_FORMAT_UNSUPPORTED'].includes(value.faultCode)) {
        setStep('response', 'passed'); setStep('source-validation', 'failed', true);
      }
    }
    if (value.event === 'source-success') {
      for (const step of ['source-request', 'response', 'source-validation']) setStep(step, 'passed');
      setStep('media-load', 'pending');
    }
    if (value.event === 'media-state') {
      if (value.stage === 'source') {
        if (active.steps[0].status === 'not-run') setStep('source-request', 'pending');
      } else if (value.stage === 'decode' && active.steps[4].status !== 'passed') setStep('decode', 'pending');
      else if (value.stage === 'first-frame' && active.steps[5].status !== 'passed') setStep('first-frame', 'pending');
      else if (value.stage === 'media' && active.steps[3].status === 'not-run') setStep('media-load', 'pending');
    }
    if (value.event === 'playback-success') {
      for (const step of ['media-load', 'decode', 'first-frame']) setStep(step, 'passed');
    }
    if (value.event === 'source-failure' || value.event === 'failure') markFailure();
    if (['source-failure', 'failure'].includes(value.event) && isForeground(requestId)) lastFailure = attempt(requestId);
  }

  function record(value = {}) {
    if (!value || typeof value !== 'object') return;
    const providerRequest = value.type === 'source-request';
    const event = providerRequest ? 'source-attempt' : EVENTS.has(value.event) ? value.event : EVENTS.has(value.type) ? value.type : '';
    if (!event) return;
    const at = tick();
    const sourceRoute = DIAGNOSTIC_SOURCES.has(value.sourceRoute) ? value.sourceRoute
      : providerRequest && value.sourceRoute === undefined ? 'app' : '';
    const routeId = knownRoutes.get(value.routeId) === sourceRoute ? value.routeId : '';
    const suppliedProfile = knownProfiles.get(value.profileId);
    const validProfile = !!suppliedProfile && suppliedProfile.version === value.profileVersion && suppliedProfile.source === sourceRoute;
    const current = !foregroundRequestId || isForeground(value.requestId);
    const protectedPlayback = isProtectedPlaybackError(value);
    const faultCode = protectedPlayback ? '' : isPlaybackFault(value.faultCode) ? value.faultCode
      : providerRequest ? classifyPlaybackError({ code: value.code, status: value.status, httpStatus: value.httpStatus,
        stage: value.stage }) : '';
    const errorCode = protectedPlayback ? 'DRM_UNSUPPORTED' : faultCode || safeCode(value.code);
    const rawCode = protectedPlayback ? 'DRM_UNSUPPORTED' : safeCode(value.code);
    const httpStatus = safeHttpStatus(value.httpStatus || value.status)
      || safeHttpStatus(Number(/^HTTP_(\d{3})$/.exec(errorCode)?.[1]));
    const requestDurationMs = boundedNumber(providerRequest ? value.elapsedMs : value.requestDurationMs, 600000);
    const recoveryCount = Number.isSafeInteger(value.recoveryCount) && value.recoveryCount >= 0
      && value.recoveryCount <= 1000000 ? value.recoveryCount : null;
    if (current) {
      if (sourceRoute && state.sourceRoute !== sourceRoute) {
        state.routeId = '';
        if (knownProfiles.get(state.profileId)?.source !== sourceRoute) {
          state.profileId = '';
          state.profileVersion = '';
        }
      }
      if (sourceRoute) state.sourceRoute = sourceRoute;
      if (routeId) state.routeId = routeId;
      if (validProfile) { state.profileId = value.profileId; state.profileVersion = value.profileVersion; }
      if (STAGES.has(value.stage)) state.stage = value.stage;
      if (MEDIA_STATES.has(value.mediaStatus)) state.mediaStatus = value.mediaStatus;
      if (DECODER_STATES.has(value.decoderStatus)) state.decoderStatus = value.decoderStatus;
      if (requestDurationMs !== null) state.requestDurationMs = requestDurationMs;
      if (event === 'source-start') {
        state.mediaStatus = 'resolving';
        state.decoderStatus = 'pending';
        state.stage = 'source';
      }
    }
    if (event === 'source-attempt') {
      counts.sourceAttempts++;
      if (sourceRoute) routeCounts[sourceRoute].attempts++;
    }
    if (providerRequest && routeId) {
      const row = requestRoutes[routeId];
      row.attempts++;
      if (value.modelValid === true) row.modelsAccepted++;
      else row.failures++;
      row.lastFaultCode = faultCode;
      row.lastErrorCode = errorCode;
      row.lastRequestDurationMs = requestDurationMs;
    }
    if (event === 'source-success') {
      if (current) { state.lastSourceAt = at; state.mediaStatus = 'loading'; }
      counts.sourceSuccesses++;
      if (sourceRoute) routeCounts[sourceRoute].successes++;
    }
    if (event === 'source-failure') {
      if (current) state.mediaStatus = 'failed';
      counts.sourceFailures++;
      if (sourceRoute) routeCounts[sourceRoute].failures++;
    }
    if (event === 'recovery') {
      if (current && recoveryCount === null) state.recoveryCount++;
      counts.recoveries++;
    }
    if (current && recoveryCount !== null) state.recoveryCount = recoveryCount;
    if (event === 'playback-success') {
      if (current) {
        state.lastSuccessAt = at;
        state.mediaStatus = MEDIA_STATES.has(value.mediaStatus) ? value.mediaStatus : 'playing';
        state.stage = 'first-frame';
      }
      counts.playbackSuccesses++;
    }
    if (current && event === 'failure') state.mediaStatus = 'failed';
    if (current && event === 'cancelled') state.mediaStatus = 'cancelled';
    if (current && errorCode) state.lastErrorCode = errorCode;
    if (faultCode) {
      if (event === 'source-failure' || event === 'failure') faultCounts[faultCode]++;
    }
    const safeEvent = { at, event, ...(sourceRoute ? { sourceRoute } : {}), ...(routeId ? { routeId } : {}),
      ...(rawCode && rawCode !== faultCode ? { code: rawCode } : {}),
      ...(faultCode ? { faultCode } : {}), ...(STAGES.has(value.stage) ? { stage: value.stage } : {}),
      ...(httpStatus ? { httpStatus } : {}),
      ...(requestDurationMs !== null ? { requestDurationMs } : {}) };
    events.push(safeEvent);
    if (events.length > 40) events.shift();
    recordAttempt(value.requestId, safeEvent, providerRequest, value.modelValid === true);
  }

  function snapshot({ account, device, profile: selectedProfile } = {}) {
    if (account && typeof account === 'object') {
      state.accountState = ACCOUNT_STATES.has(account.accountState) ? account.accountState
        : account.signedIn === true ? 'signed-in' : account.signedIn === false ? 'signed-out' : 'unknown';
      const sessionValidity = account.sessionValidity === 'anonymous' ? 'none'
        : account.sessionValidity === 'unverified' ? 'unchecked' : account.sessionValidity;
      if (SESSION_STATES.has(sessionValidity)) state.sessionValidity = sessionValidity;
      if (account.checking === true) state.sessionValidity = 'checking';
      if (state.sessionValidity === 'expired') state.accountState = 'expired';
      if (['unverified', 'supported', 'unsupported'].includes(account.playbackAuthorization)) state.playbackAuthorization = account.playbackAuthorization;
      state.accountDeviceAssociation = account.deviceAssociation?.status === 'linked' ? 'linked' : 'unlinked';
    }
    if (DEVICE_STATES.has(device?.state)) state.deviceState = device.state;
    const configuredProfile = knownProfiles.get(selectedProfile?.id);
    if (configuredProfile && (!state.sourceRoute || !state.profileId && state.sourceRoute === configuredProfile.source)
      && configuredProfile.version === selectedProfile.version) {
      state.profileId = selectedProfile.id;
      state.profileVersion = selectedProfile.version;
    }
    return {
      schemaVersion: 1, generatedAt: tick(), ...state,
      redaction: { credentials: 'omitted', accountIdentifiers: 'omitted', deviceIdentifiers: 'omitted',
        mediaUrls: 'omitted', signatures: 'omitted', keys: 'omitted', rawErrors: 'omitted', localPaths: 'omitted' },
      counts: { ...counts },
      routes: Object.entries(routeCounts).map(([source, value]) => ({ source, ...value,
        successRate: value.attempts ? Math.min(1, value.successes / value.attempts) : null })),
      requestRoutes: Object.entries(requestRoutes).map(([routeId, value]) => ({ routeId, ...value,
        modelAcceptanceRate: value.attempts ? value.modelsAccepted / value.attempts : null })),
      faults: { ...faultCounts }, events: events.map(value => ({ ...value })),
      currentAttempt: attempt(foregroundRequestId),
      lastFailure: lastFailure ? sanitizePlaybackTrace(lastFailure) : null,
    };
  }

  return {
    record, snapshot, isForeground, attempt,
    setForeground(requestId) {
      if (requestId !== '' && !validRequestId(requestId)) return false;
      foregroundRequestId = requestId;
      if (requestId) beginAttempt(requestId);
      return true;
    },
    resetMedia() { state.mediaStatus = 'idle'; state.decoderStatus = 'idle'; state.recoveryCount = 0; },
  };
}

module.exports = { routeDiagnostic, safeCode, sanitizePlaybackDiagnostics, updatePlaybackRoute, playbackFailureMessage,
  createPlaybackDiagnostics, classifyPlaybackError, playbackRecoveryPolicy, sanitizePlaybackTrace };
