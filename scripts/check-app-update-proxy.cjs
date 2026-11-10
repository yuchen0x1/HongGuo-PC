const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const file = path.resolve(__dirname, '../main.js'), req = createRequire(file);
const app = new EventEmitter();
Object.assign(app, { isPackaged: true, getVersion: () => '6.6.0', getPath: () => '/synthetic', commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) });
function networkSession() { return { calls: [], closed: 0, async setProxy(options) { this.calls.push(options); }, async closeAllConnections() { this.closed++; } }; }
const windowSession = networkSession();
let updaterRequires = 0;
const settings = { proxy_enabled: true, proxy_mode: 'custom', proxy_host: '127.0.0.1', proxy_port: 7890, proxy_username: 'fixture', proxy_password: 'synthetic-password' };
const handlers = {};
const electron = { app, session: { defaultSession: windowSession }, ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, protocol: { registerSchemesAsPrivileged() {} } };
const context = vm.createContext({ require: name => name === 'electron' ? electron : name === 'electron-updater' ? (updaterRequires++, { autoUpdater: new EventEmitter() }) : name === './src/store' ? { setErrorHandler() {}, getSettings: () => settings } : req(name), __dirname: path.dirname(file), process: { ...process, env: { ...process.env } }, Buffer, URL, AbortController, setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} } });
vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
(async () => {
  await context.applyProxySettings(settings);
  assert.equal(windowSession.calls.at(-1).proxyRules, 'http://127.0.0.1:7890');
  assert.equal(windowSession.closed, 1, 'proxy changes discard old window connections');

  let credentials, prevented = false;
  app.emit('login', { preventDefault() { prevented = true; } }, null, null,
    { isProxy: true, host: '127.0.0.1', port: 7890 }, (...args) => { credentials = args; });
  assert.equal(prevented, true);
  assert.deepEqual(credentials, ['fixture', 'synthetic-password']);
  for (const challenge of [{ isProxy: false, host: '127.0.0.1', port: 7890 }, { isProxy: true, host: 'evil.invalid', port: 7890 }, { isProxy: true, host: '127.0.0.1', port: 8888 }]) {
    credentials = undefined;
    app.emit('login', { preventDefault() { throw Error('unrelated challenge must not be intercepted'); } }, null, null, challenge, (...args) => { credentials = args; });
    assert.equal(credentials, undefined);
  }
  assert.equal(JSON.stringify(windowSession.calls).includes('synthetic-password'), false);

  await context.applyProxySettings({ proxy_enabled: false });
  assert.equal(windowSession.calls.at(-1).mode, 'direct');
  await context.applyProxySettings({ proxy_enabled: true, proxy_mode: 'system' });
  assert.equal(windowSession.calls.at(-1).mode, 'system');
  const callCount = windowSession.calls.length;
  await context.applyProxySettings({ proxy_enabled: true, proxy_mode: 'system' });
  assert.equal(windowSession.calls.length, callCount, 'unchanged proxy settings do not interrupt connections');
  assert.equal(updaterRequires, 0, 'update checks do not load electron-updater');
  for (const channel of ['download-app-update', 'cancel-app-update', 'install-app-update']) assert.equal(handlers[channel], undefined);
  console.log('PASS update proxy: app session settings and auth work without electron-updater');
})().catch(error => { console.error(error); process.exitCode = 1; });
