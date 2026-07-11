const assert = require("assert");
const { mergeExistingMatch, preserveChampionGauntlet } = require("./sync-real-data");

function testPreservesFinalActualWhenMergingFreshFixture() {
  const existing = {
    id: "wc2026-ko-09",
    sealedAt: "2026-07-01T18:00:00.000Z",
    predictions: [],
    odds: { result: { home: 1.8, draw: 3.4, away: 4.6 }, scores: {} },
    actual: { result: "draw", score: "2-2" },
    actualSource: { provider: "jingcai", scoreScope: "regularTime" },
    finalActual: { result: "home", score: "3-2" },
    finalActualSource: { provider: "espn", scoreScope: "finalIncludingExtraTime" },
    advanceResult: "home",
    advanceSource: { provider: "manual-verified", scoreScope: "advancementIncludingExtraTimeAndPenalties" },
  };
  const fresh = {
    id: "wc2026-ko-09",
    sealedAt: null,
    predictions: [],
    odds: { result: {}, scores: {} },
    actual: null,
    syncedAt: "2026-07-03T00:00:00.000Z",
  };

  const merged = mergeExistingMatch(fresh, existing);
  assert.deepStrictEqual(merged.actual, existing.actual);
  assert.deepStrictEqual(merged.actualSource, existing.actualSource);
  assert.deepStrictEqual(merged.finalActual, existing.finalActual);
  assert.deepStrictEqual(merged.finalActualSource, existing.finalActualSource);
  assert.strictEqual(merged.advanceResult, existing.advanceResult);
  assert.deepStrictEqual(merged.advanceSource, existing.advanceSource);
}

function testPreservesGauntletWhenRefreshingChampionRadar() {
  const existing = {
    predictions: [{ modelId: "alpha", champion: "阿根廷" }],
    gauntlet: {
      updatedAt: "2026-07-11T00:00:00.000Z",
      rounds: [{ roundId: "quarterfinal", status: "locked", entries: [] }],
    },
  };
  const fresh = { updatedAt: "new", predictions: existing.predictions, teams: [{ team: "阿根廷" }] };

  const merged = preserveChampionGauntlet(fresh, existing);

  assert.strictEqual(merged.gauntlet, existing.gauntlet);
  assert.deepStrictEqual(merged.teams, fresh.teams);
}

testPreservesFinalActualWhenMergingFreshFixture();
testPreservesGauntletWhenRefreshingChampionRadar();
console.log("[sync-real-data.test] ok");
