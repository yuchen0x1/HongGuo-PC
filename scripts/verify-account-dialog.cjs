// Actual anonymous playback failure and existing account dialog. No scan or saved account.
// node scripts/verify-account-dialog.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { safeCode } = require('../src/native/playback-diagnostics');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'dist/account-dialog-live');
const SERIES = '7706512650816982040';
const EPISODE = '7706514645208534041';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const report = { schema: 1, startedAt: new Date().toISOString(), passed: false,
  scope: 'production anonymous App source failure and existing account QR dialog',
  isolation: { temporaryProfile: true, independentDownloads: true, audioMuted: true,
    forbiddenDebugPort: 9463, existingAccountProfileAccessed: false, credentialsExported: false,
    qrImageRedactedBeforeScreenshot: true }, checks: {}, screenshots: [] };
let profile, child, client, phase = 'prepare';

async function until(operation, description, budget = 20000) {
  const deadline = Date.now() + budget;
  do {
    const value = await operation();
    if (value) return value;
    await sleep(200);
  } while (Date.now() < deadline);
  throw new Error(description);
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Isolated debugger connection failed')), { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error || message.result?.exceptionDetails) entry.reject(new Error('Isolated desktop operation failed'));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Isolated desktop operation timed out')); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, evaluate: async expression => (await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  })).result.value, close() {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Isolated debugger closed')); }
    pending.clear(); socket.close();
  } };
}

async function click(selector) {
  const point = await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return null;
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = element.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  assert.ok(point, 'A production control was unavailable');
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}

async function resize(width, height) {
  await client.evaluate(`window.resizeTo(${width}, ${height})`);
  await until(() => client.evaluate(`Math.abs(innerWidth - ${width}) <= 8 && Math.abs(innerHeight - ${height}) <= 40`),
    'The actual Electron window did not resize', 5000);
  await sleep(150);
}

async function screenshot(filename) {
  assert.equal(await client.evaluate(`(() => {
    const images = [...document.querySelectorAll('.account-qr img')];
    return images.length > 0 && images.every(image => getComputedStyle(image).visibility === 'hidden');
  })()`), true, 'The login QR must be hidden before any screenshot leaves the renderer');
  const image = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUTPUT, filename), Buffer.from(image.data, 'base64'));
  report.screenshots.push(filename);
}

async function measure(theme, narrow) {
  const state = await client.evaluate(`(() => {
    const dialog = document.querySelector('.account-playback-login-dialog');
    const privacy = dialog?.querySelector('.account-privacy-notice');
    const image = dialog?.querySelector('.account-qr img');
    if (!dialog || !privacy || !image) return null;
    const box = dialog.getBoundingClientRect();
    const text = privacy.textContent;
    const children = [...dialog.querySelectorAll('button,p,h2,h3,.account-qr')];
    const horizontalOverflow = dialog.scrollWidth > dialog.clientWidth + 1 || children.some(element => {
      const r = element.getBoundingClientRect();
      return r.width > 0 && (r.left < box.left - 1 || r.right > box.right + 1 || element.scrollWidth > element.clientWidth + 1);
    });
    const close = dialog.querySelector('[aria-label="关闭登录窗口"]');
    return { theme: document.documentElement.dataset.theme, width: innerWidth, height: innerHeight,
      dialogWidth: Math.round(box.width), dialogHeight: Math.round(box.height),
      contained: box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
      horizontalOverflow, verticallyScrollable: dialog.scrollHeight > dialog.clientHeight + 1,
      privacyStatementPresent: ['本机','系统加密','退出登录','卸载','清除'].every(word => text.includes(word)),
      qrActuallyLoaded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
      dialogCount: document.querySelectorAll('.account-playback-login-dialog').length,
      closeEnabled: !!close && !close.disabled,
      dialogBackground: getComputedStyle(dialog).backgroundColor,
      textColor: getComputedStyle(dialog).color };
  })()`);
  assert.ok(state, 'The existing login dialog content was incomplete');
  assert.equal(state.theme, theme);
  assert.equal(state.contained, true, 'The login dialog exceeded the viewport');
  assert.equal(state.horizontalOverflow, false, 'Login text or controls overflowed horizontally');
  assert.equal(state.privacyStatementPresent, true, 'The account privacy statement was missing');
  assert.equal(state.qrActuallyLoaded, true, 'The production account QR did not load');
  assert.equal(state.dialogCount, 1, 'Multiple account dialogs appeared');
  assert.equal(state.closeEnabled, true);
  if (narrow) assert.ok(state.width <= 440, 'Narrow acceptance requires a real narrow Electron window');
  return state;
}

