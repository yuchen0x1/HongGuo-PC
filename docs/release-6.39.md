# 红果短剧 6.39 发行（许可与发行方式调整）

6.39（内部 `6.39.0`）只调整许可与发行方式，应用功能、播放取源、播放器、下载与资料格式与 6.38 相同。正式资产为 Windows x64 安装 EXE、匹配的 `latest.yml`，以及本版本对应源码归档。

## 背景

用户于 2026-11-26 要求"核心代码不再公开"。经核对，本项目是 GPL-3.0 派生作品：

| 来源 | 许可证 |
| --- | --- |
| `327044572/hongguo-downloader`（`NOTICE` 一、上游项目） | GPL-3.0 |
| `zhenyong97/hongguo-downloader`（Mac 移植上游） | GPL-3.0 |
| `jackotom/hongguo-drama`（README 声明的上游） | GPL-3.0 |
| `src/native/licenses/LICENSE.drpys.txt`（取源算法改编来源） | GPL-3.0 |

派生作品不能整体改为闭源许可，也不能只闭源其中一个模块。GPL 允许的做法是：源码不必放回 Git 仓库，但必须向二进制接收者提供对应源码。因此本版本改为**源码随发行附件提供**：核心实现不进入公开仓库的提交与历史，每个发行版本附带完整源码归档。

未采用的方案：把 `LICENSE` 改成专有许可（对上游代码无效，且会形成无权作出的授权声明）；取得上游书面授权（需要 327044572、zhenyong97、jackotom 及 drpys 相关作者同意）。

## 变更

- `NOTICE` 第 4 行发行标识与"四、对应源码"改写：说明自 6.38 起源码以 `hongguo-downloader-<版本>-source.tar.gz` 随 Release 提供，仓库历史不含 6.38 及之后的播放取源实现。
- `README.md`「声明」补充源码获取位置；徽章与 GPL-3.0 许可不变。
- `package.json`、`package-lock.json` 与 `scripts/check-release-version.cjs` 升至 `6.39.0`，下载文件名同步为 `6.39`。
- 6.38 发行页已锁定（仓库启用发行不可变），无法追加附件，其源码归档与本次同页提供。

## 验证结果

| 验证项 | 结果 | 回执 |
| --- | --- | --- |
| `npm test` | 通过；主单元 778 项、平台检查 119 项，失败 0、跳过 0 | `.local/analysis/` 本轮日志 |
| 版本与发布说明检查 | 通过；6,084 组版本组合、38 个历史版本说明模板 | `check-release-version.cjs`、`check-release-notes.cjs` |
| 打包程序逐集播放 | 通过；第 6、22、34、68、88 集 `playing`，与 6.38 同线路同端口径 | 本轮 `dist/playback-later-*` 回执 |
| 安装包与清单 | 通过；版本信息 `6.39.0`，配置检查通过，`latest.yml` 与安装包一一对应 | `check-windows-installer.cjs --config` |
| 安装/重装/卸载 | 未在本机执行 | 需在 Windows 上单独确认 |
| 旧版应用内更新 | 发布后校验清单可达与摘要；实机升级未执行 | 见发布回执 |

## 覆盖与限制

- 本版不含功能变更，6.38 的覆盖与限制继续适用：只逐集验证目标剧第 6、22、34、68、88 集。
- 源码归档是构建该发行版本的完整源码快照，含安装与构建脚本；不包含 `node_modules`、本机测试资料或带签名媒体地址。
- 播放验收全程静音；未做声音输出质量验收。

## 发布资产

- `hongguo-downloader-6.39-win-x64-setup.exe`
- `latest.yml`
- `hongguo-downloader-6.39-source.tar.gz`
- `hongguo-downloader-6.38-source.tar.gz`（补挂）

不发布便携包、blockmap 或 hash 清单；旧客户端更新所需的历史清单保留。

## 发布回执

- 发布于 2026-11-26 22:17:17（北京时间），标签 `v6.39` 指向公开提交 `41403a79e80a87512c903a9d0c5e83885d9cfe91`，Release 标记为最新版本。
- 四项正式资产：`hongguo-downloader-6.39-win-x64-setup.exe`（157,171,695 字节，SHA-256 `817d6b9d480f5383b9bba18cbfa7a99b966487f822fdc53876cb35e26dbe492e`）、`latest.yml`（380 字节）、`hongguo-downloader-6.39-source.tar.gz`（5,652,505 字节，SHA-256 `fc22fb9b7f600b3733c274e2321ec2f745dfb1c35678b7a921c159c6643314a8`）、`hongguo-downloader-6.38-source.tar.gz`（5,650,291 字节）。
- 旧客户端更新路径：从 `releases/download/v6.39` 实际下载 `latest.yml` 与安装包，清单与本机构建逐字节一致，安装包 SHA-512（`ii5qimja…tph+8Q==`）与字节数均与清单相符，公开下载返回 HTTP 200。
- 对应源码：6.39 源码归档与本地构建逐字节一致，内含 `src/native/playback-profiles.js` 的 `VIDEO_MODEL_PROFILE`，版本号为 `6.39.0`；6.38 源码归档同时补挂。
- README 同步工作流在发布后自动完成。
- 标签推送触发的 `Windows x64 release candidate` 会用公开（不含取源实现）源码构建，已取消，避免产生与发行包不符的候选凭证。
- 未执行：本机安装、重装、卸载清理、旧版应用内升级与声音输出验收。
