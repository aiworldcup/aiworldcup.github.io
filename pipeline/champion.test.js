const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildChampionData, championDataChanged } = require("./champion");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const GROUPS_PATH = path.join(__dirname, "..", "public", "data", "groups.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function round32OpeningSnapshot(matches) {
  return (matches || []).map((match) => {
    if (String(match.stage || "").includes("Group Stage") || match.id === "wc2026-ko-01") return match;
    const next = { ...match, actual: null };
    delete next.actualSource;
    delete next.finalActual;
    delete next.finalActualSource;
    delete next.advanceResult;
    delete next.advanceSource;
    return next;
  });
}

function sampleData() {
  return {
    matches: round32OpeningSnapshot(readJson(MATCHES_PATH).matches),
    groups: readJson(GROUPS_PATH).groups,
    generatedAt: "2026-06-29T12:00:00.000Z",
  };
}

function settledRound32Data() {
  const advanceResults = new Map([
    ["wc2026-ko-03", "away"],
    ["wc2026-ko-04", "away"],
    ["wc2026-ko-09", "home"],
    ["wc2026-ko-14", "away"],
    ["wc2026-ko-15", "home"],
  ]);
  return {
    matches: readJson(MATCHES_PATH).matches.map((match) => {
      if (String(match.stage || "").includes("Group Stage")) return match;
      if (match.stage === "World Cup · Round of 32") {
        return { ...match, advanceResult: advanceResults.get(match.id) || match.advanceResult };
      }
      const next = { ...match, actual: null };
      delete next.actualSource;
      delete next.finalActual;
      delete next.finalActualSource;
      delete next.advanceResult;
      delete next.advanceSource;
      return next;
    }),
    groups: readJson(GROUPS_PATH).groups,
    generatedAt: "2026-07-04T12:00:00.000Z",
  };
}

function findTeam(data, team) {
  return data.teams.find((item) => item.team === team);
}

function testBuildsAliveChampionBoard() {
  const data = buildChampionData(sampleData());

  assert.strictEqual(data.updatedAt, "2026-06-29T12:00:00.000Z");
  assert.ok(data.teams.length >= 24);
  assert.ok(data.teams.length < 48);
  assert.ok(findTeam(data, "加拿大"));
  assert.ok(!findTeam(data, "南非"));
  assert.ok(!findTeam(data, "伊朗"));
}

function testScoresGroupFormAndStrengthSeparately() {
  const data = buildChampionData(sampleData());
  const france = findTeam(data, "法国");
  const brazil = findTeam(data, "巴西");
  const canada = findTeam(data, "加拿大");

  assert.ok(france);
  assert.ok(brazil);
  assert.ok(canada);
  assert.ok(france.scores.form >= 90);
  assert.ok(france.tags.includes("小组赛满血"));
  assert.ok(brazil.scores.strength >= 80);
  assert.ok(canada.scores.path < france.scores.path);
}

function testAddsReadableHooksAndNextMatchContext() {
  const data = buildChampionData(sampleData());
  const top = data.teams[0];
  const brazil = findTeam(data, "巴西");

  assert.ok(data.highlights.favorite.team);
  assert.ok(data.highlights.darkHorse.team);
  assert.ok(data.highlights.jinxRisk.team);
  assert.ok(top.reason.length >= 8);
  assert.ok(top.script.length >= 8);
  assert.ok(top.badges.length >= 1);
  assert.strictEqual(brazil.nextMatch.matchId, "wc2026-ko-02");
  assert.strictEqual(brazil.nextMatch.opponent, "日本");
}

function testTopContendersUseDistinctScriptsAndBadges() {
  const data = buildChampionData(sampleData());
  const argentina = findTeam(data, "阿根廷");
  const france = findTeam(data, "法国");

  assert.ok(argentina);
  assert.ok(france);
  assert.notStrictEqual(argentina.script, france.script);
  assert.notDeepStrictEqual(argentina.badges, france.badges);
  assert.ok(argentina.badges.includes("冠军相"));
  assert.ok(france.badges.includes("火力压迫"));
}

function testUsesAdvancementResultForKnockoutDraws() {
  const data = buildChampionData(settledRound32Data());

  assert.strictEqual(data.source.settledKnockout, 16);
  assert.strictEqual(data.teams.length, 16);
  ["德国", "荷兰", "塞内加尔", "澳大利亚", "佛得角"].forEach((team) => {
    assert.ok(!findTeam(data, team), `${team} should be eliminated`);
  });
  ["巴拉圭", "摩洛哥", "比利时", "埃及", "阿根廷"].forEach((team) => {
    assert.ok(findTeam(data, team), `${team} should still be alive`);
  });
}

function testTimestampOnlyRefreshDoesNotCreateDataChange() {
  const existing = {
    updatedAt: "old",
    teams: [{ team: "阿根廷", rank: 1 }],
    gauntlet: { updatedAt: "old", rounds: [{ roundId: "quarterfinal", status: "locked" }] },
  };
  const timestampOnly = {
    ...existing,
    updatedAt: "new",
    gauntlet: { ...existing.gauntlet, updatedAt: "new" },
  };
  const changedTeam = { ...timestampOnly, teams: [{ team: "西班牙", rank: 1 }] };

  assert.strictEqual(championDataChanged(existing, timestampOnly), false);
  assert.strictEqual(championDataChanged(existing, changedTeam), true);
}

testBuildsAliveChampionBoard();
testScoresGroupFormAndStrengthSeparately();
testAddsReadableHooksAndNextMatchContext();
testTopContendersUseDistinctScriptsAndBadges();
testUsesAdvancementResultForKnockoutDraws();
testTimestampOnlyRefreshDoesNotCreateDataChange();
console.log("[champion.test] ok");
