# 进度记录

更新时间: 2026-06-12

## 已完成

- 2026-06-16 P1 圆桌 C 位升级:
  - 首页 Hero 与 tabbar 之间新增「AI 圆桌热评」横向轮播,优先展示未开赛/已封盘的圆桌金句,点击可直接打开全屏激辩回放。
  - 圆桌列表卡片升级为可截图传播样式:突出「最毒一句」、展示 2~3 条对线片段,并加入国产军团 vs 海外军团的主流立场比分。
  - 分享图生成逻辑已按后续要求移除;圆桌卡片保留可截图传播样式,全屏回放不再展示「存图分享」入口。
  - tabbar 调整为「🔥 圆桌激辩」优先,圆桌 section 文案改为更口语化的“看 AI 吵架”表达。
  - 本次只改前端与文档,未改写 `public/data/matches.json` 和 `public/data/discussions.json` 的存证数据。
- 2026-06-16 P1 交互微调:
  - 将首屏圆桌热评压缩为短头条样式,新增左右切换按钮,正常手机宽度下整体高度约 186px。
  - tabbar 改为稳定按钮布局:手机主宽度下五项一行;点击后即时定位并立即高亮,避免长页面 smooth scroll 的拖沓感。
  - 正文顺序与 tab 顺序对齐为「圆桌激辩 → 擂台赛 → 比赛 → 冠军预测」,最后一个 section 增加最小高度,保证点击「冠军预测」也能定位到 tabbar 下方。
- 2026-06-16 P2/P3 迭代:
  - 比赛卡强化已赛视觉:赛果大比分显示,赛果命中绿色描边,精确比分金色高亮,猜错项灰化。
  - 首屏新增战绩跑马灯,从排行榜、已结算场次和圆桌热评生成快讯。
  - 新增 `pipeline/recap.js` 与 `npm run recap`,只给已完赛圆桌新增 `recap` 字段;运行前后 `messages` 哈希一致,封盘发言未改动。
  - 新增 `public/data/groups.json`,A-L 组每组 4 队,已用本地小组赛程校验每组 6 场且队名全部匹配。
  - 新增「赛程出线」tab,展示 12 组实时积分表和淘汰赛路径图;淘汰赛场次可点击跳转到对应比赛卡。
  - 新增卡片入场、立场条过渡和榜首微光效,并在 `prefers-reduced-motion` 下关闭动效。
- 2026-06-16 比赛卡通用模型历史弹框:
  - 比赛页「模型预测」列表里的模型名改为可点击按钮,复用排行榜中的模型历史预测弹框。
  - 点击任一模型名可查看该模型全部历史预测、赛果/比分命中和待结算记录。
- 保留并校验已有移动端静态前端:`public/index.html`、`public/styles.css`、`public/app.js`。
- 补齐 `public/data/sample-matches.json`:3 场示例比赛、10 个模型、统一预测版本,其中 2 场带 `actual` 用于结算验证。
- 使用 `pipeline/score.js` 重新生成 `public/data/leaderboard.json`,输出赛果榜与比分榜。
- 新增数据管线:
  - `pipeline/prompts.js`:统一 prompt,强制 JSON 输出。
  - `pipeline/odds.js`:复用 football 项目的 API-SPORTS 约定,通过 `ODDS_API_KEY`/`APISPORTS_API_KEY` 调 `/fixtures` 和 `/odds`;缺 key 或缺日期时回退 sample。
  - `pipeline/lib/seal.js`:稳定 JSON 哈希与封盘时间戳。
  - `pipeline/predict.js`:遍历 enabled 模型预测,缺 key 自动跳过;没有任何模型 key 时不覆盖 `matches.json`。
  - `pipeline/score.js`:按真实赛果统计赛果命中与比分命中,生成排行榜。
