# 搜索来源扩展分析：接入更多短剧网站的搜索资源

状态：分析文档（2026-11-04）。第一轮落地内容见文末「9. 第一轮实施结果」；候选站点可用性以当日公开探测为准，接入前需按第 7 节重新验证。

## 1. 背景与目标

当前应用搜索聚合三个内置来源（红果短剧、西饭短剧、河马短剧）加用户自建的苹果 CMS V10 自定义源。目标是评估还能从哪些短剧平台接入搜索资源、按什么顺序接、以及每个方向的成本与风险。

本文只做分析与方案，不改动代码。

## 2. 现状架构盘点

### 2.1 来源与数据流

- 搜索入口 `src/components/SearchPanel.jsx`：对「全部来源」用 `Promise.allSettled` 并发请求各来源；单来源完成即先发布结果，25 秒安全超时兜底；「加载更多」按来源保存 `channel/cursor/page` 状态。
- 排序 `src/components/searchRanking.mjs`：标题 NFKC 归一化后按「全等 > 包含 > 简介命中 > 其他」分层，跨来源合并去重（键为 `source:series_id`）。
- 主进程路由 `main.js`：
  - `searchAtSourcePage`（约 1597 行）：按 `options.source` 分发到 `./src/native/{hema,xifan,custom-source}` 模块，未知来源报错，红果走官网接口 + App 签名搜索 + App 上新补搜。
  - `browse-list` handler（约 1500 行）：目录/发现页同样按来源分发。
- 来源开关 `src/native/media-sources.js`：红果固定开启；`builtin_sources.xifan/hema` 任一为 `false` 时搜索与目录都拒绝该来源。
- 自定义源 `src/native/custom-source.js`：苹果 CMS V10 JSON API（`api.php/provide/vod/`，`wd` 搜索、`ids` 详情、`t` 分类），只接 MP4/M3U8 直链，`isPublicMediaUrl` 拒绝内网与带凭据地址，DNS 与重定向复查配置。

### 2.2 新来源接入契约（以 xifan.js / hema.js 为模板）

一个内置来源模块需导出四个函数，全部返回**归一化数据**，搜索聚合层即自动获得部分发布、超时、排序、加载更多能力：

| 函数 | 输入 | 输出要点 |
|---|---|---|
| `search(keyword, page, { deadline })` | 关键词、页码、截止时间 | `{ success, results[], page, hasMore, nextPage, genres[], pageTitle, sourceUrl }` |
| `browseList({ genre, page, forceRefresh })` | 分类 slug、页码 | 同上，`genres` 带本地缓存（现状 5 分钟） |
| `fetchEpisodeList(seriesId)` | 剧集 ID | `{ series_id, series_title, cover, total, episodes[], source }` |
| `fetchPlayUrlSingle(vid, sid)` | 分集 ID、所属剧 ID | `{ url(https 直链), spadeA, codec, source, locked?, error? }` |

数据形状与 ID 规则：

- 结果项：`{ series_id, series_title, cover(仅 https、无凭据), episode_count, tags[], source, url, intro? }`。
- 分集项：`{ vid, vid_index, title, series_id, series_title, cover, locked, source }`。
- ID 前缀约定：`xifan:{source}:{duanjuId}`、`hema:{bookId}`、`custom:{uuid}:{vodId}[:{line}:{episode}]`；红果为纯数字。分集 ID 在剧 ID 后追加冒号段。
- 锁定集：`fetchPlayUrlSingle` 返回 `locked: true` 且不给 `url`，文案指向官方平台确认可看范围（不破解付费）。

### 2.3 安全基线（必须沿用的既有约定）

- 请求：10–12 秒超时 + `AbortController` + `deadline` 预算；`maxContentLength` 8MB；`User-Agent: Mozilla/5.0`；`maxRedirects: 0`（重定向处理需显式复查）。
- 地址：封面与播放地址仅接受无凭据的公网 https（`httpsUrl` / `isPublicMediaUrl`）；自定义源走 `web-media-guard` 做 DNS 级校验。
- 数据校验：页码、剧集 ID、分集 ID 与请求一致性逐一核对（xifan/hema 均有「返回的剧集与请求不一致」防护）；标题做 `plainText` 去标签。
- 失败文案不得回传上游原始错误或任何含签名的地址（custom-source.js 有明确注释）。

