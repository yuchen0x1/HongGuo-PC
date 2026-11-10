# 红果短剧 6.7

状态：已正式发布（内部版本 `6.7.0`，标签 `v6.7`，冻结源码 `6b76b6313e7f2cb9ad5aeeb04a9955e9eb19b99d`）。发布日期：2026-11-10。Release：https://github.com/yuchen0x1/HongGuo-PC/releases/tag/v6.7。仅维护 Windows x64。

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
- Windows 安装器专项（CI）：校验 NSIS 外壳为合法 PE 与标准 32 位 stub、应用本体为 x64、安装器未签名、独立目录安装、同版本重装、真实 1.80 升级资料保留，以及安装目录内 FFmpeg/x264 对应源码与媒体二进制哈希一致。

## Windows 发行资产

正式 Release 共 1 项资产：

- `hongguo-downloader-6.7-win-x64-setup.exe`（146,466,520 字节，SHA-256 `71f0306fc7912cc16b47a6b3820d7b474a38e443b050cd425a7703ed0aaf7446`，未签名）

## 发布回执

- 源码 Test：https://github.com/yuchen0x1/HongGuo-PC/actions/runs/42761689602，成功，绑定冻结提交 `6b76b63`。
- Windows x64 release candidate：https://github.com/yuchen0x1/HongGuo-PC/actions/runs/42761689265，成功，绑定冻结提交；媒体构建、源码检查、FFmpeg 解析、对应源码与媒体二进制哈希一致、NSIS 安装/重装、真实 1.80 升级资料保留及单资产组装均通过。
- 发布流水线：https://github.com/yuchen0x1/HongGuo-PC/actions/runs/42765407653，成功；校验候选资产恰好 1 个文件并公开 Release。
- GitHub Release `v6.7` 已公开，共 1 项资产；远端 digest 与本地候选包 SHA-256 一致。
- 首次候选构建（run `42759236789`）在安装验收步骤失败：旧断言要求 NSIS 外壳为 x64，而 NSIS 外壳固定是 32 位 stub。已改为校验外壳为标准 32 位 stub、应用本体为 x64，并将标签重指到修正提交后重跑通过。

## 限制

- Windows 安装器未签名，SmartScreen 可能提示未知发布者。
- 应用内不再提供下载进度或静默安装；更新需用户自行下载并运行安装程序。
- 本机 `build/ffmpeg` 为开发用 Gyan 7.1 二进制，与 6.7 对应源码归档（FFmpeg 9.0.2）不一致，因此正式安装包必须由 CI 媒体工件构建，本地不产出正式包。
- macOS 不属于 6.7 或未来发行范围。
