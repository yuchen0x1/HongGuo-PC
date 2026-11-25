// Run: node scripts/verify-account-transport.cjs [--output dist/account-transport.json]
// Real Electron networking with synthetic loopback cookies and a disposable profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const outputFlag = process.argv.indexOf('--output');
const output = path.resolve(ROOT, outputFlag >= 0 ? process.argv[outputFlag + 1] : 'dist/account-transport.json');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-account-transport-'));
  const env = { ...process.env };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[name];
  try {
    const child = spawnSync(require('electron'), [__filename, '--profile', profile, '--output', output], {
      cwd: ROOT, env, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024,
    });
    if (child.stdout) process.stdout.write(child.stdout);
    if (child.status !== 0) {
      console.error('Account transport verification failed or exceeded its 45-second budget.');
      process.exitCode = 1;
    }
  } finally {
    const resolved = path.resolve(profile);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('hongguo-account-transport-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
} else {
  const { app, net, session } = require('electron');
  const http = require('node:http');
  const { randomBytes } = require('node:crypto');
  const profileFlag = process.argv.indexOf('--profile');
  const profile = profileFlag >= 0 ? process.argv[profileFlag + 1] : '';
  if (!profile || !path.isAbsolute(profile)) throw new Error('An isolated profile is required.');
  app.setPath('userData', profile);
  app.commandLine.appendSwitch('user-data-dir', profile);
  app.commandLine.appendSwitch('autoplay-policy', 'document-user-activation-required');
  app.commandLine.appendSwitch('disable-background-networking');
  const evidence = {
    startedAt: new Date().toISOString(), electron: process.versions.electron, chrome: process.versions.chrome,
    isolation: { freshProfile: true, inMemorySession: true, loopbackOnly: true, syntheticCookiesOnly: true,
      credentialValuesExported: false, formalAccountAccessed: false, browserWindowsCreated: 0 },
    observations: {}, currentFetchConfigurationSuitable: false, netRequestAlternativeSuitable: false, passed: false,
  };
  let server;
  const sockets = new Set();
  const jarValue = randomBytes(18).toString('hex');
  const explicitValue = randomBytes(18).toString('hex');
  const responseValue = randomBytes(18).toString('hex');

  function observedCookies(header) {
    const values = new Map(String(header || '').split(';').map(pair => {
      const at = pair.indexOf('=');
      return [pair.slice(0, at).trim(), pair.slice(at + 1).trim()];
    }));
    return { jarCookieSent: values.get('fixture_jar') === jarValue,
      explicitCookieSent: values.get('fixture_explicit') === explicitValue,
      responseCookieSent: values.get('fixture_response') === responseValue };
  }

  function requestWithoutJar(target, fixtureSession, cookie) {
    return new Promise((resolve, reject) => {
      const request = net.request({ url: target, method: 'GET', session: fixtureSession,
        useSessionCookies: false, redirect: 'manual' });
      const timer = setTimeout(() => { request.abort(); reject(new Error('Loopback request timed out.')); }, 6000);
      const finish = (handler, value) => { clearTimeout(timer); handler(value); };
      if (cookie) request.setHeader('Cookie', cookie);
      request.on('error', () => finish(reject, new Error('Loopback request failed.')));
      request.on('redirect', () => finish(reject, new Error('Unexpected fixture redirect.')));
      request.on('response', response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', () => finish(reject, new Error('Loopback response failed.')));
        response.on('end', () => {
          try { finish(resolve, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { finish(reject, new Error('Loopback response was not JSON.')); }
        });
      });
      request.end();
    });
  }

  app.whenReady().then(async () => {
    server = http.createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      if (request.url === '/response-cookie') response.setHeader('Set-Cookie', `fixture_response=${responseValue}; Path=/; HttpOnly`);
      response.end(JSON.stringify(observedCookies(request.headers.cookie)));
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const fixtureSession = session.fromPartition(`account-transport-${process.pid}`, { cache: false });
    await fixtureSession.setProxy({ mode: 'direct' });
    await fixtureSession.cookies.set({ url: origin, name: 'fixture_jar', value: jarValue, httpOnly: true, path: '/' });
    const explicitCookie = `fixture_explicit=${explicitValue}`;
    const fetchCase = async (name, credentials, explicit) => {
      const response = await fixtureSession.fetch(`${origin}/${name}`, { credentials, redirect: 'manual',
        signal: AbortSignal.timeout(6000), headers: explicit ? { Cookie: explicitCookie } : {} });
      assert.equal(response.status, 200);
      evidence.observations[name] = await response.json();
    };
    await fetchCase('fetchOmitAnonymous', 'omit', false);
    await fetchCase('fetchOmitExplicit', 'omit', true);
    await fetchCase('fetchIncludeAnonymous', 'include', false);
    await fetchCase('fetchIncludeExplicit', 'include', true);
    evidence.observations.netRequestAnonymous = await requestWithoutJar(`${origin}/net-anonymous`, fixtureSession);
    evidence.observations.netRequestExplicit = await requestWithoutJar(`${origin}/net-explicit`, fixtureSession, explicitCookie);
    await requestWithoutJar(`${origin}/response-cookie`, fixtureSession, explicitCookie);
    const storedCookies = await fixtureSession.cookies.get({ url: origin });
    evidence.observations.netRequestStoresResponseCookie = storedCookies.some(cookie => cookie.name === 'fixture_response' && cookie.value === responseValue);
    evidence.observations.netRequestAfterResponseCookie = await requestWithoutJar(`${origin}/net-after-response`, fixtureSession, explicitCookie);

    assert.equal(evidence.observations.fetchIncludeAnonymous.jarCookieSent, true, 'The positive control must include the preloaded jar Cookie.');
    assert.equal(evidence.observations.fetchOmitAnonymous.jarCookieSent, false, 'Anonymous omit must exclude the jar Cookie.');
    evidence.currentFetchConfigurationSuitable = evidence.observations.fetchOmitExplicit.explicitCookieSent
      && !evidence.observations.fetchOmitExplicit.jarCookieSent;
    evidence.netRequestAlternativeSuitable = evidence.observations.netRequestExplicit.explicitCookieSent
      && !evidence.observations.netRequestExplicit.jarCookieSent
      && !evidence.observations.netRequestAnonymous.jarCookieSent
      && !evidence.observations.netRequestAnonymous.explicitCookieSent
      && !evidence.observations.netRequestAfterResponseCookie.responseCookieSent;
    assert.equal(evidence.netRequestAlternativeSuitable, true, 'The alternative must preserve explicit cookies and exclude ambient cookies.');
    await fixtureSession.clearStorageData();
    evidence.passed = true;
    evidence.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ passed: evidence.passed, electron: evidence.electron,
      currentFetchConfigurationSuitable: evidence.currentFetchConfigurationSuitable,
      netRequestAlternativeSuitable: evidence.netRequestAlternativeSuitable, observations: evidence.observations }, null, 2));
  }).catch(() => {
    evidence.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
    console.error('Synthetic account transport verification failed; no credential values were exported.');
    process.exitCode = 1;
  }).finally(async () => {
    for (const socket of sockets) socket.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    app.exit(process.exitCode || 0);
  });
}
