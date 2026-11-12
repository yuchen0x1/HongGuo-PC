# 红果短剧 6.7.0 代码审计报告

- 审计时间：2026-11-11
- 代码基线：`6.7.0`（main.js 5468 行 / src 约 1.8 万行 / preload 279 行）
- 审计方式：只读静态审计 + 关键路径交叉验证（含 axios 1.20 流式超时语义、路径校验函数、React 依赖图）。**未修改任何源码**。
- 严重程度定义：
  - **致命**：可导致数据丢失、任意文件删除或不可恢复损坏
  - **高**：功能永久性损坏、进程卡死/无法退出、明显安全边界被突破、可稳定复现的用户可见故障
  - **中**：特定条件下功能受损、性能劣化、异常路径信息泄露
  - **低**：健壮性、可维护性、规范偏差

## 风险总览

| 级别 | 数量 | 主要分布 |
|---|---|---|
| 致命 | 0 | —— |
| 高 | 10 | 下载状态机、持久化、流式超时、NAS、缓存清理、渲染层副作用、SSRF、解析器内存 |
| 中 | 18 | 资源生命周期、重试策略、主进程同步 IO、错误分类、输入校验 |
| 低 | 12 | 协议规范、路径归一、统计口径、错误提示、静默失败 |

总体判断：**核心删除/路径护栏（`pathInside`、`validateDirectoryIdentity`、`validateNasDeletion`、`ownsEpisodeFiles`）实现扎实**，未发现路径穿越或任意文件删除。真正的高危集中在「**落盘失败后的状态翻转**」「**不可取消的 NAS 收尾**」「**流式请求无体超时**」三类，它们都指向同一个模式：**长链路缺少超时/兜底，异常被状态机误解释**。

---

# 一、高危（P0）

## P0-1 下载成功后落盘失败，任务被反转成「失败」

- **位置**：`main.js:1087-1094`（成功路径）、`main.js:1114-1118`（catch 内二次落盘）、`src/store.js:155-190`
- **成因**：成功分支里 `task.status='completed'` 之后直接调用 `saveDownloadTasks()`，而 `store.flush()` 是**同步抛错**的。一旦抛错就落入同一个 `catch`，走 `task.status='failed'; task.error=error.message` 分支。
- **触发条件**：
  1. 磁盘满、目录只读、杀软/索引器锁住 `data.json`（Windows 上 `renameSync` 报 EPERM/EBUSY）；
  2. `data.json` 曾读取失败时 `readError` 被置位，此后 `flush()` **每次必抛**。
- **影响**：视频文件已经 `publishDownloadFile` 成功落地，UI 却显示失败并弹出磁盘错误；`download-completed` 事件不发，下载管理器与播放页状态全部错位。用户重试后走 `existsSync` 快路径自愈，但每次下载都要多一次误报。
- **修复建议**：
  - 把「媒体成功」与「记录成功」解耦：`task.status='completed'` 之后单独 `try { save } catch { sendToRenderer('storage-error', ...) }`，落盘失败不改变任务状态；
  - `catch` 内的 `saveDownloadTasks()` 必须再包一层 `try`，否则异常会穿透 `executeHongguoDownload`（见 P1-13）；
  - 长期方案：任务记录与播放进度拆成独立小文件，避免单文件全量写入成为唯一失败点。

## P0-2 持久化失败后内存与磁盘状态分叉；`data.json` 损坏时应用永久只读

- **位置**：`src/store.js:150-190`、`208-212`
- **成因**：`flush()` 失败时执行 `cache = JSON.parse(durable)` 整体回滚内存缓存；`readError` 存在时先回滚再抛错。`saveSettings` 失败时又用 `cache = previousCache` 再替换一次。
- **影响**：
  1. 主进程持有的 `downloadTasks` 数组与 store 里的 `cache.tasks` 变成**两组不同对象**，之后任何「按引用判断任务是否仍存在」的逻辑（`downloadTasks.includes(task)`、`snapshotQueueTasks`）都会与磁盘状态不一致；
  2. 保存失败后 `getSettings()` 返回旧值，用户刚改的设置被静默丢弃，而 UI 已按新值渲染；
  3. `readError` 一旦置位，**该次运行内所有写操作永久失败**，只能重启；若损坏来自半截写入，重启后依旧失败，形成不可自愈循环（启动只在 `did-finish-load` 弹一次 `storage-error`）。