### 2.4 接入触点清单（现状债务）

新增一个内置来源目前需要改动：

1. 新模块 `src/native/<source>.js`（模板约 150–170 行）。
2. `src/native/media-sources.js`：`BUILTIN_SOURCES` 数组 + `setBuiltinSourceEnabled` 的 `['xifan','hema']` 白名单。
3. `src/components/mediaSourcesModel.mjs`：`BUILTIN_MEDIA_SOURCES` 数组 + `mediaSourceLabel` 前缀映射。
4. `src/native/hongguo.js`：`fetchEpisodeList`（约 430 行）与 `fetchPlayUrlSingle`（约 624 行）的前缀分发，`resolveSeriesId`（约 366 行）的编号校验分支。
5. `main.js` 至少 10 处散落的 `/^(xifan|hema|custom):/` 正则（1002、1019、2164、2178、2594、3092、3118、3468、3658–3666 行等）及搜索/目录路由（1496–1502、1584、1597–1599 行）；西饭另有 `episodeDisplayTitle` 特例（2501、4516 行）。
6. 测试：`src/native/*.test.cjs` 与 `src/components/__tests__/media-sources.test.mjs`。

**建议**：在接入第一个新来源前，先把第 4、5 条收敛为「来源前缀 → { 模块, 目录名, 能力标志 }」的单一注册表（一处 require、一处正则），把每源边际成本从「改 10+ 处正则」降到「改 2–3 处注册」。这是纯重构，无行为变化，可用现有测试回归。

## 3. 候选平台全景

按接入路径分四类。分级综合考虑：内容价值（与红果用户的重合度）、技术可达性、维护成本、合规边界。

### A 类：官方网页端（可作原生源）

| 平台 | 入口 | 本次探测 | 技术形态 | 可行性初判 |
|---|---|---|---|---|
| 乐视短剧 | minidrama.le.com；搜索 so.le.com/s?wd= | 首页 HTTP 200（0.23s）；搜索页 HTTP 200 且有结果 | 传统 SSR HTML + XHR 列表（频道 cid=69），非 SPA | **中**：搜索与目录好做；播放直链需验证 |
| 爱奇艺微短剧 | iqiyi.com/microdrama | HTTP 200（0.37s） | React SPA（react.*.js）+ qysdk，强反爬，VIP 内容有 DRM | **低**：列表可抓，播放基本不可行 |
| 2345短剧大全 | v.2345.com/v/duanju | HTTP 200（0.28s） | 传统门户 | 低：聚合转载站，版权链路不清，维护价值小 |
| 喜福网 | minidrama.contentchina.com | HTTP 200（1.9s） | 小众门户 | 低 |
| NetShort / FlexTV | netshort.com/zh、flextv.cc | 未逐一探测 | 出海短剧 App 的 Web 门户 | 低：内容与红果用户重合度低，部分付费墙 |

**乐视短剧**是 A 类里唯一值得做的：免费、官方、有独立短剧频道（男频/女频/排行），站点是乐视多年的传统 SSR 架构，`so.le.com` 全站搜索可用。主要不确定点是播放环节——需要验证短剧详情页是否给出免登录的 M3U8/MP4 直链（乐视历史上有公开播放接口），以及内容库更新频率。若播放直链不可得，可退化为「只搜不播」（标记说明），价值大打折扣，则不建议接。

### B 类：独立 App 平台（走 App API 接入，项目已有先例）

红果搜索已有完整的 App 接入链路：`hongguo-app-search.js`（签名请求）→ `app-source.js`（签名与请求封装）→ `playback-device.js`（设备身份注册）。这套模式可复用于「有 Windows 桌面版或安卓包、API 可抓包」的平台。

