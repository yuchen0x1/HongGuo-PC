# 红果短剧 6.38 发行与播放故障验收

源码目标为 `6.38.0`，公开版本 `6.38`，计划标签 `v6.38`，仅支持 Windows x64。本地全量、构建及公开第 1、2 集播放器基础对照已完成，**尚未构成正式发布、中后段播放或安装验收通过的证明**。最终冻结 SHA、执行结果和资产摘要在对应操作实际完成后补充，不复用 6.37 的结果冒充本次验收。

**本轮主要验收第 22 集及中后段分集，第 1、2 集只作播放器基础对照。** 目标剧第 6、22、34、68、88 集最新精确公开页面均为 404，尚未取得合法媒体或播放成功证据。第 1、2 集新包本机及官网公开在线对照通过不能代替它们，公共 HTML 调查也不等于播放通过。

## 范围与结论

- 保留既有 Windows UI、原生 Chromium 视频和 FFmpeg 兼容路径；修复官网缺集过早阻止 App 提供方、源错误上下文丢失、旧媒体时间残留、首帧前错误确认播放以及有关预取/历史生命周期的问题。
- 增加按本次播放生成的诊断 ID、逐步结果、HTTP 状态、各线路事件、复制和导出；区分网络、业务、解析、空源、地址、清单/媒体、格式及解码故障。
- 对 App 模型核对目标分集及完整性，识别 MP4/HLS/未知格式；明确拒绝不支持的 DASH。不会通过修改签名、复制手机凭据或扩大授权条件解决取源。
- 《嫌疑人的秘密2：藏宝生死线》第 22 集尚未取得真实播放成功证据。官网同剧号返回名称为《嫌疑人的秘密2藏金生死线》，目录 88 集，精确第 22 集页面 HTTP 404；不能据此判断 Android、账号或 DRM 状态。
- 本轮 REA 6.10.1 完成用户 APK 静态检查，确认包版本 7.4.5.32 / 74532；未取得 Android 正常播放同集的成功抓包，不能声称协议差异已由运行时证实。
- 新 6.38 包在独立空库完成真实搜索、71 集详情、公开第 1、2 集首帧/持续画面/seek/ended 连播和新进程重启；使用既有 H.264 / 官网优先选项，App 各路线均未请求。真实运行与 ADB / scrcpy 进程为 0 的检查已完成，手机电源和物理 USB 状态未观测。

完整调用链、证据边界、根因与补充网络记录方法见 [专项调查](playback-investigation-2026-11-26.md)。公开更新说明来源为 `docs/releases/release-notes.md`；独立草稿为 `docs/release-notes-v6.38.md`，按用户桌面更新模板编写。

## 修改位置

| 模块 | 文件 | 核心变化 |
| --- | --- | --- |
| 取源和模型 | `src/native/hongguo.js`、`app-source.js`、`official-web-playback.js` | 404/410 提供方隔离；目标身份/完整性；参考信息超时；媒体格式 |
| 调度和故障 | `src/native/playback-manager.js`、`playback-errors.js`、`playback-profiles.js` | 阶段/HTTP 传递；细分分类；已配置线路统计 |
| 主进程媒体 | `main.js` | MIME/HLS 分流；DASH 明确报错；分步诊断穿透 IPC |
| 旧官网公开路径 | `src/native/hongguo.js`、`official-web-playback.js` | legacy JSON-LD 同样检查明确许可、本集身份、真实 MP4 与完整时长 |
| HLS 多读取生命周期 | `main.js` 的 `registerStreamProtocol` / `hlsResponse` | 独立会话准备任务；单个 Range 读取取消不连带中止其他读取 |
| 同步目录文件发布 | `src/native/merge-runner.js` | 硬链接 `UNKNOWN` 回退独占复制，保持不覆盖与源文件保留 |
| 播放器 | `src/components/Player.jsx`、`PlayerControls.jsx` | 当前会话与呈现帧校验；失败清理；时间归零；预取和历史绑定 |
| 诊断 UI | `playbackDiagnosticDisplay.mjs`、`playbackRecovery.mjs`、`src/native/playback-diagnostics.js` | 诊断 ID、步骤/事件、故障建议及最近失败 |
| 自动化 | 相关 `*.test.cjs`、`*.test.mjs` 与 `scripts/check-player-*.cjs` | 错误、源格式、首帧、切集、预取及恢复回归 |
| 发行元数据 | `package.json`、`package-lock.json`、`scripts/check-release-version.cjs` | 6.38.0、两段公开文件名及旧版更新比较 |

