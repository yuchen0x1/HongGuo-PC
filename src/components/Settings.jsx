import React, { useState, useEffect, useRef } from 'react';
import { useDanmakuSource, writeDanmakuSource } from './danmakuSource.mjs';
import useDialogKeyboard from './useDialogKeyboard';
import './Settings.css';
import AppearanceSettings from './AppearanceSettings';
import ShortcutSettings from './ShortcutSettings';
import CustomSources from './CustomSources';
import BuiltinSources from './BuiltinSources';
import PlaybackDiagnostics from './PlaybackDiagnostics';
import { Settings, Folder, Check, Globe, X, RefreshCw, AlertCircle, Search } from './icons';
import { resolveLocale, useI18n } from '../i18n.js';

const resolveLocaleSafe = (setting, candidates = []) => {
  if (typeof resolveLocale === 'function') return resolveLocale(setting, candidates);
  if (setting === 'zh-CN' || setting === 'en-US') return setting;
  return candidates.some(value => String(value).toLowerCase().startsWith('en')) ? 'en-US' : 'zh-CN';
};


const FORMAT_PRESETS = [
  { label: '剧名_第N集', value: '剧名 集数' },
  { label: '剧名_第N集_标题', value: '剧名 集数 标题' },
];

const PROXY_MODES = [
  { value: 'system', label: '跟随系统', desc: '接口与下载读取启动环境代理；发现页等浏览器请求使用系统代理' },
  { value: 'custom', label: '手动指定', desc: '填写 HTTP/HTTPS 代理地址与端口，忽略环境变量中的绕过规则（NO_PROXY）' },
  { value: 'direct', label: '强制直连', desc: '忽略一切代理，直接连接' },
];

// 常见代理软件默认端口，方便一键填入
const PORT_PRESETS = [
  { label: 'Clash / Mihomo', port: 7890 },
  { label: 'V2rayN', port: 10809 },
  { label: 'Shadowsocks', port: 1080 },
  { label: 'Burp / 抓包', port: 8080 },
];

/** 已保存设置 -> 当前生效的代理描述 */
function describeProxy(settings) {
  if (!settings || settings.proxy_enabled !== true) {
    return { on: false, text: '未启用（所有请求直连）' };
  }
  const mode = settings.proxy_mode || 'system';
  if (mode === 'direct') {
    return { on: false, text: '已开启但模式为「强制直连」' };
  }
  if (mode === 'custom') {
    const host = (settings.proxy_host || '').trim();
    const port = (settings.proxy_port || '').toString().trim();
    if (!host) return { on: false, text: '已开启，但未填写代理地址' };
    return { on: true, text: `${host}${port ? ':' + port : ''}` };
  }
  return { on: true, text: '接口/下载跟随启动环境，浏览器跟随系统' };
}

// 设置页顶部锚点导航：点击平滑滚动到对应卡片并高亮。
const SETTING_ANCHORS = [
  { id: 'appearance', label: '外观', keywords: '主题 缩放 字号 海报 theme dark light' },
  { id: 'window', label: '窗口', keywords: '关闭 托盘 最小化 后台 退出 close tray' },
  { id: 'language', label: '语言', keywords: '简体中文 英文 English locale language' },
  { id: 'shortcuts', label: '快捷键', keywords: '播放 老板键 按键' },
  { id: 'pip', label: '画中画', keywords: '小窗 原生 置顶' },
  { id: 'builtin', label: '内置来源', keywords: '来源 采集 搜索' },
  { id: 'custom', label: '自定义源', keywords: '播放源 苹果cms api 接口' },
  { id: 'playback', label: '播放缓存', keywords: '播放与缓存 缓存后续 2 集 自动兼容模式 看完自动删除 连播 优先使用红果 App 搜索 官网' },
  { id: 'playback-diagnostics', label: '播放诊断', keywords: '账号 会话 身份 接口 取源 线路 故障 解码 媒体 连接测试 诊断报告 playback diagnostics' },
  { id: 'danmaku', label: '弹幕', keywords: '本集评论 时间轴弹幕 显示弹幕按钮 弹幕来源' },
  { id: 'download', label: '下载', keywords: '下载目录 文件命名规则 默认下载清晰度 最大并发下载数 选择文件夹 普通下载保存整剧资料 封面 简介 NFO NAS' },
  { id: 'proxy', label: '代理', keywords: '网络代理 直连 跟随系统代理 代理密码 主机 端口 用户名 连接测试' },
  { id: 'watch', label: '追剧', keywords: '追剧提醒 自动检查新集 查找疑似新一季 发送系统通知' },
  { id: 'storage', label: '配置与诊断', keywords: '配置位置 配置文件位置 密码 安全存储 便携版 数据 故障 排查 导出诊断信息 diagnostics' },
];

