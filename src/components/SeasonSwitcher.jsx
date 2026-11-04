import React, { useEffect, useRef, useState } from 'react';
import './SeasonSwitcher.css';

// 选集页的「同系列各季」切换行：主进程按族归组后一次性返回各季；查不到或只有本季就整体隐藏。
export default function SeasonSwitcher({ seriesId, onPick }) {
  const [seasons, setSeasons] = useState([]);
  const request = useRef(0);

  useEffect(() => {
    const version = ++request.current;
    setSeasons([]);
    if (!seriesId) return undefined;
    (async () => {
      try {
        const res = await window.electronAPI.findSeriesSeasons(seriesId);
        if (version !== request.current) return;
        if (res?.success && Array.isArray(res.seasons)) setSeasons(res.seasons);
      } catch { /* 查询失败保持隐藏，不打扰选集 */ }
    })();
    return () => { request.current++; };
  }, [seriesId]);

  const others = seasons.filter((season) => !season.is_current);
  if (!others.length) return null;
  return (
    <div className="season-switcher" role="group" aria-label="同系列各季">
      <span className="season-switcher-label">同系列</span>
      {seasons.map((season) => (
        <button
          key={season.series_id}
          type="button"
          className={`btn-chip season-chip${season.is_current ? ' season-current' : ''}`}
          title={season.series_title}
          disabled={season.is_current}
          aria-current={season.is_current ? 'true' : undefined}
          onClick={() => onPick?.(season)}
        >
          {season.label || season.series_title}
        </button>
      ))}
    </div>
  );
}
