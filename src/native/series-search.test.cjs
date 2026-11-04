const test = require('node:test');
const assert = require('node:assert/strict');
const { findSeriesSeasons, seasonLabel, nextSeasonQueries, sourceFamilyOf } = require('./series-search');

const FAMILY = '谁让这个悍匪修仙的！';

test('findSeriesSeasons 收录同来源同基名的各季并排序标注', async () => {
  const current = { series_id: '700001', series_title: `${FAMILY}第五季`, cover: 'c5' };
  const local = [{ series_id: '700002', series_title: `${FAMILY}第四季`, cover: 'c4' }];
  const online = [
    { series_id: '800001', series_title: FAMILY, cover: 'c1' },
    { series_id: '800002', series_title: `${FAMILY}第二季`, cover: 'c2' },
    { series_id: '800003', series_title: `${FAMILY}第三季`, cover: 'c3' },
    { series_id: '900001', series_title: '完全无关的另一部 第二季' },
    { series_id: 'hema:9', series_title: `${FAMILY}第三季` },
  ];
  const searches = [];
  const result = await findSeriesSeasons(current, local, async (kw) => {
    searches.push(kw);
    // seasonTitle 的 NFKC 会把全角标点归一成半角，回调拿到的是归一化后的基名。
    return { success: true, results: kw.startsWith('谁让这个悍匪修仙的') ? online : [] };
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.seasons.map(item => [item.series_id, item.label, item.is_current]), [
    ['800001', '第一季', false], ['800002', '第二季', false], ['800003', '第三季', false],
    ['700002', '第四季', false], ['700001', '第五季', true],
  ]);
  // 主查询按基名进行；补搜只找下一季，不会递归展开。
  assert.equal(searches[0], FAMILY.normalize('NFKC'));
});

test('联网失败时保留本机候选并标记 partial', async () => {
  const current = { series_id: '700001', series_title: `${FAMILY}第五季` };
  const local = [{ series_id: '700002', series_title: `${FAMILY}第四季` }];
  const result = await findSeriesSeasons(current, local, async () => ({ success: false, error: '网络不可用' }));
  assert.equal(result.success, true);
  assert.equal(result.partial, true);
  assert.match(result.error, /联网查找未完成/);
  assert.deepEqual(result.seasons.map(item => [item.series_id, item.label]), [['700002', '第四季'], ['700001', '第五季']]);
});

test('来源无法识别时直接报错且不发起搜索', async () => {
  let searched = false;
  const result = await findSeriesSeasons({ series_id: 'not-an-id', series_title: `${FAMILY}第二季` }, [], async () => {
    searched = true; return { success: true, results: [] };
  });
  assert.equal(result.success, false);
  assert.equal(result.seasons.length, 0);
  assert.equal(searched, false);
});

test('采集源按 custom:<sourceId> 前缀归组，跨采集源不混入', async () => {
  const current = { series_id: 'custom:abc:1', series_title: `${FAMILY}第二季` };
  const local = [
    { series_id: 'custom:abc:9', series_title: `${FAMILY}第一季` },
    { series_id: 'custom:xyz:2', series_title: `${FAMILY}第三季` },
  ];
  const result = await findSeriesSeasons(current, local, async () => ({ success: true, results: [] }));
  assert.equal(result.success, true);
  assert.deepEqual(result.seasons.map(item => item.series_id), ['custom:abc:9', 'custom:abc:1']);
});

test('季号标签、下一季查询词与来源族识别保持既有行为', () => {
  assert.equal(seasonLabel(1), '第一季');
  assert.equal(seasonLabel(5), '第五季');
  assert.equal(seasonLabel(12), '第十二季');
  assert.equal(seasonLabel(20), '第二十季');
  assert.equal(seasonLabel(21), '第二十一季');
  assert.equal(seasonLabel(100), '第100季');
  assert.equal(seasonLabel(0), '');
  assert.deepEqual(nextSeasonQueries('剧名', 2), ['剧名第二季', '剧名第2季']);
  assert.deepEqual(nextSeasonQueries('剧名', 1), []);
  assert.deepEqual(nextSeasonQueries('剧名', 100), []);
  assert.equal(sourceFamilyOf('custom:abc:1'), 'custom:abc');
  assert.equal(sourceFamilyOf('hema:5'), 'hema');
  assert.equal(sourceFamilyOf('123456'), 'hongguo');
  assert.equal(sourceFamilyOf('weird'), '');
});
