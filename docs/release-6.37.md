# 红果短剧 6.37 发行与独立客户端验收

当前为源码目标 `6.37.0`，公开标签目标 `v6.37`，仅支持 Windows x64。正式发布状态由本文件的发行回执记录，未完成的验收不得推定为通过。

**后续集独立播放尚未全部修复。** 以下第 1、2 集完整媒体及基础播放器回归不能代表整部剧；第 5、6、34、68 集及 5→6 边界另行实测，拒绝结果不能计作播放通过。

## 交付范围

- 基于已发布 6.35 主线继续修复，没有将旧工作树 6.29 覆盖到主线。
- 修复媒体响应只有头部而没有字节时的无限等待读取，以及取消后的底层资源释放；看门狗仅对实际待决读取计时。
- 修复详情永久等待、收藏写入失败误报成功、搜索拒绝后自动补搜与 App 搜索/备用详情中的剧号、分集号精度丢失。详情显示实际接口简介，没有伪造演员或内容；编号精度缺陷不作为后段零字节响应的解释。
- 下载日志、持久化任务与 IPC 错误脱敏，保留必要故障分类。
- 后续集官网入口不可用与账号授权故障分开；跳回首集不接受错误媒体，公开窗口按实际响应判断，保留独立 App 路线的正常尝试。明确拒绝的预取不再循环，临时失败最多 3 次、90 秒内有界处理。
- 保留 Chromium 原生视频和既有 FFmpeg 兼容路径，不增加多个播放器；不修改 App 签名、设备注册、账号或访问权限。

完整架构、接口与逐项边界见 [全面审计](independent-client-audit-2026-11-25.md)。公开更新说明按用户模板从 `docs/releases/release-notes.md` 提取。

## 真实完整素材

2026-11-25 从官网 24 部真人剧随机抽取《斩断十八年错爱，亲手夺回我的钱与人生》，剧号 `7704504408356178969`。只使用官网明确允许的公开完整分集，不使用 App 接口或账号提取媒体。

| 分集 | 官方时长 | 文件时长 | 字节数 | 编码 | SHA-256 |
| --- | ---: | ---: | ---: | --- | --- |
| 1 / `7704506232622550078` | 158.869 秒 | 158.868005 秒 | 11592420 | MP4 / H.264 360×640 / AAC | `3a8a8836ac56637aec8aeb4e8601975f36e5bc2b13cd33b67266449340cc2f4b` |
| 2 / `7704506297529404478` | 103.509 秒 | 103.508005 秒 | 6331943 | MP4 / H.264 360×640 / AAC | `9505f4a37c2cb4afdde483d9c4423c12dfaf63ba4bb00d6afb9a14ccc7524fe1` |

两集均下载完整文件、匹配官方时长，以 FFmpeg 将全部视频与音轨解码至 null，错误输出为 0。全程没有声音输出。采集时包版本为 6.35.0，后续最终包验收单列，不将采集时间改成最终包执行时间。脱敏清单位于本地忽略目录 `dist/independent-audit/manifest.json`，未记录签名地址、账号、Cookie、设备 ID 或密钥。

北京时间 20:49:20–20:49:24，复用上述随机剧目及原始清单 SHA-256，在 6.37.0 实际 Electron 45.5.0 / Chromium 156.0.8078.109 的 Node 模式下重新获取当前目录，公开窗口为 5 集。第 5 集 `7704506304185764926` 完整下载为 9,015,668 字节，官方与文件时长均为 164.5 秒，H.264 360×640 / AAC；全部视频及音轨静音解码通过，解码错误为 0，文件 SHA-256 为 `a537dd31d2e08e81834e2c32e048b92e1ffa8fa0d6b758d68765c16fff8e6db1`。回执为 `dist/independent-audit/fifth/manifest.json`，保留原始随机抽样清单，没有修改 User-Agent 扩大可访问范围。该结果仍不能代替第 6 集以后的播放验收。

