const { safeCode } = require('./playback-diagnostics');
const { classifyPlaybackError } = require('./playback-errors');
const { networkFailure } = require('./request-signal');

const LOCAL_MESSAGES = new Set([
  'NAS 文件路径与其他分集冲突，请检查所选文件夹后重试',
  'NAS 目录不可用，请重新挂载共享文件夹后重试',
  'NAS 目录不可用或挂载已变化，已保留文件和任务记录',
  '河马来源已移除，旧任务保留但无法继续下载',
  '来源未开放该集',
  '该集已锁定',
  '该集已锁定，请在来源平台解锁',
  '已有本地文件不完整或路径冲突，文件已保留，请先自行检查或移除',
  '下载目录不可用',
  '下载目录不可用或挂载已变化，已保留文件和任务记录；请确认原目录后重试',
  '下载目标不是普通文件，已保留文件和任务记录',
  '文件路径无效，已保留文件和任务记录',
  '下载目录是链接或无效目录，已保留文件和任务记录',
  '下载目录路径已变化，已保留文件和任务记录',
  '下载目录已变化，已保留文件和任务记录',
  '文件已变化，已保留文件和任务记录',
]);
const MESSAGES = Object.freeze({
  ENOSPC: '磁盘空间不足，请释放空间后重试。', EDQUOT: '存储配额不足，请释放空间后重试。',
  EACCES: '没有写入下载目录的权限，请检查目录权限。', EPERM: '下载文件操作被系统拒绝，请检查权限或文件占用。',
  EBUSY: '下载文件被占用，请关闭占用程序后重试。', EIO: '存储读写失败，请检查下载目录或磁盘。',
  EROFS: '下载目录只读，请选择可写目录。', ENOENT: '下载目录或媒体工具不存在，请检查路径与安装。',
  EEXIST: '下载目标已存在，文件已保留，请检查后重试。',
  LOCAL_MEDIA_TOOL_ERROR: '本机媒体检查工具不可用，请修复安装后重试。',
  MEDIA_DECODE_ERROR: '视频解码校验失败，未发布为完整下载，请重新下载。',
  MEDIA_TRANSFER_ERROR: '视频传输不完整或返回了无效内容，请重新下载。',
  SOURCE_UNAVAILABLE: '当前分集来源暂不可用，请稍后重试。',
  NO_COMPATIBLE_SOURCE: '当前分集未提供兼容的视频格式。', QUALITY_UNAVAILABLE: '当前所选清晰度暂不可用。',
  PREVIEW_ONLY: '官方仅提供预览，未作为完整分集下载。', SECURITY_BLOCKED: '下载地址被安全校验阻止。',
  ERR_WEB_MEDIA_ADDRESS: '下载地址或解析结果未通过公网安全校验。',
  ACCOUNT_EXPIRED: '红果账号登录已过期，请重新登录。', ACCOUNT_UNAUTHORIZED: '当前账号没有此分集的播放授权。',
  DEVICE_IDENTITY_EXPIRED: '播放设备状态已失效，请重新建立播放会话。',
  SIGNATURE_INVALID: '播放请求未通过官方校验，请重新连接片源。',
  API_EMPTY_RESPONSE: '播放接口返回空内容，未取得可下载资源。', API_RATE_LIMITED: '官方请求过于频繁，请稍后手动重试。',
  API_FORBIDDEN: '官方服务拒绝了本次请求，请查看诊断中的 HTTP 状态码。', NETWORK_TIMEOUT: '视频请求超时，请检查网络后重试。',
  WEB_EPISODE_UNAVAILABLE: '官网当前播放入口不提供本集，请在官方客户端查看可用播放方式。',
  SOURCE_PROVIDERS_FAILED: '官网当前入口未提供本集，App 播放接口返回空响应；尚未取得可下载资源。',
  API_BUSINESS_ERROR: '播放接口返回业务错误，已停止重复请求；请查看播放诊断。',
  API_PARSE_ERROR: '无法识别播放接口返回的数据，已停止下载；请导出播放诊断。',
  SOURCE_EMPTY: '当前接口没有返回本集可用下载地址。', API_HTTP_ERROR: '播放接口返回 HTTP 错误，请查看状态码。',
  NETWORK_DISCONNECTED: '视频网络连接已中断，请恢复网络后重试。',
  MEDIA_URL_EXPIRED: '视频地址已过期，请重新获取片源。', CDN_UNAVAILABLE: '视频线路暂时不可用，请重新连接。',
  MEDIA_DECRYPT_FAILED: '视频准备失败，未发布为完整下载。',
  CODEC_UNSUPPORTED: '本机暂不支持当前视频编码。', PLAYER_DECODE_FAILED: '视频解码校验失败，请重新下载。',
  MEDIA_FORMAT_UNSUPPORTED: '当前媒体格式不受支持，未作为完整分集下载。',
  MANIFEST_LOAD_FAILED: 'HLS/DASH 媒体清单加载失败，未完成下载。',
  MEDIA_SEGMENT_FAILED: '视频媒体资源请求失败，未完成下载。', PLAYER_ERROR: '媒体处理发生错误，未完成下载。',
});
const SOURCE_NAMES = Object.freeze({ web: '网页', app: 'App', api: '旧接口', custom: '自定义源', xifan: '喜番' });
const checkedCode = value => typeof value === 'string' ? safeCode(value) || (networkFailure(value) ? value : '') : '';
const checkedStatus = value => typeof value === 'number' && Number.isInteger(value) && value >= 300 && value <= 599 ? value : null;

