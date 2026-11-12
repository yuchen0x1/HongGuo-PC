# 红果短剧项目审计与本地改进报告

审计日期：2026-11-09（Asia/Shanghai）
项目路径：`C:\Users\lenmo\Desktop\HongGuo-PC`
范围：本地静态检查、现有自动化测试、React 生产构建、依赖安全审计、文档修正。没有提交、推送、发布或启动应用服务。

## 1. 项目现状

- **用途与类型：** 红果短剧社区桌面客户端，支持搜索、发现、在线/本地播放、下载、记录管理及桌面窗口功能；不是平台官方客户端。
- **技术栈：** JavaScript、React 18、Vite 6、Electron 44、Node.js；npm 与 `package-lock.json` 管理依赖。持久化主要由本机 `src/store.js` 承担，当前代码树未发现服务端工程或数据库迁移目录。
- **版本：** `package.json` 为 `6.6.0`，Git 标签 `v6.6`；当前分支 `main`，HEAD `ae2183f`（`docs: 6.6 发布回执`），与 `origin/main` 同步。
- **架构：** `main.js` 管理 Electron 主进程及 IPC 编排；`preload.js` 提供受限桥接；`src/native/` 承担来源接入、播放、下载、媒体访问、存储等本机业务；`src/components/` 与 `src/App.jsx` 是 React 界面；`scripts/` 集中维护回归和发行检查；`docs/` 保存专项说明及逐版记录。
- **代码规模盘点：** `src/` 下 133 个 JS/JSX/MJS/CJS 文件；`scripts/` 下 111 个 `.cjs` 检查脚本；另有 34 个组件/主进程测试文件。项目有较广的回归覆盖，但脚本数量多，后续可考虑统一分类与报告格式。
- **质量评价：** 模块覆盖面广，已有大量边界条件和安全回归测试；自动化证据较强。主进程体量大（`main.js` 约 275 KB），值得持续评估模块边界。前端 3.45 MB 未压缩 chunk 是 Anime4K 按需加载 chunk，应用主入口约 505 KB；未启用 Anime4K 时不会作为主入口下载。按需加载是现有设计优势，不应误报为启动负担。仅凭静态审计不能证明所有外部平台流程实际可用。

### 核心模块对应

| 能力 | 主要目录/文件 |
|---|---|
| 搜索、发现、来源 | `src/components/SearchPanel.jsx`、`Browse.jsx`、`src/native/*search*`、`catalog.js`、`custom-source.js` |
| 播放、弹幕、投屏、小窗 | `Player.jsx`、`PlayerControls.jsx`、`CommentDanmaku.jsx`、`src/native/media-*`、`casting.js`、`floating-player-window.js` |
| 下载、转码、合并、NAS | `HongguoDownload.jsx`、`DownloadManager.jsx`、`src/native/merge-*`、`nas-export.js`、主进程下载 IPC |
| 历史、收藏、日历、本地库 | `WatchHistory.jsx`、`ReleaseCalendar.jsx`、`src/native/watch-history.js`、`src/localLibrary.js`、`src/store.js` |
| 安全与桌面集成 | `preload.js`、`renderer-security.js`、`media-access.js`、`web-media-guard.js`、窗口/快捷键 native 模块 |

## 2. 清理记录

- **删除文件：** 无。扫描结果不足以证明仓库内任何疑似构建目录、媒体工具或资源是无用的；依照规则保留。
- **删除依赖：** 无。声明依赖均需通过调用关系和打包使用关系逐项确认，未发现足以支持移除的证据。
- **依赖数量：** `npm ls --depth=0` 显示 14 个直接依赖（3 个运行依赖、11 个开发依赖）；`npm audit` 元数据统计 423 个安装依赖。
- **安全审计：** 默认 npm 镜像不支持 audit API，首次请求返回 404。改用官方 npm registry 重试成功，报告为 0 个已知漏洞（info/low/moderate/high/critical 均为 0）。这是当前依赖树的 advisory 结果，不代表运行时或供应链风险为零。
- **清理前后文件/依赖变化：** 文件删除 0，依赖删除 0；数量不变。没有对 `dist/`、`dist-6.6/`、`dist-react/`、`build/`、`node_modules/` 或 `.workbuddy/` 做清理。
- **保留的重要内容：** 用户未提交修改 `scripts/check-window-layout.cjs`、`src/index.css` 与未跟踪目录 `.workbuddy/` 均原样保留；`build/ffmpeg/` 含发行所需媒体工具和许可证，保留。

## 3. GitHub 竞品研究

