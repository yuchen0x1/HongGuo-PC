// Episode lists must belong to the requested series; no first-key/first-item fallback.
const assert = require('node:assert/strict');
const axios = require('axios');
const { fetchEpisodeList, fetchEpisodeListFromWeb } = require('../src/native/hongguo');
const playerPage = (detail, data = {}, before = {}, route = 'player_(series_id)/(vid)/page') => `<script>window._ROUTER_DATA=${JSON.stringify({
  ...before, loaderData: { player_layout: { series_id: '999', vid_list: ['21'] },
    [route]: { isSuccess: true, series_id: detail.series_id, seriesDetail: detail, ...data } },
})}</script>`;

(async () => {
  const originalGet = axios.get, originalPost = axios.post;
  try {
    const seriesRoute = 'player_(series_id)/page';
    axios.get = async () => ({ data: playerPage({ series_id: '123458', series_name: '整剧入口',
      vid_list: ['31', '32'], series_cover: 'https://img.example/series.jpg', series_intro: '官网实际返回的简介字段', accessible_episode_cnt: 1 }, {}, {}, seriesRoute) });
    const seriesPage = await fetchEpisodeListFromWeb('123458');
    assert.deepEqual(seriesPage.episodes.map(item => item.vid), ['31', '32']);
    assert.equal(seriesPage.series_title, '整剧入口');
    assert.equal(seriesPage.cover, 'https://img.example/series.jpg');
    assert.equal(seriesPage.description, '官网实际返回的简介字段');
    assert.deepEqual(seriesPage.episodes.map(item => item.web_available), [true, false]);
    for (const detail of [{ vid_list: ['31'] }, { series_id: '999', vid_list: ['31'] }]) {
      axios.get = async () => ({ data: playerPage(detail, {}, {}, seriesRoute) });
      await assert.rejects(fetchEpisodeListFromWeb('123458'), /剧集/);
    }

    for (const html of [
      playerPage({ series_name: '缺少编号', vid_list: ['21'] }),
      playerPage({ series_id: '999', series_name: '另一部', vid_list: ['21'] }),
      playerPage({ series_id: '123456', series_name: '本剧', vid_list: ['11'] }, { series_id: '999' }),
      playerPage({ series_id: '123456', series_name: '本剧', vid_list: ['11'] }, { isSuccess: false }),
      '<script>window._ROUTER_DATA={"recommendation":{"series_id":"123456","vid_list":["21"]}}</script>',
    ]) {
      axios.get = async () => ({ data: html });
      await assert.rejects(fetchEpisodeListFromWeb('123456'), /剧集|分集/, 'unverified current-player identity must fail closed');
    }

    axios.get = async () => ({ data: playerPage({ series_id: '123456', series_name: '本剧"原名"',
      series_cover: 'https://img.example/current.jpg', vid_list: ['11', '12'], accessible_episode_cnt: 1 }, {}, {
      request: { series_id: '123456' },
      recommendation: { series_id: '999', series_name: '推荐剧', series_cover: 'https://img.example/other.jpg', vid_list: ['21'], accessible_episode_cnt: 0 },
    }) });
    const bound = await fetchEpisodeListFromWeb('123456');
    assert.deepEqual(bound.episodes.map(item => item.vid), ['11', '12']);
    assert.equal(bound.series_title, '本剧"原名"');
    assert.equal(bound.cover, 'https://img.example/current.jpg');
    assert.deepEqual(bound.episodes.map(item => item.web_available), [true, false]);

    axios.get = async () => ({ data: '<script>{"series_id":"999","series_name":"另一部","vid_list":["1","2"]}</script>' });
    axios.post = async () => ({ status: 200, headers: {}, data: Buffer.from(JSON.stringify({ code: 0, data: {} })) });
    await assert.rejects(fetchEpisodeList('123456'), /不一致/);

    axios.get = async () => { throw new Error('web unavailable'); };
    axios.post = async () => ({ status: 200, headers: {}, data: Buffer.from(JSON.stringify({
      code: 0, data: { '999999': { video_data: { series_title: '另一部', series_id: '999999', video_list: [{ vid: '1', vid_index: 1, series_id: '999999' }] } } },
    })) });
    await assert.rejects(fetchEpisodeList('123459'), /不一致/);

    axios.get = async () => ({ data: playerPage({ series_id: '123456', series_name: '本剧', vid_list: ['11', '12'] }) });
    const web = await fetchEpisodeList('123456');
    assert.deepEqual(web.episodes.map(item => item.vid), ['11', '12']);
    assert.equal(web.series_id, '123456');

    axios.get = async () => { throw new Error('web unavailable'); };
    axios.post = async () => ({ status: 200, headers: {}, data: Buffer.from(JSON.stringify({
      code: 0, data: { '123457': { video_data: { series_title: '本剧', series_intro: 'App详情返回的简介字段', series_id: '123457', video_list: [{ vid: '21', vid_index: 1, series_id: '123457' }] } } },
    })) });
    const api = await fetchEpisodeList('123457');
    assert.deepEqual(api.episodes.map(item => item.vid), ['21']);
    assert.equal(api.series_id, '123457');
    assert.equal(api.description, 'App详情返回的简介字段');

    const numericSid = '7710000000000000001';
    let raw = `{"code":0,"data":{"${numericSid}":{"video_data":{"series_id":${numericSid},"series_title":"精确编号",
      "video_list":[{"vid":7710000000000000006,"vid_index":6,"series_id":${numericSid}},
      {"vid":"7710000000000000005","vid_index":5,"series_id":"${numericSid}"}]}}}}`;
    let calls = 0;
    axios.post = async () => { calls++; return { status: 200, headers: {}, data: Buffer.from(raw) }; };
    const exact = await fetchEpisodeList(numericSid);
    assert.equal(calls, 1);
    assert.equal(exact.series_id, numericSid, 'raw numeric series IDs must remain exact');
    assert.deepEqual(exact.episodes.map(item => item.vid), ['7710000000000000005', '7710000000000000006'],
      'quoted and raw numeric episode IDs must remain exact');
    assert.deepEqual(exact.episodes.map(item => item.vid_index), [5, 6]);
    assert.ok(exact.episodes.every(item => typeof item.vid_index === 'number'), 'episode indexes must remain numeric');
    assert.ok(exact.episodes.every(item => item.series_id === numericSid));
    console.log('PASS App detail IDs: raw numeric and quoted IDs stay exact; numeric code zero and episode indexes remain valid');

    raw = '{"code":403,"data":{}}';
    await assert.rejects(fetchEpisodeList('7710000000000000002'), /detail API 失败:.*"code":403/,
      'nonzero business codes must remain numeric refusals');
    console.log('PASS App detail business code: nonzero numeric code is preserved and refused');

    // An escaped property is not rewritten by the existing field allowlist helper.
    // Once JSON.parse yields an unsafe Number, reject it instead of inventing lost digits.
    raw = '{"code":0,"data":{"7710000000000000003":{"video_data":{"series_id":"7710000000000000003",'
      + '"video_list":[{"\\u0076id":7710000000000000006,"vid_index":6}]}}}}';
    await assert.rejects(fetchEpisodeList('7710000000000000003'), /分集编号无效或已失去精度/,
      'already rounded numeric episode IDs must not be converted into plausible strings');
    console.log('PASS App detail unsafe Number: already rounded episode IDs are rejected');
  } finally {
    axios.get = originalGet; axios.post = originalPost;
  }
  console.log('PASS hongguo identity: web/API episode lists must match the requested series');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
