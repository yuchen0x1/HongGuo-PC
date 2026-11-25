// Real GitHub update acceptance. Run only on a disposable GitHub-hosted Windows runner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');

const [from, to] = process.argv.slice(2);
const tagPattern = /^v\d+\.\d+$/;
assert(tagPattern.test(from) && tagPattern.test(to) && from !== to, 'Provide different stable tags');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');

const repo = 'yuchen0x1/HongGuo-PC';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-live-update-'));
const out = path.resolve('dist/windows-live-update.json');
const installDir = path.join(root, '红果短剧');
const exe = path.join(installDir, '红果短剧.exe');
const targetInstaller = 'hongguo-downloader-' + to.slice(1) + '-win-x64-setup.exe';
const receipt = { from, to, steps: [], passed: false };
const marker = randomUUID();
const storageKey = 'hongguo-live-update-test';
let port = 0;
let socket, child, previousPid = null, id = 0;

async function waitFor(label, timeout, read) {
  for (const deadline = Date.now() + timeout; Date.now() < deadline;) {
    const value = await read();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw new Error('Timed out waiting for ' + label);
}

async function json(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Hongguo-Windows-Live-Update-Acceptance' },
  });
  assert(response.ok, 'HTTP ' + response.status + ' while reading acceptance metadata');
  return response.json();
}

async function launch(expected) {
  port = await reservePort();
  fs.mkdirSync(path.join(root, 'downloads'), { recursive: true });
  fs.mkdirSync(path.join(root, 'temp'), { recursive: true });
  child = spawn(exe, [
    '--mute-audio',
    '--user-data-dir=' + path.join(root, 'profile'),
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=' + port,
  ], {
    stdio: 'ignore',
    env: {
      ...process.env,
      APPDATA: path.join(root, 'roaming'),
      LOCALAPPDATA: path.join(root, 'local'),
      TEMP: path.join(root, 'temp'),
      TMP: path.join(root, 'temp'),
      PORTABLE_EXECUTABLE_DIR: '',
      PORTABLE_EXECUTABLE_FILE: '',
    },
  });
  const target = await waitFor('installed renderer', 30000, async () => {
    try {
      return (await json('http://127.0.0.1:' + port + '/json')).find(item => item.type === 'page' && item.url.startsWith('file:'));
    } catch { return false; }
  });
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Renderer socket did not connect')), 15000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Renderer socket failed')); }, { once: true });
  });
  await waitFor('app UI', 15000, () => runJs('Boolean(window.electronAPI && document.querySelector("#root")?.children.length)'));
  const info = await runJs('window.electronAPI.getAppInfo()');
  assert.equal(info.version, expected);
  assert(path.resolve(info.dataDir).toLowerCase().startsWith(root.toLowerCase() + path.sep), 'App profile escaped the isolated test directory');
}

