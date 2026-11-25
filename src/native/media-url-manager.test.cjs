const test = require('node:test');
const assert = require('node:assert/strict');
const { bindMediaSession, isMediaExpired } = require('./media-url-manager');

const url = 'https://v3-reading.qznovelvod.com/episode.mp4';
const now = 1800000000000;

test('binding retains an explicit server media expiry when the address has no expiry query', () => {
  const result = bindMediaSession({ url, expiresAt: now + 10000 }, { now });
  assert.equal(result.expiresAt, now + 10000);
  assert.equal(isMediaExpired(result, now), false);
  assert.equal(isMediaExpired(result, now + 6000), true);
});

test('binding and expiry checks use the earlier of server and signed-address expiry', () => {
  for (const [serverExpiry, urlExpiry, expected] of [
    [now + 10000, now + 20000, now + 10000],
    [now + 20000, now + 10000, now + 10000],
  ]) {
    const info = { url: `${url}?expires=${urlExpiry / 1000}`, expiresAt: serverExpiry };
    assert.equal(bindMediaSession(info, { now }).expiresAt, expected);
    assert.equal(isMediaExpired(info, now + 6000), true);
  }
});

test('invalid explicit expiries cannot hide a valid signed-address expiry', () => {
  for (const expiresAt of [undefined, 0, -1, '1800000100000', NaN, Infinity, 1.5, 8640000000000001]) {
    const info = { url: `${url}?expires=${(now + 10000) / 1000}`, expiresAt };
    assert.equal(bindMediaSession(info, { now }).expiresAt, now + 10000);
    assert.equal(isMediaExpired(info, now + 6000), true);
  }
  assert.equal(bindMediaSession({ url, expiresAt: -1 }, { now }).expiresAt, 0);
  assert.equal(isMediaExpired({ url, expiresAt: -1 }, now), false);
});
