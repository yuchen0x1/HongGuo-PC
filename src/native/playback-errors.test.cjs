const assert = require('node:assert/strict');
const { test } = require('node:test');
const { FAULT_CODES, classifyPlaybackError, playbackRecoveryPolicy } = require('./playback-errors');

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
  ]) assert.equal(classifyPlaybackError(error, context), expected);
  for (const error of [null, 'signed-cookie', { code: 'BUSINESS_REJECTED' }, { code: 'DEVICE_REGISTRATION_FAILED' },
    { code: 'INVALID_RESPONSE' }, { code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' }, { name: 'AbortError' }, { code: 'ERR_CANCELED' }]) {
    assert.equal(classifyPlaybackError(error), '');
  }
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
