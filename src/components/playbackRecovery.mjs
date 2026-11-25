export const PLAYBACK_RECOVERY_TIMEOUT = 90000;
export const MAX_PLAYBACK_RECOVERIES = 6;

const FAULT_MESSAGES = Object.freeze({
  ACCOUNT_EXPIRED: '红果账号会话已过期，请重新扫码登录。',
  ACCOUNT_UNAUTHORIZED: '当前账号未获得该内容的播放授权，请在红果官方客户端确认。',
  DEVICE_IDENTITY_EXPIRED: '播放设备身份已失效，合法会话恢复失败，请稍后重试。',
  SIGNATURE_INVALID: '官方播放接口未接受当前请求签名，请检查播放诊断。',
  API_EMPTY_RESPONSE: '官方播放接口返回空响应，已用尽本次可用的恢复策略，请稍后重试。',
  API_RATE_LIMITED: '官方播放接口请求过于频繁，请稍后再试。',
  API_FORBIDDEN: '官方播放接口拒绝了本次请求，请在红果官方客户端确认访问权限。',
  WEB_EPISODE_UNAVAILABLE: '官网在当前环境下未提供本集可用的完整片源，不能据此判断账号授权；请在红果官方客户端确认。',
  DRM_UNSUPPORTED: '本集返回受保护或加密片源，请使用官方授权播放器。',
  NETWORK_TIMEOUT: '播放连接超时，请检查网络后重试。',
  NETWORK_DISCONNECTED: '网络连接已断开，请检查网络后重试。',
  MEDIA_URL_EXPIRED: '视频地址已过期，重新获取片源后可继续播放。',
  CDN_UNAVAILABLE: '视频线路暂时无法访问，请检查网络后重试。',
  MEDIA_DECRYPT_FAILED: '视频解密失败，请重新获取片源后重试。',
  CODEC_UNSUPPORTED: '当前视频格式不受支持，可尝试 H.264 兼容播放。',
  PLAYER_DECODE_FAILED: '本机视频解码失败，可尝试 H.264 兼容播放。',
});

export const PLAYBACK_FAULT_CODES = new Set(Object.keys(FAULT_MESSAGES));

export function playbackFaultCode(value) {
  if ([value?.faultCode, value?.code, value?.diagnostics?.faultCode, value?.diagnostics?.code]
    .includes('DRM_UNSUPPORTED')) return 'DRM_UNSUPPORTED';
  const explicit = value?.faultCode || value?.diagnostics?.faultCode;
  if (PLAYBACK_FAULT_CODES.has(explicit)) return explicit;
  const legacy = {
    ACCOUNT_REQUIRED: 'ACCOUNT_UNAUTHORIZED', HTTP_401: 'ACCOUNT_UNAUTHORIZED',
    HTTP_403: 'API_FORBIDDEN', HTTP_429: 'API_RATE_LIMITED', EMPTY_RESPONSE: 'API_EMPTY_RESPONSE',
    ETIMEDOUT: 'NETWORK_TIMEOUT', TIMEOUT: 'NETWORK_TIMEOUT', ECONNABORTED: 'NETWORK_TIMEOUT',
    NETWORK_ERROR: 'NETWORK_DISCONNECTED', ERR_NETWORK: 'NETWORK_DISCONNECTED',
    MEDIA_DECODE_ERROR: 'PLAYER_DECODE_FAILED', NO_COMPATIBLE_SOURCE: 'CODEC_UNSUPPORTED',
  };
  for (const code of [value?.code, value?.diagnostics?.code]) {
    if (PLAYBACK_FAULT_CODES.has(code)) return code;
    if (legacy[code]) return legacy[code];
  }
  return '';
}

export function playbackFaultMessage(code, fallback = '当前内容暂时无法播放，请稍后重试。') {
  return FAULT_MESSAGES[code] || fallback;
}

export function stopsPlaybackRecovery(faultCode) {
  return ['ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED', 'DEVICE_IDENTITY_EXPIRED',
    'SIGNATURE_INVALID', 'API_RATE_LIMITED', 'API_FORBIDDEN', 'WEB_EPISODE_UNAVAILABLE', 'DRM_UNSUPPORTED'].includes(faultCode);
}

export function allowsQualityFallback(value) {
  const fault = playbackFaultCode(value);
  // Source/network recovery belongs to the native manager. A lower rendition
  // cannot fix authentication, a changed response, or a disconnected network.
  return !fault || fault === 'CODEC_UNSUPPORTED';
}

export function createPlaybackRecovery(key, now = Date.now()) {
  return { key, startedAt: now, attempts: 0 };
}

export function remainingPlaybackRecovery(budget, now = Date.now()) {
  return budget ? Math.max(0, PLAYBACK_RECOVERY_TIMEOUT - Math.max(0, now - budget.startedAt))
    : PLAYBACK_RECOVERY_TIMEOUT;
}

export function claimPlaybackRecovery(budget, now = Date.now()) {
  if (!budget || budget.attempts >= MAX_PLAYBACK_RECOVERIES || !remainingPlaybackRecovery(budget, now)) return false;
  budget.attempts++;
  return true;
}
export function shouldOfferAccountLogin(failure, account) {
  if (!account?.success || /^(xifan|custom):/.test(String(failure?.seriesId || ''))) return false;
  const code = playbackFaultCode(failure);
  if (['ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED'].includes(code)) return true;
  if (failure?.stage !== 'source' || code && code !== 'API_EMPTY_RESPONSE') return false;
  return account.signedIn !== true || ['expired', 'invalid', 'anonymous', 'none'].includes(account.sessionValidity);
}
