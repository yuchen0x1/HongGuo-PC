# 红果短剧 6.33 发行记录

状态：已于北京时间 2026-11-25 14:48:22（`2026-11-25T06:48:22Z`）正式发布，GitHub Release 已公开且不可变。标签 `v6.33`，内部版本 `6.33.0`，仅支持 Windows x64。

冻结源码 `b52a6943e135f8a6bacf2250fdbe9f145019e6e5` 为整合 [PR #46](https://github.com/yuchen0x1/HongGuo-PC/pull/46) 的主线合并提交。PR 的 Test、CodeQL 和 Dependency review 全部通过；GitHub 自动代码复核因额度耗尽未完成，本地独立复核未发现阻塞问题，不将其写成自动代码复核通过。

## 本轮范围

- 整合 Dependabot #27–#33，在当前主线重新验证，不沿用旧 PR 的过期绿色结果。
- React 与 ReactDOM、Vite 与 React 插件成组升级，解决两个孤立主版本升级的 peer dependency 冲突。
- 常规升级覆盖 Axios、electron-updater、electron-builder、esbuild 与 semver；Axios 检查保留精确固定版本、安全下限及声明／锁文件／实际安装一致性。
- Actions 升级继续使用完整提交 SHA。所有 upload-artifact 上传显式保留 ZIP，供现有 download-artifact 4 的同次构建和跨次发布下载。
- Dependabot 对 React 与 Vite 工具链使用配套版本更新组；保留安全更新、月度维护及现有 PR 数量限制。
- 使用用户提供的更新模板生成本版本公开 Release 正文和标题，保留历史版本说明的提取兼容。

不变更播放取源、签名、匿名身份、来源策略或资料格式。默认浅色和已保存主题偏好继续沿用。

## 依赖处置

| 原 PR | 整合目标 | 处置状态 |
|---|---|---|
| #27 | CodeQL Action 4.39.4 | 已整合，实际 CodeQL 通过；原 PR 关闭、分支删除 |
| #28 | upload-artifact 7.0.2，并明确 ZIP 格式 | 同次候选和跨次发布下载均通过；原 PR 关闭、分支删除 |
| #29 | github-script 9.0.0 | 正式 README 同步通过；原 PR 关闭、分支删除 |
| #30 | Axios 1.21.1、electron-updater 6.8.11、electron-builder 26.18.0、esbuild 0.28.2、semver 7.8.6 | 回归、构建、审计及真实更新下载通过；原 PR 关闭、分支删除 |
| #31 | Vite 8.3.8 与 plugin-react 6.3.0 配套升级 | 统一组合安装、构建、回归与真实界面通过；原 PR 关闭、分支删除 |
| #32 | Electron 45.5.0，替代原 PR 的 45.4.1 | 实际运行及统一组合的真实界面／网络通过；原 PR 关闭、分支删除 |
| #33 | React／ReactDOM 同步升级 19.3.1 | 统一组合安装、构建、回归与真实界面通过；原 PR 关闭、分支删除 |

原依赖 PR 均在替代整合提交合入主线后逐条说明处置原因并关闭。随后 GitHub API 确认开放 PR 为 `[]`、远程分支仅剩 `main`；已完成整合分支也已删除。本地原有未提交工作保持不动。七项均有可验证的兼容方案，没有因无法修复而放弃升级。

## 发行门禁

- 本地统一锁文件安装、源码回归、React 构建及完整依赖审计。
- 当前提交 PR 的 Test 与 CodeQL，以及标签冻结源码的 Test。
- Windows x64 候选的 FFmpeg 对应源码、NSIS 构建、安装、重装、真实 1.80 安装器升级与资料保留。
- 独立全新 Electron profile 默认浅色、已有界面交互与更新下载回归。
- 从成功标签候选发布严格配对的安装 EXE 与 `latest.yml`，核对官方大小、SHA-256 和 SHA-512。
- 公开后以独立 Windows 环境执行 v6.32 → v6.33 应用内提醒、下载、安装、重启和资料保留验收。

上述门禁均已取得实际成功回执；真实应用内更新的验证范围与限制见下文。

标签源码 Test [45560984910](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45560984910) 已通过；事件为 `push`、分支为 `v6.33`、源码 SHA 为上述冻结提交。其 `dependency-evidence` 工件中的完整 `npm-audit.json` 已实际下载核对，各级告警与总数均为 0。Windows 候选 [45560984778](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45560984778) 已通过，事件、标签和源码 SHA 与 Test 一致；实际下载的安装回执确认全新安装、同版本重装、真实 1.80.0 → 6.33.0 升级、设置／观看记录／localStorage／既有下载保留。此项是安装器升级，v6.32 应用内更新另行验收。

候选安装器为 `hongguo-downloader-6.33-win-x64-setup.exe`，大小 `157108082` 字节，SHA-256 `996da663f3dae5e02ed8e47f8f734e11bc42ea19b4f225c238e03fc3836b2363`。安装器为未签名 NSIS，安装后载荷为 x64，已核对匹配的 FFmpeg／x264 对应源码文档。

## 本地统一组合回执

北京时间 2026-11-25，独立工作树使用自己的依赖目录，未修改原有未提交工作或正式应用资料。

| 检查 | 实际结果 | 边界 |
|---|---|---|
| `npm ci`、`npm ls --depth=0` | 通过，依赖配套且无 peer 冲突 | 最终版本为 React／ReactDOM 19.3.1、Vite 8.3.8、plugin-react 6.3.0、Electron 45.5.0、electron-updater 6.8.11 |
| `npm test` | 退出码 0，326 项初始单元测试及 113 项平台检查通过 | 新增模板提取检查自动纳入；初次 Electron 并发解压影响的另两项桌面／联网检查单独重跑通过 |
| `npm run build:react` | 退出码 0 | 仍有大体积 chunk 及未来 Vite 原生配置加载方式警告，不声称消除此类警告 |
| 完整锁文件审计 | 退出码 0，info／low／moderate／high／critical／total 全为 0 | 是本次采集快照；不替代后续安全告警检查 |
| 默认主题与双主题实界面 | 全新 profile 默认浅色；20/20 页面、80 张截图、58 项扩展矩阵，无确认溢出或控制台错误 | 全程静音，媒体启动次数 0；不构成视频播放验收 |
| 最终 Electron／updater 真实联网 | 4 项全部通过：官方、注入官方失败后 `.org`、注入前两路失败后 `.com`、官方真实中断后 Range 续传 | 全包来自真实公开 v6.32，各项核对 146,279,644 字节及官方双摘要；没有执行安装器 |
| 发布说明与版本边界 | 34 个版本说明提取及拒绝回归通过；5,184 个版本对通过，含 6.32 → 6.33 | 保留模板段落、表格与链接以及历史列表，不把源码比较当作旧客户端实测 |
| Actions 本地检查 | 8/8 治理检查；README 同步脚本的发布、幂等、404 和标记错误模拟通过 | 正式候选／发布／README 同步另有实际成功回执，见下文 |

真实网络回执：[dependency-update-network-2026-11-25.json](verification/dependency-update-network-2026-11-25.json)。最终组合实际使用 Electron 45.5.0、Chromium 156.0.8078.109、Node 24.22.3 与 electron-updater 6.8.11。开始 `2026-11-25T06:21:19.693Z`，结束 `06:22:06.988Z`，耗时 47.295 秒，累计网络正文 585,302,421 字节。实际取消后保存 2,097,152 字节，下一次收到对应 HTTP 206 并最终通过完整大小、SHA-256 和 SHA-512。回执不含令牌、Cookie、签名地址或本地绝对路径，隔离临时资料已删除。

四项使用公开 v6.32 安装包验证当前下载实现，不把公开旧包当成本次 6.33 候选。连接故障为显式注入；官方和代理响应、下载字节、探测及 Range 为真实联网结果，不代表大陆吞吐量。

## 正式发行与旧版更新

正式发布 [45563253225](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45563253225) 全流程成功：核对冻结标签与两项成功标签 CI、跨次下载 ZIP 工件、校验真实安装回执及安装包／清单对应关系、发布并探测公开入口。README 同步 [45563337425](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45563337425) 成功，自动更新主线发行区块；公开标题为「红果短剧 v6.33」，正文使用用户指定模板。

本地实际下载同一候选，再运行 `node scripts/verify-release-assets.cjs dist/v6.33-candidate dist/v6.33-verification/installer-result.json` 通过。公开 API 再次确认 Release 为正式版、非草稿且 `immutable=true`，资产严格为以下两项：

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `hongguo-downloader-6.33-win-x64-setup.exe` | 157108082 | `996da663f3dae5e02ed8e47f8f734e11bc42ea19b4f225c238e03fc3836b2363` |
| `latest.yml` | 455 | `a72dcc2910aa0d35a74f3b0ec3a69b06ca99d40364716bf77a158e7e08eae039` |

清单版本为 `6.33.0`，`releaseDate=2026-11-25T06:38:27.852Z` 是构建元数据时间，早于实际公开时间。安装包 SHA-512 为 `cWJ1eIuV8nRGEFRUY1+XppTBH3kHP0j/pjVLEV8toeWVFhIpw0FZbndOOJAm3dNQYqiyskVqtXIX2Ir2df17/Q==`；清单中的文件名、大小和双摘要均绑定上述候选。

真实 v6.32 → v6.33 应用内更新 [45563376352](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/45563376352) 于 `2026-11-25T06:48:48Z` 创建、`06:50:08Z` 更新为成功（北京时间 14:48:48 至 14:50:08），验收脚本提交为 `078bfea339efd51c8132ca326119514949cdac1f`。已实际下载其 `windows-live-update.json` 并核对 `from=v6.32`、`to=v6.33`、`passed=true`、`installedVersion=6.33.0.0`。

隔离 Windows 环境先核对公开 v6.32 安装器 SHA-256 并安装启动，旧客户端启动时实际显示 v6.33 更新提醒；正式版本发现、electron-updater 真实下载并接受安装包、NSIS Next／Finish、旧应用退出及原安装路径自动启动新版均通过。随后显式用同一隔离 `--user-data-dir` 重开新版，版本、设置和 localStorage 标记保留均通过。安装器自动 shell 重启没有传入该测试参数，自动启动与隔离资料保留分别验证，不声称自动重启沿用了测试 profile。

历史标签、Release 和现有安装包未改写；保留正式 `latest.yml` 供旧客户端收到更新提示并沿用原有更新行为。没有操作本机正式安装或账号资料，没有验证安装中途故障自动回滚。

## 边界

- 开发构建或隔离页面检查不能代替正式安装器及真实应用内更新验收。
- 无代码签名证书，Windows 安装器仍为未签名；不声称解决 SmartScreen 提示。
- 更新下载的模拟与真实线路检查不证明中国大陆速度；GH-Proxy 两个域名仍属于同一服务。
- 本轮不声称完整红果分集、实体 GPU／HEVC、长时播放、所有 Windows 用户环境或安装中途自动回滚已通过验收。
