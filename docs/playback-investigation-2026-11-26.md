# 2026-11-26 播放故障专项调查

本报告对应 v6.37 故障调查与 6.38.0 修复工作。代码修复、离线回归、真实官方取源、画面验收和发行验收分别记录，不能相互替代。最终执行回执统一补充到 [6.38 发行记录](release-6.38.md)。

**主要验收对象是目标剧第 22 集及中后段分集。** 第 6、22、34、68、88 集本轮最新精确公开页面均返回 404，Windows 尚未取得这些集的合法媒体及实际播放成功证据。新 6.38 包的第 1、2 集本机交互和公开官网在线基础对照已通过，但不能代表中后段、整部剧或账号授权通过；逐集证据和边界见下文。

**发行状态：暂停，未发布。** 用户最新要求是后面的集没有修复就不发布新版本。已推送的 `fbdfb5d6e479364b8865f3810fcda9a80e17ad6e` 只是源码修复检查点；没有 `v6.38` 标签或 Release，公开最新版保持 `v6.37`。本轮本地包和更新说明只供开发验证，不将前两集基础对照作为发行理由。

## 当前能回答与不能回答的问题

- 已确认三个客户端缺陷：官网 HTML 404/410 过早阻止独立 App 提供方；聚合错误及 IPC 丢失原始阶段和 HTTP 状态；切集或失败后旧视频时间与过早的播放状态可能留在界面。
- 已取得目标剧官网公开 HTML 的实际结果：剧目录存在，第 22 集精确页面返回 HTTP 404。未取得该集合法可用的媒体地址或真实首帧。
- 新 6.38 打包程序已通过本机真实素材交互、空白下载库中的官网公开在线搜索到播放及重启回归；使用既有 H.264 / 官网优先选项，App 请求路线均为 0 次。它们只覆盖公开第 1、2 集基础链路，不能证明目标中后段恢复。
- 用户截图标题为《嫌疑人的秘密2：藏宝生死线》；本轮官网同一剧号返回《嫌疑人的秘密2藏金生死线》，88 集。保留这一名称差异，不据标题文字擅自改写剧目身份。
- REA 已读取用户提供 APK 的清单、资源和代码索引。随后在已授权手机上，通过官方客户端正常搜索与选集，直接观察到第 22 集真实画面及短时持续变化；仍未取得该集成功请求和响应正文。静态接口候选、可见画面和成功网络记录是三种不同证据。
- 第 22 集在这台手机的当前官方客户端环境中可播，已由可见画面确认。Windows 缺少的合法会话、请求字段或响应映射仍未由同集成功网络记录证实；不能将 HTTP 200 空正文推定为 DRM、付费、账号无权或 Windows 解码器问题。

## 审计范围与架构

项目沿用 Electron 45.5.0、React 19、Vite 8、Chromium 原生 `video` 和已有 FFmpeg H.264 兼容路径。本轮不替换播放器内核，也不调整侧栏、主窗口布局或内容授权范围。

| 模块 | 实际实现 | 职责 |
| --- | --- | --- |
| 主进程与生命周期 | `main.js`、`src/native/app-entry.cjs` | 窗口、IPC、任务、媒体协议、安装与退出保护 |
| Renderer 与页面 | `src/App.jsx`、`src/components/Player.jsx` | 导航、选集、重试、媒体事件、画中画与诊断 |
| 安全 IPC | `preload.js` | 搜索、详情、取源、释放、状态上报和诊断导出 |
| 搜索与详情 | `main.js` 的 `search-series` / `search-resolve`；`src/native/hongguo.js` 的 `fetchEpisodeList` | 真实搜索、完整目录、简介及本机资料映射 |
| App 取源 | `src/native/app-source.js`、`playback-profiles.js` | 版本化请求配置、HTTP/JSON/模型解析及分集身份验证 |
| 官网取源 | `src/native/hongguo.js`、`official-web-playback.js` | 精确分集 HTML、公开范围、合法完整片源及媒体完整性校验 |
| 统一调度与会话 | `playback-manager.js`、`account-session.js`、`media-url-manager.js` | 取消、并发、期限、账号代次、地址有效期与媒体身份 |
| 媒体读取 | `main.js` 的 `requestMedia` / `registerStreamProtocol`；`hls-media.js`、`media-response-body.js` | 上游请求头、重定向检查、Range、HLS、本地流和取消释放 |
| 缓存、下载与历史 | `main.js` 的在线缓存、下载任务、`history-*` IPC；`src/store.js` | 按剧集隔离媒体、完整本机文件、断点和任务生命周期 |
| 错误与日志 | `playback-errors.js`、`playback-diagnostics.js`、Renderer 的 `playbackRecovery.mjs` | 故障分类、有界恢复、逐次脱敏追踪与报告 |

