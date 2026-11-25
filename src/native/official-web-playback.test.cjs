const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { OFFICIAL_WEB_PROFILE, publicEpisodePermission, officialDuration, fallbackMedia, movieDuration,
  resolveOfficialPublicPlayback } = require('./official-web-playback');

const NOW = 1800000000000;
const MEDIA = 'https://v11-hgweb.qznovelvod.com/public-fixture.mp4';
function player(overrides = {}) {
  return { isSuccess: true, protectedPlayback: true, series_id: '123', vid: '456',
    req: { pcLoginRequired: false, pcAuthenticatedPlayback: false, encryptedBrowserAllowed: false },
    seriesDetail: { series_id: '123', pay_type: 0, vid_list: ['456', '457'], accessible_episode_cnt: 2 },
    publicVideoSeo: { available: true, itemId: '456', seriesId: '123', durationSeconds: 120 }, ...overrides };
}
function windowPlayer(index, overrides = {}) {
  const vids = ['451', '452', '453', '454', '455', '456'];
  return player({ vid: vids[index - 1],
    seriesDetail: { series_id: '123', pay_type: 0, vid_list: vids, accessible_episode_cnt: 5 },
    publicVideoSeo: { available: true, itemId: vids[index - 1], seriesId: '123', durationSeconds: 120 }, ...overrides });
}
function api(overrides = {}) {
  return { base_resp: { StatusCode: 0 }, main_url: MEDIA, server_time: NOW / 1000,
    url_expire: NOW / 1000 + 3600, ...overrides };
}
function box(type, contents) {
  const bytes = Buffer.alloc(contents.length + 8);
  bytes.writeUInt32BE(bytes.length); bytes.write(type, 4); contents.copy(bytes, 8);
  return bytes;
}
function movie(seconds = 120, version = 0) {
  const header = Buffer.alloc(version ? 32 : 20);
  header[0] = version;
  header.writeUInt32BE(1000, version ? 20 : 12);
  if (version) header.writeBigUInt64BE(BigInt(Math.round(seconds * 1000)), 24);
  else header.writeUInt32BE(Math.round(seconds * 1000), 16);
  return Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', box('mvhd', header))]);
}
function native(dependencies = {}) {
  const filename = require.resolve('./hongguo');
  const localRequire = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.parseBoxes = parseBoxes;', {
    module, require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : localRequire(name),
    Buffer, URL, URLSearchParams, AbortController, AbortSignal, process: { env: {} },
    console: { warn() {} }, setTimeout, clearTimeout,
  }, { filename });
  return module.exports;
}
const { parseBoxes } = native();
function fixture({ response = api(), bytes = movie(), metadata, fail } = {}) {
  const requests = [], events = [];
  const request = async config => {
    requests.push(config);
    if (fail) throw fail;
    if (config.method === 'POST') return { status: 200, headers: {}, data: response };
    return metadata || { status: 206, headers: { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length + 1000}` }, data: bytes };
  };
  return { requests, events, options: { vid: '456', seriesId: '123', parseBoxes, request, now: () => NOW,
    onPlaybackEvent: event => events.push(event), userAgent: 'Official web fixture' } };
}

function legacyFixture(data = player({ protectedPlayback: false }), bytes = movie(), mediaUrl = MEDIA) {
  const calls = [];
  const html = `<script>window._ROUTER_DATA=${JSON.stringify({ loaderData: {
    'player_(series_id)/(vid)/page': data,
  } })}</script><script type="application/ld+json">${JSON.stringify({ '@type': 'VideoObject',
    url: 'https://hongguoduanju.com/player/123/456', contentUrl: mediaUrl })}</script>`;
  const app = native({ axios: { get: async (url, config) => {
    if (url.includes('/player/')) { calls.push({ stage: 'page', url }); return { status: 200, data: html }; }
    calls.push({ stage: 'media', config });
    return { status: 206, headers: { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length + 1000}` }, data: bytes };
  } }, './app-source': { fetchAppPlayUrl: async () => {
    calls.push({ stage: 'app' }); throw Object.assign(new Error('fixture App unavailable'), { code: 'EMPTY_RESPONSE' });
  } } });
  return { app, calls };
}

test('legacy direct media needs explicit public permission and actual complete MP4 duration', async () => {
  const f = legacyFixture();
  const result = await f.app.fetchPlayUrlSingle('456', '123');
  assert.equal(result.url, MEDIA);
  assert.equal(result.format, 'mp4');
  assert.equal(result.duration, 120);
  assert.equal(result.expectedDuration, 120);
  assert.equal(result.officialPublicPlayback, true);
  assert.deepEqual(f.calls.map(call => call.stage), ['page', 'media']);
  const request = f.calls[1].config;
  assert.equal(request.headers.Range, `bytes=0-${OFFICIAL_WEB_PROFILE.metadataBytes - 1}`);
  assert.equal(request.headers['User-Agent'], f.app.WEB_UA);
  assert.equal(request.headers.Referer, f.app.WEB_REFERER);
  assert.equal(request.maxRedirects, 0);
});

