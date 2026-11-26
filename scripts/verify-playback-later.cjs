// Real later-episode acceptance. No local media, account credentials, or phone transport.
// node scripts/verify-playback-later.cjs --manifest dist/independent-audit/manifest.json
// Optional: --indexes 6,22,34,68,88 --executable dist/win-unpacked/app.exe --ended-transition
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createIsolatedPlaybackHarness } = require('./check-playback-live.cjs');

const ROOT = path.resolve(__dirname, '..');
const PROFILE_ROOT = path.join(ROOT, '.local', 'analysis', 'playback-profiles');
const args = process.argv.slice(2);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const check = (value, message) => assert.ok(value, message);
const option = name => {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  check(typeof value === 'string' && value.trim() && !value.startsWith('--'), `Supply a value after ${name}`);
  return value;
};
const CASE_TIMEOUT = 60000;
const REJECTION_OBSERVATION = 16000;
const output = path.resolve(option('--output-dir') || path.join(ROOT, 'dist', 'playback-later'));
const indexes = (option('--indexes') || '6,22,34,68,88').split(',').map(value => {
  check(/^\d+$/.test(value.trim()), 'Episode indexes must be positive comma-separated integers');
  const index = Number(value.trim());
  check(Number.isSafeInteger(index) && index > 0 && index <= 1000000, 'An episode index is outside the supported range');
  return index;
});
check(indexes.length > 0 && new Set(indexes).size === indexes.length, 'Episode indexes must be distinct');
const report = {
  schema: 1, startedAt: new Date().toISOString(), technicalChecksPassed: false, laterPlaybackPassed: false,
  scope: 'production playSeries, actual registered official directory, fresh process for each requested episode',
  officialNetworkResolutionTested: false, accountAuthenticationTested: false,
  adbOrPhoneTransportUsed: false, physicalPhonePowerStateObserved: false,
  minimumContinuousSeconds: 30, audioOutputVerified: false, fullWindowsIndependentAcceptancePassed: false,
  unverifiedChecks: ['audio-output', 'search-through-UI', 'restart-progress-restoration', 'physical-phone-disconnection'],
  isolation: { newTemporaryProfile: true, initiallyEmptyLibrary: true, emptyDownloadDirectory: true,
    suppliedLocalMedia: false, isolatedCasePrefetchEnabled: false, commandLineMutedBeforeStartup: true },
  requestedIndexes: indexes, cases: [],
};
let profile, downloads, harness, manifest, directory;
let phase = 'manifest';

