import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { shouldOfferAccountLogin } from '../playbackRecovery.mjs';

const require = createRequire(import.meta.url);
const { mount } = require('../../../scripts/check-player-resume.cjs');
const target = { seriesId: 'A', vidIndex: 1, ts: 1 };
const settings = { cache_next_episode: false, compat_mode: false };
const anonymous = { success: true, signedIn: false, sessionValidity: 'anonymous' };
const valid = { success: true, signedIn: true, sessionValidity: 'valid' };
const empty = { success: false, faultCode: 'API_EMPTY_RESPONSE', diagnostics: { source: 'app', stage: 'source', faultCode: 'API_EMPTY_RESPONSE' } };
const dialog = ui => ui.find(node => node.props.className === 'account-playback-login-dialog');
const login = ui => ui.find(node => node.props.loginOnly === true && node.props.autoLogin === true);
const successful = payload => ({ success: true, url: `hongguo-stream://${payload.requestId}`, streamId: payload.requestId,
  diagnostics: { source: 'web', stage: 'media' } });

test('anonymous empty source opens the existing QR login once per episode and dismissal remains effective', async () => {
  const ui = mount({ props: { target }, settings, prepare: async () => empty,
    apiOverrides: { getAccountStatus: async () => anonymous } });
  try {
    await ui.flush();
    assert(dialog(ui));
    assert(login(ui), 'the prompt must reuse AccountManagement loginOnly');
    ui.find(node => node.props['aria-label'] === '关闭登录窗口').props.onClick();
    await ui.flush();
    assert.equal(dialog(ui), undefined);
    await ui.button('重试本集').props.onClick(); await ui.flush();
    assert.equal(ui.prepares.length, 2);
    assert.equal(dialog(ui), undefined, 'same-episode automatic prompting must not repeat after dismissal');
  } finally { ui.unmount(); }
});

test('a verified account is not prompted again for a generic empty source', async () => {
  let checks = 0;
  const ui = mount({ props: { target }, settings, prepare: async () => empty,
    apiOverrides: { getAccountStatus: async () => { checks++; return valid; } } });
  try {
    await ui.flush();
    assert(checks > 0);
    assert.equal(dialog(ui), undefined);
    assert(ui.button('扫码登录后重试'), 'an explicit user command stays available');
  } finally { ui.unmount(); }
});

for (const faultCode of ['ACCOUNT_EXPIRED', 'ACCOUNT_UNAUTHORIZED']) {
  test(`explicit ${faultCode} offers reauthentication even when cached account status says valid`, async () => {
    const ui = mount({ props: { target }, settings,
      prepare: async () => ({ success: false, faultCode, diagnostics: { source: 'app', stage: 'source', faultCode } }),
      apiOverrides: { getAccountStatus: async () => valid } });
    try { await ui.flush(); assert(dialog(ui)); assert(login(ui)); }
    finally { ui.unmount(); }
  });
}

for (const [faultCode, stage] of [
  ['NETWORK_TIMEOUT', 'source'], ['NETWORK_DISCONNECTED', 'source'], ['API_RATE_LIMITED', 'source'],
  ['PLAYER_DECODE_FAILED', 'decode'], ['CODEC_UNSUPPORTED', 'decode'], ['MEDIA_DECRYPT_FAILED', 'decrypt'],
]) {
  test(`${faultCode} does not automatically show an account QR`, async () => {
    const ui = mount({ props: { target }, settings,
      prepare: async () => ({ success: false, faultCode, diagnostics: { stage, faultCode } }),
      apiOverrides: { getAccountStatus: async () => anonymous } });
    try { await ui.flush(); assert.equal(dialog(ui), undefined); }
    finally { ui.unmount(); }
  });
}

test('a delayed account lookup from an earlier episode cannot open a QR on the next episode', async () => {
  let resolveStatus, checks = 0;
  const ui = mount({ props: { target }, settings,
    prepare: async payload => payload.vidIndex === 1 ? empty : successful(payload),
    apiOverrides: { getAccountStatus: () => { checks++; return new Promise(done => { resolveStatus = done; }); } } });
  try {
    await ui.flush(); assert.equal(checks, 1);
    ui.episode(2); await ui.flush();
    resolveStatus(anonymous); await ui.flush();
    assert.equal(ui.prepares.at(-1).vidIndex, 2);
    assert.equal(dialog(ui), undefined);
  } finally { ui.unmount(); }
});

test('a delayed account lookup cannot open a QR after leaving the player', async () => {
  let resolveStatus;
  const ui = mount({ props: { target }, settings, prepare: async () => empty,
    apiOverrides: { getAccountStatus: () => new Promise(done => { resolveStatus = done; }) } });
  try {
    await ui.flush(); assert.equal(typeof resolveStatus, 'function');
    ui.props.active = false; ui.render();
    resolveStatus(anonymous); await ui.flush();
    assert.equal(dialog(ui), undefined);
  } finally { ui.unmount(); }
});

