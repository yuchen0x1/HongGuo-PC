const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { signedAccountRequest, requestJson } = require('./app-source');
const { getPlaybackDevice } = require('./playback-device');
const { abortError, throwIfAborted, boundedSignal } = require('./request-signal');
const { stripMarkupText } = require('./plain-text');

const WEB_BASE = 'https://hongguoduanju.com';
const WEB_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const WEB_QUERY = {
  aid: '513755', passport_jssdk_version: '3.4.10', passport_jssdk_type: 'normal',
  account_sdk_source: 'web', is_from_ttaccountsdk: '1', language: 'zh',
};

const ACCOUNT_MESSAGES = Object.freeze({
  ACCOUNT_EXPIRED: '红果账号登录已过期，请重新扫码',
  ACCOUNT_UNAUTHORIZED: '红果账号登录态未通过验证，请重新扫码',
  ACCOUNT_STORAGE_UNAVAILABLE: '系统安全存储不可用，本次登录只保留到应用退出',
  ACCOUNT_STORAGE_INVALID: '本地登录态无法读取，请重新扫码',
  ACCOUNT_STORAGE_ERROR: '登录态安全保存或清理失败，请重试',
  ACCOUNT_RESPONSE_INVALID: '红果账号接口响应格式已变化，请稍后重试',
  ACCOUNT_LOGIN_EXPIRED: '扫码会话已失效，请重新获取二维码',
  DEVICE_IDENTITY_EXPIRED: '红果账号关联设备暂不可用，请稍后重试',
  API_RATE_LIMITED: '红果账号请求过于频繁，请稍后重试',
  NETWORK_TIMEOUT: '红果账号验证超时，请检查网络后重试',
  NETWORK_DISCONNECTED: '暂时无法连接红果账号服务，请检查网络后重试',
  SECURITY_BLOCKED: '账号请求地址不受信任，已停止发送登录凭据',
  ERR_CANCELED: '账号操作已取消',
});

function accountError(code, extra = {}) {
  return Object.assign(new Error(ACCOUNT_MESSAGES[code] || ACCOUNT_MESSAGES.ACCOUNT_RESPONSE_INVALID), { code, ...extra });
}

function safeMessage(error, fallback = '账号操作失败，请稍后重试') {
  // Transport errors may contain request headers, URLs or server-echoed secrets.
  return ACCOUNT_MESSAGES[error?.code] || String(fallback).slice(0, 160);
}

function accountFailure(error, signal) {
  if (signal?.aborted) return abortError(signal);
  if (ACCOUNT_MESSAGES[error?.code]) return accountError(error.code);
  if (['ETIMEDOUT', 'ECONNABORTED'].includes(error?.code) || error?.name === 'TimeoutError') return accountError('NETWORK_TIMEOUT');
  return accountError('NETWORK_DISCONNECTED');
}

function withTimeout(promise, timeout, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); }),
  ]).finally(() => clearTimeout(timer));
}

