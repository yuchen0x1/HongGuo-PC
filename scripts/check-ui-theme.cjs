// Full Electron UI theme audit against the already-built dist-react renderer.
// Usage: node scripts/check-ui-theme.cjs --baseline | --after | --settings-search [--output-dir directory]
// Runs the real app in a disposable profile; it never plays or downloads media.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_THEME_ONLY = process.argv.includes('--default-theme');
const SETTINGS_ONLY = process.argv.includes('--settings-search');
const MODE = DEFAULT_THEME_ONLY ? 'default-theme'
  : SETTINGS_ONLY || process.argv.includes('--after') ? 'after'
    : process.argv.includes('--baseline') ? 'before' : '';
if (!MODE) {
  console.error('Usage: node scripts/check-ui-theme.cjs --baseline | --after | --settings-search | --default-theme');
  process.exit(2);
}
const outputFlag = process.argv.indexOf('--output-dir');
const requestedOutput = outputFlag >= 0 ? process.argv[outputFlag + 1] : '';
if (outputFlag >= 0 && (!requestedOutput || requestedOutput.startsWith('--'))) throw new Error('--output-dir requires a directory');
const OUTPUT_DIR = requestedOutput ? path.resolve(ROOT, requestedOutput) : SETTINGS_ONLY
  ? path.join(ROOT, 'docs', 'screenshots', 'settings-search-6.21')
  : DEFAULT_THEME_ONLY ? path.join(os.tmpdir(), `hongguo-default-theme-${process.pid}`)
    : path.join(ROOT, 'docs', 'screenshots', 'ui-audit-2026-11-20', MODE);

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  if (!DEFAULT_THEME_ONLY) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-ui-theme-'));
  const downloadRoot = path.join(profile, 'independent-downloads');
  fs.mkdirSync(downloadRoot, { recursive: true });
  fs.writeFileSync(path.join(profile, 'data.json'), JSON.stringify({
    settings: {
      root: downloadRoot,
      app_updates_enabled: false,
      watch_updates_enabled: false,
      watch_sequels_enabled: false,
      watch_notifications_enabled: false,
    },
  }, null, 2));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const childMode = DEFAULT_THEME_ONLY ? '--default-theme'
      : SETTINGS_ONLY ? '--settings-search' : MODE === 'before' ? '--baseline' : '--after';
    const result = spawnSync(require('electron'), [__filename, childMode, '--profile', profile, ...(requestedOutput ? ['--output-dir', OUTPUT_DIR] : [])], {
      cwd: ROOT, env, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.status !== 0) {
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.error) process.stderr.write(`${result.error.message}\n`);
      if (result.status === null) process.stderr.write('Electron UI audit timed out after 300 seconds.\n');
      process.exitCode = 1;
    }
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow, nativeTheme, screen } = require('electron');
  const { once } = require('node:events');
  const args = process.argv.slice(1);
  const profileFlag = args.indexOf('--profile');
  const profile = profileFlag >= 0 ? args[profileFlag + 1] : '';
  if (!profile) {
    console.error('Electron child did not receive its isolated profile.');
    app.exit(2);
  }

  app.commandLine.appendSwitch('user-data-dir', profile);
  app.commandLine.appendSwitch('autoplay-policy', 'document-user-activation-required');
  app.setPath('userData', profile);
  let mediaStartedEvents = 0;
  app.on('web-contents-created', (_event, contents) => {
    try { contents.setAudioMuted(true); } catch {}
    contents.on('media-started-playing', () => { mediaStartedEvents++; });
  });

  let diagnosticStep = 'setup';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const timeoutError = label => new Error(`Timed out waiting for ${label}`);
  async function until(check, label, timeout = 12000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const value = await check();
        if (value) return value;
      } catch {}
      await sleep(interval);
    }
    throw timeoutError(label);
  }
  const raf = win => Promise.race([
    win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', true),
    sleep(500).then(() => undefined),
  ]);
  const safeFileName = value => String(value).replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const evidence = {
    mode: MODE,
    startedAt: new Date().toISOString(),
    app: { platform: process.platform, electron: process.versions.electron, chrome: process.versions.chrome },
    isolation: {
      freshUserDataDir: true,
      dataFileSettingsRootIndependent: true,
      appUpdatesDisabled: true,
      audioMuted: true,
      autoplayRequiresUserGesture: true,
      mediaPlaybackActions: 0,
      downloadActions: 0,
    },
    renderer: {},
    display: {},
    themeChecks: [],
    pages: [],
    responsiveMatrix: [],
    extendedMatrix: [],
    collapsedNavigation: [],
    paletteChecks: [],
    optionalScreens: [],
    assertions: [],
    errors: [],
  };

  function screenshotName(name) { return path.join(OUTPUT_DIR, `${name}.png`); }
  async function capture(win, name) {
    const image = await win.webContents.capturePage();
    const file = screenshotName(name);
    fs.writeFileSync(file, image.toPNG());
    return SETTINGS_ONLY ? path.relative(ROOT, file).replaceAll('\\', '/') : file;
  }
  async function execute(win, code) {
    let timer;
    let result;
    try {
      result = await Promise.race([
        win.webContents.executeJavaScript(`(async () => {
          try { return { value: await (${code}) }; }
          catch (error) { return { error: error.stack || error.message }; }
        })()`, true),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${diagnosticStep}: renderer evaluation exceeded 6 seconds`)), 6000); }),
      ]);
    } finally { clearTimeout(timer); }
    if (result.error) throw new Error(`${diagnosticStep}: ${result.error}`);
    return result.value;
  }
  async function setWindowSize(win, width, height, workArea) {
    const bounds = win.getBounds();
    const w = Math.max(900, Math.min(width, workArea.width));
    const h = Math.max(620, Math.min(height, workArea.height));
    const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - w));
    const y = Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - h));
    win.setBounds({ x, y, width: w, height: h });
    await sleep(110);
    await raf(win);
    return win.getBounds();
  }

  // Page IDs select fixed renderer programs; never interpolate them into JavaScript or selectors.
  const pageActions = new Map([
    ['browse', {
      sidebar: `document.querySelectorAll('.sidebar-menu .sidebar-item')[0]?.click()`,
      compact: `document.querySelectorAll('.compact-navigation button')[0].click()`,
      toolbar: `document.querySelectorAll('#toolbar-page-menu button')[0].click()`,
      visible: `(() => { const page = document.querySelector('main.main-content[data-page="browse"]'); return page && !page.hidden; })()`,
    }],
    ['feed', {
      sidebar: `document.querySelectorAll('.sidebar-menu .sidebar-item')[1]?.click()`,
      compact: `document.querySelectorAll('.compact-navigation button')[1].click()`,
      toolbar: `document.querySelectorAll('#toolbar-page-menu button')[1].click()`,
      visible: `(() => { const page = document.querySelector('main.main-content[data-page="feed"]'); return page && !page.hidden; })()`,
    }],
    ['download', {
      sidebar: `document.querySelectorAll('.sidebar-menu .sidebar-item')[2]?.click()`,
      compact: `document.querySelectorAll('.compact-navigation button')[2].click()`,
      toolbar: `document.querySelectorAll('#toolbar-page-menu button')[2].click()`,
      visible: `(() => { const page = document.querySelector('main.main-content[data-page="download"]'); return page && !page.hidden; })()`,
    }],
    ['player', {
      sidebar: `document.querySelectorAll('.sidebar-menu .sidebar-item')[3]?.click()`,
      compact: `document.querySelectorAll('.compact-navigation button')[3].click()`,
      toolbar: `document.querySelectorAll('#toolbar-page-menu button')[3].click()`,
      visible: `(() => { const page = document.querySelector('main.main-content[data-page="player"]'); return page && !page.hidden; })()`,
    }],
    ['history', {
      sidebar: `document.querySelectorAll('.sidebar-menu .sidebar-item')[4]?.click()`,
      compact: `document.querySelectorAll('.compact-navigation button')[4].click()`,
      toolbar: `document.querySelectorAll('#toolbar-page-menu button')[4].click()`,
      visible: `(() => { const page = document.querySelector('main.main-content[data-page="history"]'); return page && !page.hidden; })()`,
    }],
    ['calendar', {
      sidebar: `document.querySelectorAll('.sidebar-menu .sidebar-item')[5]?.click()`,
      compact: `document.querySelectorAll('.compact-navigation button')[5].click()`,
      toolbar: `document.querySelectorAll('#toolbar-page-menu button')[5].click()`,
      visible: `(() => { const page = document.querySelector('main.main-content[data-page="calendar"]'); return page && !page.hidden; })()`,
    }],
    ['manager', {
      sidebar: `document.querySelectorAll('.sidebar-menu .sidebar-item')[6]?.click()`,
      compact: `document.querySelectorAll('.compact-navigation button')[6].click()`,
      toolbar: `document.querySelectorAll('#toolbar-page-menu button')[6].click()`,
      visible: `(() => { const page = document.querySelector('main.main-content[data-page="manager"]'); return page && !page.hidden; })()`,
    }],
    ['account', {
      sidebar: `document.querySelectorAll('.sidebar-menu .sidebar-item')[7]?.click()`,
      compact: `document.querySelectorAll('.compact-navigation button')[7].click()`,
      toolbar: `document.querySelectorAll('#toolbar-page-menu button')[7].click()`,
      visible: `(() => { const page = document.querySelector('main.main-content[data-page="account"]'); return page && !page.hidden; })()`,
    }],
    ['announcements', {
      sidebar: `document.querySelectorAll('.sidebar-menu .sidebar-item')[8]?.click()`,
      compact: `document.querySelectorAll('.compact-navigation button')[8].click()`,
      toolbar: `document.querySelectorAll('#toolbar-page-menu button')[8].click()`,
      visible: `(() => { const page = document.querySelector('main.main-content[data-page="announcements"]'); return page && !page.hidden; })()`,
    }],
    ['settings', {
      sidebar: `document.querySelector('.sidebar-footer .sidebar-item')?.click()`,
      compact: `document.querySelectorAll('.compact-navigation button')[9].click()`,
      toolbar: `document.querySelectorAll('#toolbar-page-menu button')[9].click()`,
      visible: `(() => { const page = document.querySelector('main.main-content[data-page="settings"]'); return page && !page.hidden; })()`,
    }],
  ]);
  const pageIds = [...pageActions.keys()];
  const defaultSize = { width: 1100, height: 750 };
  const themes = ['light', 'dark'];

  async function navigate(win, id) {
    const actions = pageActions.get(id);
    if (!actions) throw new Error(`Unknown page ${id}`);
    const portrait = await execute(win, `!!document.querySelector('.app-layout.layout-portrait')`);
    if (portrait) {
      const picker = await execute(win, `!!document.querySelector('.layout-portrait.player-focused .toolbar-page-trigger')`);
      if (picker) await execute(win, `document.querySelector('.toolbar-page-trigger').click()`);
      await execute(win, picker ? actions.toolbar : actions.compact);
    } else {
      await execute(win, actions.sidebar);
    }
    await until(() => execute(win, actions.visible), `navigation to ${id}`, 8000);
    await sleep(id === 'browse' || id === 'feed' ? 350 : 180);
    await raf(win);
  }

  async function setAppearance(win, preference) {
    await navigate(win, 'settings');
    await until(() => execute(win, `!!document.querySelector('#appearance-theme')`), 'Settings theme selector');
    await execute(win, `(() => {
      const select = document.querySelector('#appearance-theme');
      select.value = ${JSON.stringify(preference)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value;
    })()`);
    if (preference !== 'system') {
      await until(() => execute(win, `document.documentElement.dataset.theme === ${JSON.stringify(preference)}`),
        `theme preference ${preference}`, 2500).catch(() => {});
    }
    await raf(win);
    await sleep(120);
  }

  async function waitForTheme(win, expected) {
    return until(() => execute(win,
      `document.documentElement.dataset.theme === ${JSON.stringify(expected)}`), `rendered ${expected} theme`, 6000);
  }

  async function pageMetrics(win, theme, page, viewportLabel) {
    const result = await execute(win, `(() => {
      const root = document.documentElement;
      const active = document.querySelector('.main-content:not([hidden])');
      const shell = document.querySelector('.app-shell');
      const layout = document.querySelector('.app-layout');
      const wrapper = document.querySelector('.main-wrapper');
      const visible = element => {
        if (!element || !element.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const rgb = value => {
        const match = String(value).match(/rgba?\\(\\s*([\\d.]+)[, ]+([\\d.]+)[, ]+([\\d.]+)(?:\\s*[,/]\\s*([\\d.]+))?/i);
        if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
        const hex = String(value).trim().match(/^#([0-9a-f]{3,8})$/i);
        if (!hex) return null;
        const raw = hex[1];
        if (raw.length === 3 || raw.length === 4) return raw.slice(0, 3).split('').map(char => parseInt(char + char, 16));
        return [0, 2, 4].map(offset => parseInt(raw.slice(offset, offset + 2), 16));
      };
      const luminance = color => {
        const values = rgb(color);
        if (!values) return null;
        const linear = values.map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
        return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
      };
      const contrast = (a, b) => {
        const la = luminance(a), lb = luminance(b);
        if (la === null || lb === null) return null;
        return Number(((Math.max(la, lb) + .05) / (Math.min(la, lb) + .05)).toFixed(2));
      };
      const styles = getComputedStyle(root);
      const tertiary = styles.getPropertyValue('--text-tertiary').trim();
      const canvas = styles.getPropertyValue('--bg').trim();
      const primaryBg = styles.getPropertyValue('--action-bg').trim();
      const primaryFg = styles.getPropertyValue('--action-text').trim();
      const sample = active && [...active.querySelectorAll('.settings-hint, .page-description')].find(visible);
      const primary = active && [...active.querySelectorAll('.btn-primary, .btn-chip-primary')].find(visible);
      const names = [...document.querySelectorAll('.sidebar-menu .sidebar-item, .sidebar-footer .sidebar-item')].map(button => {
        const span = button.querySelector('span');
        const spanVisible = visible(span);
        const label = span?.textContent?.trim() || '';
        const visual = button.innerText.trim();
        const accessibleName = button.getAttribute('aria-label') || button.getAttribute('title') || (spanVisible ? label : '') || visual;
        return { label, visualText: visual, accessibleName: accessibleName.trim(), hasAccessibleName: !!accessibleName.trim() };
      });
      const horizontal = element => !!element && element.scrollWidth > element.clientWidth + 1;
      const pageText = active?.innerText?.trim() || '';
      const primaryStyle = primary ? getComputedStyle(primary) : null;
      const bounds = element => element ? { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight } : null;
      return {
        theme: root.dataset.theme || '', preference: localStorage.getItem('hongguo-experience-preview:theme') || '',
        page: active?.dataset.page || '', viewport: { width: innerWidth, height: innerHeight, devicePixelRatio, visualScale: visualViewport?.scale ?? 1 },
        tertiary: { token: tertiary, canvasToken: canvas, tokenContrastVsCanvas: contrast(tertiary, canvas), sample: sample?.innerText?.trim()?.slice(0, 180) || '', sampleColor: sample ? getComputedStyle(sample).color : '' },
        primaryButton: { exists: !!primary, text: primary?.innerText?.trim()?.slice(0, 80) || '', backgroundToken: primaryBg, foregroundToken: primaryFg, tokenContrast: contrast(primaryBg, primaryFg), backgroundColor: primaryStyle?.backgroundColor || '', backgroundImage: primaryStyle?.backgroundImage || '', color: primaryStyle?.color || '' },
        settingsControls: ${JSON.stringify(page)} === 'settings' ? {
          themeSelect: !!document.querySelector('#appearance-theme'),
          proxyButton: !![...document.querySelectorAll('button')].find(button => button.innerText.includes('配置代理')),
          proxyModeItems: [...document.querySelectorAll('.proxy-mode-item')].map(item => ({ text: item.innerText.trim().slice(0, 60), active: item.classList.contains('active'), background: getComputedStyle(item).backgroundColor, border: getComputedStyle(item).borderColor, color: getComputedStyle(item).color })),
          hints: [...document.querySelectorAll('.settings-hint')].filter(visible).slice(0, 8).map(item => ({ text: item.innerText.trim().slice(0, 100), color: getComputedStyle(item).color })),
        } : null,
        nav: names,
        content: { characters: pageText.length, textPreview: pageText.slice(0, 220), headingCount: active?.querySelectorAll('h1,h2,h3').length || 0, empty: !pageText },
        overflow: { document: horizontal(root), body: horizontal(document.body), shell: horizontal(shell), layout: horizontal(layout), mainWrapper: horizontal(wrapper), activePage: horizontal(active), sizes: { document: bounds(root), body: bounds(document.body), shell: bounds(shell), activePage: bounds(active) } },
        activeMedia: { count: active?.querySelectorAll('audio,video').length || 0, playing: active ? [...active.querySelectorAll('audio,video')].filter(media => !media.paused && !media.ended).length : 0 },
      };
    })()`);
    return { theme, page, viewportLabel, ...result };
  }

  async function runPaletteCheck(win, theme) {
    await navigate(win, 'browse');
    const outcome = { theme, opened: false, tabStayedInside: false, escapeClosed: false, focusRestored: false, screenshot: '' };
    await execute(win, `document.querySelector('.toolbar-search')?.focus()`);
    const beforeFocus = await execute(win, `document.activeElement?.className || document.activeElement?.tagName || ''`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['control'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: ['control'] });
    outcome.opened = !!(await until(() => execute(win, `!!document.querySelector('.command-palette[role="dialog"]')`), 'command palette open', 2500).catch(() => false));
    if (outcome.opened) {
      await raf(win);
      outcome.initialFocus = await execute(win, `document.activeElement?.className || document.activeElement?.tagName || ''`);
      outcome.screenshot = await capture(win, `${theme}-command-palette`);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'TAB' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'TAB' });
      await raf(win);
      outcome.tabFocus = await execute(win, `document.activeElement?.className || document.activeElement?.tagName || ''`);
      outcome.tabStayedInside = await execute(win, `!!document.querySelector('.command-palette')?.contains(document.activeElement)`);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' });
      outcome.escapeClosed = await until(() => execute(win, `!document.querySelector('.command-palette[role="dialog"]')`), 'command palette close with Escape', 2500).catch(() => false);
      await raf(win);
      outcome.restoredFocus = await execute(win, `document.activeElement?.className || document.activeElement?.tagName || ''`);
      outcome.focusRestored = await execute(win, `document.activeElement?.classList?.contains('toolbar-search') === true`);
    }
    outcome.triggerFocusBeforeOpen = beforeFocus;
    evidence.paletteChecks.push(outcome);
    if (MODE === 'after') {
      assert(outcome.opened, `${theme}: Ctrl+K opens the real command palette`);
      assert(outcome.tabStayedInside, `${theme}: Tab remains inside the palette`);
      assert(outcome.escapeClosed, `${theme}: Escape closes the palette`);
      assert(outcome.focusRestored, `${theme}: closing restores focus to the search trigger`);
    }
    return outcome;
  }

  function pressActivationKey(win, keyCode) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    // Chromium's native button handles Return on the character event, and Space on keyup.
    if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  }

  async function browseFavoriteKeyboardCheck(win, theme) {
    const result = { kind: 'browse-favorite-keyboard', theme, accessible: false, screenshot: '' };
    const available = await until(() => execute(win, `!!document.querySelector('.browse-card .card-fav-btn')`), 'real catalog favorite button', 8000).catch(() => false);
    if (!available) {
      result.note = 'No genuine catalog card loaded; keyboard favorite was not tested.';
      evidence.optionalScreens.push(result);
      return;
    }
    await execute(win, `document.querySelector('.browse-card .card-fav-btn').focus()`);
    await sleep(220);
    result.focusedOverlayOpacity = await execute(win, `getComputedStyle(document.querySelector('.browse-card .browse-hover')).opacity`);
    result.initialPressed = await execute(win, `document.querySelector('.browse-card .card-fav-btn').getAttribute('aria-pressed')`);
    result.keys = [];
    for (const keyCode of ['Space', 'Enter']) {
      const keyResult = { keyCode, toggled: false, restored: false, detailStayedClosed: false };
      for (const restoring of [false, true]) {
        pressActivationKey(win, keyCode);
        const expected = restoring ? result.initialPressed : String(result.initialPressed !== 'true');
        const changed = await until(() => execute(win, `document.querySelector('.browse-card .card-fav-btn')?.getAttribute('aria-pressed') === ${JSON.stringify(expected)}`), `favorite ${keyCode} ${restoring ? 'restore' : 'toggle'}`, 2000).catch(() => false);
        if (restoring) keyResult.restored = !!changed; else keyResult.toggled = !!changed;
        keyResult.detailStayedClosed = await execute(win, `!document.querySelector('.browse-drawer[role="dialog"]')`);
        if (!keyResult.detailStayedClosed) break;
      }
      result.keys.push(keyResult);
      if (!keyResult.detailStayedClosed) break;
    }
    result.accessible = Number(result.focusedOverlayOpacity) > .95 && result.keys.length === 2 && result.keys.every(item => item.toggled && item.restored && item.detailStayedClosed);
    result.screenshot = await capture(win, `${theme}-browse-keyboard-favorite`);
    evidence.optionalScreens.push(result);
    if (MODE === 'after') assert(result.accessible, `${theme}: keyboard favorites remain visible and never open the parent detail`);
  }

  async function toolbarMoreKeyboardCheck(win, theme) {
    const result = { kind: 'toolbar-more-keyboard', theme, accessible: false, screenshot: '' };
    const initial = await execute(win, `document.querySelector('.player-actions-toggle')?.getAttribute('aria-pressed')`);
    result.focusRestored = [];
    for (const restoring of [false, true]) {
      await execute(win, `(() => { const trigger = document.querySelector('.toolbar-more-trigger'); trigger.focus(); trigger.click(); })()`);
      await until(() => execute(win, `document.querySelector('.toolbar-more-trigger').getAttribute('aria-expanded') === 'true'`), 'toolbar action disclosure open', 2000);
      const focused = await execute(win, `(() => { const button = document.querySelector('.toolbar-more-menu .player-actions-toggle'); button.focus(); return document.activeElement === button; })()`);
      assert(focused, `${theme}: toolbar child receives focus before activation`);
      if (!restoring) { await raf(win); result.screenshot = await capture(win, `${theme}-toolbar-more-keyboard`); }
      pressActivationKey(win, 'Enter');
      await until(() => execute(win, `document.querySelector('.toolbar-more-trigger').getAttribute('aria-expanded') === 'false'`), 'toolbar action disclosure close', 2000);
      await raf(win);
      result.focusRestored.push(await execute(win, `document.activeElement === document.querySelector('.toolbar-more-trigger')`));
      const pressed = await execute(win, `document.querySelector('.player-actions-toggle').getAttribute('aria-pressed')`);
      if (restoring) result.preferenceRestored = pressed === initial;
      else result.actionToggled = pressed !== initial;
    }
    result.accessible = result.actionToggled && result.preferenceRestored && result.focusRestored.every(Boolean);
    evidence.optionalScreens.push(result);
    if (MODE === 'after') assert(result.accessible, `${theme}: toolbar child action closes and restores focus without changing its final preference`);
  }

  async function optionalBrowseDetail(win, theme) {
    const result = { theme, attempted: false, accessible: false, screenshot: '', note: '' };
    const cardCount = await execute(win, `document.querySelectorAll('.browse-card').length`);
    result.cardCount = cardCount;
    if (!cardCount) {
      result.note = 'No real catalog card had loaded; detail was not opened.';
      evidence.optionalScreens.push({ kind: 'browse-detail', ...result });
      return;
    }
    result.attempted = true;
    await execute(win, `document.querySelector('.browse-card')?.click()`);
    const opened = await until(() => execute(win, `!!document.querySelector('.browse-drawer[role="dialog"]')`), 'Browse detail drawer', 7000).catch(() => false);
    result.accessible = opened;
    if (opened) {
      result.episodesLoaded = !!(await until(() => execute(win, `document.querySelectorAll('.browse-eps button').length > 0`), 'real detail episode list', 8000).catch(() => false));
      await Promise.race([execute(win, `Promise.allSettled([...document.querySelectorAll('.browse-drawer img')].map(image => image.decode()))`), sleep(1500)]);
      await raf(win);
      result.screenshot = await capture(win, `${theme}-browse-detail`);
      result.text = await execute(win, `document.querySelector('.browse-drawer')?.innerText?.trim()?.slice(0, 240) || ''`);
      result.cover = await execute(win, `(() => { const image = document.querySelector('.browse-drawer-cover'); if (!image) return null; const style = getComputedStyle(image); const rect = image.getBoundingClientRect(); return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, width: rect.width, height: rect.height, objectFit: style.objectFit, styleHeight: style.height }; })()`);
      const matched = await execute(win, `!!document.querySelector('.browse-drawer [aria-label="关闭"]')`);
      if (matched) await execute(win, `document.querySelector('.browse-drawer [aria-label="关闭"]')?.click()`);
      else { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' }); }
      await until(() => execute(win, `!document.querySelector('.browse-drawer[role="dialog"]')`), 'Browse detail close', 2500);
    } else {
      result.note = 'A real catalog card was clicked, but the real detail response did not open a drawer before timeout.';
      await execute(win, `document.querySelector('.browse-drawer-mask')?.click()`);
    }
    evidence.optionalScreens.push({ kind: 'browse-detail', ...result });
  }

  async function optionalProxyModal(win, theme) {
    const result = { theme, opened: false, tabStayedInside: false, escapeClosed: false, focusRestored: false, screenshot: '' };
    await navigate(win, 'settings');
    const button = await execute(win, `!![...document.querySelectorAll('button')].find(item => item.innerText.includes('配置代理'))`);
    if (!button) {
      result.note = 'Settings proxy configuration button was not visible.';
      evidence.optionalScreens.push({ kind: 'settings-proxy', ...result });
      return;
    }
    await execute(win, `(() => { const trigger = [...document.querySelectorAll('button')].find(item => item.innerText.includes('配置代理')); trigger?.focus(); trigger?.click(); })()`);
    result.opened = await until(() => execute(win, `!!document.querySelector('.proxy-modal[role="dialog"]')`), 'proxy settings modal', 2500).catch(() => false);
    if (result.opened) {
      await raf(win);
      result.initialFocusInside = await execute(win, `document.querySelector('.proxy-modal')?.contains(document.activeElement) === true`);
      result.screenshot = await capture(win, `${theme}-settings-proxy`);
      result.text = await execute(win, `document.querySelector('.proxy-modal')?.innerText?.trim()?.slice(0, 240) || ''`);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'TAB' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'TAB' });
      await raf(win);
      result.tabStayedInside = await execute(win, `document.querySelector('.proxy-modal')?.contains(document.activeElement) === true`);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' });
      result.escapeClosed = await until(() => execute(win, `!document.querySelector('.proxy-modal[role="dialog"]')`), 'proxy modal close with Escape', 2000).catch(() => false);
      await raf(win);
      result.focusRestored = await execute(win, `document.activeElement === [...document.querySelectorAll('button')].find(item => item.innerText.includes('配置代理'))`);
      if (!result.escapeClosed) {
        await execute(win, `(() => { const close = document.querySelector('.proxy-modal [aria-label="关闭"]') || document.querySelector('.proxy-modal button[title="关闭"]'); close?.click(); })()`);
        await until(() => execute(win, `!document.querySelector('.proxy-modal[role="dialog"]')`), 'proxy modal fallback close', 2000).catch(() => {});
      }
    }
    if (MODE === 'after') assert(result.opened, `${theme}: settings proxy modal opens`);
    if (MODE === 'after' && result.opened) {
      assert(result.initialFocusInside, `${theme}: proxy modal receives initial focus`);
      assert(result.tabStayedInside, `${theme}: proxy modal contains Tab focus`);
      assert(result.escapeClosed, `${theme}: Escape closes the proxy modal`);
      assert(result.focusRestored, `${theme}: closing the proxy modal restores its settings trigger`);
    }
    evidence.optionalScreens.push({ kind: 'settings-proxy', ...result });
  }

  async function checkSettingsSearch(win) {
    for (const theme of themes) {
      await setAppearance(win, theme);
      await waitForTheme(win, theme);
      await execute(win, `(() => {
        const input = document.querySelector('.settings-search input');
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '代理');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await until(() => execute(win, `document.querySelectorAll('[id^="settings-anchor-"]:not([hidden])').length === 1`), 'proxy-only settings');
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await until(() => execute(win, `document.activeElement?.id === 'settings-anchor-proxy'`), 'Enter focuses the matching card');
      await raf(win);
      const screenshot = await capture(win, `${theme}-proxy-filter`);
      await optionalProxyModal(win, theme);
      await execute(win, `document.querySelector('.settings-search input').focus()`);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await until(() => execute(win, `document.querySelector('.settings-search input').value === '' && document.querySelectorAll('[id^="settings-anchor-"]:not([hidden])').length === document.querySelectorAll('.settings-quicknav-item').length`), 'Escape restores all settings');
      await execute(win, `(() => {
        const input = document.querySelector('.settings-search input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'no-matching-setting');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await until(() => execute(win, `!!document.querySelector('.settings-search-empty') && document.querySelectorAll('[id^="settings-anchor-"]:not([hidden])').length === 0`), 'settings empty result');
      const emptyScreenshot = await capture(win, `${theme}-empty-filter`);
      await execute(win, `document.querySelector('.settings-search-empty button').click()`);
      await until(() => execute(win, `document.querySelector('.settings-search input').value === '' && document.activeElement === document.querySelector('.settings-search input')`), 'clear restores search focus');
      evidence.assertions.push({ theme, proxyFilter: true, enterFocus: true, escapeClear: true, emptyResult: true, clearFocus: true, screenshot, emptyScreenshot });

      await execute(win, `(() => {
        const input = document.querySelector('.settings-search input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '播放诊断');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await until(() => execute(win, `document.querySelectorAll('[id^="settings-anchor-"]:not([hidden])').length === 1 && !document.querySelector('#settings-anchor-playback-diagnostics').hidden`), 'playback diagnostic settings filter');
      await until(() => execute(win, `[...document.querySelectorAll('.playback-diagnostics-row')].some(row => row.innerText.includes('软件版本') && !row.innerText.includes('尚未读取'))`), 'real playback diagnostic snapshot');
      await execute(win, `document.querySelector('.playback-diagnostics-actions button').click()`);
      await until(() => execute(win, `document.querySelector('.playback-diagnostics [role="status"]')?.textContent.includes('当前未登录红果账号')`), 'anonymous account diagnostic check');
      for (const width of [900, 1280]) {
        await setWindowSize(win, width, 750, evidence.display.workArea);
        await execute(win, `document.querySelector('#settings-anchor-playback-diagnostics').scrollIntoView({block:'start'})`);
        await raf(win);
        const layout = await execute(win, `(() => {
          const panel = document.querySelector('.playback-diagnostics');
          const nodes = [...panel.querySelectorAll('dt,dd,button')];
          return { rows: panel.querySelectorAll('.playback-diagnostics-row').length,
            buttons: panel.querySelectorAll('button').length,
            overflow: nodes.filter(node => node.scrollWidth > node.clientWidth + 1).length,
            panelOverflow: panel.scrollWidth > panel.clientWidth + 1,
            error: panel.querySelector('[role="alert"]')?.textContent || '',
            snapshot: panel.innerText };
        })()`);
        assert.equal(layout.rows, 14, `${theme}: all playback diagnostic fields are visible`);
        assert.equal(layout.buttons, 3);
        assert.equal(layout.overflow, 0, `${theme}/${width}: diagnostic field text fits`);
        assert.equal(layout.panelOverflow, false, `${theme}/${width}: diagnostic panel fits`);
        assert.equal(layout.error, '', `${theme}/${width}: real diagnostic read and account check succeed`);
        assert.doesNotMatch(layout.snapshot, /sessionid=|Cookie:|https?:\/\/|device_id=/i);
        evidence.assertions.push({ kind: 'playback-diagnostics', theme, width, ...layout,
          screenshot: await capture(win, `${theme}-playback-diagnostics-${width}`) });
      }
      await execute(win, `(() => {
        const input = document.querySelector('.settings-search input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    }
    assert.equal(mediaStartedEvents, 0);
    assert(win.webContents.isAudioMuted());
    assert.equal(evidence.errors.length, 0);
    evidence.isolation.mediaStartedEvents = mediaStartedEvents;
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUTPUT_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log('PASS real settings search: both themes, card visibility, Enter focus, Escape clear, empty state, proxy dialog keyboard, playback diagnostic snapshot and anonymous account check at 900/1280 widths; no playback or downloads');
  }

  // Keep labels and panel selectors inside literal programs, not nested string substitutions.
  const playerMenuActions = [
    {
      name: 'episodes',
      exists: `!!document.querySelector('.player-controls button[aria-label="选集"]')`,
      open: `(() => { const button = document.querySelector('.player-controls button[aria-label="选集"]'); button.scrollIntoView({block:'center'}); button.focus(); button.click(); })()`,
      visible: `!!document.querySelector('.player-episode-popover')`,
      colors: `(() => { const panel = document.querySelector('.player-episode-popover'); const style = getComputedStyle(panel); return { color: style.color, background: style.backgroundColor, bounds: { width: panel.offsetWidth, height: panel.offsetHeight } }; })()`,
      closed: `!document.querySelector('.player-episode-popover')`,
    },
    {
      name: 'quality',
      exists: `!!document.querySelector('.player-controls button[aria-label="清晰度"]')`,
      open: `(() => { const button = document.querySelector('.player-controls button[aria-label="清晰度"]'); button.scrollIntoView({block:'center'}); button.focus(); button.click(); })()`,
      visible: `!!document.querySelector('.player-quality-popover')`,
      colors: `(() => { const panel = document.querySelector('.player-quality-popover'); const style = getComputedStyle(panel); return { color: style.color, background: style.backgroundColor, bounds: { width: panel.offsetWidth, height: panel.offsetHeight } }; })()`,
      closed: `!document.querySelector('.player-quality-popover')`,
    },
    {
      name: 'options',
      exists: `!!document.querySelector('.player-controls button[aria-label="更多播放选项"]')`,
      open: `(() => { const button = document.querySelector('.player-controls button[aria-label="更多播放选项"]'); button.scrollIntoView({block:'center'}); button.focus(); button.click(); })()`,
      visible: `!!document.querySelector('.player-controls-menu')`,
      colors: `(() => { const panel = document.querySelector('.player-controls-menu'); const style = getComputedStyle(panel); return { color: style.color, background: style.backgroundColor, bounds: { width: panel.offsetWidth, height: panel.offsetHeight } }; })()`,
      closed: `!document.querySelector('.player-controls-menu')`,
    },
    {
      name: 'danmaku',
      exists: `!!document.querySelector('.player-controls button[aria-label="弹幕设置"]')`,
      open: `(() => { const button = document.querySelector('.player-controls button[aria-label="弹幕设置"]'); button.scrollIntoView({block:'center'}); button.focus(); button.click(); })()`,
      visible: `!!document.querySelector('.danmaku-settings')`,
      colors: `(() => { const panel = document.querySelector('.danmaku-settings'); const style = getComputedStyle(panel); return { color: style.color, background: style.backgroundColor, bounds: { width: panel.offsetWidth, height: panel.offsetHeight } }; })()`,
      closed: `!document.querySelector('.danmaku-settings')`,
    },
  ];

  async function optionalPlayerMenus(win, theme) {
    for (const menu of playerMenuActions) {
      const { name } = menu;
      const result = { kind: 'player-menu', theme, name, opened: false, screenshot: '' };
      const exists = await execute(win, menu.exists);
      if (exists) {
        await execute(win, menu.open);
        result.opened = await until(() => execute(win, menu.visible), `player ${name} panel`, 2000).catch(() => false);
        if (result.opened) {
          await raf(win);
          result.screenshot = await capture(win, `${theme}-player-${name}`);
          result.colors = await execute(win, menu.colors);
          win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' });
          await until(() => execute(win, menu.closed), `player ${name} panel close`, 2000);
        }
      } else result.note = 'No real selected archive/control was available; not tested.';
      evidence.optionalScreens.push(result);
    }
    await execute(win, `document.querySelector('.main-content:not([hidden])').scrollTop = 0`);
  }

  async function collapsedNavigationCheck(win, theme) {
    const result = { theme, collapsed: false, names: [], screenshot: '' };
    const buttonExists = await execute(win, `!!document.querySelector('.sidebar-collapse-btn')`);
    if (!buttonExists) return result;
    await execute(win, `document.querySelector('.sidebar-collapse-btn')?.click()`);
    result.collapsed = await until(() => execute(win, `document.querySelector('.sidebar')?.classList.contains('collapsed')`), 'sidebar collapse', 1500).catch(() => false);
    if (result.collapsed) {
      await raf(win);
      result.names = await execute(win, `([...document.querySelectorAll('.sidebar-menu .sidebar-item, .sidebar-footer .sidebar-item')]).map(button => {
        const span = button.querySelector('span');
        const visible = span && getComputedStyle(span).display !== 'none' && getComputedStyle(span).visibility !== 'hidden';
        const label = span?.textContent?.trim() || '';
        const accessibleName = (button.getAttribute('aria-label') || button.getAttribute('title') || (visible ? label : '') || button.innerText || '').trim();
        return { label, accessibleName, hasAccessibleName: !!accessibleName };
      })`);
      result.screenshot = await capture(win, `${theme}-sidebar-collapsed`);
      evidence.collapsedNavigation.push(result);
      if (MODE === 'after') {
        assert.equal(result.names.length, 10, `${theme}: all ten collapsed primary navigation entries are present`);
        assert(result.names.every(item => item.hasAccessibleName), `${theme}: every collapsed navigation entry has an accessible name`);
      }
      await execute(win, `document.querySelector('.sidebar-collapse-btn')?.click()`);
      await until(() => execute(win, `!document.querySelector('.sidebar')?.classList.contains('collapsed')`), 'sidebar expansion', 1500).catch(() => {});
    } else evidence.collapsedNavigation.push(result);
    return result;
  }

  async function checkExtendedMatrix(win, theme, area) {
    async function record(page, label, screenshot = false) {
      const metrics = await pageMetrics(win, theme, page, label);
      const clippedControls = await execute(win, `(() => {
        const main = document.querySelector('.main-content:not([hidden])');
        return [...main.querySelectorAll('button,input,select,textarea')].filter(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return !element.closest('[hidden],[aria-hidden="true"],details:not([open])') && rect.width && rect.height
            && style.visibility !== 'hidden' && rect.top < innerHeight && rect.bottom > 90
            && (rect.left < -1 || rect.right > innerWidth + 1);
        }).map(element => ({ name: element.getAttribute('aria-label') || element.innerText || element.id || element.tagName,
          left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right) }));
      })()`);
      const overflowElements = await execute(win, `(() => {
        const main = document.querySelector('.main-content:not([hidden])');
        return [...main.querySelectorAll('*')].filter(element => !element.closest('details:not([open])') && element.getClientRects().length && element.clientWidth > 0
          && element.scrollWidth > element.clientWidth + 1).slice(0, 18).map(element => ({ tag: element.tagName,
          className: element.className, width: element.clientWidth, scroll: element.scrollWidth,
          text: element.innerText?.trim().slice(0, 100) || '' }));
      })()`);
      const result = { theme, page, label, zoom: win.webContents.getZoomFactor(), bounds: win.getBounds(),
        cssViewport: metrics.viewport, overflow: metrics.overflow, clippedControls, overflowElements,
        screenshot: screenshot ? await capture(win, `${theme}-${page}-${label}`) : '' };
      evidence.extendedMatrix.push(result);
      fs.writeFileSync(path.join(OUTPUT_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2));
    }
    for (const zoom of [1.25, 1.5, 2]) {
      await setWindowSize(win, 900, 620, area);
      for (const page of ['download', 'manager', 'player', 'settings']) {
        await navigate(win, page);
        win.webContents.setZoomFactor(zoom);
        await sleep(120); await raf(win);
        await record(page, `zoom-${Math.round(zoom * 100)}`, page === 'settings');
        if (page === 'manager') {
          await execute(win, `document.querySelector('.dm-more-actions summary').click()`);
          await raf(win);
          await record(page, `zoom-${Math.round(zoom * 100)}-menu`, true);
          await execute(win, `document.querySelector('.dm-more-actions summary').click()`);
        }
        win.webContents.setZoomFactor(1);
      }
    }
    win.maximize();
    await until(() => win.isMaximized(), 'native maximized window');
    await sleep(150);
    for (const page of ['browse', 'player', 'settings']) {
      await navigate(win, page);
      await record(page, 'maximized', true);
    }
    win.unmaximize();
    await sleep(150);
    await execute(win, `document.querySelector('.layout-toggle').click()`);
    await until(() => execute(win, `!!document.querySelector('.app-layout.layout-portrait')`), 'React portrait layout');
    win.setBounds({ width: 420, height: 740 });
    await sleep(200); await raf(win);
    for (const page of pageIds) {
      await navigate(win, page);
      await record(page, 'portrait-420', true);
      if (page === 'player') await toolbarMoreKeyboardCheck(win, theme);
      if (page === 'manager') {
        await execute(win, `document.querySelector('.dm-more-actions summary').click()`);
        await raf(win);
        await record(page, 'portrait-420-menu', true);
        await execute(win, `document.querySelector('.dm-more-actions summary').click()`);
      }
    }
    await execute(win, `document.querySelector('.layout-toggle').click()`);
    await until(() => execute(win, `!!document.querySelector('.app-layout.layout-landscape')`), 'React landscape layout');
    await setWindowSize(win, defaultSize.width, defaultSize.height, area);
    console.log(`UI audit: zoom and portrait matrix captured for ${theme}`);
  }

  try { require(path.join(ROOT, 'main.js')); }
  catch (error) {
    console.error(`FAIL loading the real main process: ${error.stack || error.message}`);
    app.exit(1);
  }
  app.whenReady().then(async () => {
    try {
      diagnosticStep = 'window';
      const win = await until(() => {
        const windows = BrowserWindow.getAllWindows().filter(item => !item.isDestroyed());
        return windows.find(item => item.webContents && !item.webContents.isDestroyed());
      }, 'real application BrowserWindow', 60000);
      try { win.webContents.setAudioMuted(true); } catch {}
      win.webContents.setBackgroundThrottling(false);
      console.log(`UI audit: real window created (${MODE})`);
      win.webContents.on('console-message', (_event, details) => {
        if (details && typeof details === 'object' && details.level === 'error') {
          evidence.errors.push({ step: diagnosticStep, message: String(details.message).replace(/https?:\/\/\S+/g, '[URL omitted]').slice(0, 500) });
        }
      });
      win.webContents.setAudioMuted(true);
      const loaded = await until(() => execute(win,
        `document.readyState === 'complete' && !!document.querySelector('#root') && !!document.querySelector('.app-shell')`),
      'real dist-react UI render', 45000);
      if (!loaded) throw timeoutError('real dist-react UI render');
      await until(() => execute(win, `!document.querySelector('[data-splash-host]')`), 'startup splash to finish', 12000);
      await raf(win);
      await sleep(350);
      evidence.renderer = await execute(win, `({ url: location.href, title: document.title, appShell: !!document.querySelector('.app-shell'), muted: true })`);
      evidence.renderer.isDistReactFile = String(evidence.renderer.url).includes('/dist-react/index.html');
      if (SETTINGS_ONLY) evidence.renderer.url = 'file:///[isolated-build]/dist-react/index.html';
      evidence.display = (() => {
        const display = screen.getPrimaryDisplay();
        return { bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor, colorDepth: display.colorDepth };
      })();
      const data = JSON.parse(fs.readFileSync(path.join(profile, 'data.json'), 'utf8'));
      evidence.isolation.dataFileRootWithinTempProfile = path.resolve(data.settings.root).startsWith(path.resolve(profile));
      evidence.isolation.dataFileSettings = {
        independentDownloadRoot: evidence.isolation.dataFileRootWithinTempProfile,
        appUpdatesEnabled: data.settings.app_updates_enabled,
        watchUpdatesEnabled: data.settings.watch_updates_enabled,
      };
      evidence.isolation.webContentsAudioMuted = win.webContents.isAudioMuted();
      const loadListenerErrors = [];
      win.webContents.on('render-process-gone', (_event, details) => loadListenerErrors.push(details?.reason || 'render-process-gone'));
      win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        if (isMainFrame) loadListenerErrors.push({ code, description, url });
      });

      if (SETTINGS_ONLY) {
        diagnosticStep = 'settings-search';
        await checkSettingsSearch(win);
        win.destroy();
        app.exit(0);
        return;
      }
      if (DEFAULT_THEME_ONLY) {
        diagnosticStep = 'default-theme';
        const initialTheme = await execute(win, `document.documentElement.dataset.theme`);
        const storedPreference = await execute(win, `localStorage.getItem('hongguo-experience-preview:theme')`);
        assert.equal(storedPreference, null, 'The isolated profile must not contain a saved theme preference.');
        assert.equal(initialTheme, 'light', 'A fresh profile must launch with the light theme.');
        assert.equal(mediaStartedEvents, 0, 'No media may start playing during the default theme check.');
        assert(win.webContents.isAudioMuted(), 'The real application WebContents must remain muted.');
        console.log('PASS fresh-profile default theme: light; no saved preference; no media playback');
        win.destroy();
        app.exit(0);
        return;
      }
      const display = evidence.display;
      const area = display.workArea;
      const widths = [...new Set([900, Math.min(1100, area.width), Math.min(1440, area.width)])].filter(value => value >= 900);
      const heights = [...new Set([620, Math.min(750, area.height), Math.min(920, area.height)])].filter(value => value >= 620);
      const viewports = [
        { label: 'minimum-900x620', width: widths[0] || 900, height: heights[0] || 620 },
        { label: 'default-1100x750', width: Math.min(1100, area.width), height: Math.min(750, area.height) },
        { label: 'large-workarea', width: widths[widths.length - 1] || 1100, height: heights[heights.length - 1] || 750 },
        { label: 'full-hd-1920x1080', width: Math.min(1920, area.width), height: Math.min(1080, area.height) },
      ].filter((item, index, list) => list.findIndex(other => other.width === item.width && other.height === item.height) === index);
      await setWindowSize(win, Math.min(defaultSize.width, area.width), Math.min(defaultSize.height, area.height), area);

      // Process-level nativeTheme simulation is checked via the real Settings select and Chromium matchMedia.
      diagnosticStep = 'native-theme-system';
      console.log('UI audit: following system appearance');
      await setAppearance(win, 'system');
      const nativeThemeChecks = [];
      for (const systemTheme of ['light', 'dark']) {
        nativeTheme.themeSource = systemTheme;
        const expected = systemTheme;
        const matched = await until(() => execute(win, `matchMedia('(prefers-color-scheme: dark)').matches === ${JSON.stringify(systemTheme === 'dark')}`),
          `nativeTheme ${systemTheme} matchMedia`, 6000).catch(() => false);
        const themeApplied = await until(() => execute(win, `document.documentElement.dataset.theme === ${JSON.stringify(expected)}`),
          `system preference applies ${systemTheme}`, 6000).catch(() => false);
        nativeThemeChecks.push({ themeSource: systemTheme, shouldUseDarkColors: nativeTheme.shouldUseDarkColors, matchMediaChanged: !!matched, themeApplied: !!themeApplied });
      }
      evidence.themeChecks.push({ kind: 'nativeTheme-system-simulation', preferenceSetThroughSettings: 'system', checks: nativeThemeChecks });
      if (MODE === 'after') {
        assert(nativeThemeChecks.every(item => item.matchMediaChanged && item.themeApplied), 'System appearance must follow real Electron nativeTheme changes.');
      }

      for (const theme of themes) {
        diagnosticStep = `theme ${theme}`;
        await setAppearance(win, theme);
        await waitForTheme(win, theme);
        evidence.themeChecks.push({ kind: 'explicit-settings-select', requested: theme,
          rendered: await execute(win, `document.documentElement.dataset.theme`),
          preference: await execute(win, `localStorage.getItem('hongguo-experience-preview:theme')`),
          nativeThemeSource: nativeTheme.themeSource });

        for (const page of pageIds) {
          diagnosticStep = `page ${theme}/${page}`;
          await setWindowSize(win, Math.min(defaultSize.width, area.width), Math.min(defaultSize.height, area.height), area);
          await navigate(win, page);
          if (page === 'browse' || page === 'feed') await sleep(500);
          await raf(win);
          const screenshot = await capture(win, `${theme}-${safeFileName(page)}`);
          const metrics = await pageMetrics(win, theme, page, 'default');
          const pageEvidence = { theme, page, screenshot, default: metrics, viewports: [] };
          for (const viewport of viewports) {
            const bounds = await setWindowSize(win, viewport.width, viewport.height, area);
            const scaled = await pageMetrics(win, theme, page, viewport.label);
            const matrixItem = { theme, page, label: viewport.label, bounds, cssViewport: scaled.viewport, overflow: scaled.overflow };
            pageEvidence.viewports.push(matrixItem);
            evidence.responsiveMatrix.push(matrixItem);
          }
          evidence.pages.push(pageEvidence);
          fs.writeFileSync(path.join(OUTPUT_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2));
          console.log(`UI audit: captured ${theme}/${page}`);
          await setWindowSize(win, Math.min(defaultSize.width, area.width), Math.min(defaultSize.height, area.height), area);
          if (MODE === 'after') {
            assert.equal(metrics.page, page, `${theme}/${page}: active application page is present`);
            assert(!metrics.content.empty, `${theme}/${page}: page content is not blank`);
            for (const sample of pageEvidence.viewports) {
              assert(!sample.overflow.document && !sample.overflow.body && !sample.overflow.shell && !sample.overflow.layout && !sample.overflow.mainWrapper,
                `${theme}/${page}/${sample.label}: no viewport-level horizontal overflow`);
            }
          }

          if (page === 'browse') {
            await optionalBrowseDetail(win, theme);
            if (MODE === 'after') await browseFavoriteKeyboardCheck(win, theme);
          }
          if (page === 'player' && MODE === 'after') await optionalPlayerMenus(win, theme);
          if (page === 'settings') await optionalProxyModal(win, theme);
        }

        await runPaletteCheck(win, theme);
        await navigate(win, 'browse');
        await collapsedNavigationCheck(win, theme);
        if (MODE === 'after') await checkExtendedMatrix(win, theme, area);
      }

      evidence.isolation.mediaStartedEvents = mediaStartedEvents;
      evidence.isolation.playingMediaAtEnd = await execute(win,
        `[...document.querySelectorAll('audio,video')].filter(media => !media.paused && !media.ended).length`);
      evidence.errors.push(...loadListenerErrors);
      evidence.screenshots = evidence.pages.map(page => page.screenshot).concat(
        evidence.optionalScreens.map(item => item.screenshot).filter(Boolean),
        evidence.paletteChecks.map(item => item.screenshot).filter(Boolean),
        evidence.collapsedNavigation.map(item => item.screenshot).filter(Boolean),
        evidence.extendedMatrix.map(item => item.screenshot).filter(Boolean));
      evidence.summary = {
        pagesCaptured: evidence.pages.length,
        expectedPageCaptures: themes.length * pageIds.length,
        pageCaptureCoverageComplete: evidence.pages.length === themes.length * pageIds.length,
        screenshots: evidence.screenshots.length,
        optional: evidence.optionalScreens.map(item => ({ kind: item.kind, theme: item.theme, accessible: item.accessible ?? item.opened, note: item.note || '' })),
        horizontalOverflowFindings: evidence.responsiveMatrix.filter(item => ['document', 'body', 'shell', 'layout', 'mainWrapper', 'activePage'].some(key => item.overflow[key])).map(item => ({ theme: item.theme, page: item.page, viewport: item.label, overflow: item.overflow })),
        extendedMatrixCases: evidence.extendedMatrix.length,
        extendedLayoutFindings: evidence.extendedMatrix.filter(item => item.overflow.activePage || item.clippedControls.length > 0).map(item => ({ theme: item.theme, page: item.page, label: item.label, overflow: item.overflow.activePage, clippedControls: item.clippedControls })),
        nonemptyPageCaptures: evidence.pages.filter(item => !item.default.content.empty).length,
        mediaStartedEvents,
        audioMuted: evidence.isolation.webContentsAudioMuted,
      };
      if (MODE === 'after') {
        assert.equal(evidence.pages.length, 20, 'Capture all ten real application pages in both explicit themes.');
        assert.equal(evidence.extendedMatrix.length, 58, 'Exercise all zoom, maximized and portrait cases in both themes.');
        assert.equal(evidence.summary.extendedLayoutFindings.length, 0, 'No confirmed clipped controls or page overflow in the extended matrix.');
        assert.equal(evidence.errors.length, 0, 'The real renderer must not report console errors.');
        assert.equal(evidence.collapsedNavigation.length, 2, 'Audit collapsed navigation in both themes.');
        assert.equal(mediaStartedEvents, 0, 'No media may start playing during the audit.');
        assert.equal(evidence.isolation.playingMediaAtEnd, 0, 'No media may be playing at audit completion.');
        assert(evidence.isolation.webContentsAudioMuted, 'The real application WebContents must remain muted.');
        assert(evidence.renderer.isDistReactFile, 'The audit must render the existing dist-react build.');
        assert(evidence.isolation.dataFileRootWithinTempProfile && data.settings.app_updates_enabled === false,
          'The isolated profile must use its own download root and have app updates disabled.');
      }
      evidence.finishedAt = new Date().toISOString();
      fs.writeFileSync(path.join(OUTPUT_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2));
      console.log(`UI_AUDIT_EVIDENCE=${path.join(OUTPUT_DIR, 'evidence.json')}`);
      console.log(`${MODE.toUpperCase()} UI audit: ${evidence.summary.pagesCaptured}/${evidence.summary.expectedPageCaptures} page screenshots; ${evidence.summary.screenshots} total screenshots; ${evidence.summary.horizontalOverflowFindings.length} viewport overflow observations; media-started=${mediaStartedEvents}; muted=${evidence.isolation.webContentsAudioMuted}`);
      win.destroy();
      app.exit(0);
    } catch (error) {
      evidence.finishedAt = new Date().toISOString();
      evidence.failure = { step: diagnosticStep, message: error.message, stack: error.stack };
      try { fs.writeFileSync(path.join(OUTPUT_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2)); } catch {}
      console.error(`FAIL ${MODE} UI audit: ${error.stack || error.message}`);
      app.exit(1);
    }
  });
}