test('leaving the player closes its displayed QR and rejects late success even after returning', async () => {
  const ui = mount({ props: { target }, settings, prepare: async () => empty,
    apiOverrides: { getAccountStatus: async () => anonymous } });
  try {
    await ui.flush(); assert(dialog(ui));
    const pendingLogin = login(ui);
    ui.props.active = false; ui.render(); await ui.flush();
    assert.equal(dialog(ui), undefined, 'closing the prompt unmounts its account component and cancels native login');
    pendingLogin.props.onSignedIn({ success: true }); await ui.flush();
    assert.equal(ui.prepares.length, 1, 'a late login cannot prepare hidden playback');
    ui.props.active = true; ui.render(); await ui.flush();
    pendingLogin.props.onSignedIn({ success: true }); await ui.flush();
    assert.equal(ui.prepares.length, 1, 'the navigation generation also rejects success after returning');
  } finally { ui.unmount(); }
});

test('floating playback keeps its login active while the main player page is hidden', async () => {
  const ui = mount({ props: { target }, settings, prepare: async payload => successful(payload),
    apiOverrides: { getAccountStatus: async () => valid } });
  try {
    await ui.flush(); ui.metadata(); ui.media.currentTime = 37;
    ui.enterFloatingPlayer(); ui.props.active = false; ui.render(); await ui.flush();
    const first = ui.prepares[0];
    ui.onlinePlayDiagnostics({ requestId: first.requestId, streamId: first.requestId, faultCode: 'ACCOUNT_EXPIRED',
      diagnostics: { source: 'web', stage: 'media', faultCode: 'ACCOUNT_EXPIRED' } });
    await ui.flush(); assert(dialog(ui));
    login(ui).props.onSignedIn({ success: true }); await ui.flush(); ui.metadata();
    assert.equal(ui.prepares.length, 2, 'an active floating player can retry after login');
    assert.equal(ui.media.currentTime, 37);
    assert.equal(ui.media.paused, false);
  } finally { ui.unmount(); }
});

test('closing floating playback closes its QR when the main page is hidden', async () => {
  const ui = mount({ props: { target }, settings, prepare: async () => empty,
    apiOverrides: { getAccountStatus: async () => anonymous } });
  try {
    await ui.flush(); ui.enterFloatingPlayer();
    ui.props.active = false; ui.render(); await ui.flush();
    assert(dialog(ui));
    const pendingLogin = login(ui);
    await ui.exitFloatingPlayer(); await ui.flush();
    assert.equal(dialog(ui), undefined, 'a floating window close must not move its QR over the unrelated main page');
    pendingLogin.props.onSignedIn({ success: true }); await ui.flush();
    assert.equal(ui.prepares.length, 1);
  } finally { ui.unmount(); }
});

test('cancelling pending source preparation discards a late empty response without requesting login', async () => {
  let finish, checks = 0;
  const ui = mount({ props: { target }, settings,
    prepare: () => new Promise(done => { finish = done; }),
    apiOverrides: { getAccountStatus: async () => { checks++; return anonymous; } } });
  try {
    await ui.flush();
    ui.button('取消播放').props.onClick(); await ui.flush();
    const checksAfterCancellation = checks;
    finish(empty); await ui.flush();
    assert.equal(checks, checksAfterCancellation, 'the stale source result cannot trigger another account lookup');
    assert.equal(dialog(ui), undefined);
    assert(ui.releases.length > 0);
  } finally { ui.unmount(); }
});

for (const autoplay of [false, true]) {
  test(`login success retries the same episode at its original progress with ${autoplay ? 'playing' : 'paused'} intent`, async () => {
    const ui = mount({ props: { target }, settings, prepare: async payload => successful(payload),
      apiOverrides: { getAccountStatus: async () => valid } });
    try {
      await ui.flush(); ui.metadata();
      ui.media.currentTime = 37;
      if (!autoplay) ui.media.pause();
      const first = ui.prepares[0];
      ui.onlinePlayDiagnostics({ requestId: first.requestId, streamId: first.requestId, faultCode: 'ACCOUNT_EXPIRED',
        diagnostics: { source: 'web', stage: 'media', faultCode: 'ACCOUNT_EXPIRED' } });
      await ui.flush();
      assert(dialog(ui));
      login(ui).props.onSignedIn({ success: true, signedIn: true, sessionValidity: 'valid' });
      await ui.flush(); ui.metadata();
      assert.equal(dialog(ui), undefined);
      assert.equal(ui.prepares.length, 2);
      assert.equal(ui.prepares[1].vidIndex, 1);
      assert.equal(ui.prepares[1].force, true);
      assert.equal(ui.media.currentTime, 37);
      assert.equal(ui.media.paused, !autoplay);
    } finally { ui.unmount(); }
  });
}

test('account login policy keeps other sources and failed account checks out of automatic prompts', () => {
  for (const seriesId of ['xifan:test', 'custom:test']) {
    assert.equal(shouldOfferAccountLogin({ ...empty, ...empty.diagnostics, seriesId }, anonymous), false);
  }
  assert.equal(shouldOfferAccountLogin({ stage: 'source', faultCode: 'API_EMPTY_RESPONSE' }, { success: false }), false);
});
