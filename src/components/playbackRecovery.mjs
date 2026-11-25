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
  WEB_EPISODE_UNAVAILABLE: '官网当前播放入口未提供本集，尚未取得本集播放源；请查看各线路诊断。',
  API_BUSINESS_ERROR: '播放接口返回业务错误，本次已停止重复请求；请查看诊断详情。',
  API_PARSE_ERROR: '无法识别播放接口返回的数据，本次已停止重复请求；请导出诊断报告。',
  SOURCE_EMPTY: '当前接口没有返回本集可用播放地址，请查看各线路诊断。',
  API_HTTP_ERROR: '播放接口返回 HTTP 错误，请查看诊断中的状态码。',
  SOURCE_PROVIDERS_FAILED: '官网当前入口未提供本集，App 播放接口返回空响应；尚未取得本集播放源。',
  DRM_UNSUPPORTED: '本集返回受保护或加密片源，请使用官方授权播放器。',
  NETWORK_TIMEOUT: '播放连接超时，请检查网络后重试。',
  NETWORK_DISCONNECTED: '网络连接已断开，请检查网络后重试。',
  MEDIA_URL_EXPIRED: '视频地址已过期，重新获取片源后可继续播放。',
  CDN_UNAVAILABLE: '视频线路暂时无法访问，请检查网络后重试。',
  MEDIA_DECRYPT_FAILED: '视频解密失败，请重新获取片源后重试。',
  CODEC_UNSUPPORTED: '当前视频格式不受支持，可尝试 H.264 兼容播放。',
  PLAYER_DECODE_FAILED: '本机视频解码失败，可尝试 H.264 兼容播放。',
  MEDIA_FORMAT_UNSUPPORTED: '当前播放器无法识别此媒体格式，请查看诊断详情。',
  MANIFEST_LOAD_FAILED: 'HLS/DASH 媒体清单加载失败，请重新获取片源。',
  MEDIA_SEGMENT_FAILED: '视频媒体资源请求失败，请重新获取片源。',
  PLAYER_ERROR: '播放器内部发生错误，请重试本集并保留诊断报告。',
});

export const PLAYBACK_FAULT_CODES = new Set(Object.keys(FAULT_MESSAGES));

export function playbackFaultCode(value) {
  if ([value?.faultCode, value?.code, value?.diagnostics?.faultCode, value?.diagnostics?.code]
    .includes('DRM_UNSUPPORTED')) return 'DRM_UNSUPPORTED';
  for (const explicit of [value?.faultCode, value?.diagnostics?.faultCode]) {
    if (PLAYBACK_FAULT_CODES.has(explicit)) return explicit;
  }
  const legacy = {
    ACCOUNT_REQUIRED: 'ACCOUNT_UNAUTHORIZED', HTTP_401: 'API_FORBIDDEN',
    HTTP_403: 'API_FORBIDDEN', HTTP_408: 'NETWORK_TIMEOUT', HTTP_429: 'API_RATE_LIMITED', EMPTY_RESPONSE: 'API_EMPTY_RESPONSE',
    ETIMEDOUT: 'NETWORK_TIMEOUT', TIMEOUT: 'NETWORK_TIMEOUT', ECONNABORTED: 'NETWORK_TIMEOUT',
    NETWORK_ERROR: 'NETWORK_DISCONNECTED', ERR_NETWORK: 'NETWORK_DISCONNECTED',
    MEDIA_DECODE_ERROR: 'PLAYER_DECODE_FAILED', NO_COMPATIBLE_SOURCE: 'CODEC_UNSUPPORTED',
    BUSINESS_REJECTED: 'API_BUSINESS_ERROR', INVALID_RESPONSE: 'API_PARSE_ERROR',
    INVALID_JSON: 'API_PARSE_ERROR', ERR_BAD_RESPONSE: 'API_PARSE_ERROR',
    MISSING_MODEL: 'SOURCE_EMPTY', NO_PLAYABLE_SOURCE: 'SOURCE_EMPTY',
    UNSUPPORTED_MEDIA_FORMAT: 'MEDIA_FORMAT_UNSUPPORTED', MEDIA_ERR_SRC_NOT_SUPPORTED: 'MEDIA_FORMAT_UNSUPPORTED',
    HLS_MANIFEST_FAILED: 'MANIFEST_LOAD_FAILED', DASH_MANIFEST_FAILED: 'MANIFEST_LOAD_FAILED',
    MANIFEST_FETCH_FAILED: 'MANIFEST_LOAD_FAILED',
    HLS_SEGMENT_FAILED: 'MEDIA_SEGMENT_FAILED', DASH_SEGMENT_FAILED: 'MEDIA_SEGMENT_FAILED',
    PLAYER_INTERNAL_ERROR: 'PLAYER_ERROR', MEDIA_ERR_ABORTED: 'PLAYER_ERROR',
  };
  const stage = value?.stage || value?.diagnostics?.stage;
  const media = ['media', 'hls', 'manifest', 'segment', 'decrypt', 'decode', 'player', 'first-frame'].includes(stage);
  for (const code of [value?.code, value?.diagnostics?.code]) {
    if (PLAYBACK_FAULT_CODES.has(code)) return code;
    const transportFailure = /^HTTP_[45]\d{2}$/.test(code || '')
      || ['ETIMEDOUT', 'ECONNABORTED', 'TIMEOUT', 'ERR_NETWORK', 'NETWORK_ERROR', 'ECONNRESET',
        'ERR_BAD_REQUEST', 'ERR_BAD_RESPONSE', 'MEDIA_TRANSFER_ERROR', 'ERR_STREAM_PREMATURE_CLOSE'].includes(code);
    if (transportFailure && !['HTTP_429', 'ACCOUNT_REQUIRED'].includes(code)) {
      if (stage === 'manifest') return 'MANIFEST_LOAD_FAILED';
      if (stage === 'segment') return 'MEDIA_SEGMENT_FAILED';
    }
    if (media && /^HTTP_[45]\d{2}$/.test(code || '') && !['HTTP_408', 'HTTP_429'].includes(code)) return 'CDN_UNAVAILABLE';
    if (Object.hasOwn(legacy, code)) return legacy[code];
    if (/^HTTP_[45]\d{2}$/.test(code || '')) return 'API_HTTP_ERROR';
  }
  return '';
}

