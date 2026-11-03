import React, { useEffect, useMemo, useRef, useState } from 'react';
import './splash.css';

const SPLASH_SESSION_KEY = 'hongguo:splash:v6-played';
// 时序：阶段动画由 CSS delay 驱动；这里只控制阶段状态与真实初始化的汇合。
const PHASE_TIMELINE = [
  { at: 200, phase: 'space' },      // 黑暗空间：粒子 + 网格渐显
  { at: 500, phase: 'converge' },   // 能量汇聚：能量线 + 核心
  { at: 1450, phase: 'brand' },     // 品牌出现：Logo 成形 + 环形扫描
  { at: 1900, phase: 'boot' },      // 系统初始化：真实状态 + 进度
];
const MIN_DISPLAY_MS = 2950;  // 保证阶段动画完整播放
const HARD_CAP_MS = 8500;     // 初始化卡死时的兜底退出
const STEP_TIMEOUT_MS = 3500; // 单个真实步骤的等待上限

function withTimeout(promise, ms) {
  return Promise.race([
    promise.then(value => ({ ok: true, value })).catch(error => ({ ok: false, error })),
    new Promise(resolve => setTimeout(() => resolve({ ok: false, timedOut: true }), ms)),
  ]);
}

export function shouldPlaySplash() {
  try {
    if (window.__hongguoSplashPlayed) return false;
    if (window.sessionStorage.getItem(SPLASH_SESSION_KEY)) return false;
    window.sessionStorage.setItem(SPLASH_SESSION_KEY, '1');
    window.__hongguoSplashPlayed = true;
    return true;
  } catch {
    // 存储不可用时仍播放一次；模块级标记防 HMR 重复
    if (window.__hongguoSplashPlayed) return false;
    window.__hongguoSplashPlayed = true;
    return true;
  }
}

const STEPS = [
  { key: 'render', label: '渲染环境' },
  { key: 'bridge', label: '连接主进程' },
  { key: 'settings', label: '本机设置' },
  { key: 'library', label: '本机剧库' },
];

/**
 * SplashScreen —— v6 启动画面。
 * 阶段动画纯 CSS；「系统初始化」阶段执行真实任务（渲染环境/主进程连接/本机设置/本机剧库），
 * 每步有超时上限，失败显示「已跳过」不阻塞进入主界面。
 */
export default function SplashScreen({ onDone }) {
  const [phase, setPhase] = useState('space');
  const [stepState, setStepState] = useState(() => STEPS.map(() => 'pending'));
  const [leaving, setLeaving] = useState(false);
  const finished = useRef(false);
  // maybeFinish 需要读到最新步骤状态；用 ref 镜像。
  const stepStateRef = useRef(stepState);
  stepStateRef.current = stepState;

  const dust = useMemo(() => Array.from({ length: 42 }, (_, i) => ({
    left: (i * 89) % 100,
    delay: -(i * 1.3) % 22,
    duration: 16 + ((i * 11) % 14),
    burstX: ((i * 53) % 160) - 80,
    burstY: -60 - ((i * 37) % 140),
  })), []);

  useEffect(() => {
    const timers = PHASE_TIMELINE.map(({ at, phase: next }) => setTimeout(() => setPhase(next), at));
    const startedAt = Date.now();

    // 真实初始化：逐级推进；每一步都是真实 IPC/本地读取，超时则跳过。
    (async () => {
      const runStep = async (index, task) => {
        setStepState(current => current.map((v, i) => (i === index ? 'active' : v)));
        const result = await withTimeout(task(), STEP_TIMEOUT_MS);
        setStepState(current => current.map((v, i) => (i === index ? (result.ok ? 'done' : 'skip') : v)));
        return result.ok;
      };
      await runStep(0, async () => { document.documentElement.dataset.theme || initializeFallbackTheme(); });
      await runStep(1, () => window.electronAPI?.getAppInfo?.() ?? Promise.reject(new Error('unavailable')));
      await runStep(2, () => window.electronAPI?.getSettings?.() ?? Promise.reject(new Error('unavailable')));
      await runStep(3, () => window.electronAPI?.getSeriesList?.() ?? Promise.reject(new Error('unavailable')));
    })();

    const maybeFinish = setInterval(() => {
      if (finished.current) return;
      const elapsed = Date.now() - startedAt;
      const allSettled = stepStateRef.current.every(state => state !== 'pending');
      if ((elapsed >= MIN_DISPLAY_MS && allSettled) || elapsed >= HARD_CAP_MS) {
        finished.current = true;
        clearInterval(maybeFinish);
        setLeaving(true);
        setTimeout(() => onDone?.(), 620);
      }
    }, 120);

    return () => { timers.forEach(clearTimeout); clearInterval(maybeFinish); };
  }, [onDone]);

  const doneCount = stepState.filter(state => state === 'done').length;
  const skipCount = stepState.filter(state => state === 'skip').length;
  const progress = Math.round(((doneCount + skipCount) / STEPS.length) * 100);
  const activeLabel = STEPS[stepState.indexOf('active')]?.label;

  return <div className={`splash-screen ${leaving ? 'leaving' : ''}`} role="presentation" aria-hidden={leaving || undefined}>
    <div className="splash-particles" aria-hidden="true">
      {dust.map((item, i) => <span key={i} style={{
        left: `${item.left}%`,
        bottom: '-4vh',
        animationDelay: `${item.delay}s`,
        animationDuration: `${item.duration}s`,
        '--burst-x': `${item.burstX}px`,
        '--burst-y': `${item.burstY}px`,
      }} />)}
    </div>
    <div className="splash-grid" aria-hidden="true" />
    <div className="splash-core" aria-hidden="true">
      <div className="splash-lines"><i /><i /><i /><i /><i /></div>
      {phase !== 'space' && <div className="splash-core-glow" />}
      <div className="splash-orbit" />
      <div className="splash-orbit inner" />
      <div className="splash-logo">
        <div className="splash-logo-mark">
          <div className="splash-scanline" />
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5z" /></svg>
        </div>
        <div className="splash-title">
          <span className="splash-title-en">Red Fruit</span>
          <span className="splash-title-zh">红果短剧</span>
        </div>
      </div>
    </div>
    <div className="splash-boot" aria-hidden="true">
      <div className="splash-boot-status">{activeLabel ? <><b>{activeLabel}</b>…</> : progress >= 100 ? '就绪' : '正在启动'}</div>
      <div className="splash-boot-bar"><div className="splash-boot-fill" style={{ width: `${progress}%` }} /></div>
      <div className="splash-boot-steps">
        {STEPS.map((step, i) => <span key={step.key} className={stepState[i]}>{step.label}</span>)}
      </div>
    </div>
  </div>;
}

// 极端情况兜底：主 UI 尚未写入主题时保证启动画面之后界面可读。
function initializeFallbackTheme() {
  try {
    const stored = window.localStorage.getItem('hongguo-experience-preview:theme');
    const dark = stored ? stored === 'dark' : true;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch { document.documentElement.dataset.theme = 'dark'; }
}
