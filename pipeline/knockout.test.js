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

function round32OpeningSnapshot(matches) {
  return (matches || []).map((match) => {
    if (match.stage !== "World Cup · Round of 32" || match.id === "wc2026-ko-01") return match;
    const next = { ...match, actual: null };
    delete next.actualSource;
    delete next.finalActual;
    delete next.finalActualSource;
    return next;
  });
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
  const resolved = resolveKnockoutMatches(round32OpeningSnapshot(data.matches), groups, {
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
  assert.strictEqual(opener.actualSource.scoreScope, "regularTime");

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

function testResolveQuarterfinalPlaceholders() {
  const data = readJson(MATCHES_PATH);
  const groups = readJson(GROUPS_PATH).groups;
  const resolved = resolveKnockoutMatches(data.matches, groups, {
    generatedAt: "2026-07-09T12:00:00.000Z",
  });

  const swissColombia = resolved.find((match) => match.id === "wc2026-ko-24");
  assert.strictEqual(swissColombia.actual.result, "draw");
  assert.strictEqual(swissColombia.advanceResult, "home");
  assert.strictEqual(swissColombia.advanceSource.method, "penalties");

  const quarterfinals = resolved
    .filter((match) => match.stage === "World Cup · Quarter-finals")
    .map((match) => ({
      id: match.id,
      dateKey: match.dateKey,
      home: match.home.team,
      away: match.away.team,
      placeholder: match.placeholder,
    }));

  assert.deepStrictEqual(quarterfinals, [
    { id: "wc2026-ko-25", dateKey: "2026-07-10", home: "摩洛哥", away: "法国", placeholder: false },
    { id: "wc2026-ko-26", dateKey: "2026-07-11", home: "西班牙", away: "比利时", placeholder: false },
    { id: "wc2026-ko-27", dateKey: "2026-07-12", home: "挪威", away: "英格兰", placeholder: false },
    { id: "wc2026-ko-28", dateKey: "2026-07-12", home: "阿根廷", away: "瑞士", placeholder: false },
  ]);
}

function testResolveSemifinalAndFinalPlaceholders() {
  const data = readJson(MATCHES_PATH);
  const groups = readJson(GROUPS_PATH).groups;
  const qfWinners = new Map([
    ["wc2026-ko-25", "away"],
    ["wc2026-ko-26", "home"],
    ["wc2026-ko-27", "away"],
    ["wc2026-ko-28", "home"],
  ]);
  const snapshot = data.matches.map((match) => {
    if (qfWinners.has(match.id)) return { ...match, advanceResult: qfWinners.get(match.id) };
    if (match.id === "wc2026-ko-29") return { ...match, actual: { result: "home", score: "1-0" } };
    if (match.id === "wc2026-ko-30") return { ...match, actual: { result: "away", score: "0-1" } };
    return match;
  });

  const resolved = resolveKnockoutMatches(snapshot, groups, { generatedAt: "2026-07-13T00:00:00.000Z" });
  const firstSemi = resolved.find((match) => match.id === "wc2026-ko-29");
  const secondSemi = resolved.find((match) => match.id === "wc2026-ko-30");
  const final = resolved.find((match) => match.id === "wc2026-ko-32");

  assert.deepStrictEqual(
    { kickoff: firstSemi.kickoff, home: firstSemi.home.team, away: firstSemi.away.team, placeholder: firstSemi.placeholder },
    { kickoff: "2026-07-14T20:00:00+00:00", home: "法国", away: "西班牙", placeholder: false },
  );
  assert.deepStrictEqual(
    { kickoff: secondSemi.kickoff, home: secondSemi.home.team, away: secondSemi.away.team, placeholder: secondSemi.placeholder },
    { kickoff: "2026-07-15T19:00:00+00:00", home: "英格兰", away: "阿根廷", placeholder: false },
  );
  assert.deepStrictEqual(
    { kickoff: final.kickoff, home: final.home.team, away: final.away.team, placeholder: final.placeholder },
    { kickoff: "2026-07-19T19:00:00+00:00", home: "法国", away: "阿根廷", placeholder: false },
  );
}

testGroupStandingsAndThirdPlaces();
testResolveRoundOf32Placeholders();
testResolveQuarterfinalPlaceholders();
testResolveSemifinalAndFinalPlaceholders();
console.log("[knockout.test] ok");