本轮对 Motrix、FreeTube、Stremio Shell 检查了公开 README/发行记录、代表性构建文件或许可证原文。GitHub API 限流使 Stars 不能一致核实；不列不可靠的星数。逐仓证据与范围见 [GitHub 优秀项目对标分析](docs/GITHUB_COMPETITOR_ANALYSIS.md)。

| 候选仓库 | 本轮核实内容 | 对本项目的参考价值/限制 |
|---|---|---|
| `agalwood/Motrix` | README 描述 Electron + React + TypeScript；v2.4.0 于 2026-11-08 发布，列出统一下载 core、引擎适配器、SQLite 会话恢复、Zod 边界校验、多平台 CI 与发行校验；仓库 LICENSE 为 MIT。 | 架构边界、任务恢复和发布矩阵可作设计参考。它是通用下载器，不能直接替代本项目的短剧来源/解密/媒体安全链路；不复制代码或引入引擎。 |
| `FreeTubeApp/FreeTube` | 仓库公开 LICENSE 为 AGPL-3.0；公开设置文案涵盖订阅源刷新、缓存与隐私选项。本轮未逐模块 checkout，功能观察限于公开说明。 | 可参考隐私说明、用户控制和刷新状态的产品表达；迁移 AGPL 代码需单独许可证审查，本轮不迁移。 |
| `Stremio/stremio-shell` | README 构建路径使用 Qt/qmake；CMake 源清单可见 C++ 主进程、QML 资源和 libmpv 连接。仓库 LICENSE 路径未能核实（raw 地址返回 404），不据此推定许可。 | 展示了媒体壳与播放引擎桥接的另一种方式；原生 Qt/libmpv 与当前 Electron/Chromium 流程差异大，迁移成本和平台风险较高。 |

**对比结论：** 当前项目优势是短剧领域流程和覆盖权限、来源身份、断点恢复、临时资源清理的大量测试；差距是 `main.js` 边界较宽、UI/业务分层尚无静态架构门禁。本轮未引入竞品依赖。功能差距与验收建议见 [项目功能缺失与升级清单](docs/PROJECT_GAP_ANALYSIS.md)。

## 4. 发现的问题

### 已修复

- README 开发构建说明调用了不存在的 `npm run setup-ffmpeg`，而实际 Windows 准备脚本为 `node scripts/setup-ffmpeg.js`。已修正文档命令，避免用户执行失败。
- README 把 `npm run zip` 标为从头构建便携 ZIP；该脚本仅调用 `make-zip.js`，要求先有 `dist/win-unpacked`。已改为 `npm run build:zip`，该脚本先生成目录再打包。

### 一般/潜在问题

- `main.js` 体量约 275 KB，职责范围较广；当前未做跨模块重构，因为本次未定位到某个可隔离迁移且能低风险验证的切片。
- Vite 对 3.45 MB 异步 Anime4K chunk 发出通用大 chunk 提示；入口 chunk 约 505 KB。`src/videoEnhancement.js` 已通过动态 `import('anime4k-webgpu')` 仅在选择 Anime4K 时加载。后续可分别采集冷启动和启用增强的性能；当前证据不支持为减少首次加载而再拆分它。
- README 记载“开发环境要求 Node ≥22.12”，构建测试使用当前 Node 24.20.0。命令输出提示本机 npm 配置含 `store-dir` 未知配置；未修改全局配置。
- 全仓 `TODO/FIXME/HACK/XXX` 搜索（排除构建及依赖目录）未发现命中；搜索结果不能证明不存在逻辑缺陷或不可达代码。
- 项目使用的真实外部服务与用户账号流程未进行在线端到端测试；本轮没有启动 Electron，也没有对第三方平台发起应用功能请求。

## 5. 功能升级

- **新增功能：** 无。本轮没有找到有足够证据且可在当前审计时间内完成端到端验证的核心新功能。
- **优化：** 修正 README 的 Windows FFmpeg 准备和便携 ZIP 构建命令；既有用户修改的浅色/深色下拉箭头样式断言与 CSS 不被覆盖。
- **整合/删除：** 无；没有复制竞品代码、迁移模块或删除冗余功能。
- **验证：** 通过既有 `npm test`（279 个 Node 测试和 101 项平台检查）；本轮修复只涉及 README 文档，测试结果证明当前代码基线通过，不构成 FFmpeg 实际下载或打包验证。

## 6. 架构升级

- 架构未重构，目录未移动，依赖声明及锁文件未改变。
- 没有确认足以承担架构迁移风险的具体缺陷。建议未来按业务边界逐步把主进程编排拆为模块，每次迁移配套 IPC 契约测试及行为对照，而非一次性重写。