## 本轮验证状态

下表只在执行后填写实际结果，不将“已有脚本”记为“已通过”。所有真实媒体测试要求随机官方素材、独立 profile/下载目录、启动即静音、音量 0；禁止彩条、假地址或模拟成功。

| 验证项 | 当前结果 | 必需回执 |
| --- | --- | --- |
| 版本/模板/安装配置静态检查 | 通过；5,929 组版本组合、独立稿与发布节正文一致、安装配置通过 | `check-release-version.cjs`、`release-notes.cjs` 提取对比、`check-windows-installer.cjs --config`，退出码均为 0；不代表实际更新或安装 |
| 本轮随机公开完整素材 | 两集完整下载、大小/SHA 核对和整集静音解码通过；采集运行环境 6.37.0 | `dist/playback-20261126/public-media/manifest.json`；见下节，不代表 6.38 GUI 通过 |
| HLS 专项 | 30 项错误、4 项空间保护及真实素材 HLS 转封装/ffprobe 通过，退出码均为 0 | 本轮执行输出；原始输出未单独保存日志，命令及边界见下节 |
| 本轮专项单元/平台回归 | HLS、下载/真实 decoder、合并及各次 fixture 定向通过 | 已执行命令与边界见下节；未另存日志的结果明确标为工具输出摘要 |
| `npm test` | 第四轮 exit 0；主单元 765/765、失败 0、跳过 0，另有 117 项平台检查全部通过 | `.local/analysis/playback-20261126/npm-test-4.log`；前三轮失败历史保留，平台内部重复子组不重复累计 |
| `npm audit --json` | 通过；生产和开发依赖合计 0 项已知漏洞 | `.local/analysis/playback-20261126/npm-audit.json` |
| 渲染构建与 NSIS 构建 | React / Windows x64 NSIS 构建通过；首包 GUI 失败已修复并以新包重测 | 构建日志及下列两份包身份；不是正式 CI 资产 |
| 目标第 22 集真实播放 | 未通过验收；缺合法可用媒体与 Android 成功配对记录 | 取源诊断、当前集帧和持续画面 |
| 目标第 6、34、68、88 集主要验收 | 最新精确公开页全部 HTTP 404；未取得合法媒体，实际播放未通过 | `later-public-pages.json` 及 REA 6/6 条公开记录；HTML 404 不能记为播放通过 |
| 随机公开完整第 1、2 集 Windows 在线基础对照 | 新包通过；独立空库、真实搜索/详情、首帧/持续画面、seek、真实 ended 1→2、重启重新取源 | `dist/playback-20261126/online-public/result.json`；既有 H.264 / 官网优先，App 各路线 attempts=0；不能代替中后段 |
| 本机完整素材交互 | 新包 `passed=true`、`formalAcceptanceComplete=true`；首帧、seek、倍速、全屏、画中画、恢复/手动重试及 1→2 连播通过 | `dist/playback-20261126/local-rerun/result.json`；首包失败另保留，不含官方取源/授权或中后段 |
| 受测 ASAR 与当前实现 | 14 个生产/Renderer 文件全部匹配，mismatches 0 | `.local/analysis/playback-20261126/asar-source-check.json`，受测 ASAR `473b7f8f…` |
| 后续集/连播边界 | 1→2 基础连播通过；指定中后段无合法媒体，未通过播放验收 | 每集独立结果；保护通过不能算播放通过 |
| 手机/USB/ADB 独立运行 | Windows 在线与重启不使用手机传输；01:16:39 检查 ADB / scrcpy 进程 0；物理 USB/手机电源未观测 | `.local/analysis/playback-20261126/independent-process-check.json`；验收后恢复 ApkStart |
| 标签 Test / CodeQL / Windows 候选 | 待冻结提交及 CI | 标签、同 SHA、成功运行 ID |
| 隔离 NSIS 安装/重装/旧版升级/账号清理 | 待一次性 Windows runner | 五项安装门禁及受测资产身份 |
| v6.37 → v6.38 正式应用内更新 | 待正式发布后执行 | 真实旧版提示、下载、校验、安装、重启与资料保留 |