上述路径均为现有仓库实现；函数存在不等于真实官方服务可用。

## 从截图错误反向追踪

开始调查时，在产品源码中搜索用户提供的完整前缀“官方在当前环境下未提供本集可用的完整片源”，没有逐字匹配。v6.37 对应的规范错误文案位于 `src/components/playbackRecovery.mjs` 的 `FAULT_MESSAGES.WEB_EPISODE_UNAVAILABLE`，使用“官网在当前环境下……”；原文同时存在于诊断消息映射。不能将这一个字的差异当作已验证截图包的源码身份。

反向链为：

```text
Player.jsx 的 recoverOnlineFailure / 错误占位
  <- playbackFaultMessage / playbackFaultCode
  <- prepareOnlinePlay 的失败结果或 online-play-diagnostics 事件
  <- main.js: prepare-online-play / withMediaRecovery
  <- playback-manager.js: createPlaybackManager.resolve
  <- hongguo.js: fetchPlayUrlSingle -> resolvePlayUrlSingle
  <- fetchPlayUrlFresh / fetchAppPlayUrlForQuality
  <- 官网 HTML / official-web-playback，或 App fetchAppPlayUrl
```

官网分集校验在 `official-web-playback.js:publicEpisodePermission`：核对剧号、目标视频号、真实目录、当前页面视频号和响应给出的可访问集数；明确账号条件另行分类。页面跳回首集不接受为第 22 集，网页入口没有目标集也不表示所有独立提供方均拒绝。`officialDuration` 只读取必要时长信息，不使用受保护响应中的地址或密钥替代授权。

### 时间 0:04 / 2:31 的来源边界

`PlayerControls.jsx` 的媒体同步函数读取实际 DOM `video.currentTime` 与 `video.duration`，没有用剧集列表时长或预设 duration 绘制时间。`Player.jsx:handleMetadata` 可根据已存观看进度设置 `currentTime`，所以非零时间也不证明用户已经看到画面。

已确认失败处理此前没有完全清除旧 `src`，而控制栏在当前媒体不可用时仍读取旧节点时间和时长。因此上集已加载的 metadata 或恢复进度可能残留；这能够解释“黑屏且仍显示时间”的客户端路径，但缺少截图当时的诊断，不能证明该截图一定经历此路径。

本轮官网剧入口的 SEO 时长为 151.914 秒，属于首集 `7706406239239932952`，与 2:31 接近。目标第 22 集为 `7706406350871333912`。这个数值接近只是一条线索，不能认定截图时间来自 SEO、HLS、DASH 或成功加载的第 22 集媒体。验证播放必须进一步检查匹配媒体会话、真实解码尺寸、呈现帧和持续推进。

## 正向实际调用链

```text
用户从详情/播放器选集
  -> preload.js: playSeries / main.js: play-series 与 navigateToPlayer
  -> hongguo.js: fetchEpisodeList -> fetchEpisodeListFresh
  -> Player.jsx: startOnlinePlay -> waitForPrepared
  -> preload.js: prepareOnlinePlay -> main.js: prepare-online-play
  -> main.js: withMediaRecovery
  -> hongguo.js: fetchPlayUrlSingle -> playback-manager.resolve
  -> resolvePlayUrlSingle -> fetchPlayUrlFresh / fetchAppPlayUrlForQuality
  -> 官网精确分集页 + resolveOfficialPublicPlayback，或 app-source.fetchAppPlayUrl
  -> requestJson / publicApiBody 解析业务和响应结构
  -> validateAppModelIdentity / parseAppPlayModel，或 publicEpisodePermission / fallbackMedia
  -> media-url-manager: bindMediaSession / isMediaExpired
  -> main.js: requestMedia / registerStreamProtocol，HLS 使用现有 remuxHls
  -> 随机会话的 hongguo-* 本地流地址，不把原始签名地址交给页面
  -> Player.jsx: handleMetadata、loadeddata、playing 和首帧回调
  -> confirmPlaybackStarted：匹配当前媒体、真实呈现帧、非暂停
  -> reportPlaybackState: playback-success，随后保存进度/允许后续预取
```

这条路径由 Windows 自己请求和解码，不包含 ADB、投屏或手机视频服务器。物理关闭手机和拔掉 USB 是另一项实际验收，不能由源码检查代替。

## REA 实际安装与使用