test('legacy opaque URLs are accepted as MP4 only after the actual bytes establish complete duration', async () => {
  const mediaUrl = MEDIA.replace('.mp4', '');
  const f = legacyFixture(undefined, undefined, mediaUrl);
  const result = await f.app.fetchPlayUrlFromWeb('456', '123');
  assert.equal(result.url, mediaUrl);
  assert.equal(result.format, 'mp4');
  assert.equal(result.duration, 120);
  assert.deepEqual(f.calls.map(call => call.stage), ['page', 'media']);
});

test('legacy explicit login, authenticated playback and payment requirements stop every alternate route', async () => {
  for (const flag of ['pcLoginRequired', 'pcAuthenticatedPlayback', 'payment']) {
    const data = player({ protectedPlayback: false });
    if (flag === 'payment') data.seriesDetail.pay_type = 1;
    else data.req[flag] = true;
    const f = legacyFixture(data);
    const result = await f.app.fetchPlayUrlSingle('456', '123');
    assert.equal(result.url, null, flag);
    assert.equal(result.faultCode, 'ACCOUNT_UNAUTHORIZED', flag);
    assert.deepEqual(f.calls.map(call => call.stage), ['page'], flag);
  }
});

test('legacy unknown permission, missing duration and unavailable windows cannot advertise public media', async () => {
  const unknown = player({ protectedPlayback: false, req: {} });
  const noDuration = player({ protectedPlayback: false }); delete noDuration.publicVideoSeo.durationSeconds;
  const noSeo = player({ protectedPlayback: false, publicVideoSeo: undefined });
  const outsideWindow = player({ protectedPlayback: false }); outsideWindow.seriesDetail.accessible_episode_cnt = 0;
  for (const data of [unknown, noDuration, noSeo, outsideWindow]) {
    const f = legacyFixture(data);
    const result = await f.app.fetchPlayUrlFromWeb('456', '123');
    assert.equal(result, null);
    assert.ok(f.calls.every(call => call.stage === 'page'));
  }
});

test('legacy same-episode metadata cannot authorize preview bytes or a media manifest', async () => {
  for (const bytes of [movie(15), Buffer.from('#EXTM3U\n#EXT-X-ENDLIST\n'), Buffer.from('<MPD/>')]) {
    const f = legacyFixture(undefined, bytes);
    let failure;
    const result = await f.app.fetchPlayUrlFromWeb('456', '123', error => { failure = error; });
    assert.equal(result, null);
    assert.equal(failure.stage, 'media');
    assert.ok(['PREVIEW_ONLY', 'UNSUPPORTED_MEDIA_FORMAT'].includes(failure.code));
  }
});

test('the official web profile is immutable and independent from App signing', () => {
  assert.equal(OFFICIAL_WEB_PROFILE.query.aid, 8662);
  assert.equal(OFFICIAL_WEB_PROFILE.playInfoDefinition, '720p');
  assert.ok(Object.isFrozen(OFFICIAL_WEB_PROFILE.defaultHeaders));
  assert.ok(Object.isFrozen(OFFICIAL_WEB_PROFILE.timeouts));
  assert.doesNotMatch(JSON.stringify(OFFICIAL_WEB_PROFILE), /medusa|device_id|cookie/i);
});

test('official website requests identify the actual Electron application instead of impersonating Chrome', () => {
  const { WEB_UA } = native();
  assert.ok(WEB_UA.includes(`HongGuo-PC/${require('../../package.json').version}`));
  assert.ok(WEB_UA.includes(`Electron/${require('electron/package.json').version}`));
  assert.doesNotMatch(WEB_UA, /Chrome\/122\.0\.0\.0/);
});

test('protected playback alone does not reject an explicitly public complete episode', async () => {
  const f = fixture();
  const result = await resolveOfficialPublicPlayback(player(), f.options);
  assert.equal(result.url, MEDIA);
  assert.equal(result.duration, 120);
  assert.equal(result.expiresAt, NOW + 3600000);
  assert.equal(result.officialPublicPlayback, true);
  assert.equal(result.profileId, OFFICIAL_WEB_PROFILE.id);
  assert.equal(result.routeId, OFFICIAL_WEB_PROFILE.routeId);
  assert.equal(f.requests.length, 2);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].modelValid, true);
  assert.equal(f.events[0].sourceRoute, 'web');
});