## 本轮随机完整媒体与 HLS 专项

2026-11-26 00:45:44–00:45:52（北京时间），从官网 24 部真人剧中重新随机抽取《将门有朵刺骨花》，剧号 `7709756809598225432`，官网目录 71 集，当次可访问范围 5 集，下载公开完整第 1、2 集。回执位于 `dist/playback-20261126/public-media/manifest.json`，`passed=true`、`selection=random`、`source=official-public-complete`、`audioOutput=none`；没有账号鉴权验收。

**采集环境为 Electron 45.5.0 的 Node 模式，记录的 appVersion 为 6.37.0。** 这是本轮新采集的真实素材，采集回执本身不是 6.38 GUI 回执；本轮已另用下列新 6.38 程序/ASAR完成基础播放重测，两个版本及两类回执分别保留。

| 分集 | 官方 / 文件时长（秒） | 字节数 | 编码 | SHA-256 |
| --- | --- | ---: | --- | --- |
| 1 / `7709759659036396606` | 123.498 / 123.497007 | 12697465 | MP4、H.264 360×640、AAC | `37b1571c7dfe3f48ccb92613a4346e31e8cff75f64de46a5a206671193f54163` |
| 2 / `7709759712530533401` | 118.207 / 118.206667 | 10928815 | MP4、H.264 360×640、AAC | `a11b57d4b607ba9804a49205c003241ab38d743113ae94623169bc4023ec0b63` |

两集均完整解码至 null，`wholeEpisodeSilentDecode=passed`、`decoderErrorBytes=0`；本轮再次核对本机文件大小和 SHA-256 与清单一致。文件位于该目录下 `official-media-1qVngH/`，不进入公开发行资产。素材的第 1、2 集结果不能代替目标第 22 集、账号/DRM 或整部剧验收。

本轮以下 HLS 定向命令实际退出码均为 0；原始工具输出未单独落盘，本节只保留执行摘要，不伪造精确执行时分秒或完整日志：

- `node scripts/check-hls-errors.cjs`：30 项错误分类与失败清理通过。
- `node scripts/check-hls-space.cjs`：4 项空间保护通过。
- 指定随包 `build/ffmpeg/ffmpeg.exe`、`ffprobe.exe`，并将 `HONGGUO_VIDEO_FIXTURE` 指向上述真实第 1 集后执行 `node scripts/check-hls-media.cjs`：加密 master/variant/segments/key 转封装、真实 ffprobe、私网/file URL 阻止、缺失分片与取消清理通过。

该 HLS 回归以真实官方素材在本地测试服务重封装并检查文件，不是从官方取得真实 HLS 地址，也不代表官方受保护媒体解密或用户账号授权通过。全量测试的失败与修复过程单列如下，不能将专项通过写成全量通过。

## 新确认的三个根因

