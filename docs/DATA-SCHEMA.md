# 数据结构定义 (JSON Schema)

所有数据落在 `public/data/`。字段如下。

## models.json — 参赛模型清单

```json
{
  "models": [
    {
      "id": "gpt-5",
      "name": "GPT-5",
      "vendor": "OpenAI",
      "color": "#10a37f",
      "enabled": true
    }
  ]
}
```

## matches.json / sample-matches.json — 比赛 + 赔率 + 预测

```json
{
  "matches": [
    {
      "id": "wc2026-m01",
      "stage": "小组赛 A组",
      "kickoff": "2026-06-11T20:00:00Z",
      "home": { "team": "墨西哥", "flag": "🇲🇽" },
      "away": { "team": "波兰", "flag": "🇵🇱" },
      "odds": {
        "result": { "home": 2.10, "draw": 3.30, "away": 3.50 },
        "scores": {
          "1-0": 7.5, "2-0": 9.0, "2-1": 8.0,
          "0-0": 8.5, "1-1": 6.0,
          "0-1": 11.0, "0-2": 15.0, "1-2": 10.0
        }
      },
      "sealedAt": "2026-06-11T18:00:00Z",
      "predictions": [
        {
          "modelId": "gpt-5",
          "track": "open",
          "result": "home",
          "score": "2-1",
          "reasoning": "一句话理由(可选展示)",
          "timestamp": "2026-06-11T18:00:00Z",
          "hash": "sha256:..."
        }
      ],
      "marketEdge": {
        "modelProbabilities": { "home": 0.45, "draw": 0.27, "away": 0.28 },
        "valueSide": "主胜被低估",
        "confidence": "B",
        "riskLevel": "中",
        "suggestion": "主胜方向有模型价值,但需等待首发确认。"
      },
      "actual": { "result": "home", "score": "2-1" }
    }
  ]
}
```

字段说明:
- `track`: 当前统一使用 `"open"`;前端只展示这一版预测。
- `result`: `"home"` / `"draw"` / `"away"`。
- `score`: 形如 `"2-1"`(主-客)。
- `actual`: 赛后填,未开赛为 `null`。
- `marketEdge`: 可选。盘口博弈指数的结构化补充。核心口径是“模型公平概率/公平赔率 vs 市场归一概率/真实赔率”。如果缺失,前端会用封盘预测或圆桌最终预测聚合模型概率,再和 `odds.result` 计算 EV、概率差、风险和观望/价值方向。

### market edge — 盘口博弈指数

盘口博弈指数只用于比赛卡内容展示,不参与排行榜结算,也不恢复下注、积分或赔率结算旧规则。

- 盘口博弈先计算模型概率,再转换公平赔率: `fairOdds = 1 / modelProbability`。
- 市场概率必须先从真实赔率转隐含概率,再归一化扣除水钱:`marketProbability = (1 / marketOdds) / sum(1 / allMarketOdds)`。
- 价值判断参考:EV > 8% 且概率差 > 5% 为明显价值方向;EV 3%-8% 为轻微价值方向;差距不足时展示“观望”。页面文案必须保持风险表达,不要写成确定性投注建议。

## match-insights.json — 盘口博弈指数

`public/data/match-insights.json` 是盘口博弈指数的正式落地数据。它是 sidecar 文件,不改写 `matches.json` 的已完赛 `actual` 和 `discussions.json` 的封盘 `messages`。

生成命令:

```bash
npm run insights
```

发布前校验:

```bash
npm run validate:insights
```

结构:

```json
{
  "version": 1,
  "updatedAt": "2026-06-23T10:55:22.754Z",
  "source": {
    "matchesPath": "public/data/matches.json",
    "discussionsPath": "public/data/discussions.json",
    "rule": "盘口博弈指数仅用于展示:模型概率 vs 市场归一概率,不参与排行榜结算。"
  },
  "summary": {
    "targetMatches": 104,
    "totalMatches": 104,
    "counts": {
      "strong-value": 25,
      "light-value": 4,
      "watch": 30,
      "missing-odds": 45
    },
    "valueDirections": [
      {
        "matchId": "fixture-1489369",
        "valueSide": "平局被低估",
        "ev": 1.2524,
        "probabilityDiff": 0.3043
      }
    ]
  },
  "matches": [
    {
      "matchId": "fixture-1489369",
      "generatedAt": "2026-06-23T10:55:22.754Z",
      "source": {
        "predictionSource": "discussion",
        "predictionCount": 9,
        "oddsProvider": null,
        "oddsSyncedAt": null,
        "actualStatus": "settled"
      },
      "marketEdge": {
        "status": "strong-value",
        "direction": "平局",
        "valueSide": "平局被低估",
        "shortLabel": "平局被低估",
        "confidence": "A-",
        "riskLevel": "中高",
        "marketDirection": "市场更看好主胜",
        "sourceLabel": "模型共识 9 票",
        "modelProbabilities": { "home": 0.3333, "draw": 0.5238, "away": 0.1429 },
        "marketProbabilities": { "home": 0.6744, "draw": 0.2196, "away": 0.1061 },
        "primary": {
          "key": "draw",
          "label": "平局",
          "marketOdds": 4.3,
          "fairOdds": 1.9091,
          "ev": 1.2524,
          "diff": 0.3043
        },
        "rows": [
          {
            "key": "draw",
            "label": "平局",
            "modelProbability": 0.5238,
            "marketProbability": 0.2196,
            "marketOdds": 4.3,
            "fairOdds": 1.9091,
            "ev": 1.2524,
            "diff": 0.3043
          }
        ]
      }
    }
  ]
}
```

