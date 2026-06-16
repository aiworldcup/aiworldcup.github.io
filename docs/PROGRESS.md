# 进度记录

更新时间: 2026-06-16

## 已完成

- 2026-06-16 圆桌超时状态展示与链路验证:
  - `public/data/discussions.json` 的圆桌 thread 新增 `issues` 记录,用于标记模型 API 超时、补跑失败、格式无效等状态;比赛卡「模型预测」列表会直接展示异常模型,不再静默留空。
  - 北京时间 2026-06-17 四场补跑后仅 Kimi K2.6 仍在真实圆桌长 prompt 下 60 秒超时;Qwen、Mimo、DeepSeek、GLM、MiniMax 等缺口已补回真实发言。
  - 链路验证结果:老超时模型短 prompt 均可正常返回,说明 key/网关基本可用;问题主要出在长圆桌 prompt 与 25 秒超时窗口,其中 Kimi 在 60 秒长 prompt 下仍超时。
- 2026-06-16 明日比赛赔率恢复:
  - 查明胜平负赔率消失原因: `sync-real-data.js` 默认只同步前 16 场赔率,北京时间 2026-06-17 的 4 场排在第 17-20 场;同时合并逻辑存在 fresh `null` 覆盖已有赔率的风险。
  - 已将默认赔率同步窗口扩到 32 场,并修复赔率合并为“只用非空 fresh 值覆盖 existing 值”。
  - 新增 `npm run sync:odds -- --date YYYY-MM-DD`,可单独按日期补胜平负赔率;已为 2026-06-17 四场补回赔率。
- 2026-06-16 明日圆桌补跑:
  - 已检查北京时间 2026-06-17 的 4 场未赛圆桌,只针对旧 `API超时兜底` 和缺失回合调用对应模型补跑,未让其他正常模型重新参与。
  - 成功替换/补写 31 条真实模型发言;补跑仍超时或最终预测格式不可解析的条目已清掉旧兜底并保持空缺,不再显示 1-1 平局保底。
  - `pipeline/append-discussion-models.js` 支持 `--date`、`--retry-fallbacks`、`--missing-only`、`--clear-fallbacks`,用于后续按日期只修缺失模型。
- 2026-06-16 圆桌超时容错调整:
  - `pipeline/discuss.js` 移除最终发言的赔率/1-1 平局兜底填充;模型缺 key、超时、返回空文本或最终预测格式无效时先留空。
  - 本次目标比赛第一轮全部跑完后,会把留空的最终发言集中补跑一次;补跑成功才写入真实模型发言,补跑仍失败则跳过该模型。
  - 该项只改后续生成逻辑和文档;随后按作者要求单独执行了 2026-06-17 明日圆桌补跑。
- 2026-06-16 比赛页简约模式:
  - 比赛页新增「简约模式」勾选开关,偏好会保存在本地,下次打开仍保持该模式。
  - 简约模式下隐藏普通预测说明条,每场压缩展示对阵、状态、主/平/客模型预测比例、热门比分和模型数量。
  - 简约模式补充比赛进行时间,复用详细模式的 `MM/DD HH:mm 北京时间` 显示口径。
  - 点击任一简约比赛行可展开原完整比赛卡,继续查看模型明细、历史预测入口和圆桌激辩入口。
  - 修复简约行继承全局 section 间距导致的一屏显示不足问题。
  - 点击任意页签时会恢复点击前的滚动位置;即使目标页内容较短,也会托住页面高度,不再为了简约模式强行把 tabbar 置顶。
- 2026-06-16 比赛页「一键烤啤」:
  - 比赛页控制区新增「一键烤啤」按钮,打开弹框后只允许选择「当前日期全部比赛」或「竞彩单关」两个范围,不再逐场自由选择。
  - 新增 `public/data/jingcai-single.json` 作为竞彩单关核对结果入口;当前以中国竞彩网足球赛果开奖页的“仅显示胜平负单固场次”口径记录来源,未伪造单关匹配。
  - 弹框支持「模型共识」和「单模型」两种来源:模型共识批量展示范围内每场的胜平负票型和热门比分,单模型批量展示该模型对范围内每场的胜平负与比分。
  - 选择不同模型会生成不同调性的趣味复制文案,确认按钮优先调用剪贴板 API,失败时自动选中文案供手动复制。
  - 弹框来源文案更新为「模型共识 / 单模型」;选择模型共识时隐藏模型下拉框,并去掉顶部说明和共识口径说明块。
  - 单模型列表按赛果榜胜平负命中率从高到低排序,并隐藏结果区里的「模型风格」说明块。
  - 优化比赛页日期、简约模式和一键烤啤按钮层级:日期改为更轻的横向胶囊,工具区改为开关 + 主操作按钮,弹框范围/来源改为分段控件,复制区主次按钮更清晰。
  - 窄屏下烤啤结果行改为单列保护,避免队名或比分贴边被裁切。
