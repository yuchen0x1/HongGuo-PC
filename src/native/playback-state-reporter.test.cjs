const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlaybackDiagnostics } = require('./playback-diagnostics');
const { createPlaybackStateReporter } = require('./playback-state-reporter');

function fixture() {
  const sessions = new Map();
  const diagnostics = createPlaybackDiagnostics();
  const reporter = createPlaybackStateReporter({ sessions, diagnostics });
  const add = (requestId, streamId = `${requestId}-stream`) => {
    sessions.set(streamId, { requestId });
    return { requestId, streamId };
  };
  return { sessions, diagnostics, reporter, add };
}

test('playback reports require both matching live identifiers and a foreground request', () => {
  const f = fixture(), first = f.add('first'), second = f.add('second');
  const event = { event: 'playback-success', stage: 'first-frame', mediaStatus: 'playing' };
  for (const payload of [undefined, null, event, { ...event, requestId: first.requestId },
    { ...event, streamId: first.streamId }, { ...event, requestId: first.requestId, streamId: second.streamId },
    { ...event, ...first }]) assert.equal(f.reporter.report(payload), false);
  assert.equal(f.diagnostics.snapshot().lastSuccessAt, null);
  assert.equal(f.reporter.begin(first), true);
  assert.equal(f.diagnostics.isForeground(first.requestId), true);
  assert.equal(f.reporter.report({ ...event, ...second }), false);
  assert.equal(f.reporter.report({ ...event, ...first }), true);
  assert.equal(f.reporter.report({ ...event, ...first }), false, 'the same first frame cannot inflate success counts');
  f.sessions.delete(first.streamId);
  assert.equal(f.reporter.report({ ...first, event: 'failure', faultCode: 'CDN_UNAVAILABLE' }), false);
  assert.equal(f.diagnostics.snapshot().counts.playbackSuccesses, 1);
});

test('renderer reports cannot inject native source events or unbounded recovery counts', () => {
  const f = fixture(), first = f.add('first');
  f.reporter.begin(first);
  for (const event of ['source-start', 'source-success', 'source-failure', 'source-attempt', 'PRIVATE']) {
    assert.equal(f.reporter.report({ ...first, event }), false);
  }
  for (const recoveryCount of [-1, 0.5, Infinity, NaN, '2', 1000001]) {
    assert.equal(f.reporter.report({ ...first, event: 'recovery', recoveryCount }), false);
  }
  assert.equal(f.diagnostics.snapshot().counts.sourceSuccesses, 0);
  assert.equal(f.diagnostics.snapshot().counts.recoveries, 0);
});

test('new episodes and manual retries reset display counts while automatic source recovery preserves them', () => {
  const f = fixture(), first = f.add('first');
  f.reporter.begin({ ...first, recoveryCount: 0 });
  f.reporter.report({ ...first, event: 'recovery', recoveryCount: 1 });
  f.diagnostics.record({ event: 'source-start' });
  assert.equal(f.diagnostics.snapshot().recoveryCount, 1);
  const recovered = f.add('recovered');
  f.reporter.begin({ ...recovered, recoveryCount: 1 });
  assert.equal(f.diagnostics.snapshot().recoveryCount, 1);
  f.reporter.report({ ...recovered, event: 'recovery', recoveryCount: 2 });
  assert.equal(f.diagnostics.snapshot().recoveryCount, 2, 'the supplied budget must not be incremented twice');
  const nextEpisode = f.add('next-episode');
  f.reporter.begin({ ...nextEpisode, recoveryCount: 0 });
  assert.equal(f.diagnostics.snapshot().recoveryCount, 0);
  f.reporter.report({ ...nextEpisode, event: 'recovery', recoveryCount: 1 });
  const manualRetry = f.add('manual-retry');
  f.reporter.begin({ ...manualRetry, recoveryCount: 0 });
  assert.equal(f.diagnostics.snapshot().recoveryCount, 0);
  assert.equal(f.diagnostics.snapshot().counts.recoveries, 3);
  assert.equal(f.reporter.report({ ...first, event: 'failure', faultCode: 'CDN_UNAVAILABLE' }), false);
});

test('prefetch does not change the foreground until explicit promotion and old sessions cannot reactivate', () => {
  const f = fixture(), first = f.add('first'), prefetched = f.add('prefetched');
  f.reporter.begin(first);
  f.reporter.report({ ...first, event: 'recovery', recoveryCount: 2 });
  assert.equal(f.reporter.begin({ ...prefetched, prefetch: true }), false);
  assert.equal(f.diagnostics.isForeground(first.requestId), true);
  assert.equal(f.diagnostics.isForeground(prefetched.requestId), false);
  assert.equal(f.diagnostics.snapshot().recoveryCount, 2);
  assert.equal(f.reporter.report({ ...prefetched, event: 'media-state', mediaStatus: 'loading' }), false);
  assert.equal(f.reporter.report({ ...prefetched, event: 'media-state', stage: 'media', mediaStatus: 'loading',
    activate: true, recoveryCount: 0 }), true);
  assert.equal(f.diagnostics.snapshot().recoveryCount, 0);
  assert.equal(f.diagnostics.isForeground(prefetched.requestId), true);
  assert.equal(f.diagnostics.isForeground(first.requestId), false);
  assert.equal(f.reporter.report({ ...first, event: 'media-state', stage: 'media', mediaStatus: 'loading',
    activate: true, recoveryCount: 2 }), false);
});

test('paused first-frame success stays ready and telemetry never retains private fields', () => {
  const f = fixture(), first = f.add('first');
  f.reporter.begin(first);
  f.reporter.report({ ...first, event: 'playback-success', stage: 'first-frame', mediaStatus: 'ready', decoderStatus: 'native',
    cookie: 'PRIVATE', url: 'https://invalid/?signature=PRIVATE', device_id: 'PRIVATE', recoveryCount: 0 });
  const snapshot = f.diagnostics.snapshot();
  assert.equal(snapshot.mediaStatus, 'ready');
  assert.equal(snapshot.counts.playbackSuccesses, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|https|signature=/);
});
