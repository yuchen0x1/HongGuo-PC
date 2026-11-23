# 自主开发变更记录

## 2026-11-23 · 下载队列健康快照（发行 6.27）

**巡检结论**：下载队列状态此前只能从任务列表推断；并发槽位、自动重试倒计时和“必须人工处理”的失败混在一起，长时间批量下载时用户难以判断程序是否还在工作、还需不需要干预。对照 qBittorrent/aria2 的队列状态展示（[EV-005](UPGRADE_ROADMAP.md)），补一个可解释的快照。

**代码变更**：

1. `src/native/download-queue-health.js`（新）：`summarizeDownloadQueue` 纯函数汇总并发、排队（按 id 去重）、自动重试、人工处理、完成数与最近一次重试剩余时间；非法 `maxConcurrent`、非法 `retryAt`、过去时间均安全收敛。
2. `main.js`：`get-queue-status` 改为调用快照函数，保留 `active/queued/maxConcurrent` 字段兼容旧界面。
3. `src/components/DownloadManager.jsx`：状态条在只有自动重试或人工处理任务时也显示，并提示“磁盘、权限或来源问题不会自动重试”。
4. `src/native/download-queue-health.test.cjs`（新）：2 项单测。

**验证**：`node --test src/native/download-queue-health.test.cjs` 2/2 通过；`npm test` 单元测试与 111 项平台检查通过；`npm run build:react` 构建通过。

**边界**：不改变任务持久化格式、重试策略、并发默认值和公开 IPC 字段；真实 GUI 状态条与真机长任务观察未在本轮做安装包级验收。

## 2026-11-21 · 关闭按钮收进系统托盘（发行 6.25）

**需求来源**：用户反馈「点关闭按钮直接退出，没有缩小化」。确认为最小化到系统托盘后台运行：点 × 收起窗口、下载不中断、托盘可恢复与退出。

**代码变更**：

1. `src/native/close-to-tray.js`（新）：`resolveCloseAction` 关闭决策（hide/quit/destroy），macOS 维持关窗不退出。
2. `main.js`：Tray 装配（`createTray`/`destroyTray`/`revealMainWindow`/`hideMainWindowToTray`）、`close` 事件决策分支、首次收托盘一次性气泡、`will-quit` 销毁托盘；`close_to_tray` 默认开启并纳入可保存设置白名单（布尔归一）。
3. `src/components/Settings.jsx`：新增「窗口」分类与「关闭时最小化到系统托盘」开关（保存后生效）。
4. `scripts/check-close-to-tray.cjs`（新）+ `check-backend-lifecycle.cjs` 关闭契约更新 + `check-settings-search.cjs` 分类计数 12→13。

**验证与发布**：全量 `npm test` 通过（单元 + 111 平台检查）；生产依赖官方 registry 审计 0 漏洞；版本回归扩至 6.25。标签 Test [44865673587](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44865673587)、Windows 候选 [44865673598](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44865673598)（含真实 1.80→6.25 安装器升级资料保留回执）、发布工作流 [44866645422](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44866645422) 均成功。安装器 146,467,517 字节，SHA-256 `05691b806f6eb61071ec10e98444324618d560e37171603d80c24045e15cc0d3`；`NotSigned`。

**验收边界**：托盘图标真实显示、单击恢复、右键退出无法无头验证，待用户安装后真机确认。

## 2026-11-21 · video_tab 取源阶梯恢复完整分集播放（发行 6.24）

**巡检结论**：用户报告《嫌疑人的秘密2藏金生死线》取源失败；只读诊断确认上游 App 接口对随机剧与报告剧均返回空响应（同上游 7.7 issue #130 现象）。对比上游后移植其 7.7 的 `video_tab` GET 恢复路径与无正文签名，AT-04 就此闭环：修复后三部真实剧集（报告剧、此前失败剧、随机剧）均在约 1 秒内 `sourceAvailable: true`。

**代码变更**：

1. `src/native/playback-v5.js`：`signPlaybackV5` 支持 `body: null` 无正文模式（空缓冲 MD5 分支、省略 `x-ss-stub`），签名算法保持 N3urda/hongguoTV 18c37c2 移植不变。
2. `src/native/app-source.js`：新增 `VIDEO_TAB_API` 与 `videoTabRequest`（播放器家族签名、版本字段 `7.4.3.32`、空 `from_video_id`）；空响应恢复改为「V5 POST → 备用主机 POST → video_tab GET」轮次内阶梯，明确拒绝不进阶梯，整轮失败才轮换匿名身份。
3. `scripts/check-app-source-recovery.cjs` 新增阶梯/形态/邻居分集断言；`scripts/check-app-source.cjs` 空响应用例按新阶梯更新。

