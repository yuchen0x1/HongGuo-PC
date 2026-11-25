const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlaybackManager } = require('./playback-manager');
const { mediaExpiresAt, bindMediaSession, isMediaExpired } = require('./media-url-manager');
const { createPlaybackDiagnostics } = require('./playback-diagnostics');
const { OFFICIAL_WEB_PROFILE } = require('./official-web-playback');

const delay = ms => new Promise(done => setTimeout(done, ms));
const source = { url: 'https://v3-reading.qznovelvod.com/episode.mp4', source: 'app', userAgent: 'bound-agent' };

test('thrown HTTP failures retain only safe status and the actual failing layer', async () => {
  for (const [failure, fault] of [
    [{ status: 403 }, 'API_FORBIDDEN'],
    [{ response: { status: 500, headers: { Cookie: 'PRIVATE' } } }, 'API_HTTP_ERROR'],
    [{ status: 404, stage: 'media' }, 'CDN_UNAVAILABLE'],
    [{ status: 410, stage: 'media', faultCode: 'MEDIA_URL_EXPIRED' }, 'MEDIA_URL_EXPIRED'],
  ]) {
    let calls = 0;
    const diagnostics = createPlaybackDiagnostics();
    const manager = createPlaybackManager({ diagnostics, budgetMs: 100,
      resolve: async () => { calls++; throw { ...failure, message: 'https://private.invalid/?token=PRIVATE',
        headers: { Authorization: 'PRIVATE' } }; } });
    const result = await manager.resolve('11', '1');
    assert.equal(result.faultCode, fault);
    assert.equal(result.status, failure.status || failure.response.status);
    assert.equal(result.httpStatus, result.status);
    assert.equal(result.stage, failure.stage || 'source');
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private\.invalid|Authorization|Cookie/);
    assert.equal(diagnostics.snapshot().events.at(-1).faultCode, fault);
  }
});

test('playback checks account separately and never forwards account credentials to source', async () => {
  for (const sessionValidity of ['anonymous', 'valid', 'expired']) {
    let checked = 0;
    const manager = createPlaybackManager({ accountSession: () => ({
      getPlaybackContext: async () => { checked++; return { sessionValidity, accountGeneration: 4, cookie: 'private-session' }; },
    }), resolve: async (_vid, _sid, options) => {
      assert.equal(options.cookie, undefined);
      assert.equal(options.headers, undefined);
      return source;
    } });
    const result = await manager.resolve('11', '1');
    assert.equal(checked, 1);
    assert.equal(result.accountGeneration, 4);
    assert.doesNotMatch(JSON.stringify(result), /private-session/);
  }
});

test('shared playback cancellation preserves the other consumer and releases the last one', async () => {
  let calls = 0, finish, requestSignal;
  const manager = createPlaybackManager({ resolve: async (_vid, _sid, { signal }) => {
    calls++; requestSignal = signal;
    await new Promise(done => { finish = done; });
    return source;
  } });
  const first = new AbortController(), second = new AbortController();
  const a = manager.resolve('11', '1', { signal: first.signal });
  const b = manager.resolve('11', '1', { signal: second.signal });
  await delay(0);
  first.abort();
  await assert.rejects(a, { code: 'ERR_CANCELED' });
  assert.equal(requestSignal.aborted, false);
  finish();
  assert.equal((await b).url, source.url);
  assert.equal(calls, 1);
  assert.equal(manager.pendingCount, 0);
});

test('last cancelled consumer aborts source, and a later request gets a fresh operation', async () => {
  const signals = [];
  const manager = createPlaybackManager({ resolve: async (_vid, _sid, { signal }) => {
    signals.push(signal);
    if (signals.length === 1) return new Promise(() => {});
    return source;
  } });
  const controller = new AbortController();
  const pending = manager.resolve('11', '1', { signal: controller.signal });
  await delay(0); controller.abort();
  await assert.rejects(pending, { code: 'ERR_CANCELED' });
  assert.equal(signals[0].aborted, true);
  assert.equal((await manager.resolve('11', '1')).url, source.url);
});

test('source and account checks share one total deadline', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    for (const hangAccount of [false, true]) {
      const manager = createPlaybackManager({ budgetMs: 20,
        accountSession: hangAccount ? () => ({ getPlaybackContext: () => new Promise(() => {}) }) : undefined,
        resolve: () => new Promise(() => {}),
      });
      const started = Date.now();
      await assert.rejects(manager.resolve('11', '1'), { code: 'ETIMEDOUT' });
      assert.ok(Date.now() - started < 500);
    }
  } finally { clearTimeout(keepAlive); }
});

test('explicit forbidden, throttling and empty responses do not repeat provider ladders', async () => {
  for (const [code, expected] of [['HTTP_403', 'API_FORBIDDEN'], ['HTTP_429', 'API_RATE_LIMITED'], ['EMPTY_RESPONSE', 'API_EMPTY_RESPONSE']]) {
    let calls = 0;
    const manager = createPlaybackManager({ resolve: async () => { calls++; return { url: null, code }; } });
    const result = await manager.resolve('11', '1');
    assert.equal(calls, 1);
    assert.equal(result.faultCode, expected);
  }
});

