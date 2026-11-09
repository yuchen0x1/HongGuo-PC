# 红果短剧 6.6

状态：源码发行目标（内部版本 `6.6.0`，预期标签 `v6.6`）。本版修复浅色主题下的深色控件残留问题，正式发行仅维护 Windows x64。当前工作区已完成修复与验证，尚未创建提交、标签或 GitHub Release。

## 修复内容

### 浅色主题控件

- 修复外观切换为“浅色”后，外观下拉框仍显示深色背景的问题。
- 修复海报大小下拉框仍显示深色背景的问题。
- 将 Cyber HUD 深色输入框和聚焦样式限定在 `data-theme="dark"` 下，浅色主题恢复浅色输入背景、边框与文字。
- 保留深色主题的输入框玻璃拟态效果，不影响深色模式视觉设计。

## 验证

- `node scripts/check-window-layout.cjs`：通过窗口布局、外观偏好及新增主题 CSS 作用域检查。
- `node scripts/check-release-version.cjs`：通过 2025 组版本比较与 6.6 版本一致性检查。
- `npm run build:react`：通过；Vite 仅提示现有大 chunk 优化建议。
- `npm test`：通过，单元测试与 101 项平台检查全部通过。
- `npx electron-builder --win --x64 --publish never --config.directories.output=dist-6.6`：通过，生成 6.6.0 Windows x64 安装包；使用独立输出目录避开旧版 `dist/win-unpacked` 清理保护。
- `npm audit`：本轮未执行。

## 发布边界

- 本版尚未创建 `v6.6` 标签或 GitHub Release。
- Windows x64 安装包与便携版需通过现有候选构建和发布流水线生成。
- Windows EXE 当前仍不配置代码签名。
