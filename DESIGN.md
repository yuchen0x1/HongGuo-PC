# 红果短剧设计系统

适用源码版本：6.7。release: 6.7，正式发行仅维护 Windows x64；产品交互与视觉规范沿用以下约定；搜索在官网没有同名结果时从 App 上新目录补搜，结果带「今日上新」/「App 新剧」标记。发现与热播推荐的目录线路复用现有选择器，两页独立记忆，窄窗口换行。失败保留旧片单，分页状态与实际内容一致；分集弹窗优先快速展示，慢请求并行重试。播放控制条提供系统原生画中画小窗入口，悬浮播放使用同一视频元素，不重复下载。双击画面进入／退出全屏并保留播放状态；空格短按播放暂停、长按临时 2 倍速；音量、静音与偏好倍速跨剧与重启记忆。登录管理独立成页，APP 观看记录不从原观看历史页混入；只有登录管理内的记录可直接继续播放。设置页支持分类锚点与关键词搜索；观看记录支持选择和批量移除，批量移除只清理记录不删除视频。实际发行和验收状态见 `docs/release-6.7.md`。

## Direction
以 macOS 影音资料库为基准。内容为主，操作为辅；浅暖灰侧栏与白色内容区构成连续窗口，珊瑚红只用于选择与主要动作。主控已确定这一方向，替换旧版深色侧栏与渐变宣传块。

## Cyber HUD 视觉层（6.4 起）
在上述基础方向之上叠加一层克制的赛博科技视觉体系，全部通过设计 token 与末尾打磨层实现，不改动既有类名与文案：

- 视窗边缘：标题栏顶部一条 Cyan→Crimson→Violet 的低频光谱能量线，深色主题下呈现。
- 侧边栏与顶栏：分层半透明深空玻璃 + `backdrop-filter` 模糊，激活项为红色能量条 + 外发光，hover 掠过一道低透明度扫光。
- 按钮：主按钮内置对角扫描流光（hover 触发），按下有外发光扩散。
- 输入与聚焦：聚焦时边框点亮并伴随主题色外晕，搜索触发器聚焦转为青色 HUD 光框。
- 海报卡片：hover 上浮并浮出蓝红双色全息描边与光轨，播放按钮为霓虹红光晕胶囊。
- 播放器：舞台带青色轮廓光，控制条为深色玻璃渐变，当前集分集芯片使用红晕全息态。
- 下载管理：进度条为红→青霓虹能量槽，队列状态使用青色脉冲指示灯。
- 所有动效只使用 `transform` / `opacity` 合成器属性，并在 `prefers-reduced-motion` 下停止。

## Tokens
- Canvas `#faf9f7`，sidebar `#f0eeeb`，surface `#ffffff`。
- Primary text `#252523`，secondary `#686661`，muted `#77736c`。
- Accent `#c8383d`，hover `#ae2b31`，selection `#fae9e7`。
- Success `#33745c`，danger `#ba3438`，border `#e4e1dc`。
- Type: macOS system UI / PingFang SC，Windows fallback Microsoft YaHei。Native typography is an explicit platform choice. Headings 28px/700, body 13px/400, labels 12px/500, captions 11px.
- Spacing: 4/8/12/16/20/24/32px; main content 36px horizontal.
- Sidebar 214px, toolbar 48px; macOS top-left reserves 58px for traffic lights.
- Controls 7–9px radius; posters 12px; sheets 16px. Border or elevation, not both.

## Surfaces
发现短剧：分类与题材在海报上方；3:4 海报直接呈现真实内容。无结果提供重载与搜索，加载采用等比例占位，不虚构片单。
搜索与下载：分段选择搜索/链接；结果、选集和提交构成一个连续任务。
下载管理：主要操作常显，批量维护收进原生可展开菜单；列表是紧凑行而非叠放卡片。
我的剧库：深炭视频舞台保留媒体控制，周围界面使用同一浅色系统。
设置：纵向分组、真实保存与代理测试，避免内部术语堆砌。

## Interaction
所有导航和海报为按钮；选择有 pressed 状态；输入有标签；焦点可见。对话框支持 Escape、Tab 循环和焦点返回。尊重 reduced motion。真实播放、下载、合并和持久化沿用原有 API。

## Verification boundary
代码实施完成后由主控统一构建并进行真实窗口检查；本文不代表远程服务、下载或播放验收。
