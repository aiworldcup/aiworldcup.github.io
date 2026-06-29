const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  ROUND_ORDER,
  candidateMatchesForRound,
  candidateTeamsForRound,
  validateModelOutput,
  modelStateForRound,
  settleRoundData,
  mergeGauntletRound,
  summarizeRound,
  buildModelPrompt,
  parseModelJson,
} = require("./champion-gauntlet");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");

function readMatches() {
  return JSON.parse(fs.readFileSync(MATCHES_PATH, "utf8")).matches;
}

function byTeam(candidates, team) {
  return candidates.find((item) => item.team === team);
}

function sampleRound32Context() {
  const matches = readMatches();
  const candidateMatches = candidateMatchesForRound(matches, "round32");
  const candidateTeams = candidateTeamsForRound(candidateMatches);
  return { roundId: "round32", candidateMatches, candidateTeams, allowedPicks: 3 };
}

function testRoundOrderIsStable() {
  assert.deepStrictEqual(ROUND_ORDER, ["round32", "round16", "quarterfinal", "semifinal", "final"]);
}

function testRound32SkipsCompletedOpener() {
  const matches = candidateMatchesForRound(readMatches(), "round32");
  const teams = candidateTeamsForRound(matches);

  assert.strictEqual(matches.length, 15);
  assert.strictEqual(teams.length, 30);
  assert.ok(!matches.find((match) => match.id === "wc2026-ko-01"));
  assert.ok(!byTeam(teams, "南非"));
  assert.ok(!byTeam(teams, "加拿大"));
  assert.strictEqual(byTeam(teams, "巴西").matchId, "wc2026-ko-02");
  assert.strictEqual(byTeam(teams, "日本").opponent, "巴西");
}

function testValidationRejectsBadPicks() {
  const context = sampleRound32Context();

  const good = validateModelOutput({ picks: ["巴西", "德国", "法国"], line: "巴西稳,德国硬,法国别被奶。" }, context);
  assert.strictEqual(good.valid, true);
  assert.deepStrictEqual(good.picks.map((item) => item.team), ["巴西", "德国", "法国"]);

  const sameMatch = validateModelOutput({ picks: ["巴西", "日本", "德国"], line: "左右互搏。" }, context);
  assert.strictEqual(sameMatch.valid, false);
  assert.ok(sameMatch.issues.some((item) => item.type === "same_match_hedge"));

  const tooFew = validateModelOutput({ picks: ["巴西", "德国"], line: "少选一个。" }, context);
  assert.strictEqual(tooFew.valid, false);
  assert.ok(tooFew.issues.some((item) => item.type === "invalid_pick_count"));

  const unknown = validateModelOutput({ picks: ["巴西", "德国", "加拿大"], line: "加拿大首轮被跳过。" }, context);
  assert.strictEqual(unknown.valid, false);
  assert.ok(unknown.issues.some((item) => item.type === "unknown_team"));
}

function testModelStateUsesSurvivorCount() {
  const previous = {
    roundId: "round32",
    status: "settled",
    entries: [
      { modelId: "alpha", status: "alive", alivePicks: [{ team: "巴西" }, { team: "法国" }] },
      { modelId: "beta", status: "eliminated", alivePicks: [] },
    ],
  };
  const gauntlet = { rounds: [previous] };

  assert.deepStrictEqual(modelStateForRound(gauntlet, "round32", "alpha"), { status: "alive", allowedPicks: 3, previousAlivePicks: [] });
  assert.deepStrictEqual(modelStateForRound(gauntlet, "round16", "alpha"), {
    status: "alive",
    allowedPicks: 2,
    previousAlivePicks: [{ team: "巴西" }, { team: "法国" }],
  });
  assert.deepStrictEqual(modelStateForRound(gauntlet, "round16", "beta"), { status: "eliminated", allowedPicks: 0, previousAlivePicks: [] });
}

