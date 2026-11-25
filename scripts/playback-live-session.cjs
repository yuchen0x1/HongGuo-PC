// Local interactive account regression. Credentials stay in the isolated Electron profile.
// Usage: node scripts/playback-live-session.cjs start|restart|qr|status|check|parallel-check|history|probe|play-check|logout|screenshot|stop
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const directory = path.join(ROOT, 'dist', 'playback-live-session');
const stateFile = path.join(directory, 'state.json');
const sleep = ms => new Promise(done => setTimeout(done, ms));
let phase = 'initialization';

function validateState(state) {
  if (state.port !== 9463 || !Number.isInteger(state.pid) || state.pid <= 0
      || path.dirname(path.resolve(state.profile || '')) !== path.resolve(os.tmpdir())
      || !path.basename(state.profile).startsWith('hongguo-playback-account-')) {
    throw new Error('Unexpected isolated profile');
  }
  return state;
}

function isRunning(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function stopSession(state) {
  if (!isRunning(state.pid)) return;
  const client = await connect(state.port);
  try {
    await client.evaluate(`(async () => {
      clearInterval(window.__playbackLoginPoll);
      const saved = await window.electronAPI.saveSettings({ close_to_tray: false });
      if (saved?.success === false) throw new Error('Isolated settings could not be saved');
      setTimeout(() => window.electronAPI.windowClose(), 100);
      return true;
    })()`);
  } finally { client.close(); }
  for (let attempt = 0; attempt < 75; attempt++) {
    if (!isRunning(state.pid)) return;
    await sleep(200);
  }
  throw new Error('Isolated application has not exited');
}

async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find(item => item.type === 'page' && item.url.startsWith('file:'));
  if (!target) throw new Error('Isolated app renderer unavailable');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error || message.result?.exceptionDetails) entry.reject(new Error('Desktop evaluation failed'));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Desktop operation timed out')); }, 60000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => socket.close(), evaluate: async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })).result.value };
}

