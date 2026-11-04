<p align="center">
  <img src="build/icon.png" alt="红果短剧桌面版图标" width="112" height="112">
</p>

<h1 align="center">红果短剧 · 桌面版（HongGuo-PC）</h1>

<p align="center">发现好剧，接着上次看。搜索、播放、下载、追剧与合并导出，在一个桌面应用里完成。</p>

<p align="center">
  <a href="https://github.com/yuchen0x1/HongGuo-PC/releases/latest"><img alt="最新公开版本" src="https://img.shields.io/github/v/release/yuchen0x1/HongGuo-PC?style=flat-square"></a>
  <img alt="Windows x64（Mac 构建待补）" src="https://img.shields.io/badge/platform-Windows_x64-55746b?style=flat-square">
  <a href="LICENSE"><img alt="GPL-3.0 许可证" src="https://img.shields.io/badge/license-GPL--3.0-555555?style=flat-square"></a>
</p>

<p align="center">
  <a href="#下载与安装"><strong>下载与安装</strong></a> ·
  <a href="#6-0-亮点">6.0 亮点</a> ·
  <a href="#完整功能">完整功能</a> ·
  <a href="#开发与构建">开发与构建</a> ·
  <a href="#声明">声明</a>
</p>

> 本仓库是 [jackotom/hongguo-drama](https://github.com/jackotom/hongguo-drama) 的社区二次开发版（GPL-3.0），当前版本线 **6.0**。应用内「检测更新」已指向本仓库。

## 下载与安装

**当前正式版：6.0**（内部 `6.0.0`）。自定义标题栏、全新应用图标、搜索跨来源同名去重、内置六个短剧资源站、侧栏「更新日志」页。详见 [6.0 说明](docs/release-6.0.md)。

| 系统 | 下载 6.0 | 安装方式 |
|---|---|---|
| Windows x64（推荐安装版） | [下载安装版 EXE](https://github.com/yuchen0x1/HongGuo-PC/releases/download/v6.0/hongguo-downloader-6.0-win-x64-setup.exe) | 按向导安装，后续支持应用内更新 |
| Windows x64（便携版） | [下载便携 ZIP](https://github.com/yuchen0x1/HongGuo-PC/releases/download/v6.0/红果短剧-6.0-win-x64.zip) | 解压后运行「红果短剧-6.0」文件夹内的 EXE 即用 |
| Mac（Apple 芯片 / Intel） | 暂未提供，[构建方法](#开发与构建) | 将在 Mac 上构建后补传至 [v6.0 Release](https://github.com/yuchen0x1/HongGuo-PC/releases/tag/v6.0) |

- **Windows 未签名提示**：安装版与便携版 EXE 未做代码签名，首次运行可能有 SmartScreen 提示，选择「更多信息 → 仍要运行」即可。
- **便携版资料**：设置和下载记录放在程序目录的 `data` 文件夹，移动程序时请连同该文件夹一起保留。
- **安装版与便携版不能同时运行**（同一应用只允许一个实例）；更换版本前请先退出正在运行的窗口。
- 上游 5.5 及更早版本的 Mac/Windows 下载见[上游发行页](https://github.com/jackotom/hongguo-drama/releases/latest)；从上游 5.x 安装版升级到本仓库版本可直接运行安装包。

## 6.0 亮点

- **自定义标题栏**（Windows）：无边框窗口，品牌区 + 平滑拖动 + 双击最大化，最小化/最大化/关闭带悬停动效；macOS 保持原生按钮。
- **全新应用图标**：标题栏、侧栏、任务栏与安装包统一更新。
- **搜索跨来源去重**：同一部短剧被多个平台收录时自动合并为一张卡片，显示「同剧 N 个来源」。
- **更多短剧来源**：内置六个短剧资源站（金鹰/海盗/硕博默认开启，暴风/360/旺旺默认关闭），设置中随时开关。
- **采集源可播放**：网页播放页地址自动转换为 HLS 直链播放。
- **侧栏「更新日志」页**：公告通知与检测更新整合，设置页更清爽。

## 完整功能

- **搜索与下载**：聚合红果短剧、西饭短剧、河马短剧与自建苹果 CMS 源，一次搜索全部来源并自动去重；选中剧集即可拉取全集、逐集或批量下载。
- **在线播放**：内置播放器支持清晰度选择、倍速、字幕弹幕、快捷键、画中画小窗与置顶；支持本地视频导入播放。
- **下载管理**：任务队列、断点续传、失败自动重试、看完自动删除；支持下载到 NAS 目录并自动补齐封面、简介与 NFO。
- **剧库与追剧**：观看记录、本机收藏、合集归类、疑似新一季提示、上线日历与随机换剧。
- **社区能力**：单集评论弹幕、整剧合并导出、投屏。
- **效率**：`Ctrl+K` 全局命令面板、老板键、独立小窗模式。

## 开发与构建

环境要求：Node.js ≥ 22.12。

```bash
npm install                 # 安装依赖
npm run dev                 # 开发模式（Vite + Electron 热重载）
npm test                    # 单元测试与平台检查
npm run build               # 构建 Windows x64 安装包（输出到 dist/）
npm run zip                 # 构建便携 ZIP
npm run setup-ffmpeg        # 下载 FFmpeg 二进制（打包前必须，约 167MB，不入库）
npm run build:mac           # 在 macOS 上构建 Apple Silicon + Intel 包
```

源码结构与发行记录见 [docs/](docs/)，各版本发行回执与验证边界见 `docs/release-*.md`。

## 声明

本项目是社区维护的开源修改版，**不是红果、西饭或河马的官方客户端，也未获平台官方背书**。不提供付费分集解锁；剧集、清晰度和可用范围取决于来源平台。

本项目延续上游的 **[GPL-3.0](LICENSE)** 许可，并保留修改与来源声明。原始上游与算法来源致谢见 [NOTICE](NOTICE)，组件许可见 [第三方声明](THIRD-PARTY-NOTICES.md)。

开源许可适用于软件，不授予剧集内容的再分发权。安装包不包含剧集媒体；作品版权归原平台及创作者所有。请仅处理你有权访问、下载或备份的内容，遵守平台条款与相关法律，勿用于未经授权的传播或商业盗版。
