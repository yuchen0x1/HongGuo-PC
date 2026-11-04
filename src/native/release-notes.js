// 「更新日志」数据源：GitHub 匿名 API 配额有限（每 IP 每小时 60 次），
// 用 TTL 短路、ETag 条件请求（304 不消耗配额）、瞬时错误重试和磁盘缓存回退，
// 保证页面在网络波动或限速时仍能展示最近一次成功同步的内容。
const fs = require('fs');
const { availableRelease } = require('./app-update');

const RELEASE_NOTES_URL = 'https://api.github.com/repos/yuchen0x1/HongGuo-PC/releases?per_page=20';
const RELEASE_NOTES_TTL_MS = 10 * 60 * 1000;
const RELEASE_NOTES_RETRY_DELAY_MS = 1200;
const RELEASE_NOTES_ERROR = '暂时无法读取更新日志，请检查网络后重试。';

function normalizeNotes(releases) {
  const list = Array.isArray(releases) ? releases : [];
  return list
    .filter(release => release && !release.draft && !release.prerelease && typeof release.body === 'string' && release.body.trim())
    .map(release => ({
      version: availableRelease(release, '0.0')?.version || String(release.tag_name || '').replace(/^v/, ''),
      name: typeof release.name === 'string' ? release.name : '',
      date: typeof release.published_at === 'string' ? release.published_at.slice(0, 10) : '',
      body: release.body.slice(0, 20000),
    }))
    .filter(release => /^\d+\.\d+(?:\.\d+)?$/.test(release.version));
}

function readCacheFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && Array.isArray(parsed.notes) && typeof parsed.fetchedAt === 'number' && Number.isFinite(parsed.fetchedAt) && parsed.fetchedAt >= 0
      && parsed.notes.every(release => release && typeof release.version === 'string' && typeof release.body === 'string')) {
      return { notes: parsed.notes, etag: typeof parsed.etag === 'string' ? parsed.etag : '', fetchedAt: parsed.fetchedAt };
    }
  } catch { /* 缓存缺失或损坏时按无缓存处理 */ }
  return null;
}

function writeCacheFile(file, entry) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(entry), 'utf8');
  fs.renameSync(temporary, file);
}

function createReleaseNotesService({ request, cacheFile, now = () => Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let memory = null;
  let inflight = null;

  function loadCache() {
    if (!memory) memory = readCacheFile(cacheFile());
    return memory;
  }

  function storeCache(entry) {
    memory = entry;
    try { writeCacheFile(cacheFile(), entry); } catch { /* 缓存写失败不影响本次返回 */ }
  }

  async function fetchOnce(cached) {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Hongguo-Drama-Release-Notes' };
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    const response = await request({
      url: RELEASE_NOTES_URL,
      headers,
      timeout: 12000,
      maxRedirects: 0,
      maxContentLength: 1024 * 1024,
      validateStatus: status => status === 200 || status === 304,
    });
    if (response.status === 304) {
      if (!cached) throw new Error('Unexpected release notes 304');
      const entry = { notes: cached.notes, etag: cached.etag, fetchedAt: now() };
      storeCache(entry);
      return { success: true, notes: entry.notes, cached: false };
    }
    const notes = normalizeNotes(response.data);
    if (!notes.length) throw new Error('Release notes payload empty');
    storeCache({ notes, etag: String(response.headers?.etag || ''), fetchedAt: now() });
    return { success: true, notes, cached: false };
  }

  async function refresh() {
    const cached = loadCache();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetchOnce(cached);
      } catch (error) {
        const status = error?.response?.status;
        // 匿名配额（403/429）立即重试无意义；其余瞬时错误短暂等待后重试一次。
        if (status === 403 || status === 429) break;
        if (attempt === 0) await wait(RELEASE_NOTES_RETRY_DELAY_MS);
      }
    }
    if (cached) return { success: true, notes: cached.notes, cached: true, fetchedAt: cached.fetchedAt };
    return { success: false, error: RELEASE_NOTES_ERROR };
  }

  return function getReleaseNotes() {
    const cached = loadCache();
    if (cached && now() - cached.fetchedAt < RELEASE_NOTES_TTL_MS) {
      return Promise.resolve({ success: true, notes: cached.notes, cached: false });
    }
    if (!inflight) inflight = refresh().finally(() => { inflight = null; });
    return inflight;
  };
}

module.exports = { createReleaseNotesService, normalizeNotes, RELEASE_NOTES_ERROR };
