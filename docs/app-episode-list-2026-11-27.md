# 官网分集列表改版与备用接口签名修复记录（2026-11-27）

## 1. 结论

- **播放接口没有坏。** 用同一份分集编号调用 `fetchAppPlayUrl`，仍能取得真实 MP4 直链；
  6.38/6.40 接入的单集 `video_model` 路由（`app-video-model`）继续可用。
- 2026-11-27 起用户点开剧集报的「获取分集失败：官网数据源（官网分集数据异常；重试失败：
  官网分集数据异常），备用接口（接口返回空响应（HTTP 200，0 字节）…）」，两段来自**两个
  独立失效**，都发生在**分集目录**这一层：
  1. 官网 `player` 页改版：`seriesDetail.vid_list` 只返回 3 个 `v1_` 前缀的不透明标识
     （`accessible_episode_cnt: 3`），完整的 88 集只在 `episode_cnt` 等元数据里；
     `videoList` 是空对象。旧代码按 19 位数字校验 `vid_list`，因此报「官网分集数据异常」。
  2. App 备用接口 `multi_video_detail/preload/v1` 要求签名：未签名请求在
     `reading.snssdk.com`、`api5-normal-sinfonlinea/b.fqnovel.com` 上**一律 HTTP 200 空正文**。
- 修复方式：备用接口改用项目已有的 `signPlaybackV5` 签名后请求，一次请求即可取回全部数字
  分集编号。

## 2. 实测事实

官网页（`/player/7706404415887903806`，HTTP 200，212 KB）：

```
protectedPlayback: true
publicVideoSeo: { available: true, itemId: "v1_CW8P13z…", durationSeconds: 151.914 }
seriesDetail: { episode_cnt: 88, accessible_episode_cnt: 3, vid_list: ["v1_…","v1_…","v1_…"] }
videoList: {}
```

`v1_` 标识是 20 字节高熵二进制（base64url），不是数字 vid 的编码，无法解回原编号；
页面内 39 个唯一 `v1_` 标识均未与 `vid_index` 建立可核对映射，因此不做逆向。

未签名的目录接口（三个主机一致）：

```
POST /novel/player/multi_video_detail/preload/v1
body: { biz_param, dr_scene: "preload", series_id }
→ HTTP 200, 0 字节
```

签名后（`signPlaybackV5` + `VIDEO_MODEL_PROFILE` 画像，匿名本地身份）：

```
→ HTTP 200, code 0, BaseResp.StatusCode 0
   data[series_id].video_data.video_list 长度 88
   每项含 vid（19 位数字）、vid_index 1..88、series_id、title、cover
```

返回的首集 `7706406239239932952`、末集 `7706406374967610392` 与
`docs/app-source-later-episodes-2026-11-26.md` 记录的目录逐条一致。

## 3. 代码改动

- `src/native/app-source.js`：新增并导出 `signedEpisodeListRequest(seriesId)`。用
  `VIDEO_MODEL_PROFILE` 的 V5 签名（`x-khronos` / `x-helios` / `x-medusa` / `x-ss-stub`）
  为目录端点生成请求；身份是进程内匿名 `iid` / `device_id` / `cdid`，与目录、搜索等只读
  请求同族，不占用播放设备的注册身份。
- `src/native/hongguo.js`：
  - `apiCall` 从「路径 + 明文 body」改为接受签名请求 `{ url, body, headers }`，保留原有的
    重试、空响应识别、`x-tt-logid` 回填和 `preserveLargeJsonIntegers`（`vid` / `series_id`）。
  - `fetchEpisodeListFresh` 的备用分支改为 `signedEpisodeListRequest` + `apiCall`；原有的
    剧集身份、`vid` 精度、`vid_index` 唯一性与排序校验全部保留。
  - 删除只服务于旧明文请求的 `API`、`COMMON_QUERY`、`HEADERS`、`DETAIL_BIZ_PARAM` 常量。

下游字段不变：App 路径仍不提供 `web_available`（`main.js` 以 `?? null` 兜底），与修复前一致。

## 4. 验证

| 项目 | 结果 |
| --- | --- |
| `node scripts/check-hongguo-identity.cjs` | 全部 PASS（含裸数字/引号数字精度、业务码、圆整编号拒绝） |
| `node scripts/check-source-recovery.cjs` | 19/19 PASS（含空响应只请求一次、瞬时网络错误重试 3 次） |
| 真实目录 3 部剧 | 《嫌疑人的秘密2藏金生死线》88 集、《宴律，你的白月光回国了》76 集、《好一个乖乖女》88 集，`vid_index` 均连续 |
| 端到端（第 88 集） | 目录 → `fetchPlayUrlSingle` 取源成功，`app` 路由、1080p、67.292 s、637 ms |
| 整集解码 | 第 6/22/34/68/88 集：下载 → spade 解密 → ffmpeg 整集静音解码全部通过，解码时长与接口时长差 < 0.06 s |
| `npm test`（首次执行） | 当时为 25/27；官网测试素材夹具不接受当前 `v1_` 分集标识 |

验证素材全部为真实红果分集，全程静音（`-an`），媒体写入独立临时目录并在同一轮删除，
未记录凭据、签名地址或设备标识。

## 5. 限制与未完成

- `v1_` 不透明标识与数字 `vid` 的映射尚未取得；官网 SEO 预览路径（`official-web-public-fallback`）
  在改版后是否还能拿到完整时长未重新验收。
- 其他剧集的每一集仍需逐集判断，不能用本次 5 集结果推广为整部剧或全平台可播。

## 6. 后续复验（2026-11-27）

- 修复素材夹具后，`check-download-quality-integration.cjs` 为 27/27，完整 `npm test`
  通过：单元测试及 120 项平台检查均无失败、无跳过。
- 定向检查：`check-hongguo-identity` 4/4、`check-source-recovery` 19/19、
  `check-native-performance` 8/8。
- 6.41 Windows x64 安装包的主程序、`app.asar`、FFmpeg 和 FFprobe 与打包目录逐字节一致；
  主程序为 x64 PE 镜像。
- 使用刚安装的 6.41.0 程序和隔离空资料目录实测第 6、22、34、68、88 集；真实结束事件下
  第 22 集自动转到第 23 集。测试静音，不验证扬声器输出。详细结构化回执位于
  `.local/analysis` 与 `dist/playback-later-20261127-641`，不纳入公开源码或 Release 资产。