export function playbackFaultMessage(code, fallback = '当前内容暂时无法播放，请稍后重试。') {
  return PLAYBACK_FAULT_CODES.has(code) ? FAULT_MESSAGES[code] : fallback;
}

export function playbackFaultAdvice(code) {
  if (['ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED'].includes(code)) return '在账号管理检查官方账号会话，并在官方客户端确认本集是否可播。';
  if (['API_FORBIDDEN', 'API_RATE_LIMITED', 'SIGNATURE_INVALID', 'DEVICE_IDENTITY_EXPIRED'].includes(code)) return '本次已停止自动请求；稍后手动重试，或导出诊断报告。普通拒绝不能确定账号授权。';
  if (['API_BUSINESS_ERROR', 'API_PARSE_ERROR', 'SOURCE_EMPTY', 'API_EMPTY_RESPONSE', 'API_HTTP_ERROR',
    'WEB_EPISODE_UNAVAILABLE', 'SOURCE_PROVIDERS_FAILED'].includes(code)) return '展开各线路结果并复制或导出诊断；官方客户端同集的脱敏记录可用于继续定位。';
  if (['NETWORK_TIMEOUT', 'NETWORK_DISCONNECTED'].includes(code)) return '检查网络连接；恢复网络后再重试本集。';
  if (['MEDIA_URL_EXPIRED', 'CDN_UNAVAILABLE', 'MANIFEST_LOAD_FAILED', 'MEDIA_SEGMENT_FAILED'].includes(code)) return '重新连接片源以获取最新地址；再次失败时保留诊断中的 HTTP 状态。';
  if (['CODEC_UNSUPPORTED', 'PLAYER_DECODE_FAILED'].includes(code)) return '可尝试现有 H.264 兼容播放；兼容失败时导出诊断报告。';
  if (code === 'DRM_UNSUPPORTED') return '使用官方授权播放器；本客户端不会绕过内容保护。';
  if (code === 'MEDIA_FORMAT_UNSUPPORTED') return '当前媒体格式未获支持；请导出诊断，不能将清单或网页当作 MP4。';
  return '可手动重试本集；再次失败时复制或导出本次诊断。';
}

export function stopsPlaybackRecovery(faultCode) {
  return ['ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED', 'DEVICE_IDENTITY_EXPIRED',
    'SIGNATURE_INVALID', 'API_RATE_LIMITED', 'API_FORBIDDEN', 'WEB_EPISODE_UNAVAILABLE', 'DRM_UNSUPPORTED',
    'API_BUSINESS_ERROR', 'API_PARSE_ERROR', 'SOURCE_EMPTY', 'API_HTTP_ERROR', 'SOURCE_PROVIDERS_FAILED',
    'MEDIA_FORMAT_UNSUPPORTED', 'PLAYER_ERROR'].includes(faultCode);
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
  return ['ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED'].includes(code);
}