function localMessage(value) {
  if (typeof value !== 'string') return '';
  if (LOCAL_MESSAGES.has(value)) return value;
  if (/^第 \d{0,6} 集当前锁定，请在西饭官方 App 确认可看范围$/.test(value)) return value;
  if (/^未知任务类型:/.test(value)) return '下载任务类型无效，请删除后重新添加任务。';
  if (/^(?:已有本地文件|片源文件)缺少有效视频轨、分辨率或时长，未完成下载(?:；文件已保留，请先自行检查或移除)?$/.test(value)) return value;
  if (/^(?:已有本地文件|片源文件)实际为 \d{1,6}P（\d{1,6}×\d{1,6}），不满足 (?:AUTO|720P|1080P)(?:；文件已保留，如需重新下载请先自行移除本地文件|，未自动降级)$/.test(value)) return value;
  return '';
}

function downloadErrorDetails(error = {}) {
  // Build from allowlisted primitives; Axios errors and causes retain signed URLs and request headers.
  const code = checkedCode(error?.code);
  const status = checkedStatus(error?.mediaStatus) || checkedStatus(error?.httpStatus)
    || checkedStatus(error?.status) || checkedStatus(error?.response?.status);
  const sources = (Array.isArray(error?.sources) ? error.sources : []).slice(0, 8)
    .map(row => {
      const source = row?.source, sourceCode = checkedCode(row?.code);
      return typeof source === 'string' && Object.hasOwn(SOURCE_NAMES, source) && sourceCode ? { source, code: sourceCode } : null;
    }).filter(Boolean);
  const suppliedStage = error?.stage;
  const faultCode = classifyPlaybackError({ code, status, faultCode: checkedCode(error?.faultCode), sources }, {
    stage: ['source', 'media', 'hls', 'manifest', 'segment', 'decrypt', 'decode', 'player', 'first-frame'].includes(suppliedStage)
      ? suppliedStage : code === 'SOURCE_UNAVAILABLE' ? 'source' : 'media',
  });
  const transportMessage = networkFailure(code) === 'TLS' ? '视频服务的 TLS 证书或握手校验失败，已停止下载。' : '';
  const message = (faultCode === 'WEB_EPISODE_UNAVAILABLE' || code === 'SOURCE_UNAVAILABLE' ? MESSAGES[faultCode] : '')
    || localMessage(error?.message) || MESSAGES[code] || transportMessage || MESSAGES[faultCode]
    || (status ? '视频服务请求失败，请稍后重试。' : '下载任务执行失败，请重试或检查诊断信息。');
  const labels = [code, status ? `HTTP ${status}` : '', ...sources.map(row => `${SOURCE_NAMES[row.source]}：${row.code}`)].filter(Boolean);
  return { message: `${message}${labels.length ? `（${labels.join('；')}）` : ''}`,
    ...(code ? { code } : {}), ...(status ? { status } : {}), ...(faultCode ? { faultCode } : {}),
    ...(sources.length ? { sources } : {}) };
}

module.exports = { downloadErrorDetails };