已确认工具为 `rea-agents` 提供的 REA CLI 6.10.1，入口 `C:\Users\18155\AppData\Roaming\npm\rea.ps1`，实现位于同级 `node_modules/rea-agents/scripts/rea.mjs`。本轮阅读本地帮助和 REA Android/连接指南后使用其静态 Android 与保留抓包分析能力，没有假定它是另一款同名抓包 GUI。

为补齐 Android 静态分析依赖，仅在项目 `.local/tools/rea-jadx/` 安装 Eclipse Temurin JDK 21.0.13.1+2 与 `jadx-headless-mcp` 0.7.1。下载分别与官方 SHA-256 / GitHub 资产 digest 核对；REA doctor 报告可用。没有更改系统证书、代理、安全设置或永久 PATH。

| 证据 | 本轮观察 | 限制 |
| --- | --- | --- |
| 用户 APK | 156,400,488 字节；SHA-256 `22c1dc79c465794b9f53a75076195dd3ec1dec307847ed9032d72a95656f3cf6` | 哈希只标识文件，不证明官方来源或签名有效 |
| Android 包静态检查 | `com.phoenix.read`，7.4.5.32 / 74532，min SDK 21、target SDK 35；156,703 类、23,963 资源 | 未执行 APK，组件清单输出达到 512 条上限 |
| APK 签名结构 | 存在 v1/v2/v3，自述摘要一致 | REA 明确未执行密码学签名、证书链或发行者真实性验证 |
| 手机官方客户端实际画面 | 授权 ADB 读取实际安装版本 7.4.5.32 / 74532；正常搜索、88 集选集和第 22 集画面，8 秒屏幕采样前后均确认第 22 集 | 普通 ADB / 系统录屏观察，不是 REA 网络抓包；未验证安装 APK 与所给文件逐字节相同，也未证明媒体来自新网络请求而非合法缓存 |
| 官网公开 HTML | 精确剧/集页面 HTTP、HTML 字节数及 router 摘要 | 不是 Android 请求，不是媒体或成功播放证据 |
| Android 同集网络 | 未取得 | 无法比较实际 Cookie/Token、设备条件或成功地址链路 |

原始证据保留在忽略目录 `.local/analysis/playback-20261126/`：`android-package-evidence.json`、`apk-signature-evidence.json`、`public-episode-pages.json`、`public-pages.har`，以及后续的 `later-public-pages.json` / `.har`、`later-public-rea-evidence.json`、`later-public-rea-summary.json` 和 `fresh-public-catalog.json` / `.har`。公开文档不嵌入原始类清单、账号、设备唯一标识或带签名媒体地址。

### 可接收的网络记录

CLI 本地帮助确认：`rea inspect-web-network-capture <capturePath> <har|mitmproxy|saz|qlog>` 可读取保留抓包，并支持 `--record`、`--detail summary`、`--evidence_output`、`--json`。它不等于已经建立了 Android TLS 抓包，也不会因导入文件自动重新访问其中 URL。

优先使用官方客户端支持的诊断导出或现成、已获合法授权且不降低 TLS 安全性的抓包记录。若记录器支持，导出带响应内容的 HAR 1.2、SAZ 或原生 mitmproxy 文件；QUIC 传输级 qlog 本身通常不能代替所需业务正文。TLS 或证书固定阻止合法记录时，应保留证据缺口，不关闭证书校验、不绕过固定、不提取认证密钥。

需要的同集记录顺序：打开目标详情、取得 88 集目录、点击第 22 集、播放信息、合法媒体地址、实际清单/分片或 Range 请求、继续出帧后的请求。保留时间、方法、主机与路径、参数字段名、状态、响应字节数、业务结构、媒体类型与重定向；敏感字段值只留在受保护本机资料中。

网页单独复现可在浏览器 F12 的 Network 中启用 Preserve log，清空后复现并导出 HAR with content。必须标为“桌面官网”，不能标为“Android 正常播放”。本轮 `public-pages.har` 仅含官网公开 HTML GET。

分享或提交前删除完整 Cookie、Authorization、Token、签名参数、设备唯一标识、账号信息和完整媒体 URL；保留字段名、状态和可关联的脱敏标识。原始记录只放本机忽略目录，不能放入 Release 资产。

## 同剧同集的证据对比

官网采集时间为 2026-11-26 00:33:15（北京时间）。剧号为 `7706404415887903806`，目标第 22 集 ID 为 `7706406350871333912`。

