import React, { useCallback, useEffect, useRef, useState } from 'react';
import brandIcon from '../../build/icon.ico';
import './TitleBar.css';

// Windows 无边框窗口的自定义标题栏。macOS 由 App 不渲染本组件（保留 hiddenInset 原生交通灯）。
// 拖动由独立的 .titlebar-drag 层承担，该层在按钮区域之前终止（inset right 138px），
// 与按钮零重叠——避免依赖嵌套 no-drag 区域的抵扣计算；双击最大化用显式事件兜底。
export default function TitleBar({ appName = '红果短剧', onWindowState }) {
  const [maximized, setMaximized] = useState(false);
  const stateRef = useRef(false);

  const report = useCallback(next => {
    stateRef.current = !!next;
    setMaximized(!!next);
    onWindowState?.({ maximized: !!next });
  }, [onWindowState]);

  useEffect(() => {
    let active = true;
    window.electronAPI?.windowIsMaximized?.().then(value => { if (active) report(value); }).catch(() => {});
    const offMaximize = window.electronAPI?.onWindowMaximizeChanged?.(value => report(value));
    return () => { active = false; offMaximize?.(); };
  }, [report]);

  // 无边框窗口在 Windows 上最大化会比工作区大出约 16px，按实测溢出量补偿内边距，
  // 保证右侧控制按钮和左缘内容不被屏幕裁掉；量不到时交给 CSS 的 8px 兜底。
  useEffect(() => {
    if (!maximized) { onWindowState?.({ comp: null }); return undefined; }
    const measure = () => {
      try {
        const screen = window.screen;
        if (!screen || !Number.isFinite(screen.availWidth) || !Number.isFinite(window.outerWidth)) { onWindowState?.({ comp: null }); return; }
        const comp = {
          x: Math.min(12, Math.max(0, Math.round((window.outerWidth - screen.availWidth) / 2))),
          y: Math.min(12, Math.max(0, Math.round((window.outerHeight - screen.availHeight) / 2))),
        };
        onWindowState?.({ comp: comp.x || comp.y ? comp : null });
      } catch { onWindowState?.({ comp: null }); }
    };
    const timer = setTimeout(measure, 80);
    const onResize = () => { if (stateRef.current) measure(); };
    if (typeof window.addEventListener === 'function') window.addEventListener('resize', onResize);
    return () => { clearTimeout(timer); if (typeof window.removeEventListener === 'function') window.removeEventListener('resize', onResize); };
  }, [maximized, onWindowState]);

  // 实测：紧随鼠标事件的窗口状态变更（最小化/最大化/还原）会被 Windows 吞掉，
  // 延迟一拍让输入事件彻底收尾后再执行。
  const deferRun = useCallback(fn => {
    setTimeout(() => fn(), 120);
  }, []);
  const toggleMaximize = useCallback(() => deferRun(() => window.electronAPI?.windowToggleMaximize?.()), [deferRun]);
  const minimizeWindow = useCallback(() => deferRun(() => window.electronAPI?.windowMinimize?.()), [deferRun]);
  const closeWindow = useCallback(() => deferRun(() => window.electronAPI?.windowClose?.()), [deferRun]);

  return (
    <header className={`titlebar ${maximized ? 'is-maximized' : ''}`} aria-label="窗口标题栏">
      <div className="titlebar-drag" aria-hidden="true" onDoubleClick={toggleMaximize} />
      <div className="titlebar-brand">
        <span className="titlebar-logo" aria-hidden="true"><img src={brandIcon} alt="" /></span>
        <span className="titlebar-name">{appName}</span>
      </div>
      <div className="titlebar-space" aria-hidden="true" />
      <div className="titlebar-controls">
        <button type="button" className="titlebar-btn" aria-label="最小化" title="最小化"
          onClick={minimizeWindow}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" /></svg>
        </button>
        <button type="button" className="titlebar-btn titlebar-max" aria-label={maximized ? '向下还原' : '最大化'}
          title={maximized ? '向下还原' : '最大化'} onClick={toggleMaximize}>
          <svg className="icon-max" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" rx="1.5" /></svg>
          <svg className="icon-restore" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="2.5" width="7" height="7" rx="1.5" /><path d="M3 2.5v-2h6.5V7H7.5" /></svg>
        </button>
        <button type="button" className="titlebar-btn titlebar-close" aria-label="关闭" title="关闭"
          onClick={closeWindow}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></svg>
        </button>
      </div>
    </header>
  );
}
