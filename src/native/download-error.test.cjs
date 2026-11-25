const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { downloadErrorDetails } = require('./download-error');

test('transport details contain only allowlisted codes, status and source identities', () => {
  const marker = 'credential-must-not-leak';
  const error = Object.assign(new Error(`Authorization: Bearer ${marker}`), {
    code: 'SOURCE_UNAVAILABLE',
    faultCode: 'API_FORBIDDEN',
    status: 403,
    config: { headers: { Cookie: marker } },
    cause: new Error(`https://cdn.example/?token=${marker}`),
    sources: [{ source: 'web', code: 'HTTP_403', message: marker, url: marker },
      { source: marker, code: 'HTTP_503' }, { source: 'app', code: marker }],
  });
  const details = downloadErrorDetails(error);
  assert.equal(details.code, 'SOURCE_UNAVAILABLE');
  assert.equal(details.status, 403);
  assert.equal(details.faultCode, 'API_FORBIDDEN');
  assert.deepEqual(details.sources, [{ source: 'web', code: 'HTTP_403' }]);
  assert.doesNotMatch(JSON.stringify(details), /credential|Bearer|Cookie|cdn\.example|token=/);
  assert.match(details.message, /HTTP 403/);
});

test('diagnostic fields reject objects without coercion or retaining their original properties', () => {
  let coercions = 0;
  const marker = 'credential-must-not-leak';
  const wrapped = value => ({ token: marker, toString() { coercions++; return value; }, valueOf() { coercions++; return value; } });
  const details = downloadErrorDetails({
    code: wrapped('ECONNRESET'), faultCode: wrapped('ACCOUNT_EXPIRED'),
    mediaStatus: wrapped(503), status: '403', response: { status: wrapped(401) },
    sources: [
      { source: wrapped('web'), code: 'HTTP_403' },
      { source: 'app', code: wrapped('HTTP_403') },
    ],
  });
  assert.equal(coercions, 0);
  assert.deepEqual(Object.keys(details), ['message']);
  assert.doesNotMatch(JSON.stringify(details), /credential|token|ECONNRESET|ACCOUNT_EXPIRED|HTTP_403/);
  let sourceReads = 0;
  const changingSource = { get source() { return ++sourceReads === 1 ? 'web' : wrapped('web'); }, code: 'HTTP_403' };
  assert.deepEqual(downloadErrorDetails({ sources: [changingSource] }).sources, [{ source: 'web', code: 'HTTP_403' }]);
  assert.equal(sourceReads, 1, 'only the checked primitive source may reach the result');
});

test('unclassified remote text is not exposed and fixed local causes remain useful', () => {
  assert.doesNotMatch(JSON.stringify(downloadErrorDetails({ message: 'sessionid=secret', code: 'secret', status: 'secret' })), /secret/);
  assert.equal(downloadErrorDetails({ code: 'ENOSPC', message: 'E:\\private\\video.mp4' }).code, 'ENOSPC');
  assert.match(downloadErrorDetails({ code: 'ENOSPC' }).message, /磁盘空间/);
  assert.match(downloadErrorDetails({ code: 'CERT_HAS_EXPIRED', message: 'https://private/?token=secret' }).message, /TLS.*CERT_HAS_EXPIRED/);
  const message = '已有本地文件实际为 720P（720×1280），不满足 1080P；文件已保留，如需重新下载请先自行移除本地文件';
  assert.equal(downloadErrorDetails({ message }).message, message);
  assert.doesNotMatch(downloadErrorDetails({ message: `${message} Cookie=secret` }).message, /Cookie|secret/);
  assert.match(downloadErrorDetails({ message: '未知任务类型: token=secret' }).message, /任务类型无效/);
});

test('fixed locked-episode and detached NAS causes remain useful without allowing extra remote text', () => {
  const messages = [
    '该集已锁定',
    '该集已锁定，请在来源平台解锁',
    '第 12 集当前锁定，请在西饭官方 App 确认可看范围',
    '第  集当前锁定，请在西饭官方 App 确认可看范围',
    'NAS 目录不可用，请重新挂载共享文件夹后重试',
    'NAS 目录不可用或挂载已变化，已保留文件和任务记录',
  ];
  for (const message of messages) {
    assert.equal(downloadErrorDetails({ message }).message, message);
    for (const suffix of [' Cookie=sessionid=secret', ' token=secret', ' https://cdn.example/?signature=secret']) {
      const details = downloadErrorDetails({ message: `${message}${suffix}` });
      assert.doesNotMatch(JSON.stringify(details), /Cookie|sessionid=|secret|cdn\.example|signature=/);
      assert.notEqual(details.message, `${message}${suffix}`);
    }
  }
  assert.doesNotMatch(downloadErrorDetails({
    message: '第 token=secret 集当前锁定，请在西饭官方 App 确认可看范围',
  }).message, /token=|secret/);
});

