# Champion Gauntlet Design

Date: 2026-06-29

## Goal

Add a real model-called "AI 冠军毒圈圆桌" to the champion page. The feature turns champion prediction into a survival game across knockout rounds:

- Every enabled AI model participates through real API calls.
- Models pick champion candidates before each knockout round.
- Picks only stay useful if those teams advance.
- A model with zero surviving picks is permanently eliminated from champion guessing.
- Eliminated models remain visible and can only contribute sideline lines such as encouragement, excuses, or sarcastic commentary.

The experience should feel serious enough to trust and sharp enough to share.

## Core Rules

The gauntlet uses whole-round settlement, not per-match settlement.

### Round Cadence

The supported round IDs are:

- `round32`
- `round16`
- `quarterfinal`
- `semifinal`
- `final`

Each round has three possible states:

- `open`: not all eligible model calls have succeeded yet.
- `locked`: picks are generated and public; the round is waiting for match results.
- `settled`: all matches in the round are resolved and survival has been calculated.

### Pick Counts

Initial round:

- `round32`: each alive model must pick exactly 3 teams.
- The already-played `南非 vs 加拿大` Round of 32 match is excluded from the initial candidate pool.
- Canada may become selectable from `round16` onward if it remains alive.

Later rounds:

- A model's allowed pick count equals its number of surviving picks from the previous settled round.
- No extra cap is applied. If a model carries 3 live teams, it keeps 3 picks.
- If a model carries 1 live team, it gets 1 pick.
- If a model carries 0 live teams, it is permanently eliminated.

This gives models credit for early accuracy without creating an artificial comeback rule.

### Hedge Restriction

Models may not pick both teams from the same match in the same round.

Example:

- `巴西` and `日本` cannot both appear in the same `round32` pick list.

This prevents mechanical hedging from draining the poison-ring tension.

### Elimination

A model becomes `eliminated` when one settled round leaves it with zero surviving picks.

After elimination:

- It cannot submit picks in any later round.
- It still receives a prompt each round.
- It must return only one sideline line.
- The line can be supportive, self-mocking, salty, or sarcastic, but must not contain new picks.

### Issues

No synthetic picks are allowed.

If a model call fails, times out, returns invalid JSON, selects too many or too few teams, selects a team outside the pool, or violates the same-match hedge restriction:

- Record an `issue`.
- Keep the entry visible.
- Do not invent replacement picks.
- Allow missing or invalid model entries to be rerun later with a missing-only repair command.

## Data Model

Extend `public/data/champion-predictions.json` with a `gauntlet` object. Existing `teams`, `highlights`, and `predictions` remain compatible.

```json
{
  "gauntlet": {
    "updatedAt": "2026-06-29T09:00:00.000Z",
    "mode": "real-model",
    "note": "AI 冠军毒圈圆桌: 0 活口永久出局, 出局后只能场边发言。",
    "rounds": [
      {
        "roundId": "round32",
        "label": "32 强毒圈",
        "status": "locked",
        "startedAt": "2026-06-29T09:00:00.000Z",
        "lockedAt": "2026-06-29T09:05:00.000Z",
        "settledAt": null,
        "pickCountRule": {
          "type": "fixed",
          "count": 3,
          "description": "首轮剩余 15 场 30 队, 每个 AI 固定 3 票。"
        },
        "candidateTeams": [
          { "team": "巴西", "flag": "BR", "matchId": "wc2026-ko-02", "opponent": "日本" },
          { "team": "德国", "flag": "DE", "matchId": "wc2026-ko-03", "opponent": "巴拉圭" },
          { "team": "摩洛哥", "flag": "MA", "matchId": "wc2026-ko-04", "opponent": "荷兰" }
        ],
        "excludedMatches": [
          { "matchId": "wc2026-ko-01", "reason": "已完赛, 初始毒圈跳过" }
        ],
        "summary": {
          "aliveModels": 12,
          "eliminatedModels": 0,
          "issueModels": 0,
          "totalPicks": 36,
          "topTeams": [
            { "team": "巴西", "flag": "BR", "votes": 1, "modelIds": ["gpt-5-5"] }
          ]
        },
        "entries": [
          {
            "modelId": "gpt-5-5",
            "modelName": "GPT-5.5",
            "vendor": "OpenAI",
            "status": "alive",
            "allowedPicks": 3,
            "picks": [
              { "team": "巴西", "flag": "BR", "matchId": "wc2026-ko-02" },
              { "team": "德国", "flag": "DE", "matchId": "wc2026-ko-03" },
              { "team": "摩洛哥", "flag": "MA", "matchId": "wc2026-ko-04" }
            ],
            "alivePicks": [],
            "eliminatedPicks": [],
            "line": "巴西是主仓, 德国是效率仓, 摩洛哥是黑马仓。",
            "calledAt": "2026-06-29T09:01:00.000Z",
            "durationMs": 15420,
            "issues": []
          }
        ]
      }
    ]
  }
}
```

Notes:

- `candidateTeams` is frozen when a round is generated.
- `entries[].picks` is frozen after a valid call.
- Settlement only fills `alivePicks`, `eliminatedPicks`, `status`, `settledAt`, and summary fields.
- Existing sealed match results and discussion messages are never rewritten.