1. **旧版官网直链没有同等许可和完整性门禁。** `hongguo.js:fetchPlayUrlFromWeb` 的 legacy HTML/JSON-LD 路径现在也先调用 `publicEpisodePermission`，要求本集明确公开许可和已知完整时长；随后使用真实 GET Range 的 MP4 字节，通过 `official-web-playback.js:publicMovieDuration` 验证媒体结构、Range、轨道与时长，误差不超过 0.5 秒。未知条件、预览字节、清单或网页不作为完整 MP4 接受。这一修复收紧已有校验，不扩大授权。
2. **取消一个读取曾连带影响共享 HLS。** 多个 Range 读取可以等待同一准备任务；`main.js:registerStreamProtocol` 的 `hlsResponse` 现在为任务建立独立会话 controller 和 90 秒期限，单个读取取消只结束自己的等待，会话释放仍会取消共享任务。`check-streaming.cjs` 增加并行读取取消回归；新包本机 MP4 和公开在线 GUI seek 均通过，仍不能扩展为官方真实 HLS 交互通过。
3. **同步盘硬链接返回 `UNKNOWN` 导致文件无法发布。** 在 E 盘同步目录实测的 `UNKNOWN` / `errno=-4094` 未被原回退处理覆盖。`merge-runner.js:publishMergedOutput` 现在回退 `COPYFILE_EXCL`，拒绝已存在目标，失败保留源文件；真实下载和合并共同使用此路径。测试保留不覆盖、复制失败和竞态检查，没有把一般未知错误静默当作成功。

## 定向 decoder、下载与合并结果

- `node scripts/check-download-quality-integration.cjs`：本轮完整 27/27 通过；其中真实 decoder 分支另行定向 1/1 通过。保留实际 FFmpeg/ffprobe，使用本轮真实素材派生可 probe 但媒体数据损坏的文件，验证 Web 损坏后转向健康 App 输入、App 损坏后不重复同片源、不产生下载完成误报及不遗留目标文件。上游响应由本地夹具提供，不能当作官方 App 服务成功。
- `node scripts/check-merge-optimization.cjs`：独占发布、硬链接不支持/`UNKNOWN` 回退、不覆盖、复制失败保全和竞态等检查通过。
- 指定随包 `FFMPEG` / `FFPROBE`，并将 `TEMP` / `TMP` 放在项目 `.local/analysis/merge-real-test-temp` 后，以 `dist/playback-20261126/public-media/official-media-1qVngH/episode-1.mp4` 连续传入两个输入执行 `node scripts/check-merge.cjs --real`；重复两次运行均为 exit 0，输出 H.264 360×640 无损快速合并、247.040 秒、50 帧解码。只在拼接点解码两秒，不是整个 247.040 秒新文件的全片解码验收。

以上定向执行未另存完整原始日志，保留本轮工具输出摘要，不编造日志路径或精确时分秒。随机源素材自身的完整解码回执仍独立保留，不能用合并两秒检查替代。

## 全量回归的失败历史

第一轮完整日志 `.local/analysis/playback-20261126/npm-test.log` 结束为 `npm test: 9 command(s) failed`，包含测试夹具更新及真实缺陷修复，不能归为“只有测试问题”。第二轮 `npm-test-2.log` 结束为 `3 command(s) failed`，失败命令为 `check-native-performance.cjs`、`check-source-recovery.cjs`、`check-web-media-guard.cjs`。

第二轮三项均已补齐明确公开许可、同集身份、完整时长及有效 MP4 Range 元数据 fixture，定向重新运行分别 8/8、19/19、18/18 通过；生产守卫没有为测试而放宽。它们是离线测试夹具，不是假装官方媒体播放。

第三轮 `.local/analysis/playback-20261126/npm-test-3.log` 为 `1 command(s) failed`：`app-source-inline-fallback.test.cjs` 的 fallback 请求 timeout 大小比较受到真实时钟波动影响。测试改用可控时钟验证剩余预算。第四轮 `npm-test-4.log` 实际退出码 0，主单元 765/765、失败 0、跳过 0，另有 117 项平台检查全部通过；平台内部重复单测子组不再叠加计数。这是实际完整重跑结果，不是拼接前三轮通过部分。版本比较再次执行，5,929 组通过。

## 第一份本地候选：构建成功、GUI 未通过

本轮 React 渲染构建和 Windows x64 NSIS 构建成功，NSIS 日志为 `.local/analysis/playback-20261126/build.log`，包位于 `dist/playback-20261126/candidate/`。未配置 Authenticode 证书。下列身份只用于保留第一次失败测试，**不是可发布或已通过验收的最终候选**：

