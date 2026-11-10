// Install only on disposable GitHub Windows CI; --config is safe on any host.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const root = path.resolve(__dirname, '..');
const releaseVersion = pkg.version.replace(/^(\d+\.\d+)\.0$/, '$1');
const setupName = `hongguo-downloader-${releaseVersion}-win-x64-setup.exe`;
const correspondingSourceName = 'FFmpeg-Corresponding-Source.tar.gz';
const correspondingSourceAsset = 'ffmpeg-9.0.2-x264-b35605a-win-x64-corresponding-source.tar.gz';
const previousRelease = {
  version: '1.80.0',
  url: 'https://github.com/jackotom/hongguo-drama/releases/download/v1.80/hongguo-downloader-1.80.0-win-x64-setup.exe',
  // GitHub release asset 655494674, verified against the release API.
  sha256: '37b2b54f68648eff6d4b29f221f90681e55a304aaf5a6720ebfc83d702c29b06',
};

function checkConfig() {
  const lock = require('../package-lock.json');
  assert(require('semver').gt(pkg.version, previousRelease.version), 'Upgrade candidate must be newer than the real previous installer');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.match(pkg.build.nsis.artifactName, /-win-x64-setup\.\$\{ext\}$/);
  assert(pkg.build.win.extraFiles.some(file => file.from === 'build/ffmpeg/FFmpeg-Corresponding-Source.tar.gz' && file.to === correspondingSourceName), 'GPL FFmpeg/x264 corresponding source must be included as an installer license document');
  assert.match(pkg.build.win.extraResources.find(resource => resource.from === 'build/ffmpeg').filter.join(','), /ffmpeg\.exe/);
  assert(pkg.build.mac.target.some(target => target.target === 'zip' && target.arch.includes('arm64') && target.arch.includes('x64')));
  assert(pkg.build.mac.extraResources.some(resource => resource.from === 'build/app-update.yml' && resource.to === 'app-update.yml'), 'Mac directory builds must carry updater configuration');
  assert.notEqual(pkg.build.win.verifyUpdateCodeSignature, false);
}

checkConfig();
if (process.argv.includes('--config')) console.log('Release configuration: PASS');
else runInstallerCheck().catch(error => { console.error(error.stack); process.exitCode = 1; });

