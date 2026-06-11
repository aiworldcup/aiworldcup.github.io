# 执行清单 (TASKS)

> 按顺序做,每完成一项把 `[ ]` 改成 `[x]`。先读 CLAUDE.md / STRUCTURE.md / MODELS.md / DATA-SCHEMA.md。

## 阶段 0:打底
- [x] 写 `.gitignore`(忽略 `.env`、`node_modules`、`.DS_Store`)
- [x] 写 `.env.example`(列出各模型 key 和赔率 API key 的占位变量名,**不写真实值**)
- [x] 写 `README.md`(人类视角:项目是什么、怎么本地预览、怎么部署)
- [x] `git init` 并首次 commit

## 阶段 1:假数据 + 前端跑通(优先级最高)
- [x] 写 `public/data/models.json`,放 ≥10 个模型
- [x] 写 `public/data/sample-matches.json`,造 3~4 场比赛假数据,含赔率、每个模型在两条赛道的预测,其中 1~2 场带 `actual` 赛果
- [x] 写 `public/data/leaderboard.json`(可先手算或用 score.js 生成)
- [x] 写 `public/index.html`:移动端优先,含①赛道切换(裸考/开卷)②排行榜③比赛卡片列表
- [x] 写 `public/styles.css`:响应式、单列、大字号、触摸友好;深色背景擂台风
- [x] 写 `public/app.js`:fetch 数据(失败时回退到 sample-matches.json)、渲染排行榜与比赛卡、赛道切换交互
- [x] 本地用 `python3 -m http.server` 或 `npx serve public` 验证页面能打开、手机宽度正常

## 阶段 2:数据管线(能跑通即可,真实 key 等作者填)
- [x] 写 `pipeline/prompts.js`:裸考/开卷两套统一 prompt 模板,要求模型输出结构化 JSON
- [x] 写 `pipeline/odds.js`:赔率 API 适配层,读 `.env`;缺 key 时返回 sample 数据并打日志
- [x] 写 `pipeline/lib/seal.js`:对预测内容算 sha256 哈希 + 打时间戳
- [x] 写 `pipeline/predict.js`:遍历 enabled 模型,两条赛道各调一次,封盘写入 matches.json;缺 key 的模型跳过并提示
- [x] 写 `pipeline/score.js`:读 matches.json 的 actual + odds,按 DATA-SCHEMA 结算,生成 leaderboard.json
- [x] `package.json` 加 scripts:`predict` / `score` / `serve`

## 阶段 3:收尾
- [x] 用 sample 数据端到端验证一次 score.js 产出的 leaderboard 正确
- [x] 在 `docs/PROGRESS.md` 写:完成了什么、怎么本地预览、还差什么(尤其哪些等作者填 key)
- [x] 最后一次 commit

## 红线(绝对不要做)
- ❌ 不 `git push`
- ❌ 不把任何真实 API key 写进代码或提交
- ❌ 不做颜值/分布图/留言区(那是第二版)
- ❌ 不删作者已有文件
- ❌ 不引入重型构建工具(保持打开 index.html 就能看)