async function launch() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-account-dialog-'));
  const downloads = path.join(profile, 'independent-downloads');
  fs.mkdirSync(downloads);
  fs.writeFileSync(path.join(profile, 'data.json'), JSON.stringify({
    settings: { root: downloads, close_to_tray: false, app_updates_enabled: false,
      watch_updates_enabled: false, watch_sequels_enabled: false, watch_notifications_enabled: false,
      auto_delete_watched: false, cache_next_episode: false, proxy_mode: 'direct', proxy_enabled: false },
    tasks: [], playback: {}, mergeTasks: [],
    series: [{ series_id: SERIES, series_title: '少夫人来自东北3', total: 1, cover: '',
      episodes: [{ vid: EPISODE, vid_index: 1, locked: false, web_available: true }], updatedAt: Date.now() }],
  }));
  const env = { ...process.env };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[name];
  child = spawn(require('electron'), [ROOT, '--mute-audio', `--user-data-dir=${profile}`,
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
  { cwd: ROOT, env, windowsHide: true, stdio: 'ignore' });
  const activePort = path.join(profile, 'DevToolsActivePort');
  await until(() => child.exitCode === null && fs.existsSync(activePort), 'The isolated Electron debugger did not start', 30000);
  const port = Number(fs.readFileSync(activePort, 'utf8').split(/\r?\n/)[0]);
  assert.ok(Number.isInteger(port) && port > 0 && port !== 9463, 'Forbidden or invalid debugger port');
  const target = await until(async () => {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) })).json();
      return pages.find(page => page.type === 'page' && page.url.startsWith('file:'));
    } catch { return null; }
  }, 'The production application renderer did not start', 30000);
  client = await connect(target);
  await until(() => client.evaluate('Boolean(window.electronAPI && document.querySelector(".app-layout"))'), 'The production application was not ready');
  await until(() => client.evaluate('!document.querySelector(".splash-screen")'), 'The production startup overlay did not finish', 15000);
  await client.send('Page.bringToFront');
  await client.evaluate(`(() => {
    localStorage.setItem('hongguo:online-quality', '1080p');
    localStorage.setItem('hongguo:playback-preferences', JSON.stringify({ muted: true, volume: 0, rate: 1 }));
    const style = document.createElement('style');
    style.textContent = '.account-qr img { visibility: hidden !important; } .account-qr { position: relative; } .account-qr::after { content: "QR hidden for privacy"; position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: min(232px, 100%); height: 232px; display: grid; place-items: center; background: #fff; color: #333; border: 1px solid #ddd; box-sizing: border-box; border-radius: 4px; }';
    document.head.append(style);
    window.__accountDialogVerification = { openings: 0, maxConcurrent: 0, previouslyOpen: false, silenceViolations: 0 };
    const observe = () => {
      const state = window.__accountDialogVerification;
      const count = document.querySelectorAll('.account-playback-login-dialog').length;
      if (count && !state.previouslyOpen) state.openings++;
      state.previouslyOpen = count > 0;
      state.maxConcurrent = Math.max(state.maxConcurrent, count);
      document.querySelectorAll('video').forEach(video => {
        if (video.dataset.dialogSilenceObserved) return;
        video.dataset.dialogSilenceObserved = 'true'; video.muted = true; video.volume = 0;
        video.addEventListener('volumechange', () => { if (!video.muted || video.volume !== 0) state.silenceViolations++; });
      });
    };
    new MutationObserver(observe).observe(document.documentElement, { childList: true, subtree: true });
    observe(); return true;
  })()`);
  const info = await client.evaluate('window.electronAPI.getAppInfo()');
  report.appVersion = /^\d+\.\d+\.\d+$/.test(info?.version || '') ? info.version : 'unknown';
  const account = await client.evaluate('(async () => { const value = await window.electronAPI.getAccountStatus(); return { signedIn: value.signedIn === true, anonymous: value.sessionValidity === "anonymous" }; })()');
  assert.equal(account.signedIn, false);
  assert.equal(account.anonymous, true);
  assert.equal(await client.evaluate('document.documentElement.dataset.theme'), 'light', 'A new profile must default to light');
  report.checks.defaultLightTheme = true;
}