| 平台 | 背景 | 客户端 | 内容模式 | 初判 |
|---|---|---|---|---|
| 星芽短剧（九州） | 行业 TOP2 短剧公司 | Windows 商店版（xp9k5qsb4cd8b1）、安卓包 com.jz.xydj | 免费+付费+订阅 | **价值高、难度高**：需真机抓包；若有签名/设备校验可按红果模式做；付费墙比例高，`locked` 标记是硬要求 |
| 喜番短剧（快手） | 快手 com.kwai.theater | Windows 商店版、安卓包 | 免费为主 | **价值中高、难度高**：快手系 API 风控与设备校验预期较强 |
| 番茄短剧（字节） | fanqie.mini.drama | 安卓 App | 免费 | **价值低**：与红果同源同集团，内容重合度极高；接入反而共享红果的风控压力 |
| 河马漫剧/火龙漫剧/红果免费漫剧 | 漫剧品类 | 各自 App | 免费 | 待确认：发现页目录若已含漫剧分类（4.5 已支持真人剧/漫剧/AI 剧），无需单独接 |
| 麦萌短剧、繁花剧场 | 二线平台 | App 为主 | 付费占比高 | 价值中低，暂缓 |

B 类的共同前提：**只做公开接口的注册式调用（设备注册 + 平台自身签名），不做加密逆向或破解**。抓包后若发现无法以合法客户端身份完成签名，即放弃该平台，与红果 App 搜索的处理一致（失败有冷却与回退，不做重试轰炸）。

### C 类：聚合/采集资源站（复用现有自定义源通道，见效最快）

短剧专用采集站（如旺旺短剧 `wwzy.tv/api.php/provide/vod`、山海资源等，多见于 TVBox 生态）全部是苹果 CMS V10 JSON 格式——**现有自定义源已 100% 支持这一格式**，无需写任何新协议代码。本次探测 `wwzy.tv` 连接超时（12s 无响应），恰好说明这类站的常态是随时失效。

因此建议：**不把它们内置为固定来源**（失效会造成「来源坏了」的负反馈，也把弱版权链路变成了应用行为），而是做「推荐源模板」：

- 设置 → 自定义播放源增加一个下拉模板列表（名称 + 预填 API 地址，来源标注为社区采集站）。
- 用户点击模板 → 自动填入 → 「测试连接」验证可用 → 手动保存启用。
- 列表本体是静态数据文件，可随版本更新；单个模板失效只影响「点它的人」，不影响内置搜索。

改动范围仅 `CustomSources.jsx` + 一个静态列表 + 测试（注意测试桩对类名/文案的断言、window mock 无 `addEventListener` 的既有约束）。

### D 类：不建议接入

- **抖音主站 / 快手主站 Web**：登录墙 + 搜索接口加密风控，内容与红果/喜番高度重合。
- **微信小程序短剧**：无公开 API。
- **腾讯视频短剧频道**：VIP + DRM。
- **海外 ReelShort / DramaBox / ShortMax**：付费墙为主、地区限制、内容语言与目标用户不匹配。

## 4. 重点候选的接入方案概要

### 4.1 乐视短剧（P1，原生源）

- **搜索**：`so.le.com/s?wd=` 搜索结果页（SSR），或抓列表 XHR 接口；映射为 `series_id: le:{vid}`，标题、封面、集数从结果项提取。
- **目录/发现**：minidrama.le.com 频道分类（男频/女频/排行，cid=69 子频道），对应 `browseList` 的 `genres`。
- **分集**：剧集详情页 SSR 数据或 XHR；校验返回的剧集 ID 与请求一致（沿用 hema 的 `__NEXT_DATA__` 同级校验思路，乐视需确认其数据内嵌方式）。
- **播放**：待验证。乐视播放历史上走自有 CDN 直链（` Lecloud/letv ` M3U8）；若需其播放 SDK 或动态加密，则此源降级为不可行。
- **风险**：乐视内容更新慢、接口为遗留体系可能变动；需 `deadline` + 冷却兜底（参考红果 App 搜索的 `APP_SEARCH_COOLDOWN_MS` 模式）。

### 4.2 星芽短剧 / 喜番（P2，需评估）

- 第一步是**真机抓包**（Windows 商店版用本机代理，安卓包用模拟器或真机），确认：搜索、详情、分集、播放四类接口的形态；是否有设备注册、签名、风控。
- 可走通则按红果 `app-source` 模式实现：设备身份 + 平台签名 + 冷却 + 失败回退，`locked` 分集不给地址只提示。
- 不可走通（签名无法合法获得）则记录原因并放弃，不投入逆向。

### 4.3 推荐源模板（P0，改动最小）

