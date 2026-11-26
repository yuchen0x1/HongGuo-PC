const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { fetchEpisodeList } = require('./hongguo');

let nextSeriesId = 991000;

async function withAppDetail(t, videoList, check) {
  const seriesId = String(nextSeriesId++);
  t.mock.method(axios, 'get', async () => { throw new Error('Offline website unavailable fixture'); });
  t.mock.method(axios, 'post', async () => ({ status: 200, headers: {},
    data: Buffer.from(JSON.stringify({ code: 0, data: { [seriesId]: { video_data: {
      series_id: seriesId, series_title: 'Offline episode mapping fixture', video_list: videoList,
    } } } })),
  }));
  await check(fetchEpisodeList(seriesId, { force: true }));
}

test('App detail rejects an episode ID assigned to two episode numbers', async t => {
  await withAppDetail(t, [{ vid: '991022', vid_index: 22 }, { vid: '991022', vid_index: 23 }],
    result => assert.rejects(result, /分集.*重复/));
});

test('App detail rejects two episode IDs assigned to one episode number', async t => {
  await withAppDetail(t, [{ vid: '991022', vid_index: 22 }, { vid: '991023', vid_index: '22' }],
    result => assert.rejects(result, /分集.*重复/));
});

test('App detail rejects missing or zero episode numbers instead of inventing episode zero', async t => {
  for (const vidIndex of [undefined, null, 0, '', false]) {
    await withAppDetail(t, [{ vid: '991022', vid_index: vidIndex }],
      result => assert.rejects(result, /分集集数无效/));
  }
});

test('App detail rejects negative, fractional and non-decimal episode numbers', async t => {
  for (const vidIndex of [-1, 1.5, '1.5', '1e1', Number.MAX_SAFE_INTEGER + 1]) {
    await withAppDetail(t, [{ vid: '991022', vid_index: vidIndex }],
      result => assert.rejects(result, /分集集数无效/));
  }
});

test('App detail preserves non-contiguous episode numbers and normalizes decimal string numbers', async t => {
  await withAppDetail(t, [{ vid: '991034', vid_index: 34 }, { vid: '991022', vid_index: '22' }], async result => {
    const detail = await result;
    assert.deepEqual(detail.episodes.map(({ vid, vid_index }) => ({ vid, vid_index })), [
      { vid: '991022', vid_index: 22 }, { vid: '991034', vid_index: 34 },
    ]);
    assert.equal(detail.total, 2);
  });
});
