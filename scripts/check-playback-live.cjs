// Actual Electron/media acceptance. Supply complete official episodes, never generated video.
// node scripts/check-playback-live.cjs --manifest manifest.json --output-dir dist/playback-live
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
};
let output = path.resolve(option('--output-dir') || path.join(ROOT, 'dist', 'playback-live'));
const report = { schema: 1, startedAt: new Date().toISOString(), passed: false,
  scope: 'production Electron player with independently supplied official complete media',
  officialNetworkResolutionTested: false, accountAuthenticationTested: false, checks: {} };
let profile;
let child;
let client;
let debuggingPort;
let applicationExecutable;
let phase = 'manifest';

function check(value, message) { assert.ok(value, message); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function applicationEvidence() {
  return applicationExecutable ? { packaged: true, executable: path.relative(ROOT, applicationExecutable),
    executableSha256: sha256(applicationExecutable),
    appAsarSha256: sha256(path.join(path.dirname(applicationExecutable), 'resources', 'app.asar')) }
    : { packaged: false };
}
function tool(name) {
  const override = process.env[name === 'ffmpeg' ? 'HONGGUO_FFMPEG' : 'HONGGUO_FFPROBE'];
  return override || path.join(ROOT, 'build', 'ffmpeg', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
}
function runTool(executable, parameters) {
  const result = spawnSync(executable, parameters, { windowsHide: true, encoding: 'utf8', timeout: 180000,
    maxBuffer: 4 * 1024 * 1024 });
  check(!result.error && result.status === 0, 'Real media validation command failed');
  return result.stdout;
}

function readManifest() {
  const filename = option('--manifest');
  check(filename, 'Supply --manifest with real official episode metadata');
  const supplied = JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
  let document = supplied;
  if (Number.isSafeInteger(supplied.selectedRandomlyFrom) && supplied.selectedRandomlyFrom > 1 && supplied.episodes?.[0]?.episodeId) {
    const first = supplied.episodes[0];
    check(supplied.episodes.every(episode => episode.seriesId === first.seriesId && episode.source === 'web'
      && episode.profileId === 'hongguo-official-web-public-v1' && episode.routeId === 'official-web-public-fallback'),
    'Random provenance must describe the same official public series');
    document = { seriesId: first.seriesId, title: first.title, selection: 'random', source: 'official-public-complete',
      episodes: supplied.episodes.map(episode => ({ vid: episode.episodeId, index: episode.episodeIndex,
        title: '', file: episode.file, sha256: episode.sha256, officialDuration: episode.duration })) };
    report.inputProvenance = { selectedRandomlyFrom: supplied.selectedRandomlyFrom,
      episodes: supplied.episodes.map(episode => ({ episodeId: episode.episodeId, source: episode.source,
        profileId: episode.profileId, routeId: episode.routeId, requestMs: episode.elapsedMs, downloadedAt: episode.downloadedAt })) };
  }
  check(/^\d+$/.test(String(document.seriesId)), 'A real official series ID is required');
  check(typeof document.title === 'string' && document.title.trim(), 'A real series title is required');
  check(['development', 'random'].includes(document.selection), 'Record development or random selection');
  check(document.source === 'official-public-complete', 'Only verified complete official public media is accepted');
  check(Array.isArray(document.episodes) && document.episodes.length > 0, 'Supply at least one complete episode');
  const indexes = new Set(), ids = new Set(), hashes = new Set();
  const episodes = document.episodes.map(episode => {
    check(/^\d+$/.test(String(episode.vid)), 'A real official episode ID is required');
    check(Number.isSafeInteger(episode.index) && episode.index > 0, 'Supply a real positive episode index');
    check(!indexes.has(episode.index) && !ids.has(String(episode.vid)), 'Episode identities must be distinct');
    check(Number.isFinite(episode.officialDuration) && episode.officialDuration > 15, 'Supply the verified official complete duration');
    check(/^[a-f0-9]{64}$/i.test(episode.sha256 || ''), 'Supply the verified media SHA-256');
    const file = path.resolve(path.dirname(path.resolve(filename)), episode.file || '');
    check(fs.statSync(file).isFile() && fs.statSync(file).size > 100 * 1024, 'The complete media file is missing');
    const hash = sha256(file);
    check(hash === episode.sha256.toLowerCase(), 'The media SHA-256 does not match provenance');
    check(!hashes.has(hash), 'Duplicating one media file does not constitute episode continuation');
    const probe = JSON.parse(runTool(tool('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
    const video = probe.streams.find(stream => stream.codec_type === 'video');
    const duration = Number(probe.format?.duration);
    check(video && Number.isFinite(duration), 'The supplied media has no valid video stream');
    check(Math.abs(duration - episode.officialDuration) <= 0.15, 'The media is shorter than the verified complete episode');
    runTool(tool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-xerror', '-i', file,
      '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-']);
    indexes.add(episode.index); ids.add(String(episode.vid)); hashes.add(hash);
    return { vid: String(episode.vid), index: episode.index, title: String(episode.title || ''), file,
      sha256: hash, officialDuration: episode.officialDuration, duration, codec: video.codec_name,
      width: video.width, height: video.height, bytes: fs.statSync(file).size, wholeEpisodeDecode: 'passed' };
  }).sort((a, b) => a.index - b.index);
  if (episodes.length > 1) check(episodes[1].index === episodes[0].index + 1, 'Supply consecutive real episodes for continuation');
  if (args.includes('--require-continuation')) check(episodes.length > 1, 'Two distinct complete episodes are required');
  report.selection = document.selection;
  report.series = { id: String(document.seriesId), title: document.title };
  report.media = episodes.map(({ file, ...publicEvidence }) => publicEvidence);
  return { seriesId: String(document.seriesId), title: document.title, selection: document.selection, episodes };
}

function prepareProfile(manifest) {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-player-live-'));
  const downloads = path.join(profile, 'independent-downloads');
  fs.mkdirSync(downloads);
  const now = Date.now();
  const tasks = manifest.episodes.map(episode => {
    const filename = `episode-${episode.index}.mp4`;
    const savePath = path.join(downloads, filename);
    fs.copyFileSync(episode.file, savePath, fs.constants.COPYFILE_EXCL);
    check(sha256(savePath) === episode.sha256, 'Independent fixture copy failed verification');
    return { id: `live-${episode.vid}`, status: 'completed', progress: 100, startTime: now,
      savePath, customDir: downloads, filename, totalSize: episode.bytes, downloadedSize: episode.bytes,
      hongguoInfo: { series_id: manifest.seriesId, series_title: manifest.title, vid: episode.vid,
        vid_index: episode.index, ep_title: episode.title }, videoInfo: { cover: '' } };
  });
  fs.writeFileSync(path.join(profile, 'data.json'), JSON.stringify({ settings: { root: downloads,
    close_to_tray: false, app_updates_enabled: false, watch_updates_enabled: false,
    watch_sequels_enabled: false, watch_notifications_enabled: false, cache_next_episode: false,
    auto_delete_watched: false, picture_in_picture_mode: 'custom', compat_mode: false,
    proxy_mode: 'direct', proxy_enabled: false }, tasks, playback: {}, mergeTasks: [],
  series: [{ series_id: manifest.seriesId, series_title: manifest.title, cover: '', total: tasks.length,
    episodes: manifest.episodes.map(episode => ({ vid: episode.vid, vid_index: episode.index,
      title: episode.title, locked: false, web_available: true })), updatedAt: now, dismissed: false }] }));
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
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error || message.result?.exceptionDetails) entry.reject(new Error('Isolated desktop operation failed'));
    else entry.resolve(message.result);
  });
  const send = (method, parameters = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Isolated desktop operation timed out')); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params: parameters }));
  });
  return { send, close: () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Debugger closed')); }
    pending.clear(); socket.close();
  }, evaluate: async expression => (await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  })).result.value };
}

