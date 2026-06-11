# 进度记录

更新时间: 2026-06-12

## 已完成

- 保留并校验已有移动端静态前端:`public/index.html`、`public/styles.css`、`public/app.js`。
- 补齐 `public/data/sample-matches.json`:3 场示例比赛、10 个模型、统一预测版本,其中 2 场带 `actual` 用于结算验证。
- 使用 `pipeline/score.js` 重新生成 `public/data/leaderboard.json`,rank 与 points 顺序一致。
- 新增数据管线:
  - `pipeline/prompts.js`:统一 prompt,强制 JSON 输出。
  - `pipeline/odds.js`:复用 football 项目的 API-SPORTS 约定,通过 `ODDS_API_KEY`/`APISPORTS_API_KEY` 调 `/fixtures` 和 `/odds`;缺 key 或缺日期时回退 sample。
  - `pipeline/lib/seal.js`:稳定 JSON 哈希与封盘时间戳。
  - `pipeline/predict.js`:遍历 enabled 模型预测,缺 key 自动跳过;没有任何模型 key 时不覆盖 `matches.json`。
  - `pipeline/score.js`:按真实赔率结算胜平负和比分下注,生成排行榜。
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
  - 排行榜升级为积分面板,展示积分、胜率、比分命中率、均分和待结算预测。
- 补强结算逻辑:
  - `score.js` 输出 `settlement` 摘要;`actual` 存在即结算,开赛后默认 150 分钟仍无赛果则进入 `pending_result`。
  - 结算改为累计账户余额:每场已结算比赛先给每个启用模型发 100 基础积分,下注从累计余额扣,命中按赔率返还,排行榜按累计余额排序。
  - 下注上限拆分为胜平负最多 200、比分最多 100、总下注默认 300,预测 prompt、归一化和结算全部按此口径裁剪。
  - 新增 `npm run settle`,先同步真实赛程/赛果并保留已有预测与封盘信息,再生成排行榜。
  - `sync-real-data.js` 现在合并已有比赛数据,不会把封盘预测冲掉。

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
