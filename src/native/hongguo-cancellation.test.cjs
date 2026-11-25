const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function loadNative(name, dependencies = {}, globals = {}) {
  const filename = require.resolve(`./${name}`);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, Buffer, URL, URLSearchParams, AbortSignal, AbortController,
    process: { env: {} }, console, setTimeout, clearTimeout,
    require: dependency => Object.hasOwn(dependencies, dependency)
      ? dependencies[dependency] : localRequire(dependency),
    ...globals,
  }, { filename });
  return module.exports;
}

test('cancel then synchronously resolve the same episode starts fresh without a recovery delay', { timeout: 2000 }, async () => {
  const waits = [];
  const manager = loadNative('playback-manager', {}, {
    setTimeout(callback, delay, ...args) {
      waits.push(delay);
      return setTimeout(callback, delay, ...args);
    },
  });
  const calls = [];
  let entered;
  const firstStarted = new Promise(resolve => { entered = resolve; });
  const playable = {
    url: 'https://v3-reading.qznovelvod.com/cancellation-fixture.mp4',
    source: 'app', vid: '12345', codec: 'h264', width: 1080, height: 1920,
  };
  const native = loadNative('hongguo', {
    './playback-manager': manager,
    './app-source': {
      async fetchAppPlayUrl(vid, options) {
        calls.push({ vid, signal: options.signal, abortedAtDispatch: options.signal.aborted });
        if (calls.length > 1) return playable;
        entered();
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('Synthetic transport cancelled'), { code: 'ERR_CANCELED' }));
          }, { once: true });
        });
      },
    },
    axios: {
      get() { assert.fail('The fixed-quality regression must not contact a web endpoint'); },
      post() { assert.fail('The fixed-quality regression must not contact another API'); },
    },
  });
  const controller = new AbortController();
  const options = { quality: '1080p' };
  const first = native.fetchPlayUrlSingle(playable.vid, '67890', { ...options, signal: controller.signal });
  await firstStarted;

  // Start B before A's rejection/finally microtasks can clear the source cache.
  controller.abort();
  const second = native.fetchPlayUrlSingle(playable.vid, '67890', options);
  const [cancelled, result] = await Promise.all([first, second]);

  assert.equal(cancelled.code, 'ERR_CANCELED');
  assert.equal(result.url, playable.url);
  assert.equal(calls.length, 2, 'A and B must each dispatch exactly one transport request');
  assert.equal(calls[0].signal.aborted, true, 'A must propagate cancellation to its transport');
  assert.equal(calls[1].abortedAtDispatch, false, 'B must receive a fresh live signal');
  assert.notEqual(calls[0].signal, calls[1].signal);
  assert.deepEqual(waits, [], 'B must not inherit A and schedule the 500ms recovery retry');

  const cached = await native.fetchPlayUrlSingle(playable.vid, '67890', options);
  assert.equal(cached.url, playable.url);
  assert.equal(calls.length, 2, 'B must populate the successful cache after A is cancelled');
});
