import React, { useMemo } from 'react';

// 深空背景层：深空渐变底、极淡科技网格、红/蓝/紫环境光、少量漂浮微粒。
// 纯 CSS 合成器动画（transform/opacity），微粒数量有上限，减少动效偏好下全部静止。
const DUST_COUNT = 26;

export default function Backdrop() {
  const dust = useMemo(() => Array.from({ length: DUST_COUNT }, (_, i) => ({
    left: (i * 97) % 100,
    delay: -(i * 1.7) % 26,
    duration: 20 + ((i * 13) % 18),
    size: i % 5 === 0 ? 4 : 2 + (i % 2),
    opacity: .16 + ((i * 7) % 20) / 100,
  })), []);
  return <div className="cyber-backdrop" aria-hidden="true">
    <div className="cyber-backdrop-glow red" />
    <div className="cyber-backdrop-glow blue" />
    <div className="cyber-backdrop-glow violet" />
    <div className="cyber-backdrop-grid" />
    <div className="cyber-backdrop-dust">
      {dust.map((item, i) => <span key={i} style={{
        left: `${item.left}%`,
        bottom: '-4vh',
        width: item.size,
        height: item.size,
        animationDelay: `${item.delay}s`,
        animationDuration: `${item.duration}s`,
        '--dust-opacity': item.opacity,
      }} />)}
    </div>
  </div>;
}