| 比较项 | 官网 / Windows 已知事实 | Android 正常播放 |
| --- | --- | --- |
| 剧入口 | GET `/player/7706404415887903806`，HTTP 200、256,066 字节 HTML | 未记录 |
| 入口当前视频 | 首集 `7706406239239932952`，目录 88 集，可访问集数 3 | 未记录 |
| 第 22 集精确入口 | GET `/player/7706404415887903806/7706406350871333912`，HTTP 404、44,801 字节 HTML | 未记录 |
| 平台页面条件 | `pcLoginRequired=false`、`pcAuthenticatedPlayback=false`、`encryptedBrowserAllowed=false`、`payType=0` | 未记录；不从官网字段推定 App 授权 |
| 第 22 集媒体地址/格式 | 本次 HTML 证据没有返回合法媒体地址；没有清单、分片或解码 | 未记录 |
| Cookie/Token/有效会话 | 该 HTML 采集未使用账号或签名请求 | 未记录，不能判断需要哪些合法字段 |
| 正常播放 | Windows 未取得目标集真实首帧和持续画面 | 01:48:27–01:48:38 正常选集后的第 22 集画面变化已直接观察；未取得成功请求/响应，不扩展为所有设备或账号均可播 |

Windows 当前源码的官网路径还包括 POST `/api/video/protected/play-info` 与 `/api/video/protected/fallback-play-info`，采用 JSON、`X-Xs-From-Web: 1`、Origin/Referer 和 `aid=8662`。只在精确分集与公开许可条件通过后使用；不能把这些源码常量写成 Android 运行时实测。

Windows App 既有主配置为 7.4.5.32，POST `reading.snssdk.com/novel/player/multi_video_model/preload/v1` 与备用同路径，以及 GET `api5-normal-sinfonlineb.fqnovel.com/reading/bookapi/video_tab/multi_video_model/v1/`。仓库另保留上游源码来源的兼容候选，来源标为 `source-only`；本轮不把它们的存在或 APK 版本相同当作正常取源证据，不猜改签名常量。

### 手机官方客户端实测：第 22 集有画面，成功网络记录仍缺失

用户确认手机可播后，2026-11-26 01:36 起在一台已授权连接、已解锁的手机上进行正常 UI 调试。实际安装包名为 `com.phoenix.read`，系统包管理器报告 7.4.5.32 / 74532；这与所给 APK 的声明版本一致，但未提取手机私有资料或校验已安装包的完整文件哈希。没有把手机当作 Windows 媒体服务或生产依赖。

电脑常用路径与 ApkStart 工具路径未找到可执行 ADB，按用户已授权的缺失工具安装范围，将 Google 官方 SDK Platform-Tools 37.0.3 / ADB 1.0.41 安装到项目 `.local/tools/android-platform-tools/`。Windows ZIP 为 8,188,601 字节，与 Google 仓库 XML 的大小及 SHA-1 `7fea85bc18d0480bc81d3603952d666f49496e5a` 一致；另计算本地 SHA-256 `89d108360a3bf2924d3bea837239edaccc22fd6ff5befd3787c4348a9fe4f09d`，不将其称为供应方公布的 SHA-256。未改系统 PATH。

调试先验证媒体流静音，再通过官方导出的启动 Activity 打开客户端，使用正常搜索键盘输入“嫌疑人”，选择结果《嫌疑人的秘密2藏金生死线》，选集面板显示第 2 季、共 88 集。第 22 集是面板中正常可选条目，没有强启未导出 Activity 或内部调试入口。

01:45:41 首次截图已经显示第 22 集和实际画面，之后采样时界面已自动进入第 23 集，因此首轮后续截图与录屏**排除出第 22 集持续播放证据**，原文件保留并在回执标记，不按文件名推断集号。重新打开选集并选择第 22 集后：

- 01:48:27.741 的 `episode22-confirmed-start.png` 和 01:48:37.338 的 `episode22-confirmed-end.png` 均经目视核对，显示同名短剧与“第22集”，实际画面不同。
- 01:48:27.792–01:48:36.126 使用系统 `screenrecord` 请求 8 秒无音轨屏幕采样，得到 2,279,833 字节、1080×2400 的 H.264 录屏。ffprobe 读取 218 帧，FFmpeg 解码退出 0；排除顶部时钟、右侧控件和底部进度的中央 840×1400 区域，以每秒 2 帧取样得到 17 个不同画面哈希。
- 这些计数属于**屏幕录制文件**，不是官方播放器原始解码器统计，也不是片源编码、媒体时长或整集播放验收。屏幕录制没有更改内容保护标志；不能据此推断媒体是否受保护。
- 01:48:38 暂停后，01:51:42 再次目视确认仍为第 22 集及暂停图标。调试结束恢复原媒体音量 74/150 和原未静音状态，未关闭用户手机 App、改证书、改代理、提取凭据或读取私有文件。

