// Capture two complete public episodes for silent desktop acceptance, with no account or App fallback.
// node scripts/capture-official-public-media.cjs --output-dir dist/independent-audit
// ELECTRON_RUN_AS_NODE=1 electron scripts/capture-official-public-media.cjs --series-manifest previous/manifest.json --indexes 5 --output-dir fresh
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const axios = require('axios');
const hongguo = require('../src/native/hongguo');
const { isPublicMediaUrl, webMediaRequestOptions } = require('../src/native/web-media-guard');

const root = path.resolve(__dirname, '..');
let output = path.join(root, 'dist', 'independent-audit');
let phase = 'arguments';
let directory;
const report = { schema: 1, appVersion: require('../package.json').version, startedAt: new Date().toISOString(),
  selection: 'random', source: 'official-public-complete', audioOutput: 'none', phoneUsed: false,
  accountAuthenticationTested: false, runtime: { node: process.versions.node,
    electron: process.versions.electron || null, chrome: process.versions.chrome || null,
    electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE === '1' }, episodes: [] };

function argumentsForCapture() {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i], value = process.argv[i + 1];
    assert.ok(['--output-dir', '--series-manifest', '--indexes'].includes(flag)
      && typeof value === 'string' && value.length > 0 && !value.startsWith('--')
      && options[flag] === undefined, 'Capture arguments are invalid');
    options[flag] = value;
  }
  assert.equal(Boolean(options['--series-manifest']), Boolean(options['--indexes']),
    'Reusing a random series requires both its manifest and explicit episode indexes');
  if (options['--output-dir']) output = path.resolve(options['--output-dir']);
  if (!options['--series-manifest']) return { indexes: [1, 2] };
  assert.match(options['--indexes'], /^[1-9]\d*(?:,[1-9]\d*)*$/, 'Episode indexes must be positive integers');
  const indexes = options['--indexes'].split(',').map(Number);
  assert.ok(indexes.every(Number.isSafeInteger) && new Set(indexes).size === indexes.length,
    'Episode indexes must be unique safe integers');
  const manifest = path.resolve(options['--series-manifest']);
  const comparablePath = value => process.platform === 'win32' ? value.toLowerCase() : value;
  assert.notEqual(comparablePath(manifest), comparablePath(path.join(output, 'manifest.json')),
    'Preserve the original selection manifest');
  return { manifest, indexes };
}

function readRandomSelection(file) {
  const stat = fs.statSync(file);
  assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 256 * 1024, 'Selection manifest size is invalid');
  const bytes = fs.readFileSync(file);
  const previous = JSON.parse(bytes.toString('utf8'));
  const validId = value => typeof value === 'string' && /^\d{1,30}$/.test(value);
  const validTitle = value => typeof value === 'string' && value.trim().length > 0
    && value.length <= 500 && !/[\x00-\x1f\x7f]/.test(value);
  assert.ok(previous.schema === 1 && previous.passed === true && previous.selection === 'random'
    && previous.source === 'official-public-complete' && previous.phoneUsed === false
    && previous.audioOutput === 'none' && previous.accountAuthenticationTested === false
    && Number.isSafeInteger(previous.selectedRandomlyFrom) && previous.selectedRandomlyFrom > 1
    && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(previous.appVersion || '')
    && typeof previous.startedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(previous.startedAt)
    && Number.isFinite(Date.parse(previous.startedAt))
    && validId(previous.seriesId) && validTitle(previous.title)
    && Array.isArray(previous.episodes) && previous.episodes.length >= 2,
  'An existing successful random official selection is required');
  const ids = new Set(), indexes = new Set();
  for (const episode of previous.episodes) {
    assert.ok(episode.seriesId === previous.seriesId && episode.title === previous.title
      && validId(episode.episodeId) && Number.isSafeInteger(episode.episodeIndex) && episode.episodeIndex > 0
      && !ids.has(episode.episodeId) && !indexes.has(episode.episodeIndex)
      && episode.source === 'web' && episode.profileId === 'hongguo-official-web-public-v1'
      && episode.routeId === 'official-web-public-fallback' && episode.wholeEpisodeSilentDecode === 'passed'
      && episode.decoderErrorBytes === 0 && /^[a-f0-9]{64}$/.test(episode.sha256 || '')
      && Number.isSafeInteger(episode.bytes) && episode.bytes > 100 * 1024
      && Number.isFinite(episode.duration) && episode.duration > 15
      && Number.isFinite(episode.fileDuration) && Math.abs(episode.duration - episode.fileDuration) <= 0.15,
    'Selection manifest episode provenance is invalid');
    ids.add(episode.episodeId);
    indexes.add(episode.episodeIndex);
  }
  report.selection = 'reused-random-series';
  report.seriesId = previous.seriesId;
  report.title = previous.title;
  report.selectionProvenance = { mode: 'reuse-existing-random-series', originalSelection: previous.selection,
    originalSelectedRandomlyFrom: previous.selectedRandomlyFrom, originalStartedAt: previous.startedAt,
    originalAppVersion: previous.appVersion, manifestSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    validatedPriorEpisodes: previous.episodes.length };
  return previous;
}

