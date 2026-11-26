// Offline provenance validation only. These metadata fixtures contain no media or official responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readManifest } = require('./verify-playback-later.cjs');

const root = path.resolve(__dirname, '..');
const parent = path.join(root, '.local', 'analysis');
fs.mkdirSync(parent, { recursive: true });
const directory = fs.mkdtempSync(path.join(parent, 'playback-manifest-check-'));
let checks = 0;
function test(name, action) {
  try { action(); checks++; }
  catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); }
}
const episode = { seriesId: '123456', title: 'Offline metadata fixture', episodeId: '654321', episodeIndex: 22 };
const catalog = path.join(directory, 'catalog.json');
const filename = path.join(directory, 'manifest.json');
fs.writeFileSync(catalog, JSON.stringify({ fixture: true, noMedia: true }));
function targeted() {
  return { selection: 'development', sourceEvidence: { kind: 'targeted-official-catalog',
    observedAt: '2026-11-26T01:13:50+08:00', reference: 'catalog.json' },
  episodes: [{ ...episode, source: 'official-catalog' }] };
}
function read(value) {
  fs.writeFileSync(filename, JSON.stringify(value));
  return readManifest(filename);
}

try {
  test('explicit development provenance never claims random selection or media acquisition', () => {
    const value = read(targeted());
    assert.equal(value.seriesId, episode.seriesId);
    assert.equal(value.expectedEpisodes.get(22), episode.episodeId);
    assert.equal(value.durations.size, 0);
    assert.equal(value.provenance.selection, 'development');
    assert.equal(value.provenance.sourceEvidence.mediaObtained, false);
    assert.match(value.provenance.sourceEvidence.sha256, /^[a-f0-9]{64}$/);
    assert.equal('selectedRandomlyFrom' in value.provenance, false);
  });
  test('missing evidence cannot become targeted provenance', () => {
    const value = targeted(); value.sourceEvidence.reference = 'missing.json';
    assert.throws(() => read(value), /file inside the project/);
  });
  test('an unrecorded observation cannot become targeted provenance', () => {
    const value = targeted(); delete value.sourceEvidence.observedAt;
    assert.throws(() => read(value), /observation time/);
  });
  test('targeted catalogs do not accept playback addresses', () => {
    const value = targeted(); value.episodes[0].mediaUrl = 'https://invalid.example/fixture';
    assert.throws(() => read(value), /must not claim supplied media/);
  });
  test('targeted catalogs do not accept supplied media files', () => {
    const value = targeted(); value.episodes[0].file = 'not-a-video.mp4';
    assert.throws(() => read(value), /must not claim supplied media/);
  });
  test('targeted provenance does not accept duplicate identities', () => {
    const value = targeted(); value.episodes.push({ ...value.episodes[0], episodeIndex: 23 });
    assert.throws(() => read(value), /duplicate episode identities/);
  });
  test('legacy random public-media provenance keeps its original scope', () => {
    const value = read({ selectedRandomlyFrom: 24, episodes: [{ ...episode, source: 'web',
      profileId: 'hongguo-official-web-public-v1', routeId: 'official-web-public-fallback', duration: 150 }] });
    assert.equal(value.provenance.selection, 'random');
    assert.equal(value.provenance.selectedRandomlyFrom, 24);
    assert.equal(value.durations.get(22).duration, 150);
  });
  test('an arbitrary development label does not replace evidence', () => {
    const value = targeted(); delete value.sourceEvidence;
    assert.throws(() => read(value), /explicit targeted-official-catalog/);
  });
  console.log(`Later-episode manifest: ${checks}/${checks} offline provenance checks passed; no real media or network requests.`);
} finally {
  assert.equal(path.dirname(path.resolve(directory)), parent);
  assert.ok(path.basename(directory).startsWith('playback-manifest-check-'));
  fs.rmSync(directory, { recursive: true });
}
