# 红果短剧 6.41 发行（分集目录签名恢复）

6.41（内部 `6.41.0`）修复 2026-11-27 官网分集目录改版后无法打开剧集的问题。官网页面现在只公开少量 `v1_` 不透明标识，完整目录改由带 V5 签名的 App 目录接口提供；本版恢复完整分集列表，同时保留既有播放取源与身份校验。

## 修复范围

- 官网分集页出现 `v1_` 标识时，不再把它误判为数字分集编号后直接失败。
- App 备用目录请求改为使用已有 `signPlaybackV5` 生成的签名请求，保留重试、空响应诊断和大整数解析。
- 测试夹具同时接受官网当前的 `v1_` 标识和历史数字标识，避免真实素材质量检查因页面格式变化而误报。

## 验证结果

| 验证项 | 结果 | 回执 |
| --- | --- | --- |
| `npm test` | 通过；单元测试与 120 项平台检查，失败 0、跳过 0 | 本轮源码工作区执行 |
| 定向身份与源恢复检查 | 通过；`check-hongguo-identity` 4/4、`check-source-recovery` 19/19 | 本轮命令输出 |
| 原生性能与下载质量 | 通过；`check-native-performance` 8/8、`check-download-quality-integration` 27/27 | 本轮命令输出 |
| 真实目录与整集解码 | 通过；3 部剧目录连续，目标剧第 6/22/34/68/88 集静音解码通过 | `docs/app-episode-list-2026-11-27.md` |
| Windows 安装载荷 | 通过；主程序、`app.asar`、FFmpeg、FFprobe 4 项逐字节一致，主程序 x64 PE | `scripts/check-installer-payload.cjs` |
| 安装版逐集播放 | 通过；6/22/34/68/88 集通过，真实结束事件下 22→23 自动连播通过 | `scripts/verify-playback-later.cjs`，隔离安装的 6.41.0 |

## 兼容性与限制

- 发行范围仍为 Windows x64 NSIS 安装版；GPL-3.0 许可和公开源码保持不变。
- 现有设置、剧库、观看记录和下载记录格式不变，目标是直接覆盖升级。
- 真实播放验收沿用全程静音和独立测试目录；本轮目录/解码结果不能推广为所有剧集或所有来源均可播放。
- 本地安装载荷与安装版实播门禁已经通过；正式 GitHub 候选、旧版安装器升级和 Release 资产校验仍以对应 Actions 回执为准。

## 计划发布资产

- `hongguo-downloader-6.41-win-x64-setup.exe`
- `latest.yml`

不发布便携包、blockmap 或 hash 清单；旧客户端更新所需的历史清单保留。

## 本机候选回执

- 本机暂存目录构建的安装器为 157,171,271 字节，SHA-256 `297e24311a2f61cbc2c62bc7440f71466497bd564d5b77381f093af2b845c864`；仅用于本机安装载荷与实播门禁，不代替 GitHub Actions 正式候选资产。
- 对应本机 `latest.yml` 为 455 字节，SHA-256 `c823fd07149f5aa61c488f4078b9966ed5d21e6e60673f6bff778047cc57cb46`；EXE 的 SHA-512 为 `O9ePcmO+n/Oxxo0CNXpCodODwPlDm3huVYFNkS/eAQaILbazDBy7gc76/+k8tg8XhldJfpZXMPLUeMID486oPA==`。
- 安装后主程序为 250,521,088 字节，SHA-256 `73fe219dab2380e01e68fdd361f7c980115a10bcbc0443520050eefa7c33f90e`；`app.asar`、FFmpeg 与 FFprobe 摘要见本机校验输出。
- 安装包未做代码签名。
- 未验证扬声器声音输出质量；播放验收为静音。

## GitHub 发布回执

- 2026-11-27（北京时间）公开发布 `v6.41`，标签冻结提交为 `4ec3c016ec0806978252dd4a63bf6144ae822cc8`；Release 名称为「红果短剧 v6.41」，非草稿、非预发布。
- 正式资产仅有 `hongguo-downloader-6.41-win-x64-setup.exe`（157,171,114 字节，SHA-256 `3f527c98e9044bae1751eec9edb7cf7ce8c2610f17e081f6ab3fbcd4e27d84b9`）和 `latest.yml`（455 字节，SHA-256 `283ae6ae92d96031f16057d7ab5c241f0476b973b032859e877ca64baccea45f`）。
- 公开 `latest.yml` 的版本为 `6.41.0`，安装器文件名、大小、SHA-256 和 SHA-512 均与公开安装器逐字节核对一致；公开安装器 SHA-512 为 `1axMAiVwi7P4J9sXUGA8lFDkqJqRBvvDvpb2mqoVL9FyaMFvM/u7W1L0F9WA1Snz3CZGEpiAwiSt/WNAWM/Zhw==`。
- 标签源码 Test 重跑 `45876605599`、Windows x64 候选 `45876605694`、发布 `45878489805` 和 README 同步 `45878550262` 均成功；候选包含隔离安装、重装、账号资料保留及真实 `1.80.0` 升级检查。
- 旧客户端所需的 `latest.yml` 已从公开下载入口取得（HTTP 200），与正式 EXE 保持一一对应；Release 未上传便携包、blockmap、hash 清单、本地回执或测试媒体。
