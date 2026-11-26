const assert = require('node:assert/strict');

function createPlaybackObservation(first, startedAt, minimumSeconds) {
  assert.ok(Number.isFinite(minimumSeconds) && minimumSeconds > 0, 'Supply a positive playback observation duration');
  assert.ok(Number.isFinite(startedAt), 'Supply a monotonic observation timestamp');
  function valid(sample) {
    assert.ok(sample && sample.muted && sample.volume === 0 && sample.silenceViolations === 0
      && !sample.paused && !sample.errorCode && !sample.busy && sample.readyState >= 2
      && !sample.seeking && sample.width > 0 && sample.height > 0 && sample.sourceMatchesAttribute,
    'Silent continuous playback was interrupted');
    assert.ok(Number.isSafeInteger(sample.sourceGeneration) && sample.sourceGeneration > 0
      && Number.isSafeInteger(sample.seekGeneration) && sample.seekGeneration >= 0
      && Number.isFinite(sample.time) && Number.isFinite(sample.duration) && sample.duration > 0
      && Number.isFinite(sample.rate) && sample.rate > 0
      && Number.isSafeInteger(sample.sourceFrameCallbacks) && sample.sourceFrameCallbacks > 0
      && Number.isSafeInteger(sample.decodedFrames) && sample.decodedFrames > 0,
    'The current media source has no usable presentation evidence');
  }
  valid(first);
  let previous = first;
  let previousAt = startedAt;
  let lastPresentedAt = startedAt;
  let samples = 1;
  function sample(current, now) {
    valid(current);
    assert.ok(Number.isFinite(now) && now > previousAt, 'Playback observation timestamps must increase');
    assert.ok(now - previousAt <= 1500, 'A sampling gap left continuous playback unobserved');
    assert.equal(current.sourceGeneration, first.sourceGeneration, 'The media source changed during continuous playback');
    assert.equal(current.seekGeneration, first.seekGeneration, 'A seek occurred during continuous playback');
    assert.ok(Math.abs(current.duration - first.duration) < 0.15 && current.rate === first.rate,
      'The media duration or playback rate changed during continuous playback');
    const elapsed = (now - previousAt) / 1000;
    assert.ok(current.time + 0.05 >= previous.time, 'Unexpected playback position regression');
    assert.ok(current.time - previous.time <= elapsed * first.rate + 0.5,
      'A seek or discontinuity occurred during continuous playback');
    assert.ok(current.time - first.time <= (now - startedAt) / 1000 * first.rate + 0.5,
      'Accumulated media progression exceeded the continuous playback clock');
    assert.ok(current.decodedFrames >= previous.decodedFrames
      && current.sourceFrameCallbacks >= previous.sourceFrameCallbacks,
    'The current source frame counters were reset during continuous playback');
    if (current.sourceFrameCallbacks > previous.sourceFrameCallbacks) lastPresentedAt = now;
    assert.ok(now - lastPresentedAt <= 1500, 'The current video stopped presenting frames during observation');
    previous = current;
    previousAt = now;
    samples++;
  }
  function complete() {
    return previousAt - startedAt >= minimumSeconds * 1000
      && previous.time - first.time >= minimumSeconds * first.rate;
  }
  function finish() {
    assert.ok(complete(), 'The full continuous playback observation has not completed');
    assert.ok(previous.decodedFrames > first.decodedFrames
      && previous.sourceFrameCallbacks > first.sourceFrameCallbacks,
    'The actual player did not decode and present more frames');
    return { minimumSecondsRequired: minimumSeconds, secondsObserved: (previousAt - startedAt) / 1000,
      mediaSecondsAdvanced: previous.time - first.time, playbackRate: first.rate,
      additionalDecodedFrames: previous.decodedFrames - first.decodedFrames,
      additionalPresentedFrames: previous.sourceFrameCallbacks - first.sourceFrameCallbacks,
      samples, sameSourceThroughout: true, maximumAllowedSamplingGapMs: 1500,
      maximumAllowedNoPresentationMs: 1500,
      audioOutputVerified: false };
  }
  return { sample, complete, finish };
}

module.exports = { createPlaybackObservation };
