import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackFaultCode, playbackFaultMessage, playbackFaultAdvice, shouldOfferAccountLogin,
  stopsPlaybackRecovery, allowsQualityFallback, createPlaybackRecovery, claimPlaybackRecovery,
  remainingPlaybackRecovery, MAX_PLAYBACK_RECOVERIES, PLAYBACK_RECOVERY_TIMEOUT } from '../playbackRecovery.mjs';

test('renderer classifies source, manifest, segment and decoder errors by their actual layer', () => {
  for (const [failure, expected] of [
    [{ code: 'HTTP_401' }, 'API_FORBIDDEN'], [{ code: 'HTTP_403' }, 'API_FORBIDDEN'],
    [{ code: 'HTTP_404' }, 'API_HTTP_ERROR'], [{ code: 'HTTP_500' }, 'API_HTTP_ERROR'],
    [{ code: 'HTTP_408' }, 'NETWORK_TIMEOUT'], [{ code: 'EMPTY_RESPONSE' }, 'API_EMPTY_RESPONSE'],
    [{ code: 'INVALID_RESPONSE' }, 'API_PARSE_ERROR'], [{ code: 'INVALID_JSON' }, 'API_PARSE_ERROR'],
    [{ code: 'BUSINESS_REJECTED' }, 'API_BUSINESS_ERROR'], [{ code: 'MISSING_MODEL' }, 'SOURCE_EMPTY'],
    [{ code: 'HTTP_403', diagnostics: { stage: 'media' } }, 'CDN_UNAVAILABLE'],
    [{ code: 'HTTP_404', stage: 'segment' }, 'MEDIA_SEGMENT_FAILED'],
    [{ code: 'HLS_MANIFEST_FAILED', stage: 'manifest' }, 'MANIFEST_LOAD_FAILED'],
    [{ code: 'DASH_SEGMENT_FAILED', stage: 'segment' }, 'MEDIA_SEGMENT_FAILED'],
    [{ code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' }, 'MEDIA_FORMAT_UNSUPPORTED'],
    [{ code: 'MEDIA_DECODE_ERROR', stage: 'decode' }, 'PLAYER_DECODE_FAILED'],
    [{ code: 'PLAYER_INTERNAL_ERROR' }, 'PLAYER_ERROR'],
    [{ faultCode: 'unrecognized', diagnostics: { faultCode: 'MEDIA_URL_EXPIRED' } }, 'MEDIA_URL_EXPIRED'],
  ]) assert.equal(playbackFaultCode(failure), expected);
});

test('renderer retains manifest and segment HTTP failure steps for safe native transport errors', () => {
  for (const [stage, expected] of [['manifest', 'MANIFEST_LOAD_FAILED'], ['segment', 'MEDIA_SEGMENT_FAILED']]) {
    for (const status of [403, 404, 500]) {
      assert.equal(playbackFaultCode({ stage, code: `HTTP_${status}` }), expected);
      assert.equal(playbackFaultCode({ code: status < 500 ? 'ERR_BAD_REQUEST' : 'ERR_BAD_RESPONSE', diagnostics: { stage } }), expected);
    }
    assert.equal(playbackFaultCode({ stage, code: 'ETIMEDOUT' }), expected);
    assert.equal(playbackFaultCode({ stage, code: 'HTTP_429' }), 'API_RATE_LIMITED');
    assert.equal(playbackFaultCode({ stage, code: 'HTTP_403', faultCode: 'MEDIA_URL_EXPIRED' }), 'MEDIA_URL_EXPIRED');
    assert.equal(playbackFaultCode({ stage, code: 'ACCOUNT_REQUIRED' }), 'ACCOUNT_UNAUTHORIZED');
  }
});

test('only explicit account evidence offers account recovery while protocol errors stop quality fallbacks', () => {
  const account = { success: true, signedIn: false, sessionValidity: 'anonymous' };
  for (const faultCode of ['API_FORBIDDEN', 'API_EMPTY_RESPONSE', 'API_PARSE_ERROR', 'API_BUSINESS_ERROR',
    'API_HTTP_ERROR', 'SOURCE_EMPTY', 'SOURCE_PROVIDERS_FAILED', 'MANIFEST_LOAD_FAILED',
    'MEDIA_SEGMENT_FAILED', 'MEDIA_FORMAT_UNSUPPORTED', 'PLAYER_DECODE_FAILED']) {
    assert.equal(shouldOfferAccountLogin({ faultCode }, account), false, faultCode);
    assert.equal(allowsQualityFallback({ faultCode }), false, faultCode);
    assert(playbackFaultAdvice(faultCode).length > 0);
  }
  for (const faultCode of ['ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED']) {
    assert.equal(shouldOfferAccountLogin({ faultCode }, account), true);
    assert.equal(shouldOfferAccountLogin({ faultCode, seriesId: 'custom:private' }, account), false);
    assert.equal(shouldOfferAccountLogin({ faultCode }, { success: false }), false);
  }
  for (const faultCode of ['API_PARSE_ERROR', 'API_BUSINESS_ERROR', 'API_HTTP_ERROR', 'SOURCE_EMPTY',
    'SOURCE_PROVIDERS_FAILED', 'MEDIA_FORMAT_UNSUPPORTED', 'PLAYER_ERROR']) assert(stopsPlaybackRecovery(faultCode));
  assert.equal(allowsQualityFallback({ faultCode: 'CODEC_UNSUPPORTED' }), true);
});

test('recovery has both a finite attempt count and a deadline and untrusted fault text stays out of messages', () => {
  const counted = createPlaybackRecovery('episode-22', 1000);
  for (let i = 0; i < MAX_PLAYBACK_RECOVERIES; i++) assert(claimPlaybackRecovery(counted, 1000 + i));
  assert.equal(claimPlaybackRecovery(counted, 2000), false);
  const expired = createPlaybackRecovery('episode-22', 1000);
  assert.equal(remainingPlaybackRecovery(expired, 1000 + PLAYBACK_RECOVERY_TIMEOUT), 0);
  assert.equal(claimPlaybackRecovery(expired, 1000 + PLAYBACK_RECOVERY_TIMEOUT), false);
  assert.equal(claimPlaybackRecovery(null), false);
  for (const code of ['__proto__', 'toString', 'Cookie=private-token', 'https://signed.invalid']) {
    assert.equal(playbackFaultCode({ code }), '');
    assert.equal(playbackFaultMessage(code), '当前内容暂时无法播放，请稍后重试。');
    assert.equal(typeof playbackFaultAdvice(code), 'string');
  }
});
