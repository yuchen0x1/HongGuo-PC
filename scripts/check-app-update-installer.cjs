const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { availableRelease } = require('../src/native/app-update');
const { createUpdateInstaller } = require('../src/native/app-update-installer');
const { MacUpdater } = require('electron-updater/out/MacUpdater');
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
const notice = fs.readFileSync(path.join(__dirname, '../src/components/AppUpdateNotice.jsx'), 'utf8');

function fixture() {
  const updater = new EventEmitter();
  let enabled = true, blocker = '', checks = 0, downloads = 0, installs = 0;
  let finishCheck, finishDownload;
  const token = { cancelled: false, cancel() { this.cancelled = true; } };
  updater.setFeedURL = feed => { updater.feed = feed; };
  updater.checkForUpdates = () => { checks++; return new Promise(resolve => { finishCheck = (version = '1.81.0') => resolve({ updateInfo: { version }, cancellationToken: token }); }); };
  updater.downloadUpdate = received => { downloads++; assert.equal(received, token); return new Promise((resolve, reject) => { finishDownload = error => {
    if (error) { updater.emit('error', error); reject(error); }
    else { updater.emit('update-downloaded', { version: '1.81.0' }); resolve(['/synthetic/update.zip']); }
  }; }); };
  updater.quitAndInstall = () => { installs++; };
  const events = [];
  const controller = createUpdateInstaller({ updater, currentVersion: '1.80.0', isEnabled: () => enabled, installBlocker: () => blocker, emit: state => events.push(state) });
  return { updater, controller, events, token, checked: version => finishCheck(version), downloaded: error => finishDownload(error), counts: () => ({ checks, downloads, installs }), enable: value => { enabled = value; }, block: value => { blocker = value; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function macFixture() {
  const f = fixture(), native = new EventEmitter();
  let checks = 0, quits = 0;
  f.updater.nativeUpdater = native;
  f.updater.squirrelDownloadedUpdate = false;
  f.updater.autoRunAppAfterInstall = true;
  f.updater.closeServerIfExists = () => {};
  f.updater.handleUpdateDownloaded = MacUpdater.prototype.handleUpdateDownloaded;
  f.updater.quitAndInstall = MacUpdater.prototype.quitAndInstall;
  native.on('error', error => f.updater.emit('error', error));
  native.on('update-downloaded', () => { f.updater.squirrelDownloadedUpdate = true; });
  native.checkForUpdates = () => { checks++; };
  native.quitAndInstall = () => { quits++; };
  return { ...f, native, nativeCounts: () => ({ checks, quits }), ready: async () => {
    const pending = f.controller.download('1.81'); f.checked(); await tick(); f.downloaded();
    assert.equal((await pending).success, true);
  } };
}

assert.equal(availableRelease({ tag_name: 'v6.7', draft: false, prerelease: false }, '6.6.0')?.version, '6.7', '6.6 clients must recognize 6.7 as newer');
assert.equal(availableRelease({ tag_name: 'v6.6', draft: false, prerelease: false }, '6.6.0'), null, 'same version is not an update');
assert.equal(availableRelease({ tag_name: 'v6.7-beta.1', draft: false, prerelease: false }, '6.6.0'), null, 'prerelease tags are rejected');
assert.doesNotMatch(main, /electron-updater|appUpdateInstaller|download-app-update|cancel-app-update|install-app-update/);
assert.doesNotMatch(preload, /downloadAppUpdate|cancelAppUpdate|installAppUpdate|onAppUpdateState/);
assert.match(notice, /打开下载页/);
assert.match(notice, /请先退出应用，再下载并运行唯一安装包/);

(async () => {
const f = fixture();
assert.equal(f.updater.autoDownload, false);
assert.equal(f.updater.autoInstallOnAppQuit, false);
assert.equal(f.updater.allowDowngrade, false);
assert.equal(f.updater.allowPrerelease, false);
assert.equal(f.updater.disableWebInstaller, true);
assert.equal(f.updater.disableDifferentialDownload, true);
assert.equal(f.updater.feed.provider, 'github');
assert.equal(f.updater.feed.owner, 'yuchen0x1');
assert.equal(f.updater.feed.repo, 'HongGuo-PC');
assert.equal(f.controller.install().success, false);
const first = f.controller.download('1.81');
const duplicate = f.controller.download('1.81');
assert.equal(f.counts().checks, 1);
f.checked(); await tick();
assert.equal(f.counts().downloads, 1);
f.updater.emit('download-progress', { percent: 46.7 });
assert.equal(f.controller.getState().percent, 46);
f.downloaded();
assert.equal((await first).success, true);
assert.equal((await duplicate).success, true);
assert.equal(f.controller.getState().status, 'downloaded');
assert.equal(f.counts().installs, 0);
f.block('请先暂停下载');
assert.equal(f.controller.install().success, false);
f.block('');
assert.equal(f.controller.install().success, true);
assert.equal(f.controller.install().success, false);
await tick(); assert.equal(f.counts().installs, 1);
f.updater.emit('error', Error('PRIVATE_NATIVE_DIAGNOSTIC'));
assert.equal(f.controller.getState().status, 'error');
assert.ok(!f.controller.getState().error.includes('PRIVATE_NATIVE_DIAGNOSTIC'));

for (const version of ['1.80.0', '1.79.0', '1.82.0', '1.81.0-beta.1']) {
  const sample = fixture(), pending = sample.controller.download('1.81');
  sample.checked(version);
  assert.equal((await pending).success, false, version);
  assert.equal(sample.counts().downloads, 0);
}
const failure = fixture(), pending = failure.controller.download('1.81');
failure.checked(); await tick(); failure.downloaded(Error('sha512 mismatch: PRIVATE_URL'));
assert.equal((await pending).success, false);
assert.equal(failure.controller.install().success, false);
assert.equal(failure.counts().installs, 0);
assert.ok(!JSON.stringify(failure.events).includes('PRIVATE_URL'));

const disabled = fixture(); disabled.enable(false);
assert.equal((await disabled.controller.download('1.81')).success, false);
assert.equal(disabled.counts().checks, 0);
const cancelled = fixture(), operation = cancelled.controller.download('1.81');
cancelled.enable(false); cancelled.controller.cancel(); cancelled.checked();
assert.equal((await operation).success, false);
assert.equal(cancelled.counts().downloads, 0);
assert.equal(cancelled.controller.getState().status, 'idle');
const inFlight = fixture(), downloading = inFlight.controller.download('1.81');
inFlight.checked(); await tick(); inFlight.enable(false); inFlight.controller.cancel();
assert.equal(inFlight.token.cancelled, true);
inFlight.downloaded();
assert.equal((await downloading).success, false);
assert.equal(inFlight.controller.getState().status, 'idle');
assert.equal(inFlight.controller.install().success, false);

const manual = fixture(), oldDownload = manual.controller.download('1.81');
manual.checked(); await tick();
assert.equal(manual.controller.cancel()?.success, true);
assert.equal(manual.token.cancelled, true);
const retry = manual.controller.download('1.81');
manual.updater.emit('download-progress', { percent: 99 });
manual.updater.emit('update-downloaded', { version: '1.81.0' });
assert.equal(manual.controller.getState().status, 'idle');
assert.equal(manual.controller.install().success, false);
assert.equal(manual.counts().checks, 1);
manual.downloaded(Error('cancelled'));
assert.equal((await oldDownload).success, false); await tick();
assert.equal(manual.counts().checks, 2);
manual.checked(); await tick();
manual.updater.emit('update-downloaded', { version: '1.81.0' });
assert.equal(manual.controller.getState().status, 'downloading');
assert.equal(manual.controller.install().success, false);
manual.downloaded(); assert.equal((await retry).success, true);
assert.equal(manual.controller.getState().status, 'downloaded');

const queued = fixture(), checking = queued.controller.download('1.81');
queued.controller.cancel();
const queuedRetry = queued.controller.download('1.81');
queued.controller.cancel(); queued.checked();
assert.equal((await checking).success, false); await tick();
assert.equal(queued.counts().checks, 1);
assert.equal((await queuedRetry).success, false);
assert.equal(queued.token.cancelled, true);

const mac = macFixture();
await mac.ready(); mac.controller.install(); await tick();
assert.equal(mac.nativeCounts().quits, 0);
mac.native.emit('error', Error('native preparation failed'));
assert.equal(mac.controller.getState().status, 'error');
await mac.ready(); mac.controller.install(); await tick();
mac.native.emit('update-downloaded');
assert.equal(mac.nativeCounts().checks, 2);
assert.equal(mac.nativeCounts().quits, 1);

const blockedMac = macFixture();
await blockedMac.ready(); blockedMac.controller.install(); await tick();
blockedMac.block('正在保存设置'); blockedMac.native.emit('update-downloaded');
assert.equal(blockedMac.nativeCounts().quits, 0);
assert.equal(blockedMac.controller.getState().status, 'downloaded');
blockedMac.block(''); blockedMac.controller.install(); await tick();
assert.equal(blockedMac.nativeCounts().checks, 1);
assert.equal(blockedMac.nativeCounts().quits, 1);
const cancelledMac = macFixture();
await cancelledMac.ready(); cancelledMac.controller.install(); await tick();
cancelledMac.enable(false); cancelledMac.controller.cancel();
cancelledMac.native.emit('update-downloaded');
assert.equal(cancelledMac.nativeCounts().quits, 0);
assert.equal(cancelledMac.controller.getState().status, 'idle');
const throwingMac = macFixture();
await throwingMac.ready();
throwingMac.native.checkForUpdates = () => { throw Error('native preparation unavailable'); };
throwingMac.controller.install(); await tick(); throwingMac.native.emit('update-downloaded');
assert.equal(throwingMac.controller.getState().status, 'error');
assert.equal(throwingMac.nativeCounts().quits, 0);

const syncFailure = fixture(); let syncChecks = 0;
syncFailure.updater.checkForUpdates = () => { syncChecks++; throw Error('synchronous check failure'); };
assert.equal((await syncFailure.controller.download('1.81')).success, false);
assert.equal((await syncFailure.controller.download('1.81')).success, false);
assert.equal(syncChecks, 2);
console.log('PASS update installer legacy safety regressions plus simplified 6.6 to 6.7 delivery checks');
})().catch(error => { console.error(error); process.exitCode = 1; });
