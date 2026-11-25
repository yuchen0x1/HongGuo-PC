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

async function launch(expected, expectUpdateNotice = false) {
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
  if (expectUpdateNotice) {
    receipt.steps.push('Baseline installer matched public SHA-256 and launched');
    const targetVersion = JSON.stringify('v' + to.slice(1));
    const notice = await waitFor('visible startup update notice', 45000, () => runJs(`(() => {
      const element = document.querySelector('[role="dialog"][aria-label="软件更新"]');
      const title = element?.querySelector('h2')?.textContent || '';
      const style = element && getComputedStyle(element);
      const visible = Boolean(element?.getClientRects().length && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0);
      return visible && title.includes(${targetVersion}) ? { title, label: element.getAttribute('aria-label') } : null;
    })()`));
    assert.equal(notice.label, '软件更新');
    assert(notice.title.includes('v' + to.slice(1)));
    receipt.steps.push(`Previous version visibly displayed the startup update notice for ${to}`);
  }
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

let lastInstallerActionAt = 0;
function advanceInstaller() {
  if (Date.now() - lastInstallerActionAt < 1000) return;
  lastInstallerActionAt = Date.now();
  try {
    const output = pwsh([
      'Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes',
      '$process = Get-Process -Name $env:HONGGUO_TEST_INSTALLER -ErrorAction SilentlyContinue',
      '$result = @()',
      'foreach ($p in $process) {',
      '  if (-not $p.MainWindowHandle) { continue }',
      '  $win = [Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)',
      '  $all = $win.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)',
      '  $buttons = @()',
      '  $runCheckboxes = @()',
      '  $checkboxes = @()',
      '  foreach ($element in $all) {',
      "    if ($element.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and -not $element.Current.IsOffscreen) {",
      '      $buttons += $element',
      '    }',
      "    if ($element.Current.ControlType.ProgrammaticName -eq 'ControlType.CheckBox' -and -not $element.Current.IsOffscreen) {",
      '      $runCheckboxes += $element',
      '    }',
      '  }',
      '  $labels = @($buttons | ForEach-Object { $_.Current.Name })',
      '  foreach ($checkbox in $runCheckboxes) {',
      '    $pattern = $checkbox.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern)',
      '    $checkboxes += [PSCustomObject]@{ name = $checkbox.Current.Name; checked = ($pattern.Current.ToggleState -eq [Windows.Automation.ToggleState]::On) }',
      '  }',
      '  $button = $buttons | Where-Object {',
      "    $_.Current.IsEnabled -and $_.Current.Name.Trim().TrimStart('&') -match '^(Next(?:\\s*>.*)?|Install|Finish|下一步|下一页|安装|完成|完成安装)$'",
      '  } | Select-Object -First 1',
      '  $clicked = $null',
      '  if ($button) {',
      '    $clicked = $button.Current.Name',
      "    if ($clicked.Trim().TrimStart('&') -match '^(Finish|完成|完成安装)$') {",
      "      $runCheckbox = $runCheckboxes | Where-Object { $_.Current.Name -match '(?i)(run|launch|start|open|运行|启动)' } | Select-Object -First 1",
      '      if ($runCheckbox) {',
      '        $pattern = $runCheckbox.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern)',
      '        if ($pattern.Current.ToggleState -ne [Windows.Automation.ToggleState]::On) { $pattern.Toggle() }',
      '        $recordedCheckbox = $checkboxes | Where-Object { $_.name -eq $runCheckbox.Current.Name } | Select-Object -First 1',
      '        if ($recordedCheckbox) { $recordedCheckbox.checked = ($pattern.Current.ToggleState -eq [Windows.Automation.ToggleState]::On) }',
      '      }',
      '    }',
      '    $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()',
      '  }',
      '  $result += [PSCustomObject]@{ processId = $p.Id; title = $win.Current.Name; buttons = $labels; checkboxes = $checkboxes; clicked = $clicked }',
      '}',
      'ConvertTo-Json -InputObject @($result) -Compress -Depth 4',
    ].join('\n'), { HONGGUO_TEST_INSTALLER: path.parse(targetInstaller).name });
    const windows = output ? JSON.parse(output) : [];
    const latest = Array.isArray(windows) ? windows.at(-1) : windows;
    if (latest) {
      receipt.installer = { processId: latest.processId, title: latest.title, buttons: latest.buttons, checkboxes: latest.checkboxes, clicked: latest.clicked };
      if (latest.clicked) receipt.steps.push(`NSIS update wizard advanced via "${latest.clicked}"`);
    }
  } catch {}
}

function captureInstallDiagnostics() {
  try {
    const output = pwsh([
      '$path = [System.IO.Path]::GetFullPath($env:HONGGUO_TEST_EXE)',
      '$version = if (Test-Path -LiteralPath $path) { (Get-Item -LiteralPath $path).VersionInfo.ProductVersion } else { $null }',
      '$name = $env:HONGGUO_TEST_INSTALLER + ".exe"',
      "$filter = 'Name = ' + [char]39 + $name + [char]39",
      '$installers = @(Get-CimInstance -ClassName Win32_Process -Filter $filter -ErrorAction SilentlyContinue | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine)',
      '[PSCustomObject]@{ appExists = (Test-Path -LiteralPath $path); installedVersion = $version; installerProcesses = $installers } | ConvertTo-Json -Compress -Depth 4',
    ].join('\n'), { HONGGUO_TEST_EXE: exe, HONGGUO_TEST_INSTALLER: path.parse(targetInstaller).name });
    receipt.installDiagnostics = JSON.parse(output);
  } catch (error) {
    receipt.installDiagnosticsError = error.message;
  }
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
  await launch(from.slice(1) + '.0', true);
  assert.equal(await runJs('window.electronAPI.saveSettings({ root: ' + JSON.stringify(path.join(root, 'downloads')) + ', app_updates_enabled: true }).then(x => x.success)'), true);
  await runJs('localStorage.setItem(' + JSON.stringify(storageKey) + ', ' + JSON.stringify(marker) + ')');

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
    advanceInstaller();
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
  captureInstallDiagnostics();
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
