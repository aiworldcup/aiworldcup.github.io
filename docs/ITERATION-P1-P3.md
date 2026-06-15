# 世界杯 AI 擂台 — P1/P2/P3 迭代制作计划

> 本文档给**执行 AI**看。承接 P0(圆桌内容人格化已完成)。
> 目标:把最有特色的「AI 圆桌激辩」顶到 C 位、提升整体表现力、补充用户关心的赛事信息。
> 所有路径相对 `/Users/tom/worldcup-ai-arena/`。纯静态前端,不引构建工具,改完 `npm run serve` 开 `http://localhost:8080` 即可看。

---

## ⛔ 两个高危点(动手前先记住,后面还会重复强调)

> 这两点出错会直接损坏产品,且不易被发现。执行中遇到相关步骤必须格外小心。

1. **存证数据不可改写**:`matches.json` 里 `actual` 非空的场次、`discussions.json` 里这些场次的 `messages`,是"赛前封盘、赛后不可改"的信任基石。**任何任务都只能新增字段或新增文件,绝不能覆盖/重写/删除已完赛的 messages 和比分。** 即使是为了"统一格式"也不行。改完用 `git diff` 自查有没有误伤老数据。
2. **P3-0 分组数据必须人工核对**:`matches.json` 没有"哪队属于哪组"的字段。P3 小组排名表依赖一份你新建的 `groups.json`。**自动推断/凭记忆填写极易出错,产出后必须逐组核对(12 组、每组 4 队、队名与 matches 完全一致)再用,否则 P3-1 排名全错。** 这一步若无把握,停下来交给作者确认,不要硬编一个分组糊弄过去。

---

## 工作纪律(必读)

1. **不要删除作者已有文件;不要 `git push`;不要把 API key 写进代码。**
2. 已完赛比赛的存证数据(`discussions.json`、`matches.json` 里 `actual` 非空的项)**不可改写**,这是产品信任基石(见上方高危点 1)。
3. **分阶段停下等验收,不要 P1/P2/P3 一口气连跑。** 每完成一个大阶段(P1 做完 / P2 做完 / P3 做完)就停下,提示作者本地 `npm run serve` 验收,得到确认后再进入下一阶段。一口气跑到底容易方向跑偏、返工更贵。阶段内的小任务可连续做。
4. 每完成一个任务,在本文件对应 checkbox 打勾,并在 `docs/PROGRESS.md` 追加一行(做了什么 / 怎么预览 / 还差什么)。
5. 改 JS/CSS 后,务必更新 `index.html` 里对应的 `?v=` 版本号(强制刷新缓存),否则用户看不到更新。
6. 先读懂现有代码再动手。核心文件:`public/index.html`(126行)、`public/app.js`(1222行)、`public/styles.css`(1781行)。
7. 移动端优先:单列、大字号、触摸友好。所有新组件先在窄屏(375px)下验收。
8. 拿不准的地方(尤其涉及上方两个高危点)**宁可停下问作者,也不要自作主张猜一个**。

---

## 现状速查(执行前先对齐)

**数据文件**(`public/data/`):
- `matches.json` → `{ matches: [...] }`。单场字段:`id, stage, kickoff, home{team,flag,teamEn}, away{...}, odds{result{home,draw,away}, scores{...}}, actual{result,score}|null, predictions, dateKey`。
  - `stage` 取值:`World Cup · Group Stage - 1/2/3`、`Round of 32`、`Round of 16`、`Quarter-finals`、`Semi-finals`、`Match for third place`、`Final`。
  - `actual.result` 取值:`home|draw|away`;`actual.score` 形如 `"2-0"`。未完赛时 `actual` 为 `null`。
  - ⚠️ **没有 `group` 字段**(谁属于哪个小组未知)。P3 小组排名表依赖此项,需先补 `public/data/groups.json`(见 P3-0)。
- `discussions.json` → `{ updatedAt, mode, note, discussions:[{matchId, sealedAt, messages:[{modelId,modelName,vendor,turn,round,text,timestamp}]}] }`。
- `leaderboard.json`、`models.json`、`champion-predictions.json`。

**app.js 现有可复用函数**(直接调,别重写):
- 渲染:`renderRoundtableFeed()` `renderMatches()` `renderLeaderboard()` `renderHeroMetrics()` `renderChampionPredictions()` `renderMatchCard(m)`
- 圆桌:`openDebateStage(matchId)`(全屏回放) `playDebate()` `stanceBreakdown(messages)`(返回 `{counts:{home,draw,away}, total}`) `hottestLine(messages)`(返回最有料的一条) `stanceBarHTML(counts,total)` `finalMessagesByModel(messages)`
- 工具:`modelMeta(id)`(→`{name,color,...}`) `campOf(meta)`(→`domestic|overseas`) `flagIcon(value)` `formatKickoff(value)` `matchLifecycle(match)`(→`{key,label,tone}`,key∈`upcoming|sealed|live|settled`) `escapeHTML()` `beijingDateKey()` `matchDateKey(match)` `dateLabel()` `formatPercent()`
- 入口:`init()` → `refreshData()` 内顺序调用各 render 函数。新增 render 记得挂进去。
- 弹层模式:已有 `debate-stage` 和 `model-history-stage` 两个全屏层,新增弹层照抄其 DOM 结构 + `is-open` class + `body.style.overflow='hidden'` 套路。

