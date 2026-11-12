# 红果短剧 6.8

状态：已正式发布（内部版本 `6.8.0`，公开标签 `v6.8`）。冻结提交 `ba3e5f8b43480ab9d6dba90d8689586f81da8532`；GitHub Release 于 2026-11-12 04:57:05 UTC 创建，最终资产于 2026-11-12 05:22:59 UTC 完成公开。Release：[v6.8](https://github.com/yuchen0x1/HongGuo-PC/releases/tag/v6.8)。

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

## 验证回执

以下检查已在冻结提交上通过：

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

GitHub Actions 回执：

- Test：运行 `43156330948`，成功。
- Windows x64 release candidate：运行 `43156330956`，成功；包含 FFmpeg/x264、NSIS 安装、重装及真实 1.80 升级资料保留验收。

公开 Release 资产：

- `hongguo-downloader-6.8-win-x64-setup.exe`：146,473,098 字节；SHA-256 `cafcfad3ff98f83a10033929ce57be5f5a46ea8ae026f6f927b175a6bf0ac6cd`。
- `latest.yml`：377 字节；公开下载回读 SHA-256 `18d7134136cdcb36dd54569bae6ee86e5f726e6983086ffc29e41d3ae3055b3b`；其中安装包 SHA-512 与大小均与最终 EXE 一致。
- Windows 安装器未签名；未对外宣称代码签名已完成。

本地检查不等于 Windows 安装器实机安装或跨版本应用内升级已验证；公开 Release 下载与元数据回读已单独完成。真实媒体 GUI 验收仍须使用独立目录中的随机真实红果下载素材，全程静音，不使用彩条视频。

## 发布记录

1. 同一提交已推送到 `main`，标签 `v6.8` 未改写。
2. Test 与 Windows x64 release candidate 均成功。
3. 已核对最终安装包、`latest.yml`、版本、大小、SHA-512、未签名状态和许可证对应源码。
4. 已通过 GitHub Release 页面公开安装 EXE 与 `latest.yml`。
5. 已回读公开下载地址，确认标签、资产文件名、大小和 `latest.yml` 摘要。

## 限制

- 本机不能替代真实红果 GUI 播放验收；本轮未把该项写成已通过。发布包下载与元数据回读已完成，旧版本资料保留验收由 Windows x64 release candidate 覆盖。
- v6.7 已发布安装包不包含本轮自动下载／安装代码，不能通过改写历史资产实现升级。
- 当前 Windows EXE 未签名，SmartScreen 可能提示未知发布者。
