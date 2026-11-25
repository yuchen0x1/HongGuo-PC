const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const sourceFile = path.join(__dirname, 'catalog.js');
const page = title => `<script>window._ROUTER_DATA=${JSON.stringify({ loaderData: { category: {
  isSuccess: true, categoryRoute: { contentType: 'real-drama' },
  recommendList: [{ series_id: '1234567', series_name: title }],
} } })}</script>`;

function fixture() {
  const requests = [];
  const context = {
    module: { exports: {} }, Buffer, URL, AbortController, setTimeout, clearTimeout,
    require: name => {
      if (name === 'electron') return { net: { request: () => {
        const request = new EventEmitter();
        const record = { kind: 'net', request, aborted: false };
        request.abort = () => { record.aborted = true; };
        request.end = () => { requests.push(record); };
        return request;
      } } };
      if (name === 'axios') return { get: (_url, { signal }) => new Promise((resolve, reject) => {
        const record = { kind: 'dns', signal, resolve };
        requests.push(record);
        signal.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })), { once: true });
      }) };
      if (name === './web-media-guard') return { webMediaRequestOptions: () => ({}) };
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(sourceFile, 'utf8'), context, { filename: sourceFile });
  const respond = (index, title) => {
    const response = new EventEmitter();
    response.statusCode = 200; response.headers = {};
    requests[index].request.emit('response', response);
    response.emit('data', Buffer.from(page(title)));
    response.emit('end');
  };
  return { ...context.module.exports, requests, respond };
}

test('pre-cancelled catalog diagnostics do not open a request', async () => {
  const f = fixture(), controller = new AbortController();
  controller.abort();
  const result = await f.browseList({ signal: controller.signal });
  assert.equal(result.success, false);
  assert.equal(result.code, 'ERR_CANCELED');
  assert.equal(f.requests.length, 0);
});

test('cancelling an isolated diagnostic aborts only its own transport', async () => {
  const f = fixture(), controller = new AbortController();
  const normal = f.browseList(), shared = f.browseList();
  const diagnostic = f.browseList({ forceRefresh: true, signal: controller.signal });
  assert.equal(f.requests.length, 2, 'diagnostics must not join or replace a pending UI request');
  controller.abort();
  assert.equal((await diagnostic).code, 'ERR_CANCELED');
  assert.equal(f.requests[1].aborted, true);
  assert.equal(f.requests[0].aborted, false);
  f.respond(0, 'UI catalog');
  assert.equal((await normal).results[0].series_title, 'UI catalog');
  assert.equal((await shared).results[0].series_title, 'UI catalog');
  assert.equal((await f.browseList()).results[0].series_title, 'UI catalog');
  assert.equal(f.requests.length, 2, 'ordinary concurrent requests and cache remain shared');
});

test('late responses from a cancelled diagnostic cannot populate the shared cache', async () => {
  const f = fixture(), controller = new AbortController();
  const diagnostic = f.browseList({ signal: controller.signal });
  controller.abort();
  assert.equal((await diagnostic).code, 'ERR_CANCELED');
  f.respond(0, 'Cancelled catalog');
  const normal = f.browseList();
  assert.equal(f.requests.length, 2);
  f.respond(1, 'Fresh catalog');
  assert.equal((await normal).results[0].series_title, 'Fresh catalog');
});

test('diagnostics bypass the UI cache without replacing it on success', async () => {
  const f = fixture(), controller = new AbortController();
  const normal = f.browseList();
  f.respond(0, 'UI catalog'); await normal;
  const diagnostic = f.browseList({ signal: controller.signal });
  assert.equal(f.requests.length, 2, 'a connection test must execute its own network request');
  f.respond(1, 'Diagnostic catalog');
  assert.equal((await diagnostic).results[0].series_title, 'Diagnostic catalog');
  assert.equal((await f.browseList()).results[0].series_title, 'UI catalog');
  assert.equal(f.requests.length, 2);
});

test('cancelling a diagnostic terminates both Chromium and trusted DNS routes', async () => {
  const f = fixture(), controller = new AbortController();
  const diagnostic = f.browseList({ signal: controller.signal, allowTrustedDns: true });
  assert.equal(f.requests.length, 2);
  controller.abort();
  assert.equal((await diagnostic).code, 'ERR_CANCELED');
  assert.equal(f.requests.find(request => request.kind === 'net').aborted, true);
  assert.equal(f.requests.find(request => request.kind === 'dns').signal.aborted, true);
});
