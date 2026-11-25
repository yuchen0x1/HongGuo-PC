const fs = require('node:fs');
const path = require('node:path');

const PROFILE_NAMES = Object.freeze(['hongguo-downloader', '红果短剧']);
const ACCOUNT_FILES = Object.freeze(['account-session.bin', 'account-session.bin.tmp']);

function cleanupError() {
  return Object.assign(new Error('Account data cleanup did not complete.'), { code: 'ACCOUNT_STORAGE_ERROR' });
}

function isOfficialCookie(cookie) {
  const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
  return domain === 'hongguoduanju.com' || domain.endsWith('.hongguoduanju.com');
}

function removeFile(fsImpl, filename) {
  try { fsImpl.unlinkSync(filename); }
  catch (error) { if (error.code !== 'ENOENT') throw cleanupError(); }
}

async function clearProfile(profile, { session, fsImpl }) {
  const revoked = path.join(profile, 'account-session.bin.revoked');
  let failed = false;
  try {
    const fd = fsImpl.openSync(revoked, 'w', 0o600);
    try { fsImpl.writeFileSync(fd, 'revoked\n'); fsImpl.fsyncSync(fd); }
    finally { fsImpl.closeSync(fd); }
  } catch { /* Successful removal can still clear all account data. */ }

  let removed = 0;
  try {
    const jar = session.fromPath(profile, { cache: false }).cookies;
    const cookies = (await jar.get({})).filter(isOfficialCookie);
    const results = await Promise.allSettled(cookies.map(cookie => jar.remove(
      `https://${String(cookie.domain).replace(/^\./, '')}${cookie.path || '/'}`, cookie.name)));
    removed = results.filter(result => result.status === 'fulfilled').length;
    if (results.some(result => result.status === 'rejected')) failed = true;
    if ((await jar.get({})).some(isOfficialCookie)) failed = true;
    await jar.flushStore();
  } catch { failed = true; }

  // A Cookie failure must not prevent removal of the independent encrypted store.
  for (const filename of ACCOUNT_FILES) {
    try { removeFile(fsImpl, path.join(profile, filename)); }
    catch { failed = true; }
  }
  if (!failed) {
    try { removeFile(fsImpl, revoked); } catch { failed = true; }
  }
  if (failed) throw cleanupError();
  return removed;
}

async function cleanupAccountProfiles({ app, session, fsImpl = fs }) {
  const parent = path.resolve(app.getPath('appData'));
  const profiles = [];
  let failed = false;
  for (const name of PROFILE_NAMES) {
    const profile = path.join(parent, name);
    try {
      const stat = fsImpl.lstatSync(profile);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw cleanupError();
      profiles.push(profile);
    } catch (error) { if (error.code !== 'ENOENT') failed = true; }
  }
  const results = await Promise.allSettled(profiles.map(profile => clearProfile(profile, { session, fsImpl })));
  if (failed || results.some(result => result.status === 'rejected')) throw cleanupError();
  return { profilesProcessed: profiles.length,
    officialCookiesRemoved: results.reduce((sum, result) => sum + result.value, 0) };
}

function runAccountUninstall({ app, session } = require('electron')) {
  // The installer calls this before removing its files. Never load the UI or store.
  if (app.commandLine.hasSwitch('user-data-dir') || !app.requestSingleInstanceLock()) {
    app.exit(1);
    return;
  }
  app.commandLine.appendSwitch('disable-background-networking');
  const timeout = setTimeout(() => app.exit(1), 30000);
  app.whenReady().then(() => cleanupAccountProfiles({ app, session })).then(
    () => { clearTimeout(timeout); app.exit(0); },
    () => { clearTimeout(timeout); app.exit(1); },
  );
}

module.exports = { cleanupAccountProfiles, runAccountUninstall, isOfficialCookie };