function SettingsPage({ active = true, preview = false, appInfo = null }) {
  const localeApi = typeof useI18n === 'function' ? useI18n() : { t: (_key, fallback) => fallback, setLocaleSetting: () => {} };
  const { t, setLocaleSetting, locale = 'zh-CN' } = localeApi;
  const danmakuSource = useDanmakuSource();
  const [activeAnchor, setActiveAnchor] = useState('');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [proxyDraft, setProxyDraft] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [readbackNotice, setReadbackNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [pictureModeSaving, setPictureModeSaving] = useState(false);
  const [pictureModeNotice, setPictureModeNotice] = useState('');
  const [pictureModeError, setPictureModeError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [diagnosticsNotice, setDiagnosticsNotice] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [restoreState, setRestoreState] = useState({ busy: false, armed: false, notice: '', error: '' });
  const testVersion = useRef(0);
  const savingRef = useRef(false);
  const pictureModeRequest = useRef({ pending: false, version: 0 });
  const editedKeys = useRef(new Map());
  const readVersion = useRef(0);
  // Keep freshness and the normalized readback together, even before React renders it.
  const proxySnapshot = useRef({ settings: null, stale: false });
  const savedTimer = useRef(null);
  const settingsSearchRef = useRef(null);

  // 重新进入设置页时同步播放器里刚改过的共享选项；保留用户未保存的字段。
  const refreshSettings = async () => {
    if (savingRef.current) return;
    const version = ++readVersion.current;
    const modeVersion = pictureModeRequest.current.version;
    try {
      const fresh = { download_quality: 'auto', picture_in_picture_mode: 'custom', close_to_tray: true, ...await window.electronAPI.getSettings() };
      if (version !== readVersion.current) return;
      setSettings(prev => {
        if (!prev) return fresh;
        const merged = { ...fresh };
        for (const key of editedKeys.current.keys()) {
          if (Object.hasOwn(prev, key)) merged[key] = prev[key];
        }
        if (pictureModeRequest.current.pending || modeVersion !== pictureModeRequest.current.version) {
          merged.picture_in_picture_mode = prev.picture_in_picture_mode;
        }
        return merged;
      });
      proxySnapshot.current = { settings: fresh, stale: false };
      setLoadError('');
      setReadbackNotice('');
      return fresh;
    } catch (error) {
      if (version === readVersion.current) setLoadError(error.message || '设置加载失败，请重试');
    }
  };

  useEffect(() => () => { testVersion.current++; readVersion.current++; clearTimeout(savedTimer.current); }, []);

  useEffect(() => {
    if (!active) {
      testVersion.current++;
      setTesting(false);
      setTestResult(null);
      return;
    }
    void refreshSettings();
    window.electronAPI.getStorageRecovery?.().then(setRecovery).catch(() => {});
  }, [active]);

  const update = (key, value) => {
    editedKeys.current.set(key, (editedKeys.current.get(key) || 0) + 1);
    setSettings((prev) => ({ ...prev, [key]: value }));
    if (key === 'locale') setLocaleSetting(value);
    setSaved(false);
    setDirty(true);
    setSaveError('');
  };

  const changePictureInPictureMode = async (event) => {
    const mode = event.target.value;
    const request = pictureModeRequest.current;
    if (!['native', 'custom'].includes(mode) || request.pending) return;
    request.pending = true;
    request.version++;
    const previous = settings.picture_in_picture_mode === 'native' ? 'native' : 'custom';
    setSettings(prev => ({ ...prev, picture_in_picture_mode: mode }));
    setPictureModeSaving(true);
    setPictureModeNotice('');
    setPictureModeError('');
    try {
      const result = await window.electronAPI.saveSettings({ picture_in_picture_mode: mode });
      if (!result?.success) throw new Error(result?.error || '画中画小窗设置保存失败，请重试');
      setPictureModeNotice('已自动保存，下次开启悬浮窗时生效');
    } catch (error) {
      setSettings(prev => ({ ...prev, picture_in_picture_mode: previous }));
      setPictureModeError(error.message || '画中画小窗设置保存失败，请重试');
    } finally {
      request.pending = false;
      request.version++;
      setPictureModeSaving(false);
    }
  };

  const selectFolder = async () => {
    try {
      const dir = await window.electronAPI.selectFolder();
      if (dir) update('root', dir);
    } catch (error) { setSaveError(error.message || '文件夹选择失败，请重试'); }
  };

  const persist = async (next, isProxy = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    readVersion.current++; // Invalidate any refresh started before this commit.
    setSaving(true);
    setSaved(false);
    setSaveError('');
    setReadbackNotice('');
    try {
      // Proxy confirmation commits only its dialog; other settings remain drafts.
      const editable = ['locale', 'root', 'name_format', 'download_quality', 'download_metadata', 'cache_next_episode', 'compat_mode', 'auto_delete_watched', 'show_danmaku_controls', 'max_concurrent', 'proxy_enabled', 'proxy_mode', 'proxy_host', 'proxy_port', 'proxy_username', 'proxy_password', 'watch_updates_enabled', 'watch_sequels_enabled', 'watch_notifications_enabled', 'search_app_enabled', 'app_updates_enabled'];
      const revisions = new Map(editedKeys.current);
      const submitted = {};
      for (const key of editable) {
        if (Object.hasOwn(next, key) && (isProxy ? key.startsWith('proxy_') : revisions.has(key))) submitted[key] = next[key];
      }
      if (isProxy) submitted.clear_proxy_password = next.clear_proxy_password === true && !String(next.proxy_password || '');
      const res = await window.electronAPI.saveSettings(submitted);
      if (!res?.success) throw new Error(res?.error || '设置未保存，请重试');
      if (isProxy) { proxySnapshot.current = { settings: null, stale: true }; closeProxy(); }
      for (const key of Object.keys(submitted)) {
        if (editedKeys.current.get(key) === revisions.get(key)) editedKeys.current.delete(key);
      }
      setDirty(editedKeys.current.size > 0);
      setSaved(!isProxy && editedKeys.current.size === 0);
      if (isProxy) setReadbackNotice('代理设置已保存。');
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
      // Apply acknowledged public fields even if a later readback fails. Never retain a password.
      const committed = { ...submitted };
      delete committed.proxy_password;
      delete committed.clear_proxy_password;
      // Main normalizes proxy URLs and removes embedded credentials. Only its readback is safe to display.
      for (const key of Object.keys(committed)) if (key.startsWith('proxy_')) delete committed[key];
      const mergeDrafts = (fresh, previous) => {
        const merged = { ...fresh };
        for (const key of editedKeys.current.keys()) merged[key] = previous[key];
        return merged;
      };
      setSettings(prev => mergeDrafts({ ...prev, ...committed }, prev));
      if (submitted.locale && !editedKeys.current.has('locale')) {
        setLocaleSetting(submitted.locale);
        globalThis.window?.dispatchEvent?.(new CustomEvent('hongguo:locale-change', { detail: submitted.locale }));
      }
      const modeVersion = pictureModeRequest.current.version;
      try {
        const fresh = await window.electronAPI.getSettings();
        proxySnapshot.current = { settings: fresh, stale: false };
        setSettings(prev => {
          const merged = mergeDrafts(fresh, prev);
          if (pictureModeRequest.current.pending || modeVersion !== pictureModeRequest.current.version) merged.picture_in_picture_mode = prev.picture_in_picture_mode;
          return merged;
        });
      } catch {
        setReadbackNotice('设置已保存，但刷新显示失败；重新进入设置页可重试读取，无需重复保存。');
      }
    } catch (error) {
      setSaveError(error.message || '设置保存失败，请重试');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const save = () => persist(settings);

  const exportDiagnostics = async () => {
    if (diagnosticsBusy) return;
    setDiagnosticsBusy(true);
    setDiagnosticsNotice('');
    try {
      const result = await window.electronAPI.exportDiagnostics();
      if (result?.cancelled) return;
      if (!result?.success) throw new Error(result?.error || '诊断信息导出失败，请重试');
      setDiagnosticsNotice(`已导出 ${result.fileName || '诊断文件'}`);
    } catch (error) {
      setDiagnosticsNotice(error.message || '诊断信息导出失败，请重试');
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  // 数据备份恢复：仅在主进程检测到「数据文件损坏 + 有效备份」时出现；两步点击防止误触。
  const requestBackupRestore = async () => {
    if (restoreState.busy) return;
    if (!restoreState.armed) {
      setRestoreState(state => ({ ...state, armed: true, notice: '', error: '' }));
      return;
    }
    setRestoreState(state => ({ ...state, busy: true, error: '' }));
    try {
      const result = await window.electronAPI.restoreStorageBackup?.();
      if (result?.success) {
        setRecovery({ available: false });
        setRestoreState({
          busy: false,
          armed: false,
          notice: `已恢复备份${result.preservedFile ? `，损坏的原文件保留为 ${result.preservedFile}` : ''}；请重启应用加载恢复后的资料。`,
          error: '',
        });
      } else {
        setRestoreState(state => ({ ...state, busy: false, armed: false, error: result?.error || '恢复备份失败；原文件未更改。' }));
      }
    } catch (error) {
      setRestoreState(state => ({ ...state, busy: false, armed: false, error: error?.message || '恢复备份失败；原文件未更改。' }));
    }
  };

  const scrollToSection = (id) => {    const el = document.getElementById(`settings-anchor-${id}`);
    if (!el || el.hidden) return;
    setActiveAnchor(id);
    el.focus({ preventScroll: true });
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'start' });
  };

  const normalizeSearch = value => value.normalize('NFKC').trim().toLowerCase();
  const normalizedSettingsSearch = normalizeSearch(settingsSearch);
  const searchTerms = normalizedSettingsSearch.split(/\s+/);
  const matchingAnchors = normalizedSettingsSearch
    ? SETTING_ANCHORS.filter(({ label, keywords }) => {
        const words = normalizeSearch(`${label} ${keywords}`);
        return searchTerms.every(term => words.includes(term));
      })
    : SETTING_ANCHORS;
  const visibleAnchors = new Set(matchingAnchors.map(anchor => anchor.id));
  // Keep filtered controls mounted so their edit state survives a search.
  const anchorProps = id => ({ id: `settings-anchor-${id}`, role: 'region', 'aria-label': SETTING_ANCHORS.find(anchor => anchor.id === id)?.label, tabIndex: -1, hidden: !visibleAnchors.has(id) });
  const changeSearch = value => { setSettingsSearch(value); setActiveAnchor(''); };
  const clearSearch = () => { changeSearch(''); settingsSearchRef.current?.focus(); };

  const submitSettingsSearch = (event) => {
    event.preventDefault();
    if (matchingAnchors[0]) scrollToSection(matchingAnchors[0].id);
  };

  const closeProxy = () => {
    testVersion.current++;
    setTesting(false);
    setProxyOpen(false);
    setProxyDraft(null);
    setTestResult(null);
  };

  // ===== 代理弹窗 =====
  const openProxyModal = async () => {
    if (savingRef.current) return;
    const snapshot = proxySnapshot.current;
    const current = snapshot.stale ? await refreshSettings() : snapshot.settings || settings;
    if (!current) {
      setSaveError('代理已保存，但当前配置读取失败；请稍后重新打开代理设置，避免覆盖已生效的配置。');
      return;
    }
    testVersion.current++;
    setProxyDraft({
      proxy_enabled: current.proxy_enabled === true,
      proxy_mode: current.proxy_mode || 'system',
      proxy_host: current.proxy_host || '127.0.0.1',
      proxy_port: current.proxy_port || 7890,
      proxy_username: current.proxy_username || '',
      proxy_password: '',
      clear_proxy_password: false,
    });
    setTestResult(null);
    setSaveError('');
    setProxyOpen(true);
  };

  const patchDraft = (key, value) => {
    testVersion.current++;
    setProxyDraft((prev) => ({ ...prev, [key]: value }));
    setTesting(false);
    setTestResult(null);
  };

  const runTest = async () => {
    const request = ++testVersion.current;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.electronAPI.testProxy(proxyDraft);
      if (request === testVersion.current) setTestResult(res);
    } catch (e) {
      if (request === testVersion.current) setTestResult({ success: false, error: e.message });
    } finally {
      if (request === testVersion.current) setTesting(false);
    }
  };

  const applyProxy = () => persist({ ...settings, ...proxyDraft }, true);

  useDialogKeyboard(active && proxyOpen, () => { if (!savingRef.current) closeProxy(); }, '.proxy-modal');

  if (!settings) {
    return <div className="settings-container">{loadError ? <div role="alert"><p>{loadError}</p><button className="btn btn-outline" onClick={refreshSettings}>{t('settings.reload', '重新加载')}</button></div> : t('settings.loading', '加载中…')}</div>;
  }

  const proxyInfo = describeProxy(settings);
  const mode = proxyDraft ? proxyDraft.proxy_mode : 'system';

  return (
    <div className="settings-container">
      <div className="settings-header" lang={locale}>
        <Settings size={22} />
        <div><h2>{t('settings.title', '设置')}</h2><p className="page-description">{t('settings.subtitle', '让下载、保存和网络连接，按你的习惯运行。')}</p></div>
      </div>

      <form className="settings-search" role="search" onSubmit={submitSettingsSearch}>
        <Search size={16} />
        <input
          ref={settingsSearchRef}
          lang={locale}
          type="search"
          value={settingsSearch}
          onChange={(event) => changeSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && settingsSearch && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              clearSearch();
            }
          }}
          placeholder={t('settings.search', '搜索设置，例如：下载、弹幕、代理')}
          aria-label={t('settings.search', '搜索设置')}
          aria-describedby="settings-search-hint"
        />
        {settingsSearch && <button type="button" className="settings-search-clear" onClick={clearSearch} aria-label="清除设置搜索">
          <X size={15} />
        </button>}
      </form>
      <div className="settings-search-meta" id="settings-search-hint" aria-live="polite">
        {normalizedSettingsSearch
          ? (matchingAnchors.length > 0 ? `找到 ${matchingAnchors.length} 个设置分类，按 Enter 跳转到第一个结果` : '没有匹配的设置分类；试试其他关键词，或按 Esc 清除')
          : '输入关键词筛选设置分类'}
      </div>
      <nav className="settings-quicknav" aria-label="设置分类" hidden={!matchingAnchors.length}>
        {matchingAnchors.map((anchor) => (
          <button key={anchor.id} type="button"
            className={`settings-quicknav-item ${activeAnchor === anchor.id ? 'active' : ''}`}
            aria-current={activeAnchor === anchor.id ? 'true' : undefined}
            onClick={() => scrollToSection(anchor.id)}>
            {anchor.label}
          </button>
        ))}
      </nav>

      {!matchingAnchors.length && <div className="settings-search-empty">
        <p>没有匹配的设置，未保存的修改仍会保留。</p>
        <button type="button" className="btn btn-outline" onClick={clearSearch}>显示全部设置</button>
      </div>}
      <section className="settings-card" {...anchorProps('appearance')} aria-label="外观设置"><AppearanceSettings active={active} /></section>
      <section className="settings-card" {...anchorProps('window')} aria-label="窗口设置">
        <div className="settings-group">
          <span className="settings-label">关闭按钮</span>
          <label className="proxy-switch-row">
            <input type="checkbox" aria-label="关闭时最小化到系统托盘" checked={settings.close_to_tray !== false}
              onChange={event => update('close_to_tray', event.target.checked)} />
            <span className="proxy-switch-text">关闭时最小化到系统托盘<em>默认开启。点右上角关闭按钮后窗口收进托盘，应用继续在后台运行（下载不断）；点击托盘图标恢复窗口，右键托盘图标可退出应用。保存后生效。</em></span>
          </label>
        </div>
      </section>
      <section className="settings-card" lang={locale} {...anchorProps('language')} aria-label={t('settings.language', '语言设置')}>
        <div className="settings-group">
          <label className="settings-label" htmlFor="ui-locale">{t('settings.language', '语言 / Language')}</label>
          <select id="ui-locale" className="input-field select-field" value={settings.locale || 'auto'} disabled={!active || saving} aria-describedby="ui-locale-hint" onChange={event => update('locale', event.target.value)}>
            <option value="auto">{t('settings.auto', '自动（当前：{locale}）', { locale: resolveLocaleSafe('auto', typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language]) })}</option>
            <option value="zh-CN" lang="zh-CN">简体中文</option>
            <option value="en-US" lang="en-US">{t('settings.englishPartial', 'English (partial)')}</option>
          </select>
          <p className="settings-hint" id="ui-locale-hint">{t('settings.languageHint', '英文仅覆盖导航与部分设置，其余界面仍为中文。选择后立即预览，点击「保存设置」后会记住语言偏好。')}</p>
        </div>
      </section>
      <div {...anchorProps('shortcuts')}><ShortcutSettings active={active} /></div>
      <section className="settings-card" {...anchorProps('pip')} aria-label="画中画小窗设置">
        <div className="settings-group">
          <label className="settings-label" htmlFor="picture-in-picture-mode">画中画小窗</label>
          <select id="picture-in-picture-mode" className="input-field select-field"
            value={settings.picture_in_picture_mode === 'native' ? 'native' : 'custom'}
            disabled={!active || saving || pictureModeSaving}
            aria-describedby="picture-in-picture-mode-hint"
            onChange={changePictureInPictureMode}>
            <option value="native">系统原生</option>
            <option value="custom">应用自带</option>
          </select>
          <p className="settings-hint" id="picture-in-picture-mode-hint">选择立即自动保存。已打开的小窗不会被中断或切换，下次开启时生效。系统原生使用操作系统的画中画能力；应用自带可显示当前剧名，并支持返回主窗口。</p>
          {(pictureModeSaving || pictureModeNotice) && <p className="settings-hint" role="status">{pictureModeSaving ? '正在保存…' : pictureModeNotice}</p>}
          {pictureModeError && <p className="appearance-error" role="alert">{pictureModeError}</p>}
        </div>
      </section>
      <div {...anchorProps('builtin')}><BuiltinSources /></div>
      <div {...anchorProps('custom')}><CustomSources active={active} /></div>
      <p className="settings-hint" hidden={!visibleAnchors.has('pip')}>播放页顶部可开启小窗模式：窗口缩小、置顶并在支持的系统上跨虚拟桌面可见；鼠标移开时暂停隐藏，移回继续，Esc 或 Dock 可恢复主窗口。</p>
      <section className="settings-card" {...anchorProps('playback-diagnostics')}>
        <PlaybackDiagnostics active={active && visibleAnchors.has('playback-diagnostics')} />
      </section>
      <fieldset className="settings-card" disabled={saving}>
        <div className="settings-group" {...anchorProps('playback')}>
          <span className="settings-label">播放与缓存</span>
          <label className="proxy-switch-row"><input type="checkbox" checked={settings.cache_next_episode !== false} onChange={event => update('cache_next_episode', event.target.checked)} /><span className="proxy-switch-text">缓存后续 2 集<em>开始播放后最多预取接下来两集可在线播放的分集，减少连续切集等待；会使用网络流量。</em></span></label>
          <label className="proxy-switch-row"><input type="checkbox" checked={settings.compat_mode !== false} onChange={event => update('compat_mode', event.target.checked)} /><span className="proxy-switch-text">自动兼容模式<em>无法解码时尝试转码播放，解决部分黑屏有声问题。</em></span></label>
          <label className="proxy-switch-row"><input type="checkbox" checked={settings.auto_delete_watched === true} onChange={event => update('auto_delete_watched', event.target.checked)} /><span className="proxy-switch-text">看完自动删除<em>看完一集后删除该集已下载的视频、在线播放缓存和转码缓存。下载文件会永久删除；需要时可重新下载。保存后生效。</em></span></label>
          <label className="proxy-switch-row"><input type="checkbox" aria-label="优先使用红果 App 搜索" checked={settings.search_app_enabled === true} onChange={event => update('search_app_enabled', event.target.checked)} /><span className="proxy-switch-text">优先使用红果 App 搜索<em>失败或空结果自动回退官网；关闭此项时，官网不可用仍会尝试 App 备用搜索。</em></span></label>
        </div>
        <div className="settings-group" {...anchorProps('danmaku')}>
          <span className="settings-label">弹幕按钮设置</span>
          <div className="settings-inline-save">
          <label className="proxy-switch-row"><input type="checkbox" aria-label="显示弹幕按钮" checked={settings.show_danmaku_controls !== false} onChange={event => update('show_danmaku_controls', event.target.checked)} /><span className="proxy-switch-text">显示弹幕按钮<em>保存后生效。关闭时隐藏弹幕及弹幕设置按钮，并停用弹幕；再次开启会恢复原有弹幕偏好。</em></span></label>
            <button type="button" className="btn btn-primary" aria-label="保存当前设置" onClick={save}>{saving ? '保存中…' : saved ? '已保存' : '保存'}</button>
          </div>
        </div>
        <div className="settings-group" hidden={!visibleAnchors.has('danmaku')}>
          <label className="settings-label" htmlFor="danmaku-source">弹幕来源</label>
          <select id="danmaku-source" className="input-field select-field" value={danmakuSource} onChange={event => writeDanmakuSource(event.target.value)}>
            <option value="official">时间轴弹幕</option><option value="comments">本集评论（备用）</option>
          </select>
          <p className="settings-hint">切换立即生效，仅请求所选来源。时间轴弹幕跟随视频进度；本集评论依次展示，与视频时间无对应。两种来源共用显示偏好。</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={async () => {
            try {
              const result = await window.electronAPI.openExternalUrl('https://github.com/dawei233/hongguo-drama');
              if (result?.success === false) throw new Error(result.error || '来源链接打开失败');
            } catch (error) { setSaveError(error.message || '来源链接打开失败'); }
          }}>弹幕实现参考 dawei233/hongguo-drama（GPL-3.0）</button>
        </div>
        <div className="settings-group" {...anchorProps('download')}>
          <label className="settings-label">下载目录</label>
          <div className="folder-row">
            <input
              type="text"
              className="input-field"
              aria-label="下载目录"
              value={settings.root || ''}
              onChange={(e) => update('root', e.target.value)}
              placeholder="选择下载保存目录"
            />
            <button className="btn btn-outline" onClick={selectFolder}>
              <Folder size={16} />
              选择文件夹
            </button>
          </div>
          <p className="settings-hint">文件将保存到 <code>下载目录/红果短剧/剧名/</code> 下</p>
          <label className="proxy-switch-row"><input type="checkbox" aria-label="普通下载保存整剧资料" checked={settings.download_metadata === true}
            onChange={event => update('download_metadata', event.target.checked)} /><span className="proxy-switch-text">普通下载保存整剧资料<em>自动随视频保存封面、简介和 tvshow.nfo，不生成分集 NFO。可将下载目录设为已挂载的 NAS，程序会自动建剧名文件夹，无需再使用“下载到 NAS”。普通下载仍遵循看完自动删除设置。</em></span></label>
        </div>

        <div className="settings-group" hidden={!visibleAnchors.has('download')}>
          <label className="settings-label">文件命名规则</label>
          <div className="preset-row">
            {FORMAT_PRESETS.map((p) => (
              <button
                key={p.value}
                className={`btn-chip ${settings.name_format === p.value ? 'btn-chip-primary' : ''}`}
                onClick={() => update('name_format', p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="input-field mt8"
            aria-label="文件命名规则"
            value={settings.name_format || ''}
            onChange={(e) => update('name_format', e.target.value)}
          />
          <p className="settings-hint">
            可用变量：<code>剧名</code> · <code>集数</code>（如 001）· <code>标题</code>
            。每集保留独立集号，避免同名覆盖。
          </p>
        </div>

        <div className="settings-group" hidden={!visibleAnchors.has('download')}>
          <label className="settings-label" htmlFor="default-download-quality">默认下载清晰度</label>
          <select id="default-download-quality" className="input-field select-field"
            value={settings.download_quality || 'auto'} aria-describedby="default-download-quality-hint"
            onChange={(event) => update('download_quality', event.target.value)}>
            <option value="auto">自动（兼容优先）</option>
            <option value="1080p">1080P</option>
            <option value="720p">720P</option>
          </select>
          <p className="settings-hint" id="default-download-quality-hint">保存后用于新建下载任务，也可在下载时单独选择。红果片源所选清晰度不可用或下载失败时，自动尝试更低清晰度，并在下载管理中提示；已有文件不自动删除或覆盖。</p>
        </div>

        <div className="settings-group" hidden={!visibleAnchors.has('download')}>
          <label className="settings-label">最大并发下载数</label>
          <select
            className="input-field select-field"
            aria-label="最大并发下载数"
            value={settings.max_concurrent || 3}
            onChange={(e) => update('max_concurrent', parseInt(e.target.value, 10))}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>{n} 个同时下载</option>
            ))}
          </select>
          <p className="settings-hint">
            同时下载 <b>{settings.max_concurrent || 3}</b> 集（保存后立即生效）。
            并发越高越快，但可能触发接口限流，建议 3~5。
          </p>
        </div>

        <div className="settings-group" {...anchorProps('proxy')}>
          <label className="settings-label">网络代理</label>
          <div className="proxy-status-row">
            <span className={`proxy-dot ${proxyInfo.on ? 'proxy-dot-on' : 'proxy-dot-off'}`} />
            <span className="proxy-status-text">
              {proxyInfo.on ? <>已启用：<code>{proxyInfo.text}</code></> : proxyInfo.text}
            </span>
            <button className="btn btn-outline btn-sm" onClick={openProxyModal}>
              <Globe size={15} />
              配置代理
            </button>
          </div>
          <p className="settings-hint">
            手动代理用于接口、下载和应用内浏览器；跟随系统时，接口与下载读取启动时的环境代理及绕过规则，发现页等浏览器请求使用系统代理。保存后立即生效。
          </p>
        </div>

        <div className="settings-group" {...anchorProps('watch')}>
          <span className="settings-label">追剧提醒</span>
          <label className="proxy-switch-row"><input type="checkbox" checked={settings.watch_updates_enabled !== false} onChange={event => update('watch_updates_enabled', event.target.checked)} /><span className="proxy-switch-text">自动检查新集<em>应用运行期间，每部剧约 6 小时检查一次；列表较多时分批检查</em></span></label>
          <label className="proxy-switch-row"><input type="checkbox" checked={settings.watch_sequels_enabled !== false} onChange={event => update('watch_sequels_enabled', event.target.checked)} /><span className="proxy-switch-text">查找疑似新一季<em>约每天按剧名搜索一次，仅提示同名且季数更高的剧；可能遗漏或误报</em></span></label>
          <label className="proxy-switch-row"><input type="checkbox" checked={settings.watch_notifications_enabled === true} onChange={event => update('watch_notifications_enabled', event.target.checked)} /><span className="proxy-switch-text">发送系统通知<em>默认关闭。开启后还需允许 macOS 通知；关闭不影响观看记录红点</em></span></label>
        </div>

        <div className="settings-group" {...anchorProps('storage')}>
          <span className="settings-label">配置文件位置</span>
          {settings.proxy_password_warning && <p className="alert alert-error" role="alert">{settings.proxy_password_warning}</p>}
          <p className="settings-hint">代理密码由本机系统安全存储加密；更换电脑后可能需要重新输入。</p>
          <p className="settings-hint settings-path"><code>{appInfo?.dataDir || '系统配置目录'}</code></p>
          {appInfo?.configNote
            ? <p className="settings-hint" role="status">{appInfo.configNote}</p>
            : <p className="settings-hint">{appInfo?.configMode === 'portable'
              ? '便携版：设置、下载记录与界面数据保存在程序目录的 data 文件夹；从旧版本切换时，原系统目录里的搜索历史不会自动带入。移动或备份程序时请连同该文件夹一起保留。'
              : '设置、下载记录与界面数据保存在系统用户目录；更换电脑时可复制这个文件夹。'}</p>}
          <div className="settings-inline-save">
            <button type="button" className="btn btn-outline btn-sm" onClick={exportDiagnostics} disabled={diagnosticsBusy}>
              {diagnosticsBusy ? '正在导出…' : '导出诊断信息'}
            </button>
            <span className="settings-hint" role="status">仅包含版本、运行状态、任务统计和工具可用性，不包含密码、媒体地址或本地路径。</span>
          </div>
          {diagnosticsNotice && <p className="settings-hint" role="status">{diagnosticsNotice}</p>}
          {recovery?.available && (
            <div className="settings-inline-save" role="alert">
              <button type="button" className="btn btn-outline btn-sm" onClick={requestBackupRestore} disabled={restoreState.busy}>
                {restoreState.busy ? '正在恢复…' : restoreState.armed ? '确认恢复备份' : '恢复数据备份'}
              </button>
              <span className="settings-hint">
                检测到可恢复的数据备份{Number.isFinite(recovery.size) ? `（约 ${Math.max(1, Math.round(recovery.size / 1024))} KB）` : ''}；当前数据文件读取失败，应用处于只读保护。恢复会用备份替换损坏文件并保留原文件，完成后需重启应用。
              </span>
            </div>
          )}
          {restoreState.notice && <p className="settings-hint" role="status">{restoreState.notice}</p>}
          {restoreState.error && <p className="alert alert-error" role="alert">{restoreState.error}</p>}
        </div>

        {preview && <div className="settings-group" hidden={!visibleAnchors.has('storage')}>
          <span className="settings-label">独立预览</span>
          <p className="settings-hint">预览数据独立保存，不接收正式版更新，不会覆盖已安装的红果短剧。</p>
        </div>}

        <div className="settings-footer">
          {dirty && <span className="settings-hint" role="status">有未保存的修改</span>}
          <button className="btn btn-primary" onClick={save}>
            {saving ? '正在保存…' : saved ? <><Check size={16} /> 已保存</> : '保存设置'}
          </button>
        </div>
        {readbackNotice && <p className="settings-hint" role="status">{readbackNotice}</p>}
        {saveError && !proxyOpen && <p className="alert alert-error" role="alert">{saveError}</p>}
      </fieldset>

      {proxyOpen && proxyDraft && (
        <div className="proxy-modal-mask" onClick={() => !saving && closeProxy()}>
          <div className="proxy-modal" role="dialog" aria-modal="true" aria-label="网络代理设置" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="proxy-modal-head">
              <div className="proxy-modal-title">
                <Globe size={18} />
                <span>网络代理设置</span>
              </div>
              <button className="icon-btn" title="关闭" disabled={saving} onClick={closeProxy}>
                <X size={16} />
              </button>
            </div>

            <fieldset className="proxy-modal-body" disabled={saving}>
              <label className="proxy-switch-row">
                <input
                  type="checkbox"
                  checked={proxyDraft.proxy_enabled}
                  onChange={(e) => patchDraft('proxy_enabled', e.target.checked)}
                />
                <span className="proxy-switch-text">
                  启用代理
                  <em>关闭时代理不生效，所有请求直连</em>
                </span>
              </label>

              <div className={`proxy-fields ${proxyDraft.proxy_enabled ? '' : 'proxy-fields-disabled'}`}>
                <div className="settings-group">
                  <label className="settings-label">代理模式</label>
                  <div className="proxy-mode-list">
                    {PROXY_MODES.map((m) => (
                      <label
                        key={m.value}
                        className={`proxy-mode-item ${mode === m.value ? 'active' : ''}`}
                      >
                        <input
                          type="radio"
                          name="proxy_mode"
                          value={m.value}
                          checked={mode === m.value}
                          disabled={!proxyDraft.proxy_enabled}
                          onChange={() => patchDraft('proxy_mode', m.value)}
                        />
                        <span className="proxy-mode-body">
                          <b>{m.label}</b>
                          <em>{m.desc}</em>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {mode === 'custom' && (
                  <div className="settings-group">
                    <label className="settings-label">代理地址</label>
                    <div className="proxy-host-row">
                      <input
                        type="text"
                        className="input-field"
                        aria-label="代理服务器地址"
                        placeholder="127.0.0.1"
                        value={proxyDraft.proxy_host}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_host', e.target.value)}
                      />
                      <span className="proxy-colon">:</span>
                      <input
                        type="number"
                        className="input-field proxy-port"
                        aria-label="代理端口"
                        placeholder="7890"
                        min="1"
                        max="65535"
                        value={proxyDraft.proxy_port}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_port', e.target.value)}
                      />
                    </div>
                    <div className="preset-row mt8">
                      {PORT_PRESETS.map((p) => (
                        <button
                          key={p.port}
                          type="button"
                          className="btn-chip"
                          disabled={!proxyDraft.proxy_enabled}
                          onClick={() => patchDraft('proxy_port', p.port)}
                        >
                          {p.label} {p.port}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {mode === 'custom' && (
                  <div className="settings-group">
                    <label className="settings-label">代理认证（可选）</label>
                    <div className="proxy-auth-row">
                      <input
                        type="text"
                        className="input-field"
                        aria-label="代理用户名"
                        placeholder="用户名"
                        autoComplete="off"
                        value={proxyDraft.proxy_username}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_username', e.target.value)}
                      />
                      <input
                        type="password"
                        className="input-field"
                        aria-label="代理密码"
                        placeholder={settings.proxy_password_set ? '已保存，留空表示不修改' : '密码'}
                        autoComplete="new-password"
                        value={proxyDraft.proxy_password}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => {
                          patchDraft('proxy_password', e.target.value);
                          if (e.target.value) patchDraft('clear_proxy_password', false);
                        }}
                      />
                    </div>
                    <p className="settings-hint">{proxyDraft.clear_proxy_password ? '保存后将清除已保存的密码。' : settings.proxy_password_set ? '已保存密码。输入新密码可替换；留空则保持不变。' : '代理无需认证时留空即可'}</p>
                    {settings.proxy_password_set && <button type="button" className="btn btn-outline" disabled={!proxyDraft.proxy_enabled} onClick={() => { patchDraft('proxy_password', ''); patchDraft('clear_proxy_password', true); }}>清除已保存密码</button>}
                  </div>
                )}
              </div>

              <p className="settings-hint">测试仅检查接口与下载访问百度的连接，不代表发现页等浏览器请求的代理状态。</p>
              {testResult && (
                <div className={`proxy-test-result ${testResult.success ? 'ok' : 'fail'}`}>
                  {testResult.success ? <Check size={15} /> : <AlertCircle size={15} />}
                  <span>
                    {testResult.success ? testResult.message : testResult.error}
                    {testResult.success && testResult.via ? ` · 经由 ${testResult.via}` : ''}
                  </span>
                </div>
              )}
              {saveError && <p className="alert alert-error" role="alert">{saveError}</p>}
            </fieldset>

            <div className="proxy-modal-foot">
              <button className="btn btn-outline" onClick={runTest} disabled={testing || saving}>
                <RefreshCw size={15} />
                {testing ? '测试中...' : '测试连接'}
              </button>
              <div className="proxy-foot-right">
                <button className="btn btn-outline" disabled={saving} onClick={closeProxy}>取消</button>
                <button className="btn btn-primary" disabled={saving} onClick={applyProxy}>
                  <Check size={15} />
                  {saving ? '正在保存…' : '保存并生效'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default SettingsPage;