async function waitFor(operation, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await operation();
    if (value) return value;
    await sleep(200);
  } while (Date.now() < deadline);
  throw new Error(description);
}

async function launch() {
  const activePort = path.join(profile, 'DevToolsActivePort');
  try { fs.unlinkSync(activePort); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[key];
  child = spawn(applicationExecutable || require('electron'), [...(applicationExecutable ? [] : [ROOT]), '--mute-audio', `--user-data-dir=${profile}`,
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], {
    cwd: ROOT, env, windowsHide: true, stdio: 'ignore',
  });
  await waitFor(() => {
    check(child.exitCode === null, 'The isolated application exited before readiness');
    return fs.existsSync(activePort);
  }, 'The isolated debugger did not start', 30000);
  const port = Number(fs.readFileSync(activePort, 'utf8').split(/\r?\n/)[0]);
  check(Number.isInteger(port) && port > 0 && port !== 9463, 'The isolated debugger port is invalid');
  debuggingPort = port;
  const target = await waitFor(async () => {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) })).json();
      return targets.find(item => item.type === 'page' && item.url.startsWith('file:'));
    } catch { return null; }
  }, 'The production renderer did not start', 30000);
  client = await connect(target);
  await waitFor(() => client.evaluate('Boolean(window.electronAPI && document.querySelector(".app-layout"))'),
    'The production application did not become ready');
  await client.send('Page.bringToFront');
  await client.evaluate('window.electronAPI.setAlwaysOnTop(true)');
  await client.evaluate(`(() => {
    localStorage.setItem('hongguo:playback-preferences', JSON.stringify({ rate: 1, volume: 0, muted: true }));
    localStorage.setItem('hongguo:online-quality', 'auto');
    window.__liveMedia = { frames: 0, firstFrame: false, silenceViolations: 0, errors: [], ended: 0, events: [] };
    window.__liveVideos = new WeakSet();
    const observe = () => document.querySelectorAll('video').forEach(video => {
      if (window.__liveVideos.has(video)) return;
      window.__liveVideos.add(video);
      video.muted = true; video.volume = 0;
      video.addEventListener('volumechange', () => {
        if (!video.muted || video.volume !== 0) window.__liveMedia.silenceViolations++;
      });
      video.addEventListener('error', () => window.__liveMedia.errors.push(video.error?.code || 0));
      video.addEventListener('ended', () => window.__liveMedia.ended++);
      for (const type of ['loadstart', 'emptied', 'loadedmetadata', 'loadeddata', 'error', 'playing', 'pause']) {
        video.addEventListener(type, () => {
          window.__liveMedia.events.push({ type, at: performance.now(), time: video.currentTime,
            readyState: video.readyState, errorCode: video.error?.code || 0 });
          if (window.__liveMedia.events.length > 30) window.__liveMedia.events.shift();
        });
      }
      const frame = () => {
        window.__liveMedia.frames++;
        window.__liveMedia.firstFrame ||= video.videoWidth > 0 && video.videoHeight > 0;
        video.requestVideoFrameCallback(frame);
      };
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(frame);
    });
    new MutationObserver(observe).observe(document.documentElement, { subtree: true, childList: true });
    observe(); return true;
  })()`);
  return port;
}

