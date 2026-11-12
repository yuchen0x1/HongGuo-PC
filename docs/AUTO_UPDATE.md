# 应用内自动更新

本文档描述 `main` 当前源码中的更新链路。它不改写历史发行记录：已发布的 v6.7 安装包仍然只有“检查并打开 GitHub 下载页”，因为该安装包是在自动下载/安装 IPC 接回之前构建的；v6.8 Windows x64 安装包已由冻结提交和公开 Release 资产验证，具备本文档所述能力。真实客户端跨版本应用内升级仍需在独立 Windows 环境单独验收。

## 方案选择

本项目是 Electron + React，正式发行目标是 Windows x64 NSIS 安装版。比较过的成熟方案如下：

| 方案 | 适配性 | 取舍 |
|---|---|---|
| electron-builder + electron-updater | 最高；项目已经依赖 `electron-updater@6.8.9`，发布元数据就是 GitHub Release 的 `latest.yml` | 依赖 NSIS 安装版；便携版不能安全覆盖自身；Windows 未签名时 SmartScreen 仍会提示未知发布者 |
| Velopack | 更新体验和回滚能力强，适合重新设计安装/发布模型 | 需要替换当前 electron-builder/NSIS 产物与 CI，迁移成本大，不能复用现有 v6.x `latest.yml` 兼容链路 |
| Squirrel.Windows | Electron 生态中成熟，支持 delta/安装更新 | 需要迁移安装包和 Release 资产命名，和当前 NSIS、历史客户端及 `latest.yml` 不兼容 |

因此本项目沿用 electron-builder/electron-updater，而不是引入第二套安装器。更新源固定为 `yuchen0x1/HongGuo-PC`，渲染进程不能传入 URL。

## 能力边界

- 正式 Windows x64 NSIS 安装版：支持检查、用户点击下载、真实下载进度、electron-updater SHA-512 校验、用户点击重启安装。
- 开发版、预览版、便携版、非 Windows：保留手动 GitHub 发布页回退，不尝试覆盖当前运行文件。
- 自动检查默认开启，启动后和运行期间每 6 小时检查一次；检查失败不阻塞启动。
- 下载不自动安装；关闭提醒不会取消下载。用户点击“取消下载”才取消。
- 安装前会阻止仍有下载、合并、转码、在线准备、设置保存或维护操作的情况，避免退出时丢数据。
- 安装失败保留当前版本和已校验下载，可重新点击“重启并安装”；不会先删除旧版本。

## 校验与签名

`latest.yml` 中的文件大小和 SHA-512 必须由最终 EXE 字节生成。electron-updater 在下载阶段依据该元数据校验摘要，摘要不匹配时不会进入可安装状态。

当前仓库没有 Windows 代码签名证书，因此不能声称已完成 Authenticode 签名验证。electron-updater 会在 `app-update.yml` 存在发布者信息时执行内置签名校验；没有发布者信息时只能依赖 HTTPS、固定 GitHub 源和 SHA-512。正式配置证书后，必须在 GitHub Actions Secrets 中注入证书和密码，绝不把私钥提交到仓库。

## 发布流程

1. 在 `main` 完成代码、测试和版本检查。
2. 创建 `vX.Y` 标签（包内版本为 `X.Y.0`）。
3. Windows x64 release candidate 工作流构建 NSIS EXE，运行单元/平台/安装验收，并从最终 EXE 生成 `latest.yml`。
4. 人工确认候选工件、提交 SHA、包大小、SHA-512、签名状态和许可证对应源码。
5. 手动运行 `Publish validated Windows release`，传入标签、候选工作流 run ID、源码 Test run ID 和期望提交 SHA。
6. 发布流水线只上传安装 EXE 与 `latest.yml`，并在公开 Release 前再次核对版本、文件名、大小和 SHA-512。

旧版 v6.2–v6.6 安装版仍依赖 `latest.yml`，所以不得从后续 Release 删除该文件。

## 本地验证

不需要真实 Release 或安装权限即可运行：

```powershell
node scripts/check-app-update.cjs
node scripts/check-app-update-installer.cjs
node scripts/check-app-update-proxy.cjs
node scripts/check-app-update-ui.cjs
npm test
```

这些检查使用隔离 fixture 验证状态机、取消、重复请求合并、下载失败、安装失败重试、代理 Session、UI 进度和用户确认；它们不伪造真实 GitHub 下载或签名结果。

真实发布前还必须在干净 Windows x64 安装环境验证：旧版本资料保留、真实 Release 下载、SHA-512 与 `latest.yml` 相符、未签名 SmartScreen 提示（或签名证书状态）、安装失败后旧版本仍可用，以及应用重启后的版本号。

## 失败处理

- GitHub/API 不可访问：保留当前应用，显示重试和手动发布页入口。
- `latest.yml`、安装包或 SHA-512 不匹配：拒绝进入安装状态。
- 下载中断：electron-updater 的网络层负责受支持的重试；用户可重新下载，失败不会删除当前安装。
- 安装被忙碌任务阻止：保持已校验下载，完成任务后再次点击安装。
- 安装器启动失败：显示错误，当前版本继续运行，可再次尝试或手动下载。
- 便携版：不做应用内覆盖更新，用户需完整解压/运行新版或安装 NSIS 版。

## 已知限制

- v6.7 已发布二进制不包含本轮恢复的自动下载/安装代码；线上用户需安装包含当前 `main` 的 v6.8 新版本后才会获得新能力。
- Windows 当前未配置代码签名证书，不能消除 SmartScreen 的未知发布者警告。
- 本地没有 GitHub Release 发布权限、签名证书或干净升级机时，真实线上下载、安装和签名验证只能标记为待外部验证。
