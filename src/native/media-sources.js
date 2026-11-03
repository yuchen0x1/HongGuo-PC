const BUILTIN_SOURCES = [
  { id: 'hongguo', label: '红果' }, { id: 'xifan', label: '西饭' }, { id: 'hema', label: '河马' },
];

// 内置短剧资源站：走苹果 CMS V10 协议（custom-source 模块），编号使用固定 UUID，
// 与用户自建自定义源（settings.custom_sources）互不混淆。
// 编号与标签在 src/components/mediaSourcesModel.mjs 有一份镜像，改这里要同步改那边。
const COLLECT_SOURCES = [
  { uuid: 'a1e93f2c-6b47-4d58-9c30-2f4a6d8e0b11', label: '金鹰短剧', url: 'https://jinyingzy.com/api.php/provide/vod', note: '短剧分类多', defaultOn: true },
  { uuid: 'b2f04a3d-7c58-4e69-8d41-3a5b7e9f1c22', label: '海盗短剧', url: 'https://hhzyapi.com/api.php/provide/vod', note: '短剧更新快', defaultOn: true },
  { uuid: 'c305b4e2-8d69-4f7a-9e52-4b6c8f0a2d33', label: '硕博短剧', url: 'https://subocaiji.com/api.php/provide/vod', note: '短剧综合', defaultOn: true },
  { uuid: 'd416c5f3-9e7a-4a8b-8f63-5c7d90a1b3e4', label: '暴风资源', url: 'https://bfzyapi.com/api.php/provide/vod', note: '综合站，含长剧', defaultOn: false },
  { uuid: 'e527d60a-af8b-4b9c-9074-6d8ea1b2c4f5', label: '360资源', url: 'https://360zy.com/api.php/provide/vod', note: '综合站，含长剧', defaultOn: false },
  { uuid: 'f638e71b-b09c-4cad-a185-7e9fb2c3d506', label: '旺旺短剧', url: 'https://www.wwzy.tv/api.php/provide/vod', note: '部分网络连不上', defaultOn: false },
].map(item => ({ ...item, id: `custom:${item.uuid}` }));

const COLLECT_SOURCE_IDS = COLLECT_SOURCES.map(source => source.id);

function collectSourceById(id) {
  return COLLECT_SOURCES.find(source => source.id === id) || null;
}

function getMediaSources(settings) {
  return [
    ...BUILTIN_SOURCES.filter(source => source.id === 'hongguo' || settings.builtin_sources?.[source.id] !== false),
    ...COLLECT_SOURCES.filter(source => (settings.builtin_sources?.[source.id] ?? source.defaultOn) === true)
      .map(source => ({ id: source.id, label: source.label })),
    ...(settings.custom_sources || []).filter(source => source.enabled).map(source => ({ id: `custom:${source.id}`, label: source.name, custom: true })),
  ];
}

function setBuiltinSourceEnabled(settings, id, enabled) {
  if (id === 'hongguo') throw new Error('红果来源固定开启，不能关闭');
  if (!['xifan', 'hema', ...COLLECT_SOURCE_IDS].includes(id) || typeof enabled !== 'boolean') throw new Error('来源开关无效');
  return { ...settings, builtin_sources: { ...settings.builtin_sources, [id]: enabled } };
}

module.exports = { getMediaSources, setBuiltinSourceEnabled, COLLECT_SOURCES, COLLECT_SOURCE_IDS, collectSourceById };
