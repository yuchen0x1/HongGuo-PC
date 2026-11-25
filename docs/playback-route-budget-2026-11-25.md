# 播放取源预算与路径候选修复

日期：2026-11-25。本轮修复可离线复现的调度缺陷，并补充一条有冻结来源的普通请求路径；后续集真实播放尚未通过验收，不作为正式发行。

## 已确认的问题

`fetchAppPlayUrlFresh()` 原先在候选循环外计算首条请求的 12 秒截止时间，随后同一轮的其他候选继续共用该截止时间。空响应续路也检查这个局部截止时间，导致 20 秒模型总预算仍有剩余时提前退出。

修改前的独立离线复现：前三条空响应各模拟耗时 3.8 秒，仅请求 `preload-primary`、`preload-alternate`、`video-tab`，超时上限依次为 12,000 / 8,200 / 4,400 毫秒；运行 11.4 秒后报 `EMPTY_RESPONSE`，剩余 8.6 秒总预算未使用，新增候选没有机会执行。这能证明调度存在问题，不能证明它是所有后续集失败的唯一原因。

本轮还发现活跃候选没有 `/novel/player/multi_video_model/v1/` 路径。该字符串虽然存在于历史配置，但绑定旧请求格式，并不等于已接入当前 V5 player 请求。

## 修改范围

- `src/native/app-source.js`：每条候选独立计算 `min(当前时间 + requestMs, overallDeadline)`；空响应是否继续改为检查整体剩余预算。保留 12 秒单次、20 秒模型和 28 秒完整操作上限、父级取消、一次网络恢复和拒绝即停规则。不因空响应刷新设备。
- `src/native/playback-profiles.js`：原三条路线之后，先尝试 `upstream-grouped-b`，再保留既有四条上游候选；新路线只改变路径，复用同一 7.4.3.32 / 377 静态画像和 player 请求体。该画像版本升至 `2026-11-25.2`，仍标记 `source-only` / `mediaVerified: false`。
- 回归测试覆盖慢空体、总预算耗尽、调用方较短截止时间、网络恢复、精确八路线顺序、传输取消，以及拒绝、限流、业务错误、错集和受保护响应的停止边界。
- 搜索、详情、收藏、历史、UI、更新入口及正式 6.37 资产不作本轮修改。历史请求格式不会因共享 URL 而重新启用。

关键文件修改前备份：`backups/playback-route-budget-20261125/`，共 11 个既有文件；新增测试和本文没有覆盖同名文件。

## 外部来源与限制

普通路径参考 `beilunyang/openhongguo` PR #17，冻结 head `068831a1a04ba6ae2f496fef07362f71bdca2d5b`，对应 `internal/protocol/playback_v5.go` 的路径常量改动；本轮核对时仍为 open、未合并。仓库许可为 Apache-2.0。本项目没有安装或引入其 SDK、WASM、内容密钥流程或代码执行入口，只独立适配请求路径，保留来源记录。

其他四条普通请求候选继续沿用 `jackotom/hongguo-drama` v8.3 的既有来源与 GPL 声明，详见 `docs/upstream-sync-2026-11-25.md`。不把任一上游作者的成功描述当成本项目实际验证。

新候选只接受与本次分集映射匹配、编号和时长有效、各档位明确未加密且没有受保护元数据的模型。拒绝、限流、受保护或状态不明时停止；不会进入旧密钥派生或地址解密分支。旧路线既有实现不在本次重写范围内，不能将此描述为整个项目的保护机制审计结论。

## 实际验证记录