上述回执及原始画面只保留在忽略目录 `.local/analysis/playback-20261126/phone-observation/`，汇总为 `result.json`，不得进入公开发行资产。它们不改变 01:16 早先 Windows 独立回归的 ADB=0 回执；后面的 ADB 仅用于这次手机开发观察。

为寻找合法请求对照，另对官方应用主进程的系统调试输出进行 40 秒有界观察，覆盖一次正常第 22 集选择。读取 336 行，白名单提取的接口候选为 0；原始行未持久化，未保存 Cookie、Token、签名、设备标识或完整媒体 URL。`scoped-log-metadata.json` 明确注明这不是抓包，空结果不能证明没有网络请求。正常播放器“更多”菜单上下滚动后也未发现请求/响应或 HAR 导出入口；这只是所查菜单的结论。REA 对反馈类与清单的定向静态查询亦未证实可用的网络导出途径，不强启内部 `NetworkToolboxActivity`、私有设置页或受限接收器。

目前可证实的对照边界为：

| 项目 | Windows 源码/既有回执 | 手机本轮证据 | 能否据此修改取源 |
| --- | --- | --- | --- |
| 实际版本 | 主配置 7.4.5.32 / 74532；兼容候选另有历史 7.4.3.32 | 实际安装 7.4.5.32 / 74532 | 版本声明相同不足以解释空响应，不能猜改画像 |
| 内容身份 | 官网目录剧号/第 22 集编号已记录 | 可见同名 88 集目录和“第22集”，无请求中的 item/asset ID | 仍需核对 episode ID 与媒体 video_id 映射 |
| 正常 App 会话 | `fetchAppPlayUrlFresh` 使用独立匿名播放身份；正常 resolver 不注入官网 Cookie/Authorization；manager 的账号 context 用于媒体代际绑定 | 未检查账号或提取会话；官方 UI 可播 | 不能认定复制 Cookie 即可修复，仍需官方支持的合法授权条件 |
| 成功端点/字段/正文 | 现有请求和解析约定可从源码追踪，空响应尚未恢复 | 本次无可用网络候选和非空响应正文 | 目前无依据改端点、签名常量或解析层级 |
| 实际画面 | Windows 第 22 集仍未取得媒体和首帧 | 正常 UI 第 22 集短时画面已观察 | 排除“本集在所有环境都不可播”；不能替代 Windows 取源修复 |

下一份必要证据是官方支持诊断渠道或已获合法授权记录器导出的**同集成功请求及非空响应结构**：实际 host/path/method、参数和请求头字段名、会话要求的状态、HTTP/业务结果、episode→asset 映射、媒体类型及后续请求关联。完整 Cookie、Token、签名、密钥和设备标识不应提交。没有成功正文前继续保留故障未知，不通过关闭证书校验、绕过认证或改用手机视频转发填补缺口。

### 中后段的最新逐集证据

2026-11-26 01:13:50–01:13:51（北京时间）重新读取同剧目录和精确分集公开 HTML。目录 HTTP 200、88 集、当次声明公开范围 3 集，当前视频仍为首集；以下精确分集页均为 44,801 字节的 HTML 404，未解析到当前集或合法媒体：

| 目标集 | 目录中的真实视频 ID | 精确公开页面 | 实际播放 |
| --- | --- | --- | --- |
| 6 | `7706406282504178712` | HTTP 404 | 未取得合法媒体，未通过 |
| 22 | `7706406350871333912` | HTTP 404 | 未取得合法媒体，未通过 |
| 34 | `7706406366025370648` | HTTP 404 | 未取得合法媒体，未通过 |
| 68 | `7706406268088355864` | HTTP 404 | 未取得合法媒体，未通过 |
| 88 | `7706406374967610392` | HTTP 404 | 未取得合法媒体，未通过 |

以上仅发送公开 HTML GET，没有账号、App API、播放 API、签名、注册或媒体请求。不能用 404 断言 Android 不可播、账号未授权、需要付费或存在 DRM，也不能将拒绝错播首集的保护记成目标集播放通过。

REA 导入这六条公开 HTML 记录的 HAR，母证据为 `ev_5a00b05412bfa8952d56aa2aa00d079f35eb596cdbd327fa1e5814d1c1308c68`，HAR SHA-256 为 `f2d3b67f7faf6cb1bcdeec984a9c0ed36b5e8e91eedbe5f398c48c52319e1c56`，保留 6/6 条记录。REA 标明运行时归属未知；这份导入是已有桌面公开记录的分析，不是 Android 成功抓包，也未重新访问记录中的 URL。

