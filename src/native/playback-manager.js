const { boundedSignal, abortError, throwIfAborted } = require('./request-signal');
const { bindMediaSession, isMediaExpired } = require('./media-url-manager');
const { classifyPlaybackError, playbackRecoveryPolicy } = require('./playback-errors');
const { safeCode } = require('./playback-diagnostics');

const FAILURE_STAGES = new Set(['source', 'media', 'hls', 'manifest', 'segment', 'decrypt', 'decode', 'first-frame', 'player']);

function failureContext(error = {}) {
  const stage = FAILURE_STAGES.has(error.stage) ? error.stage : 'source';
  const status = Number(error.httpStatus || error.status || error.response?.status);
  const httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
  const code = safeCode(error.code) || (httpStatus >= 300 ? `HTTP_${httpStatus}` : '');
  const faultCode = classifyPlaybackError(error, { stage });
  return { stage, ...(code ? { code } : {}), ...(faultCode ? { faultCode } : {}),
    ...(httpStatus ? { status: httpStatus, httpStatus } : {}) };
}

function waitFor(promise, signal, onRelease = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      onRelease();
      fn(value);
    };
    const abort = () => finish(reject, abortError(signal));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

function createPlaybackManager({ resolve, diagnostics, accountSession, now = Date.now, budgetMs = 30000 } = {}) {
  if (typeof resolve !== 'function') throw new TypeError('Playback resolver is required');
  const pending = new Map();
  let sessionProvider = accountSession;
  let sessionEpoch = 0;
  const consumerRequestId = consumer => {
    try {
      const value = typeof consumer.options.getRequestId === 'function'
        ? consumer.options.getRequestId() : consumer.options.requestId;
      return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : '';
    } catch { return ''; }
  };
  const record = (work, event) => {
    let requestId = '';
    for (const consumer of work.consumers) {
      if (consumer.options.signal?.aborted) continue;
      const candidate = consumerRequestId(consumer);
      if (diagnostics?.isForeground?.(candidate)) { requestId = candidate; break; }
    }
    diagnostics?.record({ ...event, requestId });
  };

  async function resolveOnce(vid, seriesId, options, signal, work) {
    const account = /^\d{1,30}$/.test(String(vid)) && sessionProvider
      ? await waitFor(sessionProvider().getPlaybackContext({ signal }), signal) : {};
    throwIfAborted(signal);
    const started = now();
    record(work, { event: 'source-start' });
    const resolverOptions = { ...options };
    delete resolverOptions.requestId;
    delete resolverOptions.getRequestId;
    let result;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await waitFor(resolve(vid, seriesId, { ...resolverOptions, signal,
          force: options.force || attempt > 0,
          onPlaybackEvent: event => {
            record(work, event);
            for (const consumer of work.consumers) {
              if (consumer.options.signal?.aborted) continue;
              try { consumer.options.onPlaybackEvent?.(event); } catch {}
            }
          },
        }), signal);
      } catch (error) {
        throwIfAborted(signal);
        result = { url: null, ...failureContext(error), sources: error.sources, routeTrace: error.routeTrace };
      }
      throwIfAborted(signal);
      if (result?.url && isMediaExpired(result, now())) result = { url: null, code: 'MEDIA_URL_EXPIRED' };
      if (result?.url) {
        const bound = bindMediaSession(result, { now: now(), accountGeneration: account.accountGeneration || 0 });
        if (Array.isArray(result.variants)) bound.variants = result.variants
          .filter(item => !isMediaExpired(item, now())).map(item => bindMediaSession(item, { now: now(), accountGeneration: account.accountGeneration || 0 }));
        record(work, { event: 'source-success', sourceRoute: result.source, routeId: result.routeId, profileId: result.profileId, profileVersion: result.profileVersion,
          requestDurationMs: now() - started });
        return bound;
      }
      const stage = FAILURE_STAGES.has(result?.stage) ? result.stage : 'source';
      const faultCode = classifyPlaybackError(result || {}, { stage });
      const policy = playbackRecoveryPolicy(faultCode);
      // Empty-response ladders and identity recovery belong to the versioned provider.
      const terminalRoute = result?.sources?.some(item => !['NETWORK_DISCONNECTED', 'NETWORK_TIMEOUT'].includes(
        classifyPlaybackError(item, { stage: 'source' })));
      const retryable = !terminalRoute && ['NETWORK_DISCONNECTED', 'NETWORK_TIMEOUT', 'MEDIA_URL_EXPIRED'].includes(faultCode);
      if (!retryable || attempt || now() - started + 750 >= budgetMs) {
        record(work, { event: 'source-failure', code: result?.code, faultCode, stage,
          httpStatus: result?.httpStatus || result?.status, requestDurationMs: now() - started });
        return { ...result, url: null, ...(faultCode ? { faultCode } : {}),
          error: result?.error || policy.message || '当前内容暂时无法播放，请稍后重试。' };
      }
      record(work, { event: 'recovery', faultCode, stage: 'source' });
      let timer;
      try { await waitFor(new Promise(done => { timer = setTimeout(done, 500); }), signal); }
      finally { clearTimeout(timer); }
    }
    return result;
  }

  return {
    setAccountSession(provider) { sessionProvider = provider; },
    invalidateAccount() {
      sessionEpoch++;
      for (const work of pending.values()) work.controller.abort();
      pending.clear();
    },
    async resolve(vid, seriesId, options = {}) {
      throwIfAborted(options.signal);
      const key = JSON.stringify([sessionEpoch, String(vid), String(seriesId || ''), options.quality || 'auto',
        options.allowLowerQuality === true, options.force === true]);
      const consumer = { options };
      let work = pending.get(key);
      if (!work || work.controller.signal.aborted) {
        const controller = new AbortController();
        const deadline = boundedSignal(controller.signal, budgetMs);
        work = { controller, consumers: new Set([consumer]) };
        const current = work;
        pending.set(key, work);
        work.promise = resolveOnce(vid, seriesId, options, deadline.signal, work).finally(() => {
          deadline.dispose();
          if (pending.get(key) === current) pending.delete(key);
        });
      } else work.consumers.add(consumer);
      return waitFor(work.promise, options.signal, () => {
        work.consumers.delete(consumer);
        if (work.consumers.size === 0) work.controller.abort();
      });
    },
    get pendingCount() { return pending.size; },
  };
}

module.exports = { createPlaybackManager, waitFor };