test('expired media is replaced once through a forced lookup before use', async () => {
  const calls = [];
  const manager = createPlaybackManager({ resolve: async (_vid, _sid, options) => {
    calls.push(options.force);
    return calls.length === 1 ? { ...source, url: `${source.url}?expires=1000000000` } : source;
  } });
  assert.equal((await manager.resolve('11', '1')).url, source.url);
  assert.deepEqual(calls, [false, true]);
});

test('account invalidation cancels pending work and never reuses its result', async () => {
  const manager = createPlaybackManager({ resolve: () => new Promise(() => {}) });
  const result = manager.resolve('11', '1');
  manager.invalidateAccount();
  await assert.rejects(result, { code: 'ERR_CANCELED' });
});

test('media lifetime reads explicit expiry and binds headers and key to its internal identity', () => {
  assert.equal(mediaExpiresAt(`${source.url}?expires=1800000000`), 1800000000000);
  assert.equal(mediaExpiresAt(`${source.url}?signature=1800000000`), 0);
  assert.equal(isMediaExpired({ url: `${source.url}?expire=1000000000` }), true);
  const first = bindMediaSession(source, { now: 123 });
  assert.equal(first.resolvedAt, 123);
  assert.notEqual(first.mediaSessionId, bindMediaSession({ ...source, userAgent: 'different' }).mediaSessionId);
  assert.notEqual(first.mediaSessionId, bindMediaSession({ ...source, contentKey: 'sensitive' }).mediaSessionId);
  assert.doesNotMatch(first.mediaSessionId, /https|bound-agent/);
});

test('shared source observations select a surviving foreground consumer after the original caller cancels', async () => {
  const diagnostics = createPlaybackDiagnostics();
  let finish, observe, signal, calls = 0;
  const web = { ...source, source: 'web', profileId: OFFICIAL_WEB_PROFILE.id,
    profileVersion: OFFICIAL_WEB_PROFILE.version, routeId: OFFICIAL_WEB_PROFILE.routeId };
  const manager = createPlaybackManager({ diagnostics, resolve: async (_vid, _sid, options) => {
    calls++; signal = options.signal; observe = options.onPlaybackEvent;
    assert.equal(options.requestId, undefined);
    assert.equal(options.getRequestId, undefined);
    await new Promise(done => { finish = done; });
    return web;
  } });
  const first = new AbortController(), second = new AbortController();
  let firstEvents = 0, secondEvents = 0;
  diagnostics.setForeground('first');
  const a = manager.resolve('11', '1', { signal: first.signal, requestId: 'first', onPlaybackEvent: () => { firstEvents++; } });
  const b = manager.resolve('11', '1', { signal: second.signal, requestId: 'second', onPlaybackEvent: () => { secondEvents++; } });
  diagnostics.setForeground('second');
  first.abort(); await assert.rejects(a, { code: 'ERR_CANCELED' });
  assert.equal(signal.aborted, false);
  observe({ type: 'source-request', sourceRoute: 'web', profileId: web.profileId, profileVersion: web.profileVersion,
    routeId: web.routeId, elapsedMs: 123, status: 200, modelValid: true });
  finish();
  assert.equal((await b).url, web.url);
  const result = diagnostics.snapshot();
  assert.equal(calls, 1);
  assert.equal(firstEvents, 0);
  assert.equal(secondEvents, 1);
  assert.equal(result.sourceRoute, 'web');
  assert.equal(result.profileId, web.profileId);
  assert.equal(result.routeId, web.routeId);
  assert.equal(result.counts.sourceSuccesses, 1);
  assert.equal(result.mediaStatus, 'loading');
  assert.equal(result.lastSuccessAt, null);
});

test('a cancelled foreground does not let its surviving background consumer overwrite the display', async () => {
  const diagnostics = createPlaybackDiagnostics();
  let finish, signal;
  const manager = createPlaybackManager({ diagnostics, resolve: async (_vid, _sid, options) => {
    signal = options.signal;
    await new Promise(done => { finish = done; });
    return source;
  } });
  const foreground = new AbortController();
  diagnostics.setForeground('foreground');
  const a = manager.resolve('11', '1', { signal: foreground.signal, requestId: 'foreground' });
  const b = manager.resolve('11', '1');
  diagnostics.record({ requestId: 'foreground', event: 'media-state', mediaStatus: 'cancelled' });
  foreground.abort(); await assert.rejects(a, { code: 'ERR_CANCELED' });
  assert.equal(signal.aborted, false);
  finish(); assert.equal((await b).url, source.url);
  const result = diagnostics.snapshot();
  assert.equal(result.counts.sourceSuccesses, 1);
  assert.equal(result.lastSourceAt, null);
  assert.equal(result.mediaStatus, 'cancelled');
});

test('shared preparation can change its foreground identifier without restarting the provider', async () => {
  const diagnostics = createPlaybackDiagnostics();
  let finish, current = 'old', calls = 0;
  const manager = createPlaybackManager({ diagnostics, resolve: async () => {
    calls++; await new Promise(done => { finish = done; }); return source;
  } });
  diagnostics.setForeground(current);
  const result = manager.resolve('11', '1', { getRequestId: () => current });
  current = 'new'; diagnostics.setForeground(current);
  finish(); await result;
  assert.equal(calls, 1);
  assert.equal(diagnostics.snapshot().sourceRoute, 'app');
  assert.equal(diagnostics.snapshot().counts.sourceSuccesses, 1);
  assert.notEqual(diagnostics.snapshot().lastSourceAt, null);
});
