# Champion Gauntlet Implementation Plan

Date: 2026-06-29

## Objective

Ship the champion-page AI gauntlet roundtable with real model calls, strict poison-ring survival rules, whole-round settlement, and visible team/model voting.

## Rules To Implement

- `round32` skips `wc2026-ko-01` and gives every eligible model exactly 3 picks.
- Later rounds use the previous settled round's surviving pick count as the allowed pick count.
- Models with zero surviving picks are permanently eliminated from future picking.
- Eliminated models are still called each round for one sideline line.
- A model may not pick both teams from the same match in one round.
- Invalid or failed calls become visible issues; no synthetic replacement picks.
- Settlement happens only after the whole round has results.

## Implementation Steps

1. Add failing tests for candidate pools, pick-count rules, validation, settlement, and data merge behavior.
2. Add `pipeline/champion-gauntlet.js` with reusable pure functions plus CLI generation/settlement commands.
3. Add npm scripts for generation, settlement, and missing-only repair.
4. Render gauntlet cards on the champion page above the existing radar.
5. Add responsive CSS for AI cards and team vote clusters.
6. Update cache version, schema docs, and progress notes.
7. Generate `round32` with real model calls and rerun missing-only repair if needed.
8. Verify tests, validators, syntax checks, local static output, then publish.

