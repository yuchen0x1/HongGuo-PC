// Player 通知与确认框的纯代码回归：内存媒体/API，无窗口、无网络、无文件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mount } = require('../../../scripts/check-player-resume.cjs');

const toastNode = (ui, kind) => ui.find(node => node.props.className === `dm-toast dm-toast-${kind}`);
const anyToast = ui => ui.find(node => typeof node.props.className === 'string' && node.props.className.startsWith('dm-toast'));
const storage = { success: true, series: [{ series_id: 'A', files: 1, bytes: 1024 }], totalFiles: 1, totalBytes: 1024 };

test('successful notices are polite status messages and failures use an alert in the error style', async () => {
  const ok = mount({ local: true, apiOverrides: { downloadSingleEpisode: async () => ({ success: true, count: 1 }) } });
  try {
    await ok.flush();
    await ok.button('下载本集').props.onClick();
    await ok.flush();
    const node = toastNode(ok, 'success');
    assert.ok(node, '成功提示仍然渲染');
    assert.equal(node.props.role, 'status');
    assert.equal(node.props['aria-live'], 'polite');
    assert.equal(node.props['aria-atomic'], 'true');
    assert.equal(node.children.join(''), '第 1 集已加入下载队列');
    assert.equal(toastNode(ok, 'error'), undefined, '普通提示不得使用错误样式');
  } finally { ok.unmount(); }

  const bad = mount({ local: true, apiOverrides: { downloadSingleEpisode: async () => ({ success: false, error: '队列已满' }) } });
  try {
    await bad.flush();
    await bad.button('下载本集').props.onClick();
    await bad.flush();
    const node = toastNode(bad, 'error');
    assert.ok(node, '明确失败改用语义化的错误提示');
    assert.equal(node.props.role, 'alert');
    assert.equal(node.props['aria-atomic'], 'true');
    assert.equal(node.children.join(''), '队列已满');
    assert.equal(toastNode(bad, 'success'), undefined, '错误提示不得伪装成成功状态');
  } finally { bad.unmount(); }
});

test('batch download notices report partial failures as errors and complete success as status', async () => {
  for (const failure of ['none', 'response', 'rejection']) {
    let calls = 0;
    const ui = mount({ localIndexes: [1], props: { target: { seriesId: 'A', vidIndex: 1, ts: 1, autoplay: false } }, episodeCount: 3, apiOverrides: {
      downloadSingleEpisode: async () => {
        calls++;
        if (calls === 2 && failure === 'response') return { success: false, error: '队列已满' };
        if (calls === 2 && failure === 'rejection') throw new Error('连接中断');
        return { success: true, count: 1 };
      },
    } });
    try {
      await ui.flush();
      await ui.button('下载未完成集').props.onClick(); await ui.flush();
      assert.equal(calls, 2, '保留跳过已完成集并继续提交其余集的业务行为');
      const node = toastNode(ui, failure === 'none' ? 'success' : 'error');
      assert.ok(node);
      assert.equal(node.props.role, failure === 'none' ? 'status' : 'alert');
      assert.match(node.children.join(''), failure === 'none' ? /已把 2 集加入下载队列/ : /1 集提交成功，1 集失败/);
    } finally { ui.unmount(); }
  }
});

test('notices keep the 3000ms auto-dismiss and stay dismissible by click', async () => {
  const ui = mount({ local: true, apiOverrides: { downloadSingleEpisode: async () => ({ success: false, error: '队列已满' }) } });
  try {
    await ui.flush();
    const before = new Set(ui.timers.keys());
    await ui.button('下载本集').props.onClick();
    await ui.flush();
    assert.ok(anyToast(ui));
    const created = [...ui.timers.entries()].filter(([id]) => !before.has(id));
    const auto = created.find(([, timer]) => timer.delay === 3000);
    assert.ok(auto, '通知仍需在 3 秒后自动关闭');
    auto[1].fn();
    ui.render();
    assert.equal(anyToast(ui), undefined, '定时器到期后提示消失');

    await ui.button('下载本集').props.onClick();
    await ui.flush();
    const clickable = anyToast(ui);
    assert.ok(clickable, '再次失败仍会提示');
    clickable.props.onClick();
    ui.render();
    assert.equal(anyToast(ui), undefined, '点击提示可立即关闭');
  } finally { ui.unmount(); }
});