test('official public requests use the observed body and bounded media range without account credentials', async () => {
  const f = fixture();
  await resolveOfficialPublicPlayback(player(), { ...f.options, forceRefresh: true,
    cookie: 'PRIVATE_COOKIE', headers: { Cookie: 'PRIVATE_COOKIE' } });
  const [apiRequest, metadata] = f.requests;
  assert.equal(apiRequest.url, OFFICIAL_WEB_PROFILE.origin + OFFICIAL_WEB_PROFILE.fallbackPath);
  assert.deepEqual(apiRequest.data, { item_id: '456', force_refresh: true });
  assert.deepEqual(apiRequest.params, { aid: 8662 });
  assert.equal(apiRequest.headers['X-Xs-From-Web'], '1');
  assert.equal(metadata.headers.Range, `bytes=0-${OFFICIAL_WEB_PROFILE.metadataBytes - 1}`);
  for (const request of f.requests) {
    assert.equal(request.maxRedirects, 0);
    assert.equal(request.signal.aborted, false);
    assert.doesNotMatch(JSON.stringify(request.headers), /PRIVATE_COOKIE|cookie/i);
  }
  assert.doesNotMatch(JSON.stringify(f.events), /qznovelvod|PRIVATE|main_url|item_id/);
});

test('episode identity, explicit permission and public episode window are required before any API request', async () => {
  const denied = [
    player({ vid: '999' }), player({ publicVideoSeo: { available: true, itemId: '999', seriesId: '123', durationSeconds: 120 } }),
    player({ req: {} }), player({ req: { pcLoginRequired: true } }),
    player({ req: { pcLoginRequired: false, pcAuthenticatedPlayback: true, encryptedBrowserAllowed: false } }),
    player({ req: { pcLoginRequired: false, pcAuthenticatedPlayback: false, encryptedBrowserAllowed: true } }),
    player({ seriesDetail: { series_id: '123', pay_type: 1, vid_list: ['456'], accessible_episode_cnt: 1 } }),
    player({ seriesDetail: { series_id: '123', pay_type: 0, vid_list: ['999', '456'], accessible_episode_cnt: 1 } }),
    player({ seriesDetail: { series_id: '123', pay_type: 0, vid_list: ['456', '456'], accessible_episode_cnt: 2 } }),
    player({ publicVideoSeo: { available: true, itemId: '456', seriesId: '123', durationSeconds: 0 } }),
  ];
  for (const data of denied) {
    const f = fixture();
    await assert.rejects(resolveOfficialPublicPlayback(data, f.options));
    assert.equal(f.requests.length, 0);
  }
  assert.equal(publicEpisodePermission(player(), '456', '123').episodeIndex, 1);
});

test('the fifth public episode remains playable but the sixth stops before any playback API request', async () => {
  const fifth = fixture();
  const result = await resolveOfficialPublicPlayback(windowPlayer(5), { ...fifth.options, vid: '455' });
  assert.equal(result.url, MEDIA);
  assert.equal(fifth.requests.length, 2);

  const sixth = fixture();
  await assert.rejects(resolveOfficialPublicPlayback(windowPlayer(6), sixth.options),
    error => error.code === 'WEB_EPISODE_UNAVAILABLE');
  assert.equal(sixth.requests.length, 0);
  const nonePublic = windowPlayer(1);
  nonePublic.seriesDetail.accessible_episode_cnt = 0;
  assert.throws(() => publicEpisodePermission(nonePublic, '451', '123'),
    error => error.code === 'WEB_EPISODE_UNAVAILABLE');
});

test('a later episode redirected to the first retains the web window denial and never uses its media', async () => {
  const f = fixture();
  await assert.rejects(resolveOfficialPublicPlayback(windowPlayer(1), f.options),
    error => error.code === 'WEB_EPISODE_UNAVAILABLE');
  assert.equal(f.requests.length, 0);
  assert.throws(() => publicEpisodePermission(windowPlayer(1), '455', '123'),
    error => error.code === 'INVALID_RESPONSE', 'a wrong episode inside the public window is not a window denial');
  assert.throws(() => publicEpisodePermission(windowPlayer(1, { series_id: '999' }), '456', '123'),
    error => error.code === 'INVALID_RESPONSE', 'another series cannot establish this series public window');
});

test('invalid episode windows remain malformed responses instead of account or public window denials', async () => {
  const invalid = [undefined, null, '', ' 5 ', true, {}, -1, 1.5, 7, Number.MAX_SAFE_INTEGER + 1]
    .map(accessible => { const data = windowPlayer(6); data.seriesDetail.accessible_episode_cnt = accessible; return data; });
  for (const vids of [undefined, [], ['451', '451', '456'], ['451', 'invalid', '456'], ['451', '452'],
    ['451', '456', Number.MAX_SAFE_INTEGER + 1]]) {
    const data = windowPlayer(6); data.seriesDetail.vid_list = vids; invalid.push(data);
  }
  for (const data of invalid) {
    const f = fixture();
    await assert.rejects(resolveOfficialPublicPlayback(data, f.options), error => error.code === 'INVALID_RESPONSE');
    assert.equal(f.requests.length, 0);
  }
});

