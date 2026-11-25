const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createPlaybackManager } = require('./playback-manager');

const CODE = 'DRM_UNSUPPORTED';
const MESSAGE = '本集返回受保护或加密片源，请使用官方授权播放器。';

function native(dependencies) {
  const filename = require.resolve('./hongguo');
  const localRequire = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : localRequire(name),
    Buffer, URL, URLSearchParams, AbortController, AbortSignal, process: { env: {} },
    console: { warn() {} }, setTimeout, clearTimeout,
  }, { filename });
  return module.exports;
}

function fixture() {
  const calls = [];
  const app = native({ axios: {
    get: async () => { calls.push('web'); throw Object.assign(new Error('PRIVATE_SIGNED_URL'), { code: 'ETIMEDOUT' }); },
    post: async () => assert.fail('protected playback must not request another API'),
  }, './app-source': { fetchAppPlayUrl: async () => {
    calls.push('app');
    throw Object.assign(new Error('PRIVATE_SIGNED_URL token=PRIVATE_TOKEN'), { code: CODE,
      contentKey: 'PRIVATE_KEY', headers: { Cookie: 'PRIVATE_COOKIE' } });
  } } });
  return { app, calls };
}

function assertProtected(result) {
  assert.equal(result.url, null);
  assert.equal(result.code, CODE);
  assert.equal(result.faultCode, undefined);
  assert.equal(result.error, MESSAGE);
  assert.equal(result.sources.at(-1).code, CODE);
  assert.equal(result.sources.at(-1).message, MESSAGE);
  assert.equal(result.routeTrace.at(-1).code, CODE);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|token=|Cookie|contentKey/);
}

test('a protected App response survives web-first aggregate errors without becoming a network or account fault', async () => {
  const f = fixture();
  assertProtected(await f.app.fetchPlayUrlSingle('456', '123'));
  assert.deepEqual(f.calls, ['web', 'web', 'app']);
});

test('a protected App response stops the last-resort website route while web is deprioritized', async () => {
  const f = fixture();
  f.app.markWebMediaFailure({ source: 'web', vid: '456' });
  const result = await f.app.fetchPlayUrlSingle('456', '123');
  assertProtected(result);
  assert.equal(result.routeTrace[0].status, 'skipped');
  assert.deepEqual(f.calls, ['app']);
});

test('protected media does not trigger lower-quality fallback or another provider ladder', async () => {
  for (const quality of ['1080p', '720p']) {
    const f = fixture();
    assertProtected(await f.app.fetchPlayUrlSingle('456', '123', { quality, allowLowerQuality: true }));
    assert.deepEqual(f.calls, ['app']);
  }
});

test('a protected-media result stops the playback manager without scheduling automatic recovery', async () => {
  let calls = 0;
  const events = [];
  const manager = createPlaybackManager({ diagnostics: { record: event => events.push(event) },
    resolve: async () => {
      calls++;
      return { url: null, code: CODE, error: MESSAGE,
        sources: [{ source: 'web', code: 'TIMEOUT' }, { source: 'app', code: CODE }] };
    } });
  const result = await manager.resolve('456', '123');
  assert.equal(result.code, CODE);
  assert.equal(result.faultCode, undefined);
  assert.equal(result.error, MESSAGE);
  assert.equal(calls, 1);
  assert.equal(events.filter(event => event.event === 'recovery').length, 0);
});