async function runInstallerCheck() {
  assert.equal(process.platform, 'win32', 'Installer check requires Windows');
  assert.equal(process.arch, 'x64');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Only run on disposable GitHub Actions runners');
  const { execFileSync, spawn } = require('node:child_process');
  const { createHash } = require('node:crypto');
  const out = path.join(root, 'dist/windows-verification');
  fs.mkdirSync(out, { recursive: true });
  const result = { version: pkg.version, checks: [], crossVersionUpgradeTested: false, passed: false };
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hongguo-installer-'));
  const installDir = path.join(temp, 'installed');
  let profile = path.join(temp, 'profile');
  const mediaDir = path.join(temp, 'downloads');
  const setup = path.join(root, 'dist', setupName);
  const correspondingSource = path.join(installDir, correspondingSourceName);
  const exe = path.join(installDir, pkg.build.productName + '.exe');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let child, socket, sequence = 0;
  const pending = new Map();

  function stopApp() {
    socket?.close(); socket = null;
    if (child?.pid) {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    }
    child = null;
  }

  async function quitAppNormally() {
    const appProcess = child;
    assert(appProcess && appProcess.exitCode === null && appProcess.signalCode === null, 'Application must still be running before normal quit');
    let timer, onExit;
    const exited = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Installed application did not quit normally within 15 seconds')), 15000);
      onExit = (code, signal) => code === 0 && signal === null
        ? resolve()
        : reject(new Error(`Installed application exited abnormally: code=${code}, signal=${signal}`));
      appProcess.once('exit', onExit);
    });
    try {
      // Closing destroys this context, so only process exit can reliably acknowledge the request.
      socket.send(JSON.stringify({ id: ++sequence, method: 'Runtime.evaluate', params: { expression: 'window.close()' } }));
      await exited;
      socket?.close(); socket = null;
      child = null;
    } finally {
      clearTimeout(timer);
      appProcess.removeListener('exit', onExit);
    }
  }

  function install(installer = setup) {
    // /D must be the final NSIS argument; this path belongs only to this CI run.
    execFileSync(installer, ['/S', '/currentuser', '/D=' + installDir], { timeout: 120000, windowsHide: true, stdio: 'pipe' });
    assert(fs.existsSync(exe), 'NSIS did not install the application at the isolated destination');
  }

  function evaluate(expression) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Installer renderer check timed out')); }, 15000);
      pending.set(id, message => {
        clearTimeout(timer);
        if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        else resolve(message.result.result.value);
      });
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  }

  async function launch(expectedVersion = pkg.version) {
    child = spawn(exe, ['--mute-audio', '--user-data-dir=' + profile, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9440'], { stdio: 'ignore' });
    let launchError;
    child.once('error', error => { launchError = error; });
    let target;
    for (let i = 0; i < 150 && !target; i++) {
      if (launchError) throw launchError;
      try { target = (await (await fetch('http://127.0.0.1:9440/json')).json()).find(item => item.type === 'page' && item.url.startsWith('file:')); } catch {}
      if (!target) await delay(200);
    }
    assert(target, 'Installed application did not open its renderer');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const callback = pending.get(message.id);
      if (callback) { pending.delete(message.id); callback(message); }
    });
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    for (let i = 0; i < 100; i++) {
      if (await evaluate('Boolean(window.electronAPI && document.querySelector("#root")?.children.length)')) break;
      await delay(100);
    }
    assert(await evaluate('document.querySelector("#root").children.length > 0'));
    const actualVersion = (await evaluate('window.electronAPI.getAppInfo()')).version;
    assert.equal(actualVersion, expectedVersion, 'Running installed application must report the expected version');
    result.checks.push(`Installed executable reports ${actualVersion}`);
    assert.equal((await evaluate('window.electronAPI.getSettings()')).root, mediaDir);
  }

  try {
    const installerStats = fs.statSync(setup);
    assert(installerStats.size > 0, 'NSIS installer must not be empty');
    const installerHeader = Buffer.alloc(64);
    const installerHandle = fs.openSync(setup, 'r');
    fs.readSync(installerHandle, installerHeader, 0, installerHeader.length, 0);
    fs.closeSync(installerHandle);
    assert.equal(installerHeader.toString('ascii', 0, 2), 'MZ', 'NSIS installer must be a PE executable');
    const peOffset = installerHeader.readUInt32LE(0x3c);
    const peSignature = Buffer.alloc(6);
    const peHandle = fs.openSync(setup, 'r');
    fs.readSync(peHandle, peSignature, 0, peSignature.length, peOffset);
    fs.closeSync(peHandle);
    assert.equal(peSignature.readUInt32LE(0), 0x4550, 'NSIS installer must contain a PE signature');
    assert.equal(peSignature.readUInt16LE(4), 0x8664, 'NSIS installer must be x64');
    result.checks.push('NSIS installer is a PE x64 executable');
    result.authenticode = execFileSync('pwsh.exe', ['-NoProfile', '-Command', '(Get-AuthenticodeSignature -LiteralPath $env:HONGGUO_VERIFY_EXE).Status.ToString()'], { encoding: 'utf8', env: { ...process.env, HONGGUO_VERIFY_EXE: setup } }).trim();
    assert.equal(result.authenticode, 'NotSigned');
    result.checks.push('NSIS installer Authenticode status is NotSigned');
    fs.mkdirSync(profile); fs.mkdirSync(mediaDir);
    assert(fs.existsSync(path.join(root, 'build/ffmpeg', correspondingSourceAsset)), 'Windows build input must contain the FFmpeg/x264 corresponding source archive');
    const sourceDigest = createHash('sha256').update(fs.readFileSync(path.join(root, 'build/ffmpeg', correspondingSourceAsset))).digest('hex');
    const sourceInput = path.join(root, 'build/ffmpeg', correspondingSourceName);
    assert(fs.existsSync(sourceInput), 'Installer build input must include the renamed corresponding source license document');
    assert.equal(createHash('sha256').update(fs.readFileSync(sourceInput)).digest('hex'), sourceDigest, 'Packaged corresponding source input must exactly match the validated Windows media source archive');
    const retainedFile = path.join(mediaDir, 'retained-download.txt');
    fs.writeFileSync(retainedFile, 'Existing download must survive installation');
    const isolatedSettings = { root: mediaDir, watch_updates_enabled: false, watch_sequels_enabled: false, app_updates_enabled: false };
    fs.writeFileSync(path.join(profile, 'data.json'), JSON.stringify({ settings: isolatedSettings }));
    install();
    assert(fs.existsSync(correspondingSource), 'Installed application directory must retain the GPL FFmpeg/x264 corresponding source document');
    assert.equal(createHash('sha256').update(fs.readFileSync(correspondingSource)).digest('hex'), sourceDigest, 'Installed corresponding source document must exactly match the validated candidate archive');
    result.checks.push('NSIS installs into a fresh temporary directory and includes the matching GPL FFmpeg/x264 corresponding source document');
    await launch();
    assert.equal((await evaluate('(async () => { const settings = await window.electronAPI.getSettings(); return window.electronAPI.saveSettings({ ...settings, download_quality: "720p" }); })()')).success, true);
    assert.equal(await evaluate('localStorage.setItem("hongguo-installer-smoke", "retained"); localStorage.getItem("hongguo-installer-smoke")'), 'retained');
    await quitAppNormally();
    install();
    await launch();
    assert.equal((await evaluate('window.electronAPI.getSettings()')).download_quality, '720p');
    assert.equal(await evaluate('localStorage.getItem("hongguo-installer-smoke")'), 'retained');
    assert.equal(fs.readFileSync(retainedFile, 'utf8'), 'Existing download must survive installation');
    await quitAppNormally();
    result.checks.push('Installed application opens before and after same-version reinstall; isolated settings, local storage and existing download remain');

    // Clear only this disposable CI installation so the legacy baseline is a fresh install.
    execFileSync(path.join(installDir, `Uninstall ${pkg.build.productName}.exe`),
      ['/S', '/currentuser', '/KEEP_APP_DATA', '_?=' + installDir],
      { timeout: 120000, windowsHide: true, stdio: 'pipe' });
    assert(!fs.existsSync(exe), 'Temporary installation must be removed before installing the legacy baseline');
    const oldSetup = path.join(temp, 'previous-setup.exe');
    const response = await fetch(previousRelease.url, { signal: AbortSignal.timeout(120000) });
    assert(response.ok, `Previous official installer download failed: HTTP ${response.status}`);
    await require('node:stream/promises').pipeline(require('node:stream').Readable.fromWeb(response.body), fs.createWriteStream(oldSetup));
    const previousDigest = createHash('sha256').update(fs.readFileSync(oldSetup)).digest('hex');
    assert.equal(previousDigest, previousRelease.sha256, 'Previous official installer SHA256 mismatch');
    result.previousInstaller = { ...previousRelease, verifiedSha256: previousDigest };
    profile = path.join(temp, 'upgrade-profile');
    fs.mkdirSync(profile);
    const historyId = '990000000001';
    fs.writeFileSync(path.join(profile, 'data.json'), JSON.stringify({
      settings: isolatedSettings,
      series: [{ series_id: historyId, series_title: 'Installer upgrade verification', total: 2, episodes: [] }],
    }));
    install(oldSetup);
    await launch(previousRelease.version);
    assert.equal((await evaluate('(async () => { const settings = await window.electronAPI.getSettings(); return window.electronAPI.saveSettings({ ...settings, download_quality: "1080p" }); })()')).success, true);
    assert.equal((await evaluate(`window.electronAPI.savePlaybackPosition(${JSON.stringify(historyId)}, 2, 37.5)`)).success, true);
    assert.equal(await evaluate('localStorage.setItem("hongguo-upgrade-smoke", "from-1.80"); localStorage.getItem("hongguo-upgrade-smoke")'), 'from-1.80');
    const oldHistory = (await evaluate('window.electronAPI.getWatchHistory()')).results;
    assert.equal(oldHistory.length, 1);
    assert.equal(oldHistory[0].series_id, historyId);
    assert.equal(oldHistory[0].currentTime, 37.5);
    await quitAppNormally();
    result.checks.push('Real SHA256-pinned 1.80 NSIS installs, reports 1.80.0, saves settings and viewing history, and quits normally');
    install();
    await launch();
    assert.equal((await evaluate('window.electronAPI.getSettings()')).download_quality, '1080p');
    assert.equal(await evaluate('localStorage.getItem("hongguo-upgrade-smoke")'), 'from-1.80');
    const upgradedHistory = (await evaluate('window.electronAPI.getWatchHistory()')).results;
    assert.equal(upgradedHistory.length, oldHistory.length, 'Upgrade must retain every history row');
    for (const oldRecord of oldHistory) {
      const current = upgradedHistory.find(item => item.series_id === oldRecord.series_id);
      assert.ok(current, 'Upgrade must retain the same history series');
      for (const [key, value] of Object.entries(oldRecord)) assert.deepEqual(current[key], value, `Upgrade must retain history ${key}`);
      assert.equal(current.completed, false, 'Legacy history has no end-of-episode evidence');
    }
    assert.equal(fs.readFileSync(retainedFile, 'utf8'), 'Existing download must survive installation');
    await quitAppNormally();
    result.crossVersionUpgradeTested = true;
    result.checks.push(`Real 1.80.0 → ${pkg.version} NSIS upgrade reports the new version and retains settings, viewing history, local storage and existing download`);
    result.passed = true;
    console.log('Windows NSIS smoke: PASS (installation, launch, metadata, same-version retention, real 1.80 upgrade retention)');
  } catch (error) {
    result.error = error.stack;
    throw error;
  } finally {
    stopApp();
    fs.writeFileSync(path.join(out, 'installer-result.json'), JSON.stringify(result, null, 2) + '\n');
  }
}
