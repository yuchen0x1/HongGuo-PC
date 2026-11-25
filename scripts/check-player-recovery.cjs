// Renderer regressions use an in-memory media element; real media validation is separate.
const assert = require('node:assert/strict');
const { mount } = require('./check-player-resume.cjs');
const target = { seriesId: 'A', vidIndex: 1, ts: 1 };
const settings = { cache_next_episode: false };
const source = ui => ui.find(node => node.type === 'video')?.props.src;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const alert = ui => ui.find(node => node.props.role === 'alert');
const fixedQuality = () => new Map([['hongguo:online-quality', '1080p']]);
let failures = 0;
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}

(async () => {
  for (const faultCode of ['ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED', 'DEVICE_IDENTITY_EXPIRED',
    'SIGNATURE_INVALID', 'API_EMPTY_RESPONSE', 'API_FORBIDDEN', 'API_RATE_LIMITED',
    'NETWORK_TIMEOUT', 'MEDIA_DECRYPT_FAILED']) {
    await check(`${faultCode} source failure stops quality retries, decoding and automatic downloads`, async () => {
      let downloads = 0;
      const ui = mount({ props: { target }, settings,
        prepare: async () => ({ success: false, faultCode, error: 'private source error',
          diagnostics: { source: 'app', stage: faultCode === 'MEDIA_DECRYPT_FAILED' ? 'decrypt' : 'source', faultCode } }),
        apiOverrides: { downloadSingleEpisode: async () => { downloads++; return { success: true }; } } });
      try {
        await ui.flush();
        assert.equal(ui.prepares.length, 1);
        assert.equal(downloads, 0);
        assert.equal(ui.transcodes.length, 0);
        assert(alert(ui));
        assert(ui.text().includes(faultCode));
        assert(!ui.text().includes('private source error'));
        if (faultCode === 'ACCOUNT_EXPIRED') assert(ui.text().includes('重新扫码'));
        if (faultCode === 'MEDIA_DECRYPT_FAILED') assert(ui.text().includes('阶段：解密'));
      } finally { ui.unmount(); }
    });
  }

  for (const [code, faultCode] of [['HTTP_403', 'API_FORBIDDEN'], ['HTTP_429', 'API_RATE_LIMITED'], ['EMPTY_RESPONSE', 'API_EMPTY_RESPONSE']]) {
    await check(`legacy ${code} retains its actual source fault`, async () => {
      const ui = mount({ props: { target }, settings, prepare: async () => ({ success: false, code }) });
      try { await ui.flush(); assert.equal(ui.prepares.length, 1); assert(ui.text().includes(faultCode)); }
      finally { ui.unmount(); }
    });
  }

  await check('expired media refreshes the same quality and retains paused position and preferences', async () => {
    const reports = [];
    const ui = mount({ props: { target }, settings,
      storage: new Map([['hongguo:playback-preferences', JSON.stringify({ rate: 1.5, volume: 0.2, muted: true })]]),
      prepare: async payload => ({ success: true, url: `hongguo-stream://${payload.requestId}`, streamId: payload.requestId,
        diagnostics: { source: 'app', stage: 'media' } }),
      apiOverrides: { reportPlaybackState: async value => reports.push(value) } });
    try {
      await ui.flush(); ui.metadata(); ui.media.currentTime = 37; ui.media.pause();
      const first = ui.prepares[0];
      ui.onlinePlayDiagnostics({ requestId: first.requestId, streamId: first.requestId,
        faultCode: 'MEDIA_URL_EXPIRED', diagnostics: { source: 'app', stage: 'media' } });
      await ui.flush();
      assert.equal(ui.prepares.length, 2);
      assert.equal(ui.prepares[1].force, true);
      assert.equal(ui.prepares[1].quality, first.quality);
      ui.metadata();
      assert.equal(ui.media.currentTime, 37); assert.equal(ui.media.paused, true);
      assert.equal(ui.media.playbackRate, 1.5); assert.equal(ui.media.volume, 0.2); assert.equal(ui.media.muted, true);
      const second = ui.prepares[1];
      ui.onlinePlayDiagnostics({ requestId: second.requestId, streamId: second.requestId,
        faultCode: 'MEDIA_URL_EXPIRED', diagnostics: { stage: 'media', source: 'app' } });
      await ui.flush();
      assert.equal(ui.prepares.length, 2, 'repeated expiry cannot refresh indefinitely');
      assert(alert(ui));
      assert(reports.some(value => value.event === 'recovery' && value.faultCode === 'MEDIA_URL_EXPIRED'));
      assert(!JSON.stringify(reports).includes('hongguo-stream://'), 'reports contain no media address');
    } finally { ui.unmount(); }
  });

  await check('a healthy first frame gives the first recovery a fresh budget after a long pause', async () => {
    let time = 1000;
    const ui = mount({ props: { target }, settings, now: () => time, storage: fixedQuality(),
      prepare: async payload => ({ success: true, url: `hongguo-stream://${payload.requestId}`, streamId: payload.requestId,
        diagnostics: { source: 'web', stage: 'media' } }) });
    try {
      await ui.flush(); ui.metadata(); await ui.flush();
      assert(ui.presentFrame()); await ui.flush();
      ui.media.currentTime = 5; ui.media.pause(); time += 100000;
      await ui.media.play(); await ui.flush();
      const first = ui.prepares[0];
      ui.onlinePlayDiagnostics({ requestId: first.requestId, streamId: first.requestId,
        faultCode: 'MEDIA_URL_EXPIRED', diagnostics: { source: 'web', stage: 'media' } });
      await ui.flush(); ui.metadata();
      assert.equal(ui.prepares.length, 2, 'a normal pause must not exhaust a recovery that has never started');
      assert.equal(ui.prepares[1].quality, first.quality);
      assert.equal(ui.media.currentTime, 5); assert.equal(ui.media.paused, false);
      assert(ui.reports.some(value => value.event === 'recovery' && value.recoveryCount === 1));
    } finally { ui.unmount(); }
  });

  await check('a recovered first frame retains the deadline until stable playback clears the recovery', async () => {
    let time = 1000;
    const ui = mount({ props: { target }, settings, now: () => time, storage: fixedQuality(),
      prepare: async payload => ({ success: true, url: `hongguo-stream://${payload.requestId}`, streamId: payload.requestId,
        diagnostics: { source: 'web', stage: 'media' } }) });
    try {
      await ui.flush(); ui.metadata(); await ui.flush();
      assert(ui.presentFrame()); await ui.flush();
      ui.media.currentTime = 5;
      const first = ui.prepares[0];
      ui.onlinePlayDiagnostics({ requestId: first.requestId, streamId: first.requestId,
        faultCode: 'MEDIA_URL_EXPIRED', diagnostics: { source: 'web', stage: 'media' } });
      await ui.flush(); ui.metadata(); await ui.flush();
      assert(ui.presentFrame()); await ui.flush();
      time += 90001;
      const second = ui.prepares[1];
      ui.onlinePlayDiagnostics({ requestId: second.requestId, streamId: second.requestId,
        faultCode: 'CDN_UNAVAILABLE', diagnostics: { source: 'web', stage: 'media' } });
      await ui.flush();
      assert.equal(ui.prepares.length, 2, 'a brief recovered frame cannot restart the automatic recovery deadline');
      assert(alert(ui));
    } finally { ui.unmount(); }
  });

  await check('a local first frame also ends its initial load budget before a long pause', async () => {
    let time = 1000;
    const ui = mount({ local: true, settings, now: () => time });
    try {
      await ui.flush(); ui.metadata(); await ui.flush();
      assert(ui.presentFrame()); await ui.flush();
      ui.media.currentTime = 5; ui.media.pause(); time += 100000;
      await ui.media.play(); await ui.flush(); ui.error(3); await ui.flush();
      assert.equal(ui.transcodes.length, 1, 'local codec recovery must remain available after a normal pause');
      ui.metadata();
      assert.equal(ui.media.currentTime, 5);
    } finally { ui.unmount(); }
  });

  for (const autoplay of [false, true]) {
    await check(`network reconnection retains ${autoplay ? 'playing' : 'paused'} intent and progress`, async () => {
      const ui = mount({ props: { target }, settings, networkOnline: false, storage: fixedQuality() });
      try {
        await ui.flush(); ui.metadata(); ui.media.currentTime = 24;
        if (!autoplay) ui.media.pause();
        ui.error(2); await ui.flush();
        assert.equal(ui.prepares.length, 1, 'no requests are issued while the network is known offline');
        assert(ui.text().includes('等待恢复后继续播放'));
        assert(ui.releases.length > 0);
        ui.navigator.onLine = true; ui.events.get('online')(); await ui.flush(); ui.metadata();
        assert.equal(ui.prepares.length, 2); assert.equal(ui.prepares[1].force, true);
        assert.equal(ui.prepares[1].quality, '1080p');
        assert.equal(ui.media.currentTime, 24); assert.equal(ui.media.paused, !autoplay);
      } finally { ui.unmount(); }
    });
  }

  await check('cancelled network wait never restarts when the online event arrives', async () => {
    const ui = mount({ props: { target }, settings, networkOnline: false });
    try {
      await ui.flush(); ui.metadata(); ui.error(2); await ui.flush();
      ui.button('取消播放').props.onClick(); await ui.flush();
      ui.navigator.onLine = true; ui.events.get('online')(); await ui.flush();
      assert.equal(ui.prepares.length, 1); assert(alert(ui));
    } finally { ui.unmount(); }
  });

  await check('an initially disconnected source resumes through the existing playback request flow', async () => {
    let calls = 0;
    const ui = mount({ props: { target }, settings, networkOnline: false,
      prepare: async () => ++calls === 1 ? { success: false, faultCode: 'NETWORK_DISCONNECTED' }
        : { success: true, url: 'hongguo-stream://reconnected' } });
    try {
      await ui.flush();
      assert.equal(ui.prepares.length, 1); assert(ui.text().includes('等待恢复后继续播放'));
      ui.navigator.onLine = true; ui.events.get('online')(); await ui.flush(); ui.metadata();
      assert.equal(ui.prepares.length, 2); assert.equal(source(ui), 'hongguo-stream://reconnected');
      assert.equal(ui.media.paused, false);
    } finally { ui.unmount(); }
  });

  await check('an expired offline wait requires explicit retry after the connection returns', async () => {
    let time = 1000;
    const ui = mount({ props: { target }, settings, networkOnline: false, now: () => time });
    try {
      await ui.flush(); ui.metadata(); ui.media.currentTime = 23; ui.error(2); await ui.flush();
      const timer = [...ui.timers.values()].find(value => value.delay === 90000);
      assert(timer); time += 90001; timer.fn(); await ui.flush();
      ui.navigator.onLine = true; ui.events.get('online')(); await ui.flush();
      assert.equal(ui.prepares.length, 1); assert(alert(ui));
    } finally { ui.unmount(); }
  });

  await check('prepare timeout releases native requests and ignores late success', async () => {
    let time = 1000;
    const pending = deferred();
    const ui = mount({ props: { target }, settings, now: () => time, prepare: () => pending.promise });
    try {
      await ui.flush();
      const timer = [...ui.timers.values()].find(value => value.delay === 90000);
      assert(timer);
      time += 90001; timer.fn(); await ui.flush();
      assert(alert(ui)); assert.equal(ui.prepares.length, 1);
      assert(ui.releases.some(value => value.requestId === ui.prepares[0].requestId));
      pending.resolve({ success: true, url: 'hongguo-stream://too-late', streamId: 'late-stream' }); await ui.flush();
      assert.notEqual(source(ui), 'hongguo-stream://too-late');
      assert(ui.releases.some(value => value.streamId === 'late-stream'));
    } finally { ui.unmount(); }
  });

  await check('cancelled preparation releases late native streams and cannot start playback', async () => {
    const pending = deferred();
    const ui = mount({ props: { target }, settings, prepare: () => pending.promise });
    try {
      await ui.flush(); ui.button('取消播放').props.onClick(); await ui.flush();
      pending.resolve({ success: true, url: 'hongguo-stream://cancelled', streamId: 'cancelled-stream' }); await ui.flush();
      assert.equal(ui.prepares.length, 1); assert.notEqual(source(ui), 'hongguo-stream://cancelled');
      assert(ui.releases.some(value => value.streamId === 'cancelled-stream')); assert(alert(ui));
    } finally { ui.unmount(); }
  });

  await check('recovery keeps one total deadline across successive quality changes', async () => {
    let time = 1000;
    const ui = mount({ props: { target }, settings, now: () => time });
    try {
      await ui.flush(); ui.metadata(); ui.media.currentTime = 21; ui.media.pause();
      time += 40000; ui.error(2); await ui.flush(); ui.metadata();
      assert([...ui.timers.values()].some(value => value.delay === 50000));
      time += 40000; ui.error(2); await ui.flush(); ui.metadata();
      assert([...ui.timers.values()].some(value => value.delay === 10000));
      time += 10001; ui.error(2); await ui.flush();
      assert.equal(ui.prepares.length, 3); assert(alert(ui));
      assert(ui.text().includes('上限'));
    } finally { ui.unmount(); }
  });

  await check('a stalled stream refreshes within a bounded budget and preserves progress', async () => {
    const ui = mount({ props: { target }, settings, storage: fixedQuality() });
    try {
      await ui.flush(); ui.metadata(); ui.media.currentTime = 22; ui.media.pause();
      ui.find(node => node.type === 'video').props.onWaiting(); await ui.flush();
      const idle = [...ui.timers.values()].find(value => value.delay === 20000);
      assert(idle); idle.fn(); await ui.flush(); ui.metadata();
      assert.equal(ui.prepares.length, 2); assert.equal(ui.media.currentTime, 22); assert.equal(ui.media.paused, true);
      ui.find(node => node.type === 'video').props.onWaiting(); await ui.flush();
      [...ui.timers.values()].find(value => value.delay === 20000).fn(); await ui.flush();
      assert.equal(ui.prepares.length, 2); assert(alert(ui));
    } finally { ui.unmount(); }
  });

  await check('a native authorization failure during playback stops without decoder or source retries', async () => {
    const ui = mount({ props: { target }, settings,
      prepare: async payload => ({ success: true, url: `hongguo-stream://${payload.requestId}`, streamId: payload.requestId }) });
    try {
      await ui.flush(); ui.metadata(); ui.presentFrame(); ui.media.currentTime = 43;
      const request = ui.prepares[0];
      ui.onlinePlayDiagnostics({ requestId: request.requestId, streamId: request.requestId,
        faultCode: 'ACCOUNT_EXPIRED', diagnostics: { source: 'app', stage: 'media' } });
      await ui.flush();
      assert.equal(ui.prepares.length, 1); assert.equal(ui.transcodes.length, 0); assert(ui.text().includes('重新扫码'));
      assert(ui.saves.some(value => value[2] === 43));
    } finally { ui.unmount(); }
  });

  await check('HLS/CDN source error is kept separate from a decoder failure', async () => {
    const ui = mount({ props: { target }, settings, storage: fixedQuality() });
    try {
      await ui.flush(); ui.error(4); await ui.flush(); ui.error(4); await ui.flush();
      assert.equal(ui.transcodes.length, 0);
      assert(!ui.reports.some(value => value.decoderStatus === 'failed'));
      assert(ui.reports.some(value => value.faultCode === 'CDN_UNAVAILABLE'));
    } finally { ui.unmount(); }
  });

  await check('decoder conversion deadline cancels its native worker and ignores stale completion', async () => {
    let time = 1000;
    const pending = deferred();
    const ui = mount({ local: true, settings, now: () => time, transcode: () => pending.promise });
    try {
      await ui.flush(); ui.metadata(); ui.media.currentTime = 18; ui.error(3); await ui.flush();
      const timer = [...ui.timers.values()].find(value => value.delay === 90000);
      assert(timer); time += 90001; timer.fn(); await ui.flush();
      assert(ui.cancelled.some(value => value.requestId === ui.transcodes[0].requestId));
      pending.resolve({ success: true, url: 'file:///stale-conversion.mp4' }); await ui.flush();
      assert.notEqual(source(ui), 'file:///stale-conversion.mp4'); assert(alert(ui));
    } finally { ui.unmount(); }
  });

  await check('success is reported only after a submitted first frame and only once per request', async () => {
    const ui = mount({ props: { target }, settings });
    try {
      await ui.flush(); ui.metadata(); await ui.flush();
      assert(!ui.reports.some(value => value.event === 'playback-success'));
      assert(ui.presentFrame()); await ui.flush();
      assert.equal(ui.reports.filter(value => value.event === 'playback-success').length, 1);
      ui.media.pause(); await ui.media.play(); await ui.flush();
      for (let frame = 0; frame < 3; frame += 1) { assert(ui.presentFrame()); await ui.flush(); }
      assert.equal(ui.reports.filter(value => value.event === 'playback-success').length, 1);
      assert(ui.reports.every(value => value.requestId && !Object.hasOwn(value, 'url')));
    } finally { ui.unmount(); }
  });

  await check('compatibility playback retains its bound session until the real first frame', async () => {
    const ui = mount({ props: { target }, settings, storage: fixedQuality(),
      prepare: async () => ({ success: true, url: 'hongguo-stream://original', streamId: 'original-stream' }) });
    try {
      await ui.flush(); ui.metadata(); ui.media.currentTime = 17; ui.error(3); await ui.flush();
      assert.equal(source(ui), 'file:///mock-compat.mp4'); ui.metadata(); await ui.flush();
      assert(!ui.releases.some(value => value.streamId === 'original-stream'));
      assert(!ui.reports.some(value => value.event === 'playback-success'));
      for (let frame = 0; frame < 3; frame += 1) { assert(ui.presentFrame()); await ui.flush(); }
      assert(ui.releases.some(value => value.streamId === 'original-stream'));
      assert(ui.reports.some(value => value.event === 'playback-success' && value.decoderStatus === 'compat'));
      assert.equal(ui.media.currentTime, 17);
    } finally { ui.unmount(); }
  });

  await check('persistent mixed decoder failures exhaust one six-action recovery window', async () => {
    let downloads = 0;
    const ui = mount({ props: { target }, settings,
      transcode: async () => ({ success: false }),
      apiOverrides: { downloadSingleEpisode: async () => { downloads++; return { success: false }; } } });
    try {
      await ui.flush(); ui.metadata();
      for (let index = 0; index < 15; index++) { ui.error(3); await ui.flush(); ui.metadata(); }
      assert.equal(ui.prepares.length, 3); assert.equal(ui.transcodes.length, 3); assert.equal(downloads, 1);
      assert(alert(ui)); assert(ui.reports.every(value => value.recoveryCount <= 6));
    } finally { ui.unmount(); }
  });

  process.exitCode = failures ? 1 : 0;
})();
