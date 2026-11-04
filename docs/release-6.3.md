# 红果短剧 6.3

状态：Windows x64 发行候选，内部版本 `6.3.0`，拟发布标签 `v6.3`。尚未创建正式 Release；本轮源码提交位于分支 `windows/6.3-release`。自 6.2 起项目仅发布和维护 Windows x64，macOS 不属于发行范围。Windows EXE 未配置代码签名。

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
- Windows 候选 CI：待本轮推送触发的源码 Test 与 Windows 候选 run 完成后，在此补充回执与真实素材专项结果。

## Windows 候选资产（尚未发布）

以冻结提交触发的候选构建资产为准，发布前逐项核验哈希、更新清单与回执后随 `v6.3` Release 上传；按 6.2 的先例，便携单文件 EXE 与应用源码 ZIP 不重复上传（GitHub 标签源码快照承担应用对应源码义务）：

- `hongguo-downloader-6.3-win-x64-setup.exe` 与 `.blockmap`
- `hongguo-downloader-6.3-win-x64.zip`（便携版）
- `latest.yml`
- `ffmpeg-9.0.2-x264-b35605a-win-x64-corresponding-source.tar.gz`
- `WINDOWS-SHA256SUMS.txt`

## 限制

- 当前尚未正式发布；不要将候选构建状态误认为 Release 已创建。
- Windows 安装器及便携 EXE 均未签名。
- 本机 Windows 环境 symlink 用例因 `EPERM` 失败；对应源码 CI 和 Windows 候选 CI 测试通过。
- 自动化播放验收不等同于人工听音；未覆盖实体用户电脑、GPU/HEVC 兼容差异和长期稳定性。
- macOS 不属于 6.3 或未来发行范围。
