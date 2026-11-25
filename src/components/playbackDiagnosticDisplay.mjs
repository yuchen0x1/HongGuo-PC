const ACCOUNT = { 'signed-in': '已登录', 'signed-out': '未登录', expired: '登录已过期', unauthorized: '授权受限', unknown: '尚未检查' };
const SESSION = { valid: '有效', expired: '已过期', invalid: '无效', unchecked: '尚未验证', checking: '验证中', unavailable: '暂时无法验证', none: '无账号会话' };
const DEVICE = { uninitialized: '尚未初始化', registering: '初始化中', ready: '可用', expired: '已失效', failed: '初始化失败', unknown: '尚未检查' };
const ROUTE = { web: '红果官网', app: '红果 App', api: '官方备用接口', xifan: '喜番', custom: '自定义来源', local: '本地视频' };
const SUBROUTE = { 'preload-primary': '主线路', 'preload-alternate': '备用线路', 'video-tab': '元数据备用', 'official-web-public-fallback': '官网公开播放' };
const MEDIA = { idle: '空闲', resolving: '取源中', loading: '加载中', ready: '已就绪', playing: '播放中', paused: '已暂停', buffering: '缓冲中', ended: '播放结束', failed: '失败', cancelled: '已取消' };
const DECODER = { idle: '空闲', pending: '等待首帧', native: '原生解码', compat: '兼容转码', unsupported: '编码不受支持', failed: '解码失败' };
const AUTHORIZATION = { unverified: '尚未验证', supported: '已验证支持', unsupported: '当前不支持' };
const FAULT = {
  ACCOUNT_EXPIRED: '账号登录过期', ACCOUNT_UNAUTHORIZED: '账号授权受限', DEVICE_IDENTITY_EXPIRED: '播放身份失效',
  SIGNATURE_INVALID: '请求签名无效', API_EMPTY_RESPONSE: '播放接口空响应', API_RATE_LIMITED: '接口限流',
  WEB_EPISODE_UNAVAILABLE: '官网未提供本集播放入口',
  API_FORBIDDEN: '官方接口拒绝请求', NETWORK_TIMEOUT: '网络超时', NETWORK_DISCONNECTED: '网络中断',
  MEDIA_URL_EXPIRED: '媒体地址过期', CDN_UNAVAILABLE: '媒体线路不可用', MEDIA_DECRYPT_FAILED: '媒体解密失败',
  CODEC_UNSUPPORTED: '视频编码不受支持', PLAYER_DECODE_FAILED: '播放器解码失败',
  API_BUSINESS_ERROR: '接口业务错误', API_PARSE_ERROR: '接口数据无法识别', SOURCE_EMPTY: '接口未返回播放源',
  API_HTTP_ERROR: '接口 HTTP 错误', SOURCE_PROVIDERS_FAILED: '官网入口与 App 接口均未提供本集',
  MEDIA_FORMAT_UNSUPPORTED: '媒体格式不支持', MANIFEST_LOAD_FAILED: '媒体清单加载失败',
  MEDIA_SEGMENT_FAILED: '媒体资源请求失败', PLAYER_ERROR: '播放器内部错误', DRM_UNSUPPORTED: '受保护媒体需官方授权播放器',
};
const lookup = (map, key, fallback) => Object.hasOwn(map, key) ? map[key] : fallback;
const safeVersion = value => typeof value === 'string' && /^\d{1,4}(?:[.-]\d{1,4}){1,4}$/.test(value) ? value : '尚未读取';
const safeCount = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000000 ? value : 0;

export function diagnosticFaultLabel(code) { return lookup(FAULT, code, code ? '未分类故障' : '暂无'); }
export function diagnosticTime(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000
    ? new Date(value).toLocaleString() : '暂无';
}

export function diagnosticRows(value = {}) {
  const route = lookup(ROUTE, value.sourceRoute, '尚未取源');
  const subroute = lookup(SUBROUTE, value.routeId, '');
  const duration = typeof value.requestDurationMs === 'number' && Number.isFinite(value.requestDurationMs)
    && value.requestDurationMs >= 0 && value.requestDurationMs <= 600000 ? `${Math.round(value.requestDurationMs)} ms` : '暂无';
  return [
    ['播放诊断 ID', typeof value.currentAttempt?.diagnosticId === 'string'
      && /^PLAY-\d{8}-[a-f0-9]{12}$/.test(value.currentAttempt.diagnosticId) ? value.currentAttempt.diagnosticId : '暂无'],
    ['最近失败诊断 ID', typeof value.lastFailure?.diagnosticId === 'string'
      && /^PLAY-\d{8}-[a-f0-9]{12}$/.test(value.lastFailure.diagnosticId) ? value.lastFailure.diagnosticId : '暂无'],
    ['软件版本', safeVersion(value.appVersion)], ['账号登录状态', lookup(ACCOUNT, value.accountState, '尚未检查')],
    ['账号会话有效性', lookup(SESSION, value.sessionValidity, '尚未验证')], ['播放身份状态', lookup(DEVICE, value.deviceState, '尚未检查')],
    ['账号播放鉴权', lookup(AUTHORIZATION, value.playbackAuthorization, '尚未验证')],
    ['播放接口版本', safeVersion(value.profileVersion)], ['当前取源线路', `${route}${subroute ? ` · ${subroute}` : ''}`],
    ['最近取源成功', diagnosticTime(value.lastSourceAt)], ['最近播放成功', diagnosticTime(value.lastSuccessAt)],
    ['最近错误类型', diagnosticFaultLabel(value.lastErrorCode)], ['本轮自动恢复', `${safeCount(value.recoveryCount)} 次`],
    ['最近请求耗时', duration], ['媒体加载状态', lookup(MEDIA, value.mediaStatus, '尚未检查')],
    ['解码器状态', lookup(DECODER, value.decoderStatus, '尚未检查')],
  ];
}

export function diagnosticCheckRows(value = {}) {
  const source = { passed: '通过', failed: '失败', 'not-tested': '未检查' };
  const media = { partial: '已读取部分媒体', complete: '已完整读取', passed: '已读取媒体', failed: '失败', 'not-tested': '未检查' };
  const decode = { passed: '通过', failed: '失败', 'not-tested': '未执行解码' };
  return [['取源', lookup(source, value.source, '未检查')], ['媒体连接', lookup(media, value.media, '未检查')],
    ['视频解码', lookup(decode, value.decode, '未执行解码')]];
}
