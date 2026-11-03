export const BUILTIN_MEDIA_SOURCES = [
  { id: 'hongguo', label: '红果短剧' }, { id: 'xifan', label: '西饭短剧' }, { id: 'hema', label: '河马短剧' },
  // 内置短剧资源站（苹果 CMS 采集源），编号与 src/native/media-sources.js 的 COLLECT_SOURCES 保持一致。
  { id: 'custom:a1e93f2c-6b47-4d58-9c30-2f4a6d8e0b11', label: '金鹰短剧', note: '短剧分类多' },
  { id: 'custom:b2f04a3d-7c58-4e69-8d41-3a5b7e9f1c22', label: '海盗短剧', note: '短剧更新快' },
  { id: 'custom:c305b4e2-8d69-4f7a-9e52-4b6c8f0a2d33', label: '硕博短剧', note: '短剧综合' },
  { id: 'custom:d416c5f3-9e7a-4a8b-8f63-5c7d90a1b3e4', label: '暴风资源', note: '综合站，含长剧' },
  { id: 'custom:e527d60a-af8b-4b9c-9074-6d8ea1b2c4f5', label: '360资源', note: '综合站，含长剧' },
  { id: 'custom:f638e71b-b09c-4cad-a185-7e9fb2c3d506', label: '旺旺短剧', note: '部分网络连不上' },
];
export const CUSTOM_SOURCE_ID = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeMediaSources(sources) {
  const seen = new Set();
  return (Array.isArray(sources) ? sources : []).filter(source => {
    if (!source || source.enabled === false || typeof source.label !== 'string' || !source.label.trim() || seen.has(source.id)
      || (!CUSTOM_SOURCE_ID.test(source.id) && !BUILTIN_MEDIA_SOURCES.some(item => item.id === source.id))) return false;
    seen.add(source.id); return true;
  }).map(source => ({ id: source.id, label: source.label.trim(), ...(CUSTOM_SOURCE_ID.test(source.id) ? { custom: true } : {}) }));
}

export function mediaSourceLabel(seriesOrSource, sources = BUILTIN_MEDIA_SOURCES) {
  const id = String(seriesOrSource || '');
  const source = id.startsWith('custom:') ? id.split(':').slice(0, 2).join(':')
    : id.startsWith('xifan:') ? 'xifan' : id.startsWith('hema:') ? 'hema' : /^\d+$/.test(id) ? 'hongguo' : id;
  return sources.find(item => item.id === source)?.label || BUILTIN_MEDIA_SOURCES.find(item => item.id === source)?.label
    || (source.startsWith('custom:') ? '自定义源（未启用或已移除）' : '未知来源');
}

export function createMediaSourcesStore(load) {
  let snapshot = { sources: BUILTIN_MEDIA_SOURCES, revision: 0, loading: true, error: '' };
  let pending = null, loaded = false;
  const listeners = new Set();
  const emit = patch => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    refresh(force = false) {
      if (!force && pending) return pending;
      if (!force && loaded) return Promise.resolve(snapshot);
      const revision = snapshot.revision + 1;
      emit({ revision, loading: true, error: '' });
      pending = (async () => {
        try {
          const result = await load();
          if (snapshot.revision !== revision) return;
          if (!result?.success || !Array.isArray(result.sources)) throw new Error(result?.error || '来源列表加载失败，请重试');
          loaded = true;
          emit({ sources: normalizeMediaSources(result.sources), loading: false });
        } catch (error) {
          if (snapshot.revision === revision) emit({ loading: false, error: error.message || '来源列表加载失败，请重试' });
        } finally { if (snapshot.revision === revision) pending = null; }
      })();
      return pending;
    },
  };
}