async function verifyTheme(theme) {
  phase = `${theme}-window-layout`;
  await click('.layout-toggle');
  await until(() => client.evaluate('document.querySelector(".app-layout")?.classList.contains("layout-portrait")'), 'Production portrait layout did not activate');
  await resize(1100, 850);
  phase = `${theme}-anonymous-playback-failure`;
  const result = await client.evaluate(`window.electronAPI.playSeries({ seriesId: '${SERIES}', vidIndex: 1, resume: false })`);
  assert.equal(result?.success, true, 'Production playback navigation failed');
  await until(() => client.evaluate('Boolean(document.querySelector(".account-playback-login-dialog"))'),
    'Anonymous production source failure did not open the existing login dialog', 90000);
  assert.equal(await client.evaluate('document.querySelector(".player-online-quality-row select")?.value'), '1080p');
  await until(() => client.evaluate('Boolean(document.querySelector(".account-playback-login-dialog .account-qr img")?.naturalWidth)'),
    'The production QR request did not complete', 25000);
  const diagnostics = await client.evaluate('window.electronAPI.getPlaybackDiagnostics()');
  assert.equal(diagnostics?.diagnostics?.stage, 'source', 'The popup must follow a source failure');
  assert.equal(diagnostics?.diagnostics?.lastErrorCode, 'API_EMPTY_RESPONSE', 'The live App response changed; do not fabricate the expected failure');
  report.checks[`${theme}SourceFailure`] = { stage: 'source', faultCode: safeCode(diagnostics.diagnostics.lastErrorCode),
    route: diagnostics.diagnostics.sourceRoute === 'app' ? 'app' : 'unknown', automaticDialog: true };
  phase = `${theme}-wide-dialog`;
  report.checks[`${theme}Wide`] = await measure(theme, false);
  await screenshot(`${theme}-wide.png`);
  await resize(420, 620);
  phase = `${theme}-narrow-dialog`;
  report.checks[`${theme}Narrow`] = await measure(theme, true);
  await screenshot(`${theme}-narrow.png`);
  const privacyReachable = await client.evaluate(`(() => {
    const privacy = document.querySelector('.account-playback-login-dialog .account-privacy-notice');
    privacy.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = privacy.getBoundingClientRect(), d = privacy.closest('[role="dialog"]').getBoundingClientRect();
    return r.top >= d.top && r.bottom <= d.bottom;
  })()`);
  assert.equal(privacyReachable, true, 'The narrow dialog privacy statement must be reachable by scrolling');
  await screenshot(`${theme}-narrow-privacy.png`);
  report.checks[`${theme}PrivacyReachable`] = true;
  await client.evaluate('document.querySelector(".account-playback-login-dialog").scrollTop = 0');
  phase = `${theme}-close-and-no-reopen`;
  await click('.account-playback-login-dialog [aria-label="关闭登录窗口"]');
  await until(() => client.evaluate('!document.querySelector(".account-playback-login-dialog")'), 'The production close control did not dismiss the dialog');
  const openings = await client.evaluate('window.__accountDialogVerification.openings');
  await sleep(2500);
  assert.equal(await client.evaluate('document.querySelectorAll(".account-playback-login-dialog").length'), 0);
  assert.equal(await client.evaluate('window.__accountDialogVerification.openings'), openings, 'The cancelled login dialog reopened automatically');
  report.checks[`${theme}CloseWithoutReopen`] = true;
  await resize(620, 850);
  await click('.layout-toggle');
  await until(() => client.evaluate('document.querySelector(".app-layout")?.classList.contains("layout-landscape")'), 'Production landscape layout did not restore');
}

async function stop() {
  if (client) {
    try { await client.evaluate('(() => { setTimeout(() => window.electronAPI.windowClose(), 50); return true; })()'); } catch {}
    client.close(); client = null;
  }
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    const deadline = Date.now() + 15000;
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(100);
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGKILL');
      await until(() => child.exitCode !== null || child.signalCode !== null, 'The isolated app did not stop', 10000);
    }
  }
  child = null;
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  phase = 'production-launch'; await launch();
  await verifyTheme('light');
  phase = 'production-dark-theme-setting';
  await click('.sidebar-item[aria-label="设置"]');
  await until(() => client.evaluate('Boolean(document.querySelector("#appearance-theme"))'), 'The production appearance settings did not load');
  await client.evaluate(`(() => {
    const select = document.querySelector('#appearance-theme');
    select.value = 'dark'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await until(() => client.evaluate('document.documentElement.dataset.theme === "dark"'), 'The production dark theme setting did not apply');
  await verifyTheme('dark');
  const observation = await client.evaluate('window.__accountDialogVerification');
  assert.equal(observation.openings, 2, 'There must be exactly one automatic prompt per deliberate play attempt');
  assert.equal(observation.maxConcurrent, 1);
  assert.equal(observation.silenceViolations, 0);
  report.checks.dialogLifecycle = { automaticPrompts: observation.openings, maxConcurrent: observation.maxConcurrent,
    silenceViolations: observation.silenceViolations, noDuplicatePrompts: true };
  assert.equal(fs.existsSync(path.join(profile, 'account-session.bin')), false, 'Anonymous QR verification must not create saved login credentials');
  assert.deepEqual(fs.readdirSync(path.join(profile, 'independent-downloads')), [], 'Dialog verification must not write downloads');
  report.checks.noAccountSavedOrDownloadsCreated = true;
  report.passed = true;
}

main().catch(error => {
  report.failedPhase = phase;
  report.failure = error.message;
  process.exitCode = 1;
}).finally(async () => {
  try { await stop(); }
  catch { report.passed = false; report.cleanupFailed = true; process.exitCode = 1; }
  if (profile && !child) {
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('hongguo-account-dialog-'));
    fs.rmSync(profile, { recursive: true, force: true });
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUTPUT, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});
