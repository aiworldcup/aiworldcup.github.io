const assert = require("assert");
const {
  planRoundCandidates,
  runGauntletAutomation,
} = require("./champion-gauntlet-auto");
const { withSealedPicksHash } = require("./champion-gauntlet");

const NOW = "2026-07-11T00:00:00.000Z";

function team(name, flag) {
  return { team: name, flag };
}

function match(id, stage, kickoff, home, away, actual = null) {
  return withSealedPicksHash({
    id,
    stage,
    kickoff,
    home: team(home, `${home}F`),
    away: team(away, `${away}F`),
    actual,
    placeholder: home === "待定" || away === "待定",
  });
}

function quarterfinals() {
  return [
    match("qf-started", "World Cup · Quarter-finals", "2026-07-10T20:00:00.000Z", "甲", "乙"),
    match("qf-2", "World Cup · Quarter-finals", "2026-07-11T01:00:00.000Z", "丙", "丁"),
    match("qf-3", "World Cup · Quarter-finals", "2026-07-11T20:00:00.000Z", "戊", "己"),
    match("qf-4", "World Cup · Quarter-finals", "2026-07-12T00:00:00.000Z", "庚", "辛"),
  ];
}

function lockedRound16(allowedPicks = 1) {
  const picks = Array.from({ length: allowedPicks }, (_, index) => ({
    team: `晋级${index + 1}`,
    matchId: "r16-final",
  }));
  return withSealedPicksHash({
    roundId: "round16",
    label: "16 强毒圈",
    status: "locked",
    candidateTeams: [
      { team: "晋级1", matchId: "r16-final", side: "home" },
      { team: "淘汰1", matchId: "r16-final", side: "away" },
    ],
    entries: [{
      modelId: "alpha",
      modelName: "Alpha",
      status: "alive",
      allowedPicks,
      picks,
      alivePicks: [],
      eliminatedPicks: [],
      issues: [],
      calledAt: "2026-07-07T00:00:00.000Z",
    }],
  });
}

function settledRound16(allowedPicks = 1) {
  const round = lockedRound16(allowedPicks);
  const alivePicks = round.entries[0].picks;
  return {
    ...round,
    status: "settled",
    settledAt: "2026-07-08T00:00:00.000Z",
    entries: [{ ...round.entries[0], alivePicks }],
  };
}

function championData(round) {
  return {
    updatedAt: "2026-07-10T00:00:00.000Z",
    teams: [],
    predictions: [],
    gauntlet: { updatedAt: "2026-07-10T00:00:00.000Z", rounds: [round] },
  };
}

function validModelResponse(teamName) {
  return { ok: true, text: JSON.stringify({ picks: [teamName], line: "只押未开赛对阵。" }), durationMs: 1 };
}

function testPlannerExcludesStartedMatchWithoutUsingResult() {
  // Given: a complete quarter-final bracket whose first match has kicked off without a synced result.
  const matches = quarterfinals();

  // When: the automation freezes the trustworthy pool.
  const plan = planRoundCandidates(matches, "quarterfinal", Date.parse(NOW));

  // Then: kickoff time alone excludes that match and sets the next kickoff as the deadline.
  assert.strictEqual(plan.ready, true);
  assert.deepStrictEqual(plan.eligibleMatches.map((item) => item.id), ["qf-2", "qf-3", "qf-4"]);
  assert.deepStrictEqual(plan.excludedMatches.map((item) => item.matchId), ["qf-started"]);
  assert.strictEqual(plan.deadlineAt, "2026-07-11T01:00:00.000Z");
}

async function testAutomationSettlesPreviousRoundAndGeneratesNextRound() {
  // Given: the frozen Round of 16 has an advancement winner and three quarter-finals remain unstarted.
  const matches = [
    match("r16-final", "World Cup · Round of 16", "2026-07-07T20:00:00.000Z", "晋级1", "淘汰1", { result: "home", score: "1-0" }),
    ...quarterfinals(),
  ];
  let calls = 0;

  // When: one automation cycle runs.
  const result = await runGauntletAutomation({
    matches,
    championData: championData(lockedRound16()),
    models: [{ id: "alpha", name: "Alpha", vendor: "Test" }],
    askModelFn: async () => {
      calls += 1;
      return validModelResponse("丙");
    },
    now: NOW,
    clock: () => Date.parse(NOW),
  });

  // Then: settlement and generation happen in order without offering the started match.
  const current = result.data.gauntlet.rounds.at(-1);
  assert.deepStrictEqual(result.actions, ["settled:round16", "generated:quarterfinal"]);
  assert.strictEqual(calls, 1);
  assert.strictEqual(result.data.gauntlet.rounds[0].status, "settled");
  assert.strictEqual(current.status, "locked");
  assert.deepStrictEqual(current.excludedMatches.map((item) => item.matchId), ["qf-started"]);
  assert.deepStrictEqual(Array.from(new Set(current.candidateTeams.map((item) => item.matchId))), ["qf-2", "qf-3", "qf-4"]);
}

