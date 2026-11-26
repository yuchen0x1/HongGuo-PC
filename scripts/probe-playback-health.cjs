// 播放健康分层探针（定时监控用，只读）。
// 依次验证三层：目录层（能否取到完整分集）→ 取源层（能否取到播放地址）→ 媒体层（地址能否读到字节）。
// 输出只含脱敏证据：不含媒体地址、设备标识、签名串或账号信息。
//
// 分级：只有整层失败（目录层或取源层整体不可用、采样失败率超阈值）才算 hardFailure；
// 个别分集失败记为 sampleFailure，避免随机剧的下架/受限分集造成告警刷屏。
const crypto = require('node:crypto');

const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,40}$/;
const SCOPES = {
  light: { series: 2, samplesPerSeries: 3, mediaProbe: true },
  full: { series: 3, samplesPerSeries: 5, mediaProbe: true },
};
// 采样失败率达到该比例才升级为整层故障。
const SAMPLE_FAILURE_CEILING = 0.5;

const safeCode = value => {
  const text = String(value || '').trim();
  return SAFE_CODE.test(text) ? text : 'UNKNOWN';
};
// 报告里的错误码：只有真实存在的合法码才写入，否则用调用方给的兜底码。
const codeOr = (value, fallback) => {
  const text = String(value || '').trim();
  return SAFE_CODE.test(text) ? text : fallback;
};
const safeStatus = value => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 100 && number <= 599 ? number : 0;
};
// 分集序号取首、中、末（full 另加 25%/75%），去重后按升序。
function sampleIndexes(total, count) {
  if (!Number.isInteger(total) || total < 1) return [];
  const wanted = count >= 5
    ? [1, Math.round(total * 0.25), Math.round(total / 2), Math.round(total * 0.75), total]
    : [1, Math.round(total / 2), total];
  return [...new Set(wanted.filter(index => index >= 1 && index <= total))].sort((a, b) => a - b);
}
function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// 媒体层只读地址前 1KB，确认 CDN 真实可用，不下载整集。
async function probeMediaAddress(url) {
  const axios = require('axios');
  let target;
  try { target = new URL(String(url || '')); }
  catch { return { ok: false, code: 'INVALID_MEDIA_URL' }; }
  if (target.protocol !== 'https:') return { ok: false, code: 'INSECURE_MEDIA_URL' };
  try {
    const response = await axios({ url: target.toString(), method: 'GET', responseType: 'arraybuffer',
      headers: { Range: 'bytes=0-1023' }, timeout: 15000, maxRedirects: 2,
      maxContentLength: 64 * 1024, validateStatus: () => true });
    const bytes = response.data?.byteLength || 0;
    const status = safeStatus(response.status);
    return { ok: [200, 206].includes(status) && bytes > 0, status, bytes,
      ...(bytes > 0 ? {} : { code: 'EMPTY_MEDIA_BODY' }) };
  } catch (error) {
    return { ok: false, code: codeOr(error.code, 'MEDIA_UNREACHABLE') };
  }
}

// 同一次检查最多尝试两次，用于压掉瞬时网络抖动造成的误报。
async function attempt(operation) {
  const codes = [];
  for (let round = 1; round <= 2; round++) {
    try {
      const value = await operation();
      return { ok: true, value, attempts: round, ...(round > 1 ? { recovered: true } : {}), codes };
    } catch (error) {
      codes.push(codeOr(error?.code, ''));
    }
  }
  return { ok: false, codes, attempts: 2 };
}

function routeMatrix(routeTrace) {
  const rows = Array.isArray(routeTrace) ? routeTrace : [];
  return rows.map(route => ({
    source: ['app', 'web', 'api'].includes(route?.source) ? route.source : 'unknown',
    status: typeof route?.status === 'string' ? route.status.slice(0, 24) : 'unknown',
    attempted: route?.attempted === true,
    ...(codeOr(route?.code, '') ? { code: codeOr(route.code, '') } : {}),
    ...(safeStatus(route?.httpStatus) ? { httpStatus: safeStatus(route.httpStatus) } : {}),
  }));
}

function describeSeries(detail) {
  const episodes = Array.isArray(detail?.episodes) ? detail.episodes : [];
  const indexes = episodes.map(item => Number(item.vid_index));
  const unique = new Set(indexes);
  const sorted = indexes.slice().sort((a, b) => a - b);
  const contiguous = sorted.length > 0 && unique.size === sorted.length
    && sorted[0] === 1 && sorted[sorted.length - 1] === sorted.length;
  return { episodes: episodes.length, contiguous,
    firstIndex: sorted[0] ?? null, lastIndex: sorted[sorted.length - 1] ?? null };
}

