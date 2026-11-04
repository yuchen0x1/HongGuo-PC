# 红果短剧 6.3

状态：Windows x64 正式发布（2026-11-05 00:41 Asia/Shanghai），内部版本 `6.3.0`，标签 `v6.3`，冻结源码提交 `8a5c3c818955d40786b572458ba6c26cde079660`。源码 CI `41865505393` 与 Windows 候选 CI [`41865505145`](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/41865505145) 全部通过；公开 Release 见仓库 Releases 页。自 6.2 起项目仅发布和维护 Windows x64，macOS 不属于发行范围。Windows EXE 未配置代码签名。

## 主要变化

### 「更新日志」页加载修复

- 读取 GitHub Releases 增加匿名配额保护：10 分钟 TTL 缓存（短期重复打开不再发起请求）、ETag 条件请求（304 复验不消耗匿名配额）、瞬时错误重试一次、限速 403/429 不做无意义重试。
- 新增磁盘缓存 `release-notes-cache.json`：拉取失败时回退展示最近一次成功同步的内容，界面标注「上次同步」时间并提供「重新同步」按钮；完全没有缓存时保留原有错误提示与「重新读取」。
- 进入页面并发去重：共用同一在途请求，不叠加配额消耗。
- 数据解析仅保留规范版本号的正式版条目，过滤草稿、预发布与空正文。

## 验证

- `node scripts/check-release-version.cjs`：通过（1764 组版本对、等价版本、无效版本与未发行版本）。
- 新增 `src/native/release-notes.test.cjs` 8 项单元测试：TTL 短路、304 复验、200 更新、403 不重试回退、瞬时错误重试回退、无缓存错误、损坏缓存重建、内容过滤。
- `src/components/check-ui-state.cjs` 更新日志用例通过，含缓存回退显示「上次同步」与「重新同步」。
- 本机 Windows 完整 `npm test` 仅剩已知 symlink `EPERM` 环境限制（`nas-export`、下载安全与 NAS 导出检查）；新增用例全部通过。`node --check main.js` 与 `npm run build:react` 通过。
- Windows 候选 CI `41865505145`：所有步骤成功（FFmpeg 媒体本轮实际重编译），包括单元/平台检查、FFmpeg 发现、便携验收、全新安装、同版本重装、真实 1.80 升级与资产组装上传。
- 真实素材专项：红果官方来源随机下载《归路》第 8、9 集；全程静音、各采样约 15 秒；H.264/AAC 解码、快捷键切集、自动连播及全屏控件隐藏恢复通过。
- 安装器专项：全新 NSIS 安装、同版本重装与真实 1.80→6.3 升级均保留设置、观看记录与既有下载。

## Windows 发行资产（已随 v6.3 Release 发布）

冻结源码提交 `8a5c3c8` 触发的候选构建资产已本地逐项核验（7 项 SHA256 清单全匹配、`latest.yml` 版本/大小/SHA512 一致、便携 ZIP 单文件）。发布时按 6.2 的先例精简：便携单文件 EXE 与应用源码 ZIP 不随 Release 上传（GitHub 标签源码快照承担应用对应源码义务），`WINDOWS-SHA256SUMS.txt` 重做为仅覆盖现存 5 个文件并逐项匹配。随 Release 上传：

- `hongguo-downloader-6.3-win-x64-setup.exe` 与 `.blockmap`
- `hongguo-downloader-6.3-win-x64.zip`（便携版）
- `latest.yml`
- `ffmpeg-9.0.2-x264-b35605a-win-x64-corresponding-source.tar.gz`
- `WINDOWS-SHA256SUMS.txt`

## 限制

- 6.3 已正式发布；标签与已发布包绑定冻结源码 `8a5c3c8`，后续文档提交不改变标签和已发布包。
- Windows 安装器及便携 EXE 均未签名。
- 本机 Windows 环境 symlink 用例因 `EPERM` 失败；对应源码 CI 和 Windows 候选 CI 测试通过。
- 自动化播放验收不等同于人工听音；未覆盖实体用户电脑、GPU/HEVC 兼容差异和长期稳定性。
- macOS 不属于 6.3 或未来发行范围。
