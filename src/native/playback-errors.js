// Faults describe the layer with evidence; an empty body does not prove an auth or signature failure.
const FAULT_CODES = Object.freeze([
  'ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED', 'DEVICE_IDENTITY_EXPIRED', 'SIGNATURE_INVALID',
  'API_EMPTY_RESPONSE', 'API_RATE_LIMITED', 'API_FORBIDDEN', 'WEB_EPISODE_UNAVAILABLE', 'NETWORK_TIMEOUT',
  'NETWORK_DISCONNECTED', 'MEDIA_URL_EXPIRED', 'CDN_UNAVAILABLE', 'MEDIA_DECRYPT_FAILED',
  'CODEC_UNSUPPORTED', 'PLAYER_DECODE_FAILED', 'API_BUSINESS_ERROR', 'API_PARSE_ERROR',
  'SOURCE_EMPTY', 'API_HTTP_ERROR', 'SOURCE_PROVIDERS_FAILED', 'MEDIA_FORMAT_UNSUPPORTED',
  'MANIFEST_LOAD_FAILED', 'MEDIA_SEGMENT_FAILED', 'PLAYER_ERROR',
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
  ['API_BUSINESS_ERROR', 'stop', 0, '播放接口返回业务错误，本次已停止重复请求；请查看诊断详情。'],
  ['API_PARSE_ERROR', 'stop', 0, '无法识别播放接口返回的数据，本次已停止重复请求；请导出诊断报告。'],
  ['SOURCE_EMPTY', 'stop', 0, '当前接口没有返回本集可用播放地址，请查看各线路诊断。'],
  ['API_HTTP_ERROR', 'stop', 0, '播放接口返回 HTTP 错误，请查看诊断中的状态码。'],
  ['SOURCE_PROVIDERS_FAILED', 'stop', 0, '官网当前入口未提供本集，App 播放接口返回空响应；尚未取得本集播放源。'],
  ['NETWORK_TIMEOUT', 'retry-network', 1, '播放请求超时，请检查网络连接。'],
  ['NETWORK_DISCONNECTED', 'wait-network', 1, '网络连接已中断，网络恢复后可继续播放。'],
  ['MEDIA_URL_EXPIRED', 'refresh-source', 1, '视频地址已过期，请重新获取片源。'],
  ['CDN_UNAVAILABLE', 'refresh-source', 1, '视频线路暂时不可用，请重新连接。'],
  ['MEDIA_DECRYPT_FAILED', 'refresh-source', 1, '视频解密失败，请重新连接片源。'],
  ['CODEC_UNSUPPORTED', 'compat-decode', 1, '当前视频编码不受支持，可尝试兼容播放。'],
  ['PLAYER_DECODE_FAILED', 'compat-decode', 1, '视频解码失败，可尝试兼容播放。'],
  ['MEDIA_FORMAT_UNSUPPORTED', 'stop', 0, '当前播放器无法识别此媒体格式，请查看诊断详情。'],
  ['MANIFEST_LOAD_FAILED', 'refresh-source', 1, 'HLS/DASH 媒体清单加载失败，请重新获取片源。'],
  ['MEDIA_SEGMENT_FAILED', 'refresh-source', 1, '视频媒体资源请求失败，请重新获取片源。'],
  ['PLAYER_ERROR', 'stop', 0, '播放器内部发生错误，请重试本集并保留诊断报告。'],
].map(([code, action, maxRetries, message]) => [code, Object.freeze({ action, maxRetries, retryable: maxRetries > 0, message })])));
const UNKNOWN_POLICY = Object.freeze({ action: 'stop', maxRetries: 0, retryable: false, message: '当前内容暂时无法播放，请稍后重试。' });
const PROTECTED_POLICY = Object.freeze({ action: 'stop', maxRetries: 0, retryable: false,
  message: '本集返回受保护或加密片源，请使用官方授权播放器。' });

function isPlaybackFault(value) { return typeof value === 'string' && faults.has(value); }

function isProtectedPlaybackError(error, seen = new Set()) {
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return error.code === 'DRM_UNSUPPORTED' || error.faultCode === 'DRM_UNSUPPORTED'
    || Array.isArray(error.sources) && error.sources.some(source => isProtectedPlaybackError(source, seen));
}

