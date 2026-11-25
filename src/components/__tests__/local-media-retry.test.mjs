import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mount } = require('../../../scripts/check-player-resume.cjs');

function fixture({ delayRetry = false } = {}) {
  const calls = [], revisions = new Map();
  let finishRetry;
  const data = sid => ({ success: true, data: { series_id: sid, series_title: sid, total: 2,
    episodes: [1, 2].map(vid_index => ({ vid_index, vid: `v${vid_index}`, status: 'completed',
      fileUrl: `hongguo-local://f/${sid}-${vid_index}-${revisions.get(`${sid}:${vid_index}`) || 0}` })) } });
  const ui = mount({ local: true, props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
    settings: { compat_mode: false, cache_next_episode: false },
    apiOverrides: {
      getSeriesList: async () => [{ series_id: 'A' }, { series_id: 'B' }],
      getSeriesEpisodes: async (sid, options) => {
        calls.push({ sid, options });
        if (options?.refreshLocalIndex) {
          const key = `${sid}:${options.refreshLocalIndex}`;
          revisions.set(key, (revisions.get(key) || 0) + 1);
          if (delayRetry) await new Promise(done => { finishRetry = done; });
        }
        return data(sid);
      },
    },
  });
  return { ui, calls, finishRetry: () => finishRetry() };
}

test('initial loading and ordinary download polling do not request local media capability renewal', async () => {
  const { ui, calls } = fixture();
  try {
    await ui.flush(); ui.metadata();
    const before = calls.length;
    ui.historyUpdated({});
    const poll = [...ui.timers.values()].find(timer => timer.delay === 2000);
    assert(poll, 'active playback installs its normal download polling callback');
    await poll.fn(); await ui.flush();
    assert(calls.length > before);
    assert(calls.every(call => call.options === undefined));
    assert.equal(ui.media.src, 'hongguo-local://f/A-1-0');
  } finally { ui.unmount(); }
});

for (const vidIndex of [1, 2]) {
  test(`manual retry refreshes only current episode ${vidIndex} and resumes its original progress`, async () => {
    const { ui, calls } = fixture();
    try {
      await ui.flush(); ui.metadata();
      if (vidIndex === 2) { ui.episode(2); await ui.flush(); ui.metadata(); }
      ui.media.currentTime = 37;
      ui.error(1); await ui.flush();
      assert(calls.every(call => call.options === undefined));
      const retry = ui.button('重试本集');
      assert(retry);
      await retry.props.onClick(); await ui.flush(); ui.metadata();
      const explicit = calls.filter(call => call.options !== undefined);
      assert.equal(explicit.length, 1);
      assert.equal(explicit[0].sid, 'A');
      assert.equal(explicit[0].options.refreshLocalIndex, vidIndex);
      assert.deepEqual(Object.keys(explicit[0].options), ['refreshLocalIndex']);
      assert.equal(ui.media.src, `hongguo-local://f/A-${vidIndex}-1`);
      assert.equal(ui.media.currentTime, 37);
      assert.equal(ui.prepares.length, 0, 'a renewed complete local file should resume without an online request');
      assert.equal(ui.transcodes.length, 0);
    } finally { ui.unmount(); }
  });
}

test('a delayed retry response cannot replace the next episode or its playback position', async () => {
  const { ui, calls, finishRetry } = fixture({ delayRetry: true });
  try {
    await ui.flush(); ui.metadata(); ui.media.currentTime = 37;
    ui.error(1); await ui.flush();
    const retry = ui.button('重试本集').props.onClick();
    await ui.flush();
    assert.equal(calls.at(-1).options.refreshLocalIndex, 1);
    ui.episode(2); await ui.flush(); ui.metadata(); ui.media.currentTime = 14;
    finishRetry(); await retry; await ui.flush();
    assert.equal(ui.media.src, 'hongguo-local://f/A-2-0');
    assert.equal(ui.media.currentTime, 14);
    assert.equal(ui.prepares.length, 0);
  } finally { ui.unmount(); }
});