function cleanText(value) {
  return stripMarkupText(String(value || ''))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function cleanCover(value) {
  const text = String(value || '').trim();
  const url = text.startsWith('//') ? `https:${text}` : text;
  if (!/^https?:\/\//i.test(url)) return '';
  try {
    const parsed = new URL(url);
    if (/\.heic$/i.test(parsed.pathname) && /-reading-sign\.fqnovelpic\.com$/i.test(parsed.hostname)) {
      const source = parsed.pathname.split('~tplv-', 1)[0];
      return `https://p3-novel.byteimg.com${source}~tplv-shrink:320:0.webp`;
    }
    return /\.heic$/i.test(parsed.pathname) ? '' : url;
  } catch { return ''; }
}

function responseData(payload) {
  if (!payload || typeof payload !== 'object') throw accountError('ACCOUNT_RESPONSE_INVALID');
  const description = String(payload.data?.description || payload.message || payload.msg || '');
  if (/登录.{0,8}(?:过期|失效)|会话.{0,8}过期|未登录|请.{0,4}(?:重新)?登录|session.{0,8}expir|not\s+(?:logged|login)/i.test(description)) {
    throw accountError('ACCOUNT_EXPIRED');
  }
  if (payload.message && String(payload.message).trim().toLowerCase() !== 'success') {
    throw accountError('ACCOUNT_RESPONSE_INVALID');
  }
  if (payload.code !== undefined && Number(payload.code) !== 0) {
    throw accountError('ACCOUNT_RESPONSE_INVALID');
  }
  if (!payload.data || typeof payload.data !== 'object') throw accountError('ACCOUNT_RESPONSE_INVALID');
  return payload.data;
}

function parseQr(payload) {
  const data = responseData(payload);
  const token = String(data.token || '').trim();
  const source = String(data.qrcode || '').trim();
  if (!token || !source) throw accountError('ACCOUNT_RESPONSE_INVALID');
  const image = /^data:image\//i.test(source) ? source : `data:image/png;base64,${source.split('base64,').pop()}`;
  const rawExpiry = Number(data.expire_time);
  const expiresIn = rawExpiry > 1_000_000_000
    ? Math.max(0, Math.min(600, rawExpiry - Math.floor(Date.now() / 1000)))
    : Math.max(0, Math.min(600, rawExpiry || 180));
  return { token, image, expiresIn: Math.round(expiresIn) };
}

function parsePassportProfile(payload) {
  const data = responseData(payload);
  const id = String(data.user_id_str || data.user_id || '').trim();
  if (!/^\d{1,30}$/.test(id) || !/[1-9]/.test(id)) throw accountError('ACCOUNT_UNAUTHORIZED');
  return { id, nickname: cleanText(data.name || data.screen_name || data.username) || '红果用户' };
}

function parseStoredProfile(value) {
  const id = String(value?.id || '').trim();
  if (!/^\d{1,30}$/.test(id) || !/[1-9]/.test(id)) return null;
  return { id, nickname: cleanText(value?.nickname) || '红果用户' };
}

function parseHistory(payload) {
  const data = responseData(payload);
  const rows = data.data_list;
  if (!Array.isArray(rows)) throw new Error('APP 观看记录格式已变化');
  return rows.map(row => {
    if (row?.is_delete) return null;
    const seriesId = String(row?.book_id_str || row?.book_id || row?.series_id || '').trim();
    const episodeId = String(row?.vid || row?.item_id || '').trim();
    if (!/^\d{1,30}$/.test(seriesId) || !/^\d{1,30}$/.test(episodeId)) return null;
    const index = Number(row?.vid_index);
    const seconds = value => Math.max(0, (Number(value) || 0) / 1000);
    const rawTime = Number(row?.read_timestamp_ms || row?.last_watch_time) || 0;
    return {
      series_id: seriesId,
      series_title: cleanText(row?.series_title || row?.book_name),
      cover: cleanCover(row?.series_cover_url || row?.thumb_url || row?.cover),
      episode_id: episodeId,
      vid_index: Number.isSafeInteger(index) && index > 0 ? index : 0,
      currentTime: seconds(row?.current_play_position ?? row?.current_play_time),
      duration: seconds(row?.duration ?? row?.current_total_time),
      updatedAt: rawTime > 0 && rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime,
      total: Math.max(0, Number(row?.episode_cnt || row?.episode_count) || 0),
      account: true,
    };
  }).filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((row, index, list) => list.findIndex(item => item.series_id === row.series_id) === index)
    .slice(0, 50);
}

class CookieJar {
  constructor(header = '', metadata = [], now = Date.now) {
    this.values = new Map();
    this.metadata = new Map();
    this.now = now;
    if (typeof header !== 'string' || header.length > 65536 || /[\r\n\0]/.test(header)) throw accountError('ACCOUNT_UNAUTHORIZED');
    for (const pair of String(header).split(';')) {
      const at = pair.indexOf('=');
      const name = pair.slice(0, at).trim();
      if (at > 0 && /^[!#$%&'*+.^_`|~\w-]+$/.test(name)) {
        this.values.set(name, pair.slice(at + 1).trim());
        this.metadata.set(name, { domain: 'hongguoduanju.com', hostOnly: true, path: '/', secure: true, expiresAt: null });
      }
    }
    for (const row of Array.isArray(metadata) ? metadata : []) {
      const domain = String(row?.domain || '').replace(/^\./, '').toLowerCase();
      if (!this.values.has(row?.name) || !officialHost(domain)) continue;
      this.metadata.set(row.name, { domain, hostOnly: row.hostOnly !== false,
        path: String(row.path || '/').startsWith('/') ? String(row.path || '/') : '/', secure: row.secure !== false,
        expiresAt: Number.isFinite(row.expiresAt) && row.expiresAt > 0 ? row.expiresAt : null });
    }
  }
  absorb(headers, source = WEB_BASE) {
    const url = checkedWebUrl(source);
    const raw = headers?.['set-cookie'];
    const lines = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const line of lines) {
      const [pair, ...attributes] = String(line).split(';');
      const at = pair.indexOf('=');
      if (at <= 0) continue;
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || /[\r\n\0]/.test(value)) continue;
      const attrs = new Map(attributes.map(item => {
        const split = item.indexOf('=');
        return split < 0 ? [item.trim().toLowerCase(), ''] : [item.slice(0, split).trim().toLowerCase(), item.slice(split + 1).trim()];
      }));
      const domain = String(attrs.get('domain') || url.hostname).replace(/^\./, '').toLowerCase();
      if (!officialHost(domain) || !(url.hostname === domain || url.hostname.endsWith(`.${domain}`))) continue;
      let expiresAt = null;
      if (/^-?\d+$/.test(attrs.get('max-age') || '')) expiresAt = this.now() + Number(attrs.get('max-age')) * 1000;
      else if (attrs.has('expires')) { const parsed = Date.parse(attrs.get('expires')); if (Number.isFinite(parsed)) expiresAt = parsed; }
      if (!value || expiresAt !== null && expiresAt <= this.now()) { this.values.delete(name); this.metadata.delete(name); continue; }
      const defaultPath = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) || '/';
      const cookiePath = attrs.get('path') || defaultPath;
      this.values.set(name, value);
      this.metadata.set(name, { domain, hostOnly: !attrs.has('domain'), path: cookiePath.startsWith('/') ? cookiePath : '/',
        secure: attrs.has('secure'), expiresAt });
    }
  }
  header(target = WEB_BASE) {
    const url = checkedWebUrl(target);
    return [...this.values].filter(([name, value]) => {
      const row = this.metadata.get(name);
      if (!value || !row || row.expiresAt !== null && row.expiresAt <= this.now() || row.secure && url.protocol !== 'https:') return false;
      return (row.hostOnly ? row.domain === url.hostname : url.hostname === row.domain || url.hostname.endsWith(`.${row.domain}`))
        && (url.pathname === row.path || url.pathname.startsWith(row.path.endsWith('/') ? row.path : `${row.path}/`));
    }).map(([name, value]) => `${name}=${value}`).join('; ');
  }
  storedHeader() {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  storedMetadata() {
    return [...this.metadata].map(([name, value]) => ({ name, ...value }));
  }
  expiresAt() {
    const sessions = ['sessionid', 'sessionid_ss'].filter(name => this.values.get(name)).map(name => this.metadata.get(name)?.expiresAt);
    return !sessions.length || sessions.some(value => value == null) ? null : Math.max(...sessions);
  }
  hasSession() {
    return ['sessionid', 'sessionid_ss'].some(name => this.values.get(name)
      && (this.metadata.get(name)?.expiresAt == null || this.metadata.get(name).expiresAt > this.now()));
  }
  hasStoredSession() {
    return ['sessionid', 'sessionid_ss'].some(name => this.values.get(name));
  }
}

function officialHost(host) {
  return host === 'hongguoduanju.com' || host.endsWith('.hongguoduanju.com');
}

function checkedWebUrl(value) {
  let url;
  try { url = new URL(value, WEB_BASE); } catch { throw accountError('SECURITY_BLOCKED'); }
  if (url.protocol !== 'https:' || !officialHost(url.hostname) || url.username || url.password || url.port && url.port !== '443') {
    throw accountError('SECURITY_BLOCKED');
  }
  return url;
}

async function defaultWebRequest(url, options) {
  const axios = require('axios');
  const response = await axios({
    url, method: options.method || 'GET', headers: options.headers || {}, timeout: 12000, signal: options.signal,
    data: options.body,
    maxRedirects: 0, responseType: 'text', transformResponse: [data => data],
    maxContentLength: 2 * 1024 * 1024, maxBodyLength: 1024 * 1024, validateStatus: () => true,
  });
  return { status: response.status, headers: response.headers || {}, data: response.data || '' };
}

function checkedWebResponse(response) {
  if (response?.status === 401) throw accountError('ACCOUNT_EXPIRED');
  if (response?.status === 403) throw accountError('ACCOUNT_UNAUTHORIZED');
  if (response?.status === 429) throw accountError('API_RATE_LIMITED');
  if (!response || response.status !== 200) throw accountError('NETWORK_DISCONNECTED');
  const raw = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {});
  if (!raw.trim() || raw.length > 2 * 1024 * 1024) throw accountError('ACCOUNT_RESPONSE_INVALID');
  let payload;
  try { payload = JSON.parse(raw); } catch { throw accountError('ACCOUNT_RESPONSE_INVALID'); }
  return payload;
}

