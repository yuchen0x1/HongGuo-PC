// Offline renderer-state metadata checks; these do not play or generate any video.
const assert = require('node:assert/strict');
const { createPlaybackObservation } = require('./playback-observation.cjs');

let checks = 0;
const initial = overrides => ({ time: 0, duration: 150, paused: false, muted: true, volume: 0, rate: 1,
  width: 360, height: 640, readyState: 4, decodedFrames: 1, sourceFrameCallbacks: 1,
  sourceGeneration: 7, sourceMatchesAttribute: true, seekGeneration: 0, seeking: false,
  silenceViolations: 0, busy: false, errorCode: 0, ...overrides });
const stateAt = (milliseconds, overrides) => initial({ time: milliseconds / 1000,
  decodedFrames: 1 + Math.floor(milliseconds / 40), sourceFrameCallbacks: 1 + Math.floor(milliseconds / 40), ...overrides });
function test(name, action) {
  try { action(); checks++; }
  catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); }
}

test('30 seconds require both wall time and actual media progression', () => {
  const observation = createPlaybackObservation(initial(), 0, 30);
  for (let at = 500; at < 30000; at += 500) observation.sample(stateAt(at), at);
  assert.equal(observation.complete(), false);
  assert.throws(() => observation.finish(), /has not completed/);
  observation.sample(stateAt(30000), 30000);
  assert.equal(observation.complete(), true);
  assert.deepEqual(observation.finish(), { minimumSecondsRequired: 30, secondsObserved: 30,
    mediaSecondsAdvanced: 30, playbackRate: 1, additionalDecodedFrames: 750,
    additionalPresentedFrames: 750, samples: 61, sameSourceThroughout: true,
    maximumAllowedSamplingGapMs: 1500, maximumAllowedNoPresentationMs: 1500, audioOutputVerified: false });
});

test('a stalled media clock cannot pass after 30 wall seconds', () => {
  const observation = createPlaybackObservation(initial(), 0, 30);
  for (let at = 500; at <= 30000; at += 500) observation.sample(stateAt(at, { time: at / 1000 - 0.1 }), at);
  assert.equal(observation.complete(), false);
  assert.throws(() => observation.finish(), /has not completed/);
});

test('rate-adjusted observations measure actual playback without changing rate', () => {
  const observation = createPlaybackObservation(initial({ rate: 1.25 }), 0, 2);
  for (let at = 500; at <= 2000; at += 500) observation.sample(stateAt(at, { time: at / 1000 * 1.25, rate: 1.25 }), at);
  assert.equal(observation.finish().mediaSecondsAdvanced, 2.5);
});

test('repeated small forward jumps cannot accumulate the per-sample tolerance', () => {
  const observation = createPlaybackObservation(initial(), 0, 30);
  for (let at = 500; at <= 2500; at += 500) {
    observation.sample(stateAt(at, { time: at / 1000 * 1.2 }), at);
  }
  assert.throws(() => observation.sample(stateAt(3000, { time: 3.6 }), 3000), /Accumulated media progression/);
});

test('double-speed media cannot pass while the declared rate remains one', () => {
  const observation = createPlaybackObservation(initial(), 0, 30);
  observation.sample(stateAt(500, { time: 1 }), 500);
  assert.throws(() => observation.sample(stateAt(1000, { time: 2 }), 1000), /Accumulated media progression/);
});

test('a seek completed between two samples still invalidates observation', () => {
  const observation = createPlaybackObservation(initial({ seekGeneration: 2 }), 0, 30);
  assert.throws(() => observation.sample(stateAt(500, { seekGeneration: 3, seeking: false }), 500), /A seek occurred/);
});

for (const [name, overrides, message] of [
  ['source reload', { sourceGeneration: 8 }, /source changed/],
  ['duration change', { duration: 151 }, /duration or playback rate changed/],
  ['rate change', { rate: 2 }, /duration or playback rate changed/],
  ['seek forwards', { time: 12 }, /seek or discontinuity/],
  ['seek backwards', { time: -1 }, /position regression/],
  ['active seek', { seeking: true }, /interrupted/],
  ['counter reset', { decodedFrames: 0 }, /no usable presentation evidence/],
  ['paused', { paused: true }, /interrupted/],
  ['buffering', { busy: true }, /interrupted/],
  ['wrong source attribute', { sourceMatchesAttribute: false }, /interrupted/],
  ['unmuted', { muted: false }, /interrupted/],
  ['audible volume', { volume: 0.5 }, /interrupted/],
  ['earlier silence violation', { silenceViolations: 1 }, /interrupted/],
  ['media error', { errorCode: 3 }, /interrupted/],
]) {
  test(`reject ${name}`, () => {
    const observation = createPlaybackObservation(initial(), 0, 30);
    assert.throws(() => observation.sample(stateAt(500, overrides), 500), message);
  });
}

test('frames that stop after a successful first frame fail', () => {
  const observation = createPlaybackObservation(initial(), 0, 30);
  observation.sample(stateAt(500), 500);
  for (const at of [1000, 1500, 2000]) observation.sample(stateAt(at, { sourceFrameCallbacks: 13 }), at);
  assert.throws(() => observation.sample(stateAt(2500, { sourceFrameCallbacks: 13 }), 2500), /stopped presenting frames/);
});

test('a long debugger gap cannot be credited as observed playback', () => {
  const observation = createPlaybackObservation(initial(), 0, 30);
  assert.throws(() => observation.sample(stateAt(2000), 2000), /sampling gap/);
});

test('a stale first frame from another source cannot start observation', () => {
  assert.throws(() => createPlaybackObservation(initial({ sourceFrameCallbacks: 0 }), 0, 30), /no usable presentation evidence/);
});

test('frame counter resets on the same source fail', () => {
  const observation = createPlaybackObservation(initial(), 0, 30);
  observation.sample(stateAt(500), 500);
  assert.throws(() => observation.sample(stateAt(1000, { decodedFrames: 3, sourceFrameCallbacks: 3 }), 1000), /counters were reset/);
});

console.log(`Playback observation: ${checks}/${checks} offline metadata checks passed; real media and audio output remain untested.`);
