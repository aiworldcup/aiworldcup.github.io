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
  generateRoundData,
} = require("./champion-gauntlet");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");

function readMatches() {
  return JSON.parse(fs.readFileSync(MATCHES_PATH, "utf8")).matches;
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

function readOpeningSnapshotMatches() {
  return round32OpeningSnapshot(readMatches());
}

function byTeam(candidates, team) {
  return candidates.find((item) => item.team === team);
}

function sampleRound32Context() {
  const matches = readOpeningSnapshotMatches();
  const candidateMatches = candidateMatchesForRound(matches, "round32");
  const candidateTeams = candidateTeamsForRound(candidateMatches);
  return { roundId: "round32", candidateMatches, candidateTeams, allowedPicks: 3 };
}

function testRoundOrderIsStable() {
  assert.deepStrictEqual(ROUND_ORDER, ["round32", "round16", "quarterfinal", "semifinal", "final"]);
}

function testRound32SkipsCompletedOpener() {
  const matches = candidateMatchesForRound(readOpeningSnapshotMatches(), "round32");
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
  const matches = readOpeningSnapshotMatches().map((match) => ({ ...match }));
  const roundMatches = matches.filter((match) => match.stage === "World Cup · Round of 32" && match.id !== "wc2026-ko-01");
  roundMatches.forEach((match) => {
    match.actual = { result: "home", score: "1-0" };
    delete match.advanceResult;
    delete match.advanceSource;
    delete match.finalActual;
    delete match.finalActualSource;
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
    () => settleRoundData(round, readOpeningSnapshotMatches(), "2026-06-29T12:00:00.000Z"),
    /pending round32 matches/
  );
}

function testSettlementUsesAdvancementResultForKnockoutDraws() {
  const matches = readMatches().map((match) => ({ ...match }));
  const drawMatch = matches.find((match) => match.id === "wc2026-ko-03");
  drawMatch.actual = { result: "draw", score: "1-1" };
  drawMatch.advanceResult = "away";

  const round = {
    roundId: "round32",
    status: "locked",
    candidateTeams: candidateTeamsForRound([drawMatch]),
    entries: [
      {
        modelId: "alpha",
        status: "alive",
        picks: [{ team: "巴拉圭", matchId: "wc2026-ko-03" }],
        issues: [],
      },
      {
        modelId: "beta",
        status: "alive",
        picks: [{ team: "德国", matchId: "wc2026-ko-03" }],
        issues: [],
      },
    ],
  };

  const settled = settleRoundData(round, matches, "2026-07-04T12:00:00.000Z");

  assert.strictEqual(settled.entries[0].status, "alive");
  assert.deepStrictEqual(settled.entries[0].alivePicks.map((item) => item.team), ["巴拉圭"]);
  assert.strictEqual(settled.entries[1].status, "eliminated");
}

function testSettlementWaitsForAdvancingSideOnKnockoutDraw() {
  // Given: a knockout match has a regular-time draw but no advancement result.
  const match = {
    id: "qf-draw",
    stage: "World Cup · Quarter-finals",
    home: { team: "甲队", flag: "AA" },
    away: { team: "乙队", flag: "BB" },
    actual: { result: "draw", score: "1-1" },
  };
  const round = {
    roundId: "quarterfinal",
    status: "locked",
    candidateTeams: candidateTeamsForRound([match]),
    entries: [{
      modelId: "alpha",
      status: "alive",
      picks: [{ team: "甲队", matchId: "qf-draw" }],
      issues: [],
    }],
  };

  // When/Then: settlement remains blocked instead of eliminating every pick.
  assert.throws(
    () => settleRoundData(round, [match], "2026-07-11T00:00:00.000Z"),
    /pending quarterfinal matches: qf-draw/
  );
}

function testSettlementIncludesMatchesReferencedBySealedPicks() {
  // Given: a historical candidate snapshot was narrowed after a valid pick was sealed.
  const visibleMatch = {
    id: "visible-match",
    home: { team: "甲队" },
    away: { team: "乙队" },
    actual: { result: "home", score: "1-0" },
  };
  const sealedPickMatch = {
    id: "sealed-pick-match",
    home: { team: "法国" },
    away: { team: "对手" },
    actual: { result: "home", score: "2-0" },
  };
  const round = {
    roundId: "round16",
    status: "locked",
    candidateTeams: candidateTeamsForRound([visibleMatch]),
    entries: [{
      modelId: "alpha",
      status: "alive",
      picks: [{ team: "法国", matchId: "sealed-pick-match" }],
      issues: [],
    }],
  };

  // When: the narrowed round is settled against the complete match ledger.
  const settled = settleRoundData(round, [visibleMatch, sealedPickMatch], "2026-07-11T00:00:00.000Z");

  // Then: the sealed France pick uses its own match result and remains alive.
  assert.strictEqual(settled.entries[0].status, "alive");
  assert.deepStrictEqual(settled.entries[0].alivePicks.map((item) => item.team), ["法国"]);
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
  assert.match(prompt, /只能返回结构化内容/);
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

async function testMissingOnlyPreservesExistingCandidatePool() {
  const matches = [
    {
      id: "m1",
      stage: "World Cup · Round of 16",
      home: { team: "甲队", flag: "AA" },
      away: { team: "乙队", flag: "BB" },
      actual: { result: "home", score: "1-0" },
    },
    {
      id: "m2",
      stage: "World Cup · Round of 16",
      home: { team: "丙队", flag: "CC" },
      away: { team: "丁队", flag: "DD" },
    },
  ];
  const candidateTeams = candidateTeamsForRound(matches);
  const existingBeta = {
    modelId: "beta",
    status: "alive",
    allowedPicks: 1,
    picks: [{ team: "丙队", flag: "CC", matchId: "m2", opponent: "丁队", side: "home" }],
    issues: [],
    calledAt: "old",
  };
  const championData = {
    gauntlet: {
      rounds: [
        {
          roundId: "round32",
          status: "settled",
          entries: [
            { modelId: "alpha", status: "alive", alivePicks: [{ team: "甲队" }] },
            { modelId: "beta", status: "alive", alivePicks: [{ team: "丙队" }] },
          ],
        },
        {
          roundId: "round16",
          status: "open",
          candidateTeams,
          excludedMatches: [{ matchId: "old-skip", reason: "keep me" }],
          entries: [
            { modelId: "alpha", status: "issue", allowedPicks: 1, picks: [], issues: [{ type: "timeout" }], calledAt: "old" },
            existingBeta,
          ],
        },
      ],
    },
  };

  const round = await generateRoundData({
    roundId: "round16",
    matches,
    models: [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }],
    championData,
    missingOnly: true,
    generatedAt: "2026-07-05T12:00:00.000Z",
    askModelFn: async (modelId, prompt) => {
      assert.strictEqual(modelId, "alpha");
      assert.match(prompt, /甲队/);
      assert.match(prompt, /丙队/);
      return { ok: true, text: '{"picks":["甲队"],"line":"补上。"}', durationMs: 1 };
    },
  });

  assert.deepStrictEqual(round.candidateTeams.map((item) => item.matchId), ["m1", "m1", "m2", "m2"]);
  assert.deepStrictEqual(round.excludedMatches, championData.gauntlet.rounds[1].excludedMatches);
  assert.strictEqual(round.entries.find((entry) => entry.modelId === "beta"), existingBeta);
  assert.deepStrictEqual(round.entries.find((entry) => entry.modelId === "alpha").picks.map((item) => item.team), ["甲队"]);
}

async function testGenerationUsesFrozenCandidateOverrideAndDeadline() {
  // Given: one quarter-final has started and one remains eligible for sealing.
  const started = {
    id: "qf-started",
    stage: "World Cup · Quarter-finals",
    kickoff: "2026-07-10T20:00:00.000Z",
    home: { team: "甲队", flag: "AA" },
    away: { team: "乙队", flag: "BB" },
    actual: null,
  };
  const eligible = {
    id: "qf-eligible",
    stage: "World Cup · Quarter-finals",
    kickoff: "2026-07-11T20:00:00.000Z",
    home: { team: "丙队", flag: "CC" },
    away: { team: "丁队", flag: "DD" },
    actual: null,
  };
  const championData = {
    gauntlet: {
      rounds: [{
        roundId: "round16",
        status: "settled",
        entries: [{ modelId: "alpha", status: "alive", alivePicks: [{ team: "甲队" }] }],
      }],
    },
  };
  const excludedMatches = [{ matchId: started.id, home: "甲队", away: "乙队", reason: "已开赛" }];

  // When: generation receives the pre-kickoff pool frozen by the automation planner.
  const round = await generateRoundData({
    roundId: "quarterfinal",
    matches: [started, eligible],
    models: [{ id: "alpha", name: "Alpha" }],
    championData,
    candidateMatchesOverride: [eligible],
    excludedMatchesOverride: excludedMatches,
    deadlineAt: eligible.kickoff,
    generatedAt: "2026-07-11T00:00:00.000Z",
    askModelFn: async () => ({
      ok: true,
      text: '{"picks":["丙队"],"line":"只押未开赛对阵。"}',
      durationMs: 1,
    }),
  });

  // Then: the started match never enters the candidate pool or prompt contract.
  assert.deepStrictEqual(round.candidateTeams.map((item) => item.matchId), ["qf-eligible", "qf-eligible"]);
  assert.deepStrictEqual(round.excludedMatches, excludedMatches);
  assert.strictEqual(round.deadlineAt, eligible.kickoff);
  assert.deepStrictEqual(round.entries[0].picks.map((item) => item.team), ["丙队"]);
}

async function testLateModelResponseIsDiscarded() {
  // Given: a model starts one second before kickoff but finishes after the deadline.
  const eligible = {
    id: "qf-deadline",
    stage: "World Cup · Quarter-finals",
    kickoff: "2026-07-11T01:00:00.000Z",
    home: { team: "甲队", flag: "AA" },
    away: { team: "乙队", flag: "BB" },
  };
  const championData = {
    gauntlet: {
      rounds: [{
        roundId: "round16",
        status: "settled",
        entries: [{ modelId: "alpha", status: "alive", alivePicks: [{ team: "甲队" }] }],
      }],
    },
  };
  const ticks = [
    Date.parse("2026-07-11T00:59:59.000Z"),
    Date.parse("2026-07-11T01:00:01.000Z"),
  ];
  let observedTimeout = null;

  // When: the otherwise valid response arrives too late.
  const round = await generateRoundData({
    roundId: "quarterfinal",
    matches: [eligible],
    models: [{ id: "alpha", name: "Alpha" }],
    championData,
    candidateMatchesOverride: [eligible],
    deadlineAt: eligible.kickoff,
    generatedAt: "2026-07-11T00:59:59.000Z",
    nowFn: () => ticks.shift() ?? Date.parse("2026-07-11T01:00:01.000Z"),
    timeoutMs: 90000,
    askModelFn: async (_modelId, _prompt, options) => {
      observedTimeout = options.timeoutMs;
      return { ok: true, text: '{"picks":["甲队"],"line":"压哨。"}', durationMs: 2000 };
    },
  });

  // Then: the timeout is capped to the remaining second and no pick is sealed.
  assert.strictEqual(observedTimeout, 1000);
  assert.strictEqual(round.entries[0].status, "issue");
  assert.strictEqual(round.entries[0].issues[0].type, "deadline_exceeded");
  assert.deepStrictEqual(round.entries[0].picks, []);
  assert.strictEqual(round.entries[0].calledAt, "2026-07-11T00:59:59.000Z");
}

async function testMissingOnlyPreservesDisabledLegacyEntry() {
  // Given: Beta has a valid sealed pick but is no longer in the enabled roster.
  const match = {
    id: "m1",
    stage: "World Cup · Round of 16",
    home: { team: "甲队", flag: "AA" },
    away: { team: "乙队", flag: "BB" },
  };
  const beta = {
    modelId: "beta",
    modelName: "Beta",
    status: "alive",
    allowedPicks: 1,
    picks: [{ team: "乙队", flag: "BB", matchId: "m1", opponent: "甲队", side: "away" }],
    issues: [],
  };
  const championData = {
    gauntlet: {
      rounds: [
        {
          roundId: "round32",
          status: "settled",
          entries: [
            { modelId: "alpha", status: "alive", alivePicks: [{ team: "甲队" }] },
            { modelId: "beta", status: "alive", alivePicks: [{ team: "乙队" }] },
          ],
        },
        {
          roundId: "round16",
          status: "open",
          candidateTeams: candidateTeamsForRound([match]),
          entries: [
            { modelId: "alpha", status: "issue", allowedPicks: 1, picks: [], issues: [{ type: "timeout" }] },
            beta,
          ],
        },
      ],
    },
  };

  // When: only Alpha is callable during missing-only repair.
  const round = await generateRoundData({
    roundId: "round16",
    matches: [match],
    models: [{ id: "alpha", name: "Alpha" }],
    championData,
    missingOnly: true,
    generatedAt: "2026-07-05T12:00:00.000Z",
    askModelFn: async () => ({ ok: true, text: '{"picks":["甲队"],"line":"补齐。"}', durationMs: 1 }),
  });

  // Then: Beta stays byte-for-byte present even without calledAt or a live config entry.
  assert.deepStrictEqual(round.entries.map((entry) => entry.modelId), ["alpha", "beta"]);
  assert.strictEqual(round.entries[1], beta);
}

async function testNormalGenerationCannotReplaceExistingRound() {
  // Given: a round already has a sealed entry.
  const championData = {
    gauntlet: {
      rounds: [{
        roundId: "round32",
        status: "locked",
        entries: [{ modelId: "alpha", status: "alive", allowedPicks: 3, picks: [{ team: "甲" }], issues: [] }],
      }],
    },
  };

  // When/Then: a non-missing-only regeneration is rejected before any model call.
  await assert.rejects(
    () => generateRoundData({ roundId: "round32", matches: [], models: [], championData }),
    /already exists/,
  );
}

async function testMissingOnlyDoesNotAddReenabledModel() {
  const match = {
    id: "m1",
    stage: "World Cup · Round of 16",
    home: { team: "甲队", flag: "AA" },
    away: { team: "乙队", flag: "BB" },
  };
  const championData = {
    gauntlet: {
      rounds: [
        {
          roundId: "round32",
          status: "settled",
          entries: [{ modelId: "alpha", status: "alive", alivePicks: [{ team: "甲队" }] }],
        },
        {
          roundId: "round16",
          status: "open",
          candidateTeams: candidateTeamsForRound([match]),
          entries: [{ modelId: "alpha", status: "issue", allowedPicks: 1, picks: [], issues: [{ type: "timeout" }] }],
        },
      ],
    },
  };
  const calls = [];

  const round = await generateRoundData({
    roundId: "round16",
    matches: [match],
    models: [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }],
    championData,
    missingOnly: true,
    generatedAt: "2026-07-05T12:00:00.000Z",
    askModelFn: async (modelId) => {
      calls.push(modelId);
      return { ok: true, text: '{"picks":["甲队"],"line":"补齐。"}', durationMs: 1 };
    },
  });

  assert.deepStrictEqual(calls, ["alpha"]);
  assert.deepStrictEqual(round.entries.map((entry) => entry.modelId), ["alpha"]);
}

async function main() {
  testRoundOrderIsStable();
  testRound32SkipsCompletedOpener();
  testValidationRejectsBadPicks();
  testModelStateUsesSurvivorCount();
  testSettlementRequiresWholeRoundAndEliminatesZeroAlive();
  testSettlementUsesAdvancementResultForKnockoutDraws();
  testSettlementWaitsForAdvancingSideOnKnockoutDraw();
  testSettlementIncludesMatchesReferencedBySealedPicks();
  testMergePreservesChampionRadarData();
  testSummaryAndPromptExposeVotesAndRules();
  testParseModelJsonAcceptsTrailingBanter();
  await testMissingOnlyPreservesExistingCandidatePool();
  await testGenerationUsesFrozenCandidateOverrideAndDeadline();
  await testLateModelResponseIsDiscarded();
  await testMissingOnlyPreservesDisabledLegacyEntry();
  await testNormalGenerationCannotReplaceExistingRound();
  await testMissingOnlyDoesNotAddReenabledModel();
  console.log("[champion-gauntlet.test] ok");
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