| 项目 | 结果 |
| --- | --- |
| 新增测试的修改前运行 | 17 项中 2 通过、15 失败；缺失新路径和慢空响应提前退出均实际复现。 |
| 新增测试的修改后运行 | `node --test src/native/app-source-route-budget.test.cjs`：17/17 通过，无跳过。全部 Axios、注册和时钟均为离线替身，不下载夹具媒体。 |
| 相关回归 | profiles / upstream / lifecycle / diagnostics 四个文件共 102/102 通过；`node scripts/check-app-source-recovery.cjs` 通过。 |
| 独立复核 | 无阻断问题。另一套内存 VM 在前三次各 3.8 秒空响应后到达第四候选，超时上限为 12,000 / 12,000 / 12,000 / 8,600 毫秒；该路模拟 403 后立即停止，仅一次模拟注册。 |
| 全量测试 | `npm test` exit 0：669 项主单元测试、116 组平台检查通过，无主单元跳过；日志 `dist/playback-route-budget-20261125/npm-test.log`。既有测试下载《少夫人来自东北3》第 1 集官网公开片段用于静音解码回归，不作为完整分集或后续集验收。 |
| 依赖与源码检查 | 全依赖 `npm audit --json` 为零漏洞（367 个依赖）；`git diff --check` 通过。审计日志 `dist/playback-route-budget-20261125/npm-audit.json`。 |
| 完整构建 | `npm run build:react` 和 Windows x64 NSIS 构建均 exit 0；日志 `dist/playback-route-budget-20261125/build-react.log`、`build-installer.log`。沿用的 Vite 配置加载和分包大小提示、未设置 author、依赖引用重复及未配置代码签名证书均保留为构建警告。 |
| 包内容及隔离启动 | 通过。ASAR 648 条目，六个关键源码文件与工作区逐字节一致；五条新增候选、逐路线预算和明文守卫均在包内。打包后的项目名、版本、入口、运行依赖语义一致；NOTICE、许可证、FFmpeg/ffprobe 及对应源码归档与构建输入摘要一致。全新临时资料、空下载目录、关闭更新、启动前静音，主窗口和只读 preload 正常；九条播放路径 attempts / modelsAccepted 全为零、`sourceAttempts=0`、设备未初始化、媒体及解码空闲、无 video 元素。只主动调用 `getAppInfo` / `getPlaybackDiagnostics`，首页自动卡片不作数据验收。候选实例已退出，原正式应用五个进程前后保持。回执与截图：`dist/playback-route-budget-20261125/startup/startup-report.json`、`candidate-startup.png`。初次检查器误要求 electron-builder 正常精简的 `package.json` 逐字相同，在应用启动前失败；改为语义核对后完整重跑通过，非生产缺陷。 |
| 远端安全和更新资产 | 北京时间 23:06:28–23:06:58 只读复核：开放 Issues / PR、Dependabot / CodeQL / Secret Scanning 告警均为零，远端仅受保护 main。正式最新仍为不可变 v6.37，标签冻结提交不变；安装包元数据和实际读取的 455 字节 `latest.yml` 与此前摘要一致，旧版本所需更新字段保留。未下载完整正式安装包，也未删除其他工作树或本地分支。 |
| 后续集真实取源、画面和整集静音解码 | **本轮未执行，未通过验收。** 此前真实 App 模型探针被运行环境自动策略拒绝，未提供更具体原因；没有改用 GUI、代理、其他进程或传输执行等效操作。本轮不复用旧版画面、首集片段或离线模型作后续集证明。 |
| 手机断开后的端到端播放 | 本轮无手机、ADB 或模拟器依赖变更；未观测手机物理状态，也没有本轮端到端播放结果。 |
| 发布 | 待验证的本地候选不参与应用内更新；正式标签和 `latest.yml` 保持不变。后续集未通过实际验收，不发布为已修复后续集播放。 |

本轮确认修复的是“候选因错误共享截止时间而无法执行”，不是已证明恢复了后续集媒体供应。剩余关键验收仍为同剧第 6、34、68 集的合法资源、Windows 首帧、完整时长和整集静音解码。

## 本地 Windows 候选

```powershell
npm run build:react
npx --no-install electron-builder --win nsis --x64 --publish never --config.directories.output=dist/playback-route-budget-20261125/candidate --config.nsis.artifactName=hongguo-downloader-6.37-route-budget-unverified-win-x64-setup.exe
```

候选目录：`dist/playback-route-budget-20261125/candidate/`。保留内部版本 `6.37.0`，仅用于隔离构建检查；不是新正式版本，也不替换已发布 6.37 的安装包或更新元数据。本轮没有执行安装、重装或跨版本更新，不套用旧发行回执。

| 候选文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `hongguo-downloader-6.37-route-budget-unverified-win-x64-setup.exe` | 157,164,034 | `99de6210f7578d088b34a11d09e7f7845e1b9b4f4f2d1dff8535ff27e1210c3f` |
| `win-unpacked/resources/app.asar` | 12,201,249 | `d9e72a4f66dd0c2a1806de338c00d8c2cbd1aaa1cda4065641dc4231e02c82c8` |
