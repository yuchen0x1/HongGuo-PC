// SPDX-License-Identifier: GPL-3.0-only
// Bundled protocol records only. Account credentials and remotely supplied signing
// configuration never enter this registry. Evidence is historical, not an uptime promise.
function freeze(value) {
  for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item);
  return Object.freeze(value);
}

const MODEL_PROFILE = freeze({
  id: 'hongguo-app-74532-medusa312-v1', version: '2026-11-24.1', schema: 1,
  evidence: { document: 'docs/release-6.28.md', date: '2026-11-24', scope: 'source-and-media' },
  app: {
    aid: '8662', app_name: 'novelread', version_code: '74532', version_name: '7.4.5.32',
    update_version_code: '74532', manifest_version_code: '74532', os: 'android', ssmix: 'a',
    channel: 'update_64', device_platform: 'android', device_type: '25053RT47C', device_brand: 'Redmi',
    os_version: '16', os_api: '36', ac: 'wifi', language: 'zh', host_abi: 'arm64-v8a',
  },
  userAgent: 'com.phoenix.read/74532 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3)',
  signature: { scheme: 'helios-medusa-v5', medusaField21: 312 },
  headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip' },
  routes: [
    { id: 'preload-primary', endpoint: 'https://reading.snssdk.com/novel/player/multi_video_model/preload/v1', method: 'POST', evidence: 'release-6.28' },
    { id: 'preload-alternate', endpoint: 'https://api5-normal-sinfonlineb.fqnovel.com/novel/player/multi_video_model/preload/v1', method: 'POST', evidence: 'release-6.28-compatibility' },
    { id: 'video-tab', endpoint: 'https://api5-normal-sinfonlineb.fqnovel.com/reading/bookapi/video_tab/multi_video_model/v1/', method: 'GET', evidence: 'upstream-7.7-compatibility' },
  ],
  body: {
    biz_param: { detail_page_version: 0, device_level: 2, disable_digg_stat: false, disable_video_relate_book: false,
      need_all_video_definition: true, need_mp4_align: false, use_os_player: false, use_server_dns: false, video_platform: 1024 },
    dr_scene: 'preload',
  },
  tabQuery: { video_id_type: '0', device_level: '1', need_all_video_definition: '1', need_mp4_align: '0',
    use_os_player: '0', video_platform: '1024', source: '0', from_video_id: '' },
  timeout: { totalMs: 28000, modelTotalMs: 20000, requestMs: 12000, registrationMs: 8000, minimumRouteMs: 1000 },
  recovery: { maxNetworkRetries: 1, maxDeviceRefreshes: 1, retryDelayMs: 250, pacingMs: 1000 },
});

const LEGACY_PLAYBACK = freeze({
  // The old model endpoint is retained for reproducible protocol tests, never
  // selected as a live fallback after the 6.28 single-variable rejection test.
  endpoint: 'https://api5-normal-sinfonlineb.fqnovel.com/novel/player/multi_video_model/v1/',
  medusaField21: 312, argusField21: 738,
  baseDevice: {
    ac: 'wifi', channel: 'update_64', aid: '8662', app_name: 'novelread',
    version_code: '71332', version_name: '7.1.3.32', device_platform: 'android', os: 'android',
    ssmix: 'a', device_type: '25053RT47C', device_brand: 'Redmi', language: 'zh', os_api: '36',
    os_version: '16', manifest_version_code: '71332', resolution: '1280*2772', dpi: '520',
    update_version_code: '71332', host_abi: 'arm64-v8a', dragon_device_type: 'phone', pv_player: '71332',
    compliance_status: '0', need_personal_recommend: '1', player_so_load: '1', is_android_pad_screen: '0',
  },
  playbackDevice: { version_code: '74332', version_name: '7.4.3.32', manifest_version_code: '74332', update_version_code: '74332', pv_player: '74332' },
  mediaUserAgent: 'com.phoenix.read/71532 (Linux; U; Android 9; SM-N9860; Build/PQ3A.190705.10241111;tt-ok/3.12.13.20)',
  videoUserAgent: 'com.phoenix.read/71332 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)',
  searchUserAgent: 'com.phoenix.read/72232 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3)',
});

