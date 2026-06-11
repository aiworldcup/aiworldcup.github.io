# 文件结构

```
worldcup-ai-arena/
├── CLAUDE.md                  # 总规格(已写好,先读它)
├── .claude/
│   └── settings.local.json    # 权限配置(已放行项目内操作)
├── .env.example               # 环境变量模板(真实 key 作者填 .env)
├── .gitignore
├── package.json               # Node 脚本入口:predict / score / serve
├── README.md                  # 面向人类的项目说明
│
├── public/                    # 静态站点根目录(部署即指向这里)
│   ├── index.html             # 首页 = 排行榜 + 比赛列表
│   ├── styles.css             # 移动端优先样式
│   ├── app.js                 # 前端逻辑:fetch JSON、渲染排行榜与比赛卡
│   └── data/
│       ├── models.json        # 参赛模型清单(名字/厂商/logo色)
│       ├── matches.json       # 比赛 + 赔率 + 各模型预测(封盘后的真数据)
│       ├── sample-matches.json# 假数据,用于先跑通前端
│       └── leaderboard.json   # 计算好的排行榜(由 pipeline 生成)
│
├── pipeline/                  # 数据管线(Node 脚本,手动跑)
│   ├── config.js              # 下注上限、API base、超时等配置
│   ├── odds.js                # 赔率 API 适配层(预留,读 .env)
│   ├── predict.js             # 调各大模型 API,生成封盘预测
│   ├── prompts.js             # 统一 prompt 模板
│   ├── score.js               # 按真实赛果+赔率结算,生成 leaderboard.json
│   └── lib/
│       ├── env.js             # 轻量 .env 读取(不引入依赖)
│       └── seal.js            # 封盘:加时间戳 + 内容哈希,写入存证
│
└── docs/
    ├── STRUCTURE.md           # 本文件
    ├── MODELS.md              # 要接入的 10+ 模型清单与接入方式
    ├── DATA-SCHEMA.md         # 所有 JSON 的字段定义
    ├── TASKS.md               # 执行清单(按序勾选)
    └── PROGRESS.md            # 执行 AI 完成后填写
```

## 数据流

```
赔率API ──odds.js──┐
                   ├─→ predict.js ─→ seal.js ─→ matches.json (封盘存证)
模型API ──────────┘                                    │
                                                       ▼
真实赛果(人工/API录入) ──→ score.js ──→ leaderboard.json ──→ 前端展示
```

## 部署目标

- `public/` 为根,可直接丢 GitHub Pages / Vercel / Netlify。
- 移动端优先:任何页面在手机竖屏下单列可读、可点。
