const assert = require("assert");
const { entryFromEvent } = require("./sync-espn-results");

function testAetScoreIsMarkedAsFinalIncludingExtraTime() {
  const entry = entryFromEvent(
    {
      id: "760493",
      date: "2026-07-01T20:00Z",
      status: {
        type: {
          completed: true,
          description: "Final After Extra Time",
          shortDetail: "AET",
        },
        period: 3,
      },
      competitions: [
        {
          competitors: [
            { homeAway: "home", score: "3", team: { displayName: "Belgium" } },
            { homeAway: "away", score: "2", team: { displayName: "Senegal" } },
          ],
        },
      ],
    },
    {
      id: "wc2026-ko-09",
      kickoff: "2026-07-01T20:00:00+00:00",
      home: { team: "比利时" },
      away: { team: "塞内加尔" },
    },
  );

  assert.strictEqual(entry.score, "3:2");
  assert.strictEqual(entry.result, "home");
  assert.strictEqual(entry.scoreScope, "finalIncludingExtraTime");
}

function testPenaltyWinnerIsCapturedForAdvancement() {
  const entry = entryFromEvent(
    {
      id: "penalty-game",
      date: "2026-07-11T01:00Z",
      status: { type: { completed: true, description: "Final - Penalties", shortDetail: "Pen" } },
      competitions: [{
        competitors: [
          { homeAway: "home", score: "1", winner: false, team: { displayName: "Argentina" } },
          { homeAway: "away", score: "1", winner: true, team: { displayName: "Switzerland" } },
        ],
      }],
    },
    {
      id: "wc2026-ko-28",
      kickoff: "2026-07-11T01:00:00+00:00",
      home: { team: "阿根廷" },
      away: { team: "瑞士" },
    },
  );

  assert.strictEqual(entry.result, "draw");
  assert.strictEqual(entry.advanceResult, "away");
  assert.strictEqual(entry.advanceMethod, "penalties");
}

testAetScoreIsMarkedAsFinalIncludingExtraTime();
testPenaltyWinnerIsCapturedForAdvancement();
console.log("[sync-espn-results.test] ok");