01:15:47–01:15:59 另从当前真人剧分类前 24 条有效目录独立采样，24 条均声明公开范围 3 集，未找到同时满足“集号至少 20、达到全剧一半且在当次公开范围内”的中后段候选。`fresh-public-catalog.json` 明确记录它不是最初随机 24 部的历史列表重建；本轮没有下载这些中后段媒体。这只是所查当前分类的有界观察，不是全平台无中后段公开内容的结论。公开范围可能变化，不能硬编码为 3，也不能把 00:45 素材采集时的 5 集范围当作 01:15 的实时结果。

## 已确认缺陷与修复位置

| 问题 | 原因 | 修复实现 | 尚需验证 |
| --- | --- | --- | --- |
| 官网 404 阻断独立提供方 | `fetchPlayUrlFresh` 将所有官网源阶段 4xx 一并终止 | `hongguo.js` 对 404/410 保留 App 合法尝试；明确账号、403/429、保护拒绝仍停止 | 真实目标集 App 是否能返回可用片源 |
| 失败原因被压平 | source 聚合、manager 和 IPC 未完整传递阶段/HTTP | `playbackErrorEvidence`、`failureContext`、`playbackHttpStatus` 与诊断白名单贯穿保留 | 新包实际诊断导出 |
| 错把时间当成功 | 旧 video 资源残留；`playing` 早于实际首帧可触发历史与预取 | 失败清除 src/load；controls 不可用时归零；`confirmPlaybackStarted` 基于当前会话和呈现帧 | 实际黑屏/切集场景与截图目视 |
| 业务/解析/空源混淆 | 故障分类有限，聚合结果偏向单一路线 | `playback-errors.js`、`playbackRecovery.mjs` 扩充分类及建议；官网缺集与 App 空响应联合保留 | 无网、超时、HTTP 与媒体失败矩阵 |
| 地址被默认当 MP4 | URL 后缀和媒体 MIME 未完整分流 | `appMediaFormat`、官网 URL 解析及 `requestMedia` 区分 MP4/HLS/未知；DASH 明确不支持；现有 HLS 路径接管 | 真实 HLS 媒体、重定向及拒绝场景 |
| 官网参考信息耗尽回退时间 | 可选时长信息没有独立请求期限 | `official-web-playback.js` 为 play-info、fallback、metadata 分配期限，保留总预算 | 实际官方端响应时间变化 |
| 旧官网路径缺少同等许可与完整性检查 | legacy HTML 的 JSON-LD 直链路径没有完整复用当前公开入口的许可和真实媒体时长约束 | `hongguo.js:fetchPlayUrlFromWeb` 在读取直链前调用 `publicEpisodePermission` 并要求已知完整时长；GET Range 获取媒体字节，经 `official-web-playback.js:publicMovieDuration` 核对真实 MP4、Range、未加密轨道和时长差不超过 0.5 秒 | 官方完整分集实际运行；离线元数据 fixture 不能算真实播放 |
| 一个 Range 读取取消影响共享 HLS 准备 | 多个媒体读取等待同一 HLS 准备任务，若任务依赖某个读取的取消信号，该读取退出会连带中止其他读取 | `main.js:registerStreamProtocol` 的 `hlsResponse` 使用会话独立的 `AbortController` 与 90 秒期限；单个读取通过 `awaitMediaOperation` 取消自己的等待，会话结束仍释放共享准备任务 | 新包本机 MP4 和公开在线 seek 已通过；不能据此扩展为官方真实 HLS 交互通过 |
| 同步盘真实下载/合并发布失败 | E 盘同步目录的 `fs.linkSync` 可返回 `UNKNOWN`（`errno=-4094`），原文件发布仅对其他不支持硬链接错误回退 | `src/native/merge-runner.js:publishMergedOutput` 将 `UNKNOWN` 纳入 `COPYFILE_EXCL` 独占复制回退，继续拒绝覆盖，失败保留源文件；下载复用同一发布路径 | 定向真实下载与合并已通过，仍待最终整包回归 |
| 缓存/历史被旧媒体污染 | 预取和历史写入早于当前集呈现帧，迟到事件可能越界 | `Player.jsx` 绑定 video、source、version、episode；首帧前禁止推进历史/预取，ended 校验同一会话 | 真实连播和切集运行 |
| App 模型误关联 | 模型或备用地址未完整核对本集/完整性 | `validateAppModelIdentity` 及清晰度/完整时长校验；已有未提交修复纳入验收 | 官方真实同集响应 |

## 诊断、重试与媒体行为