function classifyPlaybackError(error = {}, { stage = error?.stage || 'source', now = Date.now(), expiresAt = 0 } = {}, seen = new Set()) {
  if (!error || typeof error !== 'object') return '';
  if (seen.has(error)) return '';
  seen.add(error);
  // A protected model is a terminal capability limit, not evidence of an account,
  // codec or transport fault. Do not recover it through a different source.
  if (isProtectedPlaybackError(error)) return '';
  if (isPlaybackFault(error.faultCode)) return error.faultCode;
  if (isPlaybackFault(error.code)) return error.code;
  const code = typeof error.code === 'string' ? error.code : '';
  if (error.name === 'AbortError' || ['ABORT_ERR', 'ERR_CANCELED'].includes(code)) return '';
  const media = ['media', 'hls', 'manifest', 'segment', 'decrypt', 'decode', 'player', 'first-frame'].includes(stage);
  const status = Number(error.httpStatus || error.status || error.mediaStatus || error.response?.status || /^HTTP_(\d{3})$/.exec(code)?.[1]) || 0;
  if (code === 'ACCOUNT_SESSION_EXPIRED') return 'ACCOUNT_EXPIRED';
  if (code === 'ACCOUNT_REQUIRED' || code === 'ACCOUNT_ACCESS_DENIED') return 'ACCOUNT_UNAUTHORIZED';
  if (code === 'DEVICE_REJECTED' || code === 'DEVICE_EXPIRED') return 'DEVICE_IDENTITY_EXPIRED';
  if (code === 'SIGNATURE_REJECTED') return 'SIGNATURE_INVALID';
  if (status === 429) return 'API_RATE_LIMITED';
  if (media && Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= now) return 'MEDIA_URL_EXPIRED';
  const transportFailure = status >= 400 || error.name === 'TimeoutError'
    || ['ETIMEDOUT', 'ECONNABORTED', 'TIMEOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND',
      'EAI_AGAIN', 'ECONNREFUSED', 'ERR_NETWORK', 'NETWORK_ERROR', 'ECONNRESET', 'EPIPE',
      'ERR_BAD_REQUEST', 'ERR_BAD_RESPONSE', 'MEDIA_TRANSFER_ERROR', 'ERR_STREAM_PREMATURE_CLOSE'].includes(code);
  if (transportFailure && stage === 'manifest') return 'MANIFEST_LOAD_FAILED';
  if (transportFailure && stage === 'segment') return 'MEDIA_SEGMENT_FAILED';
  if (['ETIMEDOUT', 'ECONNABORTED', 'TIMEOUT'].includes(code) || error.name === 'TimeoutError' || status === 408) return 'NETWORK_TIMEOUT';
  if (['ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_NETWORK', 'NETWORK_ERROR'].includes(code)) return 'NETWORK_DISCONNECTED';
  if (!media && [401, 403].includes(status)) return 'API_FORBIDDEN';
  if (!media && code === 'EMPTY_RESPONSE') return 'API_EMPTY_RESPONSE';
  if (['HLS_MANIFEST_FAILED', 'DASH_MANIFEST_FAILED', 'MANIFEST_FETCH_FAILED'].includes(code)) return 'MANIFEST_LOAD_FAILED';
  if (['HLS_SEGMENT_FAILED', 'DASH_SEGMENT_FAILED'].includes(code)) return 'MEDIA_SEGMENT_FAILED';
  if (['UNSUPPORTED_MEDIA_FORMAT', 'MEDIA_ERR_SRC_NOT_SUPPORTED'].includes(code)) return 'MEDIA_FORMAT_UNSUPPORTED';
  if (['PLAYER_INTERNAL_ERROR', 'MEDIA_ERR_ABORTED'].includes(code)) return 'PLAYER_ERROR';
  if (!media && status >= 400) return 'API_HTTP_ERROR';
  if (!media && code === 'BUSINESS_REJECTED') return 'API_BUSINESS_ERROR';
  if (!media && ['INVALID_RESPONSE', 'INVALID_JSON', 'ERR_BAD_RESPONSE'].includes(code)) return 'API_PARSE_ERROR';
  if (!media && ['MISSING_MODEL', 'NO_PLAYABLE_SOURCE'].includes(code)) return 'SOURCE_EMPTY';
  if (stage === 'decrypt' || ['DECRYPT_FAILED', 'INVALID_CONTENT_KEY', 'ERR_OSSL_BAD_DECRYPT'].includes(code)) return 'MEDIA_DECRYPT_FAILED';
  if (['NO_COMPATIBLE_SOURCE', 'CODEC_NOT_SUPPORTED'].includes(code)) return 'CODEC_UNSUPPORTED';
  if (['MEDIA_DECODE_ERROR', 'TRANSCODE_FAILED'].includes(code) || stage === 'decode' && code === 'MEDIA_ERR_DECODE') return 'PLAYER_DECODE_FAILED';
  if (media && (status >= 400 || ['MEDIA_TRANSFER_ERROR', 'ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'EPIPE', 'HLS_SEGMENT_FAILED'].includes(code))) return 'CDN_UNAVAILABLE';
  if (['ECONNRESET', 'EPIPE'].includes(code)) return 'NETWORK_DISCONNECTED';
  if (Array.isArray(error.sources)) {
    const results = error.sources.map(item => ({ error: item,
      fault: classifyPlaybackError(item, { stage: item?.stage || stage, now, expiresAt }, seen) }));
    const nested = results.map(item => item.fault).filter(Boolean);
    const refusal = nested.find(item => ['ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED', 'API_FORBIDDEN', 'API_RATE_LIMITED',
      'DEVICE_IDENTITY_EXPIRED', 'SIGNATURE_INVALID'].includes(item));
    if (refusal) return refusal;
    const webUnavailable = results.some(({ error: item, fault }) => item?.source === 'web'
      && (fault === 'WEB_EPISODE_UNAVAILABLE' || ['HTTP_404', 'HTTP_410'].includes(item.code)));
    const appEmpty = results.some(({ error: item, fault }) => item?.source === 'app'
      && (fault === 'API_EMPTY_RESPONSE' || ['EMPTY_RESPONSE', 'API_EMPTY_RESPONSE'].includes(item.code)));
    if (webUnavailable && appEmpty) return 'SOURCE_PROVIDERS_FAILED';
    return nested.find(item => item === 'SOURCE_PROVIDERS_FAILED')
      || nested.find(item => item === 'WEB_EPISODE_UNAVAILABLE') || nested[0] || '';
  }
  return '';
}

function playbackRecoveryPolicy(faultCode) {
  if (faultCode === 'DRM_UNSUPPORTED') return PROTECTED_POLICY;
  return isPlaybackFault(faultCode) ? POLICIES[faultCode] : UNKNOWN_POLICY;
}

module.exports = { FAULT_CODES, isPlaybackFault, isProtectedPlaybackError, classifyPlaybackError, playbackRecoveryPolicy };
