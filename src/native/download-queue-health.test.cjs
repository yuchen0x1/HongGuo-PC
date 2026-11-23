const assert = require('node:assert/strict');
const test = require('node:test');
const { isAutomaticRetry, summarizeDownloadQueue } = require('./download-queue-health');

test('summarizes queue states and earliest retry without double counting queued ids', () => {
  const result = summarizeDownloadQueue({
    tasks: [
      { id: 'a', status: 'downloading' },
      { id: 'b', status: 'pending' },
      { id: 'c', status: 'failed', retryAt: 1200 },
      { id: 'd', status: 'failed', retryAt: 1800 },
      { id: 'e', status: 'failed' },
      { id: 'f', status: 'stopped' },
      { id: 'g', status: 'completed' },
    ],
    queue: [{ id: 'b' }, { id: 'b' }],
    active: 1,
    maxConcurrent: 3,
    now: 1000,
  });
  assert.deepEqual(result, {
    active: 1,
    queued: 1,
    maxConcurrent: 3,
    pending: 1,
    downloading: 1,
    retrying: 2,
    failed: 3,
    stopped: 1,
    completed: 1,
    manualAction: 2,
    nextRetryAt: 1200,
    retryAfterMs: 200,
  });
});

test('invalid values fail closed and do not report a retry in the past as negative', () => {
  assert.equal(isAutomaticRetry({ status: 'failed', retryAt: 0 }), false);
  assert.equal(isAutomaticRetry({ status: 'failed', retryAt: 'soon' }), false);
  const result = summarizeDownloadQueue({ tasks: [{ status: 'failed', retryAt: 100 }], now: 500, maxConcurrent: 0 });
  assert.equal(result.retrying, 1);
  assert.equal(result.retryAfterMs, 0);
  assert.equal(result.maxConcurrent, 1);
});
