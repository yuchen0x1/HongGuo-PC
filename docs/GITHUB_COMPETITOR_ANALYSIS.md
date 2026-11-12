# GitHub 优秀项目对标分析

研究日期：2026-11-09。目标是提取可迁移的设计思想，不复制实现。Stars 受到 GitHub API 限流影响，故不列未经一致核实的数值。

## 研究对象与证据

| 仓库 | 代码/文档观察 | 活跃度与许可 | 可借鉴点 | 与本项目差距及限制 |
|---|---|---|---|---|
| [agalwood/Motrix](https://github.com/agalwood/Motrix) | 当前 README 描述 Electron、React、TypeScript 桌面下载器。v2.4.0 发布说明描述抽离通用下载 core、按传输引擎适配、SQLite 会话恢复、Zod 配置校验、平台 CI 和资产校验。 | v2.4.0 发布于 2026-11-08；LICENSE 为 MIT。Stars 未从受限 API 可靠读取。 | 通过 adapter/core 隔离下载执行器；让任务恢复有持久化状态与校验；发布产物有可重复的 CI 验收。 | Motrix 面向通用下载和 aria2 类传输，不包含本项目平台身份、剧集权限、签名、媒体解密、受控本地媒体访问等约束。不能代替现有下载队列，也不应直接引入其传输引擎。 |
| [FreeTubeApp/FreeTube](https://github.com/FreeTubeApp/FreeTube) | Electron 媒体客户端。仓库公开界面/设置文案体现订阅与缓存等用户控制项；本轮没有逐文件 checkout，故不对其内部数据流或安全代码作强结论。 | LICENSE 标记 AGPL-3.0。仓库活跃状态和 Stars 未在本轮统一核实。 | 隐私选项要用用户能理解的方式说明；缓存与自动刷新应可控并反馈状态。 | 其平台与媒体模型不同。AGPL 代码迁移存在显著许可义务，本轮不复制代码；仅把产品原则列为观察项。 |
| [Stremio/stremio-shell](https://github.com/Stremio/stremio-shell) | README 的构建路径是 Qt/qmake；CMake 源清单可见 C++、QML 和 libmpv 集成。 | GitHub 搜索页面显示约 934 Stars（本轮页面快照，不保证实时）；LICENSE 原始路径返回 404，许可未确认。 | 桌面播放器可把视图壳、播放引擎和平台适配边界分开。 | 当前项目基于 Electron/Chromium 并已集成自有播放恢复、媒体 URL 权限与渲染安全；迁移 Qt/libmpv 会扩大技术栈和维护面，未发现足以抵消成本的场景。 |

## 横向比较

| 维度 | HongGuo-PC（本地代码） | 候选项目中可核实的做法 | 差距/判断 |
|---|---|---|---|
| 核心领域 | 多来源短剧发现、搜索、播放、下载、追剧、NAS 导出 | Motrix 通用下载；FreeTube 媒体订阅；Stremio 桌面媒体壳 | 本项目领域工作流更专用，竞品没有可直接替代的短剧能力 |
| 架构 | Electron 主进程 + React renderer + preload + native modules；`main.js` 仍较大 | Motrix v2.4 文档强调 core 与 transport adapters；Stremio 使用 Qt/QML/libmpv | 可以逐步收敛本项目主进程职责边界；不宜迁移技术栈 |
| 性能 | Anime4K 大模型依赖使用动态 import；主入口约 505 KB，增强 chunk 约 3.45 MB | 候选项目的优化数据没有在本轮可重复测量 | 现有按需加载正确；需要实际冷启动和 GPU 使用采样，不能仅凭静态 chunk 大小判定瓶颈 |
| 安全 | renderer 隔离、受信 IPC、媒体访问能力和 URL/DNS 边界有专项测试 | FreeTube 以隐私为产品重点，但本轮未进行代码级安全比较 | HongGuo 的媒体源安全边界较具体；需要定期把安全测试和真实 GUI 路径结合 |
| 测试/发行 | 现有 `npm test` 执行 101 项平台检查，且有 Windows release checks | Motrix 发行说明提及多平台 CI 和校验资产 | 可持续保持可复现验收；本轮没有重新构建安装包 |
| 扩展 | 自定义采集源适配和配置已存在 | Motrix 展示传输 adapter 抽象 | 当前来源插件边界有价值；不应为“插件系统”增加通用运行时代码，除非出现明确第三方扩展需求 |

## 采用与不采用

- **采用为后续设计原则：** 下载 core 与来源/传输 adapter 的依赖方向清晰；对下载恢复、任务状态和发行校验维持独立验证；隐私和缓存控制应在 UI 中解释清楚。
- **本轮实际整合：** 没有复制或引入竞品代码/依赖。README 里纠正了便携构建命令，属于本项目自身脚本与文档对齐。
- **暂不采用：** Motrix 的通用下载引擎、Qt/libmpv 壳、FreeTube 源码、云同步、多用户和插件运行时。它们要么不匹配领域，要么增加维护/许可/隐私面。
- **研究限制：** GitHub API 限流，Stars 无法对全部项目统一核对；FreeTube 未逐文件源码审计；Stremio Shell 的许可未确认。结论不作为安全或法律意见，也不授权代码复用。

## 参考

- Motrix README、v2.4.0 Release、LICENSE：仓库中的 README、Release 和 LICENSE 页面。
- FreeTube README、LICENSE：仓库当前默认分支页面。
- Stremio Shell README、CMake 源清单、LICENSE 路径：仓库当前默认分支页面。
