import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mount } = require('../../../scripts/check-player-resume.cjs');

for (const position of [98.5, 100.5]) {
  test(`an expired online address restores a near-end position of ${position} without restarting`, async () => {
    const ui = mount({ props: { target: { seriesId:'A', vidIndex:1, ts:1 } },
      settings: { compat_mode:false, cache_next_episode:false },
      storage: new Map([['hongguo:online-quality', '1080p']]),
      prepare: async payload => ({ success:true, streamId:payload.requestId, url:`hongguo-stream://play/${payload.requestId}` }),
    });
    try {
      await ui.flush(); ui.metadata();
      ui.media.currentTime = position;
      ui.media.paused = false;
      const initial = ui.prepares[0];
      ui.onlinePlayDiagnostics({ requestId:initial.requestId, streamId:initial.requestId,
        faultCode:'MEDIA_URL_EXPIRED', stage:'media', diagnostics:{ stage:'media', code:'MEDIA_URL_EXPIRED' } });
      await ui.flush();
      assert.equal(ui.prepares.length, 2);
      assert.equal(ui.prepares[1].force, true);
      ui.metadata();
      assert.equal(ui.media.currentTime, Math.min(position, 99.9));
      assert.equal(ui.media.paused, false);
      assert.equal(ui.transcodes.length, 0);
    } finally { ui.unmount(); }
  });
}