function safeText(value) {
  return String(value || '').replace(/(?:https?|hongguo-[a-z-]+):\/\/[^\s<>"']+/gi, '[address omitted]')
    .replace(/\b(?:sessionid|passport_csrf_token|access_token|refresh_token|cookie|token|signature|key)\s*[=:]\s*[^\s,;]+/gi,
      '[credential omitted]').slice(0, 1200);
}

function readManifest(filename = option('--manifest')) {
  check(filename, 'Supply --manifest with documented official series provenance');
  const supplied = JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
  const targeted = supplied.selection === 'development'
    && supplied.sourceEvidence?.kind === 'targeted-official-catalog';
  if (!targeted) check(Number.isSafeInteger(supplied.selectedRandomlyFrom) && supplied.selectedRandomlyFrom > 1,
    'Supply documented random provenance or explicit targeted-official-catalog development evidence');
  check(Array.isArray(supplied.episodes) && supplied.episodes.length > 0, 'The real series manifest has no episode provenance');
  const first = supplied.episodes[0];
  check(/^\d{1,30}$/.test(String(first.seriesId)) && typeof first.title === 'string' && first.title.trim(),
    'The manifest must identify a real official series');
  const durations = new Map();
  const expectedEpisodes = new Map();
  for (const episode of supplied.episodes) {
    check(String(episode.seriesId) === String(first.seriesId) && /^\d{1,30}$/.test(String(episode.episodeId))
      && Number.isSafeInteger(episode.episodeIndex) && episode.episodeIndex > 0,
    'The manifest episode identities must belong to the same real series');
    check(!expectedEpisodes.has(episode.episodeIndex)
      && ![...expectedEpisodes.values()].includes(String(episode.episodeId)), 'The manifest contains duplicate episode identities');
    expectedEpisodes.set(episode.episodeIndex, String(episode.episodeId));
    if (targeted) {
      check(episode.source === 'official-catalog' && !episode.file && !episode.url && !episode.mediaUrl,
        'Targeted catalog provenance must not claim supplied media or playback addresses');
    } else check(episode.source === 'web' && episode.profileId === 'hongguo-official-web-public-v1'
      && episode.routeId === 'official-web-public-fallback', 'The real manifest source provenance is not the verified public route');
    if (!targeted && Number.isFinite(episode.duration) && episode.duration > 0) {
      durations.set(episode.episodeIndex, { vid: String(episode.episodeId), duration: episode.duration });
    }
  }
  let sourceEvidence;
  if (targeted) {
    const evidence = supplied.sourceEvidence;
    check(typeof evidence.observedAt === 'string' && Number.isFinite(Date.parse(evidence.observedAt))
      && typeof evidence.reference === 'string' && evidence.reference.trim(),
    'Targeted catalog evidence must identify its observation time and retained local record');
    const evidenceFile = path.resolve(path.dirname(path.resolve(filename)), evidence.reference);
    const relative = path.relative(ROOT, evidenceFile);
    check(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
      && fs.statSync(evidenceFile, { throwIfNoEntry: false })?.isFile(),
    'The retained target catalog evidence must be a file inside the project');
    sourceEvidence = { kind: evidence.kind, observedAt: evidence.observedAt, reference: relative,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(evidenceFile)).digest('hex'), mediaObtained: false };
  }
  const provenance = { selection: targeted ? 'development' : 'random',
    ...(targeted ? { sourceEvidence } : { selectedRandomlyFrom: supplied.selectedRandomlyFrom }),
    seriesId: String(first.seriesId), title: safeText(first.title),
    manifestEpisodeIndexes: supplied.episodes.map(episode => episode.episodeIndex) };
  report.provenance = provenance;
  return { seriesId: String(first.seriesId), title: first.title, durations, expectedEpisodes, provenance };
}

function prepareProfile() {
  fs.mkdirSync(PROFILE_ROOT, { recursive: true });
  profile = fs.mkdtempSync(path.join(PROFILE_ROOT, 'hongguo-player-later-'));
  downloads = path.join(profile, 'independent-downloads');
  fs.mkdirSync(downloads);
  fs.writeFileSync(path.join(profile, 'data.json'), JSON.stringify({
    settings: { root: downloads, close_to_tray: false, app_updates_enabled: false, watch_updates_enabled: false,
      watch_sequels_enabled: false, watch_notifications_enabled: false, cache_next_episode: false,
      auto_delete_watched: false, compat_mode: false, proxy_mode: 'direct', proxy_enabled: false },
    tasks: [], mergeTasks: [], playback: {}, series: [],
  }));
  const executable = option('--executable');
  harness = createIsolatedPlaybackHarness({ profile, outputDir: output,
    ...(executable ? { executable: path.resolve(executable) } : {}) });
}

// Start IPC without keeping one Runtime.evaluate pending beyond the debugger's 15-second limit.
async function productionCall(expression, description, timeout = CASE_TIMEOUT) {
  await harness.client.evaluate(`(() => {
    window.__laterPendingCall = { pending: true };
    Promise.resolve().then(() => (${expression})).then(value => {
      window.__laterPendingCall = { pending: false, value };
    }, () => { window.__laterPendingCall = { pending: false, rejected: true }; });
    return true;
  })()`);
  const completed = await harness.waitFor(() => harness.client.evaluate(
    'window.__laterPendingCall?.pending === false ? window.__laterPendingCall : null'), description, timeout);
  check(!completed.rejected, `${description}: the production IPC rejected`);
  return completed.value;
}

async function launch(prefetch = false) {
  await harness.launch();
  await harness.waitFor(() => harness.client.evaluate('!document.querySelector(".splash-screen")'),
    'The production startup overlay did not finish', 15000);
  await harness.client.evaluate(`(() => {
    window.__laterLogin = { openings: 0, qrNodes: 0 };
    const dialogs = new WeakSet(), images = new WeakSet();
    const inspect = () => {
      document.querySelectorAll('.account-playback-login-dialog').forEach(element => {
        if (!dialogs.has(element)) { dialogs.add(element); window.__laterLogin.openings++; }
      });
      document.querySelectorAll('.account-qr img').forEach(element => {
        if (!images.has(element)) { images.add(element); window.__laterLogin.qrNodes++; }
      });
    };
    const privacy = document.createElement('style');
    privacy.textContent = '.account-qr img { visibility: hidden !important; }';
    document.head.append(privacy);
    new MutationObserver(inspect).observe(document.documentElement, { childList: true, subtree: true });
    inspect();
    localStorage.setItem('hongguo-experience-preview:theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
    return true;
  })()`);
  const saved = await productionCall(`window.electronAPI.saveSettings({ cache_next_episode: ${prefetch} })`,
    'The isolated playback cache preference could not be saved');
  check(saved?.success, 'The isolated playback cache preference was rejected');
  const account = await productionCall('window.electronAPI.getAccountStatus().then(value => ({ signedIn: value.signedIn }))',
    'The anonymous account status could not be read');
  check(account?.signedIn === false, 'The isolated profile unexpectedly contains a signed-in account');
  if (!report.app) {
    report.app = await productionCall('window.electronAPI.getAppInfo().then(value => ({ version: value.version }))',
      'The production app version could not be read');
    Object.assign(report.app, harness.applicationEvidence);
  }
}

async function registerDirectory() {
  const resolved = await productionCall(`window.electronAPI.searchResolve(${JSON.stringify(manifest.seriesId)}).then(value => ({
    success: value?.success === true,
    data: value?.success ? { seriesId: String(value.data?.series_id || ''), title: value.data?.series_title || '',
      total: value.data?.total, webAccessibleEpisodes: value.data?.web_accessible_episodes ?? null,
      episodes: (value.data?.episodes || []).map(episode => ({ vid: String(episode.vid || ''), index: episode.vid_index,
        locked: episode.locked === true, webAvailable: episode.web_available ?? null })) } : null
  }))`, 'The production searchResolve did not register the actual complete directory');
  check(resolved?.success && resolved.data?.seriesId === manifest.seriesId, 'The actual official directory did not match the selected series');
  const data = resolved.data;
  check(data.title.trim() && data.total === data.episodes.length && data.total >= Math.max(...indexes),
    'The actual complete official directory does not contain all requested episode indexes');
  check(new Set(data.episodes.map(episode => episode.index)).size === data.episodes.length
    && new Set(data.episodes.map(episode => episode.vid)).size === data.episodes.length
    && data.episodes.every(episode => Number.isSafeInteger(episode.index) && episode.index > 0 && /^\d{1,30}$/.test(episode.vid)),
  'The real official directory contains invalid or duplicate episode identities');
  check(indexes.every(index => data.episodes.some(episode => episode.index === index)), 'A requested index is absent from the actual directory');
  check([...manifest.expectedEpisodes].every(([index, vid]) => data.episodes.some(episode =>
    episode.index === index && episode.vid === vid)), 'The actual official directory contradicts the retained target episode identities');
  report.directory = { ...data, title: safeText(data.title), registeredBy: 'production searchResolve',
    registeredEpisodeCount: data.episodes.length, fabricatedRegistryEntries: false };
  return data;
}

async function noLocalMedia() {
  const value = await productionCall(`window.electronAPI.getSeriesEpisodes(${JSON.stringify(manifest.seriesId)}).then(response => ({
    success: response?.success === true, seriesId: response?.data?.series_id, total: response?.data?.total,
    completedCount: response?.data?.completedCount,
    episodes: (response?.data?.episodes || []).map(episode => ({ vid: String(episode.vid || ''), index: episode.vid_index,
      hasTask: Boolean(episode.taskId), hasLocalFile: Boolean(episode.fileUrl || episode.savePath), bytes: episode.fileSize }))
  }))`, 'The production episode and local-media state could not be read');
  check(value?.success && value.seriesId === manifest.seriesId && value.total === directory.total
    && value.completedCount === 0 && value.episodes.length === directory.episodes.length
    && value.episodes.every(episode => !episode.hasTask && !episode.hasLocalFile && episode.bytes === 0
      && directory.episodes.some(registered => registered.index === episode.index && registered.vid === episode.vid)),
  'The isolated player used local media or changed the actual episode directory');
  const disk = JSON.parse(fs.readFileSync(path.join(profile, 'data.json'), 'utf8'));
  check(Array.isArray(disk.tasks) && disk.tasks.length === 0 && fs.readdirSync(downloads).length === 0,
    'The isolated online test created a task or a download');
  check(!fs.existsSync(path.join(profile, 'account-session.bin')), 'The isolated anonymous test created saved account credentials');
  return { registeredEpisodes: value.total, completedCount: 0, tasks: 0, downloadDirectoryEntries: 0 };
}

async function snapshot() {
  const value = await harness.client.evaluate(`(async () => {
    const response = await window.electronAPI.getPlaybackDiagnostics();
    const media = ${harness.videoState};
    if (media) delete media.firstFrame;
    const video = document.querySelector('.player-video');
    const source = video?.currentSrc || '';
    const sourceSha256 = source ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('') : null;
    const visible = element => Boolean(element && element.getClientRects().length
      && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none');
    const selected = [...document.querySelectorAll('.player-episodes button[aria-pressed="true"]')];
    const selectedMatch = selected[0]?.getAttribute('aria-label')?.match(/第\\s*(\\d+)\\s*集/);
    const alert = [...document.querySelectorAll('.player-placeholder [role="alert"], .compat-overlay [role="alert"]')].find(visible);
    const placeholder = document.querySelector('.player-placeholder');
    return { diagnostics: response?.success ? response.diagnostics : null, media, sourceSha256,
      endedEvents: window.__liveMedia?.ended || 0, silenceViolations: window.__liveMedia?.silenceViolations || 0,
      login: { ...window.__laterLogin }, ui: { selectedIndex: selectedMatch ? Number(selectedMatch[1]) : null,
        selectedCount: selected.length, selectedDisabled: selected[0]?.disabled === true,
        currentTitle: document.querySelector('.player-now-title')?.textContent || '',
        errorVisible: Boolean(alert), errorText: alert?.textContent || '',
        placeholderText: visible(placeholder) ? [...placeholder.querySelectorAll('p')].map(element => element.textContent).join(' ') : '',
        retryVisible: [...document.querySelectorAll('.player-placeholder button')].some(button => visible(button)
          && button.textContent.includes('重试本集')) } };
  })()`);
  check(value?.diagnostics?.counts, 'The production playback diagnostics are unavailable');
  check(!/https?:\/\/|sessionid=|passport_csrf_token=/i.test(JSON.stringify(value.diagnostics)),
    'The production playback diagnostics contain an address or account credential');
  value.ui.currentTitle = safeText(value.ui.currentTitle);
  value.ui.errorText = safeText(value.ui.errorText);
  value.ui.placeholderText = safeText(value.ui.placeholderText);
  return value;
}

function deltas(before, after) {
  return Object.fromEntries(Object.keys(after.diagnostics.counts).map(key => [key,
    after.diagnostics.counts[key] - (before.diagnostics.counts[key] || 0)]));
}

function assertSilent(state) {
  check(state.silenceViolations === 0 && (!state.media || state.media.muted && state.media.volume === 0),
    'An acceptance video became audible');
  check(state.login.openings === 0 && state.login.qrNodes === 0, 'Playback automatically opened an account QR login');
}

function assertIdentity(state, index) {
  check(state.ui.selectedIndex === index && state.ui.selectedCount === 1
    && state.ui.currentTitle.includes(manifest.title), 'The production player selected the wrong episode or series');
}

async function waitForOutcome(index, before, minimumSources = 1, minimumPlayback = 1) {
  const started = Date.now();
  while (Date.now() - started < CASE_TIMEOUT) {
    const current = await snapshot();
    assertSilent(current);
    if (current.ui.selectedIndex === index) {
      const delta = deltas(before, current);
      const media = current.media;
      if (delta.sourceSuccesses >= minimumSources && delta.playbackSuccesses >= minimumPlayback
        && current.sourceSha256 && current.sourceSha256 !== before.sourceSha256
        && media?.decodedFrames > 0 && media.sourceFrameCallbacks > 0
        && media.frameCallbacks > (before.media?.frameCallbacks || 0)
        && media.width > 0 && media.height > 0 && media.readyState >= 2 && !media.paused && !media.errorCode
        && Number.isFinite(media.duration) && media.duration > 0) {
        assertIdentity(current, index);
        return { outcome: 'playing', state: current, diagnosticDelta: delta };
      }
      const locked = directory.episodes.find(episode => episode.index === index)?.locked === true;
      if ((current.ui.errorVisible && current.diagnostics.mediaStatus === 'failed')
        || (locked && current.ui.selectedDisabled && current.ui.placeholderText)) {
        assertIdentity(current, index);
        return { outcome: 'rejected', state: current, diagnosticDelta: delta, locked };
      }
    }
    await sleep(200);
  }
  throw new assert.AssertionError({ message: 'The actual episode neither decoded a new first frame nor displayed a terminal error within 60 seconds' });
}

async function verifyOutcome(index, before, outcome, label) {
  const result = { index, episodeId: directory.episodes.find(episode => episode.index === index).vid,
    outcome: outcome.outcome, playbackPassed: false, technicalChecksPassed: false,
    videoPlaybackStatus: 'not-tested', audioOutputStatus: 'not-tested',
    before, firstOutcome: outcome.state, diagnosticDelta: outcome.diagnosticDelta };
  if (outcome.outcome === 'playing') {
    const known = manifest.durations.get(index);
    if (known) check(known.vid === result.episodeId && Math.abs(known.duration - outcome.state.media.duration) < 0.15,
      'The actual media duration does not match the existing real episode provenance');
    result.duration = { actualSeconds: outcome.state.media.duration,
      ...(known ? { manifestSeconds: known.duration, matchedExistingProvenance: true } : {}),
      productionOfficialSourceValidated: outcome.state.diagnostics.sourceRoute === 'web'
        && outcome.state.diagnostics.routeId === 'official-web-public-fallback',
      directoryProvidesDuration: false };
    result.continuousPlayback = await harness.advance(30);
    const after = await snapshot();
    assertIdentity(after, index);
    assertSilent(after);
    check(after.sourceSha256 === outcome.state.sourceSha256
      && Math.abs(after.media.duration - outcome.state.media.duration) < 0.15,
    'The actual source or duration changed during the episode observation');
    result.after = after;
    result.playbackPassed = true;
    result.videoPlaybackStatus = 'passed';
  } else {
    result.videoPlaybackStatus = 'blocked-at-source';
    check(outcome.locked || outcome.state.diagnostics.lastErrorCode,
      'The production rejection did not expose an actual diagnostic fault');
    check(outcome.diagnosticDelta.playbackSuccesses === 0, 'A rejected episode reported a new playback success');
    result.rejection = { actualFaultCode: outcome.state.diagnostics.lastErrorCode || null,
      directoryLocked: outcome.locked === true, visibleError: outcome.state.ui.errorText || outcome.state.ui.placeholderText,
      observationRequiredMs: REJECTION_OBSERVATION, prefetchEnabled: label === 'ended-transition' };
    const started = Date.now();
    while (Date.now() - started < REJECTION_OBSERVATION) {
      await sleep(400);
      const current = await snapshot();
      assertIdentity(current, index);
      assertSilent(current);
      check(['sourceAttempts', 'sourceSuccesses', 'sourceFailures', 'playbackSuccesses', 'recoveries'].every(key =>
        current.diagnostics.counts[key] === outcome.state.diagnostics.counts[key]),
      'The rejected episode repeated a source/prefetch attempt or reported a new playback success');
      check((current.ui.errorVisible && current.diagnostics.mediaStatus === 'failed')
        || (outcome.locked && current.ui.selectedDisabled && current.ui.placeholderText),
      'The rejected episode lost its visible terminal error during observation');
      check((current.media?.frameCallbacks || 0) === (outcome.state.media?.frameCallbacks || 0)
        && (current.media?.decodedFrames || 0) === (outcome.state.media?.decodedFrames || 0)
        && (!current.media || current.media.paused || !current.sourceSha256),
      'The rejected episode continued to decode or play a wrong-episode video');
      result.after = current;
    }
    result.rejection.observedMs = Date.now() - started;
    result.rejection.noRepeatedSourceAttempts = true;
    result.rejection.noNewPlaybackSuccess = true;
    result.rejection.noWrongEpisodePlayback = true;
    result.rejection.noAutomaticQrLogin = true;
  }
  result.localMedia = await noLocalMedia();
  await harness.screenshot(`${label}-episode-${index}-${outcome.outcome}.png`);
  result.technicalChecksPassed = true;
  return result;
}

function safeFailure(error) {
  return error instanceof assert.AssertionError ? safeText(error.message)
    : 'The real acceptance operation failed; inspect the recorded phase locally';
}

async function runCase(index, first) {
  let result = { index, technicalChecksPassed: false, playbackPassed: false,
    videoPlaybackStatus: 'not-tested', audioOutputStatus: 'not-tested' };
  let reachedPlaying = false;
  try {
    phase = `episode-${index}-launch`;
    await launch(false);
    if (first) {
      phase = 'actual-directory-registration';
      directory = await registerDirectory();
      report.officialNetworkResolutionTested = true;
    }
    await noLocalMedia();
    const before = await snapshot();
    assertSilent(before);
    check(!before.media?.decodedFrames && before.diagnostics.counts.sourceSuccesses === 0
      && before.diagnostics.counts.playbackSuccesses === 0, 'The fresh case already contains playback evidence');
    phase = `episode-${index}-production-navigation`;
    const navigation = await productionCall(`window.electronAPI.playSeries(${JSON.stringify({
      seriesId: manifest.seriesId, vidIndex: index, resume: false })}).then(value => ({ success: value?.success === true }))`,
    'The production playSeries navigation did not finish');
    check(navigation?.success, 'The production playSeries navigation rejected the registered real episode');
    phase = `episode-${index}-actual-outcome`;
    const outcome = await waitForOutcome(index, before);
    reachedPlaying = outcome.outcome === 'playing';
    result = await verifyOutcome(index, before, outcome, 'isolated');
  } catch (error) {
    result.videoPlaybackStatus = reachedPlaying ? 'failed' : 'blocked-before-playback';
    result.failure = { phase, reason: safeFailure(error) };
    if (harness.client) {
      try { result.failure.state = await snapshot(); await harness.screenshot(`isolated-episode-${index}-failure.png`); } catch {}
    }
  } finally {
    await harness.stop();
  }
  report.cases.push(result);
}

async function runEndedTransition() {
  const fromIndex = indexes.includes(22) ? 22 : indexes[0];
  const toIndex = fromIndex + 1;
  if (!report.cases.some(value => value.index === fromIndex && value.playbackPassed)) {
    report.endedTransition = { attempted: false, fromIndex, toIndex,
      reason: 'The transition start episode did not genuinely play in its isolated case' };
    return;
  }
  if (![fromIndex, toIndex].every(index => directory.episodes.some(episode => episode.index === index))) {
    report.endedTransition = { attempted: false, fromIndex, toIndex,
      reason: 'The actual directory does not contain both transition episodes' };
    return;
  }
  report.endedTransition = { attempted: true, technicalChecksPassed: false, playbackPassed: false };
  try {
    phase = 'ended-transition-launch';
    await launch(true);
    await noLocalMedia();
    const processBaseline = await snapshot();
    const navigation = await productionCall(`window.electronAPI.playSeries(${JSON.stringify({
      seriesId: manifest.seriesId, vidIndex: fromIndex, resume: false })})`, 'The production transition start navigation did not finish');
    check(navigation?.success, 'The production transition start navigation was rejected');
    const startEpisode = await waitForOutcome(fromIndex, processBaseline);
    check(startEpisode.outcome === 'playing', 'The transition start episode did not genuinely decode before the ended transition');
    await harness.advance(3);
    const beforeEnded = await snapshot();
    phase = 'ended-transition-real-ended';
    await harness.seek(beforeEnded.media.duration - Math.min(1.5, beforeEnded.media.duration / 4));
    await harness.waitFor(async () => (await snapshot()).endedEvents > beforeEnded.endedEvents,
      'The production media did not emit a genuine ended event', 15000);
    // A permitted target may already have been sourced by production prefetch. Its new
    // source success is measured from this fresh process; its first frame is measured from the previous episode's end.
    const transitionBaseline = { ...processBaseline, media: beforeEnded.media,
      sourceSha256: beforeEnded.sourceSha256,
      diagnostics: { ...processBaseline.diagnostics, counts: { ...processBaseline.diagnostics.counts,
        playbackSuccesses: beforeEnded.diagnostics.counts.playbackSuccesses } } };
    const outcome = await waitForOutcome(toIndex, transitionBaseline, 2, 1);
    report.endedTransition = { attempted: true, realEndedEvent: true, seekNearEndUsed: true,
      fromIndex, toIndex, prefetchEnabled: true,
      sourceCountBaseline: 'fresh process, includes the transition start episode and any production prefetch',
      ...await verifyOutcome(toIndex, transitionBaseline, outcome, 'ended-transition') };
  } catch (error) {
    report.endedTransition.failure = { phase, reason: safeFailure(error) };
    try { report.endedTransition.failure.state = await snapshot(); await harness.screenshot('ended-transition-failure.png'); } catch {}
  } finally {
    await harness.stop();
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  manifest = readManifest();
  phase = 'isolated-empty-profile';
  prepareProfile();
  for (const [position, index] of indexes.entries()) {
    await runCase(index, position === 0);
    if (!directory) break;
  }
  if (args.includes('--ended-transition') && directory) await runEndedTransition();
  else report.endedTransition = { attempted: false, reason: 'Enable --ended-transition for genuine next-episode boundary coverage' };
  report.technicalChecksPassed = report.cases.length === indexes.length
    && report.cases.every(value => value.technicalChecksPassed)
    && (!report.endedTransition.attempted || report.endedTransition.technicalChecksPassed);
  report.laterPlaybackPassed = report.cases.length === indexes.length && report.cases.every(value => value.playbackPassed)
    && (!report.endedTransition.attempted || report.endedTransition.playbackPassed);
  // An honest, stable official rejection passes technical safeguards, never playback acceptance.
  if (!report.technicalChecksPassed) process.exitCode = 1;
  else if (!report.laterPlaybackPassed) process.exitCode = 2;
}

module.exports = { readManifest };

if (require.main === module) main().catch(error => {
  report.failure = { phase, reason: safeFailure(error) };
  process.exitCode = 1;
}).finally(async () => {
  try { await harness?.stop(); } catch { report.cleanupFailed = true; process.exitCode = 1; }
  if (profile && !report.cleanupFailed) {
    const resolved = path.resolve(profile);
    if (path.dirname(resolved) === path.resolve(PROFILE_ROOT) && path.basename(resolved).startsWith('hongguo-player-later-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    } else { report.cleanupFailed = true; process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ technicalChecksPassed: report.technicalChecksPassed,
    laterPlaybackPassed: report.laterPlaybackPassed, failurePhase: report.failure?.phase || null,
    report: path.relative(ROOT, path.join(output, 'result.json')) }));
});