每次前台播放由后端生成 `PLAY-日期-随机值`，保存最多 40 条白名单事件与有界尝试记录，展示播放源请求、响应解析、地址检查、媒体加载、解码和首帧。HTTP 成功、模型接受、媒体读取、实际播放分开。播放器提供展开、复制脱敏诊断和导出，设置保留最近失败 ID。接口失败时未执行的媒体步骤不显示为已通过。

网络超时/断开按现有期限和次数有限处理；明确业务、解析、空源、账号或保护拒绝停止自动重复请求。到期地址重新取源，媒体拒绝保留实际 HTTP，解码失败才考虑现有 H.264 兼容。扫码只针对明确账号会话错误，不因空正文或一般 401/403 自动推断账号授权。手动“重试本集”刷新详情与本机文件状态；“重新连接片源”强制重新取源，均沿用有界入口，不伪造地址。

`media-url-manager.js` 从明确有效期字段检查地址，到期前留出安全窗口；缓存按实际剧集和清晰度隔离。切集使旧媒体版本、未结束请求和迟到事件失效；只有匹配的新帧能确认当前集。HLS 使用已有分片检查和 FFmpeg 重封装，不支持的 DASH 明确报告，不用 HTML 或清单伪装 MP4。地址检查采用实际 GET / Range，不能把单次 HEAD 拒绝当作媒体不可用。

## 测试与后续证据

新增或扩展回归位于 `app-source-identity.test.cjs`、`app-source-lifecycle.test.cjs`、`official-web-playback.test.cjs`、`playback-errors.test.cjs`、`playback-manager.test.cjs`、`playback-diagnostics.test.cjs`，以及播放器帧生命周期、线路诊断、控制、预取、恢复和历史脚本。模拟响应只证明所测分支，不代表官方媒体恢复。

### 主要验收：第 22 集及中后段

目标剧第 6、22、34、68、88 集分别记录集号与视频 ID、精确公开页面状态、页面当前视频是否匹配、合法可用媒体是否取得，以及当前 Windows 包的实际首帧、持续画面和交互结果。公共 HTML 的 404、跳回首集或缺少合法媒体只能作为该入口的实际结果；不能记成 GUI 播放通过，也不能据此推定账号或其他独立提供方的结果。本轮不以 App 签名探测填补 Android 成功抓包缺口。

目前五个指定集数均有上述精确 HTML 404 证据，仍没有合法媒体或真实首帧。第 1、2 集的下载、完整解码、本机交互及公开在线回归已通过，但仍只作基础对照，目标中后段没有因此改写为通过。

### 已执行结果与失败历史

- 第一轮 `npm test` 的原始日志为 `.local/analysis/playback-20261126/npm-test.log`，结束为 `9 command(s) failed`。其中包括需要更新的 fixture，也发现真实文件发布/媒体生命周期问题；不能将 9 个失败命令写成 9 个单测或一概说成测试数据问题。
- 第二轮日志 `npm-test-2.log` 结束为 `3 command(s) failed`，分别是 `check-native-performance.cjs`、`check-source-recovery.cjs` 和 `check-web-media-guard.cjs`。补齐公开权限、分集身份、完整时长及真实格式 Range 元数据 fixture 后，三项分别定向 8/8、19/19、18/18 通过；元数据 fixture 只用于离线守卫检查。
- 第三轮 `npm-test-3.log` 结束为 `1 command(s) failed`，实际失败为 `app-source-inline-fallback.test.cjs` 的 fallback 请求 timeout 比较断言。测试改用可控时钟核对剩余预算，避免真实时间波动影响比较。第四轮 `npm-test-4.log` 实际退出码 0，主单元 765/765、失败 0、跳过 0，另有 117 项平台检查全部通过；平台检查内部重复子组不再累计到主单元数量。前三轮失败历史保留。
- `check-download-quality-integration.cjs` 本轮定向 27/27、真实解码分支 1/1 通过。使用随机官方真实素材，验证可以被 probe 识别但媒体损坏的 Web 输入经真实解码失败后切换健康 App 输入；损坏 App 输入不反复请求且不留下正式文件。这是本地响应夹具配合真实解码器，不是官方 App HTTP 服务恢复。
- `check-merge-optimization.cjs` 通过独占发布、`UNKNOWN` 回退、不覆盖、失败保留和竞态检查。`check-merge.cjs --real` 用真实第 1 集文件作为两个输入，重复两次运行均通过，合并文件 247.040 秒，拼接点两秒静音解码得到 50 帧。该项不是新增的合并全片解码，也不代表本剧后续集播放。
- `.local/analysis/playback-20261126/npm-audit.json` 记录生产和开发依赖合计 0 项已知漏洞。React 渲染构建与 Windows x64 NSIS 构建成功；安装 EXE 仍未配置代码签名。构建成功不等于实际安装或 GUI 全部通过。
- 首个 6.38 打包程序在北京时间 01:04:41–01:05:04 运行真实本机素材：首帧 360×640、持续观察 10.168 秒，新增解码及呈现各 253 帧；随后真实 seek 未完成，失败截图仍有加载超时遮罩。`dist/playback-20261126/local/result.json` 为 `passed=false`，不能作为合格候选。该失败的 ASAR 为 `59d666590100b6d6b53e8fda30ff3da4212715ea4ba4a0e2f42eba67049f45de`，后续修复与重测另行记录。

