// 播放健康探针的离线单测：注入替代传输，不访问网络。
// 重点是分层判定、误报阈值、故障指纹去重，以及报告不含分集编号与媒体地址。
const assert = require('node:assert/strict');
const { probePlaybackHealth, sampleIndexes, SAMPLE_FAILURE_CEILING } = require('./probe-playback-health.cjs');

const checks = [];
const test = (name, run) => checks.push([name, run]);

// 构造一部剧的分集：vid 用可识别的哨兵值，用来断言报告不会泄漏。
const series = (id, total) => ({
  series_id: id,
  series_title: `测试剧 ${id}`,
  episodes: Array.from({ length: total }, (_, index) => ({
    vid: `SENTINELVID-${id}-${index + 1}`,
    vid_index: index + 1,
    series_id: id,
  })),
});
const catalog = { success: true, results: [{ series_id: '1000000000000000001' }, { series_id: '1000000000000000002' }] };
const okPlay = { url: 'https://media.example.test/secret-path/episode.mp4', source: 'app',
  routeTrace: [{ source: 'app', status: 'address-found', attempted: true, mediaAddress: true }] };
const okMedia = { ok: true, status: 206, bytes: 1024 };

const deps = (overrides = {}) => ({
  browseList: async () => catalog,
  fetchEpisodeList: async (id) => series(id, 88),
  fetchPlayUrlSingle: async () => okPlay,
  probeMedia: async () => okMedia,
  ...overrides,
});

const SINGLE = { seriesIds: ['1000000000000000001'] };

test('healthy probe reports every layer ok and no fingerprint', async () => {
  const report = await probePlaybackHealth({ scope: 'light', deps: deps() });
  assert.equal(report.healthy, true, 'healthy probe must not report a failure');
  assert.equal(report.hardFailure, false);
  assert.equal(report.fingerprint, '');
  assert.deepEqual(report.layers.map(layer => [layer.layer, layer.status]),
    [['catalog', 'ok'], ['episodes', 'ok'], ['source', 'ok'], ['media', 'ok']]);
  assert.equal(report.samples.length, 6, 'two series with three samples each');
});

test('a failed catalog listing stops the run at the catalog layer', async () => {
  const report = await probePlaybackHealth({ scope: 'light',
    deps: deps({ browseList: async () => ({ success: false, error: 'x' }) }) });
  assert.equal(report.hardFailure, true);
  assert.equal(report.layers[0].layer, 'catalog');
  assert.equal(report.layers[0].status, 'failed');
  assert.equal(report.layers[0].code, 'CATALOG_UNAVAILABLE');
  for (const name of ['episodes', 'source', 'media']) {
    assert.equal(report.layers.find(layer => layer.layer === name).status, 'skipped', `${name} must be skipped`);
  }
});

test('a transient catalog failure that recovers on retry is not a failure', async () => {
  let calls = 0;
  const report = await probePlaybackHealth({ scope: 'light', deps: deps({
    browseList: async () => { calls++; if (calls === 1) throw new Error('blip'); return catalog; },
  }) });
  assert.equal(calls, 2, 'the probe must retry once');
  assert.equal(report.healthy, true);
  assert.equal(report.layers[0].recovered, true);
});

test('every series failing its episode list is a hard failure', async () => {
  const report = await probePlaybackHealth({ scope: 'light', deps: deps({
    fetchEpisodeList: async () => { throw Object.assign(new Error('bad'), { code: 'INVALID_RESPONSE' }); } }) });
  assert.equal(report.hardFailure, true);
  const layer = report.layers.find(item => item.layer === 'episodes');
  assert.equal(layer.status, 'failed');
  assert.equal(layer.code, 'INVALID_RESPONSE');
});

test('one retired series does not fail the whole episode layer', async () => {
  const report = await probePlaybackHealth({ scope: 'light', deps: deps({
    fetchEpisodeList: async (id) => {
      if (id === '1000000000000000002') throw Object.assign(new Error('gone'), { code: 'HTTP_404' });
      return series(id, 88);
    } }) });
  const layer = report.layers.find(item => item.layer === 'episodes');
  assert.equal(layer.status, 'degraded', 'a single unavailable series must not escalate');
  assert.equal(layer.failedSeries, 1);
  assert.equal(report.hardFailure, false);
});

test('an unusable episode shape is rejected instead of trusted', async () => {
  const report = await probePlaybackHealth({ scope: 'light', ...SINGLE, deps: deps({
    fetchEpisodeList: async () => ({ series_title: 'x',
      episodes: [{ vid: 'SENTINELVID-1-1', vid_index: 1 }, { vid: 'SENTINELVID-1-3', vid_index: 3 }] }) }) });
  const layer = report.layers.find(item => item.layer === 'episodes');
  assert.equal(layer.status, 'failed');
  assert.equal(layer.code, 'NON_CONTIGUOUS_EPISODES');
});

