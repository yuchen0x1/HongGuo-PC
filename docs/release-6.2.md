# 红果短剧 6.2

状态：Windows x64 发行候选，内部版本 `6.2.0`，拟发布标签 `v6.2`。尚未创建正式 Release；本轮最终候选源码提交为 `91a6b1f957904110b159567db031103bb81a141e`，Windows 候选 CI 为 [`41852868738`](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/41852868738)。自 6.2 起项目仅发布和维护 Windows x64，macOS 不属于发行范围。Windows EXE 未配置代码签名。

## 主要变化

### 选集页同系列跨季切换

- 发现页与「搜索与下载」选集区可列出同来源、同剧名基组的各季，并一键切换；没有其他季时不显示入口。
- 与既有观看记录归组规则一致：同来源且季号基名完全相同；不自动合并模糊同名或跨来源剧集。
- 搜索结果检索各季时保留本机候选，联网失败不阻断已知季的切换；切换后重新加载当前季分集并默认选择可用集。

### 界面滚动打磨

- 隐藏全局与播放器内部滚动条，保留内容滚动操作。
- 更新播放器选集弹层滚动条样式。

## 验证

- `node scripts/check-release-version.cjs`：通过，检查 1681 组版本对、等价版本、无效版本与未发行版本。
- `npm run build:react`：通过；Vite 有约 3.45 MB chunk 提示及既有 CJS Node API deprecation 提示。
- `npm test`：GitHub Ubuntu 源码 CI `41843935090` 全部通过。本机 Windows 有 3 项符号链接测试因 `EPERM` 失败；其余测试通过。
- 开发版 UI：使用独立 userData 目录打开《谁让这个悍匪修仙的！第五季》，第一至第五季切换显示正常；切到第二季后标题、集数和成功提示更新。此手动 UI 检查未下载媒体；Windows 候选 CI 另完成了下述真实素材专项。
- Windows 候选 CI：[`41843935004`](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/41843935004) 所有步骤成功，包括 FFmpeg 源码构建、单元/平台测试、FFmpeg 发现、便携版验收、安装/同版本重装、真实 1.80 升级、资产组装与上传。
- 真实素材专项：Windows CI 从红果官方来源随机下载《妈咪受辱，大小姐回国掀翻全场》第 6、7 集；各采样约 15 秒，全程静音。实际验证 H.264/AAC 解码、本地播放器、暂停、快捷键切集、自动连播及全屏控件隐藏恢复。报告注明没有执行真实平台下载清晰度选择的下载专项，也没有人工听音。
- 安装器专项：真实 SHA256 固定的官方 1.80 安装器升级到 6.2，验证设置、观看记录、本机存储与既有下载保留；新装和同版本重装也通过。安装器和应用均未签名。
- Windows 候选包与 SHA256 已逐项核对；更新清单版本 `6.2.0`、安装包文件名、大小和 SHA512 对应。详见下方资产表。
- macOS 不再属于当前或未来发行范围，不构成待补资产。

## Windows 候选资产（尚未发布）

候选构建：Windows x64 release candidate 工作流已成功完成。最终以与冻结源码 SHA 对应的 Windows 候选 artifact 为准，其 `WINDOWS-SHA256SUMS.txt` 覆盖以下文件并逐项验证；便携 ZIP 内仅包含同名便携 EXE。`latest.yml` 指向同名 NSIS 安装包，版本、大小与 SHA512 必须一致。

- `hongguo-downloader-6.2-win-x64-setup.exe` 与 `.blockmap`
- `hongguo-downloader-6.2-win-x64.exe` 与 `hongguo-downloader-6.2-win-x64.zip`
- `latest.yml`
- `hongguo-downloader-6.2-windows-source.zip`
- `ffmpeg-9.0.2-x264-b35605a-win-x64-corresponding-source.tar.gz`
- `WINDOWS-SHA256SUMS.txt`

先前候选 run `41843935004` 的对应资产已完成逐项哈希核对；正式发行时应使用冻结提交所触发的候选构建所产资产和清单，不能复用旧源码 SHA 的应用源码 ZIP。

## 限制

- 当前尚未正式发布；不要将候选构建状态误认为 Release 已创建。
- Windows 安装器及便携 EXE 均未签名。
- 本机 Windows 环境 3 项 symlink 用例因 `EPERM` 失败；对应源码 CI 和 Windows 候选 CI 测试通过。
- 自动化播放验收的音轨解码不等同于人工听音；未覆盖实体用户电脑、GPU/HEVC 兼容差异和长期稳定性。
- macOS 不属于 6.2 或未来发行范围。