## 构建及复现

```powershell
npm ci --no-audit --no-fund
node scripts/capture-official-public-media.cjs --output-dir dist/independent-audit
npm test
npm run build:installer
# 在实际生产 Electron 的 Node 模式下复用原随机剧目验证第 5 集，保留原清单：
$env:ELECTRON_RUN_AS_NODE='1'
& 'dist/win-unpacked/红果短剧.exe' scripts/capture-official-public-media.cjs --series-manifest dist/independent-audit/manifest.json --indexes 5 --output-dir dist/independent-audit/fifth
Remove-Item Env:ELECTRON_RUN_AS_NODE
node scripts/verify-playback-online.cjs --through-search --manifest dist/independent-audit/manifest.json --output-dir dist/independent-audit/online --executable 'dist/win-unpacked/红果短剧.exe'
node scripts/check-playback-live.cjs --require-continuation --manifest dist/independent-audit/manifest.json --output-dir dist/independent-audit/local --executable 'dist/win-unpacked/红果短剧.exe'
node scripts/verify-playback-later.cjs --manifest dist/independent-audit/manifest.json --indexes 5,6,34,68 --ended-transition --output-dir dist/independent-audit/later --executable 'dist/win-unpacked/红果短剧.exe'
```

本地全量测试使用 `HONGGUO_VIDEO_FIXTURE`、`HONGGUO_VIDEO_FIXTURE_MANIFEST`、`HONGGUO_FFMPEG`、`HONGGUO_FFPROBE` 指向本轮上述完整文件及随包工具，避免把公开预览用于完整分集结论。公开 CI 的通用解码素材与本轮完整分集回执分别记录。

本地安装包为 `dist/hongguo-downloader-6.37-win-x64-setup.exe`，最新构建日志为 `dist/independent-audit/build-installer-final.log`；`build-installer.log` 与 `build-installer-later.log` 均作为历史构建保留。安装验收只在隔离 GitHub Windows runner 执行，禁止覆盖本机正式安装或改动正式账号。

## 后续集修复前的基础回归

本节是后续集修复前的历史回归，保留原始时间和摘要；最新候选不能使用本节旧哈希作为验收证明。

- `npm test`：554 项主单元测试及 116 组平台检查通过；下载锁定、NAS 断挂载、详情超时、拒绝响应、取消和媒体停滞回归通过。日志为 `dist/independent-audit/npm-test.log`。
- `npm audit --json`：生产与开发依赖合计 0 项漏洞。原始回执为 `dist/independent-audit/npm-audit.json`。
- 本地 NSIS EXE：157,160,895 字节，SHA-256 `a4d04883e25ad8368663805843207e8ef3c2f7c7dfb49194443812b28909abfa`。这不是尚未构建的 CI 发行资产摘要。
- 本地打包程序 `6.37.0` 的 ASAR SHA-256 为 `8c760cba942785d6ce883eb15e9af9f09051e6fe9a69738ef9732a630b021ced`；以下两次 GUI 回执绑定同一 ASAR。
- 北京时间 20:19:25–20:20:09，空白资料实际加载首页 24 项、搜索返回 26 项、目标详情 68 集并显示真实简介；第 1 集首帧为 360×640，持续播放 10.245 秒并新增呈现 256 帧，拖动和真实 ended 后第二集继续播放通过。
- 同次新进程重启后账号为未登录，重新获得官网公开线路首帧并推进 5.121 秒、128 帧；重启前后下载任务和独立下载目录条目均为 0。回执为 `dist/independent-audit/online/result.json`。
- 北京时间 20:20:36–20:21:14，真实完整文件的播放、拖动、1.25 倍速、全屏、同一视频节点画中画、暂停保存、重启及损坏独立副本后的手动重试通过；恢复后继续播放，真实 ended 自动切至第二个不同完整文件。回执为 `dist/independent-audit/local/result.json`，`passed` 和 `formalAcceptanceComplete` 均为 `true`，未使用诊断逃生参数。
- 两次 GUI 全程启动即静音、音量 0、静音违规 0。已目视核对详情、在线首帧、全屏及画中画截图；没有将帧计数替代画面查看。