**视觉变量**(`styles.css` `:root`):`--bg:#080a0f` `--bg-2:#0d1118` `--gold` `--orange` `--cyan`,主色暗底 + 金/橙/青渐变。新样式沿用这套色板,别引入新主色。

**军团概念**:模型分「国产军团 🇨🇳 domestic」vs「海外军团 🌍 overseas」,`campOf()` 判定。这是已有的传播抓手,新功能尽量复用。

---

## P1 — 把圆桌顶到 C 位(最高优先级)

> 核心问题:最有特色的圆桌被埋在第二个 tab。要让用户进站 3 秒内就被"AI 互怼"抓住。

### [x] P1-1 首屏「今日最劲爆圆桌」金句轮播
- 位置:`index.html` 的 `<header class="hero">` 和 `<nav class="tabbar">` 之间,新增一个 `<section id="hero-roundtable">`。
- 逻辑:新函数 `renderHeroRoundtable()`,从 `DISCUSSIONS` 里挑「未开赛 / 即将开赛」的场次,对每场用现有 `hottestLine(messages)` 取最毒一句,做成横向滑动/自动轮播卡片。每张卡显示:对阵(国旗+队名)、最毒金句、发言模型头像+名字+军团徽标、`▶ 看激辩` 按钮。
- 点击整卡 → 调现有 `openDebateStage(matchId)` 直接进全屏回放。
- 自动轮播:每 4~5 秒切一张,hover/touch 时暂停。移动端支持手指横滑(scroll-snap 即可,别引库)。
- 挂载:在 `refreshData()` 里调用;空数据时整个 section 隐藏。
- 验收:首屏不用滚动就能看到一句 AI 金句在动,点一下进回放。

### [x] P1-2 圆桌卡片改造成"可截图分享"的对线样式
- 改 `renderRoundtableFeed()` 里的 `renderCard()`。当前卡片已有立场分布条+一句引用,要强化:
  - 「最毒一句」用更大字号 + 醒目描边/底色(红橙色系),像微博热评截图。
  - 展示 2~3 个**互相 @ 的回合片段**(从 messages 里找 text 含 `@` 或被点名的相邻两句),呈现"对线"既视感,而不是只有一句。
  - 卡片底部加「军团对线比分」:这场里国产军团 vs 海外军团各自的主流立场(用 `campOf` + `stanceBreakdown` 思路统计),做成 "🇨🇳 看好主胜 4 : 2 看好客胜 🌍"。
- 分享图入口已取消,保留卡片本身的截图传播样式。

### [ ] P1-3 一键生成分享长图(已取消)
- 给单场圆桌做"分享卡":对阵 + Top3 金句 + 各模型最终预测 + 站点水印/二维码占位。
- 实现:用 canvas 手绘(别引 html2canvas 这类重库,纯静态优先;若必须引,用 CDN 单文件且降级容错)。生成后触发下载 / 移动端长按保存。
- 当前决定:去除分享图生成逻辑,不在全屏回放层保留「存图分享」入口。
- 验收:点按钮能下载一张竖版图,内容完整、暗色风格统一。

### [x] P1-4 tabbar 文案 & 顺序微调
- `index.html` 的 `#tabbar`:把「圆桌激辩」排到「擂台榜」之前或并列突出(加 🔥 已有),确认锚点滚动 `wireScrollSpy()` 仍正常。
- 圆桌 section 的 `section-sub` 文案再口语化一点,强调"看 AI 吵架"。

---

## P2 — 视觉表现力升级

> 核心问题:暗色+金渐变方向对,但缺"赛事爽点"。信息密度高却没有视觉记忆点。

### [x] P2-1 比赛卡片视觉强化(`renderMatchCard`)
- 比分/对阵区放大:国旗用大号(可用 `flag-icon` emoji 放大或 CDN 国旗图),队名加粗,VS 居中。
- 已完赛卡片:命中的模型预测加**绿色描边/✓**,猜错加**灰色**,猜中精确比分加**金色高亮+🎯**。让"谁猜对了"一眼可见。
- 赛果用大号比分数字呈现(如 `2 : 0`),而不是小字。

### [x] P2-2 首屏战绩跑马灯
- Hero 区 `#hero-metrics` 下方加一条横向自动滚动跑马灯(CSS animation,无限循环)。
- 内容:轮播"金句 + 战绩快讯",例如「Grok 4.3 已猜中 7 场赛果」「DeepSeek 精确比分命中 3 次」「🇨🇳 国产军团本轮 12:9 领先」。数据从 `leaderboard.json` / `buildLeaderboardRows()` 取。
- 纯展示,hover 暂停。移动端字号够大。

