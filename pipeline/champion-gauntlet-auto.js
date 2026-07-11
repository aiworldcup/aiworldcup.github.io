#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const {
  ROUND_LABELS,
  ROUND_ORDER,
  generateRoundData,
  mergeGauntletRound,
  resultWinnerTeam,
  settleRoundData,
  summarizeRound,
  withSealedPicksHash,
} = require("./champion-gauntlet");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MATCHES_PATH = path.join(PROJECT_ROOT, "public", "data", "matches.json");
const CHAMPION_PATH = path.join(PROJECT_ROOT, "public", "data", "champion-predictions.json");

const ROUND_STAGE = {
  round32: "World Cup · Round of 32",
  round16: "World Cup · Round of 16",
  quarterfinal: "World Cup · Quarter-finals",
  semifinal: "World Cup · Semi-finals",
  final: "World Cup · Final",
};

const ROUND_MATCH_COUNT = {
  round32: 16,
  round16: 8,
  quarterfinal: 4,
  semifinal: 2,
  final: 1,
};

const LATE_EXCLUSION_REASON = "自动化启用前已开赛,未补录赛后预测";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonIfChanged(filePath, data) {
  const next = `${JSON.stringify(data, null, 2)}\n`;
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (current === next) return false;
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, next, "utf8");
  fs.renameSync(tempPath, filePath);
  return true;
}

function isPlaceholderTeam(teamData) {
  const name = String(teamData?.team || "").trim();
  return !name || /^胜者|^Winner|待定|TBD/i.test(name);
}

function kickoffMs(match) {
  const value = Date.parse(match?.kickoff || "");
  if (!Number.isFinite(value)) throw new Error(`invalid kickoff for ${match?.id || "unknown match"}`);
  return value;
}

function planRoundCandidates(matches, roundId, nowMs) {
  const stage = ROUND_STAGE[roundId];
  const expectedCount = ROUND_MATCH_COUNT[roundId];
  if (!stage || !expectedCount) throw new Error(`unknown roundId: ${roundId}`);
  if (!Number.isFinite(nowMs)) throw new Error("invalid automation timestamp");
  const stageMatches = (matches || []).filter((item) => item.stage === stage);
  const bracketReady = stageMatches.length === expectedCount
    && stageMatches.every((item) => !isPlaceholderTeam(item.home) && !isPlaceholderTeam(item.away));
  if (!bracketReady) {
    return { ready: false, eligibleMatches: [], excludedMatches: [], deadlineAt: null };
  }
  const eligibleMatches = [];
  const excludedMatches = [];
  for (const item of stageMatches) {
    if (kickoffMs(item) <= nowMs) {
      excludedMatches.push({
        matchId: item.id,
        home: item.home.team,
        away: item.away.team,
        reason: LATE_EXCLUSION_REASON,
      });
    } else {
      eligibleMatches.push(item);
    }
  }
  const deadlineMs = eligibleMatches.length
    ? Math.min(...eligibleMatches.map((item) => kickoffMs(item)))
    : null;
  return {
    ready: true,
    eligibleMatches,
    excludedMatches,
    deadlineAt: deadlineMs === null ? null : new Date(deadlineMs).toISOString(),
  };
}

function roundById(data, roundId) {
  return (data.gauntlet?.rounds || []).find((round) => round.roundId === roundId);
}

function currentRound(data) {
  const rounds = data.gauntlet?.rounds || [];
  return rounds.length ? rounds[rounds.length - 1] : null;
}

function frozenMatchIds(round) {
  return Array.from(new Set([
    ...(round?.candidateTeams || []).map((item) => item.matchId),
    ...(round?.entries || []).flatMap((entry) => (entry.picks || []).map((pick) => pick.matchId)),
  ].filter(Boolean)));
}

function canSettleRound(round, matches) {
  const ids = frozenMatchIds(round);
  if (!ids.length) return false;
  const matchById = new Map((matches || []).map((item) => [item.id, item]));
  return ids.every((id) => resultWinnerTeam(matchById.get(id)));
}

function deadlineMsForRound(round, matches) {
  const explicit = Date.parse(round?.deadlineAt || "");
  const matchById = new Map((matches || []).map((item) => [item.id, item]));
  const ids = frozenMatchIds(round);
  const missing = ids.filter((id) => !matchById.has(id));
  if (missing.length) throw new Error(`missing frozen match: ${missing.join(",")}`);
  const values = ids.map((id) => kickoffMs(matchById.get(id)));
  const frozenDeadline = values.length ? Math.min(...values) : null;
  if (Number.isFinite(explicit) && frozenDeadline !== null) return Math.min(explicit, frozenDeadline);
  if (Number.isFinite(explicit)) return explicit;
  return frozenDeadline;
}

function maxAllowedPicks(round) {
  return Math.max(0, ...(round?.entries || []).map((entry) => (
    entry.status === "alive" ? (entry.alivePicks || []).length : 0
  )));
}