- **修复建议**：
  - 读损坏时立刻把 `data.json` 复制为 `data.corrupt-<时间戳>.json`，然后用「保留可解析部分 + 空结构」重建，并明确告知用户，而不是永久只读；
  - 回滚时不要替换整个 `cache` 对象，改为按字段还原，保持对象标识稳定；
  - 写失败增加 3 次指数退避重试（覆盖 Windows EPERM/EBUSY），仍失败再上报。

## P0-3 流式媒体请求无「响应体」超时，播放与下载可无限挂起

- **位置**：`main.js:2646-2650`（`timeout: 60000, responseType:'stream'`）、`main.js:3069-3076`（`for await (const chunk of response.data)`）、`main.js:1040-1056`
- **成因**：axios 1.20 在 `responseType:'stream'` 下拿到响应头即 settle（`http.js:449` 置 `isDone=true`），此后 socket 的 `timeout` 事件进入 `handleTimeout` 时因 `if (isDone) return` 直接返回（`http.js:1402-1404`）。**60 秒只保护 TTFB，不保护 body**。
- **触发条件**：CDN 返回 200 + Content-Length 后停止发送数据（代理半死、运营商劫持、keep-alive 被中间设备挂起）。
- **影响**：`prepare-online-play` 永不 resolve，播放器停在「准备中」；`transcode-for-playback` 永不返回；下载任务停在 `downloading` 且占用并发槽。用户只能手动取消。
- **修复建议**：为 body 增加**空闲看门狗**——收到 `data` 时重置定时器，超过 20~30s 无数据则 `controller.abort()` 并归类为可重试的 `MEDIA_TRANSFER_ERROR`；对 `pipeline` 分支同样适用。

## P0-4 NAS 收尾不可取消、无超时：任务卡死 + 退出被永久拒绝

- **位置**：`main.js:930-945`（`completeNasExports`）、`src/native/nas-export.js:306-338`（`copyNasEpisode` 无 signal）、`main.js:5431-5466`（`before-quit`）
- **成因**：`copyNasEpisode` 里的 `publishFile` / `lstat` / `digest`（对两个文件各做一次全量 sha256）既没有 `AbortSignal`，也没有超时；`completeNasExports` 只把异常转成 warning，**挂起不会**转成 warning。
- **触发条件**：NAS/网络盘掉线、SMB 无响应（Windows 上数秒到无限期）。
- **影响**：
  1. `task.status` 停在 `downloading`，`runningDownloadPaths` / `activeDownloads` 不释放；`MAX_CONCURRENT_DOWNLOADS=3` 时**3 个这样的任务即让整条队列永久停摆**；
  2. `before-quit` 的 `Promise.allSettled(downloadRuns.values())` 永远等不到，10 秒后弹「退出未完成」，**每次退出都重复弹窗，应用无法正常关闭**；
  3. `stopTaskAndWait` 也随之无限等待（P0-5）。
- **修复建议**：
  - 为 `copyNasEpisode` 传入 `AbortSignal`（`publishFile` 用流式复制 + signal），并加操作级超时（如 120s）；
  - `pauseAllTasks` / `before-quit` 时显式 abort 所有 NAS 复制；
  - 收尾阶段单独标记状态（如 `downloading` + `stage:'nas'`），允许删除任务时跳过等待。

## P0-5 `stopTaskAndWait` 无上限等待，删除与退出被拖死

- **位置**：`main.js:4623-4631`
- **成因**：`await downloadRuns.get(task.id)` 没有任何 race/timeout。若任务正卡在 P0-4 的 NAS 复制、或 `probeVideoInfo`（30s）、或 worker 解密，等待就无限延长。
- **影响**：`delete-task` / `delete-tasks` 的 IPC promise 永不 resolve，UI「删除中」卡死；退出流程同样被拖到 10 秒超时。
- **修复建议**：`await Promise.race([run, timeout(5000)])`，超时后把任务标记为 `orphaned` 并从并发计数中移除，文件与记录保留并提示「任务正在收尾，稍后可再次删除」。

