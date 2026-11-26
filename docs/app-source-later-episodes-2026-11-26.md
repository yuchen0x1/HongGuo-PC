# 官方 App 后续集播放接入记录（2026-11-26）

本轮把「后续集取不到源」的原因定位到播放模型接口，并把**已实测证实**的单集
`video_model` 路由接入电脑版。下列事实区分了协议对照、离线回归、真实媒体解码、
真实 Electron 播放与打包产物播放；一种证据不能替代另一种。

## 1. 结论

- 后续集并非付费或 DRM 锁定：目标剧 `7706404415887903806`（《嫌疑人的秘密2藏金生死线》）
  目录 88 集全部 `disable_play: false`，`pay_info.pay_type = 0`。
- 此前失败原因是**播放模型接口选错**：项目记录的 `multi_video_model/*` 与
  `multi_video_detail/preload/v1` 中，只有目录接口可用，模型接口一律 `HTTP 200` 空正文。
- 可用模型接口是**单集版**：`https://reading.snssdk.com/novel/player/video_model/v1/`，
  返回 `code 0`，`data.video_model` 是一段 **JSON 字符串**（不是对象），解开后含
  `video_id`、`video_duration`、`media_type`、`video_list[{main_url, backup_url, video_meta, encrypt_info}]`。
- 该接口返回的是**加密片源 + `encrypt_info.spade_a`**，与项目既有 `contentKey` 解密路径
  （`ffmpeg -decryption_key`）一致，不需要新增解密实现。

## 2. 协议事实（实测）

目录接口：

```
POST https://reading.snssdk.com/novel/player/multi_video_detail/preload/v1
body: 单数 series_id + content_type=1004 + dr_scene=preload
→ status 200, code 0, data[series_id].video_data.video_list 长度 88
  每项含 vid、vid_index、duration、disable_play、series_id、title、cover
```

复数 `series_ids`（数组、整数、`mixed_series_map`）一律 `series_ids invalid` / `code 100001`。

模型接口：

```
POST https://reading.snssdk.com/novel/player/video_model/v1/
body: biz_param + dr_scene=preload + video_id=<vid> + content_type=1
→ status 200, code 0, data.video_model = "<JSON 字符串>"
```

`multi_video_model/preload/v1`、`multi_video_model/v1/` 仍为 `HTTP 200` 空正文；
`model-vp3-mixed` / `model-vp3-list` 报 `100001 参数错误`。`Sign-Env` / `Sign-Res`
是响应头，不是请求门禁头。

## 3. 代码接入

- `src/native/playback-profiles.js`：新增 `VIDEO_MODEL_PROFILE`
  （id `hongguo-app-74532-video-model-v1`，版本 `2026-11-26.1`，路由 id `app-video-model`），
  并注册进 `signingProfiles`、`routeProfiles` 与统计初始化。
- `src/native/app-source.js`：新增 `videoModelRequest()` 与 `appVideoModel()`；
  候选序列改为 `preload-primary → preload-alternate → video-tab → app-video-model →
  upstream-grouped-b → … → upstream-model-c`。
  - `app-video-model` 位于 `upstream` 段之前：`upstream-grouped-b` 对未知集可能返回
    **带 `spade` 的受保护模型**，那是终止态，会挡住真正可用的路由。
  - 只有空正文（以及单集路由自身「无模型/形状不符」）才继续走后面的候选；
    业务拒绝、403/429、DRM 仍然立即终止。
  - 单集路由返回 `media_type = video` 但地址无后缀时声明 `format: 'mp4'`；
    同时带出 `duration`（完整时长）作为整集证据。
- `src/native/playback-diagnostics.js`：把 `app-video-model` 加入已知路由与 profile 集合，
  否则诊断会把成功路由记成上一条 `video-tab`，掩盖真实取源路径。
- 新增离线回归 `src/native/app-source-single-video.test.cjs`（5 项）：成功取源与请求体、
  业务拒绝、无模型、空正文继续阶梯、非受信域名阻断。

## 4. 真实媒体验证

`.local/analysis/verify-later-episodes.cjs`：用项目取源函数取 5 集，真实下载、
用返回的 `contentKey` 解密、`ffprobe` 读时长，再整集 `-an -f null` 静音解码。
素材在隔离临时目录，结束后删除；不打印签名媒体地址或设备标识。

| 集 | 加密字节 | 解密后时长 | 分辨率 | 整集静音解码 |
| --- | --- | --- | --- | --- |
| 6 | 4,475,222 | 73.80 | 720x1280 | 通过 |
| 22 | 2,963,414 | 79.92 | 720x1280 | 通过 |
| 34 | 5,183,723 | 122.52 | 1080x1920 | 通过 |
| 68 | 4,337,705 | 54.54 | 720x1280 | 通过 |
| 88 | 3,300,902 | 67.25 | 1080x1920 | 通过 |

