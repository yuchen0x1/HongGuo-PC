const RELEASES_URL = 'https://github.com/yuchen0x1/HongGuo-PC/releases';

function versionParts(value) {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(value || ''));
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function availableRelease(data, currentVersion) {
  if (!data || data.draft || data.prerelease) return null;
  const next = versionParts(data.tag_name), current = versionParts(currentVersion);
  if (!next || !current) return null;
  const difference = next.findIndex((part, i) => part !== current[i]);
  if (difference < 0 || next[difference] < current[difference]) return null;
  const releaseNotes = String(data.body || '').replace(/\u0000/g, '').trim().slice(0, 12000);
  const assets = Array.isArray(data.assets) ? data.assets.slice(0, 20).map(asset => ({
    name: String(asset?.name || '').slice(0, 180),
    size: Number.isSafeInteger(asset?.size) && asset.size >= 0 ? asset.size : null,
  })).filter(asset => asset.name) : [];
  const publishedAt = String(data.published_at || data.created_at || '').trim();
  return {
    version: data.tag_name.replace(/^v/, '').replace(/^(\d+\.\d+)\.0$/, '$1'),
    // Never open a remote-provided URL; only this project's release page.
    url: `${RELEASES_URL}/tag/${encodeURIComponent(data.tag_name)}`,
    channel: 'stable',
    mandatory: false,
    releaseDate: /^\d{4}-\d{2}-\d{2}T/.test(publishedAt) ? publishedAt : '',
    releaseNotes,
    assets,
  };
}

module.exports = { availableRelease };
