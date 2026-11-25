const axios = require('axios');
const { isPublicMediaUrl, webMediaRequestOptions } = require('./web-media-guard');
const { mediaExpiresAt } = require('./media-url-manager');
const { boundedSignal, throwIfAborted } = require('./request-signal');
const { classifyPlaybackError } = require('./playback-errors');

// Observed on official player bundles q.8c157d1b80, fk.a229907b0c and 2y.fae086446b.
const OFFICIAL_WEB_PROFILE = Object.freeze({
  id: 'hongguo-official-web-public-v1', version: '2026-11-25.1', origin: 'https://hongguoduanju.com',
  routeId: 'official-web-public-fallback',
  fallbackPath: '/api/video/protected/fallback-play-info',
  playInfoPath: '/api/video/protected/play-info', playInfoDefinition: '720p',
  query: Object.freeze({ aid: 8662 }),
  defaultHeaders: Object.freeze({ 'X-Xs-From-Web': '1', 'Content-Type': 'application/json' }),
  timeouts: Object.freeze({ playInfoMs: 5000, fallbackMs: 20000, metadataMs: 5000, totalMs: 24000 }),
  metadataBytes: 1024 * 1024,
});

function failure(code, status) {
  return Object.assign(new Error('Official public playback is unavailable'), { code, ...(status ? { status } : {}) });
}

function publicApiBody(value) {
  if (value == null || typeof value === 'string' && !value.trim()) throw failure('EMPTY_RESPONSE');
  let data = value;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { throw failure('INVALID_RESPONSE'); }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || typeof data.base_resp?.StatusCode !== 'number' || !Number.isSafeInteger(data.base_resp.StatusCode)) {
    throw failure('INVALID_RESPONSE');
  }
  if (data.base_resp.StatusCode !== 0) throw failure('BUSINESS_REJECTED');
  return data;
}

function publicEpisodePermission(data, vid, seriesId) {
  const id = String(vid || ''), sid = String(seriesId || data?.series_id || '');
  const detail = data?.seriesDetail, seo = data?.publicVideoSeo, req = data?.req;
  const currentId = String(data?.vid || '');
  if (!/^\d{1,30}$/.test(id) || !/^\d{1,30}$/.test(sid) || data?.isSuccess !== true
      || !/^\d{1,30}$/.test(currentId) || String(data.series_id) !== sid || String(detail?.series_id) !== sid) {
    throw failure('INVALID_RESPONSE');
  }
  const rawVids = detail.vid_list;
  const vids = Array.isArray(rawVids) ? rawVids.map(String) : [];
  const index = vids.indexOf(id), rawAccessible = detail.accessible_episode_cnt;
  const accessible = typeof rawAccessible === 'number' || typeof rawAccessible === 'string' && /^\d+$/.test(rawAccessible)
    ? Number(rawAccessible) : NaN;
  if (!vids.length || rawVids.some(value => typeof value !== 'string' && !Number.isSafeInteger(value))
      || vids.some(value => !/^\d{1,30}$/.test(value)) || new Set(vids).size !== vids.length
      || index < 0 || !vids.includes(currentId) || !Number.isSafeInteger(accessible)
      || accessible < 0 || accessible > vids.length) throw failure('INVALID_RESPONSE');
  if (req?.pcLoginRequired === true || req?.pcAuthenticatedPlayback === true
      || detail?.pay_type != null && Number.isFinite(Number(detail.pay_type)) && Number(detail.pay_type) !== 0) {
    throw failure('ACCOUNT_REQUIRED');
  }
  if (req?.encryptedBrowserAllowed === true || index >= accessible) throw failure('WEB_EPISODE_UNAVAILABLE');
  // The official site can redirect an unavailable later episode to the first one.
  // Its valid series window explains the denial, but never authorizes the wrong media.
  if (currentId !== id) throw failure('INVALID_RESPONSE');
  if (req?.pcLoginRequired !== false || req.pcAuthenticatedPlayback !== false || req.encryptedBrowserAllowed !== false
      || detail?.pay_type == null || Number(detail.pay_type) !== 0) throw failure('PREVIEW_ONLY');
  const duration = seo == null ? 0 : Number(seo.durationSeconds);
  if (seo != null && (seo.available !== true || String(seo.itemId) !== id || String(seo.seriesId) !== sid
      || !Number.isFinite(duration) || duration <= 0)) throw failure('INVALID_RESPONSE');
  return { vid: id, seriesId: sid, episodeIndex: index + 1, duration };
}