定向 decoder/merge 结果依据本轮实际工具输出，未另存完整原始命令日志；已落盘日志与未落盘摘要明确分开。首包失败历史和新包成功回执同时保留，完整哈希见 [6.38 发行记录](release-6.38.md)。6.37 的历史素材与回执仍保留其原版本、哈希和执行时间，复用素材已绑定本次程序/ASAR并产生新回执。本地全量和再次版本比较已通过，标签 CI、安装及更新门禁仍另行完成。

### 新 6.38 包的基础播放器和公开在线回归

新包为 `6.38.0`、`packaged=true`，程序 SHA-256 `b35639096b47accd998330823d495a0f95808d17f422f7fde1ac390bdf28d456`，ASAR 为 `473b7f8f4f30dccea446c5ef85c43aa48d0da4356f58eb4b0e18d9a671223a19`。01:13:06–01:14:03 的 `dist/playback-20261126/local-rerun/result.json` 为 `passed=true`、`formalAcceptanceComplete=true`：真实第 1 集呈现首帧 360×640，观察 10.213 秒、媒体推进 10.212801 秒、解码与呈现各新增 255 帧；seek、速度、全屏、同一视频节点画中画、暂停后重启进度恢复、真实损坏后恢复原字节并手动重试，以及真实 ended 从第 1 集转第 2 集后继续出帧均通过。该 formal 标志只覆盖独立提供的本机完整素材交互，不包括官方取源、账号或中后段。

`.local/analysis/playback-20261126/asar-source-check.json` 对照本次工作区与受测 ASAR 的 14 个生产/Renderer 文件，`mismatches=[]`；它补充绑定受测实现，不代替标签冻结或正式 CI。

01:15:17–01:16:00 的 `dist/playback-20261126/online-public/result.json` 为 `passed=true`。同一新包从独立空下载目录启动，首页 24 卡、搜索 23 项、真实详情简介和 71 集目录；播放前任务/完整文件均为 0。使用产品既有的 `compat` H.264 / 官网优先选项，公开第 1 集真实首帧、10.215 秒持续画面、seek、接近片尾后真实 ended 连播到第 2 集并继续 10.145 秒，以及新进程重启后重新在线取源并继续 5.085 秒均通过。没有把拖到片尾后的 ended 记成正常速度看完整集。

在线诊断为 `signed-out`、`official-web-public-fallback`，App 各路线 `attempts=0`，因此这份结果证明 Windows 的公开官网链路可以独立取源、加载和出帧，不能证明 App HTTP 空正文恢复或任何账号授权通过。两份 GUI 回执均为启动前命令行静音、媒体静音、volume 0、违规 0；静音验收不包含声音输出质量或解除静音测试。

01:16:39 的 `.local/analysis/playback-20261126/independent-process-check.json` 记录 ADB / scrcpy 进程数为 0，两条运行回归通过，未操作手机。未观测手机电源和物理 USB 状态；不能写成已经替用户关闭手机或拔线。验收后 ApkStart 已恢复，独立测试资料不进入正式账号和剧库。

仍需补齐：

1. 第 22 集 Android 客户端合法成功请求/非空响应或官方诊断记录；手机同集短时可见播放现已直接观察，但不是成功网络记录。
2. 同集 Windows 本次取源响应、HTTP/业务/正文结构、合法地址及实际加载结果；不得记录完整签名地址。
3. 目标第 6、22、34、68、88 集合法媒体与实际 GUI 回执；公开第 1、2 集基础对照已完成，不能代替它们。
4. 在可观测条件下实际关闭手机 App、断开 USB 的验证；本轮运行未使用手机传输且检查时 ADB / scrcpy 为 0，仍缺物理状态观测。
5. 同冻结提交 Test/Windows 候选、实际安装/重装/账号生命周期、旧版更新与资产匹配回执。

缺失上述证据不会阻止独立的代码修复和离线回归，但在补齐前不能宣称第 22 集或整部剧已修复。