## P0-6 兼容缓存清理/淘汰没有「使用中」保护，会删掉正在播放或投屏的文件

- **位置**：`main.js:3641-3655`（`clear-compat-cache`）、`main.js:3321-3346`（`trimCompatCache`）
- **成因**：同仓已有 `isFileInUse()`（`castFileRefs` / `localFileReaders` / `runningDownloadPaths` / 在飞任务），`clear-series-playback-cache`（`main.js:3218`）用了它，但这两个入口**都没用**；`trimCompatCache` 的保护集合只有 `currentOutput` 与 `compatPreparing`。
- **触发条件**：投屏中或播放中点「清空兼容缓存」；或缓存超过 4GB 触发淘汰，恰好选中正在播放的那一集（它最旧）。
- **影响**：macOS/Linux 下 unlink 立即成功 → 当前段能播、下一段 Range 404，电视端或播放器中途卡死；Windows 下删失败被计成 `failed`，用户只看到「部分删除失败」。`trimCompatCache` 更隐蔽——没有任何提示。
- **修复建议**：两处都合并 `isFileInUse` 与 `castFileRefs` / `localFileReaders` 判定；`trimCompatCache` 的候选集过滤掉使用中文件后再按 atime 排序。

## P0-7 渲染进程崩溃/重载后在线会话不释放：内存与临时文件双泄漏

- **位置**：`main.js:3107-3108`（`onlineSessions.set`）、清理仅存在于 `release-online-play`（3161）、窗口 `closed`（5295-5302）、`before-quit`（5450）
- **成因**：全仓没有 `render-process-gone` / `webContents 'destroyed'` / 导航钩子（已 grep 确认）。渲染层正常卸载会调 `release-online-play`，异常路径没有。
- **触发条件**：渲染进程崩溃、开发者模式热重载、页面 reload。
- **影响**：session 里的 `entry` 是缓存条目的浅拷贝，**强引用整集 buffer（上限 300MB）**；且 `disposeOnlineDisk` 因为 `s.entry?.disk === entry.disk` 恒成立而跳过删除 → `%TEMP%/hongguo-online-*` 下的整集 mp4 直到进程退出都留盘。多次重载线性增长。
- **修复建议**：在 `mainWindow.webContents` 上监听 `render-process-gone` 与 `destroyed`，按 sender 归属批量 `releaseOnlineSession`；启动时清扫 `%TEMP%/hongguo-online-*` 与 `compat/.hongguo-hls-*` 残留。

## P0-8 NAS 封面下载可被用于 SSRF

- **位置**：`src/native/nas-export.js:208-215`（`fetchPoster`）
- **成因**：只校验初始 URL 的协议与 userinfo，**没有** `isPublicMediaUrl`，**没有** `webMediaRequestOptions`（受控 `lookup` + `beforeRedirect`），且 `maxRedirects: 3` 盲跟随跳转。这是全仓唯一绕过 `web-media-guard` 的对外请求。
- **触发条件**：封面地址来自不可信输入——自定义源 `vod_pic`、官网/App 接口的 `cover_url`；或一个解析到 `127.0.0.1` / `198.18.x` 的公网域名再 302 到内网。
- **影响**：主进程可被诱导对回环/内网发起 GET（端口探测、命中无鉴权的内网接口、触发内网副作用）。属于盲 SSRF。
- **修复建议**：改用 `webMediaRequestOptions(url.href)` + `adapter:'http'`（与 `custom-source.js:70-91` 一致）；响应校验 `content-type` 为 `image/*`；拒绝非 200。

## P0-9 播放器快捷键监听随下载进度高频重建，长按倍速/快进被打断

