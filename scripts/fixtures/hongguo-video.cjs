// Random genuine public Hongguo footage for decoder checks. Never plays audio or writes app data.
const fs = require('node:fs');
const path = require('node:path');
const { randomInt, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const axios = require('axios');
const { browseList, readRouterData } = require('../../src/native/catalog');
const hongguo = require('../../src/native/hongguo');
const { isPublicMediaUrl, webMediaRequestOptions } = require('../../src/native/web-media-guard');

async function requestPublic(url, responseType, maxContentLength) {
  let lastError;
  for (const trustedOfficialDns of [true, false]) {
    try {
      return await axios.get(url, { ...webMediaRequestOptions(url, { trustedOfficialDns }),
        timeout: 15000, maxContentLength, responseType,
        headers: { 'User-Agent': hongguo.WEB_UA, Referer: hongguo.WEB_REFERER } });
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function downloadTestMedia(directory) {
  if (process.env.HONGGUO_VIDEO_FIXTURE) {
    const source = path.resolve(process.env.HONGGUO_VIDEO_FIXTURE);
    const manifestFile = path.resolve(process.env.HONGGUO_VIDEO_FIXTURE_MANIFEST || path.join(path.dirname(source), 'manifest.json'));
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const record = manifest.episodes?.find(episode => typeof episode.file === 'string'
      && path.resolve(path.dirname(manifestFile), episode.file) === source);
    if (!(Number.isSafeInteger(manifest.selectedRandomlyFrom) && manifest.selectedRandomlyFrom > 1)
      || record?.source !== 'web' || record.profileId !== 'hongguo-official-web-public-v1'
      || record.routeId !== 'official-web-public-fallback' || !Number.isFinite(record.duration) || record.duration <= 15
      || !/^[a-f0-9]{64}$/i.test(record.sha256 || '')) throw new Error('External official video provenance is invalid');
    const bytes = fs.readFileSync(source);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== record.bytes || bytes.length <= 100 * 1024 || bytes.subarray(4, 8).toString() !== 'ftyp'
      || sha256 !== record.sha256.toLowerCase()) throw new Error('External official video does not match its recorded bytes');
    const ffprobe = process.env.HONGGUO_FFPROBE, ffmpeg = process.env.HONGGUO_FFMPEG;
    if (!ffprobe || !ffmpeg) throw new Error('External official video requires explicit FFmpeg and ffprobe');
    let metadata;
    try {
      metadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries',
        'stream=codec_type,width,height:format=duration', '-of', 'json', source],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }));
      execFileSync(ffmpeg, ['-v', 'error', '-xerror', '-nostdin', '-i', source,
        '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
    } catch (_) { throw new Error('External official video failed probing or complete silent decoding'); }
    const duration = Number(metadata.format?.duration);
    if (!metadata.streams?.some(stream => stream.codec_type === 'video' && stream.width > 0 && stream.height > 0)
      || !Number.isFinite(duration) || Math.abs(duration - record.duration) > 0.15) {
      throw new Error('External official video does not match its recorded complete duration');
    }
    fs.mkdirSync(directory, { recursive: true });
    const video = path.join(directory, 'hongguo-source.mp4');
    fs.copyFileSync(source, video, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(video, 0o600);
    const provenance = { source: 'externally-supplied-official-complete', bytes: bytes.length, sha256,
      duration, selectedRandomlyFrom: manifest.selectedRandomlyFrom, wholeEpisodeSilentDecode: 'passed',
      limitation: 'Local media regression; does not establish current network playback or account authorization.' };
    fs.writeFileSync(path.join(directory, 'hongguo-source.json'), JSON.stringify(provenance, null, 2) + '\n', { mode: 0o600 });
    console.log('Hongguo external real-media fixture: provenance, bytes, duration and complete silent decode verified');
    return video;
  }
  const catalog = await browseList({ category: 'real-drama', page: 1, allowTrustedDns: true });
  if (!catalog.success || !catalog.results?.length) throw new Error('无法读取红果真实测试素材目录');
  const candidates = [...catalog.results];
  for (let i = candidates.length - 1; i > 0; i--) {
    const next = randomInt(i + 1);
    [candidates[i], candidates[next]] = [candidates[next], candidates[i]];
  }
  for (const series of candidates.slice(0, 4)) {
    let stage = 'page';
    try {
      // Let the official canonical player choose its currently public episode, rather than a possibly locked deep link.
      const page = `https://hongguoduanju.com/player/${series.series_id}`;
      const response = await requestPublic(page, 'text', 8 * 1024 * 1024);
      stage = 'metadata';
      const router = readRouterData(response.data);
      const player = router.loaderData?.['player_(series_id)/page'] || router.loaderData?.['player_(series_id)/(vid)/page'];
      const vid = String(player?.vid || '');
      // The official player now publishes opaque v1_ episode IDs instead of numeric ones
      // (2026-11-27); both forms identify the current player's episode, so accept each.
      if (String(player?.series_id) !== String(series.series_id) || !/^(?:\d{6,30}|v1_[A-Za-z0-9_-]{10,64})$/.test(vid)
        || player.publicVideoSeo?.available !== true || String(player.publicVideoSeo.itemId) !== vid) {
        throw Object.assign(new Error('No public episode'), { code: 'NO_PUBLIC_EPISODE' });
      }
      let media;
      for (const script of response.data.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1])) continue;
        let data;
        try { data = JSON.parse(script[2]); } catch (_) { continue; }
        if (data?.['@type'] !== 'VideoObject' || !isPublicMediaUrl(data.contentUrl)) continue;
        const owner = new URL(data.url, page), url = new URL(data.contentUrl);
        if (owner.origin !== 'https://hongguoduanju.com' || owner.username || owner.password) continue;
        if (owner.pathname !== `/player/${series.series_id}/${vid}` && !(owner.pathname === `/player/${series.series_id}`
          && url.origin === owner.origin && url.pathname.startsWith(`/video/public/${vid}/`))) continue;
        media = url.href;
        break;
      }
      if (!media) throw Object.assign(new Error('No public video metadata'), { code: 'NO_PUBLIC_MEDIA' });
      stage = 'download';
      const downloaded = await requestPublic(media, 'arraybuffer', 32 * 1024 * 1024);
      const bytes = Buffer.from(downloaded.data);
      if (bytes.length < 1024 || bytes.subarray(4, 8).toString() !== 'ftyp') {
        throw Object.assign(new Error('Invalid MP4'), { code: 'INVALID_MP4' });
      }
      fs.mkdirSync(directory, { recursive: true });
      const video = path.join(directory, 'hongguo-source.mp4');
      fs.writeFileSync(video, bytes, { mode: 0o600 });
      const index = player.seriesDetail?.vid_list?.findIndex(item => String(item) === vid) ?? -1;
      const provenance = { seriesId: String(series.series_id), title: series.series_title, episodeId: vid,
        episodeIndex: index >= 0 ? index + 1 : null, page, downloadedAt: new Date().toISOString(), bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        limitation: '官网公开片段，可能仅为预览；用于解码回归，不代表完整分集播放验收。全程不播放音频。' };
      fs.writeFileSync(path.join(directory, 'hongguo-source.json'), JSON.stringify(provenance, null, 2) + '\n');
      console.log('Hongguo real-media provenance: ' + JSON.stringify(provenance));
      return video;
    } catch (error) {
      // Diagnostics identify the failing stage without URLs, response bodies, credentials or keys.
      console.warn('Hongguo real-media candidate unavailable: ' + JSON.stringify({ seriesId: String(series.series_id), stage,
        reason: error.code || 'UNAVAILABLE', status: error.response?.status || null }));
    }
  }
  throw new Error('随机真实红果素材下载失败；未使用彩条或测试图替代');
}

module.exports = { downloadTestMedia };
