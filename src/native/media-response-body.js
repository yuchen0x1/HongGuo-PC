const { Readable } = require('node:stream');
const { ReadableStream } = require('node:stream/web');

function mediaResponseBody(upstream, { signal, onCancel = () => {}, idleTimeoutMs = 30000 } = {}) {
  const reader = Readable.toWeb(upstream, {
    strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength },
  }).getReader();
  let finished = false, timer, target;
  const clearIdle = () => { clearTimeout(timer); timer = null; };
  const cleanup = () => { clearIdle(); signal?.removeEventListener('abort', abort); };
  const cancelReader = reason => reader.cancel(reason).catch(error => {
    if (!['ABORT_ERR', 'ERR_CANCELED'].includes(error?.code)) throw error;
  });
  const abort = () => {
    if (finished) return;
    finished = true;
    cleanup();
    const error = Object.assign(new Error('已取消媒体请求'), { name: 'AbortError', code: 'ABORT_ERR' });
    target.error(error);
    cancelReader(error).catch(() => {});
  };
  return new ReadableStream({
    start(controller) {
      target = controller;
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    },
    async pull(controller) {
      if (finished) return;
      // Count only demanded reads: a paused player's backpressure is not a CDN stall.
      timer = setTimeout(() => upstream.destroy(Object.assign(new Error('视频数据传输中断，请重试'), {
        code: 'MEDIA_TRANSFER_ERROR', mediaRetryable: true,
      })), idleTimeoutMs);
      timer.unref?.();
      try {
        const chunk = await reader.read();
        clearIdle();
        if (finished) return;
        if (chunk.done) { finished = true; cleanup(); controller.close(); }
        else controller.enqueue(chunk.value);
      } catch (error) {
        clearIdle();
        if (finished) return;
        finished = true;
        cleanup();
        controller.error(error);
      }
    },
    cancel(reason) {
      if (!finished) {
        finished = true;
        cleanup();
        // Mark a consumer seek/cancel before Axios can report ECONNRESET.
        onCancel(reason);
      }
      return cancelReader(reason);
    },
  }, { highWaterMark: 0 });
}

module.exports = { mediaResponseBody };
