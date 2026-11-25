import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { groupHistory } from '../historyGroups.mjs';

const compiled = new Map(['CommandPalette', 'WatchHistory'].map(name => [name,
  transformSync(fs.readFileSync(new URL(`../${name}.jsx`, import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' }).code,
]));
const tick = () => new Promise(resolve => setImmediate(resolve));
const key = (key, extra = {}) => ({ key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra });

function mount(name, props, api = {}) {
  let cursor = 0, queued = false, tree;
  const slots = [], effects = [], dialogCalls = [];
  const useEffect = (effect, deps) => {
    const at = cursor++, old = slots[at];
    if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
      slots[at] = { deps }; effects.push(() => { old?.cleanup?.(); slots[at].cleanup = effect(); });
    }
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const at = cursor++;
      if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
      return [slots[at], value => {
        const next = typeof value === 'function' ? value(slots[at]) : value;
        if (!Object.is(next, slots[at])) { slots[at] = next; queued = true; }
      }];
    },
    useRef(initial) { const at = cursor++; return slots[at] ||= { current: initial }; },
    useId() { const at = cursor++; return slots[at] ||= `test-id-${at}`; },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect, useLayoutEffect: useEffect,
  };
  const module = { exports: {} };
  const page = { tagName: 'MAIN' };
  const storage = { getItem: () => null, setItem() {} };
  const require = id => {
    if (id === 'react') return react;
    if (id === './icons') return new Proxy({}, { get: () => () => null });
    if (id === './useDialogKeyboard') return (...args) => dialogCalls.push(args);
    if (id === '../searchHistory') return { readSearchHistory: () => [] };
    if (id === '../localLibrary') return { readLocalLibrary: () => ({ items: [] }) };
    if (id === './historyGroups.mjs') return { groupHistory };
    if (id.endsWith('.css')) return {};
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(compiled.get(name), { module, exports: module.exports, require, localStorage: storage,
    document: { querySelector: selector => selector === 'main[data-page="history"]' ? page : null },
    window: { localStorage: storage, electronAPI: { getWatchHistory: async () => ({ success: true, results: [] }), ...api } },
  });
  const render = (nextProps = {}) => {
    props = { ...props, ...nextProps };
    let count = 0;
    do {
      queued = false; cursor = 0; tree = module.exports.default(props);
      effects.splice(0).forEach(effect => effect());
      assert.ok(++count < 25, 'component render converges');
    } while (queued);
  };
  const all = predicate => {
    const matches = [];
    const visit = node => { if (!node || typeof node !== 'object') return; if (predicate(node)) matches.push(node); node.children?.forEach(visit); };
    visit(tree); return matches;
  };
  render();
  return { render, all, page, find: predicate => all(predicate)[0], dialog: () => dialogCalls.at(-1) };
}
const role = (ui, value) => ui.find(node => node.props.role === value);

test('player and download confirmation dialogs start on Cancel instead of an operation', () => {
  for (const name of ['Player', 'DownloadManager']) {
    const source = fs.readFileSync(new URL(`../${name}.jsx`, import.meta.url), 'utf8');
    const footers = [...source.matchAll(/<div className="player-confirm-foot">([\s\S]*?)<\/div>/g)];
    assert.equal(footers.length, 2, `${name}: merge and confirmation dialogs retain their action groups`);
    for (const [, footer] of footers) {
      const initialActions = [...footer.matchAll(/<button\b[\s\S]*?<\/button>/g)]
        .map(([button]) => button).filter(button => button.includes('data-dialog-initial-focus'));
      assert.equal(initialActions.length, 1, `${name}: each confirmation has exactly one initial focus target`);
      assert.match(initialActions[0], />\s*取消\s*<\/button>$/, `${name}: initial focus targets Cancel instead of an operation`);
    }
  }
});

test('palette uses a single combobox tab stop with a live active descendant and hook-managed dialog', () => {
  const calls = [];
  const ui = mount('CommandPalette', { open: true, onClose: () => calls.push('close'), onNavigate: id => calls.push(id), onSearch: term => calls.push(term) });
  const input = role(ui, 'combobox'), listbox = role(ui, 'listbox');
  const options = ui.all(node => node.props.role === 'option');
  assert.equal(ui.dialog()[0], true); assert.equal(ui.dialog()[2], '.command-palette');
  assert.equal(role(ui, 'dialog').props.onKeyDown, undefined, 'Enter must not be intercepted from a result button');
  assert.equal(role(ui, 'dialog').props.tabIndex, -1);
  assert.equal(input.props['aria-controls'], listbox.props.id);
  assert.equal(input.props['aria-expanded'], true);
  assert.equal(input.props['aria-autocomplete'], 'list');
  assert.equal(input.props['aria-activedescendant'], options[0].props.id);
  assert.ok(ui.find(node => node.props.id === input.props['aria-describedby']));
  assert.ok(options.every(node => node.props.tabIndex === -1 && node.props.type === 'button'));
  const down = key('ArrowDown'); input.props.onKeyDown(down); ui.render();
  assert.equal(down.defaultPrevented, true); assert.equal(down.stopped, true);
  assert.equal(role(ui, 'combobox').props['aria-activedescendant'], options[1].props.id);
  assert.equal(ui.all(node => node.props['aria-selected'] === true).length, 1);
  const enter = key('Enter'); role(ui, 'combobox').props.onKeyDown(enter);
  assert.deepEqual(calls, ['feed', 'close']); assert.equal(enter.defaultPrevented, true);
});

test('palette ignores composing Enter/arrows and legacy IME keyCode 229', () => {
  const calls = [];
  const ui = mount('CommandPalette', { open: true, onClose: () => calls.push('close'), onNavigate: id => calls.push(id), onSearch: term => calls.push(term) });
  const initial = role(ui, 'combobox').props['aria-activedescendant'];
  for (const extra of [{ isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { nativeEvent: { keyCode: 229 } }]) {
    for (const name of ['Enter', 'ArrowDown', 'ArrowUp']) {
      const event = key(name, extra); role(ui, 'combobox').props.onKeyDown(event); ui.render();
      assert.equal(event.defaultPrevented, false);
      assert.equal(role(ui, 'combobox').props['aria-activedescendant'], initial);
    }
  }
  assert.deepEqual(calls, []);
});

test('palette searches arbitrary terms and result clicks run only their own item without taking input focus', () => {
  const calls = [];
  const ui = mount('CommandPalette', { open: true, onClose: () => calls.push('close'), onNavigate: id => calls.push(id), onSearch: term => calls.push(term) });
  const option = ui.all(node => node.props.role === 'option')[3];
  const mousedown = key(''); option.props.onMouseDown(mousedown); assert.equal(mousedown.defaultPrevented, true);
  option.props.onClick(); assert.deepEqual(calls, ['player', 'close']); calls.length = 0;
  role(ui, 'combobox').props.onChange({ target: { value: '输入法完成的词条' } }); ui.render();
  const options = ui.all(node => node.props.role === 'option');
  assert.equal(options.length, 1);
  assert.equal(role(ui, 'combobox').props['aria-activedescendant'], options[0].props.id);
  role(ui, 'combobox').props.onKeyDown(key('Enter'));
  assert.deepEqual(calls, ['输入法完成的词条', 'close']);
  ui.render({ open: false }); assert.equal(ui.dialog()[0], false); assert.equal(role(ui, 'dialog'), undefined);
});

test('failed history removal retains its selected record and requests a stable return focus', async () => {
  const ui = mount('WatchHistory', { active: true }, {
    getWatchHistory: async () => ({ success: true, results: [{ series_id: 'series-1', series_title: 'Fixture', total: 2, vid_index: 1 }] }),
    removeWatchHistoryBatch: async () => ({ success: false, error: '保存失败' }),
  });
  await tick(); ui.render();
  ui.find(node => node.props.className === 'history-select').props.onChange(); ui.render();
  ui.find(node => node.type === 'button' && node.children.some(child => typeof child === 'string' && child.startsWith('移除选中'))).props.onClick(); ui.render();
  const dialog = role(ui, 'dialog');
  await dialog.children.find(node => node.props?.className === 'history-confirm-foot').children[1].props.onClick();
  ui.render();
  assert.ok(ui.find(node => node.props.className === 'history-select').props.checked, 'failure retains the selected row');
  assert.ok(role(ui, 'alert'));
  assert.equal(ui.dialog()[4](), ui.page);
});

test('watch-history confirmation uses the shared hook, cancel-first focus order and linked description without changing removal behavior', async () => {
  const removed = [];
  const ui = mount('WatchHistory', { active: true }, {
    getWatchHistory: async () => ({ success: true, results: [{ series_id: 'series-1', series_title: 'Fixture', total: 2, vid_index: 1 }] }),
    removeWatchHistoryBatch: async ids => { removed.push([...ids]); return { success: true, count: ids.length }; },
  });
  await tick(); ui.render();
  ui.find(node => node.props.className === 'history-select').props.onChange(); ui.render();
  ui.find(node => node.type === 'button' && node.children.some(child => typeof child === 'string' && child.startsWith('移除选中'))).props.onClick(); ui.render();
  assert.equal(ui.dialog()[0], true); assert.equal(ui.dialog()[2], '.history-confirm');
  let dialog = role(ui, 'dialog');
  assert.equal(dialog.props.tabIndex, -1);
  assert.ok(ui.find(node => node.props.id === dialog.props['aria-labelledby']));
  assert.ok(ui.find(node => node.props.id === dialog.props['aria-describedby']));
  const buttons = dialog.children.find(node => node.props?.className === 'history-confirm-foot').children;
  assert.equal(buttons[0].children[0], '取消'); assert.equal(buttons[1].children[0], '确认移除');
  ui.render({ active: false }); assert.equal(ui.dialog()[0], false, 'hidden pages cannot own the focus trap');
  ui.render({ active: true }); assert.equal(ui.dialog()[0], true);
  ui.dialog()[1](); ui.render(); assert.equal(role(ui, 'dialog'), undefined); assert.deepEqual(removed, []);
  ui.find(node => node.type === 'button' && node.children.some(child => typeof child === 'string' && child.startsWith('移除选中'))).props.onClick(); ui.render();
  dialog = role(ui, 'dialog');
  await dialog.children.find(node => node.props?.className === 'history-confirm-foot').children[1].props.onClick();
  ui.render(); assert.deepEqual(removed, [['series-1']]); assert.equal(ui.dialog()[0], false);
  assert.equal(ui.dialog()[4](), ui.page, 'confirmed removal returns to the stable page rather than its disabled trigger');
  assert.equal(ui.dialog()[4](), null, 'the alternate target is consumed so later cancellation returns to its trigger');
});
