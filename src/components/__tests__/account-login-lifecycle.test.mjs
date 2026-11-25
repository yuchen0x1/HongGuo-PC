import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('esbuild');
const source = transformSync(fs.readFileSync(new URL('../AccountManagement.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' }).code;

function mountAccount(api, props = {}) {
  const slots = [], effects = [], cleanups = [], timers = new Map();
  let cursor = 0, tree, timerId = 0, mounted = true;
  props = { loginOnly: true, autoLogin: true, ...props };
  const changed = (old, deps) => !old || deps.some((value, i) => !Object.is(value, old[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef: initial => { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect: (fn, deps) => { const i = cursor++; if (changed(slots[i], deps)) { slots[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => name === 'react' ? react : {},
    window: { electronAPI: api }, setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id) });
  const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node?.children?.map(text).join('') || '';
  const find = predicate => { let result; const walk = node => { if (!node || typeof node !== 'object') return;
    if (!result && predicate(node)) result = node; node.children?.forEach(walk); }; walk(tree); return result; };
  const render = () => { if (!mounted) return; cursor = 0; tree = module.exports.default(props); effects.splice(0).forEach(fn => fn()); };
  render();
  return { timers, render, find, text: () => text(tree),
    button: label => find(node => node.type === 'button' && text(node).includes(label)),
    flush: async () => { for (let i = 0; i < 15; i++) { await Promise.resolve(); render(); } },
    unmount: () => { if (mounted) { mounted = false; cleanups.forEach(fn => fn?.()); } } };
}

const qr = { success: true, loginId: 'isolated-login', image: 'data:image/png;base64,AA==', expiresIn: 60 };

test('closing the login modal while QR creation is pending cancels its late native login session', async () => {
  const cancelled = []; let finish, started = 0;
  const ui = mountAccount({ startAccountLogin: () => { started++; return new Promise(done => { finish = done; }); },
    cancelAccountLogin: async id => { cancelled.push(id); } });
  await ui.flush(); assert.equal(started, 1);
  ui.unmount(); finish(qr); await ui.flush();
  assert.deepEqual(cancelled, [qr.loginId]);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.find(node => node.type === 'img'), undefined);
});

test('unmounting a displayed QR cancels polling and clears the matching native login session', async () => {
  const cancelled = [];
  const ui = mountAccount({ startAccountLogin: async () => qr,
    cancelAccountLogin: async id => { cancelled.push(id); } });
  await ui.flush();
  assert(ui.find(node => node.type === 'img' && node.props.alt === '红果登录二维码'));
  assert.match(ui.text(), /仅存于本机/);
  assert.match(ui.text(), /系统加密/);
  assert.match(ui.text(), /卸载应用时自动清除/);
  assert.equal(ui.timers.size, 1);
  ui.unmount(); await ui.flush();
  assert.deepEqual(cancelled, [qr.loginId]);
  assert.equal(ui.timers.size, 0);
});

test('explicit QR cancellation discards a pending signed-in poll and never resumes playback', async () => {
  const cancelled = [], signedIn = []; let finishPoll;
  const ui = mountAccount({ startAccountLogin: async () => qr,
    pollAccountLogin: () => new Promise(done => { finishPoll = done; }),
    cancelAccountLogin: async id => { cancelled.push(id); } }, { onSignedIn: result => signedIn.push(result) });
  try {
    await ui.flush();
    const [id, timer] = ui.timers.entries().next().value;
    ui.timers.delete(id); timer.fn(); await ui.flush();
    await ui.button('取消扫码').props.onClick(); await ui.flush();
    finishPoll({ success: true, status: 'signed-in', signedIn: true, sessionValidity: 'valid' });
    await ui.flush();
    assert.deepEqual(cancelled, [qr.loginId]);
    assert.deepEqual(signedIn, []);
    assert.equal(ui.timers.size, 0);
    assert.equal(ui.find(node => node.type === 'img'), undefined);
  } finally { ui.unmount(); }
});

test('successful loginOnly polling invokes its existing completion callback once and stops polling', async () => {
  const signedIn = [], cancelled = [];
  const result = { success: true, status: 'signed-in', signedIn: true, sessionValidity: 'valid' };
  const ui = mountAccount({ startAccountLogin: async () => qr, pollAccountLogin: async () => result,
    cancelAccountLogin: async id => { cancelled.push(id); } }, { onSignedIn: value => signedIn.push(value) });
  await ui.flush();
  const [id, timer] = ui.timers.entries().next().value;
  ui.timers.delete(id); await timer.fn(); await ui.flush();
  assert.deepEqual(signedIn, [result]);
  assert.equal(ui.timers.size, 0);
  ui.unmount(); await ui.flush();
  assert.deepEqual(cancelled, []);
});