### [x] P2-3 微动效与质感
- 卡片入场:进入视口时淡入上浮(IntersectionObserver,别用第三方库)。
- 立场分布条 `stanceBarHTML`:加宽度过渡动画。
- 榜单第 1 名:加金色光晕/微缩放,强化"擂主"感。
- 全局:统一圆角、阴影、间距尺度,检查窄屏不溢出。
- 注意:动效克制,`prefers-reduced-motion` 下关闭。

### [x] P2-4 赛后"打脸/封神"自动总结(内容+视觉双重钩子)
- 新增 `pipeline/recap.js`:比赛出 `actual` 后,对该场 `discussions` 里每个模型的最终预测对照赛果,算出:
  - 「封神」=精确比分命中的模型;「打脸」=赛果都猜反的模型(尤其赛前嘴最硬那个)。
  - 生成一句钩子文案,如「Grok 赛前狂喷 2-0 是梦话,结果真 2-0,打脸现场 🤡」。
- 产出写入 `discussions.json` 对应场次的新字段 `recap:{godModels:[], faceSlapModels:[], hookText:""}`(不动 messages 存证)。
- 前端:圆桌卡片 / 比赛卡片顶部展示 recap 钩子,红绿配色。这是赛后传播的核心素材。
- ⚠️ **高危点 1**:只读 `actual` 来计算,只能给场次**新增** `recap` 字段。绝不能改写或重排已封盘的 `messages`。写完用 `git diff` 确认 messages 数组零改动。

---

## P3 — 新赛事信息模块(用户关心的内容)

> 放进一个新 tab,**不要挤占圆桌的 C 位**。圆桌是特色,这些是"留得住人"的实用信息。

### [x] P3-0 前置:补小组分组数据(其余 P3 的依赖)
- ⚠️ `matches.json` 没有 `group` 字段,无法直接算小组排名。先建 `public/data/groups.json`:
  ```json
  { "groups": { "A": ["墨西哥","南非", "..."], "B": [...], "...": [] } }
  ```
- 2026 世界杯 48 队、12 组(A~L)、每组 4 队。队名用 `matches.json` 里 `home.team`/`away.team` 的中文名,保证能精确匹配。
- 来源:可让模型按真实抽签结果填,或从赛程推断(同组球队在小组赛阶段两两交手)。**推断法**:小组赛 72 场,同组 4 队打 6 场,可用图聚类自动分组,再人工核对命名。建议写个一次性脚本 `pipeline/derive-groups.js` 辅助,产出后人工校验存为 `groups.json`。
- 验收:12 组各 4 队,队名与 matches 完全一致(无对不上的)。
- ⚠️ **高危点 2**:这份分组是后续整个排名表的地基,自动推断/凭记忆都易错。**产出后必须逐组人工核对再用;没把握就停下交作者确认,不要硬编一个分组糊弄。** 队名只要有一个对不上 `matches.json`,该组排名就是错的。

### [x] P3-1 小组赛积分排名表
- 新 tab「赛程出线」,新 section `#standings-section`。
- 新函数 `renderStandings()`:遍历 `groups.json` + `matches.json` 已完赛(`actual` 非空)的小组赛场次,按 FIFA 规则算积分:胜3平1负0,排序依据 积分→净胜球→进球数。
- 每组一张表:排名、队名(国旗)、场次、胜平负、进球/失球/净胜球、积分。前 2 名(出线区)高亮。
- 未赛完时显示实时排名 + "已赛 X/3 轮"。
- 移动端:每组表格单列可横滑,或压缩列。

### [x] P3-2 淘汰赛出线对阵图(bracket)
- 同 tab 内 section `#bracket-section`,新函数 `renderBracket()`。
- 从 `matches.json` 取淘汰赛阶段(`Round of 32` 起)场次,画树状对阵图:32强→16强→8强→4强→决赛。
- 已赛场次显示比分和晋级方,未赛显示 "待定/TBD"。晋级线条高亮。
- 移动端:树状图横向 scroll-snap 可滑,或按轮次折叠展开。**别引图表库**,用 CSS grid/flex 手画。
- 验收:能看出完整晋级路径,点单场可跳到该场比赛卡片或圆桌。

### [x] P3-3 tabbar 增项 & 导航
- `index.html` tabbar 加「赛程出线」入口,确认 `wireScrollSpy()` 锚点高亮正常。
- 顺序建议:🔥圆桌激辩 · 擂台榜 · 赛程出线 · 比赛 · 冠军预测。

---

## 执行顺序建议

1. **P1 全做**(顶圆桌到 C 位)→ 立刻提升进站观感,ROI 最高。
2. **P2-1 / P2-2 / P2-4**(视觉爽点 + 打脸钩子)→ 强化传播。
3. **P3-0 → P3-1 → P3-2**(实用信息,P3-0 是硬前置)。
4. P2-3 微动效最后做,属锦上添花。

## 通用验收清单(每个任务都要过)

- [ ] 375px 窄屏无溢出、无错位。
- [ ] 空数据/加载中有兜底(别白屏报错)。
- [ ] 改了 JS/CSS 已更新 `index.html` 的 `?v=` 版本号。
- [ ] 未触碰任何已完赛存证数据。
- [ ] `npm run serve` 本地实测通过,`docs/PROGRESS.md` 已记录。