| 首包文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `hongguo-downloader-6.38-win-x64-setup.exe` | 157170791 | `da95e23f0ceb207c0237a5429c8c5a06464d6bbd200786e12a8cb19a5492d064` |
| `win-unpacked/红果短剧.exe` | 250521088 | `970a53125114099ca54b587a6f4b27a8b523579b3c427aa933be03bdc51e487d` |
| `win-unpacked/resources/app.asar` | 12237450 | `59d666590100b6d6b53e8fda30ff3da4212715ea4ba4a0e2f42eba67049f45de` |

北京时间 2026-11-26 01:04:41–01:05:04，实际运行上述 `6.38.0`、`packaged=true` 程序及本轮随机完整媒体，首帧 360×640，持续观察 10.168 秒、媒体推进 10.167219 秒，新增解码与呈现各 253 帧；`muted=true`、volume 0，静音违规 0。

随后 **真实拖动未完成**：`failure.phase=seek`、原因 `The actual production seek did not complete`；失败时仍有解码计数和视频画面，`failure-frame.png` 目视确认加载超时遮罩仍在。不能以继续出帧、非零时间或已有画面将 seek 判为通过，也不能在没有进一步证据时把它定性为解码器失败。首包完整 GUI 总结为 `passed=false`、`formalAcceptanceComplete=false`，此失败保留；修复后的新包结果见下一节。

回执为 `dist/playback-20261126/local/result.json`，截图 `first-frame.png`、`failure-frame.png`，命令摘要 `.local/analysis/playback-20261126/playback-local.log`。该运行未测试官方在线取源或账号授权，也没有走到后续完整交互与连播验收。首包哈希仅为历史身份，候选输出目录后来已重建；目录中的 blockmap 及原始 builder 清单不是正式资产集。最终 CI 必须重新组装、测试和核验两个资产，不能把下面的新结果倒写为首包通过。

## 新本地候选：播放器及公开线路基础对照通过

修复后重新构建并测试的程序仍为 `6.38.0`、`packaged=true`，不是已冻结标签或正式 CI 候选。新包身份如下；14 个生产/Renderer 文件与当前源码匹配，见 `.local/analysis/playback-20261126/asar-source-check.json`，`mismatches=[]`：

| 新包文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `hongguo-downloader-6.38-win-x64-setup.exe` | 157170449 | `40d1863eaff21824571592f70dc74a8669d75f96915959b4be8a71fc33abda47` |
| `win-unpacked/红果短剧.exe` | 250521088 | `b35639096b47accd998330823d495a0f95808d17f422f7fde1ac390bdf28d456` |
| `win-unpacked/resources/app.asar` | 12237570 | `473b7f8f4f30dccea446c5ef85c43aa48d0da4356f58eb4b0e18d9a671223a19` |

### 本机交互

2026-11-26 01:13:06–01:14:03（北京时间）`dist/playback-20261126/local-rerun/result.json` 为 `passed=true`、`formalAcceptanceComplete=true`。使用本轮随机官网完整第 1、2 集：首帧 360×640，观察 10.213 秒、媒体推进 10.212801 秒、解码与呈现各新增 255 帧。真实 seek、1.25 倍速及恢复、全屏往返、同一视频节点画中画、暂停保存后重启恢复进度、真实损坏后恢复相同字节并手动重试，以及真实 ended 1→2 后继续 10.197 秒均通过。

`formalAcceptanceComplete` 只针对该脚本完整的本机素材交互，`officialNetworkResolutionTested=false`、`accountAuthenticationTested=false`；不能当作目标第 22 集、官方取源或账号授权通过。

### 空库公开在线与新进程重启

01:15:17–01:16:00 的 `dist/playback-20261126/online-public/result.json` 为 `passed=true`、`officialNetworkResolutionTested=true`。下载目录为空、任务和完整文件均为 0；真实首页 24 卡，搜索 23 项，详情有实际简介和 71 集目录。通过现有 `playSeries` 产品入口使用既有 `compat` H.264 / 官网优先选项，公开第 1 集出 360×640 首帧，连续观察 10.215 秒并新增解码/呈现各 255 帧，seek 通过；拖到近片尾后触发真实 ended，1→2 后继续 10.145 秒。没有将拖近片尾的检查当作整集正常速度播放完成。

