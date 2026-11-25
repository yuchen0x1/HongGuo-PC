const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { createRequire } = require('node:module');
const { createPlaybackDiagnostics } = require('./playback-diagnostics');
const { createPlaybackManager } = require('./playback-manager');
const { OFFICIAL_WEB_PROFILE } = require('./official-web-playback');

function fixture(t, { failure } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-playback-main-telemetry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.resolve(__dirname, '../../main.js'), localRequire = createRequire(source);
  const diagnostics = createPlaybackDiagnostics(), events = [], handlers = {}, protocols = {};
  const record = diagnostics.record;
  diagnostics.record = event => { events.push(event); record(event); };
  let finish, observe, providerSignal, providerCalls = 0;
  const web = { url: 'https://v3-reading.qznovelvod.com/episode.mp4', source: 'web',
    profileId: OFFICIAL_WEB_PROFILE.id, profileVersion: OFFICIAL_WEB_PROFILE.version,
    routeId: OFFICIAL_WEB_PROFILE.routeId };
  const manager = createPlaybackManager({ diagnostics, resolve: async (_vid, _sid, options) => {
    providerCalls++; providerSignal = options.signal; observe = options.onPlaybackEvent;
    if (failure) throw failure;
    await new Promise(done => { finish = done; });
    return web;
  } });
  const app = new EventEmitter();
  Object.assign(app, { getVersion: () => 'test', getPath: () => root,
    commandLine: { appendSwitch() {}, hasSwitch: () => true },
    requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) });
  const native = { playbackDiagnostics: diagnostics, fetchPlayUrlSingle: manager.resolve.bind(manager),
    UA: 'fixture', WEB_UA: 'fixture', WEB_REFERER: 'https://hongguoduanju.com/', VIDEO_REFERER: 'https://novel.snssdk.com/' };
  const context = vm.createContext({ __dirname: path.dirname(source), process, Buffer, URL, Response, Request, Headers,
    AbortController, AbortSignal, setTimeout, clearTimeout,
    console: { log() {}, error() {}, warn() {} },
    require: name => name === 'electron'
      ? { app, ipcMain: { handle: (key, handler) => { handlers[key] = handler; } },
        protocol: { registerSchemesAsPrivileged() {}, handle: (key, handler) => { protocols[key] = handler; } } }
      : name === './src/store' ? { getSettings: () => ({ root }) }
      : name === './src/native/hongguo' ? native : localRequire(name),
  });
  vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
  require('../../scripts/fixtures/trusted-ipc.cjs')(context, handlers);
  context.registerStreamProtocol();
  return { diagnostics, manager, events, handlers, protocols, context,
    observe: () => observe({ type: 'source-request', sourceRoute: 'web', profileId: web.profileId,
      profileVersion: web.profileVersion, routeId: web.routeId, elapsedMs: 150, status: 200, modelValid: true }),
    finish: () => finish(), providerSignal: () => providerSignal, providerCalls: () => providerCalls };
}

test('actual main shared preparation follows the surviving foreground session after release', async t => {
  const f = fixture(t);
  const background = f.manager.resolve('11', '1');
  const first = f.handlers['prepare-online-play']({}, { vid: '11', seriesId: '1', vidIndex: 1, requestId: 'first' });
  const second = f.handlers['prepare-online-play']({}, { vid: '11', seriesId: '1', vidIndex: 1, requestId: 'second' });
  await f.handlers['release-online-play']({}, { requestId: 'first' });
  assert.equal(f.providerSignal().aborted, false);
  f.observe(); f.finish();
  const [firstResult, secondResult] = await Promise.all([first, second, background]);
  assert.equal(firstResult.success, false);
  assert.equal(firstResult.cancelled, true);
  assert.equal(firstResult.code, 'ERR_CANCELED');
  assert.equal(secondResult.success, true);
  assert(!f.events.some(event => event.event === 'failure' && event.requestId === 'first'));
  assert.equal(f.providerCalls(), 1);
  assert.equal(f.diagnostics.snapshot().sourceRoute, 'web');
  assert.equal(f.diagnostics.snapshot().routeId, OFFICIAL_WEB_PROFILE.routeId);
  assert(f.events.some(event => event.event === 'source-success' && event.requestId === 'second'));
  assert(f.events.some(event => event.type === 'source-request' && event.requestId === 'second'));
  assert.doesNotMatch(JSON.stringify(f.diagnostics.snapshot()), /requestId|"first"|"second"/);
  await f.handlers['release-online-play']({}, { requestId: 'second' });
});