## 后续集修复后的第二次本地候选（历史）

本节及其后段专项保留第二次构建的原始哈希、时间和结果；最终本地候选另列于下一节。

- `npm test`：567 项主单元测试及 116 组平台检查全部通过，日志 `dist/independent-audit/npm-test-later.log`。
- `npm audit --json`：生产及开发依赖合计 0 项漏洞，回执 `dist/independent-audit/npm-audit-later.json`。
- `npm run build:installer`：通过，日志 `dist/independent-audit/build-installer-later.log`。新 EXE 为 157,161,397 字节，SHA-256 `2b53705429622f59e2566ed4a34eaf1206f98387ee71d0a01e2eb5179456b0c9`。
- 新 ASAR SHA-256 `5e2e9370990f7b991a72f3780e9941bb34a8a1477b87344fc9b8e7d7987d405f`，已逐字核对 6 个关键后端文件与工作区源码一致。
- `online-later-build/result.json`：北京时间 20:39:47–20:40:35，真实首页、搜索、详情、前两集在线首帧/拖动/连播及新进程重启通过，始终没有下载任务或本地完整媒体。
- `local-later-build/result.json`：北京时间 20:40:42–20:41:20，前两集完整素材的原生播放、倍速、全屏、画中画、进度保存、损坏副本恢复后重试及连播通过。

### 后段专项实际结果

`dist/independent-audit/later/result.json` 绑定上述同一新 ASAR，执行于北京时间 20:42:17–20:44:06。
完整目录由生产 `searchResolve` 真实注册，共 68 集；每个单集用例重新启动进程，账号未登录、下载目录为空、关闭预取，不预置虚构的可播状态。

| 用例 | 实际结果 | 播放验收 |
| --- | --- | --- |
| 第 5 集 | 官网公开完整线路，164.5 秒、360×640；出现新首帧，观察 3.040 秒、增加 76 个呈现帧；另行完整下载和全文件静音解码通过。 | 首帧、短时持续播放及完整文件解码通过，不等于整集实时观看验收。 |
| 第 6 集 | 三条既有 App 路线各请求一次，均 `API_EMPTY_RESPONSE`；官网未提供目标分集，显示 `WEB_EPISODE_UNAVAILABLE`。 | 未通过。 |
| 第 34 集 | 同上，独立新进程实测。 | 未通过。 |
| 第 68 集 | 同上，独立新进程实测。 | 未通过。 |
| 真实 5→6 连播 | 开启真实预取，第 5 集实际 ended 后选中第 6 集并明确失败；没有回播首集。 | 后续集播放未通过，安全停止通过。 |

各失败用例继续观察至少 16 秒，取源次数没有继续增长，没有新增首帧、错误分集播放、自动扫码或下载任务；保留画面和手动重试。矩阵 `technicalChecksPassed=true` 仅表示这些技术保护通过，`laterPlaybackPassed=false` 才是后段播放结论。第 6、34、68 集没有取得合法可播放资源，不能将本版称作红果整部剧独立播放已修复。没有以改变设备画像、猜改签名或提取受保护凭据填补该缺口。

## 最终本地候选与 GUI 复测

以下为同一最终 Windows x64 包的新执行回执，不改写前两次历史构建或第 5 集独立采集时间。`npm-test-final.log` 记录 567/567 主单元测试、0 失败及 116 组平台检查全部通过；`npm-audit-final.json` 记录生产与开发依赖合计 0 项漏洞。`npm run build:installer` 成功，日志为 `dist/independent-audit/build-installer-final.log`；未配置代码签名证书，构建日志另有包体积警告。