async function testAutomationSkipsWhenRemainingMatchesCannotFitAllowance() {
  // Given: only two distinct matches remain but the model must place three non-hedged picks.
  const matches = quarterfinals().map((item, index) => index < 2
    ? { ...item, kickoff: "2026-07-10T20:00:00.000Z" }
    : item);
  let calls = 0;

  // When: automation evaluates the round.
  const result = await runGauntletAutomation({
    matches,
    championData: championData(settledRound16(3)),
    models: [{ id: "alpha", name: "Alpha", vendor: "Test" }],
    askModelFn: async () => {
      calls += 1;
      return validModelResponse("戊");
    },
    now: NOW,
    clock: () => Date.parse(NOW),
  });

  // Then: it records a transparent skip and makes no retrospective or weakened call.
  const current = result.data.gauntlet.rounds.at(-1);
  assert.deepStrictEqual(result.actions, ["skipped:quarterfinal"]);
  assert.strictEqual(calls, 0);
  assert.strictEqual(current.status, "skipped");
  assert.match(current.skipReason, /不足以满足/);
}

async function testIssueRepairStopsAtDeadline() {
  // Given: a frozen quarter-final round has one issue and its earliest kickoff is now.
  const candidateMatches = quarterfinals().slice(1);
  const round = withSealedPicksHash({
    roundId: "quarterfinal",
    label: "8 强毒圈",
    status: "open",
    deadlineAt: NOW,
    candidateTeams: candidateMatches.flatMap((item) => [
      { team: item.home.team, flag: item.home.flag, matchId: item.id, opponent: item.away.team, side: "home" },
      { team: item.away.team, flag: item.away.flag, matchId: item.id, opponent: item.home.team, side: "away" },
    ]),
    excludedMatches: [],
    entries: [{
      modelId: "alpha",
      modelName: "Alpha",
      status: "issue",
      allowedPicks: 1,
      picks: [],
      issues: [{ type: "timeout", message: "timeout" }],
      calledAt: "2026-07-10T23:00:00.000Z",
    }],
  });
  let calls = 0;

  // When: automation runs exactly at the deadline.
  const result = await runGauntletAutomation({
    matches: quarterfinals(),
    championData: { ...championData(settledRound16()), gauntlet: { rounds: [settledRound16(), round] } },
    models: [{ id: "alpha", name: "Alpha", vendor: "Test" }],
    askModelFn: async () => {
      calls += 1;
      return validModelResponse("丙");
    },
    now: NOW,
    clock: () => Date.parse(NOW),
  });

  // Then: the issue remains visible, the round locks, and no late model call occurs.
  assert.deepStrictEqual(result.actions, ["locked:quarterfinal"]);
  assert.strictEqual(calls, 0);
  assert.strictEqual(result.data.gauntlet.rounds.at(-1).status, "locked");
  assert.strictEqual(result.data.gauntlet.rounds.at(-1).entries[0].status, "issue");
}

async function testLockedRoundWithoutResultsIsIdempotent() {
  // Given: a current round is already locked and still waiting for results.
  const round = withSealedPicksHash({
    ...settledRound16(),
    roundId: "quarterfinal",
    label: "8 强毒圈",
    status: "locked",
    candidateTeams: [
      { team: "丙", matchId: "qf-2", side: "home" },
      { team: "丁", matchId: "qf-2", side: "away" },
    ],
  });
  const data = { ...championData(round), gauntlet: { rounds: [round] } };

  // When: automation has no legal transition.
  const result = await runGauntletAutomation({
    matches: quarterfinals(),
    championData: data,
    models: [],
    askModelFn: async () => { throw new Error("must not call"); },
    now: NOW,
    clock: () => Date.parse(NOW),
  });

  // Then: it returns the exact state without timestamp churn.
  assert.deepStrictEqual(result.actions, []);
  assert.strictEqual(JSON.stringify(result.data), JSON.stringify(data));
}

