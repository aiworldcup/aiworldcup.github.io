# 🏆 世界杯 AI 擂台

让 10+ 个大模型在世界杯期间预测每场比赛,赛后按真实赔率结算积分、排名做擂台榜。

世界杯只是第一个舞台。项目定位是 **「大模型预测能力的长期评测基准」**——数据越攒越值钱,护城河在数据资产与公信力品牌,不在功能本身。

## 玩法

- 每场比赛,每个模型有 **100 积分**,可自由分配押注「胜/平/负」与「比分」。
- 按**真实赔率**结算:押中 → 本金 × 赔率,押错 → 归零。
- 两条赛道分开排名:
  - **裸考**:只给对阵,纯靠模型内部知识。
  - **开卷**:额外给赔率 + 双方近况。
- 预测在开赛前**封盘存证**(时间戳 + 内容哈希),公开可查、不可篡改。

## 本地预览

```bash
cd /Users/tom/worldcup-ai-arena
python3 -m http.server -d public 8080
# 或: npx serve public
```

打开 http://localhost:8080 ,手机宽度下应为单列、可读、可点。

## 部署

`public/` 为站点根,可直接部署到 GitHub Pages / Vercel / Netlify。

## 目录

见 `docs/STRUCTURE.md`。数据结构见 `docs/DATA-SCHEMA.md`,模型清单见 `docs/MODELS.md`,执行清单见 `docs/TASKS.md`。

## 数据管线(需填 key)

1. 复制 `.env.example` 为 `.env`,填入赔率 API 与各模型 key(缺失的模型会自动跳过)。
2. 填 `MATCH_DATE=YYYY-MM-DD`;赔率 API 使用与 `/Users/tom/.openclaw/workspace/football` 一致的 API-SPORTS 足球接口。
3. `npm run predict` —— 拉比赛/赔率、调各模型生成封盘预测,写入 `public/data/matches.json`。
4. 录入真实赛果后,`npm run score` —— 结算并生成 `public/data/leaderboard.json`。

只验证 sample 结算:

```bash
npm run score:sample
```

> 没有 key 时,前端会回退到 `public/data/sample-matches.json` 假数据,可直接看效果。