退出后以同一隔离 profile 启动新进程，不提供本机媒体，重新在线取源，第 1 集呈现帧后继续 5.085 秒、解码/呈现各新增 127 帧。诊断为 `signed-out`、`official-web-public-fallback`，App 各请求路线 attempts 均为 0；它证明公开官网链路，不证明 App 空正文或账号授权恢复。

两份运行均在启动前命令行静音，video muted、volume 0、违规 0。01:16:39 的 `.local/analysis/playback-20261126/independent-process-check.json` 记录 ADB / scrcpy 进程数 0，未操作手机，物理 USB 和手机电源状态未观测；验收后已恢复 ApkStart。不能把这些结果写成实际关闭了手机或拔掉 USB，也不将静音回归写成声音输出质量测试。

## 主要验收中后段：尚未恢复

01:13:50–01:13:51 重新获取目标剧 88 集目录，当前声明公开范围 3 集。精确第 6 / `7706406282504178712`、22 / `7706406350871333912`、34 / `7706406366025370648`、68 / `7706406268088355864`、88 / `7706406374967610392` 页面均为 HTTP 404、44,801 字节 HTML，没有匹配分集媒体或首帧。每集均未通过实际播放；官网入口范围不推定 App、账号、付费或 DRM 结果。

`later-public-pages.json` / `.har` 只含公开 HTML GET，无 App API、签名、注册或媒体请求。REA 对 6/6 条记录的母证据为 `ev_5a00b05412bfa8952d56aa2aa00d079f35eb596cdbd327fa1e5814d1c1308c68`，HAR SHA-256 `f2d3b67f7faf6cb1bcdeec984a9c0ed36b5e8e91eedbe5f398c48c52319e1c56`；REA 归属标记为未知，不是 Android 运行流量。

01:15:47–01:15:59 的 `fresh-public-catalog.json` 另查当前真人剧分类前 24 条有效目录，全部声明公开范围 3 集，没有“集号至少 20、位于后半段且仍在当次公开范围”的候选。该样本不是历史随机 24 部的重建，不是全平台结论，也没有进行媒体下载。公开范围会变化，不能写死；早先基础素材采集时的 5 集范围与此时 3 集分别保留。第 1、2 集基础通过没有改变这里的未通过结论。

## 复现与验证命令

临时目录必须位于项目内。先将 `TEMP` / `TMP` 设为项目 `.local/analysis/playback-20261126/tmp`，确保目录存在；测试脚本使用独立 profile，不能覆盖用户正式安装或账号。

```powershell
node scripts/check-release-version.cjs
node scripts/release-notes.cjs v6.38
node scripts/check-windows-installer.cjs --config
npm test
npm audit --json
npm run build:installer
```

真实播放用现有 `verify-playback-online.cjs`、`check-playback-live.cjs --require-continuation`、`verify-playback-later.cjs`，显式传入当前 `dist/win-unpacked/红果短剧.exe`、真实随机素材 manifest 与新的项目内输出目录。主要验收目标剧第 6、22、34、68、88 集；每集先确认身份和合法来源，再记录实际 GUI 结果。公开入口 404 或没有合法媒体时如实保留该阶段失败，不冒记为播放器通过，也不使用 App 签名探测冒充 Android 成功记录。第 1、2 集只作基础对照，不能代替中后段结果。复用 6.37 素材时保留素材原始获取日期，另记本次程序、ASAR 与运行日期。

错误矩阵应覆盖无网络、超时、403/404/500、空正文、非法 JSON、业务失败、地址到期、HLS 清单/分片、媒体格式、解码、切集/连播和取消；模拟 HTTP/媒体只用于回归，不宣称真实服务通过。

## 发行门禁与旧版提示

