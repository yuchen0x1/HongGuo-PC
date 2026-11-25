const { createHash } = require('node:crypto');

// Only explicit absolute expiry fields are interpreted; opaque signatures are never guessed.
function mediaExpiresAt(value) {
  let url;
  try { url = new URL(value); } catch { return 0; }
  const values = [];
  for (const key of ['expire', 'expires', 'expire_time', 'expiration', 'x-expires']) {
    const text = url.searchParams.get(key);
    if (!/^\d{9,16}$/.test(text || '')) continue;
    const number = Number(text);
    const timestamp = number < 100000000000 ? number * 1000 : number;
    if (Number.isSafeInteger(timestamp)) values.push(timestamp);
  }
  return values.length ? Math.min(...values) : 0;
}

function bindMediaSession(info, { now = Date.now(), accountGeneration = 0 } = {}) {
  if (!info?.url) return info;
  const expiresAt = mediaSessionExpiry(info);
  const identity = createHash('sha256').update(JSON.stringify([
    info.url, info.userAgent || '', info.referer || '', info.contentKey || '', info.spadeA || '',
  ])).digest('hex');
  return { ...info, resolvedAt: now, expiresAt, accountGeneration, mediaSessionId: identity };
}

function isMediaExpired(info, now = Date.now(), safetyMs = 5000) {
  const expiry = mediaSessionExpiry(info);
  return expiry > 0 && expiry <= now + safetyMs;
}

function mediaSessionExpiry(info) {
  const values = [info?.expiresAt, mediaExpiresAt(info?.url)]
    .filter(value => Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000);
  return values.length ? Math.min(...values) : 0;
}

module.exports = { mediaExpiresAt, bindMediaSession, isMediaExpired };
