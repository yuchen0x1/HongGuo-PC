const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createReleaseNotesService, normalizeNotes, RELEASE_NOTES_ERROR } = require('./release-notes');

const RELEASES = [
  { tag_name: 'v6.2', name: '红果短剧 6.2', published_at: '2026-11-04T15:32:25Z', body: '## 亮点\n- **跨季切换**' },
  { tag_name: 'v6.1', name: '', published_at: '2026-11-03T01:21:30Z', body: '更新日志页。' },
];

function tempCacheFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-release-notes-'));
  return path.join(dir, 'release-notes-cache.json');
}

const MINUTE = 60 * 1000;

test('normalizeNotes 过滤草稿、预发布与空正文并整理字段', () => {
  const notes = normalizeNotes([
    ...RELEASES,
    { tag_name: 'v6.3-rc', prerelease: true, body: '候选' },
    { tag_name: 'v9.9', draft: true, body: '草稿' },
    { tag_name: 'v6.0', body: '   ' },
    { tag_name: 'not-a-version', body: '异常标签' },
  ]);
  assert.deepEqual(notes.map(note => note.version), ['6.2', '6.1']);
  assert.equal(notes[0].date, '2026-11-04');
  assert.equal(notes[1].name, '');
});

test('首次拉取成功并持久化缓存；TTL 内不再请求', async () => {
  const file = tempCacheFile();
  let calls = 0, clock = 0;
  const request = async config => {
    calls++;
    assert.equal(config.url, 'https://api.github.com/repos/yuchen0x1/HongGuo-PC/releases?per_page=20');
    assert.ok(config.headers['User-Agent']);
    return { status: 200, data: RELEASES, headers: { etag: '"etag-1"' } };
  };
  const getNotes = createReleaseNotesService({ request, cacheFile: () => file, now: () => clock, wait: async () => {} });

  const first = await getNotes();
  assert.equal(first.success, true);
  assert.equal(first.cached, false);
  assert.deepEqual(first.notes.map(note => note.version), ['6.2', '6.1']);
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persisted.etag, '"etag-1"');
  assert.equal(persisted.fetchedAt, 0);
  assert.equal(persisted.notes.length, 2);

  clock = 5 * MINUTE;
  const second = await getNotes();
  assert.equal(calls, 1, 'TTL 内直接使用缓存');
  assert.deepEqual(second, { success: true, notes: first.notes, cached: false });
});

test('TTL 过期后带 ETag 复验，304 刷新缓存且不消耗配额', async () => {
  const file = tempCacheFile();
  let calls = 0, clock = 0;
  let respond = async () => ({ status: 200, data: RELEASES, headers: { etag: '"etag-1"' } });
  const getNotes = createReleaseNotesService({ request: config => respond(config), cacheFile: () => file, now: () => clock, wait: async () => {} });
  await getNotes();

  clock = 11 * MINUTE;
  respond = async config => {
    calls++;
    assert.equal(config.headers['If-None-Match'], '"etag-1"', '条件请求携带上次的 ETag');
    return { status: 304, data: null, headers: {} };
  };
  const revalidated = await getNotes();
  assert.equal(calls, 1, '304 路径只请求一次');
  assert.equal(revalidated.success, true);
  assert.equal(revalidated.cached, false);
  assert.deepEqual(revalidated.notes.map(note => note.version), ['6.2', '6.1'], '304 沿用缓存内容');
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persisted.fetchedAt, 11 * MINUTE, '304 后缓存时间被刷新');
});

test('TTL 过期后 200 返回新数据，缓存更新并携带新 ETag', async () => {
  const file = tempCacheFile();
  let calls = 0, clock = 0;
  let respond = async () => { calls++; return { status: 200, data: RELEASES, headers: { etag: '"etag-1"' } }; };
  const getNotes = createReleaseNotesService({ request: config => respond(config), cacheFile: () => file, now: () => clock, wait: async () => {} });
  await getNotes();

  const updated = [{ tag_name: 'v6.3', name: '', published_at: '2026-11-05T10:00:00Z', body: '新版本。' }, ...RELEASES];
  clock = 11 * MINUTE;
  respond = async () => { calls++; return { status: 200, data: updated, headers: { etag: '"etag-2"' } }; };
  const result = await getNotes();
  assert.equal(result.cached, false);
  assert.equal(result.notes[0].version, '6.3');
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persisted.etag, '"etag-2"');
  assert.equal(persisted.notes[0].version, '6.3');
  assert.equal(calls, 2);
});

test('限速 403 不重试，直接回退缓存内容并标注 cached', async () => {
  const file = tempCacheFile();
  let calls = 0, clock = 0;
  let respond = async () => ({ status: 200, data: RELEASES, headers: { etag: '"etag-1"' } });
  const getNotes = createReleaseNotesService({ request: config => respond(config), cacheFile: () => file, now: () => clock, wait: async () => {} });
  await getNotes();

  clock = 11 * MINUTE;
  respond = async () => {
    calls++;
    const error = new Error('rate limited');
    error.response = { status: 403 };
    throw error;
  };
  const result = await getNotes();
  assert.equal(calls, 1, '403 立即放弃重试');
  assert.equal(result.success, true);
  assert.equal(result.cached, true);
  assert.equal(result.fetchedAt, 0);
  assert.deepEqual(result.notes.map(note => note.version), ['6.2', '6.1']);
});

test('瞬时网络错误重试一次，仍失败则回退缓存', async () => {
  const file = tempCacheFile();
  let calls = 0, clock = 0;
  let respond = async () => ({ status: 200, data: RELEASES, headers: {} });
  const getNotes = createReleaseNotesService({ request: config => respond(config), cacheFile: () => file, now: () => clock, wait: async () => {} });
  await getNotes();

  clock = 11 * MINUTE;
  respond = async () => {
    calls++;
    const error = new Error('timeout');
    error.code = 'ECONNABORTED';
    throw error;
  };
  const result = await getNotes();
  assert.equal(calls, 2, '非限速错误重试一次');
  assert.equal(result.success, true);
  assert.equal(result.cached, true);
});

test('无缓存且持续失败时返回可读错误', async () => {
  const file = tempCacheFile();
  let calls = 0;
  const respond = async () => {
    calls++;
    const error = new Error('boom');
    error.response = { status: 500 };
    throw error;
  };
  const getNotes = createReleaseNotesService({ request: config => respond(config), cacheFile: () => file, wait: async () => {} });
  const result = await getNotes();
  assert.equal(result.success, false);
  assert.equal(result.error, RELEASE_NOTES_ERROR);
  assert.equal(calls, 2, '重试一次后放弃');
});

test('缓存文件损坏或内容无效时按无缓存处理并重建', async () => {
  const file = tempCacheFile();
  fs.writeFileSync(file, '{broken json', 'utf8');
  let clock = 0;
  let respond = async () => ({ status: 200, data: RELEASES, headers: { etag: '"etag-9"' } });
  const getNotes = createReleaseNotesService({ request: config => respond(config), cacheFile: () => file, now: () => clock, wait: async () => {} });
  const result = await getNotes();
  assert.equal(result.success, true);
  assert.equal(result.cached, false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).etag, '"etag-9"');

  fs.writeFileSync(file, JSON.stringify({ notes: 'not-an-array', fetchedAt: 1 }), 'utf8');
  const second = await getNotes();
  assert.equal(second.cached, false);
  assert.equal(second.notes.length, 2, '无效缓存被 200 响应覆盖');
});