- **位置**：`src/components/Player.jsx:1217-1292`（依赖含 `findNext`/`findPrev`/`goToEpisode`）、`1006-1022`（三者依赖 `episodes`）、`592-598`（进度事件重建 `episodes`）、`1289-1292`（cleanup 无条件 `finishForward()`）
- **成因**：`episodes` 来自 `detail.episodes`，任一分集下载进度事件都会 `setDetail(prev => ({...prev, episodes: prev.episodes.map(...)}))` 生成新数组 → `findNext`/`findPrev`/`goToEpisode` 换新 → 快捷键 effect 重建 → cleanup 执行 `finishForward()`，把 `fastForwardRef` 清空并把倍速改回。
- **触发条件**：播放中同剧有分集在下载（进度按分片推送，可达每秒多次）；或打开切集面板/确认框。
- **影响**：用户按住快进/长按倍速时，一次重渲染就让手势失效（表现为「闪一下就没了」）；同时高频 `addEventListener(..., true)` / `removeEventListener` 影响输入延迟。这是稳定可复现的交互缺陷。
- **修复建议**：
  - `finishForward` 内部改用 `episodesRef.current` 读取最新数据，让 `findNext`/`findPrev` 用 `useCallback([])` + ref，彻底稳定 effect 依赖；
  - cleanup 中**不要**结束用户正在进行的手势，改为仅在真正卸载时清理；
  - 下载进度不要塞进 `detail.episodes`（见 P1-7）。

## P0-10 不可信 MP4 的 `stsz` 采样数无上限，可打爆 worker

- **位置**：`src/native/hongguo.js:1021-1030`（`const n = data.readUInt32BE(stsz.off + 16); … new Array(n).fill(ss)`）
- **成因**：`n` / `nc` / `ns` / `sc` 全部直接取自文件，除 `off + sz > total` 外没有范围或上限校验；`stsz.off+12/+16` 也未验证落在 box 内。
- **触发条件**：待解密 MP4 被截断或伪造（CDN 错误页、下载中断、自定义源提供的 mp4）。构造几百字节的文件令 `sample_size != 0 && sample_count = 0xFFFFFFFF`。
- **影响**：`new Array(4294967295).fill(ss)` 触发数十 GB 分配，Node worker OOM 通常直接终止进程；`ss===0` 分支则读越界抛 `ERR_OUT_OF_RANGE`，原始错误文案冒到 UI。
- **修复建议**：所有 count 字段按 box 剩余长度裁剪（`count <= (boxEnd - off - 16) / 4`）并设硬上限（如 1e6）；`read*` 前做边界检查；统一转成「视频文件损坏」。同类问题见 `parseBoxes` 无深度限制（P2-8）。

---

# 二、中危（P1）

