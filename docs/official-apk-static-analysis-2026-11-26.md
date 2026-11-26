# 官方 APK 静态分析回执（2026-11-26）

## 样本身份

| 项目 | 值 |
| --- | --- |
| 本地路径 | `C:\Users\18155\Downloads\红果免费短剧.apk` |
| SHA-256 | `22c1dc79c465794b9f53a75076195dd3ec1dec307847ed9032d72a95656f3cf6` |
| 字节数 | 156,400,488 |
| 包名 | `com.phoenix.read` |
| versionName / versionCode | `7.4.5.32` / `74532` |
| minSdk / targetSdk | 21 / 35 |
| DEX | 26 个（classes.dex … classes26.dex） |
| ABI | 仅 `arm64-v8a` |
| 声明签名 | v1/v2/v3 各 1 个签名者，证书 SHA-256 `1fe01f1425c72dc1cd158e05cb696cb9fc17259a70f9d233fc48e8e42e6510ec`；签名真实性未验证 |

版本与项目主画像 `hongguo-app-74532-medusa312-v1`（7.4.5.32 / 74532）及手机官方安装包一致，可作为当前取源画像的同版本样本。

## 官方播放接口（静态定位）

官方 SDK 在 `classes15.dex` 的 `seriessdk/com/dragon/read/saas/rpc/rpc/f.java` 声明：

| RPC 操作 | 方法与路径 |
| --- | --- |
| `mGetVideoModelV2RxJava` | `$POST /novel/player/multi_video_model/:dr_scene/v1/` |
| `mGetVideoModelRxJava` | `$POST /novel/player/multi_video_model/v1/` |
| `mGetVideoDetailV2RxJava` | `$POST /novel/player/multi_video_detail/:dr_scene/v1/` |
| `mGetVideoDetailRxJava` | `$POST /novel/player/multi_video_detail/v1/` |
| `mGetVideoModelRxJava`（bookapi 家族） | `$GET /reading/bookapi/video_tab/multi_video_model/v:version/` |

`:dr_scene` 是路径参数，请求体同时带 `dr_scene` 字段，因此电脑版使用的
`preload/v1`、`player/v1` 端点形态成立；`preload/v1` 端点本身在本次样本的
`classes9.dex` 中命中字符串，但该目录没有反编译出可归属的 RPC 声明。

## 官方请求模型

`MGetVideoModelV2Request`（`classes15.dex`）四个字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `mixed_video_id_map` | `Map<Short, List<String>>` | 分集到模型查询的映射；电脑版当前使用键 `1004` |
| `biz_param` | `GetVideoBizParam` | 21 个业务字段 |
| `dr_scene` | `String` | 场景标识，官方在详情请求中赋值为 `player` |
| `NovelCommonParam` | `NovelCommonParam` | 27 个字段，**电脑版当前请求完全没有携带** |

`GetVideoBizParam` 关键字段与官方枚举取值：

| 字段 | 官方枚举/含义 | 电脑版当前值 |
| --- | --- | --- |
| `video_platform` | `VideoPlatformType.Mixed = 1024` | `1024`（一致） |
| `device_level` | `DeviceLevel.Low=1 / Middle=2 / High=3` | `2`（一致，等于 Middle） |
| `video_id_type` | `VideoSeriesIdType.VideoId=0 / SeriesId=1 / PostId=2` | 主画像未携带；tab 查询为 `'0'` |
| `source` | `VideoDetailSource` | 主画像未携带 |
| `need_all_video_definition` | boolean | `true`（一致） |
| `need_mp4_align` | boolean | `false`（一致） |
| `use_os_player` | boolean | `false`（一致） |
| `use_server_dns` | boolean | `false`（一致） |
| `detail_page_version` | int | `0`（一致） |
| `disable_digg_stat` / `disable_video_relate_book` | boolean | `false`（一致） |
| `from_video_id` | string | 上游候选携带，主画像未携带 |

`NovelCommonParam` 的 27 个字段全部通过 `@RpcField` 标注为 QUERY 或 HEADER，其中门禁相关字段：

| 字段 | 传输位置 | 电脑版当前情况 |
| --- | --- | --- |
| `Sign-Env` | HEADER | 未携带 |
| `Sign-Res` | HEADER | 未携带 |
| `X-Xs-From-Web` | HEADER | 未携带（`x-xs-from-web` 仅出现在旧签名分支） |
| `User-Agent` | HEADER | 已携带 |
| `X-Forwarded-For` | HEADER | 未携带 |
| `X-Xs-Web-Imgfmt` | HEADER | 未携带 |
| `time_zone` | QUERY | 未携带 |
| `app_language` / `app_region` / `language` / `sys_language` / `sys_region` | QUERY | 未携带 |
| `carrier_region` / `carrier_region_v2` / `region` / `current_region` | QUERY | 未携带 |
| `mcc_mnc` | QUERY | 未携带 |
| `ui_language` / `user_language` / `open_translate` / `translate_debug_key` | QUERY | 未携带 |
| `fake_priority_region` / `image_control` | QUERY | 未携带 |
| `compliance_status` / `device_dpi` | QUERY | 未携带 |
| `Age-Range` / `prefer_gd` | QUERY | 未携带 |
| `X-Forwarded-For` | HEADER | 未携带 |

另一套并行的参数模型 `com.dragon.read.rpc.xianning.model.HeaderArgs` 进一步确认了门禁头集合：
`Sign-res`、`Sign_res`、`Sign-Env`、`Sign_env`、`Sign_err`、`Sign_res_extra`、`Authorization`、`Openid`。

## 电脑版当前 V5 签名实际注入的头

`src/native/playback-v5.js` 的 `signPlaybackV5` 只产生：

- `x-khronos`
- `x-helios`
- `x-medusa`
- `x-ss-stub`（有 body 时）
- `x-ss-req-ticket`

`src/native/app-source.js` 在此基础上追加 `User-Agent`、`Accept`、`Content-Type`、`Content-Encoding: gzip`、`Connection: close`。

**缺口结论：**电脑版 6.38.0 的 V5 播放请求与官方 7.4.5.32 的 `NovelCommonParam` 契约存在明确差异——
官方模型要求同时传递 QUERY 参数组与 `Sign-Env`/`Sign-Res` 门禁头，而当前实现既没有这些 QUERY 字段，
也没有 `Sign-Env`/`Sign-Res`。这与诊断中 8 条路线全部 `HTTP 200 + EMPTY_RESPONSE` 的表现方向一致，
但静态结构差异本身不足以证明它就是空响应的唯一原因。

## 仍未取得的证据

- 官方客户端播放第 22 集时实际发出的成功请求与非空响应正文（静态分析无法给出运行时取值）。
- `Sign-Env`/`Sign-Res` 的生成算法与设备侧密钥来源（位于受保护的 native 库，未在 DEX 中出现明文实现）。
- 官方成功请求是否携带账号 Cookie/Token/`Authorization`，以及 `playbackAuthorization` 的判定条件。
- Windows 端同一集的实际取源与首帧。

## 分析工具与临时目录

- JADX 1.5.7：`C:\Users\18155\AppData\Local\AndroidAnalysis\jadx\lib\jadx-1.5.7-all.jar`
- Apktool 3.0.3：`C:\Users\18155\AppData\Local\AndroidAnalysis\apktool\apktool.jar`
- 项目内临时分析目录：`.local/analysis/apk-20261126/`（忽略目录，不进入公开发行资产）
