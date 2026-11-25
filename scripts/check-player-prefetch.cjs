const assert = require('node:assert/strict');
const { mount } = require('./check-player-resume.cjs');

const prepareOk = async payload => ({ success: true, url: `hongguo-stream://${payload.vidIndex}` });


(async () => {
  let failures = 0;
  const test = async (name, fn) => {
    try { await fn(); console.log('PASS ' + name); }
    catch (error) { failures++; console.error('FAIL ' + name + ': ' + (error.stack || error.message)); }
  };

  await test('prefetch starts from timeupdate even when the played flag was not recorded', async () => {
    const ui = mount({
      settings: { cache_next_episode: false },
      props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
      episodeCount: 3,
      prepare: prepareOk,
    });
    await ui.flush(); ui.metadata();
    // 模拟历史记录被移除后 media.played 被清空，但当前视频实际还在播放。
    ui.historyUpdated({ removedSeriesId: 'A' });
    ui.media.paused = false;
    const toggle = ui.button('缓存后续 2 集');
    assert(toggle, 'cache-next toggle must exist');
    toggle.props.onClick();
    await ui.flush();
    ui.media.currentTime = 1;
    ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
    await ui.flush();
    assert.ok(ui.prepares.some(item => item.prefetch === true && item.vidIndex === 2),
      'next episode must be prefetched even when played was cleared: ' + JSON.stringify(ui.prepares));
    ui.unmount();
  });

  await test('a failed prefetch is cleared and retried after the cooldown', async () => {
    let failed = 0, clock = Date.now();
    const ui = mount({
      now: () => clock,
      props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
      episodeCount: 3,
      prepare: async payload => {
        if (payload.prefetch && payload.vidIndex === 2) { failed++; return { success: false, error: 'network' }; }
        return prepareOk(payload);
      },
    });
    try {
      await ui.flush(); ui.metadata(); ui.media.paused = false; ui.media.currentTime = 1;
      ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
      await ui.flush();
      assert.equal(failed, 1, 'first prefetch must fail once');
      clock += 16000;
      ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
      await ui.flush();
      assert.equal(failed, 2, 'failed prefetch must be retried after the retry window');
      ui.episode(2);
      await ui.flush(); ui.metadata(); ui.media.paused = false; ui.media.currentTime = 1;
      ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
      await ui.flush();
      assert.ok(ui.prepares.some(item => item.prefetch === true && item.vidIndex === 3),
        'switching episodes must still prefetch the following episode: ' + JSON.stringify(ui.prepares));
    } finally {
      ui.unmount();
    }
  });

  for (const faultCode of ['WEB_EPISODE_UNAVAILABLE', 'ACCOUNT_UNAUTHORIZED', 'API_FORBIDDEN', 'API_RATE_LIMITED']) {
    await test(`${faultCode} on episode six is not polled after the prefetch cooldown`, async () => {
      let failed = 0, clock = Date.now();
      const ui = mount({ now: () => clock, episodeCount: 68,
        props: { target: { seriesId: 'A', vidIndex: 5, ts: 1 } },
        prepare: async payload => {
          if (payload.prefetch && payload.vidIndex === 6) {
            failed++;
            if (faultCode === 'WEB_EPISODE_UNAVAILABLE') throw Object.assign(new Error('unavailable'), { code: faultCode });
            return { success: false, faultCode, diagnostics: { stage: 'source', faultCode } };
          }
          return prepareOk(payload);
        } });
      try {
        await ui.flush(); ui.metadata(); ui.media.paused = false; ui.media.currentTime = 1;
        ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
        await ui.flush();
        assert.equal(failed, 1);
        clock += 16000;
        ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
        await ui.flush();
        assert.equal(failed, 1, 'a terminal response must remain suppressed after sixteen seconds');
      } finally { ui.unmount(); }
    });
  }

  await test('a transient prefetch timeout can recover after cooldown without polling a ready source', async () => {
    let attempts = 0, clock = Date.now();
    const ui = mount({ now: () => clock, episodeCount: 7,
      props: { target: { seriesId: 'A', vidIndex: 5, ts: 1 } },
      prepare: async payload => {
        if (payload.prefetch && payload.vidIndex === 6 && ++attempts === 1) {
          return { success: false, faultCode: 'NETWORK_TIMEOUT' };
        }
        return prepareOk(payload);
      } });
    try {
      await ui.flush(); ui.metadata(); ui.media.paused = false; ui.media.currentTime = 1;
      const update = () => ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
      update(); await ui.flush(); assert.equal(attempts, 1);
      clock += 14000; update(); await ui.flush(); assert.equal(attempts, 1);
      clock += 2000; update(); await ui.flush(); assert.equal(attempts, 2);
      clock += 16000; update(); await ui.flush(); assert.equal(attempts, 2);
      ui.episode(6); await ui.flush();
      assert.equal(ui.prepares.filter(payload => payload.vidIndex === 6).length, 2,
        'the recovered prefetch should be reused when selecting the next episode');
    } finally { ui.unmount(); }
  });

  await test('persistent transient prefetch failures exhaust a finite retry budget', async () => {
    let attempts = 0, clock = Date.now();
    const ui = mount({ now: () => clock, episodeCount: 2,
      props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
      prepare: async payload => {
        if (payload.prefetch) { attempts++; return { success: false, faultCode: 'NETWORK_DISCONNECTED' }; }
        return prepareOk(payload);
      } });
    try {
      await ui.flush(); ui.metadata(); ui.media.paused = false; ui.media.currentTime = 1;
      for (let index = 0; index < 10; index++) {
        ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
        await ui.flush(); clock += 16000;
      }
      assert.equal(attempts, 3, 'a failed source may make at most three background attempts');
    } finally { ui.unmount(); }
  });

  await test('an expired prefetch recovery window does not start a late automatic retry', async () => {
    let attempts = 0, clock = Date.now();
    const ui = mount({ now: () => clock, episodeCount: 2,
      props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
      prepare: async payload => {
        if (payload.prefetch) { attempts++; return { success: false, faultCode: 'NETWORK_TIMEOUT' }; }
        return prepareOk(payload);
      } });
    try {
      await ui.flush(); ui.metadata(); ui.media.paused = false; ui.media.currentTime = 1;
      ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
      await ui.flush(); assert.equal(attempts, 1);
      clock += 91000;
      ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
      await ui.flush(); assert.equal(attempts, 1);
    } finally { ui.unmount(); }
  });

  for (const reset of ['manual retry', 'account update']) {
    await test(`${reset} invalidates a terminal prefetch refusal`, async () => {
      let attempts = 0, accountUpdated;
      const ui = mount({ episodeCount: 2,
        props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
        apiOverrides: { onAccountUpdated: listener => { accountUpdated = listener; return () => {}; } },
        prepare: async payload => {
          if (payload.prefetch) { attempts++; return { success: false, faultCode: 'WEB_EPISODE_UNAVAILABLE' }; }
          return prepareOk(payload);
        } });
      try {
        await ui.flush(); ui.metadata(); ui.media.paused = false; ui.media.currentTime = 1;
        const update = () => ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
        update(); await ui.flush(); assert.equal(attempts, 1);
        if (reset === 'manual retry') {
          const current = ui.prepares.find(payload => !payload.prefetch);
          ui.onlinePlayDiagnostics({ requestId: current.requestId, faultCode: 'WEB_EPISODE_UNAVAILABLE',
            diagnostics: { source: 'web', stage: 'source', faultCode: 'WEB_EPISODE_UNAVAILABLE' } });
          await ui.flush();
          await ui.button('重试本集').props.onClick();
          await ui.flush(); ui.metadata(); ui.media.paused = false; ui.media.currentTime = 1;
        } else { accountUpdated({ signedIn: true }); await ui.flush(); }
        update(); await ui.flush();
        assert.equal(attempts, 2, 'a deliberate source reset may recheck the current episode availability');
      } finally { ui.unmount(); }
    });
  }

  await test('switching series clears a previous terminal prefetch refusal', async () => {
    const attempts = new Map();
    const ui = mount({ episodeCount: 2, props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
      apiOverrides: {
        getSeriesList: async () => [{ series_id: 'A' }, { series_id: 'B' }],
        getSeriesEpisodes: async seriesId => ({ success: true, data: { series_id: seriesId,
          series_title: '测试剧', total: 2, episodes: [1, 2].map(index => ({
            vid_index: index, vid: `v${index}`, locked: false, status: 'missing',
          })) } }),
      },
      prepare: async payload => {
        if (payload.prefetch) {
          attempts.set(payload.seriesId, (attempts.get(payload.seriesId) || 0) + 1);
          return { success: false, faultCode: 'WEB_EPISODE_UNAVAILABLE' };
        }
        return prepareOk(payload);
      } });
    try {
      for (const [seriesId, ts] of [['A', 1], ['B', 2], ['A', 3]]) {
        ui.props.target = { seriesId, vidIndex: 1, ts }; ui.render();
        await ui.flush(); ui.metadata(); ui.media.paused = false; ui.media.currentTime = 1;
        ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
        await ui.flush();
      }
      assert.equal(attempts.get('A'), 2, 'returning to the series may recheck current episode availability');
      assert.equal(attempts.get('B'), 1);
    } finally { ui.unmount(); }
  });

  await test('switching away releases an in-flight prefetch request', async () => {
    let pendingResolve;
    const ui = mount({
      props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
      episodeCount: 3,
      prepare: payload => payload.prefetch
        ? new Promise(resolve => { pendingResolve = resolve; })
        : Promise.resolve(prepareOk(payload)),
    });
    await ui.flush(); ui.metadata(); ui.media.paused = false; ui.media.currentTime = 1;
    ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
    await ui.flush();
    const prefetch = ui.prepares.find(item => item.prefetch === true && item.vidIndex === 2);
    assert(prefetch, 'prefetch must start before switching');
    // 跳到第 3 集（跳过预取目标第 2 集），旧预取必须释放而不是一直占着。
    ui.episode(3);
    await ui.flush();
    assert.ok(ui.releases.some(item => item.requestId === prefetch.requestId),
      'switching episodes must release the stale prefetch request');
    pendingResolve?.({ success: false, error: 'cancelled' });
    await ui.flush();
    ui.unmount();
  });

  await test('cache-next disabled never prefetches', async () => {
    const ui = mount({
      settings: { cache_next_episode: false },
      props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
      episodeCount: 3,
      prepare: prepareOk,
    });
    await ui.flush(); ui.metadata(); ui.media.paused = false; ui.media.currentTime = 1;
    ui.find(node => node.type === 'video').props.onTimeUpdate({ currentTarget: ui.media });
    await ui.flush();
    assert.equal(ui.prepares.some(item => item.prefetch === true), false);
    ui.unmount();
  });

  if (failures) process.exitCode = 1;
})();
