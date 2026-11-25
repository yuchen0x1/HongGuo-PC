// Actual online acceptance, with no supplied local media or account credentials.
// node scripts/verify-playback-online.cjs --manifest manifest.json --output-dir dist/playback-online
// Add --executable dist/win-unpacked/app.exe to verify the packaged application.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createIsolatedPlaybackHarness } = require('./check-playback-live.cjs');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
const output = path.resolve(option('--output-dir') || path.join(ROOT, 'dist', 'playback-online'));
const check = (condition, message) => assert.ok(condition, message);
const report = { schema: 1, startedAt: new Date().toISOString(), passed: false,
  scope: 'production Electron playSeries with official online sources and an empty independent download directory',
  officialNetworkResolutionTested: true, accountAuthenticationTested: false, checks: {} };
let profile, downloads, harness, manifest;
let phase = 'manifest';

function readManifest() {
  const filename = option('--manifest');
  check(filename, 'Supply a real random official episode manifest');
  const supplied = JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
  check(Number.isSafeInteger(supplied.selectedRandomlyFrom) && supplied.selectedRandomlyFrom > 1,
    'The real official series must have documented random provenance');
  check(Array.isArray(supplied.episodes) && supplied.episodes.length >= 2,
    'Two consecutive complete official episodes are required');
  const first = supplied.episodes[0];
  const episodes = supplied.episodes.slice(0, 2).map(episode => {
    check(/^\d{1,30}$/.test(episode.episodeId) && episode.seriesId === first.seriesId,
      'The real episode identities must belong to one official series');
    check(episode.source === 'web' && episode.profileId === 'hongguo-official-web-public-v1'
      && episode.routeId === 'official-web-public-fallback', 'The source provenance must be the verified official public route');
    check(Number.isSafeInteger(episode.episodeIndex) && episode.episodeIndex > 0
      && Number.isFinite(episode.duration) && episode.duration > 15, 'The real episode duration or index is invalid');
    return { vid: episode.episodeId, index: episode.episodeIndex, duration: episode.duration };
  });
  check(/^\d{1,30}$/.test(first.seriesId) && typeof first.title === 'string' && first.title.trim(),
    'The official series identity is invalid');
  check(episodes[1].index === episodes[0].index + 1 && episodes[1].vid !== episodes[0].vid,
    'The real episodes must be distinct and consecutive');
  report.provenance = { selectedRandomlyFrom: supplied.selectedRandomlyFrom,
    title: first.title, seriesId: first.seriesId, episodes };
  return { seriesId: first.seriesId, title: first.title, episodes };
}

function prepareProfile() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-player-online-'));
  downloads = path.join(profile, 'independent-downloads');
  fs.mkdirSync(downloads);
  fs.writeFileSync(path.join(profile, 'data.json'), JSON.stringify({ settings: { root: downloads,
    close_to_tray: false, app_updates_enabled: false, watch_updates_enabled: false,
    watch_sequels_enabled: false, watch_notifications_enabled: false, cache_next_episode: false,
    auto_delete_watched: false, compat_mode: false, proxy_mode: 'direct', proxy_enabled: false },
  tasks: [], mergeTasks: [], playback: {}, series: [{ series_id: manifest.seriesId,
    series_title: manifest.title, cover: '', total: manifest.episodes.length,
    episodes: manifest.episodes.map(episode => ({ vid: episode.vid, vid_index: episode.index,
      title: '', locked: false, web_available: true })), updatedAt: Date.now(), dismissed: false }] }));
  const executable = option('--executable');
  check(!args.includes('--executable') || typeof executable === 'string' && executable.trim()
    && !executable.startsWith('--'), 'Supply the packaged Windows executable after --executable');
  harness = createIsolatedPlaybackHarness({ profile, outputDir: output,
    ...(executable ? { executable: path.resolve(executable) } : {}) });
}