async function probePlaybackHealth({ scope = 'light', seriesIds, deps = {}, now = Date.now } = {}) {
  const plan = SCOPES[scope] || SCOPES.light;
  const api = {
    browseList: deps.browseList || ((options) => require('../src/native/catalog').browseList(options)),
    fetchEpisodeList: deps.fetchEpisodeList || ((id, options) => require('../src/native/hongguo').fetchEpisodeList(id, options)),
    fetchPlayUrlSingle: deps.fetchPlayUrlSingle || ((vid, sid, options) => require('../src/native/hongguo').fetchPlayUrlSingle(vid, sid, options)),
    probeMedia: deps.probeMedia || probeMediaAddress,
  };
  const report = { schema: 1, version: require('../package.json').version, platform: process.platform,
    architecture: process.arch, at: new Date(now()).toISOString(), scope,
    layers: [], series: [], samples: [], hardFailure: false, failures: [] };

  // 目录层（榜单）：拿不到候选剧说明官网目录入口本身不可用。
  let candidates = Array.isArray(seriesIds) ? seriesIds.map(String) : null;
  if (!candidates) {
    const listing = await attempt(async () => {
      const result = await api.browseList({ forceRefresh: true });
      if (!result?.success || !Array.isArray(result.results) || !result.results.length) {
        throw Object.assign(new Error('catalog unavailable'), { code: 'CATALOG_UNAVAILABLE' });
      }
      return result.results;
    });
    if (!listing.ok) {
      report.layers.push({ layer: 'catalog', status: 'failed', code: listing.codes.at(-1) || 'CATALOG_UNAVAILABLE' });
      report.failures.push({ layer: 'catalog', code: listing.codes.at(-1) || 'CATALOG_UNAVAILABLE' });
      report.hardFailure = true;
      report.layers.push({ layer: 'episodes', status: 'skipped' }, { layer: 'source', status: 'skipped' },
        { layer: 'media', status: 'skipped' });
      return finalize(report, now);
    }
    report.layers.push({ layer: 'catalog', status: 'ok', recovered: listing.recovered === true });
    const ids = [...new Set(listing.value.map(item => String(item.series_id || '')).filter(id => /^\d{6,30}$/.test(id)))];
    candidates = shuffle(ids).slice(0, plan.series);
  }
  if (!candidates.length) {
    report.layers.push({ layer: 'catalog', status: 'failed', code: 'NO_SERIES_CANDIDATE' });
    report.failures.push({ layer: 'catalog', code: 'NO_SERIES_CANDIDATE' });
    report.hardFailure = true;
    report.layers.push({ layer: 'episodes', status: 'skipped' }, { layer: 'source', status: 'skipped' },
      { layer: 'media', status: 'skipped' });
    return finalize(report, now);
  }

  // 目录层（分集）：每部剧都要能拿到连续且唯一的分集编号。
  const episodeFailures = [];
  const catalogs = [];
  for (const seriesId of candidates) {
    const detail = await attempt(() => api.fetchEpisodeList(seriesId, { force: true, deadline: Date.now() + 60000 }));
    if (!detail.ok) {
      episodeFailures.push(detail.codes.at(-1) || 'UNKNOWN');
      report.series.push({ seriesId, layer: 'episodes', status: 'failed', code: episodeFailures.at(-1) });
      continue;
    }
    const shape = describeSeries(detail.value);
    const status = shape.episodes > 0 && shape.contiguous ? 'ok' : 'failed';
    if (status === 'failed') episodeFailures.push(shape.episodes > 0 ? 'NON_CONTIGUOUS_EPISODES' : 'EMPTY_EPISODE_LIST');
    report.series.push({ seriesId, title: String(detail.value?.series_title || '').slice(0, 60),
      ...shape, layer: 'episodes', status, ...(status === 'failed' ? { code: episodeFailures.at(-1) } : {}),
      ...(detail.recovered ? { recovered: true } : {}) });
    if (status === 'ok') catalogs.push({ seriesId, detail: detail.value });
  }
  // 一部剧目录失败不足以判定整层故障（可能该剧已下架），全部失败才升级。
  const episodesOk = catalogs.length > 0;
  report.layers.push({ layer: 'episodes', status: episodesOk ? (episodeFailures.length ? 'degraded' : 'ok') : 'failed',
    ...(episodesOk ? {} : { code: episodeFailures.at(-1) || 'EPISODE_LIST_UNAVAILABLE' }),
    failedSeries: episodeFailures.length, checkedSeries: candidates.length });
  if (!episodesOk) {
    report.failures.push({ layer: 'episodes', code: episodeFailures.at(-1) || 'EPISODE_LIST_UNAVAILABLE' });
    report.hardFailure = true;
    report.layers.push({ layer: 'source', status: 'skipped' }, { layer: 'media', status: 'skipped' });
    return finalize(report, now);
  }

  // 取源层与媒体层：对采样分集逐个取地址，再读媒体头部字节。
  const routes = new Map();
  let sampleOk = 0, sampleTotal = 0, mediaOk = 0, mediaTotal = 0;
  for (const { seriesId, detail } of catalogs) {
    const byIndex = new Map(detail.episodes.map(item => [Number(item.vid_index), item]));
    for (const index of sampleIndexes(detail.episodes.length, plan.samplesPerSeries)) {
      const episode = byIndex.get(index);
      if (!episode) continue;
      sampleTotal++;
      const started = now();
      const result = await api.fetchPlayUrlSingle(String(episode.vid), seriesId, { force: true });
      const row = { seriesId, vidIndex: index, ok: !!result?.url,
        elapsedMs: Math.max(0, now() - started),
        ...(result?.url ? { route: ['app', 'api', 'web'].includes(result.source) ? result.source : 'unknown' } : {}),
        ...(result?.url ? {} : { code: codeOr(result?.code, 'NO_PLAYABLE_SOURCE') }),
        routes: routeMatrix(result?.routeTrace) };
      for (const route of row.routes) {
        const key = `${route.source}:${route.status}`;
        routes.set(key, (routes.get(key) || 0) + 1);
      }
      if (row.ok) sampleOk++;
      if (row.ok && plan.mediaProbe) {
        mediaTotal++;
        const media = await api.probeMedia(result.url);
        row.media = { ok: media.ok === true, ...(safeStatus(media.status) ? { status: safeStatus(media.status) } : {}),
          ...(Number(media.bytes) > 0 ? { bytes: Number(media.bytes) } : {}),
          ...(media.ok === true ? {} : { code: codeOr(media.code, 'MEDIA_UNREACHABLE') }) };
        if (row.media.ok) mediaOk++;
      }
      report.samples.push(row);
    }
  }

  const sampleRate = sampleTotal ? sampleOk / sampleTotal : 0;
  const sourceFailed = sampleTotal === 0 || sampleRate < SAMPLE_FAILURE_CEILING;
  report.layers.push({ layer: 'source', status: sourceFailed ? 'failed' : (sampleOk < sampleTotal ? 'degraded' : 'ok'),
    ...(sourceFailed ? { code: sampleTotal === 0 ? 'NO_SAMPLE_EPISODE' : 'SAMPLES_FAILED' } : {}),
    resolved: sampleOk, sampled: sampleTotal });
  if (sourceFailed) {
    report.failures.push({ layer: 'source', code: sampleTotal === 0 ? 'NO_SAMPLE_EPISODE' : 'SAMPLES_FAILED' });
    report.hardFailure = true;
  }

  const mediaRate = mediaTotal ? mediaOk / mediaTotal : 1;
  const mediaFailed = mediaTotal > 0 && mediaRate < SAMPLE_FAILURE_CEILING;
  report.layers.push({ layer: 'media', status: mediaTotal === 0 ? 'skipped' : (mediaFailed ? 'failed'
    : (mediaOk < mediaTotal ? 'degraded' : 'ok')),
    ...(mediaFailed ? { code: 'MEDIA_UNREACHABLE' } : {}), readable: mediaOk, probed: mediaTotal });
  if (mediaFailed) {
    report.failures.push({ layer: 'media', code: 'MEDIA_UNREACHABLE' });
    report.hardFailure = true;
  }

  report.routes = [...routes.entries()].map(([key, count]) => {
    const [source, status] = key.split(':');
    return { source, status, samples: count };
  });
  return finalize(report, now);
}