字段说明:
- `marketEdge.status`: `strong-value` / `light-value` / `watch` / `missing-odds`。
- `missing-odds` 不代表没有同步策略,而是当前没有可校验的完整真实胜平负盘口。页面按场景显示为“暂无真实盘口”“历史盘口缺失”或“盘口未开”,并保持观望。
- `odds.provider`: `sporttery` 为中国竞彩网 HAD,`espn-draftkings` 为 ESPN public scoreboard 中 DraftKings moneyline 转 decimal 后的无 key 欧赔格式源。
- `marketEdge.primary`: 当前最有价差的一侧;`watch` 时也保留最高 EV 一侧,但页面只展示观望。
- `marketEdge.rows`: 主胜、平局、客胜三行完整明细,包含模型概率、市场归一概率、公平赔率、市场赔率、EV 和概率差。
- 前端优先读取 `match-insights.json`;若该文件缺失或某场缺记录,才用浏览器端同一套公式即时派生。
- `pipeline/auto-publish.js` 会在 `publish:settle` / `publish:roundtable` 中自动运行 `npm run insights` 和 `npm run validate:insights`。

## leaderboard.json — 排行榜(由 score.js 生成)

```json
{
  "updatedAt": "2026-06-12T00:00:00Z",
  "settlement": {
    "rule": "match.actual 存在即结算;开赛后 150 分钟仍无 actual 则进入 pending_result 队列",
    "generatedAt": "2026-06-12T00:00:00Z",
    "graceMinutes": 150,
    "scoring": "赛果榜按胜平负命中率排序;比分榜按具体比分命中数排序。不再使用下注、积分或赔率结算。",
    "counts": { "settled": 1, "pending_result": 1, "sealed": 2 },
    "pendingResult": [
      { "matchId": "fixture-1489369", "kickoff": "2026-06-11T19:00:00+00:00", "home": "墨西哥", "away": "南非" }
    ],
    "nextAction": "同步或录入真实赛果后运行 npm run score"
  },
  "resultRankings": [
    {
      "rank": 1,
      "modelId": "claude",
      "predictions": 8,
      "resultHits": 6,
      "scoreHits": 1,
      "played": 8,
      "resultHitRate": 0.75,
      "scoreHitRate": 0.125
    }
  ],
  "scoreRankings": [
    {
      "rank": 1,
      "modelId": "claude",
      "predictions": 8,
      "resultHits": 6,
      "scoreHits": 1,
      "played": 8,
      "resultHitRate": 0.75,
      "scoreHitRate": 0.125
    }
  ]
}
```

## 结算逻辑 (score.js)

- 赛果榜:按 `resultHitRate` 排序,再按 `resultHits`、`predictions`、`scoreHits` 破同分。
- 比分榜:按 `scoreHits` 排序,再按 `scoreHitRate`、`resultHits`、`predictions` 破同分。
- `predictions` = 有预测且已结算的场次;`played` 为兼容旧字段,等同于 `predictions`。
- 不再使用下注、积分、赔率结算。赔率仍可作为赛前信息展示。
- 结算触发:只要 `match.actual` 存在,`score.js` 就结算;开赛后 `SETTLEMENT_GRACE_MINUTES`(默认 150)仍无 `actual`,该场进入 `settlement.pendingResult` 队列,页面展示“待赛果结算”。
- 推荐赛后入口:`npm run settle`。它会先同步真实赛程/赛果并保留已有预测/封盘信息,再生成 `leaderboard.json`。

## champion-predictions.json — 冠军预测