async function noLocalMedia() {
  const state = await harness.client.evaluate(`(async () => {
    const response = await window.electronAPI.getSeriesEpisodes(${JSON.stringify(manifest.seriesId)});
    if (!response?.success) return null;
    return { completedCount: response.data.completedCount,
      episodes: response.data.episodes.map(episode => ({ index: episode.vid_index, status: episode.status,
        hasTask: Boolean(episode.taskId), hasLocalFile: Boolean(episode.fileUrl || episode.savePath), bytes: episode.fileSize })) };
  })()`);
  check(state && state.completedCount === 0 && state.episodes.every(episode => !episode.hasTask
    && !episode.hasLocalFile && episode.bytes === 0), 'Playback unexpectedly used a completed task or local media');
  const disk = JSON.parse(fs.readFileSync(path.join(profile, 'data.json'), 'utf8'));
  check(Array.isArray(disk.tasks) && disk.tasks.length === 0, 'Playback unexpectedly created a download task');
  const entries = fs.readdirSync(downloads);
  check(entries.length === 0, 'The independent download directory is not empty');
  return { tasks: 0, downloadDirectoryEntries: 0, ...state };
}

async function diagnostics() {
  const value = await harness.client.evaluate('window.electronAPI.getPlaybackDiagnostics()');
  check(value?.success && value.diagnostics, 'The production playback diagnostics were unavailable');
  const data = value.diagnostics;
  check(!/https?:\/\/|sessionid=|passport_csrf_token=/i.test(JSON.stringify(data)),
    'The playback diagnostics contain an address or account credential');
  return data;
}

async function sourceHash() {
  return harness.client.evaluate(`(async () => {
    const source = document.querySelector('.player-video')?.currentSrc;
    if (!source) return null;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))].map(
      byte => byte.toString(16).padStart(2, '0')).join('');
  })()`);
}

