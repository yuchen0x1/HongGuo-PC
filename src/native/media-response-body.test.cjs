const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Readable, PassThrough } = require('node:stream');
const { mediaResponseBody } = require('./media-response-body');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = (promise, ms = 1000) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Media read did not settle')), ms);
  })]).finally(() => clearTimeout(timer));
};

test('media response streams complete bytes and settles EOF', async () => {
  const source = Readable.from([Buffer.from('first'), Buffer.from('second')]);
  const response = new Response(mediaResponseBody(source, { idleTimeoutMs: 100 }));
  assert.equal(await deadline(response.text()), 'firstsecond');
  assert.equal(source.destroyed, true);
});

test('headers without media bytes time out the demanded read and destroy upstream', async () => {
  const source = new PassThrough();
  const reader = mediaResponseBody(source, { idleTimeoutMs: 25 }).getReader();
  await assert.rejects(deadline(reader.read()), error => error.code === 'MEDIA_TRANSFER_ERROR'
    && error.mediaRetryable === true && !/https?:/.test(error.message));
  assert.equal(source.destroyed, true);
});

test('each received chunk resets the pending-read timeout', async () => {
  const source = new PassThrough();
  const reader = mediaResponseBody(source, { idleTimeoutMs: 150 }).getReader();
  for (let index = 0; index < 3; index++) {
    const pending = reader.read();
    await delay(60);
    source.write(Buffer.from(String(index)));
    assert.equal(Buffer.from((await deadline(pending)).value).toString(), String(index));
  }
  source.end();
  assert.equal((await deadline(reader.read())).done, true);
});

test('paused consumer backpressure does not count as an idle media transfer', async () => {
  const source = new PassThrough();
  const body = mediaResponseBody(source, { idleTimeoutMs: 25 });
  source.write(Buffer.from('queued'));
  await delay(80);
  assert.equal(source.destroyed, false);
  const reader = body.getReader();
  assert.equal(Buffer.from((await reader.read()).value).toString(), 'queued');
  source.end();
  assert.equal((await deadline(reader.read())).done, true);
});

test('an unconsumed response does not start a speculative pending-read timer', async () => {
  const source = new PassThrough();
  const body = mediaResponseBody(source, { idleTimeoutMs: 25 });
  await delay(80);
  assert.equal(source.destroyed, false);
  await body.cancel();
  assert.equal(source.destroyed, true);
});

test('consumer cancellation marks the session before upstream errors and clears the watchdog', async () => {
  const source = new PassThrough(), controller = new AbortController();
  let cancelled = false;
  source.on('error', () => assert.equal(cancelled, true));
  const reader = mediaResponseBody(source, { signal: controller.signal, idleTimeoutMs: 25,
    onCancel: () => { cancelled = true; controller.abort(); } }).getReader();
  const pending = reader.read();
  await reader.cancel();
  assert.equal((await deadline(pending)).done, true);
  assert.equal(cancelled, true);
  assert.equal(source.destroyed, true);
  await delay(60);
  assert.notEqual(source.errored?.code, 'MEDIA_TRANSFER_ERROR');
});

test('external request abort rejects a pending read promptly and releases upstream', async () => {
  const source = new PassThrough(), controller = new AbortController();
  const reader = mediaResponseBody(source, { signal: controller.signal, idleTimeoutMs: 500 }).getReader();
  const pending = reader.read();
  controller.abort();
  await assert.rejects(deadline(pending), error => error.name === 'AbortError' && error.code === 'ABORT_ERR');
  await delay(0);
  assert.equal(source.destroyed, true);
});

test('an already aborted request never leaves an unread response waiting', async () => {
  const source = new PassThrough(), controller = new AbortController();
  controller.abort();
  const reader = mediaResponseBody(source, { signal: controller.signal }).getReader();
  await assert.rejects(deadline(reader.read()), error => error.code === 'ABORT_ERR');
  await delay(0);
  assert.equal(source.destroyed, true);
});