见 3 类 C。工作量约半天到一天，包括：静态模板列表文件、`CustomSources.jsx` 模板下拉、测试更新。发布时对外说明为「修复了已知问题」级别的更新即可，无需大版本。

## 5. 合规与安全边界（全部候选通用）

沿用项目一贯原则，写入各来源模块的实现约束：

1. 不破解付费：锁定/付费分集一律 `locked: true`，不提供地址，提示到官方平台确认。
2. 只接公开接口：不做加密逆向、不伪造客户端签名、不绕过登录墙与风控。
3. 地址白名单：仅无凭据公网 https 直链；自定义源继续走 `web-media-guard`。
4. 请求克制：超时 + deadline + 失败冷却，不重试轰炸。
5. 不记录凭据与签名媒体地址（AGENTS.md 既有要求）。
6. 弱版权链路的采集站只以「用户自选的自定义源」形态存在，不进入内置默认来源。

## 6. 实施优先级与工作量

| 优先级 | 事项 | 工作量 | 前置条件 |
|---|---|---|---|
| P0 | 自定义源「推荐短剧源模板」 | 0.5–1 天 | 收集 3–5 个当日可用的 MacCMS 短剧接口并逐一测试 |
| P1 | 来源注册表重构（收敛 main.js/hongguo.js 的前缀分发） | 0.5–1 天 | 无；现有测试回归 |
| P1 | 乐视短剧原生源 PoC → 实现 | PoC 0.5 天；实现 2–4 天 | PoC 确认搜索/分集/直链三环节 |
| P2 | 星芽、喜番 App API 评估（抓包报告） | 1–2 天 | 真机/桌面版环境 |
| 暂缓 | 爱奇艺、抖音、快手主站、腾讯视频、海外平台 | — | — |

新来源单测清单（对齐 `node scripts/test.cjs`）：搜索归一化与去重、分集 ID 一致性校验、锁定集不给地址、超时与错误文案不泄漏上游地址、`mediaSourceLabel` 前缀映射、来源开关在搜索与目录两条路径同时生效。

## 7. 验证与限制

- 探测结论基于 2026-11-04 当日的公开页面 HTTP 状态与页面结构，未做接口级与播放级验证；乐视、星芽、喜番进入实施前必须先完成各自 PoC/抓包。
- 采集站接口有效性逐日波动，P0 上线时以「测试连接」结果为准，不在文档固化具体可用站点。
- 验收遵循项目规则：真实下载素材、全程静音、独立测试目录、自动删除只针对本轮；在项目内记录素材来源、步骤、结果与限制。
- 本文档不包含任何登录凭据或带签名媒体地址。

## 8. 结论

- **最快见效**：P0 推荐源模板——零协议开发，把已经支持的苹果 CMS 通道变成可自助扩展的资源池。
- **下一个真正的内置源**：乐视短剧（A 类唯一值得做），但以播放直链 PoC 通过为前提。
- **内容价值最高但不确定性最大**：星芽/喜番的 App API（B 类），按「只注册式调用、不逆向」的边界先评估再决定。
- **先重构后扩张**：来源前缀注册表重构（P1）应先于任何第二个新内置源，否则每加一源要碰 main.js 十余处正则。

## 9. 第一轮实施结果（2026-11-04，未随版本发布）

### 9.1 网络验证结论（当日实测）

- **乐视短剧**：`minidrama.le.com` 与 `so.le.com` 可达；旧版播放接口 `api.le.com` 已不存在（DNS 不解析）；新版分集接口 `d-api-m.le.com/detail/episode` 参数不透明（1004），`vplay` 页返回 151 字节反爬页。**分集与播放链路不可用，本轮不接入**，后续若 PoC 打通再评估。
- **海外平台**（DramaBox、NetShort、FlexTV、ReelShort、ShortMax、GoodShort、KalosTV）：全部 HTTP 403 或连接失败（地区封锁/防爬）。**从大陆网络不可达且无法验证，不接入**；需要海外网络环境另行 PoC。
- **MacCMS 采集站**：当天实测可用且短剧内容丰富的接口——金鹰 `jinyingzy.com`、海盗 `hhzyapi.com`、硕博 `subocaiji.com`、暴风 `bfzyapi.com`、360 `360zy.com`；旺旺 `wwzy.tv` 本机网络连接超时（部分网络可达性因人而异）。金鹰/海盗/硕博的播放地址是「网页播放页」（如 `play.hhuus.com/play/xxxx`），在同目录拼接 `/index.m3u8` 后为有效 HLS 清单（AES-128，密钥 16 字节），应用现有 `remuxHls` 管道可解密转封装播放——已在三个站点实测验证。

