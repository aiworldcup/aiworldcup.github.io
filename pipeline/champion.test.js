const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildChampionData } = require("./champion");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const GROUPS_PATH = path.join(__dirname, "..", "public", "data", "groups.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sampleData() {
  return {
    matches: readJson(MATCHES_PATH).matches,
    groups: readJson(GROUPS_PATH).groups,
    generatedAt: "2026-06-29T12:00:00.000Z",
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
  assert.ok(!findTeam(data, "海地"));
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

testBuildsAliveChampionBoard();
testScoresGroupFormAndStrengthSeparately();
testAddsReadableHooksAndNextMatchContext();
testTopContendersUseDistinctScriptsAndBadges();
console.log("[champion.test] ok");