| 最终产物 | 字节身份 / SHA-256 |
| --- | --- |
| 安装 EXE | 157,161,512 字节；`0b865ec1a78289f03e9aabe666490d9dbbe89f4b0c464abafba12d214d5065f6` |
| 实际运行 EXE | `d32361729111607c19b477cc5bb855b529df819221703f5d86e62c4a64d1ae93` |
| `resources/app.asar` | `a8a00b5c01188cd4901acb98eaeb1edec12c21bb2235156363f60f463ccc0ee7` |

`final-package.json` 及实际文件摘要已相互核对；ASAR 中 7 个关键主进程、preload 和后端文件与工作区一致。以下三个 GUI 回执均为 `6.37.0`、`packaged=true`，绑定上述同一运行 EXE 与 ASAR。

| 回执（均在 `dist/independent-audit/`） | 北京时间及实际结果 |
| --- | --- |
| `online-final/result.json` | 21:05:27–21:06:11，`passed=true`。空剧库真实首页 24 项、搜索 23 项、详情 68 集和真实简介；第 1 集首帧 360×640，持续 10.115 秒、253 个新增呈现帧，seek 后继续；真实 ended 切至第 2 集后持续 10.218 秒、256 帧。未登录新进程重新取源后持续 5.079 秒、127 帧；下载任务及本地完整媒体始终为 0。 |
| `local-final/result.json` | 21:06:11–21:06:57，`passed=true`、`formalAcceptanceComplete=true`。使用原随机剧目的两集完整文件，首帧、拖动、倍速、全屏、同一节点画中画、实际损坏副本恢复和手动重试、保存进度及真实 ended 连播通过。该 formal 标志只涵盖脚本规定的两集交互；不是物理断网、在线取源或整部剧验收。 |
| `later-final/result.json` | 21:03:17–21:05:15，`technicalChecksPassed=true`、`laterPlaybackPassed=false`。真实目录仍为 68 集，当次公开窗口为 5；第 5 集首帧及 3.054 秒短时播放通过，新增呈现 77 帧。第 6、34、68 集各三条 App 路线仍为空正文，官网未提供目标集，均明确失败；分别稳定观察 16.034、16.027、16.029 秒。真实 5→6 ended 转换也明确失败，再观察 16.029 秒无重复取源、错误分集播放或自动扫码。 |

后段直接选集用例关闭预取、各自新进程；5→6 转换开启真实预取，累计请求不能套用直接选集计数。第 6、34、68 集均没有首帧，不能将保留的前集画面计作目标集播放。最终截图已目视复核，全部测试启动即静音、音量 0、静音违规 0，未使用 ADB 或手机传输；物理手机关闭及 USB 断开未观测。官网公开资源通过仍不证明账号额外权益或 DRM，App 空正文的服务端原因仍未知。

## 发行门禁

本轮本地测试与后段矩阵执行完毕时（后段播放未通过），公开最新版本仍为 v6.35；开放 Issues、PR、Dependabot、CodeQL、Secret Scanning 告警均为 0。v6.37 仍须以同一冻结提交通过标签 Test、Windows 候选、隔离安装与发布工作流，再单独执行 v6.35 → v6.37 真实应用内更新。正式回执在完成后登记，不能由本地构建推定通过。

## 已知限制

- 真实手机电源和 USB 物理连接状态无法由当前环境观测；验收进程没有使用 ADB、模拟器、投屏或手机网络转发。不将该事实表述为替用户实际关闭了手机。
- App HTTP 200 空正文仍未恢复；公开完整分集通过不代表受限分集、付费授权或 DRM 已通过。
- 音轨静音解码不代表扬声器声音验收。HEVC 全硬件矩阵、DASH、官方 DRM/CDM 与安装中途自动回滚未验证。
- 现有其他工作树及其未提交代码保留；本工作区原始改动已另存备份并保留于 Git stash。
