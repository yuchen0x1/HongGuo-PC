const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');

function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-media-retry-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.resolve(__dirname, '../../main.js'), localRequire = createRequire(source);
  const handlers = {}, protocols = {}, files = {};
  for (const [name, size] of Object.entries({ A1: 120000, A2: 120000, A3: 20, A4: 120000, B1: 120000 })) {
    files[name] = path.join(root, `${name}.mp4`);
    fs.writeFileSync(files[name], Buffer.alloc(size, name.charCodeAt(1)));
  }
  const app = new EventEmitter();
  Object.assign(app, { getVersion: () => 'test', getPath: () => root,
    commandLine: { appendSwitch() {}, hasSwitch: () => true },
    requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) });
  const context = vm.createContext({ __dirname: path.dirname(source), process, Buffer, URL, Response, Request, Headers,
    AbortController, AbortSignal, setTimeout, clearTimeout,
    console: { log() {}, error() {}, warn() {} },
    require: name => name === 'electron'
      ? { app, ipcMain: { handle: (key, handler) => { handlers[key] = handler; } },
        protocol: { registerSchemesAsPrivileged() {}, handle: (key, handler) => { protocols[key] = handler; } } }
      : name === './src/store' ? { getSettings: () => ({ root }) }
      : name === './src/native/hongguo' ? {} : localRequire(name),
    fixtureSeries: [
      { series_id: 'A', series_title: 'A', episodes: [1, 2, 3, 4, 5].map(vid_index => ({ vid_index, vid: `A${vid_index}` })) },
      { series_id: 'B', series_title: 'B', episodes: [{ vid_index: 1, vid: 'B1' }] },
    ],
    fixtureTasks: ['A1', 'A2', 'A3', 'B1'].map(name => ({ id: name, savePath: files[name],
      status: name === 'A3' ? 'downloading' : 'completed',
      hongguoInfo: { series_id: name[0], series_title: name[0], vid_index: Number(name[1]), vid: name } })),
  });
  vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
  require('../../scripts/fixtures/trusted-ipc.cjs')(context, handlers);
  vm.runInContext('seriesRegistry = fixtureSeries; downloadTasks = fixtureTasks;', context);
  context.collectSeriesEpisodeFiles = sid => ({ dir: root,
    ordered: sid === 'A' ? [{ vid_index: 4, path: files.A4 }] : [] });
  context.registerLocalProtocol();
  return { files, handlers,
    access: vm.runInContext('mediaAccess', context),
    read: request => protocols['hongguo-local'](request),
    episodes: async (sid = 'A', options) => {
      const result = await handlers['get-series-episodes']({}, sid, options);
      assert.equal(result.success, true);
      return result.data.episodes;
    },
    query: options => handlers['get-series-episodes']({}, 'A', options),
  };
}

const urls = episodes => episodes.map(episode => episode.fileUrl);

test('episode polling keeps local capabilities stable and explicit retry rotates only its selected completed episode', async t => {
  const f = fixture(t), original = await f.episodes(), other = await f.episodes('B');
  assert.deepEqual(urls(await f.episodes()), urls(original));
  const retried = await f.episodes('A', { refreshLocalIndex: 1 });
  assert.notEqual(retried[0].fileUrl, original[0].fileUrl);
  assert.deepEqual(urls(retried).slice(1), urls(original).slice(1));
  assert.deepEqual(urls(await f.episodes('B')), urls(other));
  assert.deepEqual(urls(await f.episodes()), urls(retried));
  for (const url of [original[0].fileUrl, retried[0].fileUrl]) {
    const response = await f.read(new Request(url, { headers: { Range: 'bytes=9-19' } }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 9-19/120000');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.alloc(11, '1'.charCodeAt(0)));
  }
});

test('retry refreshes a registered completed episode found by disk scanning while retaining its earlier reader', async t => {
  const f = fixture(t), original = await f.episodes();
  assert.equal(original[3].status, 'completed');
  const retried = await f.episodes('A', { refreshLocalIndex: 4 });
  assert.notEqual(retried[3].fileUrl, original[3].fileUrl);
  assert.deepEqual(urls(retried).slice(0, 3), urls(original).slice(0, 3));
  assert.equal(f.access.resolveLocal(original[3].fileUrl), f.files.A4);
  assert.equal(f.access.resolveLocal(retried[3].fileUrl), f.files.A4);
  const response = await f.read(new Request(original[3].fileUrl, { method: 'HEAD' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '120000');
});

test('incomplete, missing and unregistered episode retries issue no media capability', async t => {
  const f = fixture(t), original = await f.episodes();
  assert.equal(original[2].status, 'downloading');
  assert.equal(original[2].fileUrl, null);
  assert.equal(original[4].status, 'missing');
  assert.equal(original[4].fileUrl, null);
  for (const refreshLocalIndex of [3, 5, 99]) {
    assert.deepEqual(urls(await f.episodes('A', { refreshLocalIndex })), urls(original));
  }
  assert.equal((await f.episodes('unknown', { refreshLocalIndex: 1 })).length, 0);
  assert.deepEqual(urls(await f.episodes()), urls(original));
});

test('invalid retry indexes are rejected without rotating any completed capability', async t => {
  const f = fixture(t), original = await f.episodes();
  for (const refreshLocalIndex of ['1', 0, -1, 1.5, NaN, Infinity, true, {}, [], 1000001, Number.MAX_SAFE_INTEGER + 1]) {
    const result = await f.query({ refreshLocalIndex });
    assert.equal(result.success, false, `reject index type ${typeof refreshLocalIndex}`);
    assert.deepEqual(urls(await f.episodes()), urls(original));
  }
});

test('preload preserves ordinary reads and forwards an explicit retry to the real episode IPC', async t => {
  const f = fixture(t);
  let bridge;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../preload.js'), 'utf8'), {
    require: name => {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (_name, api) => { bridge = api; } },
        ipcRenderer: { invoke: (channel, ...args) => f.handlers[channel]({}, ...args) } };
    },
  });
  const original = await bridge.getSeriesEpisodes('A');
  const polled = await bridge.getSeriesEpisodes('A');
  assert.equal(original.success, true);
  assert.deepEqual(urls(polled.data.episodes), urls(original.data.episodes));
  const retried = await bridge.getSeriesEpisodes('A', { refreshLocalIndex: 2 });
  assert.equal(retried.success, true);
  assert.notEqual(retried.data.episodes[1].fileUrl, original.data.episodes[1].fileUrl);
  assert.equal(retried.data.episodes[0].fileUrl, original.data.episodes[0].fileUrl);
  assert.equal((await bridge.getSeriesEpisodes('A', { refreshLocalIndex: '2' })).success, false);
});