正式发布必须绑定不可变标签 `v6.38` 的确切冻结提交；标签 push 的 Test 与 Windows 候选均成功后，使用 `Publish validated Windows release` 发布同一受测资产。安装回执要求 `passed`、`crossVersionUpgradeTested`、`sameVersionAccountRetentionTested`、`accountUpgradeRetentionTested`、`accountUninstallTested` 均为 true，不在本机正式安装上测试。

正式下载资产仅为 `hongguo-downloader-6.38-win-x64-setup.exe` 和匹配 `latest.yml`。保持旧 Releases、EXE 及旧客户端所需更新清单；不上传本地 APK、抓包、原始素材、账号资料、调试工具、便携包或 hash 清单。GitHub 自动源码快照按平台行为保留。

`availableRelease` 版本回归覆盖旧两段/内部三段版本与 6.38；这只验证版本比较。`latest.yml` 须为 6.38.0，路径、大小、SHA-256/SHA-512 与同一 EXE 对应。发布后还要运行真实 v6.37 → v6.38 更新流程，才能声称旧版实际收到提示并升级；较旧客户端仍沿用各自原有更新行为，不承诺所有历史网络环境。

发行前重新读取开放 Issues、PR、Dependabot、CodeQL、Secret Scanning 和远端分支。仅处理实际开放问题，回复说明后关闭已修复 Issue；保留 main，清理分支前保全独有内容。前一版本或任务开始时的零告警不能代替本次最终检查。

### 本轮只读仓库快照

2026-11-26 00:52:53（北京时间）通过 GitHub API 全分页读取：开放 Issues、PR、Dependabot、CodeQL 和 Secret Scanning 均为 0；远端仅 `main`，SHA 为 `b36138579fc9b24162a9248ee92da5e9baccaf48`，`v6.38` 尚不存在。当前 main 对应 Test `45642583654` 和 CodeQL `45642583630` 成功，但不是尚未提交修复的验证。

`main` 启用规则集 `27553330`（Protect main history），只要求禁止删除与非快进更新，无 bypass actor；没有经典保护中的 PR/必需状态检查规则。`windows-release` 环境只允许 main 分支，无必需人工审核规则。即使允许普通快进推送，发布仍须满足工作流对标签 push、冻结 SHA、完整安装回执及确切资产的独立校验；不能用普通分支或 build-only 候选代替。正式发布前仍需重新检查此快照。

## 发布回执

当前尚未填写冻结提交、标签/安全运行 ID、安装器五项标志、正式资产身份、发布时间或旧版更新运行。只有实际完成后才能将相应段落改为已发布；缺少目标集证据时继续保留其未通过结论，不因维护版发布而改写。

## 使用与故障排查

1. 正常从现有搜索/发现进入详情并选择目标集；不要以进度数字判断画面成功。
2. 失败后展开“诊断详情”，记录本次诊断 ID、阶段、HTTP、故障类型与各线路事件；复制/导出会过滤敏感字段。
3. 网络恢复后手动重试；地址失效使用“重新连接片源”；只有明确解码问题才尝试既有兼容模式。明确账号会话错误到“红果账号”检查，不能把普通空正文当作登录成功即可解决。
4. 没有合法媒体、需要官方授权或格式尚不支持时，保留诊断并使用官方支持的入口，不反复请求或绕过保护。
5. 提交配对证据前删除 Cookie、Token、签名、设备 ID 和完整媒体地址，原始文件仅保留在本机受保护目录。

## 已知限制

- 主要验收的第 6、22、34、68、88 集尚未真实播放成功；官网缺集与 App 空正文的根本服务端原因未由 Android 成功会话证实。
- APK 静态检查和签名结构不证明运行时接口、账号授权或发行者真实性；未绕过 TLS、DRM、付费或账号认证。
- 源码链路不依赖手机/ADB，仍不能将未观测物理状态写成已替用户关闭手机和拔掉 USB。
- DASH、官方 DRM/CDM、所有 GPU/编码和安装中断自动回滚未通过验证；静音测试不代表扬声器声音验收。