async function reservePort() {
  const server = require('node:net').createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

function runJs(expression, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const request = ++id;
    const timer = setTimeout(() => {
      socket.removeEventListener('message', receive);
      reject(new Error('Renderer acceptance request timed out'));
    }, timeout);
    function receive(event) {
      const message = JSON.parse(event.data);
      if (message.id !== request) return;
      clearTimeout(timer);
      socket.removeEventListener('message', receive);
      if (message.error || message.result?.exceptionDetails) reject(new Error('Renderer acceptance request failed'));
      else resolve(message.result.result.value);
    }
    socket.addEventListener('message', receive);
    socket.send(JSON.stringify({ id: request, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}

const pwsh = (script, moreEnv = {}) => execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
  encoding: 'utf8', timeout: 10000, windowsHide: true, env: { ...process.env, ...moreEnv },
}).trim();

let lastInstallerFinishAttempt = 0;
function finishInstaller() {
  if (Date.now() - lastInstallerFinishAttempt < 1500) return;
  lastInstallerFinishAttempt = Date.now();
  // Assisted NSIS may wait on its Finish page before honoring "Run app".
  // This only invokes an enabled Finish button in the exact target installer process.
  try {
    pwsh([
      'Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes',
      '$process = Get-Process -Name $env:HONGGUO_TEST_INSTALLER -ErrorAction SilentlyContinue',
      'foreach ($p in $process) {',
      '  if (-not $p.MainWindowHandle) { continue }',
      '  $win = [Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)',
      '  $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, "Finish")',
      '  $button = $win.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)',
      '  if ($button -and $button.Current.IsEnabled) {',
      '    $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()',
      '  }',
      '}',
    ].join('\n'), { HONGGUO_TEST_INSTALLER: path.parse(targetInstaller).name });
  } catch {}
}

function automaticAppProcess(previousPid) {
  try {
    const list = pwsh([
      '$target = [System.IO.Path]::GetFullPath($env:HONGGUO_TEST_EXE)',
      'try {',
      "  Get-CimInstance -ClassName Win32_Process -Filter \"Name = '红果短剧.exe'\" -ErrorAction Stop |",
      '    Where-Object { $_.ExecutablePath -and [string]::Equals([System.IO.Path]::GetFullPath($_.ExecutablePath), $target, [StringComparison]::OrdinalIgnoreCase) } |',
      '    Select-Object -ExpandProperty ProcessId',
      '} catch {}',
    ].join('\n'), { HONGGUO_TEST_EXE: exe });
    return list.split(/\s+/).map(Number).find(pid => pid > 0 && pid !== previousPid);
  } catch {
    return null;
  }
}

(async () => {
  const base = 'https://api.github.com/repos/' + repo + '/releases/';
  const [old, newest] = await Promise.all([json(base + 'tags/' + from), json(base + 'latest')]);
  assert.equal(old.tag_name, from);
  assert(!old.draft && !old.prerelease);
  assert.equal(newest.tag_name, to, 'Target must be the latest stable release');
  assert(!newest.draft && !newest.prerelease);
  const expectedAssets = [targetInstaller, 'latest.yml'].sort();
  assert.deepEqual(newest.assets.map(item => item.name).sort(), expectedAssets, 'Target must contain only the Windows installer and updater metadata');
  const oldName = 'hongguo-downloader-' + from.slice(1) + '-win-x64-setup.exe';
  const asset = old.assets.find(item => item.name === oldName);
  assert(/^\d+$/.test(String(asset?.size)) && /^sha256:[0-9a-f]{64}$/.test(asset.digest));
  const download = await fetch('https://github.com/' + repo + '/releases/download/' + from + '/' + oldName,
    { signal: AbortSignal.timeout(180000) });
  assert(download.ok, 'Could not download the baseline installer');
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(bytes.length, asset.size);
  assert.equal('sha256:' + createHash('sha256').update(bytes).digest('hex'), asset.digest);
  const installer = path.join(root, oldName);
  fs.writeFileSync(installer, bytes);
  execFileSync(installer, ['/S', '/currentuser', '/D=' + installDir], { timeout: 120000, windowsHide: true });
  await launch(from.slice(1) + '.0');
  assert.equal(await runJs('window.electronAPI.saveSettings({ root: ' + JSON.stringify(path.join(root, 'downloads')) + ', app_updates_enabled: true }).then(x => x.success)'), true);
  await runJs('localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(marker) + ')');
  receipt.steps.push('Baseline installer matched public SHA-256 and launched');

  const found = await runJs('window.electronAPI.checkAppUpdate()', 30000);
  assert.equal(found.enabled, true);
  assert.equal(found.currentVersion, from.slice(1));
  assert.equal(found.release?.version, to.slice(1), 'Installed app must discover the public target');
  receipt.steps.push('Installed app discovered the stable target');
  const completed = await runJs('window.electronAPI.downloadAppUpdate()', 240000);
  assert(completed?.success, completed?.error || 'Update download failed');
  assert.equal(completed.state?.status, 'downloaded');
  assert.equal(completed.state?.percent, 100);
  receipt.steps.push('electron-updater downloaded and accepted the target package');

  previousPid = child.pid;
  const installation = await runJs('window.electronAPI.installAppUpdate()');
  assert(installation?.success, installation?.error || 'Update install did not start');
  await waitFor('the previous app to exit', 30000, () => child.exitCode !== null);
  socket.close();
  socket = null;
  child = null;

  const restarted = await waitFor('the updater to open the new app', 180000, () => {
    finishInstaller();
    return automaticAppProcess(previousPid);
  });
  const version = pwsh('(Get-Item -LiteralPath $env:HONGGUO_TEST_EXE).VersionInfo.ProductVersion', { HONGGUO_TEST_EXE: exe });
  assert.equal(version, to.slice(1) + '.0');
  receipt.steps.push('Update installer exited the old app and launched the new installed executable');

  process.kill(restarted);
  await waitFor('the automatic instance to close', 15000, () => !automaticAppProcess(previousPid));
  await launch(to.slice(1) + '.0');
  assert.equal(await runJs('localStorage.getItem(' + JSON.stringify(storageKey) + ')'), marker);
  assert.equal((await runJs('window.electronAPI.getSettings()')).root, path.join(root, 'downloads'));
  receipt.steps.push('New app reports the exact target version and retains settings and local storage');
  receipt.passed = true;
})().catch(error => {
  receipt.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => {
  socket?.close();
  child?.kill();
  try {
    const leftover = automaticAppProcess(previousPid ?? -1);
    if (leftover) execFileSync('taskkill', ['/PID', String(leftover), '/T', '/F'], { stdio: 'ignore' });
  } catch {}
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
});
