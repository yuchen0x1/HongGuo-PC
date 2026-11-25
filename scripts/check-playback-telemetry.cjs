// Player-to-native telemetry regression with isolated, in-memory media only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { mount } = require('./check-player-resume.cjs');
const { createPlaybackDiagnostics } = require('../src/native/playback-diagnostics');
const { createPlaybackStateReporter } = require('../src/native/playback-state-reporter');
const { classifyPlaybackError } = require('../src/native/playback-errors');

(async () => {
  const diagnostics = createPlaybackDiagnostics(), sessions = new Map();
  const reporter = createPlaybackStateReporter({ sessions, diagnostics });
  let sequence = 0;
  const ui = mount({ props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
    settings: { cache_next_episode: false },
    storage: new Map([['hongguo:online-quality', '1080p'], ['hongguo:playback-preferences', JSON.stringify({ muted: true })]]),
    prepare: async payload => {
      const streamId = `stream-${++sequence}`;
      sessions.set(streamId, { requestId: payload.requestId });
      reporter.begin({ ...payload, streamId });
      return { success: true, streamId, url: `hongguo-stream://${streamId}`, diagnostics: { source: 'app' } };
    },
    apiOverrides: {
      reportPlaybackState: async payload => ({ success: reporter.report(payload) }),
      releaseOnlinePlay: async payload => {
        for (const [id, session] of sessions) {
          if (id === payload.streamId || session.requestId === payload.requestId) sessions.delete(id);
        }
        return { success: true };
      },
    },
  });
  try {
    await ui.flush(); ui.metadata();
    assert.equal(ui.prepares[0].recoveryCount, 0);
    ui.error(2); await ui.flush(); ui.metadata();
    assert.equal(ui.prepares[1].recoveryCount, 1);
    assert.equal(diagnostics.snapshot().recoveryCount, 1);
    diagnostics.record({ event: 'source-start' });
    assert.equal(diagnostics.snapshot().recoveryCount, 1, 'automatic source attempts retain the current recovery budget');
    ui.error(2); await ui.flush();
    const retry = ui.button('重试本集');
    assert(retry, 'the exhausted recovery exposes the existing explicit retry');
    await retry.props.onClick(); await ui.flush(); ui.metadata();
    assert.equal(ui.prepares.at(-1).recoveryCount, 0);
    assert.equal(diagnostics.snapshot().recoveryCount, 0);
    ui.error(2); await ui.flush(); ui.metadata();
    assert.equal(diagnostics.snapshot().recoveryCount, 1);
    ui.episode(2); await ui.flush();
    assert.equal(ui.prepares.at(-1).vidIndex, 2);
    assert.equal(ui.prepares.at(-1).recoveryCount, 0);
    assert.equal(diagnostics.snapshot().recoveryCount, 0);
    assert.equal(diagnostics.snapshot().counts.recoveries, 2, 'new playback retains cumulative recovery statistics');
    console.log('PASS player telemetry preserves automatic recovery counts and resets explicit retries and new episodes');
  } finally { ui.unmount(); }

  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const callbackStart = main.indexOf('onAccountExpired: ');
  const callbackEnd = main.indexOf('\n      },', callbackStart);
  assert(callbackStart >= 0 && callbackEnd > callbackStart);
  const notifications = [];
  const onExpired = vm.runInNewContext(`(${main.slice(callbackStart + 'onAccountExpired: '.length, callbackEnd + 8)})`, {
    clearAccountCookies: async () => {}, accountSafeMessage: () => 'redacted', console,
    hongguo: { getPlaybackManager: () => ({ invalidateAccount() {} }) }, accountResumePositions: new Map(),
    sendToRenderer: (channel, payload) => notifications.push({ channel, payload }), classifyPlaybackError,
  });
  for (const code of ['ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED']) {
    onExpired({ code });
    assert.equal(notifications.at(-1).payload.faultCode, code);
    assert.equal(notifications.at(-1).payload.signedIn, false);
  }
  console.log('PASS account expiration notifications preserve invalid-session versus expired-session fault codes');

  const handlerStart = main.indexOf("ipcMain.handle('report-playback-state'");
  const handlerEnd = main.indexOf('let playbackConnectionTest;', handlerStart);
  let handler;
  const nativeDiagnostics = createPlaybackDiagnostics();
  const nativeSessions = new Map([['native-stream', { requestId: 'native-request' }]]);
  const nativeReporter = createPlaybackStateReporter({ sessions: nativeSessions, diagnostics: nativeDiagnostics });
  vm.runInNewContext(main.slice(handlerStart, handlerEnd), {
    playbackStateReporter: nativeReporter, ipcMain: { handle(_channel, callback) { handler = callback; } },
  });
  assert.equal((await handler({}, { event: 'playback-success' })).success, false);
  nativeReporter.begin({ requestId: 'native-request', streamId: 'native-stream', recoveryCount: 0 });
  assert.equal((await handler({}, { event: 'playback-success', requestId: 'native-request', streamId: 'native-stream',
    mediaStatus: 'ready', recoveryCount: 0 })).success, true);
  assert.equal(nativeDiagnostics.snapshot().mediaStatus, 'ready');
  console.log('PASS native playback IPC rejects unbound success and preserves a bound paused first frame');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