test('an empty media body fails the media layer while the source still resolves', async () => {
  const report = await probePlaybackHealth({ scope: 'light', deps: deps({
    probeMedia: async () => ({ ok: false, status: 200, bytes: 0, code: 'EMPTY_MEDIA_BODY' }) }), ...SINGLE });
  const source = report.layers.find(item => item.layer === 'source');
  const media = report.layers.find(item => item.layer === 'media');
  assert.equal(source.status, 'ok', 'an address was still resolved');
  assert.equal(media.status, 'failed');
  assert.equal(media.code, 'MEDIA_UNREACHABLE');
  assert.equal(report.hardFailure, true);
});

test('sample failures below the ceiling degrade but stay below the alarm', async () => {
  let calls = 0;
  const report = await probePlaybackHealth({ scope: 'light', deps: deps({
    fetchPlayUrlSingle: async () => { calls++; return calls === 1 ? { url: null, code: 'EMPTY_RESPONSE' } : okPlay; } }),
    ...SINGLE });
  const source = report.layers.find(item => item.layer === 'source');
  assert.equal(source.status, 'degraded');
  assert.equal(source.resolved, 2);
  assert.equal(source.sampled, 3);
  assert.equal(report.hardFailure, false, `1/3 failures stays under the ${SAMPLE_FAILURE_CEILING} ceiling`);
});

test('sample failures at or above the ceiling raise the alarm', async () => {
  let calls = 0;
  const report = await probePlaybackHealth({ scope: 'light', deps: deps({
    fetchPlayUrlSingle: async () => { calls++; return calls === 1 ? okPlay : { url: null, code: 'EMPTY_RESPONSE' }; } }),
    ...SINGLE });
  const source = report.layers.find(item => item.layer === 'source');
  assert.equal(source.status, 'failed');
  assert.equal(source.code, 'SAMPLES_FAILED');
  assert.equal(report.hardFailure, true);
});

test('the fingerprint ignores series identity so the same fault dedupes', async () => {
  const broken = deps({ fetchPlayUrlSingle: async () => ({ url: null, code: 'EMPTY_RESPONSE' }) });
  const first = await probePlaybackHealth({ scope: 'light', deps: broken, seriesIds: ['1000000000000000001'] });
  const second = await probePlaybackHealth({ scope: 'light', deps: broken, seriesIds: ['1000000000000000009'] });
  assert.ok(first.fingerprint, 'a failing run must carry a fingerprint');
  assert.equal(first.fingerprint, second.fingerprint, 'same layer and code must dedupe to one issue');
  const other = await probePlaybackHealth({ scope: 'light', seriesIds: ['1000000000000000001'],
    deps: deps({ fetchEpisodeList: async () => { throw Object.assign(new Error('x'), { code: 'TIMEOUT' }); } }) });
  assert.notEqual(other.fingerprint, first.fingerprint, 'a different fault must get its own issue');
});

test('the report never leaks episode ids or media addresses', async () => {
  const report = await probePlaybackHealth({ scope: 'light', deps: deps() });
  const text = JSON.stringify(report);
  assert.ok(!text.includes('SENTINELVID'), 'episode ids must not be reported');
  assert.ok(!text.includes('media.example.test'), 'media addresses must not be reported');
  assert.ok(!text.includes('secret-path'), 'media paths must not be reported');
});

test('routes record which source served each sample', async () => {
  const report = await probePlaybackHealth({ scope: 'light', deps: deps(), ...SINGLE });
  assert.deepEqual(report.routes, [{ source: 'app', status: 'address-found', samples: 3 }]);
  assert.equal(report.samples[0].route, 'app');
});

test('sample indexes cover first, middle and last without duplicates', () => {
  assert.deepEqual(sampleIndexes(88, 3), [1, 44, 88]);
  assert.deepEqual(sampleIndexes(1, 3), [1], 'a single episode must not sample twice');
  assert.deepEqual(sampleIndexes(2, 3), [1, 2]);
  assert.deepEqual(sampleIndexes(88, 5), [1, 22, 44, 66, 88]);
  assert.deepEqual(sampleIndexes(0, 3), []);
});

(async () => {
  let failed = 0;
  for (const [name, run] of checks) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
  }
  console.log(`${checks.length - failed}/${checks.length} playback probe checks passed`);
  process.exitCode = failed ? 1 : 0;
})();
