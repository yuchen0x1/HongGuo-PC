/**
 * 搜索结果的标题归一化、相关性排序与跨来源同名去重。
 * 全角/半角、空格和标点不影响匹配（例如“言出法随，诸天万界”与“言出法随 诸天万界”）。
 * 同一部短剧常被多个平台收录：按归一化标题合并为一张卡片，保留排序在前的来源，
 * 其余来源记入 also_on，避免同名重复结果占满搜索页。
 */
export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

// 集数相差太大视为不同剧（同名翻拍、不同版本），不合并；任一集数未知时按可合并处理。
function episodeCountsCompatible(a, b) {
  const first = Number(a), second = Number(b);
  if (!Number.isSafeInteger(first) || first <= 0 || !Number.isSafeInteger(second) || second <= 0) return true;
  return Math.abs(first - second) <= Math.max(3, Math.ceil(Math.max(first, second) * 0.2));
}

/** 合并同名跨来源重复项；输入需已排序（同标题项共享相关性，稳定排序后相邻）。 */
export function mergeDuplicateDramas(results) {
  const merged = [], byTitle = new Map();
  for (const item of Array.isArray(results) ? results : []) {
    if (!item?.series_id || !item?.series_title) continue;
    const title = normalizeSearchText(item.series_title);
    const existing = title ? byTitle.get(title) : null;
    if (existing && episodeCountsCompatible(existing.episode_count, item.episode_count)) {
      existing.also_on.push({ source: item.source, series_id: item.series_id });
      continue;
    }
    const entry = { ...item, also_on: [] };
    if (title) byTitle.set(title, entry);
    merged.push(entry);
  }
  return merged;
}

export function rankSearchResults(results, keyword) {
  const query = normalizeSearchText(keyword), seen = new Set();
  const ranked = (Array.isArray(results) ? results : []).filter(item => {
    const key = `${item?.source}:${item?.series_id}`;
    if (!item?.series_id || !item?.series_title || seen.has(key)) return false;
    seen.add(key); return true;
  }).map(item => {
    const title = normalizeSearchText(item.series_title);
    const description = normalizeSearchText(item.series_intro || item.description || '');
    const titleMatch = !!query && title.includes(query);
    // App 上新补搜支持“用户多打了季数/后缀”的反向匹配；这类结果仍算标题命中，
    // 不能因为标题比搜索词短就被排到“其他结果”里。
    const reverseMatch = item.new_release === true && title.length >= 2 && !!query && query.includes(title);
    const contentMatch = !!query && description.includes(query);
    return { ...item, contentMatch,
      relevance: title === query ? 0 : titleMatch ? 1 : reverseMatch ? 1 : contentMatch ? 2 : 3 };
  }).sort((a, b) => a.relevance - b.relevance || (a.fuzzy === b.fuzzy ? 0 : a.fuzzy ? -1 : 1));
  return mergeDuplicateDramas(ranked);
}
