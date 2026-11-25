import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as display from '../playbackDiagnosticDisplay.mjs';

const require = createRequire(import.meta.url);
const { transformSync } = require('esbuild');
const source = transformSync(fs.readFileSync(new URL('../PlaybackDiagnostics.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' }).code;

function mount(api = {}, props = { active: true }) {
  const slots = [], effects = [], cleanups = [], timers = new Map();
  let cursor = 0, tree;
  const changed = (old, deps) => !old || deps.some((value, i) => !Object.is(value, old[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef: initial => { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect: (fn, deps) => { const i = cursor++; if (changed(slots[i], deps)) { slots[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports,
    require: name => name === 'react' ? react : name === './playbackDiagnosticDisplay.mjs' ? display : {},
    window: { electronAPI: { getPlaybackDiagnostics: async () => ({ appVersion: '6.33.0' }), ...api } },
    setInterval: fn => { const id = timers.size + 1; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id) });
  const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node?.children?.map(text).join('') || '';
  const nodes = () => { const all = []; const walk = node => { if (!node || typeof node !== 'object') return; all.push(node); node.children?.forEach(walk); }; walk(tree); return all; };
  const render = () => { cursor = 0; tree = module.exports.default(props); effects.splice(0).forEach(fn => fn()); };
  render();
  return { props, render, flush: async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); render(); } },
    text: () => text(tree), button: label => nodes().find(node => node.type === 'button' && text(node).includes(label)),
    unmount: () => cleanups.forEach(fn => fn?.()) };
}

test('diagnostic labels reject raw remote strings and distinguish media connectivity from decoding', () => {
  const secret = 'Cookie private=secret https://signed.invalid/?token=secret';
  assert.doesNotMatch(JSON.stringify(display.diagnosticRows(Object.fromEntries(['appVersion', 'accountState', 'sessionValidity', 'deviceState', 'profileVersion', 'sourceRoute', 'routeId', 'lastErrorCode', 'requestDurationMs', 'mediaStatus', 'decoderStatus'].map(key => [key, secret])))), /secret|signed\.invalid/);
  assert.deepEqual(display.diagnosticCheckRows({ source: 'passed', media: 'partial', decode: 'not-tested' }),
    [['取源', '通过'], ['媒体连接', '已读取部分媒体'], ['视频解码', '未执行解码']]);
  assert.equal(display.diagnosticFaultLabel('API_EMPTY_RESPONSE'), '播放接口空响应');
  const web = display.diagnosticRows({ sourceRoute: 'web', routeId: 'official-web-public-fallback', profileVersion: '2026-11-25.1' });
  assert.deepEqual(web.find(row => row[0] === '当前取源线路'), ['当前取源线路', '红果官网 · 官网公开播放']);
  assert.deepEqual(web.find(row => row[0] === '播放接口版本'), ['播放接口版本', '2026-11-25.1']);
});

test('connection diagnostic shows stage results without declaring successful decoding', async () => {
  const ui = mount({ testPlaybackConnection: async () => ({ success: true, checks: { source: 'passed', media: 'partial', decode: 'not-tested' } }) });
  try {
    await ui.flush();
    await ui.button('测试播放连接').props.onClick(); await ui.flush();
    assert.match(ui.text(), /连接检查已完成/);
    assert.match(ui.text(), /已读取部分媒体/);
    assert.match(ui.text(), /未执行解码/);
    assert.doesNotMatch(ui.text(), /播放正常|解码通过/);
  } finally { ui.unmount(); }
});

test('diagnostic controls single-flight operations and show classified failure without raw exception text', async () => {
  let finish, calls = 0;
  const ui = mount({ checkPlaybackAccount: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
    testPlaybackConnection: async () => { calls++; return { success: true }; } });
  try {
    await ui.flush();
    const first = ui.button('检查账号状态').props.onClick();
    const duplicate = ui.button('测试播放连接').props.onClick();
    await ui.flush();
    assert.equal(calls, 1);
    assert.equal(ui.button('正在检查账号').props.disabled, true);
    finish({ success: false, faultCode: 'ACCOUNT_EXPIRED', error: 'Cookie=private-token' });
    await first; await duplicate; await ui.flush();
    assert.match(ui.text(), /账号登录过期/);
    assert.doesNotMatch(ui.text(), /private-token/);
  } finally { ui.unmount(); }
});

test('account checks distinguish absent, valid and expired sessions and cancelled export stays quiet', async () => {
  for (const [sessionValidity, message] of [['none', '当前未登录红果账号'], ['valid', '账号会话有效'], ['expired', '账号会话已失效']]) {
    const ui = mount({ checkPlaybackAccount: async () => ({ success: true, diagnostics: { sessionValidity } }), exportPlaybackDiagnostics: async () => ({ success: true, cancelled: true }) });
    try {
      await ui.flush(); await ui.button('检查账号状态').props.onClick(); await ui.flush();
      assert.match(ui.text(), new RegExp(message));
      await ui.button('导出播放诊断报告').props.onClick(); await ui.flush();
      assert.doesNotMatch(ui.text(), /报告已导出/);
    } finally { ui.unmount(); }
  }
});