function tool(name) {
  return process.env[name === 'ffmpeg' ? 'HONGGUO_FFMPEG' : 'HONGGUO_FFPROBE']
    || path.join(root, 'build', 'ffmpeg', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
}

function mediaCommand(name, args) {
  const result = spawnSync(tool(name), args, { windowsHide: true, encoding: 'utf8', timeout: 180000,
    maxBuffer: 4 * 1024 * 1024 });
  assert.ok(!result.error && result.status === 0, 'Complete silent media validation failed');
  return result;
}

async function main() {
  const options = argumentsForCapture();
  let previous;
  if (options.manifest) {
    phase = 'selection-manifest';
    previous = readRandomSelection(options.manifest);
  } else {
    phase = 'catalog';
    const { browseList } = require('../src/native/catalog');
    const catalog = await browseList({ category: 'real-drama', page: 1, forceRefresh: true });
    assert.ok(catalog.success && catalog.results?.length > 1, 'Real official catalog is unavailable');
    report.selectedRandomlyFrom = catalog.results.length;
    const selected = catalog.results[crypto.randomInt(catalog.results.length)];
    report.seriesId = String(selected.series_id);
    report.title = selected.series_title;
  }
  phase = 'episodes';
  const detail = await hongguo.fetchEpisodeListFromWeb(report.seriesId, Date.now() + 12000);
  assert.ok(detail.source === 'web' && detail.series_id === report.seriesId && detail.series_title === report.title
    && Array.isArray(detail.episodes) && detail.episodes.length > 0,
  'Fresh official episode identity must match the selected series');
  if (previous) {
    for (const old of previous.episodes) {
      const fresh = detail.episodes.find(episode => episode.vid_index === old.episodeIndex);
      assert.ok(fresh && String(fresh.vid) === old.episodeId, 'Fresh official episode IDs must match selection provenance');
    }
  }
  const episodes = options.indexes.map(index => detail.episodes.find(episode => episode.vid_index === index));
  assert.ok(episodes.every(episode => episode && /^\d{1,30}$/.test(String(episode.vid))
    && episode.series_id === report.seriesId && episode.series_title === report.title),
  'Requested episodes must exist in the fresh official directory');
  if (!previous) assert.ok(episodes.length === 2 && episodes[1].vid_index === episodes[0].vid_index + 1,
    'Two consecutive real episodes are required');
  report.requestedIndexes = options.indexes;
  report.freshOfficialDirectory = { source: detail.source, episodeCount: detail.episodes.length,
    accessibleEpisodeCount: detail.web_accessible_episodes, fetchedAt: new Date().toISOString() };
  fs.mkdirSync(output, { recursive: true });
  directory = fs.mkdtempSync(path.join(output, 'official-media-'));
  for (const episode of episodes) {
    phase = `source-${episode.vid_index}`;
    assert.ok(Number.isSafeInteger(detail.web_accessible_episodes) && detail.web_accessible_episodes >= 0
      && detail.web_accessible_episodes <= detail.episodes.length, 'Fresh official public episode window is invalid');
    if (episode.web_available !== true) {
      throw Object.assign(new Error('Official website does not provide this episode'), { code: 'WEB_EPISODE_UNAVAILABLE' });
    }
    let sourceFailure;
    const started = Date.now();
    const info = await hongguo.fetchPlayUrlFromWeb(episode.vid, report.seriesId, error => { sourceFailure = error; },
      { force: true });
    if (!info) throw sourceFailure || new Error('Official public source unavailable');
    assert.ok(info.officialPublicPlayback === true && info.source === 'web' && !info.contentKey && !info.spadeA
      && info.profileId === 'hongguo-official-web-public-v1' && info.routeId === 'official-web-public-fallback'
      && info.format === 'mp4' && info.duration > 15 && isPublicMediaUrl(info.url),
    'Only explicitly public complete unencrypted media is accepted');
    assert.ok(typeof info.userAgent === 'string' && info.userAgent.length <= 512 && !/[\r\n]/.test(info.userAgent)
      && (!process.versions.electron || info.userAgent.includes(`Electron/${process.versions.electron}`))
      && (!process.versions.chrome || info.userAgent.includes(`Chrome/${process.versions.chrome}`)),
    'Playback user agent must identify the actual running desktop runtime');
    report.runtime.userAgent = info.userAgent;
    const elapsedMs = Date.now() - started;
    phase = `download-${episode.vid_index}`;
    const response = await axios.get(info.url, { ...webMediaRequestOptions(info.url), maxRedirects: 0,
      headers: { 'User-Agent': info.userAgent, Referer: info.referer, 'Accept-Encoding': 'identity' },
      responseType: 'arraybuffer', timeout: 60000, maxContentLength: 300 * 1024 * 1024 });
    assert.equal(response.status, 200, 'A complete response is required');
    const bytes = Buffer.from(response.data);
    const downloadedAt = new Date().toISOString();
    const declared = Number(response.headers['content-length']);
    assert.ok(bytes.length > 100 * 1024 && bytes.subarray(4, 8).toString() === 'ftyp'
      && Number.isSafeInteger(declared) && declared === bytes.length, 'Complete MP4 bytes are required');
    const file = path.join(directory, `episode-${episode.vid_index}.mp4`);
    fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    phase = `probe-${episode.vid_index}`;
    const probe = JSON.parse(mediaCommand('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).stdout);
    const video = probe.streams?.find(stream => stream.codec_type === 'video');
    const audio = probe.streams?.find(stream => stream.codec_type === 'audio');
    const duration = Number(probe.format?.duration);
    assert.ok(video?.width > 0 && video.height > 0 && Number.isFinite(duration)
      && Math.abs(duration - info.duration) <= 0.15, 'Official and complete file durations must match');
    phase = `decode-${episode.vid_index}`;
    const decoded = mediaCommand('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-nostdin', '-i', file,
      '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-']);
    assert.equal(decoded.stderr, '', 'Complete silent decode must produce no decoder errors');
    report.episodes.push({ seriesId: report.seriesId, title: report.title, episodeId: String(episode.vid),
      episodeIndex: episode.vid_index, source: info.source, profileId: info.profileId, routeId: info.routeId,
      elapsedMs, downloadedAt, file: path.relative(output, file).split(path.sep).join('/'),
      bytes: bytes.length, sha256, duration: info.duration, fileDuration: duration,
      videoCodec: video.codec_name, width: video.width, height: video.height,
      audioCodec: audio?.codec_name || '', wholeEpisodeSilentDecode: 'passed', decoderErrorBytes: 0 });
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ phase: 'episode-complete', ...report.episodes.at(-1) }));
  }
  report.passed = true;
  report.completedAt = new Date().toISOString();
  report.limitation = 'This verifies the recorded complete public MP4 files, not account authorization, protected episodes, speaker output or desktop GUI playback.';
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, selection: report.selection, selectedRandomlyFrom: report.selectedRandomlyFrom,
    seriesId: report.seriesId, episodes: report.episodes.length, manifest: path.relative(root, path.join(output, 'manifest.json')) }));
}

main().catch(error => {
  // Never serialize transport errors: they can retain URLs and request details.
  const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code || '') ? error.code : 'VALIDATION_FAILED';
  const failure = { passed: false, phase, code, status: Number(error?.status || error?.response?.status) || 0 };
  if (directory) {
    Object.assign(report, failure, { completedAt: new Date().toISOString() });
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.error(JSON.stringify(failure));
  process.exitCode = 1;
});