function checkOnlineRoute(data, minimumSources) {
  check(data.sourceRoute === 'web' && data.routeId === 'official-web-public-fallback'
    && data.profileId === 'hongguo-official-web-public-v1', 'The production player did not use the verified online route');
  check(data.counts.sourceSuccesses >= minimumSources && data.counts.playbackSuccesses >= minimumSources,
    'The production online source or first-frame diagnostics are missing');
  const routes = data.requestRoutes;
  for (const routeId of ['preload-primary', 'preload-alternate', 'video-tab']) {
    const row = routes.find(route => route.routeId === routeId);
    check(row?.attempts >= minimumSources && row.failures >= minimumSources
      && row.lastFaultCode === 'API_EMPTY_RESPONSE', 'The automatic App empty-response route was not observed');
  }
  const web = routes.find(route => route.routeId === 'official-web-public-fallback');
  check(web?.attempts >= minimumSources && web.modelsAccepted >= minimumSources,
    'The actual official public source request was not observed');
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  manifest = readManifest();
  phase = 'isolated-profile'; prepareProfile();
  phase = 'production-launch'; await harness.launch();
  check(harness.debuggingPort !== 9463, 'The account regression port must not be used');
  await harness.waitFor(() => harness.client.evaluate('!document.querySelector(".splash-screen")'),
    'The production startup overlay did not finish', 15000);
  await harness.client.evaluate(`(() => {
    window.__onlineDiagnosticEvents = [];
    window.electronAPI.onOnlinePlayDiagnostics(value => {
      const diagnostic = value.diagnostics || {};
      window.__onlineDiagnosticEvents.push({ at: performance.now(), faultCode: value.faultCode || '',
        code: diagnostic.code || '', stage: diagnostic.stage || '', mediaRead: diagnostic.mediaRead || '',
        routes: (diagnostic.routes || []).map(route => ({ source: route.source, status: route.status,
          code: route.code || '', mediaRead: route.mediaRead })) });
    });
    const seen = new WeakSet();
    const observe = () => document.querySelectorAll('video').forEach(video => {
      if (seen.has(video)) return;
      seen.add(video);
      for (const type of ['seeking', 'seeked']) video.addEventListener(type, () => {
        window.__liveMedia.events.push({ type, at: performance.now(), time: video.currentTime,
          readyState: video.readyState, errorCode: video.error?.code || 0 });
      });
    });
    new MutationObserver(observe).observe(document.documentElement, { childList: true, subtree: true });
    observe(); return true;
  })()`);
  report.app = await harness.client.evaluate('window.electronAPI.getAppInfo()').then(value => ({ version: value.version, ...harness.applicationEvidence }));
  report.checks.before = await noLocalMedia();
  report.quality = { userPreference: await harness.client.evaluate('localStorage.getItem("hongguo:online-quality")'),
    requestedPreference: '1080p', allowLowerQuality: true };
  check(report.quality.userPreference === 'auto', 'The production player is not using its default automatic quality');
  phase = 'real-online-navigation';
  const result = await harness.client.evaluate(`window.electronAPI.playSeries(${JSON.stringify({
    seriesId: manifest.seriesId, vidIndex: manifest.episodes[0].index, resume: false })})`);
  check(result?.success, 'The production playSeries navigation failed');
  phase = 'online-first-frame';
  const first = await harness.waitFor(async () => {
    const value = await harness.client.evaluate(harness.videoState);
    return value?.firstFrame && value.decodedFrames > 0 && value.width > 0 && !value.paused && !value.errorCode && value;
  }, 'The real online video did not present its first decoded frame', 60000);
  check(Math.abs(first.duration - manifest.episodes[0].duration) < 0.15,
    'The actual online media duration does not match the complete first episode');
  report.checks.firstFrame = { ...first, sourceSha256: await sourceHash() };
  report.checks.firstDiagnostics = await harness.waitFor(async () => {
    const value = await diagnostics();
    return value.counts.playbackSuccesses >= 1 && value;
  }, 'The actual online first frame was not reported');
  checkOnlineRoute(report.checks.firstDiagnostics, 1);
  await harness.screenshot('online-first-frame.png');
  phase = 'online-continuous-playback'; report.checks.continuous = await harness.advance(10);
  phase = 'online-seek'; report.checks.seek = await harness.seek(Math.min(30, first.duration / 3));
  await harness.screenshot('online-seek.png');
  report.checks.afterFirst = await noLocalMedia();
  phase = 'online-real-ended';
  const endedBefore = await harness.client.evaluate('window.__liveMedia.ended');
  await harness.seek(first.duration - 1.5);
  const second = await harness.waitFor(async () => {
    const ended = await harness.client.evaluate('window.__liveMedia.ended');
    const state = await harness.client.evaluate(harness.videoState);
    const hash = await sourceHash();
    return ended > endedBefore && state?.readyState >= 2 && !state.paused && !state.errorCode
      && state.decodedFrames > 0 && Math.abs(state.duration - manifest.episodes[1].duration) < 0.15
      && hash && hash !== report.checks.firstFrame.sourceSha256 && { ...state, sourceSha256: hash, endedEvents: ended };
  }, 'The real online ended event did not start the next distinct complete episode', 60000);
  report.checks.automaticContinuation = { realEndedEvent: true, seekNearEndUsed: true,
    fromIndex: manifest.episodes[0].index, toIndex: manifest.episodes[1].index, firstFrame: second,
    continued: await harness.advance(10) };
  phase = 'online-diagnostics';
  report.checks.finalDiagnostics = await diagnostics();
  checkOnlineRoute(report.checks.finalDiagnostics, 2);
  report.checks.after = await noLocalMedia();
  const final = await harness.client.evaluate(harness.videoState);
  check(final.muted && final.volume === 0 && final.silenceViolations === 0,
    'The actual online video became audible');
  report.checks.silence = { commandLineMutedBeforeStartup: true, muted: true, volume: 0, violations: 0 };
  await harness.screenshot('online-automatic-continuation.png');
  report.passed = true;
}

if (require.main === module) main().catch(async error => {
  report.failure = { phase, reason: error instanceof assert.AssertionError || /^The (real |actual |production |automatic |independent )/.test(error.message)
    ? error.message : 'Online playback acceptance failed; inspect this phase locally' };
  if (harness?.client) {
    try {
      report.failure.media = await harness.client.evaluate(harness.videoState);
      report.failure.diagnostics = await diagnostics();
      report.failure.timeline = await harness.client.evaluate('({ media: window.__liveMedia?.events, diagnostics: window.__onlineDiagnosticEvents })');
      await harness.screenshot('online-failure.png');
    } catch {}
  }
  process.exitCode = 1;
}).finally(async () => {
  try { await harness?.stop(); } catch { report.cleanupFailed = true; process.exitCode = 1; }
  if (profile && !report.cleanupFailed) {
    const resolved = path.resolve(profile);
    check(path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('hongguo-player-online-'),
      'Refusing cleanup outside the independent online profile');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  report.finishedAt = new Date().toISOString();
  report.isolatedData = true;
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failurePhase: report.failure?.phase || null,
    report: path.relative(ROOT, path.join(output, 'result.json')) }));
});