### 9.2 已实现（代码与测试）

1. **跨来源同名去重合并**（用户核心诉求：一部短剧多平台收录时自动屏蔽重复）
   - `src/components/searchRanking.mjs`：新增 `mergeDuplicateDramas`，按归一化标题合并跨来源同名项，保留排序在前的来源，其余记入 `also_on`；集数相差超过 `max(3, 20%)` 视为不同剧（同名翻拍）不合并。
   - `SearchPanel`：结果摘要显示「已自动合并 N 条同名重复」；卡片新增「同剧 N 个来源」徽标（悬停列出其他来源）。
   - 测试：`search-ranking.test.mjs` 新增 5 项；`check-ui-state.cjs`、`check-series-search.cjs` 的跨来源断言更新为新契约。
2. **自定义源播放页直链转换**
   - `src/native/custom-source.js`：分集地址为「纯路径、无查询、无扩展名」的播放页（如 `/play/xxxx`）时保留入列；取播时拼接同目录 `/index.m3u8` 作为首选 HLS 候选，同标题的其他线路直链作为后备候选。解析页（媒体地址藏在查询参数）与 `.html` 页面维持拒收，永不成为媒体候选。
   - 测试：`check-custom-source.cjs` 新增播放页转换契约检查（9→10 项全过）。
3. **内置短剧资源站（第二轮按用户反馈调整：放弃「模板+手动保存」，直接进内置来源）**
   - `src/native/media-sources.js`：新增 `COLLECT_SOURCES` 六个固定配置（金鹰/海盗/硕博默认开启，暴风/360/旺旺默认关闭），编号用固定 UUID（`custom:<uuid>`），与用户自建自定义源互不混淆。
   - `src/native/custom-source.js`：`assertEnabled` 优先识别内置采集源——配置取固定值（用户自建同号源无法劫持），开关读 `builtin_sources`，关闭时报「此来源已关闭，可在设置中重新开启」。
   - `src/components/mediaSourcesModel.mjs`：`BUILTIN_MEDIA_SOURCES` 镜像六个采集源（含 note）；`BuiltinSources.jsx` 在「内置来源」区展示开关与说明。
   - 因为编号沿用 `custom:` 前缀，搜索/目录/分集/播放/下载/去重全链路零改动直接生效；跨源同名去重对采集源同样适用。
   - 测试：`media-sources.test.cjs`（双端）、`check-custom-source.cjs`（固定配置、防劫持、开关拦截）、`check-ui-state.cjs`（搜索机制用例固定三来源）。

### 9.3 明确不做（本轮）

- 海外平台接入（不可达、无法验证）。
- 星芽/喜番 App API（需真机抓包评估，坚持「只注册式调用、不逆向」边界）。
- 对综合采集站做「短剧限定」启发式过滤（误杀风险高，靠相关性排序区分；如需再评估）。
- 来源前缀注册表重构（本轮无新内置源，延后到接入第二个原生源之前）。

### 9.4 验证情况与限制

- `npm run build:react` 通过；`npm test` 中与本次改动相关的全部单元测试与检查通过。剩余 3 个失败（`nas-export.test.cjs`、`check-download-safety.cjs`、`check-nas-export.cjs`）为 Windows 无符号链接权限的 `EPERM: symlink` 环境预置问题，与本次改动无关，涉及文件均未触碰。
- 采集站接口有效性逐日波动；模板仅为填入便捷，实际可用性以「测试连接」为准。综合站（暴风、360）除短剧外也收录长剧，靠搜索相关性排序区分。
- 播放页 `/index.m3u8` 转换规则基于常见采集站模板（hhuus/xluuss/kuktxu 域族实测），不保证覆盖所有站点；推导失败会在播放时明确报错。HLS 为 AES-128 标准加密（密钥随清单公开提供），由应用既有 HLS 管道正常解密播放，不涉及任何破解。