function skippedRound(roundId, plan, generatedAt, allowance) {
  const round = {
    roundId,
    label: ROUND_LABELS[roundId] || roundId,
    status: "skipped",
    startedAt: generatedAt,
    lockedAt: generatedAt,
    settledAt: null,
    deadlineAt: plan.deadlineAt,
    pickCountRule: {
      type: "survivor_count",
      description: "本轮可选数量等于上一整轮活口数;0 活口永久出局。",
    },
    candidateTeams: [],
    excludedMatches: plan.excludedMatches,
    entries: [],
    skipReason: `剩余 ${plan.eligibleMatches.length} 场未开赛对阵不足以满足最多 ${allowance} 注的本轮选票规则`,
  };
  round.summary = summarizeRound(round);
  return round;
}

function skippedRoundAfterGap(roundId, plan, generatedAt, previousRound) {
  const round = skippedRound(roundId, plan, generatedAt, 0);
  return {
    ...round,
    skipReason: `上一轮 ${previousRound.label || previousRound.roundId} 已跳过,没有可信赛前选票可延续`,
  };
}

async function runGauntletAutomation({
  matches,
  championData,
  models,
  askModelFn,
  now = new Date().toISOString(),
  clock = Date.now,
}) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error(`invalid automation timestamp: ${now}`);
  const generatedAt = new Date(nowMs).toISOString();
  let data = championData;
  const actions = [];

  for (const roundId of ROUND_ORDER) {
    let round = roundById(data, roundId);
    if (!round || round.status === "skipped") continue;
    if (["locked", "settled"].includes(round.status)) {
      const sealed = withSealedPicksHash(round);
      if (round.sealedPicksHash && round.sealedPicksHash !== sealed.sealedPicksHash) {
        throw new Error(`sealed picks hash mismatch: ${roundId}`);
      }
      if (!round.sealedPicksHash) {
        data = mergeGauntletRound(data, sealed, generatedAt);
        actions.push(`sealed:${roundId}`);
        round = sealed;
      }
    }
    if (round.status === "settled") continue;

    if (round.status === "open") {
      const deadlineMs = deadlineMsForRound(round, matches);
      if (deadlineMs !== null && nowMs < deadlineMs) {
        const repaired = await generateRoundData({
          roundId,
          matches,
          models,
          championData: data,
          askModelFn,
          missingOnly: true,
          generatedAt,
          deadlineAt: new Date(deadlineMs).toISOString(),
          nowFn: clock,
        });
        data = mergeGauntletRound(data, repaired, generatedAt);
        actions.push(`repaired:${roundId}`);
        return { data, actions };
      }
      round = withSealedPicksHash({
        ...round,
        status: "locked",
        lockedAt: round.lockedAt || (deadlineMs === null ? generatedAt : new Date(deadlineMs).toISOString()),
        deadlineAt: deadlineMs === null ? round.deadlineAt || null : new Date(deadlineMs).toISOString(),
      });
      data = mergeGauntletRound(data, round, generatedAt);
      actions.push(`locked:${roundId}`);
    }

    round = roundById(data, roundId);
    if (round.status === "locked" && canSettleRound(round, matches)) {
      const settled = settleRoundData(round, matches, generatedAt);
      data = mergeGauntletRound(data, settled, generatedAt);
      actions.push(`settled:${roundId}`);
    }
  }

  const previous = currentRound(data);
  if (!previous || !["settled", "skipped"].includes(previous.status)) return { data, actions };
  const nextIndex = ROUND_ORDER.indexOf(previous.roundId) + 1;
  if (nextIndex <= 0 || nextIndex >= ROUND_ORDER.length) return { data, actions };
  const nextRoundId = ROUND_ORDER[nextIndex];
  if (roundById(data, nextRoundId)) return { data, actions };

  const plan = planRoundCandidates(matches, nextRoundId, nowMs);
  if (!plan.ready) return { data, actions };
  if (previous.status === "skipped") {
    const round = skippedRoundAfterGap(nextRoundId, plan, generatedAt, previous);
    data = mergeGauntletRound(data, round, generatedAt);
    actions.push(`skipped:${nextRoundId}`);
    return { data, actions };
  }
  const allowance = maxAllowedPicks(previous);
  if (!plan.eligibleMatches.length || plan.eligibleMatches.length < allowance) {
    const round = skippedRound(nextRoundId, plan, generatedAt, allowance);
    data = mergeGauntletRound(data, round, generatedAt);
    actions.push(`skipped:${nextRoundId}`);
    return { data, actions };
  }

  const round = await generateRoundData({
    roundId: nextRoundId,
    matches,
    models,
    championData: data,
    askModelFn,
    generatedAt,
    candidateMatchesOverride: plan.eligibleMatches,
    excludedMatchesOverride: plan.excludedMatches,
    deadlineAt: plan.deadlineAt,
    nowFn: clock,
  });
  data = mergeGauntletRound(data, round, generatedAt);
  actions.push(`generated:${nextRoundId}`);
  return { data, actions };
}

async function main() {
  const matches = readJson(MATCHES_PATH).matches || [];
  const championData = readJson(CHAMPION_PATH);
  const result = await runGauntletAutomation({ matches, championData });
  const changed = writeJsonIfChanged(CHAMPION_PATH, result.data);
  console.log(`[champion-gauntlet-auto] ${changed ? "wrote" : "unchanged"} ${CHAMPION_PATH}; actions=${result.actions.join(",") || "none"}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  LATE_EXCLUSION_REASON,
  planRoundCandidates,
  runGauntletAutomation,
};
