import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mount } = require('../../../scripts/check-player-resume.cjs');
const target = { seriesId: 'A', vidIndex: 23, ts: 1 };
const settings = { cache_next_episode: false, compat_mode: false };
const text = node => typeof node === 'string' || typeof node === 'number'
  ? String(node) : node?.children?.map(text).join('') || '';

function failedPlayback(routes) {
  return {
    success: false,
    code: 'SOURCE_UNAVAILABLE',
    faultCode: 'WEB_EPISODE_UNAVAILABLE',
    diagnostics: { stage: 'source', code: 'SOURCE_UNAVAILABLE', routes },
  };
}

test('player diagnostics show both website and App failure codes without changing recovery', async () => {
  const failure = failedPlayback([
    { source: 'web', attempted: true, status: 'failed', code: 'WEB_EPISODE_UNAVAILABLE' },
    { source: 'app', attempted: true, status: 'failed', code: 'EMPTY_RESPONSE' },
  ]);
  const ui = mount({ props: { target }, episodeCount: 24, settings, prepare: async () => failure });
  try {
    await ui.flush();
    assert(ui.find(node => node.type === 'li' && text(node).includes('WEB_EPISODE_UNAVAILABLE')),
      'the website route must display its own safe failure code');
    assert(ui.find(node => node.type === 'li' && text(node).includes('EMPTY_RESPONSE')),
      'the App route must display its failure even when the aggregate fault describes the website');
    assert.equal(ui.prepares.length, 1);
    assert.equal(ui.transcodes.length, 0);
    assert(ui.reports.some(report => report.event === 'failure' && report.faultCode === failure.faultCode));
  } finally { ui.unmount(); }
});

test('player route diagnostics omit raw errors, unknown codes and media addresses', async () => {
  const privateText = 'SYNTHETIC_PRIVATE_DIAGNOSTIC';
  const mediaAddress = 'https://redacted.invalid/media?redacted=1';
  const failure = failedPlayback([
    { source: 'app', attempted: true, status: 'failed', code: 'EMPTY_RESPONSE',
      message: privateText, url: mediaAddress, headers: { Cookie: privateText } },
    { source: 'app', attempted: true, status: 'failed', code: 'UNKNOWN_ROUTE_CODE', message: privateText },
    { source: 'app', attempted: true, status: 'failed', code: mediaAddress },
    { source: 'web', attempted: true, status: 'failed', code: 'HTTP_503' },
  ]);
  failure.diagnostics.message = privateText;
  const ui = mount({ props: { target }, episodeCount: 24, settings, prepare: async () => failure });
  try {
    await ui.flush();
    assert(ui.find(node => node.type === 'li' && text(node).includes('EMPTY_RESPONSE')));
    assert(ui.find(node => node.type === 'li' && text(node).includes('HTTP_503')));
    assert.doesNotMatch(ui.text(), /SYNTHETIC_PRIVATE_DIAGNOSTIC|UNKNOWN_ROUTE_CODE|redacted\.invalid|Cookie/);
    assert.equal(ui.prepares.length, 1);
  } finally { ui.unmount(); }
});
