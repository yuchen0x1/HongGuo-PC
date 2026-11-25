import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mount } = require('../../../scripts/check-player-resume.cjs');
const target = { seriesId: 'A', vidIndex: 1, ts: 1 };
const video = ui => ui.find(node => node.type === 'video');

for (const local of [false, true]) {
  test(`${local ? 'local' : 'online'} metadata and playing do not save history or prefetch before a presented frame`, async () => {
    const ui = mount({ local, props: { target }, episodeCount: 3,
      prepare: async payload => ({ success: true, streamId: payload.requestId,
        url: `hongguo-stream://${payload.requestId}`, diagnostics: { source: 'app', stage: 'media' } }) });
    try {
      await ui.flush(); ui.metadata(); await ui.flush();
      ui.media.currentTime = 4;
      video(ui).props.onTimeUpdate({ currentTarget: ui.media });
      video(ui).props.onPause({ currentTarget: ui.media });
      await ui.flush();
      assert.equal(ui.saves.length, 0);
      assert.equal(ui.prepares.filter(item => item.prefetch).length, 0);
      assert(!ui.reports.some(item => item.mediaStatus === 'playing' || item.event === 'playback-success'));
      assert(ui.presentFrame());
      video(ui).props.onTimeUpdate({ currentTarget: ui.media });
      await ui.flush();
      assert(ui.saves.some(item => item[1] === 1 && item[2] === 4));
      if (!local) {
        assert(ui.reports.some(item => item.mediaStatus === 'playing'));
        assert.equal(ui.reports.filter(item => item.event === 'playback-success').length, 1);
        assert(ui.prepares.some(item => item.prefetch && item.vidIndex === 2));
      }
    } finally { ui.unmount(); }
  });

  test(`${local ? 'local' : 'online'} frame observation survives an early frame and clears buffering after later presented frames`, async () => {
    const ui = mount({ local, props: { target }, settings: { cache_next_episode: false },
      prepare: async payload => ({ success: true, streamId: payload.requestId,
        url: `hongguo-stream://${payload.requestId}`, diagnostics: { source: 'app', stage: 'media' } }) });
    try {
      await ui.flush();
      ui.media.currentSrc = ui.media.src;
      assert(ui.presentFrame(), 'a compositor frame can arrive before the metadata handler is associated');
      assert.equal(ui.saves.length, 0);
      ui.metadata(); await ui.flush();
      assert(ui.text().includes('正在加载视频'));
      assert(ui.presentFrame(), 'the observer must remain armed after an early unassociated frame');
      await ui.flush();
      assert(!ui.text().includes('正在加载视频'));
      assert(ui.saves.length > 0);
      video(ui).props.onStalled({ currentTarget: ui.media }); await ui.flush();
      assert(ui.text().includes('正在加载视频'));
      assert(ui.presentFrame(), 'later submitted frames must be observable after the first success');
      await ui.flush();
      assert(!ui.text().includes('正在加载视频'));
      if (!local) assert.equal(ui.reports.filter(item => item.event === 'playback-success').length, 1);
    } finally { ui.unmount(); }
  });
}

test('a failed later episode clears the preceding media without recording the failed episode as watched', async () => {
  const ui = mount({ props: { target }, episodeCount: 24, settings: { cache_next_episode: false },
    prepare: async payload => payload.vidIndex === 22
      ? { success: false, faultCode: 'WEB_EPISODE_UNAVAILABLE', diagnostics: { source: 'web', stage: 'source' } }
      : { success: true, streamId: payload.requestId, url: 'hongguo-stream://first' } });
  try {
    await ui.flush(); ui.metadata(); ui.presentFrame();
    ui.media.currentTime = 4; ui.media.duration = 151;
    ui.episode(22); await ui.flush();
    assert.equal(video(ui).props.src, undefined);
    assert.equal(ui.media.currentTime, 0);
    assert.equal(ui.media.paused, true);
    assert.equal(ui.presentFrame(), false, 'terminal failure must cancel the current frame observation');
    assert(!ui.saves.some(item => item[1] === 22));
    const request = ui.prepares.find(item => item.vidIndex === 22);
    assert(!ui.reports.some(item => item.requestId === request.requestId && item.event === 'playback-success'));
  } finally { ui.unmount(); }
});

test('a terminal local load failure clears the source and retry restores the position on the same video node', async () => {
  const ui = mount({ local: true, props: { target }, settings: { cache_next_episode: false } });
  try {
    await ui.flush(); ui.metadata(); ui.presentFrame(); ui.media.currentTime = 19;
    ui.error(1); await ui.flush();
    assert.equal(video(ui).props.src, undefined);
    assert.equal(video(ui).props.ref.current, ui.media);
    assert.equal(ui.media.currentSrc, '');
    assert.equal(ui.media.paused, true);
    await ui.button('重试本集').props.onClick(); await ui.flush(); ui.metadata();
    assert.equal(ui.media.currentTime, 19);
    assert.equal(video(ui).props.ref.current, ui.media);
  } finally { ui.unmount(); }
});