async function main() {
  const command = process.argv[2] || 'status';
  phase = command;
  fs.mkdirSync(directory, { recursive: true });
  const previous = fs.existsSync(stateFile)
    ? validateState(JSON.parse(fs.readFileSync(stateFile, 'utf8'))) : null;
  if (command === 'start' || command === 'restart') {
    if (previous) {
      if (command === 'restart') await stopSession(previous);
      else {
        try { const client = await connect(previous.port); client.close(); console.log(JSON.stringify({ running: true, port: previous.port })); return; } catch {}
        if (isRunning(previous.pid)) throw new Error('Existing isolated application is not ready');
      }
    }
    const port = 9463;
    const profile = previous?.profile || fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-playback-account-'));
    const downloadRoot = path.join(profile, 'independent-downloads');
    fs.mkdirSync(downloadRoot, { recursive: true });
    if (!previous) fs.writeFileSync(path.join(profile, 'data.json'), JSON.stringify({ settings: { root: downloadRoot,
      close_to_tray: false, app_updates_enabled: false, watch_updates_enabled: false,
      watch_sequels_enabled: false, watch_notifications_enabled: false } }));
    const env = { ...process.env };
    for (const name of ['ELECTRON_RUN_AS_NODE', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[name];
    const child = spawn(require('electron'), [ROOT, '--mute-audio', `--user-data-dir=${profile}`,
      '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`],
    { cwd: ROOT, env, windowsHide: true, detached: true, stdio: 'ignore' });
    child.unref();
    fs.writeFileSync(stateFile, JSON.stringify({ port, profile, pid: child.pid, startedAt: new Date().toISOString() }));
    for (let i = 0; i < 100; i++) {
      try { const client = await connect(port); client.close(); console.log(JSON.stringify({ running: true, port, profile, audioMuted: true })); return; } catch {}
      await sleep(200);
    }
    throw new Error('Isolated app did not open');
  }
  const state = previous;
  if (!state) throw new Error('Start the isolated application first');
  if (command === 'stop') {
    await stopSession(state);
    console.log(JSON.stringify({ closed: true, profilePreserved: true }));
    return;
  }
  const client = await connect(state.port);
  try {
    if (command === 'qr') {
      await client.evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === '登录账号');
        button?.click();
      })()`);
      await sleep(400);
      const qr = await client.evaluate('window.electronAPI.startAccountLogin()');
      if (!qr?.success || !/^data:image\/png;base64,/.test(qr.image || '')) {
        console.log(JSON.stringify({ success: false, error: qr?.error || 'QR unavailable' })); return;
      }
      const file = path.join(directory, 'login-qr.png');
      fs.writeFileSync(file, Buffer.from(qr.image.split(',')[1], 'base64'));
      // Poll using the existing account service. The helper retains no Cookie or login token on disk.
      await client.evaluate(`(() => {
        clearInterval(window.__playbackLoginPoll);
        const poll = async () => {
          const result = await window.electronAPI.pollAccountLogin(${JSON.stringify(qr.loginId)});
          if (result.status === 'signed-in' || result.status === 'expired' || !result.success) {
            window.__playbackLoginPollResult = {success: result.success, status: result.status, error: result.error};
            return;
          }
          window.__playbackLoginPoll = setTimeout(poll, 1500);
        };
        window.__playbackLoginPoll = setTimeout(poll, 1500);
      })()`);
      console.log(JSON.stringify({ success: true, qr: file, expiresIn: qr.expiresIn, audioMuted: true }));
    } else if (command === 'status') {
      const result = await client.evaluate(`(async () => {
        const result = await window.electronAPI.getAccountStatus();
        return { success: result.success, signedIn: result.signedIn, sessionValidity: result.sessionValidity,
          lastErrorCode: result.lastErrorCode, deviceAssociation: result.deviceAssociation,
          poll: window.__playbackLoginPollResult };
      })()`);
      console.log(JSON.stringify(result));
    } else if (command === 'probe') {
      const result = await client.evaluate('window.electronAPI.testPlaybackConnection({authorizationProbe:true})');
      const file = path.join(directory, 'authorization-report.json');
      fs.writeFileSync(file, JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
    } else if (command === 'check') {
      const result = await client.evaluate('window.electronAPI.checkPlaybackAccount()');
      const diagnostics = result?.diagnostics || {};
      const evidence = { success: result?.success === true, accountState: diagnostics.accountState,
        sessionValidity: diagnostics.sessionValidity, faultCode: result?.faultCode || '',
        encryptedSessionPresent: fs.existsSync(path.join(state.profile, 'account-session.bin')) };
      fs.writeFileSync(path.join(directory, 'account-restart-report.json'), JSON.stringify(evidence, null, 2));
      console.log(JSON.stringify(evidence));
    } else if (command === 'parallel-check') {
      const result = await client.evaluate(String.raw`(async () => {
        const checks = await Promise.all(Array.from({ length: 8 }, () => window.electronAPI.checkPlaybackAccount()));
        const snapshot = await window.electronAPI.getPlaybackDiagnostics();
        const serialized = JSON.stringify(snapshot);
        return { concurrentChecks: checks.length, allValid: checks.every(check => check?.success === true
          && check.diagnostics?.accountState === 'signed-in' && check.diagnostics?.sessionValidity === 'valid'),
          diagnostics: snapshot,
          noCredentialFields: !/"(?:cookie|ck|password|token|device_id|install_id|cdid|signature|mediaUrl)"\s*:/i.test(serialized),
          noUrls: !/https?:\/\//i.test(serialized) };
      })()`);
      fs.writeFileSync(path.join(directory, 'account-parallel-report.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ concurrentChecks: result.concurrentChecks, allValid: result.allValid,
        noCredentialFields: result.noCredentialFields, noUrls: result.noUrls }));
      if (!result.allValid || !result.noCredentialFields || !result.noUrls) process.exitCode = 1;
    } else if (command === 'play-check') {
      phase = 'playback-window-activation';
      await client.send('Page.bringToFront');
      await client.evaluate('window.electronAPI.setAlwaysOnTop(true)');
      if (!await client.evaluate('!document.hidden')) throw new Error('Isolated playback window is not visible');
      phase = 'playback-navigation';
      const before = await client.evaluate(`(async () => {
        const account = await window.electronAPI.getAccountStatus();
        localStorage.setItem('hongguo:playback-preferences', JSON.stringify({ rate:1, volume:0, muted:true }));
        localStorage.setItem('hongguo:online-quality', 'auto');
        window.__accountMediaSilenceViolations = 0;
        window.__accountPlaybackNavigation = { started:false, metadataVideo:null };
        window.__accountMediaObserver?.disconnect();
        const seen = new WeakSet();
        const observe = () => document.querySelectorAll('video').forEach(video => {
          if (seen.has(video)) return;
          seen.add(video); video.muted = true; video.volume = 0;
          video.addEventListener('volumechange', () => {
            if (!video.muted || video.volume !== 0) window.__accountMediaSilenceViolations++;
          });
          video.addEventListener('loadedmetadata', () => {
            if (window.__accountPlaybackNavigation.started) window.__accountPlaybackNavigation.metadataVideo = video;
          });
        });
        window.__accountMediaObserver = new MutationObserver(observe);
        window.__accountMediaObserver.observe(document.documentElement, { childList:true, subtree:true });
        observe();
        const resolved = await window.electronAPI.hongguoResolve('7706512650816982040');
        if (!resolved?.success) return { resolved:false };
        window.__accountPlaybackNavigation.started = true;
        const navigation = await window.electronAPI.playSeries({ seriesId:'7706512650816982040', vidIndex:1, resume:false });
        return { resolved:true, navigated:navigation?.success === true,
          signedIn:account?.signedIn === true, sessionValidity:account?.sessionValidity };
      })()`);
      if (!before.resolved || !before.navigated) throw new Error('Actual source navigation failed');
      phase = 'playback-first-frame';
      const snapshot = `(() => {
        const video = document.querySelector('.player-video');
        return video ? { time:video.currentTime, duration:video.duration, paused:video.paused,
          navigationMetadataSeen:window.__accountPlaybackNavigation.metadataVideo === video,
          muted:video.muted, volume:video.volume, readyState:video.readyState,
          width:video.videoWidth, height:video.videoHeight, errorCode:video.error?.code || 0,
          decodedFrames:video.getVideoPlaybackQuality().totalVideoFrames,
          silenceViolations:window.__accountMediaSilenceViolations } : null;
      })()`;
      let first;
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        const value = await client.evaluate(snapshot);
        if (value?.navigationMetadataSeen && value.readyState >= 2 && value.width > 0
          && value.decodedFrames > 0 && !value.paused && !value.errorCode) {
          first = value; break;
        }
        await sleep(200);
      }
      if (!first) throw new Error('Actual account-state video did not decode');
      phase = 'playback-continuation';
      await sleep(3200);
      const last = await client.evaluate(snapshot);
      const diagnostics = await client.evaluate('window.electronAPI.getPlaybackDiagnostics()');
      const report = { checkedAt:new Date().toISOString(), windowActivated:true,
        version:diagnostics.diagnostics?.appVersion, ...before,
        sourceRoute:diagnostics.diagnostics?.sourceRoute, routeId:diagnostics.diagnostics?.routeId,
        firstFrame:first, continued:last,
        passed:!!last && !last.paused && !last.errorCode && last.time > first.time + 2
          && last.decodedFrames > first.decodedFrames && last.muted && last.volume === 0
          && last.silenceViolations === 0 && Math.abs(last.duration - 178.966) < 0.15 };
      fs.writeFileSync(path.join(directory, before.signedIn ? 'account-playback-report.json' : 'logout-playback-report.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
      if (!report.passed) process.exitCode = 1;
    } else if (command === 'logout') {
      const result = await client.evaluate(`(async () => {
        const logout = await window.electronAPI.logoutAccount();
        const status = await window.electronAPI.getAccountStatus();
        return { success: logout?.success === true, signedIn: status?.signedIn === true,
          sessionValidity: status?.sessionValidity, lastErrorCode: status?.lastErrorCode || '' };
      })()`);
      const evidence = { ...result, encryptedSessionRemoved: !fs.existsSync(path.join(state.profile, 'account-session.bin')) };
      fs.writeFileSync(path.join(directory, 'account-logout-report.json'), JSON.stringify(evidence, null, 2));
      console.log(JSON.stringify(evidence));
      if (!evidence.success || evidence.signedIn || !evidence.encryptedSessionRemoved) process.exitCode = 1;
    } else if (command === 'history') {
      const result = await client.evaluate(`(async () => {
        const result = await window.electronAPI.getAccountHistory({ refresh: true });
        return { success: result?.success === true, signedIn: result?.signedIn === true,
          sessionValidity: result?.sessionValidity, count: Array.isArray(result?.results) ? result.results.length : 0,
          faultCode: result?.lastErrorCode || '', error: result?.success === false ? result.error : undefined };
      })()`);
      fs.writeFileSync(path.join(directory, 'account-history-report.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
    } else if (command === 'screenshot') {
      const file = path.join(directory, 'desktop.png');
      const image = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(image.data, 'base64')); console.log(file);
    } else throw new Error('Unknown command');
  } finally { client.close(); }
}
main().catch(error => {
  const safeReasons = new Set(['Unexpected isolated profile', 'Isolated settings could not be saved',
    'Isolated application has not exited', 'Isolated app renderer unavailable', 'Desktop evaluation failed',
    'Desktop operation timed out', 'Existing isolated application is not ready', 'Isolated app did not open',
    'Start the isolated application first', 'Isolated playback window is not visible',
    'Actual source navigation failed', 'Actual account-state video did not decode', 'Unknown command']);
  console.error(JSON.stringify({ passed:false, phase,
    reason:safeReasons.has(error?.message) ? error.message : 'Isolated regression failed; inspect this phase locally' }));
  process.exitCode = 1;
});