test('actual main cancellation releases its shared consumer while background source work completes independently', async t => {
  const f = fixture(t);
  f.diagnostics.record({ event: 'failure', faultCode: 'API_FORBIDDEN', stage: 'source' });
  f.diagnostics.record({ event: 'playback-success', stage: 'first-frame' });
  const background = f.manager.resolve('11', '1');
  const foreground = f.handlers['prepare-online-play']({}, { vid: '11', seriesId: '1', vidIndex: 1, requestId: 'foreground' });
  const active = f.diagnostics.snapshot();
  await f.handlers['release-online-play']({}, { requestId: 'foreground' });
  const result = await foreground;
  assert.equal(result.success, false);
  assert.equal(result.cancelled, true);
  assert.equal(result.code, 'ERR_CANCELED');
  assert.equal(result.faultCode, undefined);
  assert.equal(result.diagnostics.faultCode, undefined);
  assert.equal(f.providerSignal().aborted, false);
  const before = f.diagnostics.snapshot();
  assert.equal(before.mediaStatus, 'cancelled');
  assert.equal(before.lastErrorCode, active.lastErrorCode);
  assert.equal(before.lastSuccessAt, active.lastSuccessAt);
  assert.deepEqual(before.counts, active.counts);
  assert.deepEqual(before.faults, active.faults);
  assert(f.events.some(event => event.event === 'cancelled' && event.requestId === 'foreground'));
  assert(!f.events.some(event => ['failure', 'source-failure', 'playback-success'].includes(event.event) && event.requestId === 'foreground'));
  f.observe(); f.finish(); await background;
  const after = f.diagnostics.snapshot();
  assert.equal(f.providerCalls(), 1);
  for (const key of ['mediaStatus', 'sourceRoute', 'routeId', 'lastErrorCode', 'lastSourceAt']) assert.equal(after[key], before[key]);
  assert.equal(after.counts.sourceSuccesses, 1);
  assert.equal(after.counts.playbackSuccesses, active.counts.playbackSuccesses);
  assert.equal(after.lastSuccessAt, active.lastSuccessAt);
  assert.deepEqual(after.faults, active.faults);
  assert(f.events.some(event => event.event === 'source-success' && event.requestId === ''));
});

test('actual main cancellation aborts unshared source work without recording a playback failure', async t => {
  const f = fixture(t);
  const pending = f.handlers['prepare-online-play']({}, { vid: '11', seriesId: '1', vidIndex: 1, requestId: 'cancel-only' });
  const before = f.diagnostics.snapshot();
  await f.handlers['release-online-play']({}, { requestId: 'cancel-only' });
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.equal(result.code, 'ERR_CANCELED');
  assert.equal(f.providerSignal().aborted, true);
  f.finish();
  const after = f.diagnostics.snapshot();
  assert.equal(after.mediaStatus, 'cancelled');
  assert.equal(after.lastErrorCode, before.lastErrorCode);
  assert.equal(after.lastSuccessAt, before.lastSuccessAt);
  assert.deepEqual(after.counts, before.counts);
  assert.deepEqual(after.faults, before.faults);
  assert(!f.events.some(event => ['failure', 'source-failure', 'playback-success'].includes(event.event)));
});

for (const [code, faultCode] of [['HTTP_403', 'API_FORBIDDEN'], ['ETIMEDOUT', 'NETWORK_TIMEOUT']]) {
  test(`actual main keeps ${code} source errors as terminal playback failures`, async t => {
    const f = fixture(t, { failure: Object.assign(new Error('isolated source failure'), { code }) });
    const result = await f.handlers['prepare-online-play']({}, { vid: '11', seriesId: '1', vidIndex: 1, requestId: 'source-failed' });
    assert.equal(result.success, false);
    assert.equal(result.cancelled, undefined);
    assert.equal(result.faultCode, faultCode);
    assert.equal(f.diagnostics.snapshot().mediaStatus, 'failed');
    assert.equal(f.diagnostics.snapshot().lastErrorCode, faultCode);
    assert(f.events.some(event => event.event === 'failure' && event.requestId === 'source-failed' && event.faultCode === faultCode));
    assert(!f.events.some(event => event.event === 'cancelled'));
  });
}

test('actual main streaming and terminal media failure keep their validated playback request identifier', async t => {
  const f = fixture(t);
  const pending = f.handlers['prepare-online-play']({}, { vid: '11', seriesId: '1', vidIndex: 1, requestId: 'media-current' });
  f.observe(); f.finish();
  const prepared = await pending;
  assert.equal(prepared.success, true);
  f.context.requestMedia = async () => ({ status: 200, headers: { 'content-length': '7' }, data: Readable.from([Buffer.from('fixture')]) });
  const response = await f.protocols['hongguo-stream'](new Request(prepared.url));
  assert.equal(await response.text(), 'fixture');
  assert(f.events.some(event => event.event === 'media-state' && event.stage === 'media' && event.requestId === 'media-current'));
  assert.equal(f.diagnostics.snapshot().sourceRoute, 'web');
  f.context.requestMedia = async () => { throw Object.assign(new Error('isolated fixture refusal'), { code: 'HTTP_403', status: 403 }); };
  const failed = await f.protocols['hongguo-stream'](new Request(prepared.url));
  assert.equal(failed.status, 502);
  const errors = f.events.filter(event => event.event === 'failure' && event.faultCode);
  assert(errors.length > 0);
  assert(errors.every(event => event.requestId === 'media-current'));
  assert.equal(f.diagnostics.snapshot().mediaStatus, 'failed');
  assert.doesNotMatch(JSON.stringify(f.diagnostics.snapshot()), /isolated fixture refusal|qznovelvod|media-current|requestId/);
  await f.handlers['release-online-play']({}, { requestId: 'media-current' });
});
