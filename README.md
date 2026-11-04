<div align="center">

<img src="build/icon.png" alt="红果短剧桌面版" width="128" height="128">

# 红果短剧 · 桌面版

**发现好剧，接着上次看。** 搜索、播放、下载、追剧与合并导出，在一个桌面应用里完成。

[![Release](https://img.shields.io/github/v/release/yuchen0x1/HongGuo-PC?style=flat-square&label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC)](https://github.com/yuchen0x1/HongGuo-PC/releases/latest)
[![Platform](https://img.shields.io/badge/Windows-x64-0078D6?style=flat-square&logo=windows&logoColor=white)](#-下载与安装)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue?style=flat-square)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Repo](https://img.shields.io/badge/%E4%BA%8C%E6%AC%A1%E5%BC%80%E5%8F%91%E7%89%88-HongGuo--PC-ff304f?style=flat-square)](../../)

[下载安装](#-下载与安装) · [版本亮点](#-版本亮点) · [功能总览](#-功能总览) · [开发构建](#-开发与构建) · [常见问题](#-常见问题) · [声明](#-声明)

</div>

---

> [!IMPORTANT]
> 本仓库是 [jackotom/hongguo-drama](https://github.com/jackotom/hongguo-drama)（GPL-3.0）的社区二次开发版。不是红果 / 西饭 / 河马的官方客户端，未获平台背书；不提供付费分集解锁。

## ✨ 版本亮点

### 🖥 6.1 · 当前版本

| | |
|---|---|
| 📜 **更新日志页** | 顶部一键检测更新，下方逐版本更新说明实时取自本仓库 Releases——每次发版自动出现在应用里 |
| 🔔 **零打扰** | 移除公告系统：启动无横幅、无弹窗，界面只留必要内容 |
| 🏠 **完整自主更新** | 应用内检测、下载、安装全部走本仓库，与上游彻底解耦 |

### 🎬 6.0 · 奠定基础

| | |
|---|---|
| 🖌 **自定义标题栏** | Windows 无边框窗口：品牌区、平滑拖动、双击最大化，控制按钮悬停动效；macOS 保持原生 |
| 🟥 **全新应用图标** | 标题栏、侧栏、任务栏与安装包统一更换 |
| 🔀 **跨来源同名去重** | 多平台收录同一部剧时自动合并为一张卡片，标注「同剧 N 个来源」 |
| 📡 **六个内置资源站** | 金鹰 / 海盗 / 硕博默认开启，暴风 / 360 / 旺旺默认关闭，设置中随时开关 |
| ▶️ **采集源直链播放** | 网页播放页地址自动转换为 HLS 直链，无需浏览器解析 |

## 📥 下载与安装

**当前正式版：6.1**（内部 `6.1.0`）· 完整变更见 [Release 说明](https://github.com/yuchen0x1/HongGuo-PC/releases/tag/v6.1)

| 系统 | 下载 | 安装方式 |
|---|---|---|
| **Windows x64**（安装版，推荐） | [⬇ hongguo-downloader-6.1-setup.exe](https://github.com/yuchen0x1/HongGuo-PC/releases/download/v6.1/hongguo-downloader-6.1-win-x64-setup.exe) | 向导安装，支持应用内更新 |
| **Windows x64**（便携版） | [⬇ 红果短剧-6.1-win-x64.zip](https://github.com/yuchen0x1/HongGuo-PC/releases/download/v6.1/红果短剧-6.1-win-x64.zip) | 解压即用，无需安装 |
| **macOS**（Apple 芯片 / Intel） | 🚧 构建中，将在 Mac 上补传至 [v6.1 Release](https://github.com/yuchen0x1/HongGuo-PC/releases/tag/v6.1) | `npm run build:mac`（见[开发构建](#-开发与构建)） |

<details>
<summary><b>安装须知（点击展开）</b></summary>

- Windows 包**未做代码签名**，首次运行若出现 SmartScreen 提示，选择「更多信息 → 仍要运行」
- 便携版的设置与下载记录在程序目录 `data` 文件夹内，移动或备份请连同保留
- 安装版与便携版不能同时运行（单实例）；换版本前先退出正在运行的窗口
- SHA256 校验值见 [docs/release-6.1.md](docs/release-6.1.md)
- 上游 5.5 及更早版本（含 Mac 包）见[上游发行页](https://github.com/jackotom/hongguo-drama/releases/latest)；从上游 5.x 安装版升级，直接运行本仓库安装包即可

</details>

## 🎯 功能总览

<details open>
<summary><b>搜索与下载</b></summary>

- 聚合 **红果 / 西饭 / 河马** 短剧 + 自建苹果 CMS 源，一次搜索全部来源并自动去重
- 逐集或批量下载：任务队列、断点续传、失败自动重试、看完自动删除
- 支持下载到 **NAS** 目录，自动补齐封面、简介与 NFO
- 整剧合并导出

</details>

<details open>
<summary><b>播放与追剧</b></summary>

- 内置播放器：清晰度选择、倍速、弹幕字幕、快捷键、画中画小窗、置顶
- 观看记录、本机收藏、疑似新一季提示、上线日历、随机换剧
- 单集评论弹幕、DLNA 投屏、本地视频导入播放

</details>

<details open>
<summary><b>桌面体验</b></summary>

- `Ctrl + K` 全局命令面板：搜页面、搜剧、搜历史
- 老板键（全局快捷键一键隐藏/恢复）
- 独立小窗模式、竖屏 / 横屏布局切换

</details>

## 🛠 开发与构建

环境要求：**Node.js ≥ 22.12**

```bash
git clone https://github.com/yuchen0x1/HongGuo-PC.git
cd HongGuo-PC
npm install                 # 安装依赖
npm run dev                 # 开发模式（Vite + Electron 热重载）
npm test                    # 单元测试与平台检查
npm run setup-ffmpeg        # 下载 FFmpeg 二进制（打包前必须，约 167 MB，不入库）
npm run build               # 构建 Windows x64 安装包 → dist/
npm run zip                 # 构建便携 ZIP
npm run build:mac           # 在 macOS 上构建 Apple Silicon + Intel 包
```

<details>
<summary><b>项目结构与发版记录</b></summary>

```
├── main.js               # Electron 主进程（窗口、IPC、下载、更新）
├── preload.js            # 渲染层安全桥接
├── src/
│   ├── components/       # React 界面组件（搜索、播放、下载、设置…）
│   ├── native/           # 主进程功能模块（来源适配、HLS、公告、更新…）
│   └── store.js          # 本机持久化（设置、任务、记录）
├── docs/                 # 发行说明与专项文档（release-*.md）
└── build/                # 打包资源（图标、FFmpeg 许可证）
```

每个版本的变更、验证范围与已知限制见 `docs/release-*.md`；当前版本见 [release-6.1.md](docs/release-6.1.md)。

</details>

## ❓ 常见问题

<details>
<summary>为什么提示「此来源已关闭」？</summary>

金鹰、海盗、硕博、暴风、360、旺旺六个内置资源站可在 **设置 → 内置来源** 中开关；关闭后全局搜索、发现页不再使用该来源。红果固定开启。
</details>

<details>
<summary>搜索结果里「同剧 N 个来源」是什么意思？</summary>

同一部短剧被多个平台收录时，搜索结果自动合并为一张卡片，避免重复占屏。卡片选中后默认使用首选来源；其余来源标注在徽标悬停里。
</details>

<details>
<summary>应用内更新是怎么工作的？</summary>

安装版在「更新日志」页点击「检查更新」或等待自动检测（每 6 小时）；发现新版后下载，由你确认重启安装。便携版请到 Release 页手动替换，保留 `data` 文件夹。
</details>

## ⚖️ 声明

- 本项目是社区维护的开源修改版，**不是红果、西饭或河马的官方客户端，也未获平台官方背书**；不提供付费分集解锁，剧集、清晰度和可用范围取决于来源平台。
- 本项目延续上游 **[GPL-3.0](LICENSE)** 许可并保留修改与来源声明；原始上游与算法来源致谢见 [NOTICE](NOTICE)，组件许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
- 开源许可适用于软件，不授予剧集内容的再分发权。安装包不包含任何剧集媒体；作品版权归原平台及创作者所有。请仅处理你有权访问、下载或备份的内容，遵守平台条款与相关法律，勿用于未经授权的传播或商业盗版。

---

<div align="center">

如果这个项目对你有帮助，欢迎点一个 ⭐

</div>