test('stopping compatibility playback releases its source before clearing cache and keeps retry progress', async () => {
  const cleared = [];
  let ui;
  ui = mount({ local: true, props: { target }, settings: { cache_next_episode: false },
    apiOverrides: { clearCompatCache: async () => {
      cleared.push({ source: ui.media.src, currentSource: ui.media.currentSrc, paused: ui.media.paused });
      return { success: true, count: 1 };
    } } });
  try {
    await ui.flush(); ui.metadata(); ui.presentFrame(); ui.error(3); await ui.flush();
    ui.metadata(); ui.presentFrame(); ui.media.currentTime = 27;
    assert.equal(video(ui).props.src, 'file:///mock-compat.mp4');
    ui.find(node => node.props.className?.includes('series-picker-btn')).props.onClick(); await ui.flush();
    await ui.button('清空转码缓存').props.onClick(); await ui.flush();
    assert.deepEqual(cleared, [{ source: '', currentSource: '', paused: true }]);
    assert.equal(video(ui).props.src, undefined);
    assert.equal(video(ui).props.ref.current, ui.media);
    await ui.button('重试本集').props.onClick(); await ui.flush(); ui.metadata();
    assert.equal(ui.media.currentTime, 27);
  } finally { ui.unmount(); }
});

test('episode preparation preserves its transition source until an explicit stop and ignores its late result', async () => {
  let finishNext;
  const ui = mount({ props: { target }, settings: { cache_next_episode: false },
    prepare: async payload => payload.vidIndex === 1
      ? { success: true, url: 'hongguo-stream://first' }
      : new Promise(resolve => { finishNext = resolve; }) });
  try {
    await ui.flush(); ui.metadata(); ui.presentFrame();
    ui.episode(2); await ui.flush();
    assert.equal(video(ui).props.src, 'hongguo-stream://first');
    assert.equal(video(ui).props.ref.current, ui.media);
    await ui.button('取消播放').props.onClick(); await ui.flush();
    assert.equal(video(ui).props.src, undefined);
    assert.equal(ui.media.currentSrc, '');
    assert.equal(video(ui).props.ref.current, ui.media);
    finishNext({ success: true, streamId: 'late-second', url: 'hongguo-stream://second' }); await ui.flush();
    assert.equal(video(ui).props.src, undefined);
    assert(ui.releases.some(item => item.streamId === 'late-second'));
  } finally { ui.unmount(); }
});

test('ordinary pause keeps the loaded source and video node available for resume', async () => {
  const ui = mount({ local: true, props: { target }, settings: { cache_next_episode: false } });
  try {
    await ui.flush(); ui.metadata(); ui.presentFrame();
    ui.media.pause(); video(ui).props.onPause({ currentTarget: ui.media }); await ui.flush();
    assert.equal(video(ui).props.src, 'file:///mock-1.mp4');
    assert.equal(ui.media.currentSrc, 'file:///mock-1.mp4');
    assert.equal(video(ui).props.ref.current, ui.media);
    await ui.media.play(); await ui.flush();
    assert.equal(ui.media.paused, false);
    assert.equal(ui.prepares.length, 0);
  } finally { ui.unmount(); }
});

test('stale load and stalled events cannot change the current media state', async () => {
  const ui = mount({ props: { target }, settings: { cache_next_episode: false },
    prepare: async payload => ({ success: true, streamId: payload.requestId, url: `hongguo-stream://${payload.requestId}` }) });
  try {
    await ui.flush(); ui.metadata(); ui.presentFrame();
    const before = ui.reports.length;
    const stale = { ...ui.media, currentSrc: 'hongguo-stream://obsolete' };
    video(ui).props.onLoadStart({ currentTarget: stale });
    video(ui).props.onStalled({ currentTarget: stale });
    assert.equal(ui.reports.length, before);
    video(ui).props.onStalled({ currentTarget: ui.media });
    assert.equal(ui.reports.at(-1).mediaStatus, 'buffering');
  } finally { ui.unmount(); }
});

test('an ended event without a presented frame cannot advance the episode', async () => {
  const ui = mount({ local: true, props: { target }, settings: { cache_next_episode: false } });
  try {
    await ui.flush(); ui.metadata();
    video(ui).props.onEnded({ currentTarget: ui.media }); await ui.flush();
    assert.equal(video(ui).props.src, 'file:///mock-1.mp4');
    assert.equal(ui.saves.length, 0);
    ui.presentFrame();
    video(ui).props.onEnded({ currentTarget: ui.media }); await ui.flush();
    assert.equal(video(ui).props.src, 'file:///mock-2.mp4');
  } finally { ui.unmount(); }
});

