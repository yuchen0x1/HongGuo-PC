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
// Match NSIS APP_FILENAME so the assisted upgrade does not normalize /D to a new subdirectory.
const installDir = path.join(root, 'hongguo-downloader');
const exe = path.join(installDir, '红果短剧.exe');
const targetInstaller = 'hongguo-downloader-' + to.slice(1) + '-win-x64-setup.exe';
const receipt = { from, to, installDir, expectedExecutable: exe, steps: [], passed: false };
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

const pwsh = (script, moreEnv = {}) => execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command',
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n' + script], {
  encoding: 'utf8', timeout: 10000, windowsHide: true, env: { ...process.env, ...moreEnv },
}).trim();

// NSIS uses native dialogs. UI Automation can expose no descendants on hosted runners.
const installerControls = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class InstallerControls {
  public class Window {
    public long Handle;
    public int ProcessId;
    public int ControlId;
    public string Text;
    public string ClassName;
    public bool Visible;
    public bool Enabled;
    public int ButtonType;
  }
  private delegate bool EnumCallback(IntPtr hwnd, IntPtr state);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr state);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumCallback callback, IntPtr state);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);
  private static Window Describe(IntPtr hwnd) {
    var text = new StringBuilder(2048);
    var name = new StringBuilder(256);
    GetWindowText(hwnd, text, text.Capacity);
    GetClassName(hwnd, name, name.Capacity);
    uint processId;
    GetWindowThreadProcessId(hwnd, out processId);
    return new Window { Handle = hwnd.ToInt64(), ProcessId = (int)processId, ControlId = GetDlgCtrlID(hwnd),
      Text = text.ToString(), ClassName = name.ToString(), Visible = IsWindowVisible(hwnd),
      Enabled = IsWindowEnabled(hwnd), ButtonType = GetWindowLong(hwnd, -16) & 15 };
  }
  public static Window[] Windows(long parent) {
    var result = new List<Window>();
    EnumCallback collect = delegate(IntPtr hwnd, IntPtr state) { result.Add(Describe(hwnd)); return true; };
    if (parent == 0) EnumWindows(collect, IntPtr.Zero);
    else EnumChildWindows(new IntPtr(parent), collect, IntPtr.Zero);
    return result.ToArray();
  }
  public static bool Checked(long handle) {
    IntPtr result;
    if (SendMessageTimeout(new IntPtr(handle), 0x00F0, IntPtr.Zero, IntPtr.Zero, 2, 1000, out result) == IntPtr.Zero)
      throw new InvalidOperationException("Could not read installer checkbox");
    return result.ToInt64() == 1;
  }
  public static void Check(long handle) {
    IntPtr result;
    if (SendMessageTimeout(new IntPtr(handle), 0x00F1, new IntPtr(1), IntPtr.Zero, 2, 1000, out result) == IntPtr.Zero)
      throw new InvalidOperationException("Could not select installer checkbox");
  }
  public static void Click(long handle) {
    var hwnd = new IntPtr(handle);
    if (!PostMessage(GetParent(hwnd), 0x0111, new IntPtr(GetDlgCtrlID(hwnd)), hwnd))
      throw new InvalidOperationException("Could not advance installer dialog");
  }
}
'@
$allProcesses = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
$root = [System.IO.Path]::GetFullPath($env:HONGGUO_TEST_ROOT).TrimEnd('\') + '\'
$trusted = [Collections.Generic.HashSet[int]]::new()
foreach ($process in $allProcesses) {
  if ($process.Name -eq ($env:HONGGUO_TEST_INSTALLER + '.exe') -and $process.ExecutablePath -and
      [System.IO.Path]::GetFullPath($process.ExecutablePath).StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    [void]$trusted.Add([int]$process.ProcessId)
  }
}
do {
  $changed = $false
  foreach ($process in $allProcesses) {
    if ($trusted.Contains([int]$process.ParentProcessId) -and $trusted.Add([int]$process.ProcessId)) { $changed = $true }
  }
} while ($changed)
$installerProcesses = @($allProcesses | Where-Object { $trusted.Contains([int]$_.ProcessId) } |
  Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine)
$installerWindows = @([InstallerControls]::Windows(0) | Where-Object { $trusted.Contains($_.ProcessId) })
`;

let lastInstallerActionAt = 0;
function advanceInstaller() {
  if (Date.now() - lastInstallerActionAt < 1000) return;
  lastInstallerActionAt = Date.now();
  try {
    const output = pwsh([
      installerControls,
      '$result = @()',
      'foreach ($win in $installerWindows) {',
      "  if ($win.ClassName -ne '#32770') { continue }",
      '  $all = @([InstallerControls]::Windows($win.Handle))',
      "  $buttons = @($all | Where-Object { $_.ClassName -eq 'Button' -and $_.Visible })",
      '  $runCheckboxes = @($buttons | Where-Object { $_.ButtonType -in @(2,3,5,6) })',
      '  $checkboxes = @()',
      '  foreach ($checkbox in $runCheckboxes) {',
      '    $checkboxes += [PSCustomObject]@{ name = $checkbox.Text; checked = [InstallerControls]::Checked($checkbox.Handle) }',
      '  }',
      '  $button = $buttons | Where-Object {',
      "    $label = ($_.Text -replace '\\(&.\\)', '' -replace '&', '').Trim()",
      "    $_.Enabled -and $_.ControlId -eq 1 -and $label -match '^(Next(?:\\s*>.*)?|Install|Finish|下一步(?:\\s*>.*)?|下一页|安装|完成|完成安装)$'",
      '  } | Select-Object -First 1',
      '  $clicked = $null',
      '  if ($button) {',
      '    $clicked = $button.Text',
      "    if (($clicked -replace '\\(&.\\)', '' -replace '&', '').Trim() -match '^(Finish|完成|完成安装)$') {",
      "      $runCheckbox = $runCheckboxes | Where-Object { $_.Text -match '(?i)(run|launch|start|open|运行|启动)' } | Select-Object -First 1",
      '      if ($runCheckbox) {',
      '        [InstallerControls]::Check($runCheckbox.Handle)',
      '        $recordedCheckbox = $checkboxes | Where-Object { $_.name -eq $runCheckbox.Text } | Select-Object -First 1',
      '        if ($recordedCheckbox) { $recordedCheckbox.checked = [InstallerControls]::Checked($runCheckbox.Handle) }',
      '      }',
      '    }',
      '    [InstallerControls]::Click($button.Handle)',
      '  }',
      '  $result += [PSCustomObject]@{ processId = $win.ProcessId; title = $win.Text; buttons = @($buttons | ForEach-Object Text); checkboxes = $checkboxes; controls = $all; clicked = $clicked }',
      '}',
      'ConvertTo-Json -InputObject @($result) -Compress -Depth 5',
    ].join('\n'), { HONGGUO_TEST_ROOT: root, HONGGUO_TEST_INSTALLER: path.parse(targetInstaller).name });
    const windows = output ? JSON.parse(output) : [];
    const latest = Array.isArray(windows) ? windows.at(-1) : windows;
    if (latest) {
      receipt.installer = latest;
      if (latest.clicked) receipt.steps.push(`NSIS update wizard advanced via "${latest.clicked}"`);
    }
  } catch (error) {
    receipt.installerAutomationError = error.message;
  }
}

function captureInstallDiagnostics() {
  try {
    const output = pwsh([
      installerControls,
      '$path = [System.IO.Path]::GetFullPath($env:HONGGUO_TEST_EXE)',
      '$version = if (Test-Path -LiteralPath $path) { (Get-Item -LiteralPath $path).VersionInfo.ProductVersion } else { $null }',
      '$windows = @($installerWindows | ForEach-Object { [PSCustomObject]@{ window = $_; controls = @([InstallerControls]::Windows($_.Handle)) } })',
      "$apps = @($allProcesses | Where-Object { $_.Name -eq '红果短剧.exe' } | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine)",
      "$locations = @(Get-ChildItem -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -like '*红果短剧*' } | Select-Object DisplayName,DisplayVersion,InstallLocation)",
      '[PSCustomObject]@{ appExists = (Test-Path -LiteralPath $path); installedVersion = $version; appProcesses = $apps; registeredInstallations = $locations; installerProcesses = $installerProcesses; windows = $windows } | ConvertTo-Json -Compress -Depth 6',
    ].join('\n'), { HONGGUO_TEST_ROOT: root, HONGGUO_TEST_EXE: exe, HONGGUO_TEST_INSTALLER: path.parse(targetInstaller).name });
    receipt.installDiagnostics = JSON.parse(output);
  } catch (error) {
    receipt.installDiagnosticsError = error.message;
  }
  if (!receipt.passed) {
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      pwsh([
        'Add-Type -AssemblyName System.Drawing,System.Windows.Forms',
        '$bounds = [Windows.Forms.SystemInformation]::VirtualScreen',
        '$bitmap = [Drawing.Bitmap]::new($bounds.Width, $bounds.Height)',
        '$graphics = [Drawing.Graphics]::FromImage($bitmap)',
        'try {',
        '  $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)',
        '  $bitmap.Save($env:HONGGUO_TEST_SCREENSHOT, [Drawing.Imaging.ImageFormat]::Png)',
        '} finally { $graphics.Dispose(); $bitmap.Dispose() }',
      ].join('\n'), { HONGGUO_TEST_SCREENSHOT: out.replace(/\.json$/, '.png') });
    } catch (error) {
      receipt.screenshotError = error.message;
    }
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
  receipt.restartedProcessId = restarted;
  receipt.installedVersion = version;
  assert.equal(version, to.slice(1) + '.0.0', 'Windows executable must report the exact four-part target version');
  receipt.steps.push('Update installer exited the old app and launched the new installed executable');

  process.kill(restarted);
  await waitFor('the automatic instance to close', 15000, () => !automaticAppProcess(previousPid));
  await launch(to.slice(1) + '.0');
  assert.equal(await runJs('localStorage.getItem(' + JSON.stringify(storageKey) + ')'), marker);
  assert.equal((await runJs('window.electronAPI.getSettings()')).root, path.join(root, 'downloads'));
  receipt.steps.push('Reopened target app with the isolated profile reports the exact version and retains settings and local storage');
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