```json
{
  "updatedAt": "2026-06-11T18:00:00Z",
  "mode": "derived",
  "note": "冠军雷达由小组赛果、淘汰赛存活状态、下一场赔率/对手强度和项目内强队基准派生。",
  "source": {
    "matches": 104,
    "qualifiedTeams": 32,
    "aliveTeams": 31,
    "settledKnockout": 1
  },
  "highlights": {
    "favorite": { "label": "最大热门", "team": "阿根廷", "flag": "AR", "score": 91.4, "hook": "一句话钩子" },
    "darkHorse": { "label": "黑马剧本", "team": "挪威", "flag": "NO", "score": 69.9, "hook": "一句话钩子" },
    "jinxRisk": { "label": "毒奶高危", "team": "法国", "flag": "FR", "score": 90.1, "hook": "一句话钩子" }
  },
  "teams": [
    {
      "team": "阿根廷",
      "flag": "AR",
      "rank": 1,
      "status": "alive",
      "qualification": "小组第一",
      "group": { "name": "J", "rank": 1, "points": 9, "record": "3-0-0", "gf": 8, "ga": 1, "gd": 7 },
      "scores": { "total": 91.4, "form": 99, "strength": 97, "path": 80, "fun": 76 },
      "tags": ["小组赛满血", "不败金身", "火力怪"],
      "badges": ["小组赛满血", "不败金身", "火力怪"],
      "reason": "小组第一9分,净胜+7,硬实力97,路径80,下一场对佛得角",
      "script": "一路稳得像提前看了剧本,问题是别被热度奶晕。",
      "nextMatch": { "status": "scheduled", "matchId": "wc2026-ko-15", "stageShort": "32 强", "dateKey": "2026-07-04", "opponent": "佛得角", "winChance": null }
    }
  ],
  "predictions": [
    {
      "modelId": "gpt-5",
      "team": "阿根廷",
      "flag": "AR",
      "confidence": 18,
      "reasoning": "一句话理由"
    }
  ],
  "gauntlet": {
    "updatedAt": "2026-06-29T10:25:38.455Z",
    "mode": "real-model",
    "note": "AI 冠军毒圈圆桌: 0 活口永久出局,出局后只能场边发言。",
    "rounds": [
      {
        "roundId": "round32",
        "label": "32 强毒圈",
        "status": "open",
        "candidateTeams": [
          { "team": "巴西", "flag": "BR", "matchId": "wc2026-ko-02", "opponent": "日本" }
        ],
        "summary": { "aliveModels": 11, "eliminatedModels": 0, "issueModels": 1, "totalPicks": 33, "topTeams": [] },
        "entries": [
          {
            "modelId": "gpt-5-5",
            "status": "alive",
            "allowedPicks": 3,
            "picks": [{ "team": "阿根廷", "flag": "AR", "matchId": "wc2026-ko-15" }],
            "alivePicks": [],
            "eliminatedPicks": [],
            "line": "一句中文理由",
            "issues": []
          }
        ]
      }
    ]
  }
}
```

- `teams`:由 `pipeline/champion.js` 生成的冠军雷达候选。`scores.form` 是出线姿态,`scores.strength` 是项目内球队强度基准叠加当前状态,`scores.path` 优先使用下一场赔率,缺赔率时用对手强度估算,`scores.fun` 是传播/剧情标签分。
- `predictions`:保留给真实模型冠军封盘选择;当前可为空数组,前端仍展示 `teams` 雷达。
- `gauntlet`:冠军毒圈圆桌。`round32` 首轮跳过已完赛 `wc2026-ko-01`,每个仍有资格的模型固定 3 选;后续轮次的 `allowedPicks` 等于上一整轮 `alivePicks.length`。`status=issue` 表示真实调用失败、空返回或格式无效,不得用合成票替代。
- `gauntlet.rounds[].entries[].picks`:封盘后不可改写的该轮真实模型选择。整轮赛果齐全后,结算脚本只填充 `alivePicks`、`eliminatedPicks`、`status` 和结算时间。

## discussions.json — AI 圆桌群聊

```json
{
  "updatedAt": "2026-06-11T18:00:00Z",
  "mode": "pipeline",
  "note": "由 pipeline/discuss.js 生成。",
  "discussions": [
    {
      "matchId": "fixture-1489369",
      "sealedAt": "2026-06-11T18:00:00Z",
      "messages": [
        {
          "modelId": "gpt-5-5",
          "modelName": "GPT-5.5",
          "vendor": "OpenAI",
          "turn": 1,
          "text": "两句中文短评。",
          "timestamp": "2026-06-11T18:00:00Z"
        }
      ]
    }
  ]
}
```

字段说明:
- `matchId`: 对应 `matches.json` 的比赛 ID。
- `sealedAt`: 这场圆桌讨论的封盘时间。
- `messages`: 每条消息来自对应模型 API;默认每个模型生成一条气泡,内容要求两句短评。
- 每个模型最后一次发言必须包含预测方向和具体比分;前端会从最后发言提取比赛卡里的模型倾向和热门比分。
- 没有模型 key 时保持空数组,前端展示“讨论待生成”,不使用模拟发言。