- 新增 `package.json` scripts:`predict` / `score` / `score:sample` / `serve`。
- 前端新增北京时间日期切换、空日期预告态和冠军预测模块;真实数据同步为 104 个比赛席位(API 已确定赛程 + 淘汰赛待定占位),不再展示模拟预测。
- 模型清单按最新要求调整为 14 个指定模型,并在页面数据中保留公司字段。
- 新增 `AI 圆桌群聊` 模块:
  - 前端读取 `public/data/discussions.json`,跟随日期切换展示每场比赛的模型短评。
  - `pipeline/discuss.js` 直接调用各模型 API 生成群聊气泡,默认跑北京时间明天的比赛;没有 key 时不造假,页面展示待讨论。
  - 当前主链路不依赖飞书群或机器人轮询,飞书可作为后续传播/互动层。
  - 圆桌每个模型的最后一次发言会强制收束到预测方向与具体比分,不满足则自动重试一次。
- 重新排布移动端前端:
  - 首屏改为赛事控制台风格,比赛仍为主体。
  - 比赛卡新增结算链路状态,清楚展示预测、封盘、赛果、结算四步。
  - 排行榜升级为双榜面板,展示赛果榜与比分榜。
- 补强结算逻辑:
  - `score.js` 输出 `settlement` 摘要;`actual` 存在即结算,开赛后默认 150 分钟仍无赛果则进入 `pending_result`。
  - 全局取消下注、积分和赔率结算,只保留赛果命中榜与比分命中榜,降低传播理解成本。
  - 新增 `npm run settle`,先同步真实赛程/赛果并保留已有预测与封盘信息,再生成排行榜。
  - 新增 `npm run settle:watch`,比赛日前后可每 5 分钟轮询 API 并重算排行榜,默认持续 6 小时。
  - `sync-real-data.js` 现在合并已有比赛数据,不会把封盘预测冲掉。
- 新增访问统计后台:
  - `worker/analytics-worker.mjs` + Cloudflare D1 记录访问事件。
  - `public/analytics.js` 前台埋点,`public/admin.html` 展示总访问、日访问、独立访客、来源、设备、国家/地区与最近访问。
  - `public/analytics-config.js` 负责配置线上 Worker URL。
- 新增排行榜模型历史弹层:
  - 排行榜中的每个模型行都可点击,打开后展示该模型参与过的全部比赛预测。
  - 每场历史记录展示对阵、开赛时间、模型预测、真实赛果,并标记赛果/比分命中或未命中。
  - 未出真实赛果的参与记录显示为待结算,方便封盘后追踪。
- 首页比赛区新增更新时间提示:比赛日前一天 10 点更新大模型预测数据,随后封盘存证。
- 比赛页签日期 tab 优化为只展示真实赛程日期;默认选中今天未完全过去的比赛日,否则跳到下一比赛日,全部结束后回落到最近比赛日,并自动把当前日期滚到可见区域。

## 本地预览

```bash
cd /Users/tom/worldcup-ai-arena
npm run serve
```

打开 http://localhost:8080。

## 数据管线

```bash
cd /Users/tom/worldcup-ai-arena
cp .env.example .env
# 填 ODDS_API_KEY、MATCH_DATE、至少一个模型 API key
npm run predict
npm run discuss
npm run score
```

赛后推荐用一条命令同步并结算:

```bash
npm run settle
```

比赛进行中或赛后等待 API 更新时,可开启轮询:

```bash
npm run settle:watch -- --interval 300 --duration 21600
```

也可以只用 sample 验证结算:

```bash
npm run score:sample
```

## 还差什么

- `.env` 里的真实 key 需要作者填写,不要提交。
- 真实赔率当前对接 API-SPORTS 足球 API,与 `/Users/tom/.openclaw/workspace/football` 项目的 API base/header 保持一致。
- 若要固定某家博彩公司,填写 `ODDS_BOOKMAKER_ID`;不填时默认取 API 返回的第一个 bookmaker。
- 真实比赛赛果需要赛后写入 `public/data/matches.json` 的 `actual`,再跑 `npm run score`。
- 或者赛后运行 `npm run settle`,自动从 API 同步已结束比赛赛果并重算排行榜;若 API 尚未返回赛果,该场会进入 `leaderboard.json` 的 `settlement.pendingResult`。
- `npm run discuss -- --date YYYY-MM-DD` 可为指定北京时间日期生成 AI 圆桌;`--match fixture-id` 可只生成单场。