## Pipeline

Add a champion gauntlet pipeline, preferably in a focused module:

- `pipeline/champion-gauntlet.js`
- `pipeline/champion-gauntlet.test.js`

Add scripts:

- `npm run champion:gauntlet -- --round round32`
- `npm run champion:gauntlet:settle -- --round round32`
- Optional repair: `npm run champion:gauntlet -- --round round32 --missing-only`

### Generation Flow

For each requested round:

1. Load `matches.json`, `models.json`, and `champion-predictions.json`.
2. Resolve candidate teams for the round.
3. Resolve each model's status from the previous settled round.
4. For alive models:
   - Compute `allowedPicks`.
   - Call the model with the same prompt and candidate pool.
   - Require structured JSON with exactly `allowedPicks` teams and one line.
5. For eliminated models:
   - Call the model with a sideline prompt.
   - Require structured JSON with a line and no picks.
6. Validate all outputs.
7. Write valid entries and issues into `gauntlet.rounds[]`.

### Settlement Flow

For a locked round:

1. Confirm all matches in that round have `actual`.
2. Compute winners.
3. For each model entry:
   - `alivePicks` = picks whose team advanced.
   - `eliminatedPicks` = picks whose team did not advance.
   - If `alivePicks.length > 0`, keep the model alive.
   - If `alivePicks.length === 0`, mark it eliminated.
4. Update round summary.
5. Do not generate next-round picks automatically unless explicitly requested.

## Prompt Contract

Alive-model prompt requirements:

- Explain the poison-ring rule.
- Include allowed pick count.
- Include candidate teams grouped by match.
- Include current champion radar facts: rank, scores, tags, next opponent, and odds-derived win chance when available.
- Forbid selecting both teams from the same match.
- Require short Chinese output.

Expected JSON:

```json
{
  "picks": ["巴西", "德国", "阿根廷"],
  "line": "巴西稳仓, 德国顺风, 阿根廷是冠军相但别太早开香槟。"
}
```

Eliminated-model prompt requirements:

- Tell the model it is eliminated from champion guessing.
- Ask for one sideline line only.
- Forbid picks.
- Encourage personality: self-mocking, salty, supportive, or sarcastic.

Expected JSON:

```json
{
  "line": "我已经出圈了, 但法国这火力看着像要把我尸体也补一脚。"
}
```

## Page Design

Add an "AI 冠军毒圈" section inside `#champion-section`, above the existing champion radar board.

### Top Summary

Show compact stats:

- Current round label.
- Alive model count.
- Eliminated model count.
- Total active picks.
- Hottest team.

### Round Switcher

Show tabs for rounds that exist in `gauntlet.rounds[]`.

If only `round32` exists, show one active pill and avoid empty future tabs.

### AI View

Default mobile view: one card per model.

Alive model card:

- Model color dot and name.
- Status: `毒圈内`.
- Allowed picks.
- Pick chips with team flags.
- One-line model quote.
- After settlement: alive picks and dead picks are visually separated.

Eliminated model card:

- Dimmed card.
- Status: `已出局`.
- Sideline line.
- Last alive round if available.

Issue card:

- Status such as `API 超时`, `格式无效`, or `禁止同场双押`.
- No fake picks.

### Team Vote View

Below or beside AI cards, show team vote clusters:

- Team flag/name.
- Vote count.
- Model chips for models that picked the team.
- Match opponent and round context.

This makes "谁怎么投" visible, not just aggregate counts.

## Error Handling

Issue labels:

- `timeout`: API 超时
- `missing_key`: 未配置 key
- `empty`: 空返回
- `invalid_json`: JSON 无效
- `invalid_count`: 票数不符
- `unknown_team`: 队名不在候选池
- `same_match_hedge`: 同场双押
- `eliminated_with_picks`: 出局模型违规给 picks
- `alive_without_picks`: 存活模型未给 picks

The page should display these directly, matching the existing roundtable issue philosophy.

## Tests

Core tests:

- `round32` candidate pool excludes `wc2026-ko-01` and contains 30 teams.
- Initial allowed pick count is 3 for all enabled alive models.
- Same-match hedge is rejected.
- Unknown team is rejected.
- Later-round allowed pick count equals previous `alivePicks.length`.
- Zero alive picks eliminates a model permanently.
- Eliminated model output with picks is invalid.
- Settlement computes alive and eliminated picks from match results.
- Existing `teams` champion radar data is preserved when gauntlet updates.

## Publishing

Publishing remains GitHub Pages through `public/`.

Before publishing:

- `node pipeline/champion-gauntlet.test.js`
- `node pipeline/champion.test.js`
- `node pipeline/knockout.test.js`
- `npm run validate:predictions`
- `npm run validate:results`
- `npm run validate:insights`
- `node --check public/app-load-smooth.js`

## Out Of Scope For First Build

- User voting.
- Betting points or old odds settlement.
- Automatic next-round generation during settlement.
- Retrying every model when only one model failed.
- Restoring eliminated models.
