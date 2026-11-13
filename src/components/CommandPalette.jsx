import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Home, Film, Search, Play, Clock, Bookmark, Download, User, Settings, Megaphone, Clock as ClockIcon, Heart, X } from './icons';
import { readSearchHistory } from '../searchHistory';
import { readLocalLibrary } from '../localLibrary';

const PAGES = [
  ['browse', '发现短剧', Home],
  ['feed', '热播推荐', Film],
  ['download', '搜索与下载', Search],
  ['player', '我的剧库', Play],
  ['history', '观看记录', Clock],
  ['calendar', '收藏与上新', Bookmark],
  ['manager', '下载管理', Download],
  ['account', '红果账号', User],
  ['announcements', '更新日志', Megaphone],
  ['settings', '设置', Settings],
];

function matches(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * CommandPalette —— Ctrl+K 全局搜索。
 * 只汇总真实数据：应用内导航、本机观看记录、本机剧库、搜索历史。
 * 选中搜索历史词条会跳到「搜索与下载」并自动执行该次搜索。
 */
export default function CommandPalette({ open, onClose, onNavigate, onSearch }) {
  const [term, setTerm] = useState('');
  const [historyRows, setHistoryRows] = useState([]);
  const [library, setLibrary] = useState({ items: [] });
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setTerm('');
    setActive(0);
    try { setLibrary(readLocalLibrary()); } catch { /* 面板仍提供导航 */ }
    window.electronAPI?.getWatchHistory?.().then(result => {
      setHistoryRows(result?.success && Array.isArray(result.results) ? result.results : []);
    }).catch(() => {});
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open]);

  const query = term.trim();
  const results = useMemo(() => {
    if (!query) {
      return [
        { kind: 'group', label: '页面' },
        ...PAGES.map(([id, label, Icon]) => ({ kind: 'page', id, label, Icon })),
        ...(historyRows.length ? [{ kind: 'group', label: '最近观看' }, ...historyRows.slice(0, 4).map(row => ({ kind: 'history', row }))] : []),
        ...(library.items.length ? [{ kind: 'group', label: '本机剧库' }, ...library.items.slice(0, 4).map(item => ({ kind: 'library', item }))] : []),
        ...(readSearchHistory().length ? [{ kind: 'group', label: '搜索历史' }, ...readSearchHistory().slice(0, 4).map(value => ({ kind: 'term', value }))] : []),
      ];
    }
    const pages = PAGES.filter(([, label]) => matches(label, query)).map(([id, label, Icon]) => ({ kind: 'page', id, label, Icon }));
    const history = historyRows.filter(row => matches(row.series_title || '', query)).slice(0, 4).map(row => ({ kind: 'history', row }));
    const lib = library.items.filter(item => matches(item.title || '', query)).slice(0, 4).map(item => ({ kind: 'library', item }));
    const terms = readSearchHistory().filter(value => matches(value, query)).slice(0, 4).map(value => ({ kind: 'term', value }));
    return [
      ...(pages.length ? [{ kind: 'group', label: '页面' }, ...pages] : []),
      ...(terms.length ? [{ kind: 'group', label: '搜索“' + query + '”' }, ...terms] : [{ kind: 'term', value: query }]),
      ...(history.length ? [{ kind: 'group', label: '最近观看' }, ...history] : []),
      ...(lib.length ? [{ kind: 'group', label: '本机剧库' }, ...lib] : []),
    ];
  }, [query, historyRows, library]);

  const selectable = useMemo(() => results.filter(item => item.kind !== 'group'), [results]);
  useEffect(() => { setActive(current => Math.min(current, Math.max(0, selectable.length - 1))); }, [selectable.length]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  const run = useCallback((item) => {
    if (!item) return;
    if (item.kind === 'page') { onNavigate(item.id); onClose(); return; }
    if (item.kind === 'history') { onNavigate('history'); onClose(); return; }
    if (item.kind === 'library') { onNavigate('calendar'); onClose(); return; }
    if (item.kind === 'term') { onSearch(item.value); onClose(); }
  }, [onNavigate, onSearch, onClose]);

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => Math.min(i + 1, selectable.length - 1)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(i - 1, 0)); return; }
    if (event.key === 'Enter') { event.preventDefault(); run(selectable[active]); }
  };

  if (!open) return null;
  let selectableIndex = -1;
  return <div className="command-palette-mask" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="command-palette" role="dialog" aria-modal="true" aria-label="全局搜索" onKeyDown={onKeyDown}>
      <div className="command-palette-input-row">
        <Search size={17} />
        <input ref={inputRef} className="command-palette-input" placeholder="搜索页面、剧集或历史记录…"
          value={term} onChange={(event) => { setTerm(event.target.value); setActive(0); }} aria-label="搜索" />
        <kbd>Esc</kbd>
      </div>
      <div className="command-palette-list" ref={listRef} role="listbox" aria-label="搜索结果">
        {!selectable.length && <div className="command-empty">{query ? `没有找到与「${query}」相关的内容` : '输入关键词，或直接选择页面'}</div>}
        {results.map((item, index) => {
          if (item.kind === 'group') return <div className="command-group-label" key={`g:${item.label}:${index}`}>{item.label}</div>;
          selectableIndex++;
          const itemIndex = selectableIndex;
          const isSelected = itemIndex === active;
          return <button key={`${item.kind}:${item.id || item.row?.series_id || item.item?.id || item.value}:${index}`}
            className={`command-item ${isSelected ? 'active' : ''}`} aria-selected={isSelected} role="option"
            onMouseEnter={() => setActive(itemIndex)} onClick={() => run(item)}>
            {item.kind === 'page' && <item.Icon size={16} />}
            {item.kind === 'history' && <ClockIcon size={16} />}
            {item.kind === 'library' && <Heart size={16} />}
            {item.kind === 'term' && <Search size={16} />}
            <span>{item.kind === 'page' ? item.label
              : item.kind === 'history' ? item.row.series_title
              : item.kind === 'library' ? item.item.title
              : item.value}</span>
            {item.kind === 'history' && <span className="command-item-meta">第 {item.row.vid_index} 集 / {item.row.total} 集</span>}
          </button>;
        })}
      </div>
      <div className="command-palette-foot"><kbd>↑↓</kbd><span>选择</span><kbd>↵</kbd><span>打开</span><kbd>Esc</kbd><span>关闭</span></div>
    </div>
  </div>;
}