**验证与发布**：真实只读诊断三部剧集修复前后对照（修复前全部 `EMPTY_RESPONSE`，修复后全部 `OK`）；`npm test` 全量通过；标签 Test [44855635995](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44855635995)、Windows 候选 [44855636055](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44855636055) 成功；发布工作流 [44856863451](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44856863451) **全流程成功**（含末步公开入口探测，6.18/6.21/6.23 的失败模式本轮未复现）。安装器 146,466,902 字节，SHA-256 `7cbcef9affc03cb3dc0a0819860fe4a2dad12c8c7e553bbd1c30cd156f6ab7ff`；`NotSigned`。

**致谢**：恢复路径与参数对照 `jackotom/hongguo-drama` 7.7（issue #130）移植，其文档致谢 N3urda、ermilylu、WEP-56 及参考 GPL-3.0-only 的 `tsukiyo-zero/hongguoTV` tabVideoModel；本项目保留同一 GPL-3.0 许可链。

**后续优先项**：AT-02 导出 fsync 性能、AT-03 真实应用内更新链路、AT-05 EV-004/005/006/008、AT-06 Windows 签名、AT-07 发布探测改造。

## 2026-11-21 · 数据备份恢复与保存暂存安全（发行 6.23）

**巡检结论**：完成此前两轮被归档中断的遗留项——EV-003 存储备份恢复（`sess_c62183d1` 留下的 store.js 草稿）与 `data.json.tmp` 独占暂存修复（`sess_e8baf50d` 未落地的方案）。6.23 已绑定冻结提交 `7a22cff46c7b48dee15383cb720d9813c69a9826` 并正式公开。

**代码变更**：

1. `src/store.js`：成功保存后把验证过的新文档镜像到 `data.json.bak`（指纹去重）；读取失败且备份有效时报出恢复信息；`restoreFromBackup` 两步确认、保留损坏原文件、核对原文件未变化。
2. `src/store.js` 保存改用独占暂存文件 `data.json.tmp-<pid>-<时间>-<随机>`，Windows 瞬时占用改名失败时复用已 fsync 的暂存内容重试；历史遗留固定 `.tmp` 不再被覆盖。
3. `main.js`/`preload.js`/`Settings.jsx`：新增 `get-storage-recovery`、`restore-storage-backup` 受控 IPC 与设置页恢复入口（恢复排队在设置保存队列后）。
4. `scripts/check-store.cjs` 扩至 11 项回归；适配三个依赖旧固定 `.tmp` 行为的检查；版本回归扩至 6.23。

**验证与发布**：本机 `npm test`（单元 + 110 平台检查）与 `build:react` 通过；标签 Test [44848529619](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44848529619)、Windows 候选 [44848529618](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44848529618) 成功（回执 `passed`、真实 1.80→6.23.0 升级保留资料、`NotSigned`）。发布工作流 [44852103766](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44852103766) 资产上传与公开成功、末步公开入口探测 exit 4 失败（同 6.18/6.21）；本机独立核验公开 API、`latest.yml` 逐字节、EXE HEAD 与资产摘要全部一致后按公开状态记录，未重发未重传。发布期间本地环境令牌临时 401，改用钥匙串同一账号凭据完成。

**后续优先项**：崩溃遗留暂存文件清理（随任务健康快照）、文字导出 fsync 性能（AT-02）、真实应用内更新链路（AT-03）、Windows 签名（AT-06）、红果上游恢复跟进（AT-04）。

## 2026-11-21 · 开发 renderer 来源边界（发行 6.22）

**巡检结论**：打包应用不再信任继承的 `VITE_DEV_SERVER_URL`；开发模式只接受规范化的 HTTP loopback 来源，窗口加载、媒体访问与 renderer IPC 共用同一过滤结果。6.22 已绑定冻结提交 `ee342c9adf3b2b22116b423fe1dc1285534f87ce` 并正式公开，未改写 v6.21 标签或资产。

**代码变更**：

1. `main.js` 与 `src/native/dev-server-url.js`：生产环境忽略开发服务器环境变量，开发环境拒绝远程、局域网、凭据、路径、query、hash 和超长地址。
2. `src/native/renderer-security.js`：renderer 信任来源使用同一 loopback 过滤结果；保留 file URL 规范化、主 frame 和导航边界。
3. `src/native/dev-server-url.test.cjs`、renderer 安全脚本：补充开发地址和文件 URL 正向/负向回归，修复 VM harness 对新模块的模拟。
4. `package.json`、`package-lock.json`、发行说明：统一 6.22.0 内部版本与 6.22 公开文件名。

