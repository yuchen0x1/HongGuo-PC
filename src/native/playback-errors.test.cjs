const assert = require('node:assert/strict');
const { test } = require('node:test');
const { FAULT_CODES, isPlaybackFault, isProtectedPlaybackError, classifyPlaybackError, playbackRecoveryPolicy } = require('./playback-errors');

test('playback classification uses HTTP/layer evidence and never guesses empty-body authentication failures', () => {
  for (const [error, context, expected] of [
    [{ code: 'EMPTY_RESPONSE', message: 'signature invalid' }, {}, 'API_EMPTY_RESPONSE'],
    [{ status: 403 }, {}, 'API_FORBIDDEN'],
    [{ code: 'HTTP_401' }, {}, 'API_FORBIDDEN'],
    [{ response: { status: 429 } }, {}, 'API_RATE_LIMITED'],
    [{ code: 'ETIMEDOUT' }, {}, 'NETWORK_TIMEOUT'],
    [{ name: 'TimeoutError' }, {}, 'NETWORK_TIMEOUT'],
    [{ code: 'ENETUNREACH' }, {}, 'NETWORK_DISCONNECTED'],
    [{ code: 'ECONNRESET' }, { stage: 'source' }, 'NETWORK_DISCONNECTED'],
    [{ code: 'ECONNRESET' }, { stage: 'hls' }, 'CDN_UNAVAILABLE'],
    [{ mediaStatus: 403 }, { stage: 'media', expiresAt: 200, now: 100 }, 'CDN_UNAVAILABLE'],
    [{ mediaStatus: 403 }, { stage: 'media', expiresAt: 100, now: 100 }, 'MEDIA_URL_EXPIRED'],
    [{ code: 'ERR_OSSL_BAD_DECRYPT' }, { stage: 'media' }, 'MEDIA_DECRYPT_FAILED'],
    [{ code: 'MEDIA_DECODE_ERROR' }, { stage: 'decode' }, 'PLAYER_DECODE_FAILED'],
    [{ code: 'NO_COMPATIBLE_SOURCE' }, {}, 'CODEC_UNSUPPORTED'],
    [{ code: 'DEVICE_REJECTED' }, {}, 'DEVICE_IDENTITY_EXPIRED'],
    [{ code: 'SIGNATURE_REJECTED' }, {}, 'SIGNATURE_INVALID'],
    [{ code: 'ACCOUNT_SESSION_EXPIRED' }, {}, 'ACCOUNT_EXPIRED'],
    [{ code: 'ACCOUNT_ACCESS_DENIED' }, {}, 'ACCOUNT_UNAUTHORIZED'],
    [{ code: 'BUSINESS_REJECTED' }, {}, 'API_BUSINESS_ERROR'],
    [{ code: 'INVALID_RESPONSE' }, {}, 'API_PARSE_ERROR'],
    [{ code: 'INVALID_JSON' }, {}, 'API_PARSE_ERROR'],
    [{ code: 'MISSING_MODEL' }, {}, 'SOURCE_EMPTY'],
    [{ code: 'NO_PLAYABLE_SOURCE' }, {}, 'SOURCE_EMPTY'],
    [{ status: 404 }, {}, 'API_HTTP_ERROR'],
    [{ code: 'HTTP_500' }, {}, 'API_HTTP_ERROR'],
    [{ code: 'HTTP_403', stage: 'media' }, {}, 'CDN_UNAVAILABLE'],
    [{ code: 'HTTP_404', stage: 'segment' }, {}, 'MEDIA_SEGMENT_FAILED'],
    [{ code: 'ERR_BAD_RESPONSE', response: { status: 500 } }, {}, 'API_HTTP_ERROR'],
    [{ code: 'HLS_MANIFEST_FAILED', status: 403, stage: 'manifest' }, {}, 'MANIFEST_LOAD_FAILED'],
    [{ code: 'DASH_MANIFEST_FAILED' }, {}, 'MANIFEST_LOAD_FAILED'],
    [{ code: 'HLS_SEGMENT_FAILED', status: 404, stage: 'segment' }, {}, 'MEDIA_SEGMENT_FAILED'],
    [{ code: 'DASH_SEGMENT_FAILED' }, {}, 'MEDIA_SEGMENT_FAILED'],
    [{ code: 'UNSUPPORTED_MEDIA_FORMAT' }, {}, 'MEDIA_FORMAT_UNSUPPORTED'],
    [{ code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' }, {}, 'MEDIA_FORMAT_UNSUPPORTED'],
    [{ code: 'PLAYER_INTERNAL_ERROR', stage: 'player' }, {}, 'PLAYER_ERROR'],
    [{ code: 'MEDIA_ERR_ABORTED' }, {}, 'PLAYER_ERROR'],
  ]) assert.equal(classifyPlaybackError(error, context), expected);
  for (const error of [null, 'signed-cookie', { code: 'DEVICE_REGISTRATION_FAILED' },
    { name: 'AbortError' }, { code: 'ERR_CANCELED' }]) {
    assert.equal(classifyPlaybackError(error), '');
  }
});

test('Axios HTTP and transport failures keep their actual manifest or segment layer', () => {
  for (const [stage, expected] of [['manifest', 'MANIFEST_LOAD_FAILED'], ['segment', 'MEDIA_SEGMENT_FAILED']]) {
    for (const status of [403, 404, 500]) {
      const error = { name: 'AxiosError', stage, code: status < 500 ? 'ERR_BAD_REQUEST' : 'ERR_BAD_RESPONSE',
        response: { status, data: 'private response' } };
      assert.equal(classifyPlaybackError(error), expected, `${stage} HTTP ${status}`);
      assert.equal(classifyPlaybackError({ ...error, stage: undefined }, { stage }), expected);
    }
    for (const code of ['ETIMEDOUT', 'ECONNRESET', 'ERR_NETWORK', 'ERR_STREAM_PREMATURE_CLOSE']) {
      assert.equal(classifyPlaybackError({ code, stage }), expected, `${stage} ${code}`);
    }
    assert.equal(classifyPlaybackError({ code: 'ERR_BAD_REQUEST', stage, status: 403 }, { stage, now: 100, expiresAt: 99 }),
      'MEDIA_URL_EXPIRED', 'confirmed expiry requires a fresh address rather than replaying the same resource');
    assert.equal(classifyPlaybackError({ code: 'ACCOUNT_ACCESS_DENIED', stage, status: 403 }), 'ACCOUNT_UNAUTHORIZED');
    assert.equal(classifyPlaybackError({ code: 'ACCOUNT_SESSION_EXPIRED', stage, status: 403 }), 'ACCOUNT_EXPIRED');
    assert.equal(classifyPlaybackError({ code: 'ERR_BAD_REQUEST', stage, status: 429 }), 'API_RATE_LIMITED');
    assert.equal(classifyPlaybackError({ code: 'DRM_UNSUPPORTED', stage, status: 403 }), '');
  }
  assert.equal(classifyPlaybackError({ code: 'ERR_BAD_REQUEST', stage: 'media', response: { status: 403 } }), 'CDN_UNAVAILABLE');
  assert.equal(classifyPlaybackError({ code: 'ERR_BAD_REQUEST', stage: 'source', response: { status: 403 } }), 'API_FORBIDDEN');
});

test('explicit authorization and rate-limit faults stop automatic retry and every defined fault has a bounded policy', () => {
  for (const code of FAULT_CODES) {
    const policy = playbackRecoveryPolicy(code);
    assert.equal(classifyPlaybackError({ faultCode: code }), code);
    assert.equal(Object.isFrozen(policy), true);
    assert.ok(policy.maxRetries >= 0 && policy.maxRetries <= 1);
    assert.equal(policy.retryable, policy.maxRetries > 0);
    assert.ok(policy.message.length > 0);
  }
  for (const code of ['ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED', 'API_FORBIDDEN', 'API_RATE_LIMITED']) {
    assert.equal(playbackRecoveryPolicy(code).maxRetries, 0);
  }
  for (const code of ['__proto__', 'toString', 'Cookie: private']) assert.equal(playbackRecoveryPolicy(code).action, 'stop');
});

test('provider aggregate keeps explicit rejections ahead of retryable network failures', () => {
  assert.equal(classifyPlaybackError({ sources: [{ code: 'ETIMEDOUT' }, { code: 'HTTP_429' }] }), 'API_RATE_LIMITED');
  assert.equal(classifyPlaybackError({ sources: [{ code: 'EMPTY_RESPONSE' }, { code: 'HTTP_403' }] }), 'API_FORBIDDEN');
});

test('website episode unavailability and App empty response retain their combined evidence as a bounded stop fault', () => {
  const code = 'WEB_EPISODE_UNAVAILABLE';
  const policy = playbackRecoveryPolicy(code);
  assert.ok(FAULT_CODES.includes(code));
  assert.equal(classifyPlaybackError({ code }), code);
  assert.equal(policy.action, 'stop');
  assert.equal(policy.maxRetries, 0);
  assert.equal(policy.retryable, false);
  assert.equal(policy.message, '官网当前播放入口不提供本集，请在官方客户端查看可用播放方式。');
  assert.doesNotMatch(policy.message, /登录|扫码|付费|DRM|无权|权限/);
  const app = { source: 'app', code: 'EMPTY_RESPONSE' }, web = { source: 'web', code };
  for (const sources of [[app, web], [web, app], [app, { source: 'web', sources: [web] }]]) {
    assert.equal(classifyPlaybackError({ code: 'SOURCE_UNAVAILABLE', sources }), 'SOURCE_PROVIDERS_FAILED');
    assert.equal(classifyPlaybackError({ sources }, { stage: 'media' }), 'SOURCE_PROVIDERS_FAILED');
  }
  assert.equal(classifyPlaybackError({ sources: [{ sources: [web, app] }] }), 'SOURCE_PROVIDERS_FAILED');
  assert.equal(classifyPlaybackError({ sources: [{ source: 'web', code: 'HTTP_404' }, app] }), 'SOURCE_PROVIDERS_FAILED');
  assert.equal(classifyPlaybackError({ sources: [web, { code: 'HTTP_429' }] }), 'API_RATE_LIMITED');
  assert.equal(classifyPlaybackError({ sources: [web, { code: 'ACCOUNT_SESSION_EXPIRED' }] }), 'ACCOUNT_EXPIRED');
  assert.equal(classifyPlaybackError({ sources: [web, app, { code: 'ACCOUNT_ACCESS_DENIED' }] }), 'ACCOUNT_UNAUTHORIZED');
  const cycle = { sources: [] };
  cycle.sources.push(cycle, app, web);
  assert.equal(classifyPlaybackError(cycle), 'SOURCE_PROVIDERS_FAILED');
});

test('changed response and unsupported format faults cannot be retried as network or decoder problems', () => {
  for (const fault of ['API_BUSINESS_ERROR', 'API_PARSE_ERROR', 'SOURCE_EMPTY', 'API_HTTP_ERROR',
    'SOURCE_PROVIDERS_FAILED', 'MEDIA_FORMAT_UNSUPPORTED', 'PLAYER_ERROR']) {
    assert.deepEqual({ ...playbackRecoveryPolicy(fault), message: '' },
      { action: 'stop', maxRetries: 0, retryable: false, message: '' });
  }
  for (const fault of ['MANIFEST_LOAD_FAILED', 'MEDIA_SEGMENT_FAILED']) {
    assert.equal(playbackRecoveryPolicy(fault).action, 'refresh-source');
    assert.equal(playbackRecoveryPolicy(fault).maxRetries, 1);
  }
});

test('explicit protected media stops without inventing an account, codec or transport fault', () => {
  const code = 'DRM_UNSUPPORTED';
  assert.equal(FAULT_CODES.includes(code), false);
  assert.equal(isPlaybackFault(code), false);
  const policy = playbackRecoveryPolicy(code);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(policy.action, 'stop');
  assert.equal(policy.maxRetries, 0);
  assert.equal(policy.retryable, false);
  assert.equal(policy.message, '本集返回受保护或加密片源，请使用官方授权播放器。');
  for (const error of [
    { code }, { faultCode: code }, { code, status: 403, faultCode: 'CODEC_UNSUPPORTED' },
    { code: 'SOURCE_UNAVAILABLE', sources: [{ code: 'EMPTY_RESPONSE' }, { source: 'app', code }] },
    { sources: [{ code: 'ETIMEDOUT' }, { sources: [{ code }] }] },
  ]) {
    assert.equal(isProtectedPlaybackError(error), true);
    assert.equal(classifyPlaybackError(error), '');
    assert.equal(classifyPlaybackError(error, { stage: 'decode' }), '');
  }
  for (const error of [null, 'DRM_UNSUPPORTED', { code: 'UNKNOWN', message: code }, { code: 'EMPTY_RESPONSE' }]) {
    assert.equal(isProtectedPlaybackError(error), false);
  }
  const cycle = { sources: [] };
  cycle.sources.push(cycle);
  assert.equal(isProtectedPlaybackError(cycle), false);
});