async function testStoredDeadlineIsClampedToFrozenKickoff() {
  // Given: an issue round claims a late deadline even though its frozen match already kicked off.
  const qf = quarterfinals()[1];
  const round = {
    roundId: "quarterfinal",
    label: "8 强毒圈",
    status: "open",
    deadlineAt: "2026-07-11T03:00:00.000Z",
    candidateTeams: [
      { team: qf.home.team, matchId: qf.id, side: "home" },
      { team: qf.away.team, matchId: qf.id, side: "away" },
    ],
    entries: [{
      modelId: "alpha",
      modelName: "Alpha",
      status: "issue",
      allowedPicks: 1,
      picks: [],
      issues: [{ type: "timeout" }],
    }],
  };
  let calls = 0;
  const atTwo = "2026-07-11T02:00:00.000Z";

  // When: automation runs after the real kickoff but before the stale stored deadline.
  const result = await runGauntletAutomation({
    matches: quarterfinals(),
    championData: { ...championData(settledRound16()), gauntlet: { rounds: [settledRound16(), round] } },
    models: [{ id: "alpha", name: "Alpha" }],
    askModelFn: async () => {
      calls += 1;
      return validModelResponse("丙");
    },
    now: atTwo,
    clock: () => Date.parse(atTwo),
  });

  // Then: the real kickoff wins, the round locks, and no retrospective call occurs.
  assert.strictEqual(calls, 0);
  assert.deepStrictEqual(result.actions, ["locked:quarterfinal"]);
  assert.strictEqual(result.data.gauntlet.rounds.at(-1).deadlineAt, qf.kickoff);
}

async function testSkippedLineagePropagatesToLaterReadyRound() {
  // Given: quarter-finals were skipped and the semifinal bracket later becomes complete.
  const skipped = {
    roundId: "quarterfinal",
    label: "8 强毒圈",
    status: "skipped",
    entries: [],
    candidateTeams: [],
    excludedMatches: [],
    skipReason: "没有可信赛前选票",
  };
  const semifinals = [
    match("sf-1", "World Cup · Semi-finals", "2026-07-14T20:00:00.000Z", "甲", "乙"),
    match("sf-2", "World Cup · Semi-finals", "2026-07-15T19:00:00.000Z", "丙", "丁"),
  ];
  let calls = 0;

  // When: the next-stage bracket is ready.
  const result = await runGauntletAutomation({
    matches: semifinals,
    championData: { ...championData(skipped), gauntlet: { rounds: [settledRound16(), skipped] } },
    models: [{ id: "alpha", name: "Alpha" }],
    askModelFn: async () => {
      calls += 1;
      return validModelResponse("甲");
    },
    now: NOW,
    clock: () => Date.parse(NOW),
  });

  // Then: no model sees post-gap context and the semifinal is transparently skipped too.
  assert.strictEqual(calls, 0);
  assert.deepStrictEqual(result.actions, ["skipped:semifinal"]);
  assert.strictEqual(result.data.gauntlet.rounds.at(-1).status, "skipped");
  assert.match(result.data.gauntlet.rounds.at(-1).skipReason, /上一轮/);
}

async function testRepairFailsWhenFrozenMatchDisappears() {
  const round = {
    roundId: "quarterfinal",
    label: "8强毒圈",
    status: "open",
    deadlineAt: "2026-07-11T03:00:00.000Z",
    candidateTeams: [
      { team: "甲", matchId: "missing-qf", side: "home" },
      { team: "乙", matchId: "missing-qf", side: "away" },
    ],
    entries: [{ modelId: "alpha", status: "issue", allowedPicks: 1, picks: [], issues: [{ type: "timeout" }] }],
  };
  let calls = 0;

  await assert.rejects(
    () => runGauntletAutomation({
      matches: [],
      championData: { ...championData(round), gauntlet: { rounds: [settledRound16(), round] } },
      models: [{ id: "alpha", name: "Alpha" }],
      askModelFn: async () => {
        calls += 1;
        return validModelResponse("甲");
      },
      now: NOW,
      clock: () => Date.parse(NOW),
    }),
    /missing frozen match/,
  );
  assert.strictEqual(calls, 0);
}

async function main() {
  testPlannerExcludesStartedMatchWithoutUsingResult();
  await testAutomationSettlesPreviousRoundAndGeneratesNextRound();
  await testAutomationSkipsWhenRemainingMatchesCannotFitAllowance();
  await testIssueRepairStopsAtDeadline();
  await testLockedRoundWithoutResultsIsIdempotent();
  await testStoredDeadlineIsClampedToFrozenKickoff();
  await testSkippedLineagePropagatesToLaterReadyRound();
  await testRepairFailsWhenFrozenMatchDisappears();
  console.log("[champion-gauntlet-auto.test] ok");
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
