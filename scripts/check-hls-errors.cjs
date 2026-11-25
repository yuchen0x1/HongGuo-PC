// Offline HLS error fixtures only; no media playback, network or account data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { remuxHls } = require('../src/native/hls-media');

const analysis = path.resolve(__dirname, '../.local/analysis');
fs.mkdirSync(analysis, { recursive: true });
const root = fs.mkdtempSync(path.join(analysis, 'hls-errors-'));
const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nmedia.m3u8\n';
const media = '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:2,\npart.ts\n#EXT-X-ENDLIST\n';
const response = (url, body, status = 200, headers = {}) => ({
  status, headers, url, data: Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)]),
});
const request = async url => response(url, url.endsWith('/master.m3u8') ? master
  : url.endsWith('/media.m3u8') ? media : Buffer.alloc(url.endsWith('/key') ? 16 : 32));
let nextOutput = 0;
const run = (override, options = {}) => remuxHls({
  url: 'https://fixture.example/master.m3u8', output: path.join(root, `${++nextOutput}.mp4`),
  ffmpeg: process.execPath, request: override || request, ...options,
});
const checks = [];
const test = (name, fn) => checks.push([name, fn]);
const rejects = (promise, check) => assert.rejects(promise, error => { check(error); return true; });

for (const status of [403, 404, 500]) {
  for (const [target, pathname] of [['manifest', '/master.m3u8'], ['nested manifest', '/media.m3u8'],
    ['segment', '/part.ts'], ['key', '/key']]) {
    test(`${target} HTTP ${status} preserves the actual stage and status`, async () => {
      const stage = target.includes('manifest') ? 'manifest' : 'segment';
      await rejects(run((url, args) => new URL(url).pathname === pathname
        ? response(url, '', status) : request(url, args)), error => {
        assert.equal(error.stage, stage);
        assert.equal(error.code, stage === 'manifest' ? 'HLS_MANIFEST_FAILED' : 'HLS_SEGMENT_FAILED');
        assert.equal(error.mediaStatus, status);
        assert.equal(error.httpStatus, status);
        assert.equal(error.message, 'HLS 媒体请求失败或内容不完整');
      });
    });
  }
}

for (const [stage, pathname, code, status] of [['manifest', '/media.m3u8', 'ERR_BAD_REQUEST', 404],
  ['segment', '/part.ts', 'ERR_BAD_RESPONSE', 500]]) {
  test(`Axios ${stage} rejection keeps its code, response and message`, async () => {
    const upstream = { status };
    const original = Object.assign(new Error('upstream rejected the fixture request'), { code, response: upstream, status });
    await rejects(run((url, args) => new URL(url).pathname === pathname
      ? Promise.reject(original) : request(url, args)), error => {
      assert.equal(error, original);
      assert.equal(error.code, code);
      assert.equal(error.stage, stage);
      assert.equal(error.response, upstream);
      assert.equal(error.status, status);
      assert.equal(error.httpStatus, status);
      assert.equal(error.mediaStatus, status);
      assert.equal(error.message, 'upstream rejected the fixture request');
    });
  });
}

test('invalid nested manifest reports manifest parsing instead of its parent resource', async () => {
  await rejects(run((url, args) => url.endsWith('/media.m3u8')
    ? response(url, '<html>not a playlist</html>') : request(url, args)), error => {
    assert.equal(error.stage, 'manifest');
    assert.equal(error.code, 'HLS_MANIFEST_FAILED');
    assert.equal(error.message, '无效 HLS 清单');
  });
});

test('incomplete manifest retains manifest stage', async () => {
  await rejects(run((url, args) => url.endsWith('/media.m3u8')
    ? response(url, media, 200, { 'content-length': '99999' }) : request(url, args)), error => {
    assert.equal(error.stage, 'manifest');
    assert.equal(error.code, 'HLS_MANIFEST_FAILED');
    assert.equal(error.message, 'HLS 清单下载不完整');
  });
});

test('a manifest cycle is diagnosed at the manifest stage', async () => {
  await rejects(run(url => response(url, master.replace('media.m3u8', 'master.m3u8'))), error => {
    assert.equal(error.stage, 'manifest');
    assert.equal(error.code, 'HLS_MANIFEST_FAILED');
    assert.equal(error.message, 'HLS 清单循环引用');
  });
});

for (const body of [Buffer.alloc(0), Buffer.from('partial')]) {
  test(`${body.length ? 'truncated' : 'empty'} nested segment stays segment through parent manifests`, async () => {
    await rejects(run((url, args) => url.endsWith('/part.ts')
      ? response(url, body, 200, { 'content-length': '99999' }) : request(url, args)), error => {
      assert.equal(error.stage, 'segment');
      assert.equal(error.code, 'HLS_SEGMENT_FAILED');
      assert.equal(error.message, 'HLS 分片下载不完整');
    });
  });
}