目录 `video_duration` 分别为 73.84 / 79.97 / 122.579 / 54.591 / 67.292，与解码时长一致。

## 5. 真实播放验收

清单与目录证据（只含公开目录元数据，不含媒体地址、密钥或设备标识）：

- `.local/analysis/later-episode-catalog.json`
- `.local/analysis/later-episode-manifest.json`

`node scripts/verify-playback-later.cjs` 在隔离 profile、真实官方目录、
真实 `playSeries` 下逐集验收，要求新首帧、`decodedFrames > 0`、`readyState ≥ 2`、
未暂停、时长非零、静音、无自动扫码登录，并做 30 秒持续播放观察。

开发源码运行（Electron 直接加载本工作区）：

- `dist/playback-later-20261126-final/result.json`：`technicalChecksPassed = true`，
  `laterPlaybackPassed = true`，5 集全部 `playing`，路由 `app-video-model`，
  实测时长 73.839 / 79.969 / 122.578 / 54.590 / 67.291，切集 22→23 播放通过。

打包产物运行（`dist/win-unpacked/红果短剧.exe`，`app.asar` 为本轮构建）：

- `dist/playback-later-20261126-packaged/result.json`：`technicalChecksPassed = true`，
  `laterPlaybackPassed = true`，`packaged = true`，
  `executableSha256 = 0327d6d224f6243dfff29d1bd76b2ada10c1b18a639fe487d607d3ff7c425d8c`，
  `appAsarSha256 = 6aec5e45c83adbf4749dacbe81af20e464314dc904e6b855538d164de5efb5f0`。
  5 集全部 `playing`、路由 `app-video-model`、每集观测 30 秒以上，切集 22→23 通过。

## 6. 回归

**2026-11-26 重新比对，修正上一稿结论。** 上一稿记录「失败集合与改动前基线完全一致（17 项）」，该比对不成立：把 `src`、`scripts` 回退到 `bf7d827` 后，同一测试列表只失败 8 项，且全部来自本轮新增的测试文件（单集路由 3 项、分集映射 4 项、受保护媒体 1 项），也就是说那 17 项是本次改动新引入的失败，不是既有失败。

原因不只是新增路由：上一稿同时删除了默认播放顺序里的官网页面前置尝试（`fetchPlayUrlFresh`、`fetchAppPlayUrlForQuality` 的网页分支），并把网页线路改成只有 `options.allowOfficialWeb === true` 才执行，而仓库里没有任何调用方传这个选项，等于让官网公开线路整体失效。回归结果是 17 项既有线路契约测试失败，以及 `check-app-source`、`check-native-performance`、`check-source-recovery`、`check-streaming` 四个平台检查脚本由通过变为失败。

本版恢复原有的网页优先顺序，只保留本轮已验证的改动（单集 `video_model` 路由与线路顺序、分集映射校验、剧号精度、诊断路由登记）：

- `npm test`：主单元 778 项、平台检查 119 项全部通过，失败 0、跳过 0（`.local/analysis/npm-test-6.38-restored.log`）。
- 同一次恢复后重新构建并逐集实测，第 6、22、34、68、88 集仍全部 `playing`，无需依赖被删除的网页前置改动（`dist/playback-later-20261126-release/result.json`）。

## 7. 未覆盖与限制

- 只验证了目标剧 88 集里的 5 个指定集；其他剧、其他集仍按候选序列逐集判断，不由此推广。
- `quality = auto` 时既有实现不返回 `width/height`（沿用原行为），下载结束以 ffprobe 实测质量为准。
- `upstream-*` 五条记录仍为 `source-only`，本轮未取得它们的可用明文模型。
- 手机端观察不构成本机证据；本轮未使用 ADB 或手机传输。
- 未做本机安装、重装、卸载清理、旧版应用内升级与声音输出验收。

## 8. 发布状态（2026-11-26）

- `v6.38` 已正式发布，标签指向公开提交 `b5fc12d6d02a4eb495631cdb945e0be49ec507bb`，
  正式资产为 `hongguo-downloader-6.38-win-x64-setup.exe` 与 `latest.yml`；公开下载校验通过，
  隔离安装主程序完整。
- 本轮改动（单集 `video_model` 路由、网页优先顺序恢复、分集映射与剧号精度）**已在公开 `main` 上**，
  仓库即完整源码；此前"源码不进公开仓库"的临时做法作废。
- 本地分支 `private/6.38-core` 与 `backups/` 备份保留作历史对照，不再是唯一来源。
- `v6.39` 安装包存在主程序截断缺陷（详见 `docs/release-6.39.md`），不能用于安装。
