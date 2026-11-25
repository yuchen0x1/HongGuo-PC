# 红果短剧 6.35 发行记录

状态：已于北京时间 2026-11-25 18:15:05（`2026-11-25T10:15:05Z`）正式发布，GitHub Release 已公开且不可变。标签 `v6.35`，内部版本 `6.35.0`，冻结源码 `1db87d8925f261ba3643b6f6f94f34af569e0f0a`，仅面向 Windows x64。

该版本承接 `v6.34` 的播放稳定性改造，并修复 Windows 安装候选检查器在读取 ASAR 内路径时使用 POSIX 分隔符的发布阻塞问题。修复通过 PR #49 合入；`v6.34` 冻结标签 `30c0e480f1624b87caba8ea35e8d075f11574041` 未移动、未发布。

## 本轮修复

- Windows 安装验收器按运行环境规范化 ASAR 内部路径，能够在 Windows 构建产物中核对 `src/native/app-entry.cjs`、`main.js` 和账号卸载模块。
- 保留 v6.34 的账号会话、播放调度、有限恢复、诊断脱敏、NAS 资料归属和卸载清理改造。
- 不宣称 App 播放接口 HTTP 200 空正文已恢复；官网公开线路仍只处理官方明确允许公开访问且通过完整性检查的分集。

## 下载与更新

正式 Release 仅包含以下两个资产；公开 API 的大小和 SHA-256 与通过验收的候选一致：

| 文件名 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `hongguo-downloader-6.35-win-x64-setup.exe` | 157158256 | `ba655d99b33376719c9da3817f3aeb41cfce89c9c3db1197d975539fdb2b3c78` |
| `latest.yml` | 455 | `f9a706dbb485d6a1f92c160c547f290e08934ba1ff0e613bd80db99afc65418c` |

已实际下载公开 `latest.yml`，版本为 `6.35.0`，绑定上述安装 EXE 的名称、大小和 SHA-256；安装包 SHA-512 为 `Veiri1u3O/X610A8VKG+nw8vABAQlB5x2R7mkFTIc6V+nbZTvFhElpszSJzz+1Pxnw+H6Jyy/gPs8bwMBBxdPg==`。`releaseDate=2026-11-25T10:11:48.294Z` 为构建元数据时间，早于实际公开时间。

`latest.yml` 由最终安装 EXE 字节生成并保留，以兼容 v6.2–v6.6 旧客户端的更新提示和下载流程。独立 Windows 环境的真实 `v6.33 → v6.35` 应用内更新已通过，详见下文；旧客户端继续沿用各自原有更新行为，不将该次实测扩展为所有历史版本均已逐一验收。

## 冻结源码与发行门禁

| 阶段 | 工作流运行 | 实际结果 |
| --- | --- | --- |
| 合并后主干源码与安全检查 | Test [45590200182](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45590200182)、CodeQL [45590200192](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45590200192) | 同一冻结提交，全部成功 |
| 标签源码 Test | [45590921964](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45590921964) | `push`、`v6.35`、冻结 SHA 一致；测试、渲染构建和生产依赖审计成功，保留完整依赖报告与 SBOM |
| 标签 Windows x64 候选 | [45590922007](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45590922007) | 同一标签和 SHA；媒体对应源码、单元与平台检查、NSIS 构建、浅色首启和真实安装验收成功 |
| 正式发布 | [45593022144](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45593022144) | 核对同一提交的两项成功标签 CI 和安装回执，校验文件名、大小、SHA-256、SHA-512，仅发布两项配对资产；公开更新源字节和安装包入口检查成功 |
| README 正式发行同步 | [45593185984](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45593185984) | 成功，公开更新区块为 v6.35 |
| 真实应用内更新 | [45593478688](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45593478688) | `v6.33 → v6.35`，成功；下文列明资料与自动重启边界 |

已实际下载 `windows-verification/installer-result.json`，版本 `6.35.0`、`passed=true`，且 `crossVersionUpgradeTested`、`sameVersionAccountRetentionTested`、`accountUpgradeRetentionTested`、`accountUninstallTested` 均为 `true`。候选安装 EXE 的摘要与正式资产相同。具体确认：

- 安装器为标准 NSIS PE stub，安装载荷为 x64；安装后的 ASAR 包含 bootstrap、正常入口及账号清理实现，修复后的 Windows 路径检查通过。
- 全新独立临时目录安装、同版本重装和重装前后启动通过；设置、localStorage 和既有下载保留。重装在应用首次启动前确认两种历史 profile 的合成账号文件和官方 Cookie 未被清理。
- 使用 SHA-256 固定的真实上游 `1.80.0` 安装器，先安装、启动并保存设置及观看记录，再真实覆盖升级到 `6.35.0`；账号文件、官方 Cookie、设置、观看记录、localStorage 和既有下载保留。
- 候选真正卸载调用包内助手，清除两种历史 profile 的账号文件和官方 Cookie，保留无关 Cookie、设置与视频。账号清理验收使用合成资料，没有访问正式账号。
- FFmpeg/x264 对应源码文档与随包二进制摘要一致；安装器 Authenticode 为 `NotSigned`。

源码播放行为、真实官方两集全文件静音解码、最终打包应用本地/在线交互与诊断 GUI 导出的证据来自 `6.34.0`，详见 [6.34 冻结记录](release-6.34.md) 与 [播放稳定性记录](playback-stability.md)。6.35 的产品播放实现继承该提交，本轮另以冻结标签验证回归、构建和安装；不把 6.34 的媒体回执改写成 6.35 新执行的整集验收。

## 真实旧版更新

工作流 [45593478688](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45593478688) 的验收作业于北京时间 2026-11-25 18:17:04 至 18:18:22 运行成功，验收脚本提交 `0ae3f080e6d41d0bc0001a4a0d59720a6e4bc8a4`。已实际下载 `windows-live-update.json` 并核对 `from=v6.33`、`to=v6.35`、`passed=true`、`installedVersion=6.35.0.0`。

隔离 Windows runner 核对公开 v6.33 安装器 SHA-256 后安装并启动，旧客户端实际显示 v6.35 启动更新提醒；正式版本发现、electron-updater 下载并接受安装包、NSIS Next/Finish、旧进程退出和原安装目录自动启动新版均通过。随后使用同一个隔离 `--user-data-dir` 重开新版，精确版本、下载目录设置与 localStorage 标记保留均通过。

安装器自动 shell 重启没有传入上述测试 profile 参数，因此自动启动与隔离资料保留分别验证，不声称自动重启沿用了测试 profile。本轮没有替换本机正式安装或操作其账号、记录与视频。

## 远端收尾

2026-11-25 发布后的 GitHub API 快照：开放 Issue、PR、Dependabot、Secret Scanning、Code Scanning 均为 0，远端分支仅 `main`；没有待回复关闭的开放 Issue。CodeQL 历史 dismissed 的具体处置见 [安全复核](security-review-6.34.md)，不将 dismissed 视为已实现的代码修复。历史 Release、标签和现有安装 EXE 保留，v6.34 未发布且标签未改写。

## 已知限制

- 仅支持 Windows x64，安装 EXE 未代码签名，首次运行可能出现 SmartScreen 提示。
- App 播放接口空响应、受限或付费分集授权、所有 GPU/HEVC 环境和安装中途自动回滚仍不作保证。