- 2026-06-16 圆桌文本完整显示修复:
  - 全屏激辩回放移除逐字打字机渲染,消息气泡出现时直接显示完整发言,避免长句看起来只显示半截。
  - 圆桌摘要与回放气泡补强换行样式,长模型名、英文 token、比分串和长中文句都允许在容器内换行。
  - `pipeline/discuss.js` 不再把超过软限制的模型发言硬截成 `…`;`pipeline/append-discussion-models.js` 也取消 120 字静默截断。
  - 本次未改写 `public/data/discussions.json` 的既有 `messages`,已封盘的历史半截文本保持原存证。
- 2026-06-16 页签内容预加载:
  - `initRevealMotion()` 改为渲染后立即给所有页签卡片加 `is-visible`,避免隐藏页签切换后还要等滚动触发才显示内容。
  - `public/index.html` bump `app.js` 版本到 `20260616-preload-tabs`,确保浏览器刷新后立即加载新逻辑。
- 2026-06-16 小组积分表移动端适配:
  - 修复「赛程出线」小组表在手机宽度下需要横向滚动才能看到积分的问题,现在 `分` 列会直接显示在一屏内。
  - `public/index.html` bump `styles.css` 版本到 `20260616-standings-fit`,确保刷新后立即加载新版积分表样式。
- 2026-06-16 圆桌/赛程/比赛页签细节:
  - 首屏「AI 圆桌热评」金句从 1 行扩为 2 行,给热评多留一行内容空间。
  - 圆桌胜平负立场条数字修正行高,避免数字视觉偏下。
  - 小组积分表数字列统一居中,「分」表头与下方积分对齐。
  - 点击「比赛」页签时自动重选当前应展示的比赛日:当天还有未完赛/未过结算宽限的比赛则选今天,否则跳到下一比赛日。
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
- 比赛页「一键烤啤」已接入竞彩单关核对数据:
  - `public/data/jingcai-single.json` 按中国竞彩网足球赛果开奖页“仅显示胜平负单固场次”口径核对了 2026-06-14 至 2026-06-16。
  - 官方核对到 4 场世界杯单关:6/14 巴西-摩洛哥、澳大利亚-土耳其;6/15 荷兰-日本、瑞典-突尼斯;6/16 暂无单关。
  - 前端弹框已区分“官方单关场数”和“可生成文案场数”:6/14 官方 2 场,其中 1 场暂无模型预测,可生成 1 场;6/15 官方 2 场且可生成 2 场;6/16 官方 0 场。
  - 已验证“多数派”和“单模型”两条生成路径均可在竞彩单关范围下工作。
- 自动圆桌节点已串入竞彩单关:
  - 新增 `pipeline/sync-jingcai-single.js` 与 `npm run sync:jingcai`,用于按中国竞彩网单固口径同步 `public/data/jingcai-single.json`。
  - `pipeline/auto-roundtable.js` 在生成圆桌前会 best-effort 同步竞彩单关,失败只报警,不阻塞圆桌生成和发布。
  - 自动同步只新增或更新核对到的单关记录,不会因为官网空返回或解析异常批量删除已有记录。
- 修正圆桌预测方向与比分主客顺序:
  - 未完赛的法国 vs 塞内加尔、伊拉克 vs 挪威中 3 条方向/比分冲突最终发言已改成明确 `结论:方向,比分主队-客队` 格式。
  - `public/app.js`、`pipeline/score.js`、`pipeline/recap.js` 统一解析 `主负`、`闷平`,并避免把带问号的反驳词误判为最终立场。
  - `pipeline/discuss.js` 与 `append-discussion-models.js` 增加最终发言校验:方向必须和比分胜负关系一致,比分始终按主队在前书写。
  - 已按作者确认将比利时 vs 埃及 Grok 4.3 的客胜比分从 `1-0` 修正为 `0-1`;其余已完赛存证消息不改写。
  - 新增 `pipeline/validate-predictions.js` / `npm run validate:predictions`,自动扫描结构化预测和圆桌最终预测;`publish:settle`、`publish:roundtable` 会在 commit 前执行该校验,有冲突则中止发布。
- 修复 6/17 一键烤啤竞彩单关核对:
  - `pipeline/sync-jingcai-single.js` 新增中国竞彩网竞彩足球赛前列表接口,按胜平负 `HAD` 玩法的 `cbtSingle=1` 识别单固场次;原赛果开奖接口继续用于已完赛核对。
  - 已同步 `public/data/jingcai-single.json`:6/17 官方胜平负单固 2 场,分别为法国-塞内加尔、奥地利-约旦。
  - 已验证 `npm run sync:jingcai -- --date 2026-06-17 --dry-run --strict` 可返回 `officialRows=2 mapped=2`,且 `npm run validate:predictions` 通过。

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