| # | 位置 | 问题 | 触发条件 | 影响 | 修复方向 |
|---|---|---|---|---|---|
| 1 | `Player.jsx:645-656` | 在**渲染阶段**写 ref、清空 `loadedMediaRef`、覆盖 `pendingSeekRef` | 任何 `playableSource` 变化的渲染；并发渲染被丢弃时 | ref 与已提交 UI 不一致 → 断点莫名回退几秒、`persistPosition` 静默不保存 | 移到 `useLayoutEffect`，渲染期只做纯计算 |
| 2 | `danmaku.js:71-96` | 身份文件 `JSON.parse` 失败（`code !== ENOENT`）直接抛 → 永久 `DANMAKU_IDENTITY_IO`；首次写入非原子 | 首次加载时被强杀、磁盘满、杀软截断、手工编辑 | 该安装此后**每一集**弹幕都失败，只能手工删文件 | 解析失败视为无身份并重建；写入改 tmp + fsync + rename |
| 3 | `portable-data.js:33-44` | 迁移标记不可解析 → `{ok:false}` 且无自愈路径 | 提交阶段（写完 sentinel 后、rename 前）进程被杀 | 便携版永久回退系统目录，程序目录 `data/` 被静默忽略 | sentinel 损坏按「无标记」处理；写入原子化；给 UI 一个重置入口 |
| 4 | `merge-runner.js:160-174` | 只要 encoder 不是 `libx264`，**任何**失败都重试降级 | 硬编可用但某集本身无法解码 | 60 集长剧白跑 2 遍全量转码（数小时 CPU/IO），真实错误被最后一次覆盖 | 仅在错误文本指向硬解/硬编失败时降级 |
| 5 | `merge-runner.js:53-74` | ffmpeg 子进程只由 `close` 结算，无停滞看门狗、无总时长上限 | 输入在 NAS 上且共享断开、ffmpeg 卡在 filter | 合并任务永久 running，临时目录持续占盘 | 记录 `out_time_us` 变化时间，N 秒无进展则 SIGKILL 并报「编码停滞」 |
| 6 | `hongguo.js:203-215`、`hongguo-search.js:153-176` | 未设 `maxContentLength`、未校验 content-type | 边缘节点返回超大错误页、WAF 拦截返回 HTML | 主进程内存暴涨；HTML 拦截页 `fallback:false` 导致不会退回网页嗅探 | 补 8MB 上限与 content-type 校验；把「返回网页」标记为可 fallback |
| 7 | `Player.jsx:599` + `main.js:2443-2470` | 播放中每 2s 拉一次 `get-series-episodes`，该接口内部做 `readdirSync` + 逐文件 `statSync` | 播放中且 dirty（下载/历史事件后） | 主进程同步 IO 抖动，与 P0-9 的渲染风暴叠加 | 事件驱动 + debounce；主进程提供批量/增量接口并缓存 |
| 8 | `main.js:4823-4842` | `get-storage-usage` 同步 O(剧数 × 文件数 × 任务数) 扫描，`isFileInUse` 每次再全表 `some` | 任务/剧集上百，或根目录在 NAS | 打开存储管理时主进程卡死，下载进度、取消 IPC 全部延后 | 改为异步遍历 + 单次构建 path→owner 索引；结果缓存 + 手刷 |
| 9 | `main.js:2760-2780` + `1029` | `!recoverable(error) && !allowLowerQuality` 在指定清晰度下载时恒为 false，`terminal` 名单不覆盖无 `code` 的确定性错误 | 指定 720P/1080P 下载时抛「缺少有效视频轨」「解密失败」 | 跨 variants × 3 轮重复拉流，单集白跑 1GB+ 流量、数分钟才报错 | 把确定性错误加入 `terminal`；`allowLowerQuality` 不应关闭 terminal 判定 |
| 10 | `Player.jsx:1126` + `main.js:2558-2565` + `store.js:155-190` | 每 5s 保存断点触发**全量 store** 序列化 + fsync；渲染层 `.catch()` 但主进程失败是 resolve `{success:false}` | 播放全程 | 持续同步写盘、IO 抖动；断点保存失败完全静默 | 断点按 seriesId 增量小文件；渲染层检查 `result.success` 并提示一次 |
| 11 | `account-web-login.js:8-13` | `close()` 只置 `closed`，已进入的 `complete()` 无法中止，内部仍会 `sessionStore.save` | 扫码确认后、验证返回前关闭窗口 | UI 显示取消但账号已登录并持久化，下次启动仍是登录态 | 把「窗口有效」传入 `complete()`，在 save 前检查；或用 AbortSignal |
| 12 | `main.js:3298-3305` | `compatFileName` 仅做字符清洗，跨剧同名会映射到同一文件 | 两个 seriesId 清洗后同名（含截断到 80 字符）且集数、清晰度相同 | 后转码的剧**静默覆盖**前一剧缓存，播放到错误剧集 | 文件名加入 seriesId 的短哈希；写路径补齐 `clearSeriesPlaybackCache` 已有的冲突检测 |
| 13 | `main.js:1114-1118` | `catch` 内 `saveDownloadTasks()` 无保护，异常穿透到 `runTask` 只被 `console.error` 吞 | 失败路径上落盘同样失败 | 内存为 `failed`、磁盘为旧状态，UI 与实际不一致；无任何上报 | catch 内包 try；`runTask` 的 catch 至少上报一次可见错误 |
| 14 | `main.js:3190-3225` | 清空本剧播放缓存与「刚转码完成、尚未被播放器打开」的产物存在毫秒级空窗 | 另一集刚转码完成同时清空缓存 | 播放器拿到 404 地址黑屏；或 `.part` 删除 EPERM 导致整体报「部分失败」 | 维护「最近产出文件」短时保护期；清空时二次校验 `compatPreparing` |
| 15 | `main.js:530-542` + `5337-5345` | 启动把 `pending`/`downloading` 一律改成 `failed`，而自动续跑只取 `status==='pending'` | 崩溃/断电后启动 | 「启动自动续跑」为死代码，队列不会恢复，只能手动一键启动 | 保留 `pending` 语义，或续跑时纳入 `failed && retryAt` 的任务 |
| 16 | `main.js:5335-5347` | 代理启动回退为直连时，整段 `armSourceRetry` + `enqueuePendingTasks` 被 else 跳过 | 保存的代理配置失效 | 本次会话所有定时重试都不恢复，队列不启动；修好代理也必须重启 | 两条分支都执行续跑逻辑 |
| 17 | `main.js:1040-1048` | 拿到响应后、`pipeline` 前取消，`response.data` 从不 destroy | 用户在响应头到达后暂停/删除 | 未消费的 `IncomingMessage` 占住 socket，连接不归还，反复操作累积悬挂连接 | catch 分支显式 `response?.data?.destroy()` |
| 18 | `main.js:699-712` | `runTask` 的 catch 只打日志，不重置状态；任务已出队但状态仍是 `pending` | 任务记录 `type` 缺失/非法（旧 data.json、手工修改） | 该任务本会话内永远不会再被调度，也无失败提示 | catch 中置 `failed` 并 `sendToRenderer`；对未知 type 做迁移 |