**验证与发布**：标签 Test [44834314357](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44834314357)、Windows 候选 [44834314452](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44834314452)、main Test [44833907760](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44833907760)、main CodeQL [44833907850](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44833907850) 均成功；候选含 110 项平台检查、FFmpeg 对应源码和媒体摘要校验、x64 NSIS 安装/重装及真实 1.80.0 → 6.22.0 资料保留升级。发布工作流 [44836461596](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44836461596) 全部成功，v6.22 Release 已公开且不可变。

**后续优先项**：补齐 Authenticode 代码签名链和 Electron fuse；继续处理下载状态机、磁盘空间预检、JSON `.bak` 恢复、FFmpeg watchdog、日志脱敏、Vite 大 chunk 与真实 GUI/媒体/NAS/应用内更新验收。

## 2026-11-21 · 下载管理与设置边界（发行 6.21）

**巡检结论**：下载管理筛选和批量任务操作、设置卡片搜索与代理保存边界已进入 `main`，并绑定正式标签 `v6.21`。Windows 候选、源码 Test 和 main CodeQL 均通过；正式 Release 已公开且不可变。发布工作流最后的匿名公开入口探测因 runner 收到 HTTP 403 失败，但发布后的 GitHub API 与本机公开 URL 核验确认目标资产已公开；该差异已记录在 [6.21 回执](docs/release-6.21.md)，不将流水线记为全流程成功。

**代码变更**（随 `83fb32c` 进入 main）：

1. `src/components/DownloadManager.jsx`：筛选、状态分组、跨页选择和批量停止／重试／删除边界。
2. `src/components/Settings.jsx`：实际卡片过滤、多词匹配、键盘定位、草稿保留、代理字段隔离和迟到读取保护。
3. `scripts/check-ui-theme.cjs` 及设置／下载回归：使用固定导航程序，补充执行边界；Windows 首次使用 FFmpeg 前校验对应源码与二进制摘要。

**验证**：标签 Test [44827042678](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44827042678)、Windows 候选 [44827042693](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44827042693)、main CodeQL [44827029274](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/44827029274) 成功；`npm test` 通过单元测试与 110 项平台检查，React 构建及生产依赖审计通过。研究了 6 个开源参考项目，结论见本轮交付报告。

**后续优先项**：限制生产环境对 `VITE_DEV_SERVER_URL` 的信任范围，补充负向回归；随后处理发布签名验收、Electron fuse、下载任务状态机和 GUI／真实媒体更新链路。

## 2026-11-21 · 文件边界安全加固（发行 6.20）

**巡检结论**：远程无开放 Issue/PR；Dependabot 0；官方 registry 生产依赖 audit 0；渲染构建产物逆向暴露面扫描 A（无 source map、无明文秘密）。发现 6.18 发布流水线末步公开入口探测 HTTP 403（资产已公开、下游 6.19 流水线全绿，判断为瞬时/限流类问题）；发现 6.19 引入 3 个 CodeQL 中危告警（测试脚本）；核心代码审查确认两处 P1 本地文件边界风险。

**代码变更**（PR → main，随 6.20 发布）：

1. `src/native/text-export.js`：随机独占临时文件、目录/文件身份核验（BigInt stat）、批次级目录绑定、链接拒绝。
2. `main.js`：删除入口快照目录+最终文件身份并在异步等待后复核；目录扫描拒绝链接目录/文件；批次预校验分集编号；单集删除失败保留记录；目录身份含 inode（JSON 安全字符串）；旧任务持久化身份优先。
3. 新回归 27 例 + 版本比较扩展到 6.20。

**验证**：新增回归全过；全量 `npm test` 通过（292 单元 / 106 平台，见 CI）；`npm run build:react` 通过。独立代码复核代理提出的 5 个 P1/P2 意见均已落实或评估采纳（批次预校验、文件身份快照、记录保留、批次绑定、旧身份兼容）。

**发布**：6.20（内部 6.20.0）已正式发布——PR #22 全部检查通过后合并（`1606a28`），标签 Test 44796108130 与 Windows 候选 44796108261（含安装/重装/1.80 升级）成功，发布流水线 44798090478 全流程成功（含公开入口探测，较 6.18 的 403 已消除）；公开资产恰好两项（安装 EXE 146,462,386 字节 + latest.yml 380 字节，SHA-256 见回执），`/releases/latest` 已指向 v6.20。回执见 [docs/release-6.20.md](docs/release-6.20.md) 与 [RELEASING.md](docs/RELEASING.md)。
