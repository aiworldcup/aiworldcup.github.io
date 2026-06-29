const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  buildGroupStandings,
  resolveKnockoutMatches,
} = require("./knockout");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const GROUPS_PATH = path.join(__dirname, "..", "public", "data", "groups.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function testGroupStandingsAndThirdPlaces() {
  const matches = readJson(MATCHES_PATH).matches;
  const groups = readJson(GROUPS_PATH).groups;
  const standings = buildGroupStandings(matches, groups);

  assert.strictEqual(standings.byGroup.A[0].team, "墨西哥");
  assert.strictEqual(standings.byGroup.A[1].team, "南非");
  assert.strictEqual(standings.byGroup.B[1].team, "加拿大");
  assert.deepStrictEqual(
    standings.bestThirds.slice(0, 8).map((row) => row.group),
    ["K", "F", "E", "L", "B", "J", "D", "I"],
  );
}

function testResolveRoundOf32Placeholders() {
  const data = readJson(MATCHES_PATH);
  const groups = readJson(GROUPS_PATH).groups;
  const resolved = resolveKnockoutMatches(data.matches, groups, {
    generatedAt: "2026-06-29T12:00:00.000Z",
  });

  const opener = resolved.find((match) => match.id === "wc2026-ko-01");
  assert.strictEqual(opener.placeholder, false);
  assert.strictEqual(opener.fifaMatchNumber, 73);
  assert.strictEqual(opener.stage, "World Cup · Round of 32");
  assert.strictEqual(opener.dateKey, "2026-06-29");
  assert.strictEqual(opener.kickoff, "2026-06-28T19:00:00+00:00");
  assert.strictEqual(opener.home.team, "南非");
  assert.strictEqual(opener.away.team, "加拿大");
  assert.deepStrictEqual(opener.actual, { result: "away", score: "0-1" });

  const upcoming = resolved.find((match) => match.id === "wc2026-ko-02");
  assert.strictEqual(upcoming.placeholder, false);
  assert.strictEqual(upcoming.fifaMatchNumber, 76);
  assert.strictEqual(upcoming.dateKey, "2026-06-30");
  assert.strictEqual(upcoming.home.team, "巴西");
  assert.strictEqual(upcoming.away.team, "日本");
  assert.strictEqual(upcoming.actual, null);

  const final = resolved.find((match) => match.id === "wc2026-ko-32");
  assert.strictEqual(final.placeholder, true);
  assert.strictEqual(final.stage, "World Cup · Final");
}

testGroupStandingsAndThirdPlaces();
testResolveRoundOf32Placeholders();
console.log("[knockout.test] ok");
