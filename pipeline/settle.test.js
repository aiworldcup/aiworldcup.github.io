const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { applyActualEntries, resolveSettlementKnockoutData } = require("./settle");

function testRegularTimeConflictNeverRewritesExistingActual() {
  const data = {
    matches: [
      {
        id: "wc2026-ko-09",
        home: { team: "比利时" },
        away: { team: "塞内加尔" },
        actual: { result: "home", score: "3-2" },
        actualSource: {
          provider: "espn",
          sourceLabel: "ESPN Scoreboard",
          sourceHref: "https://www.espn.com/soccer/match/_/gameId/760493",
        },
      },
    ],
  };
  const conflicts = [];

  const changed = applyActualEntries(
    data,
    [
      {
        matchId: "wc2026-ko-09",
        officialScore: "2:2",
        scoreScope: "regularTime",
        sourceLabel: "中国竞彩网足球赛果开奖",
      },
    ],
    "jingcai",
    { conflicts },
  );

  assert.strictEqual(changed, 0);
  assert.deepStrictEqual(data.matches[0].actual, { result: "home", score: "3-2" });
  assert.strictEqual(data.matches[0].actualSource.provider, "espn");
  assert.strictEqual(data.matches[0].finalActual, undefined);
  assert.strictEqual(conflicts.length, 1);
}

function testFinalIncludingExtraTimeDoesNotCreateRegularActual() {
  const data = {
    matches: [
      {
        id: "wc2026-ko-09",
        home: { team: "比利时" },
        away: { team: "塞内加尔" },
        actual: null,
      },
    ],
  };

  const changed = applyActualEntries(
    data,
    [
      {
        matchId: "wc2026-ko-09",
        score: "3:2",
        result: "home",
        scoreScope: "finalIncludingExtraTime",
        sourceLabel: "ESPN Scoreboard",
      },
    ],
    "espn",
  );

  assert.strictEqual(changed, 1);
  assert.strictEqual(data.matches[0].actual, null);
  assert.deepStrictEqual(data.matches[0].finalActual, { result: "home", score: "3-2" });
  assert.strictEqual(data.matches[0].finalActualSource.scoreScope, "finalIncludingExtraTime");
}

function testAdvancementResultIsFilledWithoutChangingActual() {
  const data = {
    matches: [{
      id: "wc2026-ko-28",
      home: { team: "阿根廷" },
      away: { team: "瑞士" },
      actual: { result: "draw", score: "1-1" },
      actualSource: { provider: "jingcai", scoreScope: "regularTime" },
    }],
  };

  const changed = applyActualEntries(data, [{
    matchId: "wc2026-ko-28",
    score: "1:1",
    result: "draw",
    scoreScope: "regularTime",
    advanceResult: "away",
    advanceMethod: "penalties",
    sourceLabel: "ESPN Scoreboard",
  }], "espn");

  assert.strictEqual(changed, 1);
  assert.deepStrictEqual(data.matches[0].actual, { result: "draw", score: "1-1" });
  assert.strictEqual(data.matches[0].advanceResult, "away");
  assert.strictEqual(data.matches[0].advanceSource.method, "penalties");
}

function testSettlementResolvesNextBracketWithoutApiSports() {
  const matches = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "data", "matches.json"), "utf8"));
  const groups = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "data", "groups.json"), "utf8")).groups;
  const winners = new Map([
    ["wc2026-ko-25", "away"],
    ["wc2026-ko-26", "home"],
    ["wc2026-ko-27", "away"],
    ["wc2026-ko-28", "home"],
  ]);
  const input = {
    ...matches,
    matches: matches.matches.map((match) => winners.has(match.id)
      ? { ...match, advanceResult: winners.get(match.id) }
      : match),
  };

  const resolved = resolveSettlementKnockoutData(input, groups, "2026-07-13T00:00:00.000Z");

  assert.strictEqual(resolved.matches.find((match) => match.id === "wc2026-ko-29").placeholder, false);
  assert.strictEqual(resolved.matches.find((match) => match.id === "wc2026-ko-30").placeholder, false);
}

testRegularTimeConflictNeverRewritesExistingActual();
testFinalIncludingExtraTimeDoesNotCreateRegularActual();
testAdvancementResultIsFilledWithoutChangingActual();
testSettlementResolvesNextBracketWithoutApiSports();
console.log("[settle.test] ok");