## 7. UI/UX 升级

- 本轮没有改动界面实现或视觉系统。复核发现 Anime4K 已按需动态导入，属于现有性能设计，不重复实现。
- 现有 UI 设计规范见 `DESIGN.md`；已有浅色主题下拉控件修复的本地 CSS/检查脚本修改由用户保留。本轮运行的 `check-window-layout.cjs` 已覆盖相应规则。

## 8. 测试报告

| 检查 | 结果 |
|---|---|
| `npm test` | 通过：279 个 Node 测试通过；项目测试入口报告 101 项平台检查通过 |
| `npm run build:react` | 通过；入口约 505 KB，Anime4K 异步 chunk 约 3.45 MB；Vite 对异步 chunk 发通用体积提示 |
| `npm ls --depth=0` | 通过；14 个直接依赖均可解析 |
| `npm audit`（官方 registry） | 通过：0 个已知漏洞；423 个依赖被纳入元数据统计 |
| 默认镜像 `npm audit` | 未能使用：镜像 audit API 返回 404；随后已切换官方 registry 成功重试 |
| Electron GUI/真实媒体/外部账号流程 | 未运行/未验证 |
| 完整 Windows installer 构建 | 本轮未运行；仅已有 6.6 发行记录，不将其冒充为本轮验证 |

运行环境检查发现多个其他 Node 进程及端口占用；没有结束任何进程。本轮只运行无服务测试和前端构建，没有占用端口。没有找到可确认属于本轮的应用服务进程，因此无测试服务需要清理。

## 9. 文件修改记录

- **新增：** `PROJECT_AUDIT_REPORT.md`、`docs/GITHUB_COMPETITOR_ANALYSIS.md`、`docs/PROJECT_GAP_ANALYSIS.md`。
- **修改：** `README.md`（FFmpeg 准备命令、便携 ZIP 构建命令）。
- **删除/移动：** 无。
- **保留的既存工作区改动：** `scripts/check-window-layout.cjs`、`src/index.css`、`.workbuddy/`。

## 10. 最终质量评估

- **审计前：** 仓库已有已发布的 6.6 代码基线、大量回归测试和专项文档；一个 README 命令与项目脚本不匹配。
- **审计后：** 命令已纠正；完整本地测试、React 构建和官方 registry 依赖审计通过。没有执行清理或大规模功能变更，因此不宣称项目整体质量已全面升级，也不宣称外部平台功能已端到端验收。
- **Git：** 未创建提交、标签或推送。本轮改动为 README 与三份审计/分析文档；既有工作区修改及 `.workbuddy/` 保留。

## 11. 后续建议与验收重点

1. 复核 README 中 FFmpeg 包体大小/准备说明是否与当前固定校验包一致，并考虑增加该脚本的无网络配置检查。
2. 对 505 KB 应用入口及 Anime4K 按需加载分别做冷启动和启用增强时的真实性能采样。
3. 继续核实竞品活跃度与 FreeTube/Stremio 模块源码及许可；本轮未一致取得 Stars，Stremio Shell 的 LICENSE 路径亦未核实。
4. 验收 README 开发与便携打包命令，并查看 `PROJECT_AUDIT_REPORT.md` 和两份专项清单中的真实媒体/账号流程及安装包构建缺口。

## 12. 2026-11-12 自动更新实施附录

本附录覆盖本轮在 `main` 工作区实施的更新能力，前文保留为 2026-11-09 审计基线，不再把当时“未新增功能”的结论当作当前状态。

- 正式 Windows x64 NSIS 安装版恢复 `electron-updater` 下载、SHA-512 校验、进度事件、取消和用户确认重启安装；开发版、预览版和便携版继续手动更新。
- 主进程安装前阻止下载、合并、转码、在线准备、设置保存和维护操作，失败时保留当前版本与已校验下载。
- 更新 UI 展示发布时间、安装包大小、更新说明、真实进度、取消、重试、手动发布页和重启安装。
- GitHub 发布工作流不再把版本硬编码为 6.7；候选工作流仍从最终 EXE 生成 `latest.yml`，发布前校验文件名、大小和 SHA-512。
- `npm test`：280 个单元测试与 102 项平台检查通过；`npm run build:react`、Node 语法检查、更新专项与 `git diff --check` 通过。
- v6.7 已发布二进制没有被改写；要让线上用户获得自动下载安装，必须发布包含当前 `main` 的新 Windows x64 Release。代码签名证书、真实 Release 下载/安装和实体 Windows 升级仍待外部验证。