test('explicit account requirements stay distinct from encrypted browser capability limits', () => {
  for (const flag of ['pcLoginRequired', 'pcAuthenticatedPlayback']) {
    const data = windowPlayer(6); data.req[flag] = true;
    assert.throws(() => publicEpisodePermission(data, '456', '123'), error => error.code === 'ACCOUNT_REQUIRED');
  }
  const browserLimited = windowPlayer(1); browserLimited.req.encryptedBrowserAllowed = true;
  assert.throws(() => publicEpisodePermission(browserLimited, '451', '123'),
    error => error.code === 'WEB_EPISODE_UNAVAILABLE');
});

test('empty bodies, business refusal and encrypted response shapes remain distinct', async () => {
  for (const [response, expected] of [['', 'EMPTY_RESPONSE'], ['  \n\t', 'EMPTY_RESPONSE'], [null, 'EMPTY_RESPONSE'],
    ['not-json', 'INVALID_RESPONSE'], [api({ base_resp: { StatusCode: 403 } }), 'BUSINESS_REJECTED'],
    [{}, 'INVALID_RESPONSE'], [{ base_resp: {} }, 'INVALID_RESPONSE'],
    [api({ play_info: { manifest: 'PRIVATE_KEY' } }), 'INVALID_RESPONSE'],
    [api({ player_access_key: 'PRIVATE_KEY' }), 'INVALID_RESPONSE']]) {
    const f = fixture({ response });
    await assert.rejects(resolveOfficialPublicPlayback(player(), f.options), error => error.code === expected);
    assert.equal(f.requests.length, 1);
    assert.equal(f.events[0].code, expected);
    assert.doesNotMatch(JSON.stringify(f.events), /PRIVATE_KEY/);
  }
});

test('a valid JSON text response is parsed before public playback fields are read', async () => {
  const f = fixture({ response: JSON.stringify(api()) });
  const result = await resolveOfficialPublicPlayback(player(), f.options);
  assert.equal(result.url, MEDIA);
  assert.equal(result.format, 'mp4');
});

for (const [mime, text] of [['application/vnd.apple.mpegurl', '#EXTM3U\n'],
  ['application/dash+xml', '<MPD></MPD>']]) {
  test(`public MP4 validation does not mislabel an actual ${mime} response`, async () => {
    const bytes = Buffer.from(text);
    const f = fixture({ metadata: { status: 200, headers: { 'content-type': mime, 'content-length': String(bytes.length) }, data: bytes } });
    await assert.rejects(resolveOfficialPublicPlayback(player(), f.options), error => {
      assert.equal(error.code, 'UNSUPPORTED_MEDIA_FORMAT');
      assert.equal(error.faultCode, 'MEDIA_FORMAT_UNSUPPORTED');
      assert.equal(error.stage, 'media');
      assert.equal(error.httpStatus, 200);
      return true;
    });
  });
}

test('only observed official HTTPS media CDN hosts are accepted', () => {
  const permission = publicEpisodePermission(player(), '456', '123');
  for (const url of ['http://v11-hgweb.qznovelvod.com/movie.mp4', 'https://v11-hgweb.qznovelvod.com.evil.test/movie.mp4',
    'https://qznovelvod.com/movie.mp4', 'https://127.0.0.1/movie.mp4',
    'https://user@v11-hgweb.qznovelvod.com/movie.mp4', 'https://v11-hgweb.qznovelvod.com:444/movie.mp4']) {
    assert.throws(() => fallbackMedia(api({ main_url: url }), permission, NOW), error => error.code === 'SECURITY_BLOCKED');
  }
  assert.equal(fallbackMedia(api(), permission, NOW).url, MEDIA);
});

test('media expiry uses the official server delta and the earlier explicit signed URL limit', () => {
  const permission = publicEpisodePermission(player(), '456', '123');
  assert.equal(fallbackMedia(api({ server_time: NOW / 1000 - 100 }), permission, NOW).expiresAt, NOW + 3700000);
  assert.equal(fallbackMedia(api({ main_url: `${MEDIA}?expires=${NOW / 1000 + 20}` }), permission, NOW).expiresAt, NOW + 20000);
  for (const overrides of [{ url_expire: NOW / 1000 }, { server_time: 0 },
    { main_url: `${MEDIA}?expire=${NOW / 1000 + 4}` }]) {
    assert.throws(() => fallbackMedia(api(overrides), permission, NOW));
  }
});

