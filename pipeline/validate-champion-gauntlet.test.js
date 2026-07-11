const assert = require("assert");
const { computeSealedPicksHash } = require("./champion-gauntlet");
const { validateChampionGauntletData } = require("./validate-champion-gauntlet");

const KNOWN_MATCHES = new Map([
  ["qf-1", { id: "qf-1", home: { team: "甲" }, away: { team: "乙" } }],
  ["qf-2", { id: "qf-2", home: { team: "丙" }, away: { team: "丁" } }],
]);

function validate(data, baselineData = null) {
  return validateChampionGauntletData(data, { knownMatches: KNOWN_MATCHES, baselineData });
}

function validData() {
  const data = {
    gauntlet: {
      rounds: [{
        roundId: "quarterfinal",
        status: "locked",
        deadlineAt: "2026-07-11T01:00:00.000Z",
        candidateTeams: [
          { team: "甲", matchId: "qf-1", side: "home" },
          { team: "乙", matchId: "qf-1", side: "away" },
        ],
        excludedMatches: [],
        entries: [{
          modelId: "alpha",
          status: "alive",
          allowedPicks: 1,
          calledAt: "2026-07-11T00:59:00.000Z",
          completedAt: "2026-07-11T00:59:30.000Z",
          picks: [{ team: "甲", matchId: "qf-1", side: "home" }],
          issues: [],
        }],
      }],
    },
  };
  const round = data.gauntlet.rounds[0];
  round.sealedPicksHash = computeSealedPicksHash(round);
  return data;
}

function testAcceptsSealedRound() {
  assert.deepStrictEqual(validate(validData()), []);
}

function testRejectsLateAcceptedPick() {
  const data = validData();
  data.gauntlet.rounds[0].entries[0].completedAt = "2026-07-11T01:00:00.000Z";
  assert.ok(validate(data).some((error) => /after deadline/.test(error)));
}

function testRejectsExcludedMatchPick() {
  const data = validData();
  data.gauntlet.rounds[0].excludedMatches = [{ matchId: "qf-1", reason: "started" }];
  assert.ok(validate(data).some((error) => /excluded match/.test(error)));
}

function testRejectsSealedPickMutation() {
  const data = validData();
  data.gauntlet.rounds[0].entries[0].picks[0].team = "乙";
  assert.ok(validate(data).some((error) => /sealed picks hash/.test(error)));
}

function testRejectsCallStartingAfterDeadline() {
  const data = validData();
  data.gauntlet.rounds[0].entries[0].calledAt = "2026-07-11T01:00:01.000Z";
  data.gauntlet.rounds[0].entries[0].completedAt = "2026-07-11T00:59:30.000Z";
  data.gauntlet.rounds[0].sealedPicksHash = computeSealedPicksHash(data.gauntlet.rounds[0]);
  assert.ok(validate(data).some((error) => /started after deadline|completion precedes call/.test(error)));
}

function testRejectsSettledPickOutsideFrozenPool() {
  const data = validData();
  const round = data.gauntlet.rounds[0];
  round.status = "settled";
  round.entries[0].picks[0] = { team: "丙", matchId: "qf-2", side: "home" };
  round.sealedPicksHash = computeSealedPicksHash(round);
  assert.ok(validate(data).some((error) => /outside frozen candidate pool/.test(error)));
}

function testRejectsRepairingIssueAfterBaselineLock() {
  const baseline = validData();
  const baselineEntry = baseline.gauntlet.rounds[0].entries[0];
  baselineEntry.status = "issue";
  baselineEntry.picks = [];
  baselineEntry.issues = [{ type: "timeout" }];
  baseline.gauntlet.rounds[0].sealedPicksHash = computeSealedPicksHash(baseline.gauntlet.rounds[0]);
  const current = validData();

  assert.ok(validate(current, baseline).some((error) => /locked issue entry differs/.test(error)));
}

testAcceptsSealedRound();
testRejectsLateAcceptedPick();
testRejectsExcludedMatchPick();
testRejectsSealedPickMutation();
testRejectsCallStartingAfterDeadline();
testRejectsSettledPickOutsideFrozenPool();
testRejectsRepairingIssueAfterBaselineLock();
console.log("[validate-champion-gauntlet.test] ok");
