// 红果短剧 6.0：界面入口；启动画面、深空背景与验证范围见 docs（发布时补充）。
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import SplashScreen, { shouldPlaySplash } from './components/SplashScreen';
import './index.css';
import { initializePosterSize } from './theme';

initializePosterSize();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// 启动画面独立于主 UI 渲染：主界面在其下方并行准备，动画结束仅移除覆盖层。
// shouldPlaySplash 用会话标记保证单次启动只播一次（刷新/热更新不重播）。
if (shouldPlaySplash()) {
  try {
    const host = document.createElement('div');
    host.dataset.splashHost = '';
    document.body.appendChild(host);
    const splashRoot = ReactDOM.createRoot(host);
    splashRoot.render(<SplashScreen onDone={() => { splashRoot.unmount(); host.remove(); }} />);
  } catch { /* 启动画面任何异常都不阻塞主界面 */ }
}