---

# 三、低危（P2）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| 1 | `main.js:2622-2636` | 语法非法的 `Range`（`bytes=abc`、多区间）返回 416，RFC 9110 要求忽略并按 200 处理 | 语法错回 200；多区间只满足第一个 |
| 2 | `main.js:924-928` | `publishDownloadFile` 中 `unlinkSync(temporary)` 失败会把已发布成功的文件判为失败 | 包 try，失败仅记日志（临时文件下次启动可清） |
| 3 | `main.js:2296-2306` | 按「文件名包含剧名」认领分片，`ownsEpisodeFiles` 不校验剧集归属 | 剧名为常见短词且同目录有无关 mp4 时可能被算作本剧分集并被删除 | 认领时要求有任务记录，或校验同目录 NFO 身份 |
| 4 | `main.js:2204` / `689` / `4638` | 路径比较用原始字符串，未 `path.resolve` + win32 小写归一 | 大小写/尾斜杠不同的同一文件导致冲突漏判、并发去重失效 | 统一走 `normalizePathKey()` |
| 5 | `main.js:4929-4958` | `retry-tasks` 未对 `taskIds` 去重（`delete-tasks` 用了 Set） | 重复 id 使 `count` 虚高、重复 restore | 入口 `new Set(taskIds)` |
| 6 | `main.js:4962` | `pause-all` 无 try/catch，落盘失败以 rejected promise 返回，破坏统一 `{success}` 契约 | 包 try 返回 `{success:false,error}` |
| 7 | 全仓 71 处 | `catch {}` / `catch (_) {}` 静默吞异常（下载管理器加载、设置读取等） | 至少 `console.warn` + 关键时刻上报 UI |
| 8 | `hongguo.js:842-864`、`hls-media.js:44-52` | `parseBoxes` / `walkBoxes` 递归无深度限制；HLS 嵌套清单递归仅靠 `files.size < 10000` | 加 `depth > 32` 上限并报「文件结构异常」 |
| 9 | `src/components/ErrorBoundary.jsx:1-22` | 唯一 boundary 在根部，任一页面渲染抛错即销毁整棵 UI（含播放中的视频） | 每个页面分支各包一层；`componentDidCatch` 落日志 |
| 10 | `Player.jsx:1874-1884` | 悬浮窗场景用主 `document` 判断 `pictureInPictureElement` / `fullscreenElement` | 统一用 `videoRef.current.ownerDocument` |
| 11 | `Settings.jsx:539-563` | 代理 host/port 无渲染层校验（`min/max` 只是浏览器提示） | 保存前校验 1–65535、URL 解析剥离协议与凭据 |
| 12 | `main.js:4786-4793` | `cleanupWatchedEpisode` 对已被自己删除的缓存字节重复累加，`freed` 虚高 | 以删除前 `existsSync` 的真实结果计费 |

