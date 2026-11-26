<div align="center">

<img src="build/icon.png" alt="红果短剧" width="104" height="104">

# 红果短剧 · 桌面版

**挑一部喜欢的，让故事继续。**

搜剧、播放、下载、追更新、合并导出 —— 一个窗口里全部搞定。

[![Release](https://img.shields.io/github/v/release/yuchen0x1/HongGuo-PC?style=flat-square&label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC)](https://github.com/yuchen0x1/HongGuo-PC/releases/latest)
[![Platform](https://img.shields.io/badge/Windows-x64-0078D6?style=flat-square&logo=windows&logoColor=white)](#-下载)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue?style=flat-square)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-45-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)

[下载](#-下载) · [界面](#-界面) · [功能](#-功能) · [常见问题](#-常见问题) · [开发](#-开发) · [声明](#-声明)

</div>

![发现短剧](docs/screenshots/01-discover.png)

---

## 📦 下载

从[最新正式版](https://github.com/yuchen0x1/HongGuo-PC/releases/latest) 下载 Windows x64 安装包。

| | |
|---|---|
| **下载地址** | [GitHub Releases 最新版](https://github.com/yuchen0x1/HongGuo-PC/releases/latest) |
| **文件** | `hongguo-downloader-<版本>-win-x64-setup.exe` |
| **安装** | 双击运行，向导式安装，可自选安装目录 |

安装包**未做代码签名**。首次运行若弹出 SmartScreen 提示，点「更多信息 → 仍要运行」。

历史版本的安装包保留在[发行页](https://github.com/yuchen0x1/HongGuo-PC/releases)。

> 发布页里还能看到一个 `latest.yml`，它是旧版和后续安装版自动更新所需的元数据，不是安装程序，不要单独运行。

### 应用内更新

Windows x64 NSIS 安装版检查 GitHub 正式版本。自 6.32 起，下载完成并核对官方文件大小、SHA-256 和 SHA-512 后，由你选择何时重启安装；旧客户端继续使用各自原有的更新流程。开发版、预览版和便携版可从 GitHub 发布页手动下载安装。详见 [应用内更新指南](docs/AUTO_UPDATE.md)。

6.37 已正式发布，真实 v6.35 → v6.37 更新提醒、下载、校验、重启安装和隔离资料保留验收通过。继续保留 GitHub 官方优先、GH-Proxy 备用下载和完整性校验；两个 GH-Proxy 域名属于同一服务，网络验证范围见 [6.32 发行记录](docs/release-6.32.md)。

6.37 修复详情加载不结束、收藏失败误报成功、剧集编号精度及媒体读取停滞，保留统一播放调度与设置页「播放诊断」。**后续集播放仍未全部修复：实测第 6、34、68 集无有效片源，不能用前 1–5 集代表整部剧。** App 播放接口空响应仍在复现；官网线路仅接受官方明确公开且完整时长校验通过的分集。正式发行与验收边界见 [6.37 发行记录](docs/release-6.37.md) 与 [全面审计](docs/independent-client-audit-2026-11-25.md)。

| 平台 | 发现与搜索 | 播放与本地剧库 | 下载和 NAS 导出 | 应用内更新 |
|---|---|---|---|---|
| Windows 10/11 x64 安装版 | 支持 | 可用片源及本地媒体；后续集取源故障仍存在 | 支持本地与已挂载的 NAS | 支持 |

历史平台与候选平台的验证边界见 [平台评估](docs/platform-assessment.md)。

## 最新更新

<!-- github-release:start -->

**[v6.38](https://github.com/yuchen0x1/HongGuo-PC/releases/tag/v6.38)** · 2026-11-26

本次更新修复了中后段分集一直取不到片源、无法播放的问题：第 22 集等后续集现在可以真正取到片源并连续播放，Windows 打包程序已逐集实测通过。分集映射和剧号精度同时加固，界面、播放器、画中画、连播与兼容模式保持不变。

[全部发行记录](https://github.com/yuchen0x1/HongGuo-PC/releases)

<!-- github-release:end -->

[完整更新记录](docs/releases/release-notes.md)

### 故障排查

设置 → 配置文件位置中提供“导出诊断信息”。导出的 JSON 只包含版本、运行状态、任务统计、存储状态、代理模式和 FFmpeg 可用性；不会包含代理密码、签名媒体地址或本地绝对路径。提交前仍请检查文件内容并移除你不希望分享的业务信息。

6.35 在设置中提供独立「播放诊断」，可检查账号、测试播放连接并导出脱敏报告；取源、媒体加载和首帧播放分别记账。报告不包含完整 Cookie、账号和设备标识、签名密钥或完整媒体地址。

维护状态与路线图见 [维护看板](docs/maintenance.md) 和 [升级清单](UPGRADE_ROADMAP.md)。开发者可查看 [贡献指南](CONTRIBUTING.md)、[架构审计](PROJECT_AUDIT.md) 与 [竞品研究](COMPETITOR_ANALYSIS.md)。

常见代理、更新、FFmpeg 和真实媒体验收边界见 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)。

---

## 🖼 界面

### 发现短剧

![发现短剧](docs/screenshots/01-discover.png)

首页是找剧的主入口，一屏里同时给你四条线索：

- **来源 + 目录线路**：红果 / 西饭 / 金鹰 / 海盗 / 硕博等来源随选随切；「App 快速线路」秒出部分片单，要完整目录切到「官网」
- **分类 × 题材**：真人剧、漫剧、AI 剧、漫画四大类，下面挂动作、逆袭、悬疑、古装等题材筛选项
- **榜单**：综合 / 真人 / 漫剧 / AI 四张热播榜，按来源自身热度排序，不打乱顺序
- **换一批**：沿当前来源和分类翻真实分页，不打乱榜单

海报墙随窗口宽度自动换行；放大窗口或全屏不会自动放大字号，界面始终按 100% 显示（需要时可在设置里手动缩放）。

### 热播推荐

<img src="docs/screenshots/02-hot-rank.png" width="100%">

换个角度找剧。左侧榜单、右侧大片卡，一页一部剧讲清楚：

- 热播总榜 / 真人短剧 / 漫剧 / AI 短剧四张榜单，外加「摇一摇」随机发现
- 每部剧显示集数、类型、题材和完整简介，不用点进去才知道讲什么
- 已经在剧库里的剧，直接「在剧库播放」，接着上次的进度看

### 搜索与下载

<img src="docs/screenshots/03-search-download.png" width="100%">

- **搜剧名**：一次搜索所有已启用的来源，结果标注来源，同名剧自动合并成一张卡片
- **贴链接 / ID**：手里有分享链接或剧集 ID 时直接粘进去
- **本机联想**：匹配搜索历史和本次浏览过的真实剧名，越用越顺手
- 选中一部剧就能看到全部剧集，逐集或批量下载

### 我的剧库

<img src="docs/screenshots/04-player.png" width="100%">

播放页把常用开关全摆在顶上，不用翻菜单：

- **播放**：双击画面进出全屏，空格短按暂停 / 长按临时 2 倍速；音量、静音、偏好倍速跨剧跨重启记忆
- **连播与缓存**：自动连播、可预缓存后续 2 集；切集保留上一集最后一帧直到新片源首帧上屏，不闪黑屏
- **画质**：自动优先 1080P，老电脑优先 H.264 片源、必要时提前转码；手动指定画质则保持固定不降级
- **兼容模式**：本机解不了 HEVC 时转码成 H.264，仍不行再试低一档片源
- **弹幕与选集**：弹幕开关、选集面板、画中画小窗、DLNA 投屏、系统播放器打开已下载本集

### 设置 · 内置来源

<img src="docs/screenshots/05-settings-sources.png" width="100%">

内置来源可随时开关，即时生效并自动保存：

| 来源 | 默认 | 说明 |
|---|---|---|
| 红果 | 固定开启 | 默认来源，不可关闭 |
| 西饭 | 开启 | 短剧专站 |
| 金鹰 / 海盗 / 硕博 | 开启 | 短剧分类多、更新快 |
| 暴风 / 360 / 旺旺 | 关闭 | 综合站含长剧，按需打开 |

关闭一个来源后，全局搜索、发现片单、热播推荐和摇一摇都不再使用它。

---

## ✨ 功能

<details open>
<summary><b>找剧</b></summary>

- 聚合红果 / 西饭 + 自建苹果 CMS 源，一次搜索全部来源
- 跨来源同名去重：多平台收录同一部剧时合并为一张卡片，标注「同剧 N 个来源」
- 发现页换批沿真实分页，热播榜保持来源热度顺序
- 同系列跨季切换：同来源、同剧名基名完全匹配才归组，在发现页与搜索页可直接切季
- 上新日历、摇一摇抽签、疑似新一季提示
- 搜索历史与本机联想

</details>

<details open>
<summary><b>下载</b></summary>

- 逐集或批量下载，任务队列 + 失败自动重试 + 重启后恢复任务状态
- 看完自动删除（直接下载到 NAS 的剧不参与）
- 下载到 NAS：视频、封面、简介、NFO 同层保存，规范分集命名，已有文件安全复用
- 下载管理支持按剧名、文件名和状态筛选。选择跨页保留；批量停止、重试和删除只作用于当前筛选中的已选任务，删除前确认
- 整剧合并导出，合并完成后清理临时分片

</details>

<details open>
<summary><b>播放</b></summary>

- 内置播放器：清晰度、倍速、弹幕字幕、快捷键、画中画、置顶
- 双击全屏、空格长按临时 2 倍速，键位可自定义
- 切集与自动连播保帧，消除黑屏 / 白屏闪烁
- 已完整下载的本集可用系统默认播放器打开
- DLNA 投屏到电视、单集评论

</details>

<details open>
<summary><b>追剧与整理</b></summary>

- 观看记录：逐条选择、全选当前列表、跨筛选保留选择、批量移除（只清记录，不删视频）
- 本机收藏、收藏与上新页追踪更新
- 「登录账号」页集中管理红果扫码登录与 APP 观看记录；锁定集仍由官方看点、VIP 或其他来源权益决定

</details>

<details open>
<summary><b>桌面体验</b></summary>

- `Ctrl + K` 全局命令面板：搜页面、搜剧、搜历史
- 老板键：全局快捷键一键隐藏 / 恢复窗口
- 独立小窗模式、竖屏 / 横屏布局切换
- 设置页支持实际卡片关键词筛选、分类锚点导航与键盘定位，隐藏分类保留未保存草稿；代理弹窗独立保存

</details>

<details>
<summary><b>更新</b></summary>

- 启动时及运行期间每 6 小时检查一次正式版
- Windows x64 安装版发现新版本后可在应用内下载、显示真实进度，并在校验通过后由用户确认重启安装
- 开发版、预览版、便携版和已发布的 v6.7 安装包回退到 GitHub 下载页

</details>

---

## ❓ 常见问题

<details>
<summary><b>提示「此来源已关闭」怎么办？</b></summary>

去 **设置 → 内置来源** 把对应来源打开即可。红果固定开启，其余八个随时可切换。
</details>

<details>
<summary><b>搜索结果里的「同剧 N 个来源」是什么？</b></summary>

同一部剧被多个站点收录时自动合并成一张卡片，避免重复占屏。选中后默认使用首选来源，其余来源标在徽标里。
</details>

<details>
<summary><b>怎么升级到新版本？</b></summary>

Windows x64 安装版自 6.8 起可在应用内下载更新，校验通过后点击“重启并安装”。旧版、便携版和开发版可前往 GitHub 发布页下载新的安装程序，设置、观看记录和下载任务会保留。
</details>

<details>
<summary><b>下载到 NAS 有什么不同？</b></summary>

直接写进你已挂载的目录，视频、封面、简介与 NFO 同层保存，分集按规范命名，已存在的文件不会被覆盖。这个模式下「看完自动删除」不生效。
</details>

<details>
<summary><b>支持 macOS 吗？</b></summary>

自 6.2 起仅发布和维护 Windows x64，macOS 不在发行范围内。仓库里保留了本地构建脚本，但不对其提供发行承诺。
</details>

---

## 🛠 开发

需要 **Node.js ≥ 22.12**。

```bash
git clone https://github.com/yuchen0x1/HongGuo-PC.git
cd HongGuo-PC
npm install                   # 安装依赖
npm run dev                   # 开发模式（Vite + Electron 热重载）
npm test                      # 单元测试与平台检查
node scripts/setup-ffmpeg.js  # 准备 Windows FFmpeg 二进制（打包前必须，不入库）
npm run build:installer       # 构建 Windows x64 NSIS 安装程序
```

<details>
<summary><b>项目结构</b></summary>

```
├── main.js               # Electron 主进程（窗口、IPC、下载、更新）
├── preload.js            # 渲染层安全桥接
├── src/
│   ├── components/       # React 界面组件
│   ├── native/           # 主进程模块（来源适配、HLS、下载、播放）
│   └── store.js          # 本机持久化
├── scripts/              # 构建与回归检查
├── docs/screenshots/     # 界面截图
└── build/                # 打包资源（图标、FFmpeg 许可证）
```

</details>

<details>
<summary><b>发版记录</b></summary>

每个版本的变更、验证范围与已知限制见 `docs/release-*.md`；当前正式发行与真实旧版更新验收见 [release-6.37.md](docs/release-6.37.md)。

</details>

---

## ⚖️ 声明

- 本仓库是 [jackotom/hongguo-drama](https://github.com/jackotom/hongguo-drama)（GPL-3.0）的社区二次开发版，**不是红果 / 西饭的官方客户端**，未获平台背书，不提供付费分集解锁。
- 延续上游 **[GPL-3.0](LICENSE)** 许可并保留修改与来源声明；上游与算法致谢见 [NOTICE](NOTICE)，第三方组件许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
- 开源许可只适用于软件本身，不授予剧集内容的再分发权。安装包不含任何剧集媒体；作品版权归原平台及创作者所有。请仅处理你有权访问、下载或备份的内容，遵守平台条款与相关法律。

---

## ⭐ Star 趋势

<a href="https://star-history.com/#yuchen0x1/HongGuo-PC&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=yuchen0x1/HongGuo-PC&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=yuchen0x1/HongGuo-PC&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=yuchen0x1/HongGuo-PC&type=Date" />
  </picture>
</a>

---

<div align="center">

如果这个项目对你有帮助，点个 ⭐ 就是最好的支持

</div>
