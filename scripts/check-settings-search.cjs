// Settings filtering and commit boundaries, using the existing isolated renderer harness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const targets = new Map();
const fixtureDocument = { getElementById: id => targets.get(id) };
const harnessSource = fs.readFileSync(path.join(__dirname, 'check-app-update-ui.cjs'), 'utf8')
  .split('\n(async () => {')[0].replace('}, window, console,', '}, window, document: fixtureDocument, console,');
const harnessModule = { exports: {} };
vm.runInNewContext(`${harnessSource}\nmodule.exports = { mount };`, { module: harnessModule, require, __dirname, console, fixtureDocument });
const { mount } = harnessModule.exports;
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node?.children?.map(text).join('') || '';
const anchor = (ui, id) => ui.find(n => n.props.id === `settings-anchor-${id}`);
const visibleIds = ui => Array.from(ui.nodes()).filter(n => n.props.id?.startsWith('settings-anchor-') && !n.props.hidden).map(n => n.props.id.replace('settings-anchor-', ''));
const search = ui => ui.find(n => n.type === 'input' && n.props.type === 'search');
const setSearch = async (ui, value) => { search(ui).props.onChange({ target: { value } }); await ui.flush(); };
const rootInput = ui => ui.find(n => n.type === 'input' && n.props['aria-label'] === '下载目录');
const saveButton = ui => ui.find(n => n.type === 'button' && n.props.onClick && text(n) === '保存设置');

