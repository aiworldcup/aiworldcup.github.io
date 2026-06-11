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
          "track": "blind",
          "result": "home",
          "score": "2-1",
          "stake": { "result": 60, "score": 40 },
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
- `track`: `"blind"`(裸考) 或 `"open"`(开卷)。同一模型两条赛道各一条预测。
- `stake`: 该场 100 积分的分配,`result + score` 之和 ≤ 每场上限(默认 100)。
- `result`: `"home"` / `"draw"` / `"away"`。
- `score`: 形如 `"2-1"`(主-客)。
- `actual`: 赛后填,未开赛为 `null`。

## leaderboard.json — 排行榜(由 score.js 生成)

```json
{
  "updatedAt": "2026-06-12T00:00:00Z",
  "blind": [
    { "rank": 1, "modelId": "gpt-5", "points": 1340, "hits": 5, "played": 8 }
  ],
  "open": [
    { "rank": 1, "modelId": "claude", "points": 1580, "hits": 6, "played": 8 }
  ]
}
```

## 结算逻辑 (score.js)

对每场每预测:
- 命中胜平负:`+ stake.result × odds.result[选项]`,否则该部分归零。
- 命中比分:`+ stake.score × odds.scores[比分]`,否则归零。
- 未押(stake=0)不计盈亏。
- 该场所得累加到对应赛道的累计积分。
- `hits` = 胜平负命中场次;`played` = 已结算场次。
