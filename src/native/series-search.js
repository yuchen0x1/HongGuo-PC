const { seasonTitle, sourceOf, findSequels } = require('./watch-history');

const normalizeTitle = title => String(title || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const score = (title, keyword) => !keyword ? 2 : title === keyword ? 0 : title.includes(keyword) ? 1 : 2;
function rankedUnique(results, keyword) {
  const seen = new Set(), normalized = normalizeTitle(keyword);
  return results.filter(item => {
    if (!item?.series_id || !item.series_title) return false;
    const id = String(item.series_id);
    if (seen.has(id)) return false;
    seen.add(id); return true;
  }).sort((a, b) => score(normalizeTitle(a.series_title), normalized) - score(normalizeTitle(b.series_title), normalized));
}

// 「第X季」中文数字标签；超过两位退回阿拉伯数字，保证展示稳定。
function seasonLabel(season) {
  if (!Number.isInteger(season) || season < 1 || season > 999) return '';
  const digits = '零一二三四五六七八九';
  const chinese = season < 10 ? digits[season]
    : season < 100 ? `${season < 20 ? '' : digits[Math.floor(season / 10)]}十${season % 10 ? digits[season % 10] : ''}`
    : String(season);
  return `第${chinese}季`;
}

function nextSeasonQueries(base, season) {
  if (!base || !Number.isInteger(season) || season < 2 || season > 99) return [];
  return [`${base}${seasonLabel(season)}`, `${base}第${season}季`];
}

// 归组用的来源族：采集源以 custom:<sourceId> 为一族，其余按 ID 形状识别。
function sourceFamilyOf(id) {
  const text = String(id || '');
  if (text.startsWith('custom:')) return `custom:${text.split(':')[1] || ''}`;
  return sourceOf(text) || '';
}

// One primary search plus at most two supplements; never recursively expand upstream results.
async function searchSeries(keyword, search, knownSeries = [], { afterSeason = 1, deadline = 0 } = {}) {
  const kw = String(keyword || '').trim();
  if (!kw || kw.length > 200) return { success: false, results: [], error: '请输入 1 至 200 字的搜索词' };
  const primary = await search(kw, { fuzzy: true, deadline });
  if (!primary?.success) return primary || { success: false, results: [], error: '搜索暂不可用' };
  const results = [...(primary.results || [])], parsed = seasonTitle(kw);
  let queries = [];
  if (parsed.base && !parsed.invalid && parsed.season <= 99) {
    if (parsed.explicit) {
      if (!results.some(item => normalizeTitle(item.series_title) === normalizeTitle(kw))) queries = [parsed.base];
    } else {
      const seasons = [...results, ...knownSeries].map(item => seasonTitle(item.series_title)).filter(item => item.base === parsed.base && !item.invalid);
      if (seasons.length) {
        const knownSeasons = new Set(seasons.map(item => item.season));
        let nextSeason = afterSeason + 1;
        while (nextSeason <= 99 && knownSeasons.has(nextSeason)) nextSeason++;
        queries = nextSeasonQueries(parsed.base, nextSeason);
      }
    }
  }
  const errors = [];
  for (const query of queries) {
    if (deadline && Date.now() >= deadline) { errors.push('搜索时间预算已用完'); break; }
    try {
      const response = await search(query, { fuzzy: false, deadline });
      if (!response?.success) throw new Error(response?.error || '来源未返回结果');
      results.push(...(response.results || []));
    } catch (error) { errors.push(error.message); }
  }
  const supplementError = errors.length ? `补充搜索未完成：${[...new Set(errors)].join('；')}` : '';
  const partialErrors = [primary.error, supplementError].filter(Boolean);
  return { ...primary, results: rankedUnique(results, kw), ...(partialErrors.length ? { partial: true, error: partialErrors.join('；') } : {}) };
}

async function findSeriesSequels(series, localCandidates, search, { localOnly = false, deadline = 0 } = {}) {
  const parsed = seasonTitle(series?.series_title), source = sourceOf(String(series?.series_id || ''));
  if (!source) return { success: false, results: [], error: '此来源暂不支持查找下一季，请按完整剧名搜索。' };
  if (!parsed.base || parsed.invalid || parsed.season > 99) return { success: false, results: [], error: '剧名或季数无法识别，请按完整剧名搜索。' };
  const local = findSequels(series, localCandidates);
  if (localOnly) return { success: true, results: local, candidates: local };
  try {
    const response = await searchSeries(parsed.base, search, [series, ...local], { afterSeason: parsed.season, deadline });
    if (!response?.success) throw new Error(response?.error || '来源搜索失败');
    // Keep the unfiltered candidates so lower seasons in the same family can reuse one search.
    const candidates = [...local, ...(response.results || [])];
    return { success: true, results: findSequels(series, candidates), candidates, ...(response.partial ? { partial: true, error: response.error } : {}) };
  } catch (error) {
    return { success: local.length > 0, results: local, candidates: local, partial: true, error: `联网查找未完成：${error.message}${local.length ? '；已保留本机候选。' : '；可稍后重试。'}` };
  }
}

// 与 5.0 季号归组同语义：同来源 + 基名完全相等；无季号按第一季；双向（含低季）收录，供选集页切换各季。
async function findSeriesSeasons(series, localCandidates, search, { deadline = 0 } = {}) {
  const parsed = seasonTitle(series?.series_title), source = sourceFamilyOf(series?.series_id);
  if (!source) return { success: false, seasons: [], error: '此来源暂不支持查找同系列各季，请按完整剧名搜索。' };
  if (!parsed.base || parsed.invalid || parsed.season > 99) return { success: false, seasons: [], error: '剧名或季数无法识别，请按完整剧名搜索。' };
  const currentId = String(series?.series_id || '');
  const collect = (candidates) => {
    const seen = new Set(), seasons = [];
    for (const candidate of candidates) {
      const id = String(candidate?.series_id || '');
      if (!id || seen.has(id) || sourceFamilyOf(id) !== source) continue;
      const next = seasonTitle(candidate.series_title);
      if (next.invalid || next.base !== parsed.base || next.season > 99) continue;
      seen.add(id);
      seasons.push({ series_id: id, series_title: String(candidate.series_title || ''), cover: candidate.cover || '',
        season: next.season, explicit: next.explicit, is_current: id === currentId, label: seasonLabel(next.season) });
    }
    return seasons;
  };
  const local = collect([series, ...(localCandidates || [])]);
  let seasons = local, partial = false, error = '';
  try {
    const response = await searchSeries(parsed.base, search, [series, ...(localCandidates || [])], { afterSeason: parsed.season, deadline });
    if (!response?.success) throw new Error(response?.error || '来源搜索失败');
    seasons = collect([series, ...(localCandidates || []), ...(response.results || [])]);
    partial = response.partial === true;
    error = response.error || '';
  } catch (failure) {
    partial = true;
    error = `联网查找未完成：${failure.message}${local.length ? '；已保留本机候选。' : ''}`;
  }
  // 同一季先显式季号、后无季号；数量上限避免同名系列异常膨胀。
  seasons.sort((a, b) => a.season - b.season || (a.explicit === b.explicit ? 0 : a.explicit ? -1 : 1));
  return { success: true, seasons: seasons.slice(0, 12), ...(partial ? { partial: true, error } : {}) };
}

module.exports = { searchSeries, findSeriesSequels, findSeriesSeasons, seasonLabel, nextSeasonQueries, sourceFamilyOf };