function testSettlementRequiresWholeRoundAndEliminatesZeroAlive() {
  const matches = readMatches().map((match) => ({ ...match }));
  const roundMatches = matches.filter((match) => match.stage === "World Cup · Round of 32" && match.id !== "wc2026-ko-01");
  roundMatches.forEach((match) => {
    match.actual = { result: "home", score: "1-0" };
  });

  const round = {
    roundId: "round32",
    status: "locked",
    candidateTeams: candidateTeamsForRound(roundMatches),
    entries: [
      {
        modelId: "alpha",
        status: "alive",
        picks: [
          { team: "巴西", matchId: "wc2026-ko-02" },
          { team: "德国", matchId: "wc2026-ko-03" },
          { team: "法国", matchId: "wc2026-ko-06" },
        ],
        issues: [],
      },
      {
        modelId: "beta",
        status: "alive",
        picks: [
          { team: "日本", matchId: "wc2026-ko-02" },
          { team: "巴拉圭", matchId: "wc2026-ko-03" },
          { team: "瑞典", matchId: "wc2026-ko-06" },
        ],
        issues: [],
      },
    ],
  };

  const settled = settleRoundData(round, matches, "2026-06-29T12:00:00.000Z");
  assert.strictEqual(settled.status, "settled");
  assert.strictEqual(settled.entries[0].status, "alive");
  assert.deepStrictEqual(settled.entries[0].alivePicks.map((item) => item.team), ["巴西", "德国", "法国"]);
  assert.strictEqual(settled.entries[1].status, "eliminated");
  assert.deepStrictEqual(settled.entries[1].alivePicks, []);
  assert.strictEqual(settled.summary.aliveModels, 1);
  assert.strictEqual(settled.summary.eliminatedModels, 1);

  assert.throws(
    () => settleRoundData(round, readMatches(), "2026-06-29T12:00:00.000Z"),
    /pending round32 matches/
  );
}

function testMergePreservesChampionRadarData() {
  const existing = { updatedAt: "old", teams: [{ team: "阿根廷" }], highlights: { favorite: { team: "阿根廷" } } };
  const round = {
    roundId: "round32",
    entries: [
      { modelId: "alpha", status: "alive", picks: [{ team: "巴西", flag: "BR", matchId: "wc2026-ko-02" }], issues: [] },
    ],
  };
  const merged = mergeGauntletRound(existing, round, "2026-06-29T12:00:00.000Z");

  assert.deepStrictEqual(merged.teams, existing.teams);
  assert.strictEqual(merged.highlights.favorite.team, "阿根廷");
  assert.strictEqual(merged.gauntlet.rounds.length, 1);
  assert.strictEqual(merged.gauntlet.rounds[0].roundId, "round32");
  assert.strictEqual(merged.gauntlet.updatedAt, "2026-06-29T12:00:00.000Z");
}

function testSummaryAndPromptExposeVotesAndRules() {
  const context = sampleRound32Context();
  const round = {
    entries: [
      { modelId: "alpha", status: "alive", picks: [{ team: "巴西", flag: "BR" }, { team: "德国", flag: "DE" }], issues: [] },
      { modelId: "beta", status: "issue", picks: [], issues: [{ type: "timeout" }] },
    ],
  };
  const summary = summarizeRound(round);
  assert.strictEqual(summary.aliveModels, 1);
  assert.strictEqual(summary.issueModels, 1);
  assert.strictEqual(summary.topTeams[0].team, "巴西");
  assert.deepStrictEqual(summary.topTeams[0].modelIds, ["alpha"]);

  const prompt = buildModelPrompt({
    model: { id: "alpha", name: "Alpha" },
    status: "alive",
    roundId: "round32",
    allowedPicks: 3,
    candidateMatches: context.candidateMatches.slice(0, 2),
    championData: { teams: [{ team: "巴西", rank: 3, scores: { total: 88 }, tags: ["强队牌面"], nextMatch: { opponent: "日本" } }] },
  });
  assert.match(prompt, /只能返回 JSON/);
  assert.match(prompt, /禁止同场对冲/);
  assert.match(prompt, /巴西/);
}

function testParseModelJsonAcceptsTrailingBanter() {
  const parsed = parseModelJson('{"picks":["巴西","德国","法国"],"line":"稳一点。"}\n补一句: 别奶。');
  assert.deepStrictEqual(parsed.picks, ["巴西", "德国", "法国"]);
  assert.strictEqual(parsed.line, "稳一点。");

  const withSecondObject = parseModelJson('{"picks":["阿根廷","法国","德国"],"line":"别被奶晕。"}\n{"debug":"多余"}');
  assert.deepStrictEqual(withSecondObject.picks, ["阿根廷", "法国", "德国"]);
}

testRoundOrderIsStable();
testRound32SkipsCompletedOpener();
testValidationRejectsBadPicks();
testModelStateUsesSurvivorCount();
testSettlementRequiresWholeRoundAndEliminatesZeroAlive();
testMergePreservesChampionRadarData();
testSummaryAndPromptExposeVotesAndRules();
testParseModelJsonAcceptsTrailingBanter();
console.log("[champion-gauntlet.test] ok");
