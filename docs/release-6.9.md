# 红果短剧 6.9

状态：已正式发布（内部版本 `6.9.0`，标签 `v6.9`）。冻结提交 `65cf664da8e342a1b5114761faf45a9aab01d8df`；于 2026-11-13 12:00:35（Asia/Shanghai）公开。仅 Windows x64。[GitHub Release v6.9](https://github.com/yuchen0x1/HongGuo-PC/releases/tag/v6.9)。

## 本轮修复

- 统一登记任务删除、看完清理、整剧清理、缓存清理和后台文字导出；退出等待处理与记录保存，超时取消本次退出。
- 安装更新前检查维护、设置保存、缓存收尾与取消中的在线任务；安装开始后不再接受新的维护操作。
- 来源较短响应不再缩短已知分集档案，同时更新对应分集的锁定状态；较完整响应仍可新增分集。
- 修复 Ctrl+K 面板悬停索引和回车导航，及来源加载中或页面隐藏时消费搜索指令的问题。

## 发行形态

- 仅发布 `hongguo-downloader-6.9-win-x64-setup.exe` 与由最终 EXE 生成的 `latest.yml`。
- 沿用固定 GitHub 更新源、HTTPS 与 SHA-512 校验。Windows 安装包仍未配置代码签名。
- GPL FFmpeg/x264 对应源码归档随安装目录附带，不另列普通下载资产。
- 不改写历史标签、安装包或正式用户资料；本机正式安装不替换。

## 验证与回执

- 定向回归已覆盖：批量删除中退出、维护任务阻止安装及失败后解除、分集列表防缩短与访问状态刷新、悬停回车导航、等待来源后搜索、隐藏页面延后搜索。
- PASS：`npm test`，280 项单元测试及 102 项平台检查；包含新增场景及随机真实素材的损坏解码回退。
- PASS：`npm run build:react`、`node --check main.js`、`node --check preload.js`、`node scripts/check-release-version.cjs`、`git diff --check`。
- PASS：[源码 Test 43361447260](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/43361447260)，与冻结提交一致；280 项单元测试、102 项平台检查及新增场景通过。
- PASS：[Windows x64 release candidate 43361447294](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/43361447294)，与冻结提交一致；真实素材解码、匹配的 FFmpeg/x264 对应源码、新装、启动、重装及真实 1.80.0 → 6.9.0 手动 NSIS 升级资料保留通过。安装器回执 `passed: true`、`authenticode: NotSigned`。
- PASS：[正式发布 43362608204](https://github.com/yuchen0x1/HongGuo-PC/actions/runs/43362608204)，校验标签、两项 CI 的提交、最终 EXE 大小及 SHA-512 后公开 Release。

## 公开资产

- `hongguo-downloader-6.9-win-x64-setup.exe`：146,473,439 字节；SHA-256 `ca1e28e28b21f38550fedc4f7c28325089aaa1610e07c917d211dca760659e36`。
- `latest.yml`：377 字节；SHA-256 `5ab7eeb3c2dc7cdd8228e755200a9ada7b70e7a1dfaa3813ec538ce7a08cc51c`。
- 元数据安装包 SHA-512：`TwNqfZvkhpfrgoRjruE0feF4+ruivv3e9qqKSRiRn6W2oNpQcBFiamc1N6O5dRF2jMP2C08/KZoxg48DJ7Zyew==`，与候选最终 EXE 字节相符。
- 已下载候选并核对原始 artifact ZIP 摘要、EXE、元数据和未签名状态；公开资产清单及服务端 SHA-256 与候选一致。已通过匿名公开地址完整下载 EXE 与 `latest.yml`，版本、大小、SHA-256、SHA-512 和元数据字节均与候选一致；EXE Range 下载也通过。

## 真实素材与边界

- 完整测试中的解码回归改为在红果官网随机选剧并真实下载公开片段；不使用彩条或测试图。下载及衍生的解码文件仅保存在本轮临时目录，全程不播放声音。
- 2026-11-13 本地素材示例：《诚信第一，我在都市找老赖们收债》第 1 集，series ID `7704590737282714649`，episode ID `7704592712854424601`。
- 来源页：https://hongguoduanju.com/player/7704590737282714649/7704592712854424601 。公开下载为 1,098,042 字节，SHA-256 `b4fa2254131438633aefbcfda3678a8e2eabfd3d5ab3fee907d93ea5096544de`。后续每次完整测试重新随机选取，来源与摘要记入测试日志，不记录签名媒体地址或身份凭据。
- 完整本地回归另随机下载《贪恋她》第 1 集，series ID `7699057188311927870`，episode ID `7699060337202449433`，1,080,974 字节，SHA-256 `2ce843cc9d439d423c1848ca9fb28fc51a45bad9f82f0eaaf91e8a564ccd85cc`；来源页 https://hongguoduanju.com/player/7699057188311927870/7699060337202449433 。解码回归通过。
- 最终素材选择使用随机剧目的官网规范播放页，由页面选择当前公开分集，支持常规 DNS 回退；本地复查《错失的遗憾》第 1 集，series ID `7706004220599618584`，episode ID `7706006636074126361`，768,339 字节，SHA-256 `d3a819d489bc5422a33206d2c1397814734b8d5393cb6d720290c0d2e7e6b0bf`；26 项下载质量检查通过。
- 冻结提交的源码 CI 随机素材：《王妈在顾家当保姆后全家只会搞笑了》第 1 集，series ID `7694653385668037657`，episode ID `7694655440692448281`，1,378,612 字节，SHA-256 `2e87b28a862d9375247bae74cc34982103de20cc1b70a6e1590298040a1eac62`；来源页 https://hongguoduanju.com/player/7694653385668037657 。真实损坏解码回退通过。
- 解码步骤：从真实下载截取 1 秒静音片段，构造可探测但无法解码的损坏副本，验证失败回退、完整发布及失败临时文件清理；不影响正式视频。
- 官网公开素材可能只是预览，不能替代完整分集播放验收。此轮未将真实红果完整分集 GUI 播放、画中画、连播、自动删除或真实客户端应用内跨版本升级记为通过。
- 真实取源探测中部分剧集官网仅提供预览、App 接口返回空响应；此为外部取源限制，本轮未放宽完整片源校验。