(async () => {
  const saves = [];
  let persisted = { root: '/original', name_format: '剧名 集数', proxy_enabled: false, locale: 'auto' };
  const ui = mount({ getSettings: async () => ({ ...persisted }), saveSettings: async patch => {
    saves.push(structuredClone(patch)); Object.assign(persisted, patch); return { success: true };
  } }, 'Settings');
  try {
    await ui.flush();
    assert.equal(visibleIds(ui).length, 14);
    rootInput(ui).props.onChange({ target: { value: '/unsaved' } }); await ui.flush();
    await setSearch(ui, '代理');
    assert.deepEqual(visibleIds(ui), ['proxy']);
    assert.equal(rootInput(ui).props.value, '/unsaved', 'hidden fields must retain unsaved edits');
    assert.ok(saveButton(ui), 'global save remains available even when its edited group is hidden');
    assert.equal(saves.length, 0, 'filtering must never write settings');
    assert.equal(anchor(ui, 'proxy').props.role, 'region');
    assert.equal(anchor(ui, 'proxy').props['aria-label'], '代理');
    for (const [query, id] of [['下载 目录', 'download'], ['语言', 'language'], [' ＥＮＧＬＩＳＨ ', 'language'], ['配置 诊断', 'storage'], ['播放诊断', 'playback-diagnostics'], ['会话', 'playback-diagnostics'], ['弹幕', 'danmaku'], ['优先使用红果 App 搜索', 'playback'], ['代理密码', 'proxy'], ['配置位置', 'storage']]) {
      await setSearch(ui, query); assert.deepEqual(visibleIds(ui), [id], query);
    }
    let focused = false, scrolled = false;
    targets.set('settings-anchor-storage', { hidden: false, focus: () => { focused = true; }, scrollIntoView: () => { scrolled = true; } });
    await setSearch(ui, '配置 诊断');
    ui.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await ui.flush();
    assert.ok(focused && scrolled, 'Enter focuses and reveals the first matching section');
    assert.equal(anchor(ui, 'storage').props.tabIndex, -1);
    await setSearch(ui, 'no-matching-setting');
    assert.equal(visibleIds(ui).length, 0);
    assert.match(ui.text(), /没有匹配的设置/);
    assert.ok(ui.button('显示全部设置'));
    let searchFocused = false;
    search(ui).props.ref.current = { focus() { searchFocused = true; } };
    search(ui).props.onKeyDown({ key: 'Escape', nativeEvent: { isComposing: true }, preventDefault() { assert.fail('IME Escape must not clear'); } });
    await ui.flush(); assert.equal(search(ui).props.value, 'no-matching-setting');
    search(ui).props.onKeyDown({ key: 'Escape', nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {} });
    await ui.flush(); assert.equal(visibleIds(ui).length, 14); assert.ok(searchFocused);
    assert.equal(rootInput(ui).props.value, '/unsaved');

    await ui.button('配置代理').props.onClick(); await ui.flush();
    await ui.button('保存并生效').props.onClick(); await ui.flush();
    assert.equal(saves.length, 1);
    assert.ok(Object.keys(saves[0]).every(key => key.startsWith('proxy_') || key === 'clear_proxy_password'));
    assert.equal(persisted.root, '/original', 'proxy confirmation must not commit unrelated drafts');
    assert.equal(rootInput(ui).props.value, '/unsaved');
    assert.match(ui.text(), /有未保存的修改/);
    await saveButton(ui).props.onClick(); await ui.flush();
    assert.deepEqual(saves[1], { root: '/unsaved' });
    assert.equal(persisted.root, '/unsaved');
  } finally { ui.unmount(); targets.clear(); }

  let reads = 0, writes = 0;
  const failedReadback = mount({ getSettings: async () => {
    if (++reads > 1) throw new Error('readback unavailable');
    return { root: '/before' };
  }, saveSettings: async () => { writes++; return { success: true }; } }, 'Settings');
  try {
    await failedReadback.flush();
    rootInput(failedReadback).props.onChange({ target: { value: '/committed' } }); await failedReadback.flush();
    await saveButton(failedReadback).props.onClick(); await failedReadback.flush();
    assert.equal(writes, 1);
    assert.equal(rootInput(failedReadback).props.value, '/committed');
    assert.match(failedReadback.text(), /设置已保存，但刷新显示失败/);
    assert.doesNotMatch(failedReadback.text(), /有未保存的修改|设置保存失败/);
  } finally { failedReadback.unmount(); }

  let rejectWrite = true;
  const failedWrite = mount({ getSettings: async () => ({ root: '/before' }), saveSettings: async () => ({ success: !rejectWrite, error: 'disk full' }) }, 'Settings');
  try {
    await failedWrite.flush(); rootInput(failedWrite).props.onChange({ target: { value: '/draft' } }); await failedWrite.flush();
    await saveButton(failedWrite).props.onClick(); await failedWrite.flush();
    assert.match(failedWrite.text(), /disk full/); assert.match(failedWrite.text(), /有未保存的修改/);
    assert.equal(rootInput(failedWrite).props.value, '/draft');
  } finally { failedWrite.unmount(); }

  let finishRead, readCount = 0, storedRoot = '/old';
  const props = { active: true };
  const stale = mount({ getSettings: () => ++readCount === 2
    ? new Promise(resolve => { finishRead = () => resolve({ root: '/old' }); })
    : Promise.resolve({ root: storedRoot }),
  saveSettings: async patch => { storedRoot = patch.root; return { success: true }; } }, 'Settings', props);
  try {
    await stale.flush(); props.active = false; stale.render(); props.active = true; stale.render();
    rootInput(stale).props.onChange({ target: { value: '/new' } }); await stale.flush();
    await saveButton(stale).props.onClick(); await stale.flush(); finishRead(); await stale.flush();
    assert.equal(rootInput(stale).props.value, '/new', 'pre-commit reads must not overwrite committed state');
  } finally { stale.unmount(); }
  let proxyReads = 0, submittedProxy, proxyReadRecovered = false;
  const proxyProps = { active: true };
  const proxyReadFailure = mount({ getSettings: async () => {
    if (++proxyReads > 1 && !proxyReadRecovered) throw new Error('readback unavailable');
    return { proxy_enabled: true, proxy_mode: 'custom', proxy_host: proxyReadRecovered ? 'new.example.test' : 'old.example.test', proxy_port: 7890 };
  }, saveSettings: async patch => { submittedProxy = patch; return { success: true }; } }, 'Settings', proxyProps);
  try {
    await proxyReadFailure.flush();
    await proxyReadFailure.button('配置代理').props.onClick(); await proxyReadFailure.flush();
    proxyReadFailure.find(n => n.props['aria-label'] === '代理服务器地址').props.onChange({ target: { value: 'http://fixture:dummy@new.example.test' } });
    await proxyReadFailure.flush();
    await proxyReadFailure.button('保存并生效').props.onClick(); await proxyReadFailure.flush();
    assert.match(submittedProxy.proxy_host, /new\.example\.test/);
    assert.doesNotMatch(proxyReadFailure.text(), /dummy|new\.example\.test/);
    assert.match(proxyReadFailure.text(), /old\.example\.test/);
    assert.match(proxyReadFailure.text(), /设置已保存，但刷新显示失败/);
    await proxyReadFailure.button('配置代理').props.onClick(); await proxyReadFailure.flush();
    assert.doesNotMatch(proxyReadFailure.text(), /保存并生效/);
    assert.match(proxyReadFailure.text(), /避免覆盖已生效的配置/);
    proxyReadRecovered = true;
    proxyProps.active = false; proxyReadFailure.render(); proxyProps.active = true; proxyReadFailure.render();
    const staleOpenHandler = proxyReadFailure.button('配置代理').props.onClick;
    await Promise.resolve(); // Fresh response is acknowledged, but its React state has not rendered yet.
    await staleOpenHandler(); await proxyReadFailure.flush();
    assert.equal(proxyReadFailure.find(n => n.props['aria-label'] === '代理服务器地址').props.value, 'new.example.test');
    assert.equal(proxyReadFailure.find(n => n.props['aria-label'] === '代理密码').props.value, '');
  } finally { proxyReadFailure.unmount(); }

  let finishReload, reloadReads = 0;
  const reloadProps = { active: true };
  const reload = mount({ getSettings: () => {
    switch (++reloadReads) {
      case 1: return Promise.reject(new Error('initial read unavailable'));
      case 2: return new Promise(resolve => { finishReload = resolve; });
      default: return Promise.resolve({ root: '/current' });
    }
  } }, 'Settings', reloadProps);
  try {
    await reload.flush();
    const reloadRequest = reload.button('重新加载').props.onClick();
    reloadProps.active = false; reload.render(); reloadProps.active = true; reload.render();
    await reload.flush();
    rootInput(reload).props.onChange({ target: { value: '/draft' } }); await reload.flush();
    finishReload({ root: '/stale' }); await reloadRequest; await reload.flush();
    assert.equal(rootInput(reload).props.value, '/draft');
  } finally { reload.unmount(); }
  console.log('PASS settings search: named groups, normalized terms, no-result/IME/Escape/Enter, draft retention; proxy-only commits, credential-safe failed readback, failed writes and stale reads');
})().catch(error => { console.error(error); process.exitCode = 1; });