test('MP4 movie duration supports both header versions and rejects missing or invalid metadata', () => {
  for (const version of [0, 1]) assert.equal(movieDuration(movie(120.123, version), parseBoxes), 120.123);
  for (const bytes of [Buffer.alloc(0), box('ftyp', Buffer.alloc(8)), movie(0), Buffer.from('not an mp4 movie')]) {
    assert.throws(() => movieDuration(bytes, parseBoxes), error => error.code === 'INVALID_RESPONSE');
  }
});

test('a real media duration mismatch rejects a preview despite full SEO duration', async () => {
  const f = fixture({ bytes: movie(60) });
  await assert.rejects(resolveOfficialPublicPlayback(player(), f.options), error => error.code === 'PREVIEW_ONLY');
  assert.equal(f.events[0].modelValid, false);
});

test('public MP4 metadata containing encrypted tracks is rejected without requesting keys', () => {
  const normal = movie();
  const stsdHeader = Buffer.alloc(8); stsdHeader.writeUInt32BE(1, 4);
  for (const kind of ['encv', 'enca']) {
    const sample = box(kind, Buffer.alloc(8));
    const track = box('trak', box('mdia', box('minf', box('stbl', box('stsd', Buffer.concat([stsdHeader, sample]))))));
    const metadata = Buffer.concat([normal.subarray(0, 16), box('moov', Buffer.concat([normal.subarray(24), track]))]);
    assert.throws(() => movieDuration(metadata, parseBoxes), error => error.code === 'MEDIA_DECRYPT_FAILED');
  }
});

test('CDN status failures remain media failures rather than account or API denial', async () => {
  for (const status of [403, 404, 503]) {
    const f = fixture();
    const request = config => config.method === 'POST' ? f.options.request(config)
      : Promise.reject({ response: { status }, config: { url: 'PRIVATE_MEDIA_URL' } });
    await assert.rejects(resolveOfficialPublicPlayback(player(), { ...f.options, request }), error => {
      assert.equal(error.faultCode, 'CDN_UNAVAILABLE');
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE_MEDIA_URL|config/);
      return true;
    });
    assert.equal(f.events[0].code, 'CDN_UNAVAILABLE');
  }
});

test('partial and complete metadata responses must be bounded and internally consistent', async () => {
  const bytes = movie();
  for (const metadata of [
    { status: 206, headers: {}, data: bytes },
    { status: 206, headers: { 'content-range': 'bytes 1-100/200' }, data: bytes },
    { status: 206, headers: { 'content-range': `bytes 0-${bytes.length - 1}/1` }, data: bytes },
    { status: 200, headers: { 'content-length': bytes.length + 1 }, data: bytes },
    { status: 200, headers: {}, data: bytes },
    { status: 200, headers: { 'content-length': OFFICIAL_WEB_PROFILE.metadataBytes + 1 }, data: Buffer.alloc(OFFICIAL_WEB_PROFILE.metadataBytes + 1) },
  ]) {
    const f = fixture({ metadata });
    await assert.rejects(resolveOfficialPublicPlayback(player(), f.options), error => error.code === 'INVALID_RESPONSE');
  }
  const f = fixture({ metadata: { status: 200, headers: { 'content-length': bytes.length }, data: bytes } });
  assert.equal((await resolveOfficialPublicPlayback(player(), f.options)).duration, 120);
});

test('HTTP denials and network errors are sanitized and never retried inside the public resolver', async () => {
  for (const code of [401, 403, 404, 410, 429]) {
    const f = fixture({ fail: { response: { status: code }, config: { Cookie: 'PRIVATE_COOKIE' }, message: MEDIA } });
    await assert.rejects(resolveOfficialPublicPlayback(player(), f.options), error => {
      assert.equal(error.code, `HTTP_${code}`);
      assert.doesNotMatch(error.message + JSON.stringify(error), /PRIVATE_COOKIE|qznovelvod|config/);
      return true;
    });
    assert.equal(f.requests.length, 1);
  }
  for (const code of ['ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET']) {
    const f = fixture({ fail: { code, message: MEDIA } });
    await assert.rejects(resolveOfficialPublicPlayback(player(), f.options), error => error.code === code);
    assert.equal(f.requests.length, 1);
  }
});

test('cancelling metadata verification aborts its transport and prevents a successful source', async () => {
  const f = fixture(), controller = new AbortController();
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const request = async config => {
    if (config.method === 'POST') return f.options.request(config);
    entered();
    return new Promise((_resolve, reject) => config.signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('PRIVATE_URL'), { code: 'ERR_CANCELED' }));
    }, { once: true }));
  };
  const pending = resolveOfficialPublicPlayback(player(), { ...f.options, request, signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, error => error.code === 'ERR_CANCELED');
  assert.equal(f.events[0].modelValid, false);
});

