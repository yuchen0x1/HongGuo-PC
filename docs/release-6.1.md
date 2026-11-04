# 红果短剧 6.1

状态：6.1（内部 `6.1.0`）发布于二次开发仓库 [yuchen0x1/HongGuo-PC](https://github.com/yuchen0x1/HongGuo-PC)，标签 `v6.1`，公开版本名 `6.1`。Windows x64 安装包与便携 zip 已随 Release 发布；Mac arm64/x64 产物**未包含**（构建机为 Windows，`npm run build:mac` 就绪待补）。Windows EXE 未签名。

## 主要变化

### 「更新日志」页重构

- **检测更新**移至页面顶部；下方新增**版本更新日志列表**：实时读取本仓库 GitHub Releases，逐版本显示版本号、标题、发布日期与完整更新说明（轻量渲染，纯 React 元素无 HTML 注入），底部提供「在 GitHub 查看全部版本与下载」入口；网络失败给出原因与「重新读取」。
- **公告系统整体移除**：启动公告横幅、公告接收设置、拉取服务与 IPC、公告数据源全部删除；设置与界面不再出现公告相关内容。

### 应用内更新源补全切换

- 补齐 v6.0 遗漏的更新源硬编码：更新下载 feed（app-update-installer）、更新检查 API 与重定向正则、发布页兜底链接、公告源——现全部指向 `yuchen0x1/HongGuo-PC`。从 6.1 起，应用内「检测更新」的检查、下载与安装完整走本仓库 Release。

## 验证

- `node scripts/check-release-version.cjs`：PASS（1600 版本对，含 6.0 → 6.1 递进）。
- `npm test`：全部相关单元与平台检查通过；3 项失败为 Windows 无符号链接权限的环境预置问题，与本轮改动无关。
- 构建冒烟：`dist/win-unpacked/红果短剧.exe` 实际启动，界面、标题栏、侧栏与 `v6.1` 版本号正常。

## 附件（Windows x64）

| 文件 | 大小 | SHA256 |
|---|---|---|
| `hongguo-downloader-6.1-win-x64-setup.exe` | 159,824,003 字节 | `47f1a8943b081ed6152001fac70cf81e63f08b657d999c76955b6e2ee8019fc3` |
| `红果短剧-6.1-win-x64.zip` | 224,595,645 字节 | `4efb5ac73d096d5a67e9c04749166688d5b90b97bf40afa82218ac865b19a3ae` |

## 升级说明

- 6.0 安装版用户：应用内「检测更新」即可看到 6.1 并下载安装。
- 更早版本或便携版：从 Release 页下载后，退出旧程序再安装/替换；便携版保留程序目录 `data` 文件夹。

## 限制

- Mac arm64/x64 本轮未构建、未上传；在 Mac 上执行 `npm run build:mac` 后补传同一 Release。
- Windows 安装器未做安装/重装/升级资料保留回归（仅产物级启动冒烟）；EXE 未签名。
- 版本更新日志依赖 GitHub Releases 可达性；离线或网络受限时页面给出明确错误与重试入口。