test('late media events after detachment do not read a missing video element', async () => {
  const ui = mount({ local: true, props: { target }, settings: { cache_next_episode: false } });
  try {
    await ui.flush(); ui.metadata(); ui.presentFrame();
    const current = video(ui);
    current.props.ref.current = null;
    for (const name of ['onEnded', 'onPause', 'onWaiting', 'onStalled', 'onCanPlay']) {
      assert.doesNotThrow(() => current.props[name]());
    }
    current.props.ref.current = ui.media;
    assert.equal(ui.prepares.length, 0);
  } finally { ui.unmount(); }
});

test('the no-frame-callback fallback requires decoded frame evidence', async () => {
  const ui = mount({ local: true, props: { target }, settings: { cache_next_episode: false } });
  try {
    await ui.flush(); ui.media.requestVideoFrameCallback = undefined; ui.metadata();
    ui.media.readyState = 2;
    ui.media.getVideoPlaybackQuality = () => ({ totalVideoFrames: 0 });
    video(ui).props.onLoadedData({ currentTarget: ui.media });
    assert.equal(ui.saves.length, 0);
    ui.media.getVideoPlaybackQuality = () => ({ totalVideoFrames: 1 });
    video(ui).props.onLoadedData({ currentTarget: ui.media });
    assert(ui.saves.length > 0);
  } finally { ui.unmount(); }
});

test('a paused compatibility frame is not playing and retains its bound session until resume', async () => {
  const ui = mount({ props: { target }, settings: { cache_next_episode: false },
    storage: new Map([['hongguo:online-quality', '1080p']]),
    prepare: async payload => ({ success: true, streamId: payload.requestId, url: 'hongguo-stream://original' }) });
  try {
    await ui.flush(); ui.metadata();
    ui.media.pause(); ui.error(3); await ui.flush(); ui.metadata();
    assert.equal(video(ui).props.src, 'file:///mock-compat.mp4');
    ui.presentFrame(); await ui.flush();
    assert.equal(ui.media.paused, true);
    assert.equal(ui.saves.length, 0);
    assert(!ui.reports.some(item => item.event === 'playback-success' || item.mediaStatus === 'playing'));
    const request = ui.prepares[0];
    assert(!ui.releases.some(item => item.streamId === request.requestId));
    await ui.media.play(); await ui.flush();
    assert(ui.reports.some(item => item.event === 'playback-success' && item.decoderStatus === 'compat'));
    assert(ui.releases.some(item => item.streamId === request.requestId));
    video(ui).props.onStalled({ currentTarget: ui.media }); await ui.flush();
    assert(ui.presentFrame(), 'compatibility frames remain observed after its preparation session is released');
    await ui.flush();
    assert(!ui.text().includes('正在加载视频'));
  } finally { ui.unmount(); }
});

test('inline diagnosis copies only bounded safe fields and exports through the existing API', async () => {
  const privateValue = 'SYNTHETIC_PRIVATE_SESSION';
  let exports = 0;
  const diagnosticId = 'PLAY-20261126-123456abcdef';
  const ui = mount({ props: { target }, settings: { cache_next_episode: false },
    apiOverrides: { exportPlaybackDiagnostics: async () => { exports++; return { success: true }; } },
    prepare: async () => ({ success: false, faultCode: 'API_EMPTY_RESPONSE', diagnostics: {
      diagnosticId, source: 'app', stage: 'source', httpStatus: 200, cookie: privateValue,
      steps: [{ step: 'response', status: 'failed', code: 'EMPTY_RESPONSE', httpStatus: 200, message: privateValue }],
      events: [{ at: 1795651200000, event: 'source-failure', stage: 'source', code: 'EMPTY_RESPONSE', httpStatus: 200,
        url: `https://private.invalid/?token=${privateValue}`, headers: { Cookie: privateValue } },
      { event: privateValue, stage: privateValue, code: privateValue }],
    } }) });
  try {
    await ui.flush();
    assert(ui.text().includes(diagnosticId));
    assert(ui.text().includes('响应解析：失败'));
    await ui.button('复制脱敏诊断').props.onClick();
    const copied = ui.clipboardWrites[0];
    assert(copied.includes(diagnosticId));
    assert.doesNotMatch(copied, /SYNTHETIC_PRIVATE_SESSION|private\.invalid|Cookie|headers/);
    assert.equal(JSON.parse(copied).events.length, 1);
    await ui.button('导出播放诊断报告').props.onClick();
    assert.equal(exports, 1);
  } finally { ui.unmount(); }
});