test('the web router invokes the public resolver once and refuses App fallback after explicit API denial', async () => {
  for (const status of [403, 429]) {
    const calls = [];
    const data = player();
    const html = `window._ROUTER_DATA=${JSON.stringify({ loaderData: { 'player_(series_id)/(vid)/page': data } })}`;
    const app = native({ axios: {
      get: async () => { calls.push('page'); return { status: 200, data: html }; },
      post: async () => { calls.push('public-api'); throw { response: { status } }; },
    }, './app-source': { fetchAppPlayUrl: async () => { assert.fail('explicit public API denial must stop fallback'); } } });
    const result = await app.fetchPlayUrlSingle('456', '123');
    assert.equal(result.url, null);
    assert.equal(result.sources[0].code, `HTTP_${status}`);
    assert.deepEqual(calls, ['page', 'public-api']);
  }
});

for (const status of [404, 410]) {
  test(`a missing website page HTTP ${status} still permits the independent App provider`, async () => {
    const calls = [];
    const app = native({ axios: {
      get: async () => { calls.push('page'); throw { response: { status } }; },
      post: async () => assert.fail('a missing HTML page cannot request a public playback API'),
    }, './app-source': { fetchAppPlayUrl: async vid => {
      calls.push('app'); assert.equal(vid, '456'); return { url: MEDIA, source: 'app' };
    } } });
    const result = await app.fetchPlayUrlSingle('456', '123');
    assert.equal(result.url, MEDIA);
    assert.equal(result.routeTrace[0].code, `HTTP_${status}`);
    assert.equal(calls.at(-1), 'app');
  });
}

for (const status of [401, 403, 429]) {
  test(`website HTTP ${status} remains terminal before an independent App request`, async () => {
    const app = native({ axios: { get: async () => { throw { response: { status } }; } },
      './app-source': { fetchAppPlayUrl: async () => assert.fail('an explicit refusal must stop') } });
    const result = await app.fetchPlayUrlSingle('456', '123');
    assert.equal(result.url, null);
    assert.equal(result.sources[0].code, `HTTP_${status}`);
  });
}

test('a missing website page and an empty App response preserve both provider outcomes', async () => {
  const app = native({ axios: { get: async () => { throw { response: { status: 404 } }; } },
    './app-source': { fetchAppPlayUrl: async () => { throw { code: 'EMPTY_RESPONSE', status: 200, stage: 'source' }; } } });
  const result = await app.fetchPlayUrlSingle('456', '123');
  assert.equal(result.faultCode, 'SOURCE_PROVIDERS_FAILED');
  assert.deepEqual(Array.from(result.sources, item => item.code), ['HTTP_404', 'EMPTY_RESPONSE']);
  assert.deepEqual(Array.from(result.sources, item => item.httpStatus), [404, 200]);
});

test('a thrown provider HTTP status survives the public resolver boundary without raw error details', async () => {
  const app = native({ './xifan': { fetchPlayUrlSingle: async () => {
    throw Object.assign(new Error('PRIVATE_URL token=PRIVATE_TOKEN'), { status: 403, stage: 'source',
      config: { headers: { Cookie: 'PRIVATE_COOKIE' } } });
  } } });
  const result = await app.fetchPlayUrlSingle('xifan:456', 'xifan:123');
  assert.equal(result.code, 'HTTP_403');
  assert.equal(result.faultCode, 'API_FORBIDDEN');
  assert.equal(result.status, 403);
  assert.equal(result.httpStatus, 403);
  assert.equal(result.stage, 'source');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|token=|Cookie|config/);
});

test('a website media validation failure retains its layer and safe HTTP evidence across the resolver', async () => {
  const html = `window._ROUTER_DATA=${JSON.stringify({ loaderData: { 'player_(series_id)/(vid)/page': player() } })}`;
  const app = native({ axios: { get: async () => ({ status: 200, data: html }) },
    './official-web-playback': { resolveOfficialPublicPlayback: async () => {
      throw Object.assign(new Error('PRIVATE_URL token=PRIVATE_TOKEN'), { code: 'HTTP_403',
        faultCode: 'CDN_UNAVAILABLE', status: 403, httpStatus: 403, stage: 'media',
        config: { headers: { Cookie: 'PRIVATE_COOKIE' } } });
    } }, './app-source': { fetchAppPlayUrl: async () => { throw { code: 'EMPTY_RESPONSE' }; } } });
  const result = await app.fetchPlayUrlSingle('456', '123');
  const failure = result.sources.find(item => item.source === 'web');
  assert.equal(failure.faultCode, 'CDN_UNAVAILABLE');
  assert.equal(failure.status, 403);
  assert.equal(failure.httpStatus, 403);
  assert.equal(failure.stage, 'media');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|token=|Cookie|config/);
});