test('website episode unavailability keeps a safe fixed download reason ahead of App empty responses', () => {
  const code = 'WEB_EPISODE_UNAVAILABLE';
  for (const error of [{ code }, { faultCode: code }, { code: 'SOURCE_UNAVAILABLE',
    sources: [{ source: 'app', code: 'EMPTY_RESPONSE' }, { source: 'web', code, message: 'Cookie=secret' }] }]) {
    const details = downloadErrorDetails({ ...error, message: 'https://signed.invalid/?token=secret' });
    assert.equal(details.faultCode, code);
    assert.match(details.message, /^官网当前播放入口不提供本集，请在官方客户端查看可用播放方式。/);
    assert.doesNotMatch(JSON.stringify(details), /登录|扫码|付费|DRM|无权|权限|Cookie|token=|secret|signed\.invalid/);
  }
});

test('the actual queue failure boundary never logs or persists a raw transport error', async () => {
  const main = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  const start = main.indexOf('async function runTask(task) {');
  const end = main.indexOf('// 保留旧名', start);
  assert.ok(start > 0 && end > start);
  const marker = 'credential-must-not-leak';
  const failure = Object.assign(new Error(`request failed https://cdn.example/video.mp4?signature=${marker}`), {
    code: 'ECONNRESET',
    config: { url: `https://cdn.example/?token=${marker}`, headers: { Cookie: `sessionid=${marker}` } },
    response: { status: 503, data: { token: marker } },
  });
  const logs = [], saved = [], events = [];
  const task = { id: 'fixture', status: 'pending', savePath: 'fixture.mp4' };
  const context = vm.createContext({
    executeDownload: async () => { throw failure; },
    downloadErrorDetails,
    console: { error: (...args) => logs.push(args) },
    persistDownloadTasksQuietly: () => saved.push({ ...task }),
    sendToRenderer: (channel, payload) => events.push({ channel, ...payload }),
    activeDownloads: 1, runningDownloads: new Set([task.id]), runningDownloadPaths: new Set([task.savePath]),
    normalizePathKey: value => value, downloadRuns: new Map(), pumpQueue() {},
  });
  vm.runInContext(`${main.slice(start, end)}; globalThis.runTask = runTask;`, context);
  await context.runTask(task);
  const observed = JSON.stringify({ logs, saved, events });
  assert.equal(observed.includes(marker), false);
  assert.doesNotMatch(observed, /cdn\.example|sessionid=|signature=/);
  assert.equal(task.status, 'failed');
  assert.match(task.error, /ECONNRESET|CDN_UNAVAILABLE/);
  assert.match(task.error, /503/);
  assert.equal(context.activeDownloads, 0);
});

test('the actual download failure and automatic retry boundaries persist only the safe message', async () => {
  const main = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  const start = main.indexOf('async function executeHongguoDownload(task) {');
  const end = main.indexOf('// 向渲染进程发送事件', start);
  assert.ok(start > 0 && end > start);
  for (const retry of [false, true]) {
    const marker = 'credential-must-not-leak';
    const failure = Object.assign(new Error(`Cookie: sessionid=${marker}`), {
      code: 'ECONNRESET', config: { url: `https://cdn.example/?signature=${marker}` },
    });
    const task = { id: 'fixture', status: 'pending', hongguoInfo: {} };
    const saved = [], events = [], timers = [];
    const context = vm.createContext({
      axios: { CancelToken: { source: () => ({ token: {} }) }, isCancel: () => false },
      getCurrentSettings: () => { throw failure; },
      downloadErrorDetails, isDeferrableSourceError: () => retry,
      SOURCE_RETRY_DELAYS: [180000], TRANSFER_RETRY_DELAYS: [10000],
      armSourceRetry: value => timers.push(value.retryAt),
      persistDownloadTasksQuietly: () => saved.push({ ...task }),
      sendToRenderer: (channel, payload) => events.push({ channel, ...payload }),
    });
    vm.runInContext(`${main.slice(start, end)}; globalThis.download = executeHongguoDownload;`, context);
    await context.download(task);
    const observed = JSON.stringify({ saved, events });
    assert.equal(observed.includes(marker), false);
    assert.doesNotMatch(observed, /cdn\.example|sessionid=|signature=/);
    assert.match(task.error, /ECONNRESET/);
    assert.equal(task.status, 'failed');
    assert.equal(timers.length, retry ? 1 : 0);
    if (retry) assert.match(task.error, /10 秒后自动重试（1\/1）/);
  }
});
