// 回归：目录扫描兜底不得把「花絮2.mp4」这类同目录文件当成第 2 集。
// 以前只看结尾数字，导致花絮被合并进合集，或被「看完自动删除」误删。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');

const TITLE = '测试剧名';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-episode-ownership-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.resolve(__dirname, '../main.js');
  const req = createRequire(source);
  const handlers = {};
  const app = new EventEmitter();
  Object.assign(app, { getVersion: () => 'test', getPath: () => root, commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) });
  const store = req('./src/store');
  store.init(path.join(root, 'data.json'));
  store.saveSettings({ root });
  const native = { fetchPlayUrlSingle: async () => ({ url: 'https://fixture.invalid/media' }) };
  const context = vm.createContext({
    require: n => n === 'electron' ? { app, ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, protocol: { registerSchemesAsPrivileged() {} } }
      : n === './src/native/hongguo' ? native : req(n),
    __dirname: path.dirname(source), process, Buffer, URL, Response, Request, Headers, AbortController,
    setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} },
  });
  vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
  req('./scripts/fixtures/trusted-ipc.cjs')(context, handlers);

  const dir = path.join(root, 'series');
  fs.mkdirSync(dir, { recursive: true });
  const big = () => Buffer.alloc(1024 * 101, 7);
  const files = {
    episode1: path.join(dir, `${TITLE} 01.mp4`),
    orphan3: path.join(dir, `${TITLE} 03.mp4`),
    extra: path.join(dir, '花絮2.mp4'),
    trailer: path.join(dir, '预告 2.mp4'),
  };
  for (const file of Object.values(files)) fs.writeFileSync(file, big());

  const run = code => vm.runInContext(code, context);
  // 已下载的分集使用真实任务记录；孤儿分集与花絮只存在于目录中，靠扫描兜底。
  context.taskFixture = {
    id: 't1', status: 'completed', savePath: files.episode1, filename: path.basename(files.episode1),
    hongguoInfo: { series_id: '1', vid_index: 1, vid: '11', series_title: TITLE },
  };
  context.titleFixture = TITLE;
  run("seriesRegistry=[{series_id:'1',series_title:titleFixture,total:2,episodes:[{vid:'11',vid_index:1},{vid:'12',vid_index:2}]}];saveSeriesRegistry();downloadTasks=[taskFixture]");
  context.dirFixture = dir;
  return { dir, files, handlers, run, context };
}

test('directory scan ignores extras whose names only end in a number', async t => {
  const h = fixture(t);
  const scanned = h.run('collectSeriesEpisodeFiles("1", titleFixture)');
  const paths = scanned.ordered.map(episode => episode.path);
  assert.equal(paths.includes(h.files.episode1), true, '命名模板命中的分集仍应参与合并');
  assert.equal(paths.includes(h.files.orphan3), true, '带剧名前缀的孤儿分集仍应被兜底收录');
  assert.equal(paths.includes(h.files.extra), false, '花絮2.mp4 不能被当作第 2 集');
  assert.equal(paths.includes(h.files.trailer), false, '预告 2.mp4 不能被当作第 2 集');
  assert.equal(scanned.ordered.map(episode => episode.vid_index).join(','), '1,3');
});

test('watched-episode cleanup never deletes a look-alike extra file', async t => {
  const h = fixture(t);
  const result = await h.handlers['delete-episode-file']({}, '1', 2);
  assert.equal(result.success, true, result.error);
  assert.equal(result.count, 0, '第 2 集没有真实文件时应删除 0 个文件');
  assert.equal(fs.existsSync(h.files.extra), true, '花絮2.mp4 必须保留');
  assert.equal(fs.existsSync(h.files.trailer), true, '预告 2.mp4 必须保留');
  assert.equal(fs.existsSync(h.files.episode1), true, '其他分集必须保留');
});
