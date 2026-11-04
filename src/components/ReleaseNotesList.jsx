import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ExternalLink } from './icons';

// 轻量按行渲染发行说明：支持 #/## 小标题、- 列表、**粗体**；其余按普通段落。
// 远端内容只解析为 React 元素，不使用 HTML 注入。
export function renderNoteBody(body) {
  return String(body || '').split(/\r?\n/).map((line, index) => {
    const text = line.trim();
    if (!text) return null;
    const key = `l${index}`;
    if (/^#{1,6}\s/.test(text)) {
      return <p key={key} className="release-note-heading">{text.replace(/^#{1,6}\s/, '').replace(/\*\*/g, '')}</p>;
    }
    if (/^[-*]\s/.test(text)) {
      return <p key={key} className="release-note-item">{inline(text.replace(/^[-*]\s/, ''))}</p>;
    }
    if (/^\|/.test(text)) {
      return <p key={key} className="release-note-item">{inline(text.replace(/\|/g, ' ').replace(/\s{2,}/g, ' ').trim())}</p>;
    }
    return <p key={key} className="release-note-paragraph">{inline(text)}</p>;
  }).filter(Boolean);
}

function inline(text) {
  const parts = String(text).split(/\*\*([^*]+)\*\*/);
  return parts.map((part, index) => index % 2 === 1 ? <strong key={index}>{part}</strong> : part);
}

export default function ReleaseNotesList() {
  const [notes, setNotes] = useState(null); // null=加载中
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(null); // 非空=网络失败后回退到缓存内容 { fetchedAt }
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await window.electronAPI.getReleaseNotes();
      if (id !== request.current) return;
      if (!result?.success) throw new Error(result?.error || '更新日志读取失败，请稍后重试。');
      setNotes(result.notes || []);
      setStale(result.cached ? { fetchedAt: Number(result.fetchedAt) || 0 } : null);
    } catch (cause) {
      if (id === request.current) {
        setError(cause.message || '更新日志读取失败，请稍后重试。');
        setStale(null);
      }
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => { request.current++; };
  }, [load]);

  const openReleases = async () => {
    try {
      const result = await window.electronAPI.openExternalUrl('https://github.com/yuchen0x1/HongGuo-PC/releases');
      if (result?.success === false) throw new Error(result.error || '无法打开浏览器');
    } catch { /* 打开失败静默：入口按钮仍可重试 */ }
  };

  return <div className="settings-group release-notes">
    <span className="settings-label">更新日志</span>
    {notes === null && !error && <p className="settings-hint" role="status"><RefreshCw size={13} className="spin" /> 正在读取更新日志…</p>}
    {stale && <div role="status">
      <p className="settings-hint">网络不佳，显示上次同步的更新日志{stale.fetchedAt ? `（${new Date(stale.fetchedAt).toLocaleString()}）` : ''}。</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={load} disabled={loading}>重新同步</button>
    </div>}
    {error && <div role="alert">
      <p className="settings-hint">{error}</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={load} disabled={loading}>重新读取</button>
    </div>}
    {Array.isArray(notes) && notes.length === 0 && <p className="settings-hint">还没有已发布的更新日志。</p>}
    {Array.isArray(notes) && notes.map(release => <div className="release-note" key={release.version}>
      <div className="release-note-head">
        <span className="release-note-version">{release.version}</span>
        {release.name && release.name !== release.version && <span className="release-note-name">{release.name}</span>}
        {release.date && <span className="release-note-date">{release.date}</span>}
      </div>
      <div className="release-note-body">{renderNoteBody(release.body)}</div>
    </div>)}
    <button type="button" className="btn btn-outline btn-sm release-notes-link" onClick={openReleases}>
      <ExternalLink size={14} /> 在 GitHub 查看全部版本与下载
    </button>
  </div>;
}