// 故障指纹只看层与错误码，不含剧号，使同类故障去重到同一个 issue。
function finalize(report, now) {
  const parts = report.failures.map(item => `${item.layer}:${item.code || 'UNKNOWN'}`).sort();
  report.fingerprint = parts.length
    ? crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12) : '';
  report.healthy = parts.length === 0;
  report.elapsedMs = Math.max(0, now() - Date.parse(report.at));
  return report;
}

function summaryLines(report) {
  const lines = [`播放健康探针 ${report.healthy ? 'OK' : 'FAILED'}（scope=${report.scope}，${report.elapsedMs}ms）`];
  for (const layer of report.layers) {
    lines.push(`  ${layer.layer}=${layer.status}${layer.code ? ` (${layer.code})` : ''}`);
  }
  for (const failure of report.failures) lines.push(`  故障：${failure.layer}:${failure.code}`);
  if (report.fingerprint) lines.push(`  指纹：${report.fingerprint}`);
  return lines;
}

async function main(argv) {
  const args = argv.slice(2);
  const option = name => {
    const index = args.indexOf(name);
    return index < 0 ? null : args[index + 1];
  };
  const scope = option('--scope') || 'light';
  const output = option('--output');
  const seriesId = option('--series');
  const report = await probePlaybackHealth({
    scope,
    ...(seriesId ? { seriesIds: [seriesId] } : {}),
  });
  const text = JSON.stringify(report, null, 2);
  if (output) require('node:fs').writeFileSync(output, `${text}\n`);
  console.log(text);
  for (const line of summaryLines(report)) console.error(line);
  process.exitCode = report.healthy ? 0 : 1;
  return report;
}

module.exports = { probePlaybackHealth, probeMediaAddress, sampleIndexes, summaryLines, SAMPLE_FAILURE_CEILING };

if (require.main === module) {
  main(process.argv).catch(error => {
    console.error(JSON.stringify({ status: 'fatal', code: safeCode(error?.code) }));
    process.exitCode = 1;
  });
}
