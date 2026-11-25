# 维护看板

| 条目 | 核验入口 |
|---|---|
| 正式版本、安装 EXE、清单、SHA-256 | [GitHub 最新正式发行](https://github.com/yuchen0x1/HongGuo-PC/releases/latest) |
| 支持矩阵和兼容性 | [平台评估](platform-assessment.md) |
| 源码测试、渲染构建、完整依赖报告与 SBOM | [Test](https://github.com/yuchen0x1/HongGuo-PC/actions/workflows/test.yml) |
| 候选安装、重装、旧版升级与资料保留 | [Windows x64 候选](https://github.com/yuchen0x1/HongGuo-PC/actions/workflows/windows.yml) |
| 正式发布及入口校验 | [发布工作流](https://github.com/yuchen0x1/HongGuo-PC/actions/workflows/publish-windows-release.yml) |
| 依赖与源码安全 | [安全页](https://github.com/yuchen0x1/HongGuo-PC/security) |
| 用户反馈 | [Issue](https://github.com/yuchen0x1/HongGuo-PC/issues) |

每次版本迭代维护 [版本说明](releases/release-notes.md)、应用更新说明和对应安装回执。功能、更新、独立平台环境与已知限制分别登记，真实运行与自动检查都链接到证据。Windows 10 和 Windows 11 使用同一发布资产，单独记载实机测试结果。

## 6.33 依赖整合

#27–#33 七个 Dependabot 升级提案已由整合 [PR #46](https://github.com/yuchen0x1/HongGuo-PC/pull/46) 合入主线，源码冻结于 `v6.33` 的 `b52a6943e135f8a6bacf2250fdbe9f145019e6e5`。React／ReactDOM 和 Vite／React 插件按兼容组合升级，Electron 使用 45.5.0。最终统一组合的本地安装、构建、完整回归、审计、静音实界面和真实更新下载均通过；PR 全部 CI、标签源码 Test、Windows 候选、正式发布和 README 同步均通过。6.33 已于北京时间 2026-11-25 14:48:22 正式发布且不可变，正式资产仅为安装 EXE 与配对 `latest.yml`，摘要及完整证据见 [6.33 发行记录](release-6.33.md)。

真实 v6.32 → v6.33 应用内更新 [45563376352](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45563376352) 已通过：旧版启动可见提示、真实下载接受、NSIS 安装及原路径自动启动新版，PE 版本确认为 `6.33.0.0`；显式重开同一隔离 profile 后设置与 localStorage 保留。安装器自动 shell 重启不继承测试 `--user-data-dir`，两项分别验收；未验证安装中途故障自动回滚。

原七条 PR 已逐条回复处置原因后关闭，各远程依赖分支及整合分支均已删除；GitHub API 确认开放 PR 为 `[]`、远程分支仅剩 `main`。本地原有含未提交成果的工作树未动，不强制清理本地历史分支。

2026-11-25 本轮 GitHub API 再次核对：开放非 PR Issues、Dependabot 告警、Code scanning 告警和 Secret scanning 告警各为 0。待处理依赖 PR 与安全告警分别统计；当前本地完整锁文件审计各级告警总数也为 0。

## 6.32 发行与分支审计

状态：6.32 已于北京时间 2026-11-25 13:55:34 正式发布，标签 `v6.32`，冻结源码 `2bdcaacc872e5b838ad323c90c9e06ee24eb422b`，Release 已公开且不可变。标签源码 Test [45554988493](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45554988493) 通过，含源码回归、React 构建、生产依赖审计和完整依赖报告；完整审计各级告警及总数均为 0。Windows 候选 [45554988520](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45554988520)、发布 [45556801896](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45556801896) 与 README 同步 [45556936208](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45556936208) 均通过，正式资产摘要见 [6.32 发行记录](release-6.32.md)。

北京时间 2026-11-25 13:38:31 的仓库快照以 `main=2bdcaacc872e5b838ad323c90c9e06ee24eb422b` 为基线；GitHub API 对开放非 PR Issues、开放 Dependabot 告警、开放 Code scanning 告警分别实际返回 `[]`，三项均为 0。此为采集时快照，不代表以后没有新告警，也不等同没有待处理的依赖升级 PR。

快照中的 7 个待处理 Dependabot PR 为 #27–#33，覆盖两项 Actions 升级、`upload-artifact` 7、`github-script` 9、5 项常规 npm 更新、Vite 8、Electron 45 与 ReactDOM 19。#30 未通过固定 Axios 版本检查；#31 的 plugin-react 4 与 Vite 8 不兼容；#33 的 React 18／ReactDOM 19 peer 约束不匹配。尚未把这些升级作为安全修复强行合并；2026-11-23 的旧绿色结果不能冒充当前 `main` 的兼容验证，后续须在当前基线重新整合并完成相应门禁。

正式发布后，已核对 `codex/android-guest-playback-study`、`codex/github-download-acceleration` 均为主线提交 `535bc20f0b4c0fcd51b3fde8b3f06cf465a87dc1` 的祖先，并成功删除这两个远程分支；保留 `main` 和 7 个待处理 Dependabot 分支。本地原有分支与含未提交成果的工作树未动。后续验收脚本修复与文档提交已使主线继续前进，前述快照 SHA 只标识历史审计和 6.32 冻结源码，不作为永久当前 `main`。

历史应用内升级 v6.30 → v6.31 的 [45555597265](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45555597265) 与 v6.31 → v6.32 的 [45557133216](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45557133216) 均已通过启动提醒、真实下载、NSIS 安装和原路径自动启动，后者已安装 PE 版本为 `6.32.0.0`。两次设置与 localStorage 分别由显式重开各自相同的隔离 profile 验证保留；自动 shell 重启未传入测试用 `--user-data-dir`，安装中途故障的自动回滚未作真实验证。

## 历史维护记录

每月复核依赖和 Action 更新、出包时间、最新 Release 的 EXE 与 `latest.yml` 是否成对、下载是否有效，以及高优先级故障和兼容性问题。发布大版本之前重新读取竞品的源码入口、最新稳定版本和公共 Issues，更新 [竞品研究](../COMPETITOR_ANALYSIS.md) 和 [升级清单](../UPGRADE_ROADMAP.md) 后决定本轮范围。

2026-11-21 的 6.22 已正式发布，重点是打包环境开发 renderer 来源过滤和负向回归。冻结源码 `ee342c9adf3b2b22116b423fe1dc1285534f87ce`，正式资产与完整验证回执见 [6.22 发行说明](release-6.22.md)。候选含 FFmpeg/x264 对应源码归档和媒体摘要匹配、x64 安装/重装与真实 1.80.0 → 6.22.0 升级资料保留；Windows EXE 仍未签名。红果完整分集播放、实体 GPU/HEVC、长时播放、真实 NAS 与真实应用内更新链路仍未在本轮完全验收。

2026-11-21 的 6.25 已正式发布，重点是关闭按钮收进系统托盘——点 × 默认收起窗口后台运行（下载不中断），托盘单击恢复、右键退出，设置页新增「窗口」分类开关，可改回直接退出。冻结源码 `52b267b0058936b967d2d99eeb50f5edc47ffa9a`，正式资产与验证边界见 [6.25 发行说明](release-6.25.md)。托盘真实显示/单击/右键待安装后真机验收。

2026-11-21 的 6.24 已正式发布，重点是红果完整分集取源的空响应恢复——空响应后按「V5 POST → 备用主机 → 签名 video_tab GET」阶梯恢复（对照上游 7.7 issue #130 移植并致谢其 GPL 来源链），真实剧集验证取源恢复，AT-04 销号。冻结源码 `de045a7d5a3e33f5b7991ea77aabc8542574d704`，正式资产与验证边界见 [6.24 发行说明](release-6.24.md)。发布工作流全流程成功（含末步公开入口探测）。

2026-11-21 的 6.23 已正式发布，重点是 `data.json` 验证镜像备份与设置页受控恢复（EV-003 完成），以及保存独占暂存文件修复（不再覆盖历史遗留 `.tmp`）。冻结源码 `7a22cff46c7b48dee15383cb720d9813c69a9826`，正式资产与验证边界见 [6.23 发行说明](release-6.23.md)。发布工作流末步公开入口探测再次失败，本机独立核验成功后如实分别记录。

技术债重点为主进程职责聚合、JSON 资料恢复、上游来源变动、真实应用内跨版本更新、签名和硬件解码矩阵。发布回执区分安装器升级、应用内更新、Windows 代码签名、回滚和长期播放。

2026-11-21 的 6.21 源码维护覆盖设置与下载任务筛选、设置提交边界和验收脚本安全；能力清单、六个开源项目的源码对照、P0–P3 下一轮任务及未测限制见 [维护记录](evolution-6.21.md)。候选、安装、公开资产摘要与发布末步 HTTP 403 的独立复核见 [6.21 发行回执](release-6.21.md)；不用本机开发构建冒充正式资产，也不将公开后的复核成功写成原发布工作流全程成功。
