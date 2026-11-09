# 红果短剧 6.6

状态：已正式发布（内部版本 `6.6.0`，标签 `v6.6`，冻结源码 `1c05226a098fbfd65a44234135c64e6798daf5de`）。发布日期：2026-11-09。Release：https://github.com/yuchen0x1/HongGuo-PC/releases/tag/v6.6。仅维护 Windows x64。

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

## Windows 发行资产

正式 Release 共 8 项资产：

- `hongguo-downloader-6.6-win-x64-setup.exe` 与 `.blockmap`
- `hongguo-downloader-6.6-win-x64.exe` 与 `.zip`（便携版）
- `latest.yml`
- `hongguo-downloader-6.6-windows-source.zip`
- `ffmpeg-9.0.2-x264-b35605a-win-x64-corresponding-source.tar.gz`
- `WINDOWS-SHA256SUMS.txt`

## 发布回执

- 标签对应源码 Test：https://github.com/yuchen0x1/HongGuo-PC/actions/runs/42572194121，成功。
- Windows x64 release candidate：https://github.com/yuchen0x1/HongGuo-PC/actions/runs/42572194210，成功；源码检查、FFmpeg 解析、便携构建、安装/重装、真实 1.80 升级资料保留检查及资产组装均通过。
- 发布流水线：https://github.com/yuchen0x1/HongGuo-PC/actions/runs/42574696892，成功；已校验总 SHA-256 清单、上传 8 项资产并公开 Release。
- GitHub Release `v6.6` 已公开：https://github.com/yuchen0x1/HongGuo-PC/releases/tag/v6.6。

## 限制

- Windows 安装器及便携 EXE 未签名，SmartScreen 可能提示未知发布者。
- macOS 不属于 6.6 或未来发行范围。
