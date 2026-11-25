// Faults describe the layer with evidence; an empty body does not prove an auth or signature failure.
const FAULT_CODES = Object.freeze([
  'ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED', 'DEVICE_IDENTITY_EXPIRED', 'SIGNATURE_INVALID',
  'API_EMPTY_RESPONSE', 'API_RATE_LIMITED', 'API_FORBIDDEN', 'WEB_EPISODE_UNAVAILABLE', 'NETWORK_TIMEOUT',
  'NETWORK_DISCONNECTED', 'MEDIA_URL_EXPIRED', 'CDN_UNAVAILABLE', 'MEDIA_DECRYPT_FAILED',
  'CODEC_UNSUPPORTED', 'PLAYER_DECODE_FAILED',
]);
const faults = new Set(FAULT_CODES);
const POLICIES = Object.freeze(Object.fromEntries([
  ['ACCOUNT_EXPIRED', 'sign-in', 0, '红果账号登录已过期，请重新扫码登录。'],
  ['ACCOUNT_UNAUTHORIZED', 'stop', 0, '红果账号未获当前内容授权，请在官方 App 确认权限。'],
  ['DEVICE_IDENTITY_EXPIRED', 'renew-device', 1, '播放设备身份已失效，请重新建立播放会话。'],
  ['SIGNATURE_INVALID', 'refresh-signature', 1, '播放请求签名未通过验证，请重新连接片源。'],
  ['API_EMPTY_RESPONSE', 'verified-fallback', 1, '播放接口返回空内容，未能取得可用片源，请稍后重试。'],
  ['API_RATE_LIMITED', 'stop', 0, '播放接口请求过于频繁，请稍后手动重试。'],
  ['API_FORBIDDEN', 'stop', 0, '官方播放接口拒绝了请求，请稍后重试或在官方 App 观看。'],
  ['WEB_EPISODE_UNAVAILABLE', 'stop', 0, '官网当前播放入口不提供本集，请在官方客户端查看可用播放方式。'],
  ['NETWORK_TIMEOUT', 'retry-network', 1, '播放请求超时，请检查网络连接。'],
  ['NETWORK_DISCONNECTED', 'wait-network', 1, '网络连接已中断，网络恢复后可继续播放。'],
  ['MEDIA_URL_EXPIRED', 'refresh-source', 1, '视频地址已过期，请重新获取片源。'],
  ['CDN_UNAVAILABLE', 'refresh-source', 1, '视频线路暂时不可用，请重新连接。'],
  ['MEDIA_DECRYPT_FAILED', 'refresh-source', 1, '视频解密失败，请重新连接片源。'],
  ['CODEC_UNSUPPORTED', 'compat-decode', 1, '当前视频编码不受支持，可尝试兼容播放。'],
  ['PLAYER_DECODE_FAILED', 'compat-decode', 1, '视频解码失败，可尝试兼容播放。'],
].map(([code, action, maxRetries, message]) => [code, Object.freeze({ action, maxRetries, retryable: maxRetries > 0, message })])));
const UNKNOWN_POLICY = Object.freeze({ action: 'stop', maxRetries: 0, retryable: false, message: '当前内容暂时无法播放，请稍后重试。' });

function isPlaybackFault(value) { return typeof value === 'string' && faults.has(value); }

function classifyPlaybackError(error = {}, { stage = 'source', now = Date.now(), expiresAt = 0 } = {}) {
  if (!error || typeof error !== 'object') return '';
  if (isPlaybackFault(error.faultCode)) return error.faultCode;
  if (isPlaybackFault(error.code)) return error.code;
  const code = typeof error.code === 'string' ? error.code : '';
  if (error.name === 'AbortError' || ['ABORT_ERR', 'ERR_CANCELED'].includes(code)) return '';
  const media = ['media', 'hls', 'decrypt', 'decode', 'player', 'first-frame'].includes(stage);
  const status = Number(error.status || error.mediaStatus || error.response?.status || /^HTTP_(\d{3})$/.exec(code)?.[1]) || 0;
  if (code === 'ACCOUNT_SESSION_EXPIRED') return 'ACCOUNT_EXPIRED';
  if (code === 'ACCOUNT_REQUIRED' || code === 'ACCOUNT_ACCESS_DENIED') return 'ACCOUNT_UNAUTHORIZED';
  if (code === 'DEVICE_REJECTED' || code === 'DEVICE_EXPIRED') return 'DEVICE_IDENTITY_EXPIRED';
  if (code === 'SIGNATURE_REJECTED') return 'SIGNATURE_INVALID';
  if (['ETIMEDOUT', 'ECONNABORTED', 'TIMEOUT'].includes(code) || error.name === 'TimeoutError' || status === 408) return 'NETWORK_TIMEOUT';
  if (['ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_NETWORK', 'NETWORK_ERROR'].includes(code)) return 'NETWORK_DISCONNECTED';
  if (status === 429) return 'API_RATE_LIMITED';
  if (media && Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= now) return 'MEDIA_URL_EXPIRED';
  if (!media && [401, 403].includes(status)) return 'API_FORBIDDEN';
  if (!media && code === 'EMPTY_RESPONSE') return 'API_EMPTY_RESPONSE';
  if (stage === 'decrypt' || ['DECRYPT_FAILED', 'INVALID_CONTENT_KEY', 'ERR_OSSL_BAD_DECRYPT'].includes(code)) return 'MEDIA_DECRYPT_FAILED';
  if (['NO_COMPATIBLE_SOURCE', 'CODEC_NOT_SUPPORTED'].includes(code)) return 'CODEC_UNSUPPORTED';
  if (['MEDIA_DECODE_ERROR', 'TRANSCODE_FAILED'].includes(code) || stage === 'decode' && code === 'MEDIA_ERR_DECODE') return 'PLAYER_DECODE_FAILED';
  if (media && (status >= 400 || ['MEDIA_TRANSFER_ERROR', 'ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'EPIPE', 'HLS_SEGMENT_FAILED'].includes(code))) return 'CDN_UNAVAILABLE';
  if (['ECONNRESET', 'EPIPE'].includes(code)) return 'NETWORK_DISCONNECTED';
  if (Array.isArray(error.sources)) {
    const nested = error.sources.map(item => classifyPlaybackError(item, { stage, now, expiresAt })).filter(Boolean);
    return nested.find(item => ['ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED', 'API_FORBIDDEN', 'API_RATE_LIMITED'].includes(item))
      || nested.find(item => item === 'WEB_EPISODE_UNAVAILABLE') || nested[0] || '';
  }
  return '';
}

function playbackRecoveryPolicy(faultCode) { return isPlaybackFault(faultCode) ? POLICIES[faultCode] : UNKNOWN_POLICY; }

module.exports = { FAULT_CODES, isPlaybackFault, classifyPlaybackError, playbackRecoveryPolicy };