test('an invalid key length is a resource failure rather than a parent manifest failure', async () => {
  await rejects(run((url, args) => url.endsWith('/key')
    ? response(url, Buffer.alloc(15)) : request(url, args)), error => {
    assert.equal(error.stage, 'segment');
    assert.equal(error.code, 'HLS_SEGMENT_FAILED');
    assert.equal(error.message, 'HLS 密钥长度无效');
  });
});

test('a nested explicit stage is never overwritten by a parent manifest', async () => {
  const original = Object.assign(new Error('nested resource failed'), {
    stage: 'segment', code: 'HLS_SEGMENT_FAILED', response: { status: 403 },
  });
  await rejects(run(() => Promise.reject(original)), error => {
    assert.equal(error, original);
    assert.equal(error.stage, 'segment');
    assert.equal(error.code, 'HLS_SEGMENT_FAILED');
    assert.equal(error.httpStatus, 403);
    assert.equal(error.mediaStatus, 403);
  });
});

test('a network timeout retains its transport code and actual resource stage', async () => {
  const original = Object.assign(new Error('fixture request timed out'), { code: 'ETIMEDOUT' });
  await rejects(run((url, args) => url.endsWith('/part.ts')
    ? Promise.reject(original) : request(url, args)), error => {
    assert.equal(error, original);
    assert.equal(error.code, 'ETIMEDOUT');
    assert.equal(error.stage, 'segment');
  });
});

for (const code of ['LOCAL_MEDIA_TOOL_ERROR', 'ENOSPC', 'EACCES']) {
  test(`${code} is not relabeled as an HLS transport failure`, async () => {
    const original = Object.assign(new Error('local fixture failure'), { code });
    await rejects(run(() => Promise.reject(original)), error => {
      assert.equal(error, original);
      assert.equal(error.code, code);
      assert.equal(error.stage, undefined);
    });
  });
}

test('local staging capacity failures retain their original meaning', async () => {
  await rejects(run(request, { tempCapacityBytes: 1 }), error => {
    assert.match(error.message, /空间不足/);
    assert.equal(error.code, undefined);
    assert.equal(error.stage, undefined);
  });
});

test('revoking provider access does not become a manifest or segment network failure', async () => {
  const original = new Error('source disabled');
  let allowed = true;
  await rejects(run(async (url, args) => {
    const result = await request(url, args);
    if (url.endsWith('/part.ts')) allowed = false;
    return result;
  }, { checkAccess: () => { if (!allowed) throw original; } }), error => {
    assert.equal(error, original);
    assert.equal(error.code, undefined);
    assert.equal(error.stage, undefined);
  });
});

test('the public-address guard remains intact for nested resources', async () => {
  await rejects(run((url, args) => url.endsWith('/media.m3u8')
    ? response(url, media.replace('part.ts', 'http://127.0.0.1/blocked.ts')) : request(url, args)), error => {
    assert.equal(error.code, 'ERR_WEB_MEDIA_ADDRESS');
    assert.equal(error.stage, undefined);
  });
});

test('unsupported encryption remains rejected before resource loading', async () => {
  let resources = 0;
  await rejects(run((url, args) => {
    if (url.endsWith('/media.m3u8')) return response(url, media.replace('METHOD=AES-128', 'METHOD=SAMPLE-AES'));
    if (!url.endsWith('/master.m3u8')) resources++;
    return request(url, args);
  }), error => {
    assert.equal(error.message, '不支持该 HLS 加密方式');
    assert.equal(error.stage, 'manifest');
  });
  assert.equal(resources, 0);
});

test('external cancellation keeps cancellation semantics and clears staged files', async () => {
  const controller = new AbortController();
  await rejects(run((url, args) => {
    if (!url.endsWith('/part.ts')) return request(url, args);
    return new Promise((resolve, reject) => {
      args.signal.addEventListener('abort', () => reject(new Error('cancelled by fixture')), { once: true });
      controller.abort();
    });
  }, { signal: controller.signal }), error => {
    assert.match(error.message, /取消|cancel/i);
    assert.equal(error.code, undefined);
    assert.equal(error.stage, undefined);
  });
});

(async () => {
  let failures = 0;
  for (const [name, check] of checks) {
    try { await check(); console.log('PASS ' + name); }
    catch (error) { failures++; console.error('FAIL ' + name + ': ' + error.stack); }
    assert.deepEqual(fs.readdirSync(root), [], 'each failed preparation must remove all staged files');
  }
  process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error.stack); process.exitCode = 1; })
  .finally(() => fs.rmSync(root, { recursive: true, force: true }));
