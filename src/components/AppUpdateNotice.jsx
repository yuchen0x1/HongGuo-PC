import React, { useEffect, useRef, useState } from 'react';
import { X } from './icons';
import './AppUpdateNotice.css';

export default function AppUpdateNotice() {
  const [release, setRelease] = useState(null);
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [latest, setLatest] = useState(false);
  const enabled = useRef(true);
  const checkPending = useRef(false);
  const dismissed = useRef(new Set());
  const checkNow = useRef(null);

  useEffect(() => {
    let generation = 0, active = true;
    const check = async (manual = false) => {
      if (manual) { setVisible(true); setError(''); }
      if (checkPending.current) return;
      checkPending.current = true;
      const request = ++generation;
      setChecking(true);
      try {
        const result = await window.electronAPI.checkAppUpdate();
        if (!active || request !== generation) return;
        enabled.current = result?.enabled === true;
        if (!enabled.current) {
          setRelease(null);
          setLatest(false);
          if (manual) setError(result?.error || '更新检测已关闭，请在设置中开启并保存后重试。');
          else setVisible(false);
          return;
        }
        if (result.error) {
          setRelease(null);
          setLatest(false);
          setError(result.error || '检查更新失败，请检查网络后重试。');
          setVisible(true);
          return;
        }
        setError('');
        setRelease(result.release || null);
        setLatest(!result.release);
        if (result.release && !dismissed.current.has(result.release.version)) setVisible(true);
        else if (manual) setVisible(true);
      } catch {
        if (active && request === generation) {
          setRelease(null);
          setLatest(false);
          setError('检查更新失败，请检查网络后重试。');
          setVisible(true);
        }
      } finally {
        if (active && request === generation) { checkPending.current = false; setChecking(false); }
      }
    };
    checkNow.current = check;
    const manualCheck = () => check(true);
    window.addEventListener('hongguo-check-app-update', manualCheck);
    const unsubscribePreference = window.electronAPI.onAppUpdatePreference(value => {
      generation++;
      checkPending.current = false;
      setChecking(false);
      enabled.current = value;
      if (value) check();
      else { setVisible(false); setError(''); setRelease(null); setLatest(false); }
    });
    check();
    const timer = setInterval(() => check(), 6 * 60 * 60 * 1000);
    return () => {
      active = false;
      generation++;
      checkNow.current = null;
      clearInterval(timer);
      window.removeEventListener('hongguo-check-app-update', manualCheck);
      unsubscribePreference();
    };
  }, []);

  const close = () => {
    if (release) dismissed.current.add(release.version);
    setVisible(false);
    setError('');
  };
  const openRelease = async () => {
    if (!enabled.current) return;
    setError('');
    try {
      const result = await window.electronAPI.openAppUpdate();
      if (!result?.success && enabled.current) setError(result?.error || '无法打开发布页，请稍后重试。');
    } catch {
      if (enabled.current) setError('无法打开发布页，请稍后重试。');
    }
  };

  if (!visible) return null;
  const title = checking ? '正在检查更新…' : release ? `发现新版本 v${release.version}` : latest ? '已是最新版本' : '检查更新';
  return <section className="app-update-notice" role="dialog" aria-label="软件更新" aria-describedby="app-update-description" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <button type="button" className="icon-btn app-update-close" aria-label="关闭更新提醒" title="关闭更新提醒" onClick={close}><X size={18} /></button>
    <h2 aria-live="polite">{title}</h2>
    <p id="app-update-description">{checking ? '正在查询正式版更新，请稍候。' : release ? '打开最新版 GitHub Release 页面。请先退出应用，再下载并运行唯一安装包。' : latest ? '当前已是最新版本。' : '检查更新失败，请检查网络连接后重试。'}</p>
    <div className="app-update-actions">
      {release && <button type="button" className="btn btn-primary" disabled={checking || !enabled.current} onClick={openRelease}>打开下载页</button>}
      {error && !checking && <button type="button" className="btn btn-outline" onClick={() => checkNow.current?.(true)}>重新检查</button>}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
