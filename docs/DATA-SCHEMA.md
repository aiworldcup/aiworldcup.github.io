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
  "predictions": [
    {
      "modelId": "gpt-5",
      "team": "阿根廷",
      "flag": "AR",
      "confidence": 18,
      "reasoning": "一句话理由"
    }
  ]
}
```

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