function officialDuration(data, permission) {
  data = publicApiBody(data);
  const info = data.legacy_play_info || data.play_info;
  if (!info || typeof info !== 'object' || Array.isArray(info) || data.legacy_play_info && data.play_info
      || data.item_id != null && String(data.item_id) !== permission.vid
      || data.series_id != null && String(data.series_id) !== permission.seriesId
      || info.item_id != null && String(info.item_id) !== permission.vid
      || typeof info.duration !== 'number' || !Number.isFinite(info.duration) || info.duration <= 0
      || !Number.isSafeInteger(Number(info.width)) || Number(info.width) <= 0
      || !Number.isSafeInteger(Number(info.height)) || Number(info.height) <= 0) throw failure('INVALID_RESPONSE');
  // The encrypted player response is read only for duration. Its URLs and keys
  // never enter the public media session or the returned diagnostics.
  return info.duration;
}

function fallbackMedia(data, permission, now = Date.now()) {
  data = publicApiBody(data);
  if (data.play_info || data.legacy_play_info || data.player_access_key || data.kid) throw failure('INVALID_RESPONSE');
  let url;
  try { url = new URL(data.main_url); } catch { throw failure('INVALID_RESPONSE'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password
      || !/^v\d+-(?:reading|hgweb)\.qznovelvod\.com$/i.test(url.hostname)
      || !isPublicMediaUrl(url.href)) throw failure('SECURITY_BLOCKED');
  if (/preview/i.test(url.pathname)) throw failure('PREVIEW_ONLY');
  const expiry = Number(data.url_expire), serverTime = Number(data.server_time);
  if (!Number.isSafeInteger(expiry) || expiry <= 0 || !Number.isFinite(serverTime) || serverTime <= 0) {
    throw failure('INVALID_RESPONSE');
  }
  const expiresAt = Math.min(now + (expiry - serverTime) * 1000, mediaExpiresAt(url.href) || Infinity);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now + 5000) throw failure('MEDIA_URL_EXPIRED');
  return { url: url.href, expiresAt, expectedDuration: permission.duration };
}

function movieDuration(bytes, parseBoxes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8 || bytes.toString('latin1', 4, 8) !== 'ftyp'
      || typeof parseBoxes !== 'function') throw failure('INVALID_RESPONSE');
  try {
    const movie = parseBoxes(bytes, 0, bytes.length).find(box => box.typ === 'moov');
    const inspect = boxes => {
      for (const box of boxes || []) {
        if (box.typ === 'stsd') {
          let position = box.off + box.hdr + 8;
          const end = box.off + box.size;
          if (position > end) throw failure('INVALID_RESPONSE');
          const count = bytes.readUInt32BE(position - 4);
          if (count > 128) throw failure('INVALID_RESPONSE');
          for (let index = 0; index < count; index++) {
            if (position + 8 > end) throw failure('INVALID_RESPONSE');
            const size = bytes.readUInt32BE(position), kind = bytes.toString('latin1', position + 4, position + 8);
            if (size < 8 || position + size > end) throw failure('INVALID_RESPONSE');
            if (kind === 'encv' || kind === 'enca') throw failure('MEDIA_DECRYPT_FAILED');
            position += size;
          }
        }
        inspect(box.children);
      }
    };
    inspect(movie?.children);
    const header = movie?.children?.find(box => box.typ === 'mvhd');
    if (!header) throw failure('INVALID_RESPONSE');
    const offset = header.off + header.hdr, end = header.off + header.size, version = bytes[offset];
    let scale, ticks;
    if (version === 0 && offset + 20 <= end) {
      scale = bytes.readUInt32BE(offset + 12); ticks = bytes.readUInt32BE(offset + 16);
    } else if (version === 1 && offset + 32 <= end) {
      scale = bytes.readUInt32BE(offset + 20); ticks = Number(bytes.readBigUInt64BE(offset + 24));
    } else throw failure('INVALID_RESPONSE');
    const duration = ticks / scale;
    if (!Number.isSafeInteger(ticks) || !Number.isFinite(duration) || duration <= 0) throw failure('INVALID_RESPONSE');
    return duration;
  } catch (error) {
    if (error.code === 'MEDIA_DECRYPT_FAILED') throw error;
    throw failure('INVALID_RESPONSE');
  }
}

