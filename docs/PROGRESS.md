# 进度记录

更新时间: 2026-06-11

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
- 前端新增北京时间日期切换、空日期预告态和冠军预测模块。

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
npm run score
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
- 最后一次 commit 尚未执行。