test('merge dialog is named by its visible title, and both confirmations keep cancel-first initial focus', async () => {
  const ui = mount({ local: true, apiOverrides: { getStorageUsage: async () => storage } });
  try {
    await ui.flush();
    ui.button('合并导出全集').props.onClick(); ui.render();
    const merge = ui.find(node => node.props.className === 'player-confirm' && node.props.role === 'dialog');
    assert.equal(merge.props['aria-labelledby'], 'player-merge-title');
    assert.equal(merge.props['aria-label'], undefined, '合并框改用可见标题命名，不再留 aria-label');
    const title = ui.find(node => node.props.id === 'player-merge-title');
    assert.ok(title, '可见标题必须携带 aria-labelledby 指向的 id');
    assert.match(title.children.flat(Infinity).filter(child => typeof child === 'string').join(''), /合并导出全集/);
    const mergeCancel = ui.find(node => node.type === 'button' && String(node.children.join('')) === '取消');
    assert.equal(mergeCancel.props['data-dialog-initial-focus'], true, '合并框初始焦点落在取消');
    ui.button('取消').props.onClick(); ui.render();
    assert.equal(ui.find(node => node.props.role === 'dialog'), undefined);

    ui.button('切换剧集').props.onClick(); await ui.flush();
    ui.button('删除全部已下载').props.onClick(); ui.render();
    const generic = ui.find(node => node.props.className === 'player-confirm' && node.props.role === 'dialog');
    assert.equal(generic.props['aria-label'], '删除全部本地文件', '通用删除确认保持自身的 aria-label 命名');
    assert.equal(generic.props['aria-labelledby'], undefined);
    const confirmCancel = ui.find(node => node.type === 'button' && String(node.children.join('')) === '取消');
    assert.equal(confirmCancel.props['data-dialog-initial-focus'], true, '删除确认初始焦点落在取消');
  } finally { ui.unmount(); }
});

test('the shared hook returns focus to the player page only after the confirm button submits', () => {
  const source = fs.readFileSync(new URL('../Player.jsx', import.meta.url), 'utf8');
  assert.match(source,
    /useDialogKeyboard\(active && !!\(confirmAsk \|\| mergeAsk\),[\s\S]*?'\.player-confirm',\s*undefined,\s*\(\) => \{ if \(!confirmReturnToPage\.current\) return null; confirmReturnToPage\.current = false; return document\.querySelector\('main\[data-page="player"\]'\); \}\)/,
    '对话框控制器保留默认初始焦点，第五参 null 时回落到触发按钮');

  const start = source.indexOf('const fn = confirmAsk.onOk;');
  assert.ok(start > 0, '确认按钮保留原有提交顺序');
  const body = source.slice(start, source.indexOf('await fn();', start));
  assert.ok(body.indexOf('confirmReturnToPage.current = true;') > 0, '提交前标记需要回焦播放页');
  assert.ok(body.indexOf('confirmReturnToPage.current = true;') < body.indexOf('setConfirmAsk(null);'),
    '标志必须在关闭对话框之前置位，取消路径不得标记');
  const footers = [...source.matchAll(/<div className="player-confirm-foot">([\s\S]*?)<\/div>/g)];
  assert.equal(footers.length, 2, '保留合并和通用确认两组操作');
  for (const [, footer] of footers) {
    const initialActions = [...footer.matchAll(/<button\b[\s\S]*?<\/button>/g)]
      .map(([button]) => button).filter(button => button.includes('data-dialog-initial-focus'));
    assert.equal(initialActions.length, 1, '每个确认框仅有一个初始焦点标记');
    assert.match(initialActions[0], />\s*取消\s*<\/button>$/, '确认框的唯一初始焦点仍是取消按钮');
  }
});

// 关键文案不再靠关键词猜测分类：确认错误分支是显式传入 type。
test('explicit error branches pass the error type instead of matching toast text', () => {
  const source = fs.readFileSync(new URL('../Player.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /showToast\([^)]*\.inclu?des\(/, '不得按文案关键词推断提示类型');
  assert.match(source, /showToast\(message \+ \(result\?\.warning \? `；\$\{result\.warning\}` : ''\), result\?\.success \? 'success' : 'error'\)/,
    '删除结果按后端返回的真实成败决定提示类型');
  assert.match(source, /showToast\(error\.message \|\| '删除失败，请重试', 'error'\)/);
  assert.match(source, /onError=\{message => showToast\(message, 'error'\)\}/, '播放器控件的错误回调显式标注错误');
  assert.equal((source.match(/const showToast = useCallback\(\(text, type = 'success'\)/g) || []).length, 1);
});