async function stop() {
  if (client) {
    try { await client.evaluate('(() => { setTimeout(() => window.electronAPI.windowClose(), 50); return true; })()'); } catch {}
    client.close(); client = null;
  }
  if (!child || child.exitCode !== null) return;
  const deadline = Date.now() + 15000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(100);
  if (child.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGKILL');
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, 'The isolated process could not stop', 10000);
  }
  child = null;
}

const videoState = `(() => {
  const video = document.querySelector('.player-video');
  if (!video) return null;
  const quality = video.getVideoPlaybackQuality();
  return { time: video.currentTime, duration: video.duration, paused: video.paused, muted: video.muted,
    volume: video.volume, rate: video.playbackRate, width: video.videoWidth, height: video.videoHeight,
    readyState: video.readyState, decodedFrames: quality.totalVideoFrames,
    droppedFrames: quality.droppedVideoFrames, errorCode: video.error?.code || 0,
    firstFrame: window.__liveMedia.firstFrame, frameCallbacks: window.__liveMedia.frames,
    silenceViolations: window.__liveMedia.silenceViolations };
})()`;

async function click(selector) {
  await revealControls();
  const position = await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return null;
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
  check(position, 'A production playback control is unavailable');
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...position });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...position });
}

async function revealControls() {
  const center = await client.evaluate(`(() => {
    const stage = document.querySelector('.player-stage');
    if (!stage) return null;
    stage.scrollIntoView({ block: 'center', behavior: 'instant' });
    const box = stage.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
  if (!center) return;
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...center });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x + 12, y: center.y + 4 });
  await waitFor(() => client.evaluate('!document.querySelector(".player-controls")?.classList.contains("controls-hidden")'),
    'The production playback controls did not become visible', 3000);
}

async function seek(seconds) {
  await revealControls();
  const position = await client.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="播放进度"]');
    if (!input || input.disabled) throw new Error('Seek unavailable');
    input.scrollIntoView({ block: 'center', behavior: 'instant' });
    const box = input.getBoundingClientRect();
    return { x: box.x + 6 + (box.width - 12) * ${Number(seconds)} / Number(input.max), y: box.y + box.height / 2 };
  })()`);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...position });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...position });
  return waitFor(async () => {
    const state = await client.evaluate(videoState);
    return state?.readyState >= 2 && Math.abs(state.time - seconds) < 0.8 && !state.errorCode && state;
  }, 'The actual production seek did not complete', 5000);
}