---

# 四、修复路线图

**第一批（1–2 天，消灭「卡死/误报」类用户可见故障）**
1. P0-1 + P1-13：成功路径与 catch 路径的落盘全部隔离，落盘失败不翻转任务状态。
2. P0-3：引入响应体空闲超时（统一封装在 `requestMedia` 与 `fetchDecryptedEpisodeOnce`）。
3. P0-4 + P0-5：`copyNasEpisode` 支持 `AbortSignal` + 操作超时；`stopTaskAndWait` 加 5s 上限。
4. P0-6：两处缓存清理补 `isFileInUse`。
5. P0-2：`flush` 失败不替换整个 cache；读损坏自动备份 + 重建。

**第二批（3–5 天，资源与安全）**
6. P0-7：`render-process-gone` / `destroyed` 释放在线会话 + 启动清扫临时目录。
7. P0-8：`fetchPoster` 接入 `web-media-request` 守卫。
8. P0-10 + P2-8：MP4 解析全量边界校验与深度上限。
9. P1-1 / P0-9：Player 渲染期副作用移出 render + 回调 ref 化。

**第三批（1 周，性能与健壮性）**
10. P1-7 / P1-8：分集与存储统计改异步 + 索引 + 缓存。
11. P1-10：断点增量落盘。
12. P1-2 / P1-3：弹幕身份、便携迁移的原子写与自愈。
13. P1-4 / P1-5：合并重试条件收敛 + ffmpeg 停滞看门狗。

---

# 五、已核查、确认无问题的点（避免重复排查）

- **删除路径安全**：`pathInside`（`main.js:2077-2089`）双侧 realpath + win32 小写 + `path.relative`，`C:\foo` / `C:\foobar` 前缀陷阱不成立；`validateDirectoryIdentity` 挡目录符号链接与 `dev` 变化；`validateNasDeletion` 用 `lstat().isSymbolicLink()` + `dev` + `pathInside` 三道。**未发现路径穿越或任意文件删除**。
- **本地媒体协议**：路径来自主进程登记的 `Map<uuid, 绝对路径>`，渲染进程无法构造任意路径；扩展名白名单大小写不敏感。
- **窗口安全**：`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`；`setWindowOpenHandler` 全拒；`will-navigate` / `will-redirect` 白名单；权限请求要求主框架 + 可信来源。
- **下载并发控制**：`pumpQueue` 先 `splice` 出队再登记 `runningDownloads` / `runningDownloadPaths`，未发现同一任务被并发执行两次。
- **重试定时器**：`armSourceRetry` 回调首行删 map，`clearSourceRetry` 覆盖删除/暂停/重试入口，`before-quit` 计入 `sourceRetryTimers`，未发现任务删除后仍触发的泄漏。
- **SM3 实现**：与 Node 22 原生 `crypto.createHash('sm3')` 对 14 组长度逐一比对，全部一致；`nonce` 每请求新生成，无复用。
- **HLS 暂存**：`remuxHls` 有 10 分钟总超时、磁盘容量预留、`SIGTERM→2s SIGKILL`、临时目录 finally 清理。
- **XSS**：`src/**` 无 `dangerouslySetInnerHTML` / `innerHTML`，全部 JSX 文本插值。
- **投屏引用计数**：`start-casting` / `casting.start` / Stop 三条路径均幂等，未发现重复 `readers--`。

---

# 六、审计限制

- 未在真机执行端到端回归；结论来自静态分析与关键函数语义核对（axios 1.20 流式超时、Node fs 语义、React 依赖图）。
- 未覆盖 electron-builder 打包产物、`dist-*` 目录、以及第三方媒体二进制。
- 未评估红果官方接口的协议变化风险（签名、风控），该部分属于外部依赖。
- 所有行号基于当前 `6.7.0` 工作区快照，后续改动可能位移。