test('official media verification assigns the media stage even when parsing its MP4 bytes fails', async () => {
  const f = fixture({ bytes: Buffer.from('not an mp4 movie') });
  await assert.rejects(resolveOfficialPublicPlayback(player(), f.options), error => {
    assert.equal(error.code, 'INVALID_RESPONSE');
    assert.equal(error.stage, 'media');
    return true;
  });
});

test('a web-only later-episode denial still allows the independent App provider without using wrong web media', async () => {
  for (const data of [windowPlayer(6), windowPlayer(1)]) {
    const calls = [];
    const html = `window._ROUTER_DATA=${JSON.stringify({ loaderData: { 'player_(series_id)/(vid)/page': data } })}`;
    const app = native({ axios: {
      get: async () => { calls.push('page'); return { status: 200, data: html }; },
      post: async () => assert.fail('a web window denial must not request a playback API'),
    }, './app-source': { fetchAppPlayUrl: async vid => {
      calls.push('app'); assert.equal(vid, '456'); return { url: MEDIA, source: 'app' };
    } } });
    const result = await app.fetchPlayUrlSingle('456', '123');
    assert.equal(result.url, MEDIA);
    assert.equal(result.source, 'app');
    assert.equal(result.routeTrace[0].code, 'WEB_EPISODE_UNAVAILABLE');
    assert.equal(result.routeTrace[0].anonymousAccess, 'denied');
    assert.deepEqual(calls, ['page', 'app']);
  }
});

test('web-first later-episode denial preserves both failures after one normal App attempt', async () => {
  const calls = [], data = windowPlayer(1);
  const html = `window._ROUTER_DATA=${JSON.stringify({ loaderData: { 'player_(series_id)/(vid)/page': data } })}`;
  const app = native({ axios: {
    get: async () => { calls.push('page'); return { status: 200, data: html }; },
    post: async () => assert.fail('the denied website must not request playback APIs'),
  }, './app-source': { fetchAppPlayUrl: async () => {
    calls.push('app'); throw Object.assign(new Error('PRIVATE_ERROR'), { code: 'EMPTY_RESPONSE' });
  } } });
  const result = await app.fetchPlayUrlSingle('456', '123');
  assert.equal(result.url, null);
  assert.deepEqual(Array.from(result.sources, item => item.code), ['WEB_EPISODE_UNAVAILABLE', 'EMPTY_RESPONSE']);
  assert.doesNotMatch(result.sources[0].message, /\bhttps?:|登录|账号|付费|DRM|签名/);
  assert.deepEqual(calls, ['page', 'app']);
});

test('explicit website account requirements still stop the independent App route', async () => {
  for (const flag of ['pcLoginRequired', 'pcAuthenticatedPlayback']) {
    const data = windowPlayer(6); data.req[flag] = true;
    const html = `window._ROUTER_DATA=${JSON.stringify({ loaderData: { 'player_(series_id)/(vid)/page': data } })}`;
    const app = native({ axios: {
      get: async () => ({ status: 200, data: html }),
      post: async () => assert.fail('explicit account requirements stop public playback API requests'),
    }, './app-source': { fetchAppPlayUrl: async () => assert.fail('explicit account requirements stop cross-route requests') } });
    const result = await app.fetchPlayUrlSingle('456', '123');
    assert.equal(result.url, null);
    assert.equal(result.sources[0].code, 'ACCOUNT_UNAUTHORIZED');
  }
});

test('automatic quality keeps the later-episode web denial after the initial App empty response', async () => {
  const calls = [], data = windowPlayer(1);
  const html = `window._ROUTER_DATA=${JSON.stringify({ loaderData: { 'player_(series_id)/(vid)/page': data } })}`;
  const app = native({ axios: {
    get: async () => { calls.push('page'); return { status: 200, data: html }; },
    post: async () => assert.fail('no protected playback API is needed to identify the web window denial'),
  }, './app-source': { fetchAppPlayUrl: async () => {
    calls.push('app'); throw Object.assign(new Error('PRIVATE_ERROR'), { code: 'EMPTY_RESPONSE' });
  } } });
  const result = await app.fetchPlayUrlSingle('456', '123', { quality: '1080p', allowLowerQuality: true });
  assert.equal(result.url, null);
  assert.equal(result.sources.at(-1).code, 'WEB_EPISODE_UNAVAILABLE');
  assert.deepEqual(calls, ['app', 'page']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ERROR/);
});

test('the web router resolves a complete public movie while leaving the App interface untouched', async () => {
  const f = fixture();
  const html = `window._ROUTER_DATA=${JSON.stringify({ loaderData: { 'player_(series_id)/(vid)/page': player() } })}`;
  const app = native({ axios: {
    get: async (url, config) => url.includes('/player/') ? { status: 200, data: html } : f.options.request(config),
    post: async (_url, _data, config) => f.options.request(config),
  }, './app-source': { fetchAppPlayUrl: async () => { assert.fail('a verified public movie needs no App request'); } } });
  const result = await app.fetchPlayUrlFromWeb('456', '123');
  assert.equal(result.url, MEDIA);
  assert.equal(result.duration, 120);
  assert.equal(result.profileId, OFFICIAL_WEB_PROFILE.id);
});

