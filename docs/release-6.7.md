# 红果短剧 6.7

状态：发布候选（内部版本 `6.7.0`，标签 `v6.7`）。正式发行仅面向 Windows x64，唯一普通用户下载资产为 NSIS Windows x64 安装 EXE。

## 本轮改动

### 发行形态

- Release 只提供一个普通用户下载资产：`hongguo-downloader-6.7-win-x64-setup.exe`。
- 不再发布便携 EXE、便携 ZIP、应用源码 ZIP、blockmap、`latest.yml` 或 SHA-256 清单；GitHub 自动生成的 Source code 快照由平台保留。
- 应用内更新只检查正式版本、提醒并打开固定的 GitHub Releases 页面，不再在应用内下载、取消或安装更新；相关 IPC、preload 桥接与安装器状态 UI 一并移除。
- GPL FFmpeg/x264 对应源码归档作为许可证文档随安装程序放入安装目录根部（`FFmpeg-Corresponding-Source.tar.gz`），不列为第二个下载资产。

### 缺陷修复

- 下载目录误识别防护：目录扫描兜底增加剧名归属校验，避免「花絮2.mp4」等文件被当成第 2 集参与合并或看完自动删除。
- 退出保存安全：退出流程纳入进行中的设置保存与删除/维护操作，避免「文件已删、任务记录还在」或设置丢失。
- 播放卡顿恢复：缓冲遮罩 10 秒后提示片源无响应并给出「重试本集」；首帧保持 4 秒未上屏时释放，避免画面永久冻结在上一集最后一帧。
- 切集首帧保护：切集与自动连播保留上一集最后一帧，直到新片源首帧真正上屏。
- Ctrl+K 搜索：搜索种子到达时切回「搜索剧集」页签，避免搜索在隐藏面板执行。
- 浅色主题下拉框：主题输入框改用 `background-color`，保留单次不重复的自定义箭头。

## 验证

- `npm test`：通过，单元测试与 102 项平台检查全部通过。
- `node scripts/check-release-version.cjs`：通过 2116 组版本比较与 6.7 版本一致性检查。
- `npm run build:react`：通过；Vite 仅提示既有大 chunk 优化建议。
- `node --check main.js`、`node --check preload.js`：通过。
- 更新策略专项：`check-app-update`、`check-app-update-installer`、`check-app-update-proxy`、`check-app-update-ui` 与 `check-review-native-2-5` 均通过；断言客户端不再暴露下载/安装 IPC，安装器不再包含 electron-updater 运行路径。
- Windows 安装器专项（CI）：校验 NSIS PE x64、未签名、独立目录安装、同版本重装、真实 1.80 升级资料保留，以及安装目录内 FFmpeg/x264 对应源码与媒体二进制哈希一致。

## Windows 发行资产

正式 Release 共 1 项资产：

- `hongguo-downloader-6.7-win-x64-setup.exe`（未签名）

## 发布回执

待发布完成后回写。

## 限制

- Windows 安装器未签名，SmartScreen 可能提示未知发布者。
- 应用内不再提供下载进度或静默安装；更新需用户自行下载并运行安装程序。
- 本机 `build/ffmpeg` 为开发用 Gyan 7.1 二进制，与 6.7 对应源码归档（FFmpeg 9.0.2）不一致，因此正式安装包必须由 CI 媒体工件构建，本地不产出正式包。
- macOS 不属于 6.7 或未来发行范围。