function secureSessionStore({ filePath, safeStorage }) {
  const revokedPath = `${filePath}.revoked`;
  return {
    save(credentials) {
      if (!safeStorage?.isEncryptionAvailable?.() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw accountError('ACCOUNT_STORAGE_UNAVAILABLE');
      const encrypted = safeStorage.encryptString(JSON.stringify(credentials));
      const temporary = `${filePath}.tmp`;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const fd = fs.openSync(temporary, 'w', 0o600);
      try { fs.writeFileSync(fd, encrypted); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temporary, filePath);
      try { fs.chmodSync(filePath, 0o600); } catch {}
      try { fs.unlinkSync(revokedPath); }
      catch (error) { if (error.code !== 'ENOENT') throw accountError('ACCOUNT_STORAGE_ERROR'); }
    },
    load() {
      if (fs.existsSync(revokedPath)) return null;
      if (!fs.existsSync(filePath)) return null;
      if (!safeStorage?.isEncryptionAvailable?.() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw accountError('ACCOUNT_STORAGE_UNAVAILABLE');
      try {
        const text = safeStorage.decryptString(fs.readFileSync(filePath));
        const value = JSON.parse(text);
        if (!value || typeof value.cookie !== 'string' || !value.cookie.trim()) throw accountError('ACCOUNT_STORAGE_INVALID');
        return value;
      } catch { throw accountError('ACCOUNT_STORAGE_INVALID'); }
    },
    clear() {
      // Revoke restoration before unlinking: Windows may retain a locked file.
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const fd = fs.openSync(revokedPath, 'w', 0o600);
        try { fs.writeFileSync(fd, 'revoked\n'); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
      } catch { /* Deletion can still remove every credential if marking fails. */ }
      let failed = false;
      for (const target of [filePath, `${filePath}.tmp`]) {
        try { fs.unlinkSync(target); } catch (error) { if (error.code !== 'ENOENT') failed = true; }
      }
      if (failed) throw accountError('ACCOUNT_STORAGE_ERROR');
      try { fs.unlinkSync(revokedPath); }
      catch (error) { if (error.code !== 'ENOENT') throw accountError('ACCOUNT_STORAGE_ERROR'); }
    },
  };
}

function createAccountService({
  filePath, safeStorage, webRequest = defaultWebRequest, identityRequest = getPlaybackDevice,
  accountRequest = requestJson, now = Date.now, onAccountExpired = () => {}, verificationTtl = 60000,
  playbackProbeRequest = (vid, options) => require('./app-source').createPlaybackAuthProbeRequest(vid, options),
}) {
  const sessionStore = secureSessionStore({ filePath, safeStorage });
  let credentials = null;
  let profile = null;
  let history = [];
  let historyLoaded = false;
  let restorePromise = null;
  let generation = 0;
  let login = null;
  let loginGeneration = 0;
  let sessionValidity = 'anonymous';
  let checkedAt = null;
  let expiresAt = null;
  let lastErrorCode = '';
  let storageWarning = '';
  let verification = null;
  let retryAt = 0;
  let loginController = null;
  let sessionController = new AbortController();

  const publicAccount = extra => ({
    success: true, signedIn: !!profile && !!credentials, account: profile ? { ...profile } : null,
    sessionValidity, checkedAt, expiresAt, lastErrorCode, retryAt, checking: !!verification,
    deviceAssociation: { status: credentials?.deviceId && credentials?.installId && credentials?.cdid ? 'linked' : 'unlinked',
      kind: 'local-only', platformVerified: false },
    playbackAuthorization: 'unverified',
    ...(storageWarning ? { storageWarning } : {}), ...extra,
  });

  function clearSession(validity = 'anonymous', code = '') {
    generation++;
    sessionController.abort();
    sessionController = new AbortController();
    credentials = null;
    profile = null;
    history = [];
    historyLoaded = false;
    sessionValidity = validity;
    checkedAt = now();
    expiresAt = null;
    lastErrorCode = code;
    retryAt = 0;
    let storageFailure;
    try { sessionStore.clear(); storageWarning = ''; }
    catch (error) {
      storageWarning = safeMessage(error, ACCOUNT_MESSAGES.ACCOUNT_STORAGE_ERROR);
      storageFailure = accountError('ACCOUNT_STORAGE_ERROR');
      if (!code) lastErrorCode = storageFailure.code;
    }
    if (code) { try { onAccountExpired({ code }); } catch {} }
    if (storageFailure) throw storageFailure;
  }

  function saveSession(value, invalidatePrevious = false) {
    try { sessionStore.save(value); storageWarning = ''; }
    catch (error) {
      storageWarning = safeMessage(error, ACCOUNT_MESSAGES.ACCOUNT_STORAGE_ERROR);
      // A failed new-account save must not silently restore the previous account next launch.
      if (invalidatePrevious) { try { sessionStore.clear(); } catch { storageWarning = ACCOUNT_MESSAGES.ACCOUNT_STORAGE_ERROR; } }
    }
  }

  async function waitOperation(promise, signal) {
    throwIfAborted(signal);
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(abortError(signal)); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }

  async function accountJson(targetCredentials, apiPath, params = {}, signal) {
    const signed = signedAccountRequest(apiPath, params, {
      device_id: targetCredentials.deviceId, iid: targetCredentials.installId, cdid: targetCredentials.cdid,
    });
    const url = new URL(signed.url);
    // The existing history integration is the only App credential consumer.
    if (url.origin !== 'https://api5-normal-sinfonlinea.fqnovel.com' || url.pathname !== '/reading/bookapi/read_history/list/v1/') {
      throw accountError('SECURITY_BLOCKED');
    }
    const request = boundedSignal(signal ? AbortSignal.any([signal, sessionController.signal]) : sessionController.signal, 12000);
    try {
      return await waitOperation(accountRequest(signed.url, {
        method: 'GET', headers: { ...signed.headers, Cookie: new CookieJar(targetCredentials.cookie, targetCredentials.cookieMetadata, now).header() },
        preserveLargeIntegerFields: ['vid', 'video_id', 'item_id'],
      }, Date.now() + 12000, request.signal), request.signal);
    } finally { request.dispose(); }
  }

  async function verify(targetCredentials, signal) {
    const jar = new CookieJar(targetCredentials.cookie, targetCredentials.cookieMetadata, now);
    if (!jar.hasSession()) throw accountError(jar.hasStoredSession() ? 'ACCOUNT_EXPIRED' : 'ACCOUNT_UNAUTHORIZED');
    const nextProfile = parsePassportProfile(await webJson('/passport/account/info/v2/', {}, jar, `${WEB_BASE}/`, signal));
    if (!jar.hasSession()) throw accountError('ACCOUNT_EXPIRED');
    return { profile: nextProfile, cookie: jar.storedHeader(), cookieMetadata: jar.storedMetadata(), expiresAt: jar.expiresAt() };
  }

  async function restore() {
    try {
      const saved = sessionStore.load();
      if (!saved) return publicAccount();
      const jar = new CookieJar(saved.cookie, saved.cookieMetadata, now);
      if (!jar.hasSession()) {
        clearSession(jar.hasStoredSession() ? 'expired' : 'invalid', jar.hasStoredSession() ? 'ACCOUNT_EXPIRED' : 'ACCOUNT_UNAUTHORIZED');
      } else {
        credentials = { ...saved, cookie: jar.storedHeader(), cookieMetadata: jar.storedMetadata() };
        profile = parseStoredProfile(saved.profile);
        sessionValidity = 'unverified';
        expiresAt = jar.expiresAt();
      }
      return publicAccount();
    } catch (error) {
      sessionValidity = error?.code === 'ACCOUNT_STORAGE_UNAVAILABLE' ? 'unavailable' : 'invalid';
      lastErrorCode = error?.code === 'ACCOUNT_STORAGE_UNAVAILABLE' ? error.code : 'ACCOUNT_STORAGE_INVALID';
      storageWarning = safeMessage(error, ACCOUNT_MESSAGES.ACCOUNT_STORAGE_INVALID);
      return publicAccount();
    }
  }

  async function ensureRestored() {
    if (!restorePromise) restorePromise = restore();
    return restorePromise;
  }

  async function rawWebRequest(url, options, signal) {
    checkedWebUrl(url);
    const request = boundedSignal(signal, 12000);
    try {
      const response = await waitOperation(webRequest(url, { ...options, credentials: 'omit', signal: request.signal }), request.signal);
      throwIfAborted(request.signal);
      return response;
    } catch (error) { throw accountFailure(error, request.signal); }
    finally { request.dispose(); }
  }

  async function webJson(pathname, params = {}, jar = new CookieJar('', [], now), referer = `${WEB_BASE}/`, signal) {
    const url = checkedWebUrl(pathname);
    for (const [name, value] of Object.entries({ ...WEB_QUERY, ...params })) url.searchParams.set(name, value);
    const cookie = jar.header(url.href);
    const headers = {
      'User-Agent': WEB_UA, Referer: referer, Origin: WEB_BASE,
      Accept: 'application/json, text/javascript',
      ...(cookie ? { Cookie: cookie } : {}),
    };
    const response = await rawWebRequest(url.href, { method: 'GET', headers, explicitCookie: !!cookie }, signal);
    jar.absorb(response.headers, url.href);
    return checkedWebResponse(response);
  }

  async function finishRedirect(value, jar, signal) {
    let url = checkedWebUrl(value);
    for (let count = 0; count < 5; count++) {
      checkedWebUrl(url.href);
      const response = await rawWebRequest(url.href, {
        method: 'GET', headers: { 'User-Agent': WEB_UA, Referer: `${WEB_BASE}/`, Cookie: jar.header(url.href) }, explicitCookie: true,
      }, signal);
      jar.absorb(response.headers, url.href);
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers?.location) {
        url = checkedWebUrl(new URL(response.headers.location, url).href);
        continue;
      }
      if (response.status !== 200) checkedWebResponse(response);
      return;
    }
    throw accountError('SECURITY_BLOCKED');
  }

  function joinVerification(flight, signal) {
    throwIfAborted(signal);
    const waiter = {};
    flight.waiters.add(waiter);
    return new Promise((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        finished = true;
        signal?.removeEventListener('abort', abort);
        flight.waiters.delete(waiter);
      };
      const abort = () => {
        if (finished) return;
        cleanup();
        if (!flight.settled && !flight.waiters.size) flight.controller.abort();
        reject(abortError(signal));
      };
      signal?.addEventListener('abort', abort, { once: true });
      flight.promise.then(value => { if (!finished) { cleanup(); resolve(value); } }, error => { if (!finished) { cleanup(); reject(error); } });
    });
  }

  async function checkSession({ signal, force = false } = {}) {
    throwIfAborted(signal);
    await ensureRestored();
    throwIfAborted(signal);
    if (!credentials) return publicAccount();
    if (expiresAt !== null && expiresAt <= now()) {
      clearSession('expired', 'ACCOUNT_EXPIRED');
      return publicAccount();
    }
    if (!force && sessionValidity === 'valid' && checkedAt !== null && now() - checkedAt < verificationTtl) return publicAccount();
    if (retryAt > now() && (!force || lastErrorCode === 'API_RATE_LIMITED')) return publicAccount();
    if (!verification || verification.controller.signal.aborted) {
      const current = credentials, token = generation;
      const flight = { controller: new AbortController(), waiters: new Set(), settled: false, promise: null };
      verification = flight;
      flight.promise = Promise.resolve().then(async () => {
        try {
          const result = await verify(current, flight.controller.signal);
          if (generation !== token || credentials !== current) return publicAccount();
          profile = result.profile;
          credentials = { ...current, ...result, schemaVersion: 2 };
          checkedAt = now(); expiresAt = result.expiresAt; lastErrorCode = ''; retryAt = 0; sessionValidity = 'valid';
          saveSession(credentials);
          return publicAccount({ checking: false });
        } catch (error) {
          if (generation !== token || credentials !== current) return publicAccount();
          if (flight.controller.signal.aborted || error?.code === 'ERR_CANCELED') throw abortError(flight.controller.signal);
          const code = error?.code === 'ETIMEDOUT' ? 'NETWORK_TIMEOUT' : error?.code || 'NETWORK_DISCONNECTED';
          if (code === 'ACCOUNT_EXPIRED' || code === 'ACCOUNT_UNAUTHORIZED') clearSession(code === 'ACCOUNT_EXPIRED' ? 'expired' : 'invalid', code);
          else {
            sessionValidity = 'unavailable'; lastErrorCode = ACCOUNT_MESSAGES[code] ? code : 'NETWORK_DISCONNECTED'; checkedAt = now();
            retryAt = now() + (lastErrorCode === 'API_RATE_LIMITED' ? 60000 : 10000);
          }
          return publicAccount({ checking: false });
        } finally {
          flight.settled = true;
          if (verification === flight) verification = null;
        }
      });
    }
    return joinVerification(verification, signal);
  }

  async function finishLogin(cookie, metadata, isCurrent, signal) {
    const [identity, verified] = await Promise.all([
      withTimeout(identityRequest(accountRequest), 10000, ACCOUNT_MESSAGES.NETWORK_TIMEOUT).catch(() => null),
      verify({ cookie, cookieMetadata: metadata }, signal),
    ]);
    if (!isCurrent()) return { success: true, status: 'cancelled' };
    verification?.controller.abort();
    verification = null;
    sessionController.abort();
    sessionController = new AbortController();
    credentials = { ...verified, ...(identity ? { deviceId: identity.device_id, installId: identity.iid, cdid: identity.cdid } : {}), schemaVersion: 2 };
    profile = verified.profile; history = []; historyLoaded = false;
    checkedAt = now(); expiresAt = verified.expiresAt; lastErrorCode = ''; retryAt = 0; sessionValidity = 'valid';
    generation++;
    saveSession(credentials, true);
    login = null;
    restorePromise = Promise.resolve(publicAccount());
    return publicAccount({ status: 'signed-in' });
  }

  const service = {
    async status() {
      await ensureRestored();
      if (credentials && !profile) return checkSession();
      if (credentials && !verification && retryAt <= now() && (sessionValidity !== 'valid' || checkedAt === null || now() - checkedAt >= verificationTtl)) {
        void checkSession().catch(() => {});
      }
      return publicAccount();
    },

    checkSession,

    refreshSession(options = {}) { return checkSession({ ...options, force: true }); },

    async getPlaybackContext(options = {}) {
      const status = await checkSession(options);
      return { signedIn: status.signedIn, sessionValidity: status.sessionValidity, checkedAt: status.checkedAt,
        expiresAt: status.expiresAt, lastErrorCode: status.lastErrorCode, deviceAssociation: status.deviceAssociation,
        accountGeneration: generation, accountLinked: status.signedIn && status.sessionValidity === 'valid',
        playbackAuthorization: 'unverified', authorizationMode: 'anonymous-device' };
    },

    async probeOfficialPlayback({ seriesId, vid, signal } = {}) {
      if (!/^\d{1,30}$/.test(String(seriesId || '')) || !/^\d{1,30}$/.test(String(vid || ''))) throw accountError('ACCOUNT_RESPONSE_INVALID');
      const status = await checkSession({ signal, force: true });
      if (!status.signedIn || status.sessionValidity !== 'valid') throw accountError(status.lastErrorCode || 'ACCOUNT_UNAUTHORIZED');
      const current = credentials, token = generation;
      signal = signal ? AbortSignal.any([signal, sessionController.signal]) : sessionController.signal;
      const url = `${WEB_BASE}/player/${seriesId}/${vid}`;
      const jar = new CookieJar(current.cookie, current.cookieMetadata, now);
      const inspect = async authenticated => {
        const started = now();
        const response = await rawWebRequest(url, { method: 'GET', explicitCookie: authenticated,
          headers: { 'User-Agent': WEB_UA, Accept: 'text/html,application/xhtml+xml', Referer: `${WEB_BASE}/`,
            ...(authenticated ? { Cookie: jar.header(url) } : {}) } }, signal);
        const result = { status: Number(response?.status) || 0, elapsedMs: Math.max(0, now() - started),
          responseShape: 'unrecognized', identityMatches: false, protectedPlayback: null, publicVideoAvailable: false };
        if (response?.status !== 200) return result;
        const html = typeof response.data === 'string' ? response.data : '';
        if (!html || html.length > 8 * 1024 * 1024) return result;
        try {
          const router = require('./catalog').readRouterData(html);
          const data = router.loaderData?.['player_(series_id)/(vid)/page'];
          if (!data) return result;
          result.responseShape = 'official-player-page';
          result.identityMatches = data.isSuccess !== false && String(data.series_id) === String(seriesId)
            && String(data.vid) === String(vid) && String(data.seriesDetail?.series_id) === String(seriesId);
          result.protectedPlayback = typeof data.protectedPlayback === 'boolean' ? data.protectedPlayback : null;
          for (const name of ['pcLoginRequired', 'pcAuthenticatedPlayback', 'encryptedBrowserAllowed']) {
            result[name] = typeof data.req?.[name] === 'boolean' ? data.req[name] : null;
          }
          result.publicVideoAvailable = data.publicVideoSeo?.available === true
            && String(data.publicVideoSeo.itemId) === String(vid) && String(data.publicVideoSeo.seriesId) === String(seriesId);
        } catch {}
        return result;
      };
      const [anonymous, authenticated] = await Promise.all([inspect(false), inspect(true)]);
      if (token !== generation) throw accountError('ERR_CANCELED');
      return { checkedAt: now(), route: 'official-web-player', anonymous, authenticated,
        webCookieAuthorization: anonymous.identityMatches && authenticated.identityMatches
          && anonymous.protectedPlayback === true && authenticated.protectedPlayback === false ? 'page-access-changed' : 'not-demonstrated',
        appCookieAuthorization: 'not-tested', fullEpisodePlaybackVerified: false };
    },

    async probeOfficialWebPlaybackApi({ seriesId, vid, signal } = {}) {
      if (!/^\d{1,30}$/.test(String(seriesId || '')) || !/^\d{1,30}$/.test(String(vid || ''))) throw accountError('ACCOUNT_RESPONSE_INVALID');
      const status = await checkSession({ signal, force: true });
      if (!status.signedIn || status.sessionValidity !== 'valid') throw accountError(status.lastErrorCode || 'ACCOUNT_UNAUTHORIZED');
      const current = credentials, token = generation;
      signal = signal ? AbortSignal.any([signal, sessionController.signal]) : sessionController.signal;
      const config = require('./official-web-playback').OFFICIAL_WEB_PROFILE;
      const url = checkedWebUrl(config.playInfoPath);
      if (url.origin !== WEB_BASE || url.pathname !== '/api/video/protected/play-info') throw accountError('SECURITY_BLOCKED');
      for (const [name, value] of Object.entries(config.query)) url.searchParams.set(name, value);
      const jar = new CookieJar(current.cookie, current.cookieMetadata, now);
      const body = JSON.stringify({ series_id: String(seriesId), item_id: String(vid), definition: config.playInfoDefinition });
      const inspect = async authenticated => {
        const started = now();
        const response = await rawWebRequest(url.href, { method: 'POST', body, explicitCookie: authenticated,
          headers: { ...config.defaultHeaders, 'User-Agent': WEB_UA, Origin: WEB_BASE,
            Referer: `${WEB_BASE}/player/${seriesId}/${vid}`,
            ...(authenticated ? { Cookie: jar.header(url.href) } : {}) } }, signal);
        const result = { status: Number(response?.status) || 0, elapsedMs: Math.max(0, now() - started),
          responseShape: 'unrecognized', businessAccepted: false, mediaConfigured: false, encryptedPlayerRequired: false };
        if (response.status !== 200) return result;
        let payload;
        try { payload = checkedWebResponse(response); } catch { return result; }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return result;
        result.responseShape = 'json';
        const code = payload.base_resp?.StatusCode ?? payload.base_resp?.status_code;
        result.businessAccepted = code !== undefined && Number(code) === 0;
        const media = payload.legacy_play_info || payload.play_info;
        result.mediaConfigured = result.businessAccepted && typeof media?.main_url === 'string' && !!media.main_url;
        result.encryptedPlayerRequired = !!payload.play_info && !payload.legacy_play_info;
        return result;
      };
      // Start with the legitimate account; an explicit rejection ends this diagnostic.
      const authenticated = await inspect(true);
      const anonymous = [401, 403, 429].includes(authenticated.status)
        ? { skipped: 'explicit-rejection' } : await inspect(false);
      if (token !== generation) throw accountError('ERR_CANCELED');
      return { checkedAt: now(), route: 'official-web-play-info', authenticated, anonymous,
        sameRequestProfile: true, sameBody: true,
        webCookieAuthorization: authenticated.mediaConfigured && !anonymous.mediaConfigured ? 'media-config-access-changed' : 'not-demonstrated',
        fullEpisodePlaybackVerified: false };
    },

    async probeOfficialAppPlayback({ vid, signal } = {}) {
      if (!/^\d{1,30}$/.test(String(vid || ''))) throw accountError('ACCOUNT_RESPONSE_INVALID');
      const status = await checkSession({ signal, force: true });
      if (!status.signedIn || status.sessionValidity !== 'valid') throw accountError(status.lastErrorCode || 'ACCOUNT_UNAUTHORIZED');
      const current = credentials, token = generation;
      const cookie = new CookieJar(current.cookie, current.cookieMetadata, now).header();
      const request = boundedSignal(signal ? AbortSignal.any([signal, sessionController.signal]) : sessionController.signal, 24000);
      const deadline = Date.now() + 24000;
      try {
        const signed = await playbackProbeRequest(String(vid), { signal: request.signal });
        const url = new URL(signed?.url);
        if (!['https://reading.snssdk.com', 'https://api5-normal-sinfonlineb.fqnovel.com'].includes(url.origin)
          || url.pathname !== '/novel/player/multi_video_model/preload/v1' || url.username || url.password
          || signed.options?.method !== 'POST' || !Buffer.isBuffer(signed.options.data)) throw accountError('SECURITY_BLOCKED');
        const headers = { ...signed.options.headers };
        if (Object.keys(headers).some(name => /^(?:cookie|authorization|proxy-authorization)$/i.test(name))) throw accountError('SECURITY_BLOCKED');
        const inspect = async authenticated => {
          const started = now();
          try {
            const payload = await waitOperation(accountRequest(url.href, { method: 'POST', headers: { ...headers,
              ...(authenticated ? { Cookie: cookie } : {}) }, data: signed.options.data, maxRedirects: 0,
            }, Math.min(Date.now() + 12000, deadline), request.signal), request.signal);
            return { status: 200, emptyResponse: false, elapsedMs: Math.max(0, now() - started), errorCode: '',
              responseShape: 'json', ...require('./app-source').inspectPlaybackAuthProbeResponse(payload, String(vid)) };
          } catch (error) {
            throwIfAborted(request.signal);
            const status = Number(error?.status) || (error?.code === 'EMPTY_RESPONSE' ? 200 : 0);
            const code = error?.code === 'EMPTY_RESPONSE' ? 'API_EMPTY_RESPONSE' : status === 403 ? 'API_FORBIDDEN'
              : status === 429 ? 'API_RATE_LIMITED' : status === 401 ? 'ACCOUNT_UNAUTHORIZED'
              : ['ETIMEDOUT', 'ECONNABORTED'].includes(error?.code) ? 'NETWORK_TIMEOUT'
              : error?.code === 'SECURITY_BLOCKED' ? 'SECURITY_BLOCKED' : error?.code === 'INVALID_RESPONSE' ? 'INVALID_RESPONSE' : 'NETWORK_DISCONNECTED';
            return { status, emptyResponse: error?.code === 'EMPTY_RESPONSE', elapsedMs: Math.max(0, now() - started), errorCode: code,
              responseShape: error?.code === 'EMPTY_RESPONSE' ? 'empty' : 'unrecognized',
              businessAccepted: false, episodeMatches: false, modelPresent: false, mediaModelPresent: false };
          }
        };
        // This explicit diagnostic performs one comparison, with no recovery loop.
        const anonymous = await inspect(false);
        const authenticated = [401, 403, 429].includes(anonymous.status) ? { skipped: 'explicit-rejection' } : await inspect(true);
        if (token !== generation) throw accountError('ERR_CANCELED');
        return { checkedAt: now(), route: 'official-app-preload', anonymous, authenticated,
          sameRequestProfile: true, sameDeviceIdentity: true, sameSignedRequest: true,
          appCookieAuthorization: !anonymous.mediaModelPresent && authenticated.businessAccepted === true && authenticated.mediaModelPresent === true
            && authenticated.episodeMatches === true ? 'model-access-changed' : 'not-demonstrated',
          fullEpisodePlaybackVerified: false };
      } finally { request.dispose(); }
    },

    async completeWebLogin(cookie, { cookies = [] } = {}) {
      const attempt = ++loginGeneration;
      loginController?.abort();
      const controller = new AbortController();
      loginController = controller;
      login = null;
      const token = generation;
      const metadata = cookies.map(row => ({ name: row.name, domain: String(row.domain || 'hongguoduanju.com').replace(/^\./, ''),
        hostOnly: row.hostOnly !== false, path: row.path || '/', secure: row.secure !== false,
        expiresAt: Number.isFinite(row.expirationDate) && row.expirationDate > 0 ? row.expirationDate * 1000 : null }));
      try { return await finishLogin(cookie, metadata, () => attempt === loginGeneration && token === generation, controller.signal); }
      catch (error) {
        if (attempt !== loginGeneration || token !== generation) return { success: true, status: 'cancelled' };
        throw accountFailure(error, controller.signal);
      }
    },

    async startLogin() {
      const attempt = ++loginGeneration;
      loginController?.abort();
      loginController = new AbortController();
      login = null;
      const jar = new CookieJar('', [], now);
      const payload = await webJson('/passport/web/get_qrcode/', { next: `${WEB_BASE}/` }, jar, `${WEB_BASE}/`, loginController.signal);
      if (attempt !== loginGeneration) throw accountError('ERR_CANCELED');
      const qr = parseQr(payload);
      login = { id: randomUUID(), token: qr.token, jar, expiresAt: now() + qr.expiresIn * 1000 };
      return { success: true, loginId: login.id, image: qr.image, expiresIn: qr.expiresIn };
    },

    async pollLogin(loginId) {
      if (!login || login.id !== loginId) throw accountError('ACCOUNT_LOGIN_EXPIRED');
      if (now() >= login.expiresAt) {
        login = null;
        return { success: true, status: 'expired' };
      }
      const currentLogin = login;
      const attempt = loginGeneration;
      const stillCurrent = () => login === currentLogin && attempt === loginGeneration;
      try {
        const data = responseData(await webJson('/passport/web/check_qrconnect/', {
          next: `${WEB_BASE}/`, token: login.token,
        }, login.jar, `${WEB_BASE}/`, loginController?.signal));
        if (!stillCurrent()) return { success: true, status: 'cancelled' };
        if (['5', 'expired'].includes(String(data.status))) {
          login = null;
          return { success: true, status: 'expired' };
        }
        if (!['3', 'confirmed'].includes(String(data.status))) return { success: true, status: 'pending' };
        if (data.redirect_url) await finishRedirect(String(data.redirect_url), login.jar, loginController?.signal);
        if (!stillCurrent()) return { success: true, status: 'cancelled' };
        if (!login.jar.hasSession()) return { success: true, status: 'pending' };

        return await finishLogin(login.jar.storedHeader(), login.jar.storedMetadata(), stillCurrent, loginController?.signal);
      } catch (error) {
        if (!stillCurrent()) return { success: true, status: 'cancelled' };
        throw accountFailure(error, loginController?.signal);
      }
    },

    cancelLogin(loginId) {
      if (loginId && login && login.id !== loginId) return { success: true };
      loginGeneration++;
      loginController?.abort();
      loginController = null;
      login = null;
      return { success: true };
    },

    async logout() {
      loginGeneration++;
      loginController?.abort();
      loginController = null;
      verification?.controller.abort();
      verification = null;
      login = null;
      try { clearSession(); }
      finally { restorePromise = Promise.resolve(publicAccount()); }
      return publicAccount();
    },

    async refreshHistory({ signal } = {}) {
      await checkSession({ signal });
      let current = credentials;
      if (!current || !profile) return publicAccount({ results: [] });
      if (sessionValidity !== 'valid') throw accountError(lastErrorCode || 'NETWORK_DISCONNECTED');
      const token = generation;
      if (!current.deviceId || !current.installId || !current.cdid) {
        let identity;
        try { identity = await waitOperation(withTimeout(identityRequest(accountRequest), 10000, ACCOUNT_MESSAGES.NETWORK_TIMEOUT),
          signal ? AbortSignal.any([signal, sessionController.signal]) : sessionController.signal); }
        catch (error) {
          if (signal?.aborted) throw abortError(signal);
          if (token !== generation) return publicAccount({ results: [] });
          throw accountError('DEVICE_IDENTITY_EXPIRED');
        }
        if (token !== generation) return publicAccount({ results: [] });
        current = credentials = { ...credentials, deviceId: identity.device_id, installId: identity.iid, cdid: identity.cdid };
        saveSession(credentials);
      }
      const rows = parseHistory(await accountJson(current, '/reading/bookapi/read_history/list/v1/', {
        book_type: '2', limit: '0', offset: '0', last_min_read_timestamp_ms: '0',
        full_field: 'true', is_first_load: 'true', query_soft_deleted: 'false',
      }, signal));
      if (token !== generation) return publicAccount({ results: [] });
      history = rows.map(row => ({
        ...row,
        series_title: row.series_title || `剧集 ${row.series_id}`,
      }));
      historyLoaded = true;
      return publicAccount({ results: history.map(row => ({ ...row })) });
    },

    async history({ refresh = false, signal } = {}) {
      await ensureRestored();
      const current = credentials;
      if (!current || !profile) return publicAccount({ results: [] });
      if (!historyLoaded || refresh) return service.refreshHistory({ signal });
      return publicAccount({ results: history.map(row => ({ ...row })) });
    },

    row(seriesId) {
      return history.find(row => row.series_id === String(seriesId)) || null;
    },
  };
  return service;
}

module.exports = {
  createAccountService, secureSessionStore, parseQr, parsePassportProfile, parseHistory, safeMessage,
  CookieJar,
};
