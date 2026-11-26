// Live App source probe. Prints only safe diagnostics: status, body length,
// business code, and whether a matching episode model was found.
// Never prints media URLs, device identifiers or signed query strings.
const appSource = require('../src/native/app-source');
const playbackDevice = require('../src/native/playback-device');
const { getPlaybackProfile, getPlaybackRouteProfile, UPSTREAM_PLAYBACK_PROFILE } = require('../src/native/playback-profiles');

const SERIES = process.argv[2] || '7706404415887903806';
const MAX_EPISODE = Number(process.argv[3] || 0) || null;

const safe = value => {
  const text = String(value || '');
  return /^[A-Z][A-Z0-9_]{2,40}$/.test(text) ? text : 'UNKNOWN';
};

(async () => {
  const hongguo = require('../src/native/hongguo');
  const detail = await hongguo.fetchEpisodeList(SERIES);
  const episodes = detail.episodes;
  console.log(JSON.stringify({ stage: 'catalog', title: String(detail.series_title || '').slice(0, 60), episodes: episodes.length }));

  const sample = MAX_EPISODE
    ? episodes.filter(item => Number(item.vid_index) === MAX_EPISODE)
    : episodes.slice(0, Math.min(3, episodes.length));

  const identity = await playbackDevice.registerPlaybackDevice(async (url, options, deadline, signal) => {
    const axios = require('axios');
    const response = await axios({ ...options, url, timeout: Math.max(1, deadline - Date.now()), signal,
      responseType: 'text', transformResponse: [data => data], maxRedirects: 0,
      maxContentLength: 2 * 1024 * 1024, validateStatus: () => true });
    return JSON.parse(response.data);
  });
  console.log(JSON.stringify({ stage: 'identity', registered: !!identity.device_id }));

  for (const episode of sample) {
    const vid = String(episode.vid);
    const started = Date.now();
    const row = { vidIndex: Number(episode.vid_index) };
    try {
      const result = await appSource.fetchAppPlayUrl(vid, { force: true, onPlaybackEvent: event => {
        (row.trace ||= []).push({ route: event.routeId, code: safe(event.code), modelValid: !!event.modelValid });
      } });
      row.ok = true;
      row.route = result.routeId;
      row.duration = Number(result.expectedDuration) || null;
      row.contentKey = !!result.contentKey;
    } catch (error) {
      row.ok = false;
      row.code = safe(error.code);
      row.status = Number(error.status) || null;
    }
    row.elapsedMs = Date.now() - started;
    console.log(JSON.stringify(row));
  }

  // Direct body-shape probes against the bundled preload profile.
  const axios = require('axios');
  const profile = getPlaybackProfile();
  const target = episodes[0];
  const variants = [
    { name: 'preload-as-is', kind: 'post', endpoint: profile.routes[0].endpoint, drScene: 'preload', deviceLevel: 2 },
    { name: 'player-scene', kind: 'post', endpoint: 'https://reading.snssdk.com/novel/player/multi_video_model/player/v1', drScene: 'player', deviceLevel: 1 },
    { name: 'v1-no-scene', kind: 'post', endpoint: 'https://reading.snssdk.com/novel/player/multi_video_model/v1/', drScene: null, deviceLevel: 2 },
    { name: 'detail-preload', kind: 'post', endpoint: 'https://reading.snssdk.com/novel/player/multi_video_detail/preload/v1', drScene: 'preload', deviceLevel: 2 },
    { name: 'video-tab-get', kind: 'get', endpoint: 'https://api5-normal-sinfonlineb.fqnovel.com/reading/bookapi/video_tab/multi_video_model/v1/', drScene: null, deviceLevel: 1 },
  ];
  for (const variant of variants) {
    const outcome = { variant: variant.name };
    try {
      let request;
      if (variant.kind === 'get') {
        request = appSource.videoTabRequest(identity, target.vid);
      } else {
        const payload = { biz_param: { ...profile.body.biz_param, device_level: variant.deviceLevel },
          mixed_video_id_map: { '1004': [String(target.vid)] } };
        if (variant.drScene) payload.dr_scene = variant.drScene;
        const body = require('node:zlib').gzipSync(Buffer.from(JSON.stringify(payload)));
        const { signPlaybackV5 } = require('../src/native/playback-v5');
        const signed = signPlaybackV5({ base: variant.endpoint,
          values: { ...profile.app, iid: identity.iid, cdid: identity.cdid, device_id: identity.device_id },
          body, now: Date.now() });
        request = { ...signed, body, method: 'POST',
          headers: { ...signed.headers, 'User-Agent': profile.userAgent, ...profile.headers } };
      }
      const response = await axios({ url: request.url, method: request.method, headers: request.headers,
        data: request.body ?? undefined, timeout: 12000, responseType: 'text',
        transformResponse: [data => data], maxRedirects: 0, maxContentLength: 2 * 1024 * 1024,
        validateStatus: () => true });
      const raw = typeof response.data === 'string' ? response.data : '';
      outcome.status = response.status;
      outcome.bytes = raw.length;
      if (raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          outcome.code = parsed?.code ?? parsed?.Code ?? null;
          outcome.hasData = !!parsed?.data;
          outcome.dataKeys = parsed?.data && typeof parsed.data === 'object'
            ? Object.keys(parsed.data).slice(0, 6).map(key => (/^\d+$/.test(key) ? 'numeric-key' : key)) : [];
        } catch { outcome.json = false; }
      }
    } catch (error) {
      outcome.error = safe(error.code);
      outcome.status = Number(error.status) || null;
    }
    console.log(JSON.stringify(outcome));
  }
})().catch(error => { console.error(JSON.stringify({ stage: 'fatal', code: safe(error.code), message: String(error.message).slice(0, 120) })); process.exitCode = 1; });
