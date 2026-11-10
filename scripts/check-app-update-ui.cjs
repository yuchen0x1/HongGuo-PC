// Isolated renderer checks: no network, installed app, user data or actual timers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const release = { version: '9.0', url: 'https://github.com/yuchen0x1/HongGuo-PC/releases/tag/v9.0' };
function mount(api = {}, component = 'AppUpdateNotice', props = {}) {
  const slots = [], effects = [], cleanups = [], effectFns = [], events = new Map(), timers = new Map();
  let cursor = 0, tree, timerId = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef: initial => { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect: (fn, deps) => { const i = cursor++; if (!slots[i] || deps.some((d, j) => !Object.is(d, slots[i][j]))) { slots[i] = deps; effects.push(() => { cleanups[i]?.(); effectFns[i] = fn; cleanups[i] = fn(); }); } },
  };
  const defaults = { checkAppUpdate: async () => ({ enabled: true, release }), getSettings: async () => ({ app_updates_enabled: true }) };
  const window = { electronAPI: new Proxy({ ...defaults, ...api }, { get: (o, k) => o[k] || (k.startsWith('on') ? cb => { events.set(k, cb); return () => events.delete(k); } : async () => ({ success: true })) }),
    addEventListener: (name, cb) => events.set(name, cb), removeEventListener: name => events.delete(name), dispatchEvent: event => events.get(event.type)?.(event) };
  const module = { exports: {} };
  vm.runInNewContext(transformSync(fs.readFileSync(`${__dirname}/../src/components/${component}.jsx`, 'utf8'), { loader: 'jsx', format: 'cjs' }).code, {
    module, exports: module.exports, require: name => name === 'react' ? react : name === './useDialogKeyboard' ? () => {}
      : name === './danmakuSource.mjs' ? { useDanmakuSource: () => 'official', writeDanmakuSource() {} } : {}, window, console,
    CustomEvent: class { constructor(type) { this.type = type; } },
    setInterval: fn => { timers.set(++timerId, fn); return timerId; }, clearInterval: id => timers.delete(id), setTimeout: () => 1, clearTimeout() {},
  });
  const render = () => { cursor = 0; tree = module.exports.default(props); effects.splice(0).forEach(fn => fn()); };
  const nodes = () => { const out = []; const walk = n => { if (!n || typeof n !== 'object') return; out.push(n); n.children?.forEach(walk); }; walk(tree); return out; };
  const textOf = n => typeof n === 'string' || typeof n === 'number' ? String(n) : n?.children?.map(textOf).join('') || '';
  const find = fn => nodes().find(fn);
  render();
  return { render, find, nodes, text: () => textOf(tree), button: label => find(n => n.type === 'button' && (textOf(n).includes(label) || n.props['aria-label'] === label)),
    flush: async () => { for (let i = 0; i < 25; i++) { await Promise.resolve(); render(); } }, emit: (name, data) => events.get(name)?.(data),
    restartEffects: () => { cleanups.forEach(fn => fn?.()); effectFns.forEach((fn, i) => { cleanups[i] = fn(); }); }, timer: () => timers.forEach(fn => fn()), unmount: () => cleanups.forEach(fn => fn?.()), events };
}
(async () => {
  let passed = 0, failed = 0;
  const test = async (name, fn) => { try { await fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); } };
  await test('new version opens the official release page without install actions', async () => {
    let opens = 0;
    const ui = mount({ openAppUpdate: async () => { opens++; return { success: true }; } });
    await ui.flush();
    assert.ok(ui.button('打开下载页'));
    assert.ok(ui.text().includes('请先退出应用，再下载并运行唯一安装包'));
    assert.equal(ui.button('下载更新'), undefined);
    assert.equal(ui.button('取消下载'), undefined);
    await ui.button('打开下载页').props.onClick();
    assert.equal(opens, 1);
    ui.unmount(); assert.equal(ui.events.size, 0);
  });
  await test('manual check clearly reports latest version and checks every six hours', async () => {
    let checks = 0, result = { enabled: true, release: null };
    const ui = mount({ checkAppUpdate: async () => { checks++; return result; } }); await ui.flush();
    assert.equal(ui.text(), '');
    ui.emit('hongguo-check-app-update'); await ui.flush();
    assert.ok(ui.text().includes('已是最新版本'));
    assert.ok(checks >= 1);
    ui.timer(); await ui.flush(); assert.ok(checks >= 2);
    ui.unmount();
  });
  await test('network failure shows retry and later can recover with a release', async () => {
    let result = { enabled: true, release: null, error: '暂时无法检查更新，请检查网络后重试。' }, opens = 0;
    const ui = mount({ checkAppUpdate: async () => result, openAppUpdate: async () => { opens++; return { success: true }; } }); await ui.flush();
    assert.ok(ui.text().includes('请检查网络后重试'));
    assert.ok(ui.button('重新检查'));
    result = { enabled: true, release };
    await ui.button('重新检查').props.onClick(); await ui.flush();
    assert.ok(ui.button('打开下载页'));
    await ui.button('打开下载页').props.onClick(); assert.equal(opens, 1);
    ui.unmount();
  });
  await test('disabled checks hide the notice and re-enabled checks recover', async () => {
    let result = { enabled: false, release: null };
    const ui = mount({ checkAppUpdate: async () => result }); await ui.flush(); assert.equal(ui.text(), '');
    ui.emit('hongguo-check-app-update'); await ui.flush(); assert.ok(ui.text().includes('更新检测已关闭'));
    result = { enabled: true, release };
    ui.emit('onAppUpdatePreference', true); await ui.flush(); assert.ok(ui.button('打开下载页'));
    ui.emit('onAppUpdatePreference', false); await ui.flush(); assert.equal(ui.text(), ''); ui.unmount();
  });
  await test('closing a notice suppresses the same release until manual recheck', async () => {
    const ui = mount(); await ui.flush();
    assert.ok(ui.button('打开下载页'));
    ui.button('关闭更新提醒').props.onClick(); await ui.flush(); assert.equal(ui.text(), '');
    ui.emit('hongguo-check-app-update'); await ui.flush(); assert.ok(ui.button('打开下载页'));
    ui.unmount();
  });
  await test('update settings page keeps the opt-out and manual check controls', async () => {
    let events = 0;
    const saved = [];
    const ui = mount({ getSettings: async () => ({ root: '/downloads', app_updates_enabled: true }),
      saveSettings: async settings => { saved.push(settings); return { success: true }; } }, 'UpdateCheckSettings');
    await ui.flush();
    ui.events.set('hongguo-check-app-update', () => { events++; });
    ui.button('检查更新').props.onClick(); assert.equal(events, 1);
    assert.equal(ui.find(n => n.props['aria-label'] === '自动检测更新').props.checked, true);
    ui.find(n => n.props['aria-label'] === '自动检测更新').props.onChange({ target: { checked: false } }); await ui.flush();
    assert.equal(saved.length, 1); assert.equal(saved[0].app_updates_enabled, false);
    assert.equal(saved[0].root, '/downloads');
    assert.equal(ui.button('检查更新').props.disabled, true); ui.unmount();
  });
  console.log(`App update UI: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
