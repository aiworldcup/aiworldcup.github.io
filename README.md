# 🏆 世界杯 AI 擂台

让 10+ 个大模型在世界杯期间预测每场比赛,赛后按赛果命中率和比分命中数排名做擂台榜。

世界杯只是第一个舞台。项目定位是 **「大模型预测能力的长期评测基准」**——数据越攒越值钱,护城河在数据资产与公信力品牌,不在功能本身。

## 玩法

- 所有模型拿到同一份对阵、赔率与近况信息,预测胜平负和比分。
- **赛果榜**:统计谁猜中胜/平/负更多、命中率更高。
- **比分榜**:统计谁猜中具体比分更多。
- 预测在开赛前**封盘存证**(时间戳 + 内容哈希),公开可查、不可篡改。

## 本地预览

```bash
cd /Users/tom/worldcup-ai-arena
python3 -m http.server -d public 8080
# 或: npx serve public
```

打开 http://localhost:8080 ,手机宽度下应为单列、可读、可点。

首页支持按北京时间日期切换比赛;没有比赛的日期会展示预告空态。当前真实数据同步 104 个比赛席位:API 已返回的小组赛赛程 + 淘汰赛待定占位。冠军预测模块读取 `public/data/champion-predictions.json`,没有真实模型预测时保持空态。

## 部署

`public/` 为站点根,可直接部署到 GitHub Pages / Vercel / Netlify。

## 目录

见 `docs/STRUCTURE.md`。数据结构见 `docs/DATA-SCHEMA.md`,模型清单见 `docs/MODELS.md`,执行清单见 `docs/TASKS.md`。

## 数据管线(需填 key)

1. 复制 `.env.example` 为 `.env`,填入赔率 API 与各模型 key(缺失的模型会自动跳过)。
2. 填 `MATCH_DATE=YYYY-MM-DD`;赔率 API 使用与 `/Users/tom/.openclaw/workspace/football` 一致的 API-SPORTS 足球接口。
3. `npm run predict` —— 拉比赛/赔率、调各模型生成封盘预测,写入 `public/data/matches.json`。
4. 赛后运行 `npm run settle` —— 同步真实赛果并统计赛果榜/比分榜。

比赛日建议打开轮询:

```bash
npm run settle:watch -- --interval 300 --duration 21600
```

这会每 5 分钟同步一次 API-SPORTS 赛果并重算排行榜,持续 6 小时。适合从开赛前后一直挂到赛后。

只验证 sample 结算:

```bash
npm run score:sample
```

> 没有 key 时,前端会回退到 `public/data/sample-matches.json` 假数据,可直接看效果。