const DEVICE_REGISTRATION = freeze({
  endpoint: 'https://log5-applog-lf.fqnovel.com/service/2/device_register/?tt_data=a&cronet_version=8d40f833_2026-03-03&ttnet_version=4.2.243.31-douyin&use_store_region_cookie=1',
  headers: { 'User-Agent': LEGACY_PLAYBACK.searchUserAgent, Accept: 'application/json',
    'Content-Type': 'application/octet-stream;tt-data=a', 'log-encode-type': 'gzip', 'x-ss-dp': '8662',
    'x-vc-bdturing-sdk-version': '4.0.3.cn', lc: '101', 'sdk-version': '2',
    'passport-sdk-version': '5051452', 'x-neptune': '-8|50:51:59:30:40:47:49:39' },
  profile: {
    display_name: '红果免费短剧', update_version_code: 73932, manifest_version_code: 73932,
    app_version_minor: '7.3.9.32', aid: 8662, channel: 'update_64', package: 'com.phoenix.read',
    app_version: '7.3.9.32', version_code: 73932, sdk_version: '3.7.0-rc.34-fanqie-xiaoshuo',
    sdk_target_version: 29, git_hash: '3a88f4e', os: 'Android', os_version: '16', os_api: 36,
    device_model: '25053RT47C', device_brand: 'Redmi', device_manufacturer: 'Redmi',
    cpu_abi: 'arm64-v8a', release_build: 'b5e187f', density_dpi: 520, display_density: 'mdpi',
    resolution: '1280x2772', language: 'zh', timezone: 8, access: 'wifi', not_request_sender: 0,
    carrier: 'CHINA MOBILE', mcc_mnc: '46000', rom: 'eng.root.20231116.160340',
    rom_version: 'W528JS release-keys', sig_hash: '56a962410c494bbaf0b58dba20cae56f',
    ipv6_list: [], region: 'CN', tz_name: 'Asia/Shanghai', tz_offset: 28800, sim_region: 'cn',
    sim_serial_number: [], oaid_may_support: false, device_platform: 'android',
    custom: { account_region_src: 'fallback', account_region: 'cn', host_bit: 64, dragon_device_type: 'phone' },
    pre_installed_channel: '', is_system_app: 0, sdk_flavor: 'china', guest_mode: 0,
  },
  refreshCooldownMs: 60000, failureCooldownMs: 10000,
});

function compatibleProfile(value) {
  return value?.schema === 1 && value?.signature?.scheme === 'helios-medusa-v5'
    && value.signature.medusaField21 === 312 && value?.app?.version_code === '74532'
    && value.app.version_name === '7.4.5.32' && value.app.update_version_code === '74532'
    && value.app.manifest_version_code === '74532' && value.userAgent === MODEL_PROFILE.userAgent
    && value?.body?.dr_scene === 'preload' && value?.body?.biz_param?.device_level === 2
    && value?.headers && Object.keys(value.headers).length === Object.keys(MODEL_PROFILE.headers).length
    && Object.entries(MODEL_PROFILE.headers).every(([name, expected]) => value.headers[name] === expected)
    && value?.timeout && Object.values(value.timeout).every(timeout => Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 30000)
    && Array.isArray(value.routes) && value.routes.length === 3
    && value.routes.every((route, index) => route.id === MODEL_PROFILE.routes[index].id
      && route.endpoint === MODEL_PROFILE.routes[index].endpoint && route.method === MODEL_PROFILE.routes[index].method);
}

function createRequestProfileManager({ profiles = [MODEL_PROFILE], activeId = MODEL_PROFILE.id, lastVerifiedId = MODEL_PROFILE.id } = {}) {
  const registry = new Map(profiles.map(profile => [profile.id, profile]));
  const baseline = registry.get(lastVerifiedId);
  if (!compatibleProfile(baseline)) throw new TypeError('A compatible, previously verified bundled profile is required');
  let active = baseline, lastVerified = baseline, fallbackCount = 0;
  let lastShapeFailureAt = 0, lastModelSuccessAt = 0;
  const stats = new Map(MODEL_PROFILE.routes.map(route => [route.id, { requests: 0, succeeded: 0, failed: 0, lastError: '', lastElapsedMs: 0 }]));
  const select = id => {
    const candidate = registry.get(id);
    if (compatibleProfile(candidate)) active = candidate;
    else { active = lastVerified; fallbackCount++; }
    return active;
  };
  select(activeId);
  return {
    current: () => active,
    select,
    record({ routeId, code = '', elapsedMs = 0, modelValid = false, at = Date.now() } = {}) {
      const row = stats.get(routeId);
      if (!row) return;
      row.requests++;
      row.lastElapsedMs = Math.min(30000, Math.max(0, Number(elapsedMs) || 0));
      row.lastError = ['EMPTY_RESPONSE', 'INVALID_RESPONSE', 'MISSING_MODEL', 'BUSINESS_REJECTED', 'ERR_CANCELED', 'ERR_NETWORK',
        'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EPIPE',
        'DEVICE_IDENTITY_EXPIRED', 'SIGNATURE_INVALID', 'SECURITY_BLOCKED'].includes(code) || /^HTTP_[345]\d{2}$/.test(code) ? code : code ? 'UNKNOWN' : '';
      if (modelValid) {
        row.succeeded++; lastModelSuccessAt = at; lastVerified = active;
      } else {
        row.failed++;
        if (['INVALID_RESPONSE', 'MISSING_MODEL'].includes(code)) {
          lastShapeFailureAt = at;
          if (active !== lastVerified) { active = lastVerified; fallbackCount++; }
        }
      }
    },
    status: () => ({ id: active.id, version: active.version, appVersion: active.app.version_name,
      lastVerifiedId: lastVerified.id, historicalVerificationDate: active.evidence.date,
      state: lastModelSuccessAt ? 'verified-this-process' : lastShapeFailureAt ? 'incompatible-response' : 'historically-verified',
      fallbackCount, lastShapeFailureAt, lastModelSuccessAt,
      routes: [...stats].map(([routeId, row]) => ({ routeId, ...row })) }),
  };
}

const requestProfiles = createRequestProfileManager();
const getPlaybackProfile = () => requestProfiles.current();
const getPlaybackProfileStatus = () => requestProfiles.status();
module.exports = { MODEL_PROFILE, LEGACY_PLAYBACK, DEVICE_REGISTRATION, createRequestProfileManager,
  getPlaybackProfile, getPlaybackProfileStatus, requestProfiles };