function publicMovieDuration(metadata, expectedDuration, parseBoxes) {
  if (![200, 206].includes(metadata?.status)) throw failure(`HTTP_${metadata?.status}`, metadata?.status);
  const bytes = Buffer.from(metadata.data || []);
  if (!bytes.length || bytes.length > OFFICIAL_WEB_PROFILE.metadataBytes) throw failure('INVALID_RESPONSE');
  const mediaType = String(metadata.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
  const prefix = bytes.subarray(0, 1024).toString('utf8').trimStart();
  if (/mpegurl|dash\+xml/.test(mediaType) || prefix.startsWith('#EXTM3U')
      || /^(?:<\?xml[^>]*>\s*)?<MPD(?:\s|\/?>)/i.test(prefix)) {
    throw Object.assign(failure('UNSUPPORTED_MEDIA_FORMAT'), { faultCode: 'MEDIA_FORMAT_UNSUPPORTED' });
  }
  if (metadata.status === 206) {
    const range = /^bytes 0-(\d+)\/(\d+)$/.exec(metadata.headers?.['content-range'] || '');
    if (!range || Number(range[1]) + 1 !== bytes.length || !Number.isSafeInteger(Number(range[2]))
        || Number(range[2]) <= Number(range[1])) throw failure('INVALID_RESPONSE');
  } else if (Number(metadata.headers?.['content-length']) !== bytes.length) throw failure('INVALID_RESPONSE');
  const duration = movieDuration(bytes, parseBoxes);
  if (!Number.isFinite(expectedDuration) || expectedDuration <= 0
      || Math.abs(duration - expectedDuration) > 0.5) throw failure('PREVIEW_ONLY');
  return duration;
}

async function resolveOfficialPublicPlayback(data, options = {}) {
  const { signal, request = axios, parseBoxes, now = Date.now } = options;
  const permission = publicEpisodePermission(data, options.vid, options.seriesId);
  const bounded = boundedSignal(signal, OFFICIAL_WEB_PROFILE.timeouts.totalMs);
  const started = now();
  let status = 0, code = '', modelValid = false, stage = 'source';
  const profile = { profileId: OFFICIAL_WEB_PROFILE.id, profileVersion: OFFICIAL_WEB_PROFILE.version,
    routeId: OFFICIAL_WEB_PROFILE.routeId };
  const call = async config => {
    throwIfAborted(bounded.signal);
    try {
      const response = await request({ ...config, signal: bounded.signal, maxRedirects: 0 });
      throwIfAborted(bounded.signal);
      if (![200, 206].includes(response.status)) throw failure(`HTTP_${response.status}`, response.status);
      return response;
    } catch (error) {
      throwIfAborted(bounded.signal);
      const status = Number(error.status || error.response?.status);
      if (status >= 300 && status <= 599) throw failure(`HTTP_${status}`, status);
      const code = ['ETIMEDOUT', 'ECONNABORTED', 'ERR_CANCELED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET',
        'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'ERR_WEB_MEDIA_ADDRESS', 'ERR_NETWORK'].includes(error.code)
        ? error.code : 'INVALID_RESPONSE';
      throw failure(code);
    }
  };
  try {
    const page = `${OFFICIAL_WEB_PROFILE.origin}/player/${permission.seriesId}/${permission.vid}`;
    const headers = { ...OFFICIAL_WEB_PROFILE.defaultHeaders, Origin: OFFICIAL_WEB_PROFILE.origin, Referer: page,
      ...(options.userAgent ? { 'User-Agent': options.userAgent } : {}) };
    if (!permission.duration) {
      const durationUrl = OFFICIAL_WEB_PROFILE.origin + OFFICIAL_WEB_PROFILE.playInfoPath;
      const reference = await call({ url: durationUrl, method: 'POST', ...webMediaRequestOptions(durationUrl),
        params: OFFICIAL_WEB_PROFILE.query, headers,
        data: { series_id: permission.seriesId, item_id: permission.vid, definition: OFFICIAL_WEB_PROFILE.playInfoDefinition },
        timeout: OFFICIAL_WEB_PROFILE.timeouts.playInfoMs, maxContentLength: 65536, maxBodyLength: 65536,
      });
      status = reference.status;
      if (reference.status !== 200) throw failure('INVALID_RESPONSE');
      permission.duration = officialDuration(reference.data, permission);
    }
    const apiUrl = OFFICIAL_WEB_PROFILE.origin + OFFICIAL_WEB_PROFILE.fallbackPath;
    const response = await call({ url: apiUrl, method: 'POST', ...webMediaRequestOptions(apiUrl),
      params: OFFICIAL_WEB_PROFILE.query,
      headers,
      data: { item_id: permission.vid, force_refresh: options.forceRefresh === true },
      timeout: OFFICIAL_WEB_PROFILE.timeouts.fallbackMs, maxContentLength: 65536, maxBodyLength: 65536,
    });
    status = response.status;
    if (response.status !== 200) throw failure('INVALID_RESPONSE');
    const media = fallbackMedia(response.data, permission, now());
    const limit = OFFICIAL_WEB_PROFILE.metadataBytes;
    stage = 'media';
    let metadata;
    try {
      metadata = await call({ url: media.url, method: 'GET', ...webMediaRequestOptions(media.url),
        headers: { Range: `bytes=0-${limit - 1}`, Referer: page,
          ...(options.userAgent ? { 'User-Agent': options.userAgent } : {}) },
        timeout: OFFICIAL_WEB_PROFILE.timeouts.metadataMs, responseType: 'arraybuffer',
        maxContentLength: limit, maxBodyLength: limit,
      });
    } catch (error) {
      const faultCode = classifyPlaybackError(error, { stage: 'media', now: now(), expiresAt: media.expiresAt });
      if (faultCode) error.faultCode = faultCode;
      throw error;
    }
    status = metadata.status;
    const duration = publicMovieDuration(metadata, permission.duration, parseBoxes);
    throwIfAborted(bounded.signal);
    modelValid = true;
    return { ...media, duration, source: 'web', format: 'mp4', vid: permission.vid,
      spadeA: null, contentKey: null, codec: '', userAgent: options.userAgent || '', referer: page,
      officialPublicPlayback: true, ...profile, requestElapsedMs: now() - started };
  } catch (error) {
    error.stage = stage;
    code = error.faultCode || error.code || 'INVALID_RESPONSE';
    status = Number(error.status) || status;
    if (status) { error.status = status; error.httpStatus = status; }
    throw error;
  } finally {
    bounded.dispose();
    try { options.onPlaybackEvent?.({ type: 'source-request', sourceRoute: 'web', ...profile,
      elapsedMs: now() - started, status, code, attempt: 1, modelValid }); } catch (_) {}
  }
}

module.exports = { OFFICIAL_WEB_PROFILE, publicEpisodePermission, officialDuration, fallbackMedia, movieDuration,
  publicMovieDuration, resolveOfficialPublicPlayback };
