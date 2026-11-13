import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Film, Download, Settings, Play, Home, Search, Clock, User, Megaphone } from './components/icons';
import HongguoDownload from './components/HongguoDownload';
import DownloadManager from './components/DownloadManager';
import SettingsPage from './components/Settings';
import Player from './components/Player';
import Browse from './components/Browse';
import PageMenu from './components/PageMenu';
import WatchHistory from './components/WatchHistory';
import { initializeTheme } from './theme';
import useStealthWindow from './components/useStealthWindow';
import './components/StealthWindow.css';
import AppUpdateNotice from './components/AppUpdateNotice';
import DramaFeed from './components/DramaFeed';
import ReleaseCalendar from './components/ReleaseCalendar';
import AccountManagement from './components/AccountManagement';
import CommandPalette from './components/CommandPalette';
import Backdrop from './components/Backdrop';
import TitleBar from './components/TitleBar';
import UpdateCheckSettings from './components/UpdateCheckSettings';
import ReleaseNotesList from './components/ReleaseNotesList';
import brandIcon from '../build/icon.ico';

const SIDEBAR_COLLAPSED_KEY = 'hongguo:sidebar-collapsed';
function readSidebarCollapsed() {
  try { return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch { return false; }
}
function PanelLeftIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M9.5 3v18" /><path d="M14 9l2 3-2 3" />
  </svg>;
}

function MoreIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
  </svg>;
}

function ToolbarMore({ children }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return <div className={`toolbar-more ${open ? 'is-open' : ''}`} ref={root}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" className="toolbar-more-trigger" ref={trigger}
      aria-label="更多窗口与播放操作" aria-haspopup="true" aria-expanded={open}
      aria-controls={open ? 'toolbar-more-menu' : undefined} title="更多操作"
      onClick={() => setOpen(value => !value)}>
      <MoreIcon size={17} /><span>更多</span>
    </button>
    <div id="toolbar-more-menu" className="toolbar-more-menu" role="group" aria-label="窗口与播放操作"
      onClick={event => { if (event.target.closest('button')) setOpen(false); }}>
      {children}
    </div>
  </div>;
}

const MENU = [
  { id: 'browse', label: '发现短剧', icon: Home },
  { id: 'feed', label: '热播推荐', icon: Film },
  { id: 'download', label: '搜索与下载', icon: Search },
  { id: 'player', label: '我的剧库', icon: Play },
  { id: 'history', label: '观看记录', icon: Clock },
  { id: 'calendar', label: '收藏与上新', icon: Clock },
  { id: 'manager', label: '下载管理', icon: Download },
  { id: 'account', label: '红果账号', icon: User },
  { id: 'announcements', label: '更新日志', icon: Megaphone },
  { id: 'settings', label: '设置', icon: Settings },
];