test('missing SEO uses only the official duration metadata and never exposes the encrypted stream', async () => {
  const calls = [], data = player({ publicVideoSeo: undefined });
  const html = `window._ROUTER_DATA=${JSON.stringify({ loaderData: { 'player_(series_id)/(vid)/page': data } })}`;
  const f = fixture();
  const app = native({ axios: {
    get: async (url, config) => {
      if (url.includes('/player/')) { calls.push('page'); return { status: 200, data: html }; }
      calls.push('metadata'); return f.options.request(config);
    },
    post: async (url, _data, config) => {
      if (url.endsWith(OFFICIAL_WEB_PROFILE.playInfoPath)) {
        calls.push('duration');
        assert.deepEqual(config.data, { series_id: '123', item_id: '456', definition: '720p' });
        return { status: 200, data: { base_resp: { StatusCode: 0 },
          play_info: { duration: 120, width: 720, height: 1280, main_url: 'PRIVATE_ENCRYPTED_URL', kid: 'PRIVATE_KID', player_access_key: 'PRIVATE_KEY' } } };
      }
      calls.push('public-api'); return f.options.request(config);
    },
  } });
  const result = await app.fetchPlayUrlFromWeb('456', '123');
  assert.equal(result.url, MEDIA);
  assert.equal(result.duration, 120);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|kid|player_access_key/);
  assert.deepEqual(calls, ['page', 'duration', 'public-api', 'metadata']);
});

test('official duration reference fails closed for refusals, identity mismatches and incompatible shapes', () => {
  const permission = publicEpisodePermission(player(), '456', '123');
  const valid = { base_resp: { StatusCode: 0 }, play_info: { width: 720, height: 1280, duration: 120 } };
  assert.equal(officialDuration(valid, permission), 120);
  for (const data of ['', { ...valid, base_resp: { StatusCode: 403 } }, { ...valid, item_id: '999' },
    { ...valid, series_id: '999' }, { ...valid, play_info: { ...valid.play_info, duration: '120' } },
    { ...valid, play_info: { ...valid.play_info, duration: 0 } }, { ...valid, legacy_play_info: valid.play_info }]) {
    assert.throws(() => officialDuration(data, permission));
  }
});

test('the default automatic 1080 preference reaches the verified public route after an App empty response', async () => {
  const calls = [], f = fixture();
  const html = `window._ROUTER_DATA=${JSON.stringify({ loaderData: { 'player_(series_id)/(vid)/page': player() } })}`;
  const app = native({ axios: {
    get: async (url, config) => {
      if (url.includes('/player/')) { calls.push('page'); return { status: 200, data: html }; }
      calls.push('metadata'); return f.options.request(config);
    },
    post: async (_url, _data, config) => { calls.push('public-api'); return f.options.request(config); },
  }, './app-source': { fetchAppPlayUrl: async (_vid, options) => {
    calls.push('app'); assert.equal(options.quality, '1080p');
    throw Object.assign(new Error('App empty response'), { code: 'EMPTY_RESPONSE' });
  } } });
  const automatic = await app.fetchPlayUrlSingle('456', '123', { quality: '1080p', allowLowerQuality: true });
  assert.equal(automatic.url, MEDIA);
  assert.equal(automatic.source, 'web');
  assert.deepEqual(calls, ['app', 'page', 'public-api', 'metadata']);
  assert.equal(automatic.routeTrace[0].code, 'EMPTY_RESPONSE');
  assert.equal(automatic.routeTrace[1].source, 'web');

  calls.length = 0;
  const manual = await app.fetchPlayUrlSingle('456', '123', { quality: '1080p' });
  assert.equal(manual.url, null);
  assert.deepEqual(calls, ['app'], 'automatic public results must not pollute the strict-quality source cache');
});

test('automatic quality preference does not use public fallback after explicit App access refusal', async () => {
  for (const failure of [{ code: 'ACCOUNT_UNAUTHORIZED' }, { code: 'SIGNATURE_INVALID' },
    { response: { status: 403 } }, { response: { status: 429 } }]) {
    const app = native({ axios: {
      get: async () => assert.fail('access refusal must not select another public route'),
      post: async () => assert.fail('access refusal must not select another public route'),
    }, './app-source': { fetchAppPlayUrl: async () => { throw failure; } } });
    const result = await app.fetchPlayUrlSingle('456', '123', { quality: '1080p', allowLowerQuality: true });
    assert.equal(result.url, null);
    assert.ok(result.sources.length === 1 && result.sources[0].source === 'app');
  }
});