async function screenshot(name) {
  const image = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'));
}

async function advance(seconds) {
  const start = await client.evaluate(videoState);
  check(start?.muted && start.volume === 0 && !start.paused, 'The production video is not silently playing');
  const started = Date.now();
  let previous = start;
  while (Date.now() - started < seconds * 1000) {
    await sleep(500);
    const current = await client.evaluate(videoState);
    check(current && current.muted && current.volume === 0 && !current.paused && !current.errorCode,
      'Silent continuous playback was interrupted');
    check(current.time + 0.1 >= previous.time, 'Unexpected playback position regression');
    previous = current;
  }
  check(previous.time - start.time >= seconds * start.rate - 1.5, 'The video did not advance continuously');
  check(previous.decodedFrames > start.decodedFrames && previous.frameCallbacks > start.frameCallbacks,
    'The actual player did not decode and present more frames');
  return { secondsObserved: (Date.now() - started) / 1000, mediaSecondsAdvanced: previous.time - start.time,
    additionalDecodedFrames: previous.decodedFrames - start.decodedFrames,
    additionalPresentedFrames: previous.frameCallbacks - start.frameCallbacks };
}

async function navigate(manifest, resume = false) {
  await sleep(400);
  const result = await client.evaluate(`window.electronAPI.playSeries(${JSON.stringify({
    seriesId: manifest.seriesId, vidIndex: manifest.episodes[0].index, resume,
  })})`);
  check(result?.success, 'Production play-series navigation failed');
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const manifest = readManifest();
  const executable = option('--executable');
  check(!args.includes('--executable') || typeof executable === 'string' && executable.trim()
    && !executable.startsWith('--'), 'Supply the packaged Windows executable after --executable');
  if (executable) {
    applicationExecutable = path.resolve(executable);
    check(/\.exe$/i.test(applicationExecutable) && fs.statSync(applicationExecutable, { throwIfNoEntry: false })?.isFile(),
      'The packaged executable must be an existing Windows EXE');
  }
  phase = 'isolated-profile'; prepareProfile(manifest);
  phase = 'production-launch'; await launch();
  report.app = await client.evaluate('window.electronAPI.getAppInfo()').then(info => ({ version: info.version, ...applicationEvidence() }));
  phase = 'first-frame'; await navigate(manifest);
  if (args.includes('--allow-manual-start')) {
    const initial = await waitFor(async () => {
      const state = await client.evaluate(videoState);
      return state?.readyState >= 2 && state;
    }, 'The real media did not load');
    if (initial.paused) {
      await click('button[aria-label="播放"]');
      report.manualStartForDiagnosis = true;
    }
  }
  const first = await waitFor(async () => {
    const state = await client.evaluate(videoState);
    return state?.firstFrame && state.decodedFrames > 0 && state.width > 0 && !state.paused && state;
  }, 'The real production player did not present a decoded first frame', 30000);
  check(Math.abs(first.duration - manifest.episodes[0].duration) < 0.15, 'The player loaded an unexpected episode');
  report.checks.firstFrame = first;
  await screenshot('first-frame.png');
  phase = 'continuous-playback'; report.checks.continuous = await advance(10);
  phase = 'seek'; report.checks.seek = await seek(Math.min(30, first.duration / 3));
  phase = 'speed'; await click('button[aria-label="增加播放速度"]');
  await waitFor(async () => (await client.evaluate(videoState))?.rate === 1.25, 'The production speed button did not change playback');
  report.checks.speed = await advance(2);
  // Restore the same product preference through its speed menu.
  await click('button[aria-label="更多播放选项"]');
  await client.evaluate(`(() => {
    const select = document.querySelector('select[aria-label="播放速度"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '1');
    select.dispatchEvent(new Event('change', { bubbles: true })); return true;
  })()`);
  await click('button[aria-label="更多播放选项"]');
  phase = 'fullscreen'; await click('button[aria-label="全屏"]');
  await waitFor(() => client.evaluate('Boolean(document.fullscreenElement)'), 'The real fullscreen control did not enter fullscreen');
  await screenshot('fullscreen.png');
  report.checks.fullscreen = await advance(2);
  await click('button[aria-label="退出全屏"]');
  await waitFor(() => client.evaluate('!document.fullscreenElement'), 'The real fullscreen control did not exit fullscreen');
  phase = 'picture-in-picture';
  const beforePip = await client.evaluate(`(() => { window.__originalLiveVideo = document.querySelector('.player-video'); return window.__originalLiveVideo.currentTime; })()`);
  await click('button[aria-label="画中画"]');
  const pipTarget = await waitFor(async () => {
    const all = await client.send('Target.getTargets');
    return all.targetInfos.find(target => target.type === 'page' && target.url === 'about:blank');
  }, 'The actual application picture-in-picture window did not open');
  await client.send('Target.activateTarget', { targetId: pipTarget.targetId });
  // The same-origin child document owns the same video node while floating.
  const floating = await waitFor(() => client.evaluate(`(() => {
    const video = window.__originalLiveVideo;
    if (!video || video.ownerDocument === document || video.paused || video.readyState < 2) return null;
    return { time: video.currentTime, muted: video.muted, volume: video.volume,
      decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames, sameVideoNode: true };
  })()`), 'The real video did not continue inside picture-in-picture');
  await sleep(2200);
  const floatingPages = await (await fetch(`http://127.0.0.1:${debuggingPort}/json`, { signal: AbortSignal.timeout(3000) })).json();
  const floatingPage = floatingPages.find(target => target.id === pipTarget.targetId);
  check(floatingPage, 'The isolated floating renderer is unavailable');
  const floatingClient = await connect(floatingPage);
  try {
    const image = await floatingClient.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(output, 'picture-in-picture.png'), Buffer.from(image.data, 'base64'));
  } finally { floatingClient.close(); }
  const pipAfter = await client.evaluate(`(() => {
    const video = window.__originalLiveVideo;
    const result = { time: video.currentTime, muted: video.muted, volume: video.volume,
      decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames, sameVideoNode: true };
    video.ownerDocument.querySelector('button[aria-label="退出画中画"]').click(); return result;
  })()`);
  check(floating.muted && pipAfter.muted && pipAfter.volume === 0 && pipAfter.time > floating.time + 1
    && pipAfter.decodedFrames > floating.decodedFrames && floating.time >= beforePip - 1,
  'The floating production video did not preserve silent decoded playback');
  await waitFor(() => client.evaluate('window.__originalLiveVideo.ownerDocument === document'), 'Picture-in-picture did not restore the original video');
  report.checks.pictureInPicture = { sameVideoNode: true, secondsAdvanced: pipAfter.time - floating.time,
    additionalDecodedFrames: pipAfter.decodedFrames - floating.decodedFrames, muted: true };
  await screenshot('picture-in-picture-restored.png');

  phase = 'restart-position'; await seek(Math.min(45, first.duration / 2));
  await click('button[aria-label="暂停"]');
  const saved = await waitFor(async () => {
    const savedPosition = await client.evaluate(`window.electronAPI.getPlaybackPosition(${JSON.stringify(manifest.seriesId)})`);
    return savedPosition?.currentTime > 10 && savedPosition;
  }, 'The production player did not persist progress');
  await stop();
  phase = 'real-media-failure';
  const independentMedia = path.join(profile, 'independent-downloads', `episode-${manifest.episodes[0].index}.mp4`);
  check(sha256(independentMedia) === manifest.episodes[0].sha256, 'The independent media changed before fault injection');
  // Corrupt only the MP4 header of our independent real-media copy, then restore its verified bytes.
  const descriptor = fs.openSync(independentMedia, 'r+');
  try { fs.writeSync(descriptor, Buffer.alloc(4096), 0, 4096, 0); }
  finally { fs.closeSync(descriptor); }
  await launch();
  await navigate(manifest, true);
  await waitFor(() => client.evaluate('window.__liveMedia.errors.length > 0'), 'The controlled real media corruption was not observed');
  fs.copyFileSync(manifest.episodes[0].file, independentMedia);
  check(sha256(independentMedia) === manifest.episodes[0].sha256, 'The independent real media was not restored');
  phase = 'position-recovery';
  if (args.includes('--diagnose-cache')) {
    await client.send('Network.clearBrowserCache');
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    report.externalCacheClearedForDiagnosis = true;
  }
  await sleep(400);
  const retry = await client.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === '重试本集');
    if (!button || button.disabled) return false;
    button.click(); return true;
  })()`);
  report.checks.retryTriggered = retry;
  const recoverState = async () => {
    const state = await client.evaluate(videoState);
    return state?.readyState >= 2 && !state.paused && !state.errorCode && state.time >= saved.currentTime - 2 && state;
  };
  let recovered;
  try {
    recovered = await waitFor(recoverState, 'The player did not recover near its persisted progress after real media corruption',
      args.includes('--diagnose-reload') ? 10000 : 60000);
  } catch (error) {
    if (!args.includes('--diagnose-reload')) throw error;
    report.directReloadForDiagnosis = await client.evaluate(`(async () => {
      const video = document.querySelector('.player-video');
      const response = await fetch(video.src, { cache: 'no-store' });
      const bytes = await response.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      video.load();
      return { fileHashMatches: hash === ${JSON.stringify(manifest.episodes[0].sha256)}, bytes: bytes.byteLength };
    })()`);
    recovered = await waitFor(recoverState, 'The direct native reload also failed after restoring exact media bytes', 10000);
  }
  check(recovered.time <= saved.currentTime + 15, 'Recovery jumped away from the persisted progress');
  report.checks.positionRecovery = { savedTime: saved.currentTime, recoveredTime: recovered.time,
    realMediaCorruptionObserved: true, exactMediaBytesRestored: true, manualRetryUsed: retry, restartRestore: true,
    continued: await advance(3) };

  phase = 'automatic-continuation';
  if (manifest.episodes.length > 1) {
    const originalSource = await client.evaluate(`(() => {
      const video = document.querySelector('.player-video');
      window.__liveFirstSource = video.currentSrc; return Boolean(video.currentSrc);
    })()`);
    check(originalSource, 'The first episode has no production media source');
    await seek(first.duration - 1.5);
    await waitFor(async () => {
      const ended = await client.evaluate('window.__liveMedia.ended');
      const changed = await client.evaluate(`(() => {
        const video = document.querySelector('.player-video');
        return Boolean(video?.currentSrc && video.currentSrc !== window.__liveFirstSource && video.readyState >= 2
          && !video.paused && !video.error && Math.abs(video.duration - ${manifest.episodes[1].duration}) < 0.15);
      })()`);
      return ended > 0 && changed;
    }, 'The real ended event did not advance to the next distinct complete episode', 45000);
    report.checks.automaticContinuation = { passed: true, realEndedEvent: true,
      fromIndex: manifest.episodes[0].index, toIndex: manifest.episodes[1].index,
      continued: await advance(10) };
    await screenshot('automatic-continuation.png');
  } else report.checks.automaticContinuation = { passed: false, skipped: 'Only one distinct complete episode supplied' };
  const final = await client.evaluate(videoState);
  check(final.silenceViolations === 0, 'A video became unmuted during acceptance');
  report.checks.silence = { commandLineMutedBeforeStartup: true, videoMuted: true, volume: 0, violations: 0 };
  report.passed = true;
  report.formalAcceptanceComplete = !report.externalCacheClearedForDiagnosis && !report.directReloadForDiagnosis && !report.manualStartForDiagnosis
    && manifest.selection === 'random' && report.checks.automaticContinuation.passed === true;
}

function createIsolatedPlaybackHarness(options) {
  check(!child && !client, 'The isolated playback harness is already running');
  const isolatedProfile = path.resolve(options.profile);
  check(path.dirname(isolatedProfile) === path.resolve(os.tmpdir())
    && path.basename(isolatedProfile).startsWith('hongguo-player-'), 'The isolated profile is outside its temporary root');
  if (options.executable != null) {
    check(typeof options.executable === 'string' && path.isAbsolute(options.executable)
      && /\.exe$/i.test(options.executable) && fs.statSync(options.executable, { throwIfNoEntry: false })?.isFile(),
    'The packaged executable must be an existing absolute Windows EXE');
  }
  profile = isolatedProfile;
  output = path.resolve(options.outputDir);
  applicationExecutable = options.executable;
  return { launch, stop, seek, advance, screenshot, waitFor, videoState,
    get client() { return client; }, get debuggingPort() { return debuggingPort; },
    get applicationEvidence() { return applicationEvidence(); } };
}

module.exports = { createIsolatedPlaybackHarness };

if (require.main === module) main().catch(async error => {
  report.failure = { phase, reason: error instanceof assert.AssertionError ? error.message :
    /^(The |A |An |Supply |Only |Episode |Two |Real |The isolated|The production|The actual|Silent |Unexpected |Recovery )/.test(error.message)
      ? error.message : 'Playback acceptance operation failed; inspect this phase locally' };
  if (client) {
    try {
      report.failure.media = await client.evaluate(videoState);
      report.failure.player = await client.evaluate(`(() => {
        const video = document.querySelector('.player-video');
        return { hasPlayer: Boolean(document.querySelector('.player-container')),
          hasSource: Boolean(video?.currentSrc || video?.src),
          placeholder: Boolean(document.querySelector('.player-placeholder')),
          mediaErrors: window.__liveMedia?.errors || [],
          events: window.__liveMedia?.events || [],
          retryAvailable: [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '重试本集') };
      })()`);
      await screenshot('failure-frame.png');
    } catch {}
  }
  process.exitCode = 1;
}).finally(async () => {
  try { await stop(); } catch { report.cleanupFailed = true; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  report.isolatedData = true;
  if (profile && !report.cleanupFailed) {
    const resolved = path.resolve(profile);
    check(path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('hongguo-player-live-'),
      'Refusing cleanup outside the dedicated temporary profile');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, formalAcceptanceComplete: report.formalAcceptanceComplete || false,
    failurePhase: report.failure?.phase || null, report: path.relative(ROOT, path.join(output, 'result.json')) }));
});
