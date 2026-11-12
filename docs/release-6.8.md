# 红果短剧 6.8

状态：源码／发行目标（内部版本 `6.8.0`，目标标签 `v6.8`）。正式 Release 需以同一提交上的 Test、Windows x64 release candidate 和发布流水线结果为准；本文件将在公开发布后补充冻结提交、Actions 回执、资产大小与摘要。

## 本轮改动

### 稳定性与安全修复

- 下载队列、取消、重试、路径去重和 NAS 任务状态修复，避免重复任务、错误恢复和记录不同步。
- 本地媒体协议、符号链接、路径越界、下载目录误识别和 NAS 删除路径增加边界校验。
- 播放器切集首帧、卡顿恢复、渲染副作用和兼容缓存命名修复，降低黑屏、卡死和错误复用。
- API、网页、搜索响应增加大小限制；弹幕身份文件损坏时原子恢复；搜索排序、存储和退出清理回归修复。

### 应用内自动更新

- 正式 Windows x64 NSIS 安装版恢复 `electron-updater` 检查、用户确认下载、进度展示、SHA-512 校验和“重启并安装”。
- 下载、合并、转码、在线准备、设置保存或维护操作进行时阻止安装，避免退出过程中丢数据。
- 开发版、预览版、便携版和非 Windows 运行环境回退到 GitHub Releases 页面；已发布的 v6.7 安装包保持原有“提醒 + 下载页”行为。
- 每个 Release 必须同时提供安装 EXE 与由最终 EXE 字节生成的 `latest.yml`；不发布便携包、blockmap、普通源码 ZIP 或 hash 清单。

## 发行形态

- 目标平台：Windows x64。
- 普通用户资产：`hongguo-downloader-6.8-win-x64-setup.exe` 与 `latest.yml`。
- Windows 安装器当前未配置代码签名证书，正式回执必须明确标记为未签名。
- GPL FFmpeg/x264 对应源码归档作为许可证文档放入安装目录，不另列为 Release 下载资产。

## 本地验证

候选提交已执行或将在版本更新后执行：

- `npm test`
- `npm run build:react`
- `node --check main.js`
- `node --check preload.js`
- `node scripts/check-release-version.cjs`
- `node scripts/check-app-update.cjs`
- `node scripts/check-app-update-installer.cjs`
- `node scripts/check-app-update-proxy.cjs`
- `node scripts/check-app-update-ui.cjs`
- `git diff --check`

本地检查不等于 GitHub Actions、Windows 安装器、真实 Release 下载或跨版本应用内升级已验证。真实媒体 GUI 验收仍须使用独立目录中的随机真实红果下载素材，全程静音，不使用彩条视频。

## 发布门槛

1. 将同一提交推送到 `main` 并创建 `v6.8` 标签。
2. 等待源码 Test 与 Windows x64 release candidate 成功。
3. 核对候选安装包、`latest.yml`、版本、大小、SHA-512、未签名状态和许可证对应源码。
4. 手动运行 `Publish validated Windows release`，仅公开安装 EXE 与 `latest.yml`。
5. 回读 GitHub Release，确认标签、资产数量、文件名、大小和 `latest.yml` 摘要。

## 限制

- 本机不能替代 GitHub Actions Windows x64 安装、真实 Release 下载和旧版本升级验收。
- v6.7 已发布安装包不包含本轮自动下载／安装代码，不能通过改写历史资产实现升级。
- 当前 Windows EXE 未签名，SmartScreen 可能提示未知发布者。