export default function App() {
  const { stealthMode, toggleStealth, stealthError } = useStealthWindow();
  useLayoutEffect(() => initializeTheme(), []);
  const [layout, setLayout] = useState('landscape');
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [actionsHidden, setActionsHidden] = useState(false);
  const [borderless, setBorderless] = useState(false);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const layoutLock = useRef(false);
  const [page, setPage] = useState('browse');
  const pageRef = useRef('browse');
  const calendarRequest = useRef(0);
  const calendarOpeningRef = useRef(false);
  const [calendarOpening, setCalendarOpening] = useState('');
  const [visited, setVisited] = useState(['browse']);
  const [storageError, setStorageError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchSeed, setSearchSeed] = useState('');
  const [appInfo, setAppInfo] = useState(null); // { version, brand, appName }
  const [windowState, setWindowState] = useState({ maximized: false, comp: null });
  const handleWindowState = useCallback((patch) => {
    if (!patch) return;
    setWindowState(prev => ({ ...prev, ...patch }));
  }, []);
  const [playerMounted, setPlayerMounted] = useState(false);
  const floatingPlayer = useRef(false);
  const setFloatingPlayer = useCallback(value => { floatingPlayer.current = value; }, []);
  const [playerTarget, setPlayerTarget] = useState(null); // 浏览页点播 -> 播放页选中
  const rememberPlayerSeries = useCallback((seriesId) => {
    // 保留命令时间戳避免重复初始化；重新挂载时只按当前系列的最新断点恢复。
    setPlayerTarget(target => ({ seriesId, resume: true, autoplay: false, ts: target?.ts }));
  }, []);

  useEffect(() => {
    window.electronAPI.getWindowLayout?.().then(setLayout);
    window.electronAPI.getAlwaysOnTop?.().then(setAlwaysOnTop);
    window.electronAPI.getAppInfo().then((info) => {
      setAppInfo(info);
    });
  }, []);

  // Ctrl+K 全局搜索；输入框聚焦时不抢占。
  useEffect(() => {
    if (typeof window.addEventListener !== 'function') return undefined; // 测试桩无事件监听
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
        const target = event.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed(value => {
      try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? '0' : '1'); } catch { /* 仅本会话生效 */ }
      return !value;
    });
  };

  useEffect(() => window.electronAPI.onStorageError?.((data) => {
    setStorageError(data === null ? '' : data?.error || '数据保存失败，请检查磁盘空间和目录权限后重试。');
  }), []);

  // 主进程发来的导航指令（例如浏览页点「立即播放」）
  useEffect(() => {
    if (!window.electronAPI.onNavigate) return undefined;
    return window.electronAPI.onNavigate((data) => {
      if (!data || !data.page) return;
      if (data.payload) setPlayerTarget({ ...data.payload, ts: Date.now() });
      navigate(data.page);
    });
  }, []);

  const navigate = (nextPage) => {
    if (nextPage !== pageRef.current) {
      calendarRequest.current++;
      calendarOpeningRef.current = false;
      setCalendarOpening('');
      pageRef.current = nextPage;
    }
    if (nextPage === 'player' || (nextPage === 'feed' && !floatingPlayer.current)) setPlayerMounted(nextPage === 'player');
    setVisited((pages) => pages.includes(nextPage) ? pages : [...pages, nextPage]);
    setPage(nextPage);
  };

  const renderPage = (id) => {
    switch (id) {
      case 'browse':
        return <Browse active={page === id} onNavigate={navigate} />;
      case 'player':
        return playerMounted ? <Player portrait={layout === 'portrait'} episodesOpen={episodesOpen} setEpisodesOpen={setEpisodesOpen} actionsHidden={actionsHidden || (borderless && layout === 'portrait')} active={page === id} target={playerTarget} onSeriesSelected={rememberPlayerSeries} onFloatingChange={setFloatingPlayer} onNavigate={navigate} /> : null;
      case 'feed':
        return page === 'feed' ? <DramaFeed onNavigate={navigate} /> : null;
      case 'calendar':
        return <ReleaseCalendar opening={calendarOpening} active={page === id} onPlay={async ({ seriesId }) => {
          if (pageRef.current !== 'calendar' || calendarOpeningRef.current) return;
          const version = ++calendarRequest.current;
          calendarOpeningRef.current = true;
          setCalendarOpening(seriesId);
          try {
            const payload = { seriesId, resume: true };
            let result = await window.electronAPI.playSeries(payload);
            if (version !== calendarRequest.current) return;
            if (!result?.success && result?.code === 'SERIES_NOT_FOUND') {
              const resolved = await window.electronAPI.searchResolve(seriesId);
              if (version !== calendarRequest.current) return;
              if (!resolved?.success) throw new Error(resolved?.error || '加载剧集失败，请重试');
              result = await window.electronAPI.playSeries(payload);
            }
            if (!result?.success) throw new Error(result?.error || '打开播放失败，请重试');
          } catch (error) {
            if (version === calendarRequest.current) setStorageError(error.message);
          } finally {
            if (version === calendarRequest.current) { calendarOpeningRef.current = false; setCalendarOpening(''); }
          }
        }} />;
      case 'history':
        return <WatchHistory active={page === id} onNavigate={navigate} />;
      case 'account':
        return <AccountManagement active={page === id} />;
      case 'manager':
        return <DownloadManager active={page === id} onNavigate={navigate} />;
      case 'announcements':
        return <div className="settings-container">
          <div className="settings-header"><Megaphone size={22} /><div><h2>更新日志</h2><p className="page-description">检查新版本，查看每个版本更新了什么。</p></div></div>
          <section className="settings-card" aria-label="检测更新设置">
            {appInfo?.preview ? <p className="settings-hint">功能预览版不接收正式版更新。</p> : <UpdateCheckSettings />}
          </section>
          <section className="settings-card" aria-label="版本更新日志">
            <ReleaseNotesList />
          </section>
        </div>;
      case 'settings':
        return <SettingsPage active={page === id} preview={appInfo?.preview} appInfo={appInfo} />;
      case 'download':
      default:
        return <HongguoDownload active={page === id} onNavigate={navigate} seedTerm={searchSeed} />;
    }
  };

  const toggleLayout = async () => {
    if (layoutLock.current) return;
    layoutLock.current = true;
    setLayoutBusy(true);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      const mode = layout === 'portrait' ? 'landscape' : 'portrait';
      const result = await window.electronAPI.setWindowLayout(mode);
      if (!result.success) throw new Error(result.error);
      setLayout(result.mode);
    } catch (error) {
      setStorageError(error.message || '切换失败，请重试。');
    } finally {
      layoutLock.current = false;
      setLayoutBusy(false);
    }
  };

  const isMac = appInfo?.platform === 'darwin' || (!appInfo?.platform && /Mac/.test(navigator.platform));
  const currentPage = MENU.find((item) => item.id === page);

  return (
    <>
    <Backdrop />
    <div className={`app-shell ${windowState.maximized ? 'window-maximized' : ''}`}
      style={windowState.maximized && windowState.comp ? { '--titlebar-comp-x': `${windowState.comp.x}px`, '--titlebar-comp-y': `${windowState.comp.y}px` } : undefined}>
      {!isMac && <TitleBar appName={appInfo?.appName || '红果短剧'} onWindowState={handleWindowState} />}
      <div className={`app-layout ${stealthMode ? 'stealth-mode' : ''} ${isMac ? 'platform-mac' : ''} layout-${layout} ${page === 'player' ? 'player-focused' : ''} ${borderless && page === 'player' && layout === 'portrait' ? 'player-borderless' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} aria-label="主导航">
        <div className="sidebar-window-drag" aria-hidden="true" />
        <div className="sidebar-brand">
          <div className="logo"><img src={brandIcon} alt="" /></div>
          <div><div className="brand-text">{appInfo?.appName || '红果短剧'}</div><div className="brand-sub">{appInfo?.preview ? '独立体验 · 本机保存' : '每一集，都值得期待'}</div></div>
        </div>
        <nav className="sidebar-menu">
          <div className="sidebar-group-label">内容</div>
          {MENU.filter((item) => item.id !== 'settings').map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={`sidebar-item ${page === item.id ? 'active' : ''}`}
                aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
                <Icon size={19} /><span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <button className={`sidebar-item ${page === 'settings' ? 'active' : ''}`}
            aria-current={page === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}>
            <Settings size={19} /><span>设置</span>
          </button>
          <button className="sidebar-collapse-btn" onClick={toggleSidebarCollapsed}
            aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}>
            <PanelLeftIcon size={15} /><span>收起</span>
          </button>
          <div className="footer-note"><span>{appInfo?.preview ? '功能预览' : '红果短剧'}</span><span>{appInfo?.version ? `v${appInfo.version.replace(/^(\d+\.\d+)\.0$/, '$1')}` : ''}</span></div>
        </div>
      </aside>
      <div className="main-wrapper">
        <header className="window-toolbar">
          <span className="toolbar-location">{currentPage?.label}</span>
          {page === 'player' && layout === 'portrait' && <PageMenu items={MENU} page={page} onNavigate={navigate} />}
          <button className="toolbar-search" onClick={() => setPaletteOpen(true)} title="全局搜索（Ctrl+K）" aria-label="全局搜索" aria-keyshortcuts="Control+K">
            <Search size={14} /><span>搜索页面、剧集…</span><kbd>Ctrl K</kbd>
          </button>
          <div className="toolbar-actions">
            <span className="toolbar-caption">{appInfo?.preview ? '功能预览' : '红果短剧'}</span>
            {page === 'player' && <ToolbarMore>
              <button className="btn btn-outline btn-sm" onClick={() => { setEpisodesOpen(false); toggleStealth(true); }} title="小窗置顶播放并在支持的系统上跨虚拟桌面可见；鼠标移开时暂停隐藏，移回继续；Esc 退出">小窗模式</button>
              {layout === 'portrait' && <button className="btn btn-outline btn-sm portrait-episodes-toggle" aria-expanded={episodesOpen}
                aria-controls="player-episode-panel" onClick={() => setEpisodesOpen(open => !open)}>{episodesOpen ? '收起选集' : '选集'}</button>}
              <button className="btn btn-outline btn-sm player-actions-toggle" aria-pressed={actionsHidden || borderless && layout === 'portrait'}
                onClick={() => {
                  if (borderless && layout === 'portrait') { setBorderless(false); setActionsHidden(false); }
                  else setActionsHidden(hidden => !hidden);
                }}>{actionsHidden || borderless && layout === 'portrait' ? '显示按钮' : '隐藏按钮'}</button>
              {layout === 'portrait' && <button className="btn btn-outline btn-sm borderless-toggle" aria-pressed={borderless}
                onClick={() => setBorderless(value => !value)}>{borderless ? '恢复边框' : '去掉边框'}</button>}
              <button className="btn btn-outline btn-sm pin-toggle" aria-pressed={alwaysOnTop} disabled={pinBusy}
                aria-label={alwaysOnTop ? '取消置顶' : '置顶'} title={alwaysOnTop ? '取消置顶' : '置顶'}
                onClick={async () => {
                  setPinBusy(true);
                  try { setAlwaysOnTop(await window.electronAPI.setAlwaysOnTop(!alwaysOnTop)); }
                  catch { setStorageError('置顶切换失败，请重试。'); }
                  finally { setPinBusy(false); }
                }}><svg width="17" height="17" viewBox="0 0 24 24" fill={alwaysOnTop ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3h8l-1 6 4 4v2H5v-2l4-4-1-6Z" /><path d="M12 15v6" /></svg><span className="toolbar-action-label">{alwaysOnTop ? '取消置顶' : '置顶'}</span></button>
            </ToolbarMore>}
            <button className="btn btn-outline btn-sm layout-toggle" onClick={toggleLayout}
              disabled={layoutBusy} aria-pressed={layout === 'portrait'}
              aria-label={layout === 'portrait' ? '切换横屏版' : '切换竖屏版'}
              title={layout === 'portrait' ? '恢复横屏窗口与布局' : '切换竖屏窗口，放大竖屏视频'}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                {layout === 'portrait' ? <rect x="3" y="6" width="18" height="12" rx="2" /> : <rect x="6" y="3" width="12" height="18" rx="2" />}
              </svg>
              {layoutBusy ? '切换中…' : layout === 'portrait' ? '横屏版' : '竖屏版'}
            </button>
          </div>
        </header>
        <nav className="compact-navigation" aria-label="竖屏导航">
          {MENU.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} aria-current={page === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)} title={item.label}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </nav>
        {!appInfo?.preview && <AppUpdateNotice />}
        {stealthMode && <div className="stealth-toolbar"><span>移开暂停隐藏 · 移回继续</span><button className="btn btn-outline btn-sm" onClick={() => toggleStealth(false)}>退出小窗</button></div>}
        {stealthError && <div className="app-storage-error" role="alert">{stealthError}</div>}
        {storageError && <div className="app-storage-error" role="alert"><span>{storageError}</span><button className="btn btn-outline btn-sm" onClick={() => setStorageError('')}>关闭提示</button></div>}
        {visited.map((id) => <main className="main-content" data-page={id} hidden={page !== id} key={id}>{renderPage(id)}</main>)}
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)}
        onNavigate={navigate}
        onSearch={(term) => { setSearchSeed(`${term}#${Date.now()}`); navigate('download'); }} />
      </div>
    </div>
    </>
  );
}
