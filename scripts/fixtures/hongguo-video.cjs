// Random genuine public Hongguo footage for decoder checks. Never plays audio or writes app data.
const fs = require('node:fs');
const path = require('node:path');
const { randomInt, createHash } = require('node:crypto');
const axios = require('axios');
const { browseList } = require('../../src/native/catalog');
const hongguo = require('../../src/native/hongguo');
const { isPublicMediaUrl, webMediaRequestOptions } = require('../../src/native/web-media-guard');

async function downloadTestMedia(directory) {
  const catalog = await browseList({ category: 'real-drama', page: 1, allowTrustedDns: true });
  if (!catalog.success || !catalog.results?.length) throw new Error('无法读取红果真实测试素材目录');
  const candidates = [...catalog.results];
  for (let i = candidates.length - 1; i > 0; i--) {
    const next = randomInt(i + 1);
    [candidates[i], candidates[next]] = [candidates[next], candidates[i]];
  }
  for (const series of candidates.slice(0, 4)) {
    try {
      const detail = await hongguo.fetchEpisodeList(series.series_id, { deadline: Date.now() + 15000 });
      const episodes = detail.episodes.filter(episode => episode.web_available === true && !episode.locked);
      if (!episodes.length) continue;
      const episode = episodes[randomInt(episodes.length)];
      const page = `https://hongguoduanju.com/player/${series.series_id}/${episode.vid}`;
      const response = await axios.get(page, {
        ...webMediaRequestOptions(page, { trustedOfficialDns: true }),
        timeout: 15000, maxContentLength: 8 * 1024 * 1024, responseType: 'text',
        headers: { 'User-Agent': hongguo.WEB_UA },
      });
      let media;
      for (const script of response.data.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1])) continue;
        let data;
        try { data = JSON.parse(script[2]); } catch (_) { continue; }
        if (data?.['@type'] !== 'VideoObject' || !isPublicMediaUrl(data.contentUrl)) continue;
        const owner = new URL(data.url), url = new URL(data.contentUrl);
        if (owner.origin !== 'https://hongguoduanju.com' || owner.username || owner.password) continue;
        if (owner.href !== page && !(owner.pathname === `/player/${series.series_id}`
          && url.origin === owner.origin && url.pathname.startsWith(`/video/public/${episode.vid}/`))) continue;
        media = url.href;
        break;
      }
      if (!media) continue;
      const downloaded = await axios.get(media, {
        ...webMediaRequestOptions(media, { trustedOfficialDns: true }),
        timeout: 30000, maxContentLength: 32 * 1024 * 1024, responseType: 'arraybuffer',
        headers: { 'User-Agent': hongguo.WEB_UA, Referer: hongguo.WEB_REFERER },
      });
      const bytes = Buffer.from(downloaded.data);
      if (bytes.length < 1024 || bytes.subarray(4, 8).toString() !== 'ftyp') continue;
      fs.mkdirSync(directory, { recursive: true });
      const video = path.join(directory, 'hongguo-source.mp4');
      fs.writeFileSync(video, bytes, { mode: 0o600 });
      const provenance = { seriesId: String(series.series_id), title: series.series_title, episodeId: String(episode.vid),
        episodeIndex: episode.vid_index, page, downloadedAt: new Date().toISOString(), bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        limitation: '官网公开片段，可能仅为预览；用于解码回归，不代表完整分集播放验收。全程不播放音频。' };
      fs.writeFileSync(path.join(directory, 'hongguo-source.json'), JSON.stringify(provenance, null, 2) + '\n');
      console.log('Hongguo real-media provenance: ' + JSON.stringify(provenance));
      return video;
    } catch (_) { /* Try another randomly selected public title; never print signed media URLs. */ }
  }
  throw new Error('随机真实红果素材下载失败；未使用彩条或测试图替代');
}

module.exports = { downloadTestMedia };
