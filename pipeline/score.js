const fs = require("fs");
const path = require("path");
const { getConfig } = require("./config");
const { loadProjectEnv } = require("./lib/env");

const DEFAULT_INPUT = path.join(__dirname, "..", "public", "data", "matches.json");
const SAMPLE_INPUT = path.join(__dirname, "..", "public", "data", "sample-matches.json");
const DEFAULT_OUTPUT = path.join(__dirname, "..", "public", "data", "leaderboard.json");
const DEFAULT_SETTLEMENT_GRACE_MINUTES = 150;

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function loadMatches(filePath) {
  if (fs.existsSync(filePath)) return readJson(filePath);
  console.warn(`[score] ${filePath} 不存在,回退 sample-matches.json`);
  return readJson(SAMPLE_INPUT);
}

function safeStake(stake, limits) {
  const maxResult = Number(limits && limits.maxResultStakePerMatch) || 200;
  const maxScore = Number(limits && limits.maxScoreStakePerMatch) || 100;
  const maxTotal = Number(limits && limits.maxStakePerMatch) || maxResult + maxScore;
  let result = Math.min(maxResult, Math.max(0, Number(stake && stake.result) || 0));
  let score = Math.min(maxScore, Math.max(0, Number(stake && stake.score) || 0));
  const total = result + score;
  if (total > maxTotal) {
    const ratio = maxTotal / total;
    result = Math.min(maxResult, result * ratio);
    score = Math.min(maxScore, score * ratio);
  }
  return { result, score };
}

function settlementStatusForMatch(match, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const graceMinutes = Number(options.settlementGraceMinutes || DEFAULT_SETTLEMENT_GRACE_MINUTES);
  if (match.actual) {
    return {
      status: "settled",
      label: "已结算",
      canScore: true,
      reason: "match.actual 已写入",
    };
  }
  if (match.placeholder) {
    return {
      status: "placeholder",
      label: "席位待定",
      canScore: false,
      reason: "淘汰赛席位或对阵未确认",
    };
  }
  if (!match.kickoff) {
    return {
      status: "unscheduled",
      label: "时间待定",
      canScore: false,
      reason: "缺少 kickoff",
    };
  }
  const kickoff = new Date(match.kickoff);
  if (Number.isNaN(kickoff.getTime())) {
    return {
      status: "unscheduled",
      label: "时间待定",
      canScore: false,
      reason: "kickoff 时间无法解析",
    };
  }
  const diffMs = now.getTime() - kickoff.getTime();
  if (diffMs < 0) {
    return {
      status: (match.predictions || []).length || match.sealedAt ? "sealed" : "pre_match",
      label: (match.predictions || []).length || match.sealedAt ? "已封盘" : "赛前",
      canScore: false,
      reason: "比赛尚未开始",
    };
  }
  if (diffMs <= graceMinutes * 60 * 1000) {
    return {
      status: "in_progress",
      label: "比赛进行中",
      canScore: false,
      reason: `开赛后 ${graceMinutes} 分钟内暂不结算`,
    };
  }
  return {
    status: "pending_result",
    label: "待赛果结算",
    canScore: false,
    reason: "开赛已超过结算缓冲,但 match.actual 为空",
  };
}

function scorePrediction(match, prediction, limits) {
  if (!match.actual) return null;
  const stake = safeStake(prediction.stake, limits);
  const resultOdds = match.odds && match.odds.result ? match.odds.result : {};
  const scoreOdds = match.odds && match.odds.scores ? match.odds.scores : {};
  const resultHit = prediction.result === match.actual.result;
  const scoreHit = prediction.score === match.actual.score;
  const resultPoints = resultHit ? stake.result * (Number(resultOdds[prediction.result]) || 0) : 0;
  const scorePoints = scoreHit ? stake.score * (Number(scoreOdds[prediction.score]) || 0) : 0;
  return {
    points: resultPoints + scorePoints,
    staked: stake.result + stake.score,
    resultPoints,
    scorePoints,
    resultHit,
    scoreHit,
  };
}

function makeLeaderboard(matches, options = {}) {
  const config = getConfig();
  const stakeLimits = {
    maxResultStakePerMatch: options.maxResultStakePerMatch || config.maxResultStakePerMatch,
    maxScoreStakePerMatch: options.maxScoreStakePerMatch || config.maxScoreStakePerMatch,
    maxStakePerMatch: options.maxStakePerMatch || config.maxStakePerMatch,
  };
  const settlementGraceMinutes = options.settlementGraceMinutes || DEFAULT_SETTLEMENT_GRACE_MINUTES;
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const tracks = { open: new Map() };
  const settlementCounts = {};
  const pendingResult = [];

  (matches || []).forEach((match) => {
    const status = settlementStatusForMatch(match, { now, settlementGraceMinutes });
    settlementCounts[status.status] = (settlementCounts[status.status] || 0) + 1;
    if (status.status === "pending_result") {
      pendingResult.push({
        matchId: match.id,
        kickoff: match.kickoff,
        home: match.home && match.home.team,
        away: match.away && match.away.team,
        reason: status.reason,
      });
    }
    if (!status.canScore) return;
    (match.predictions || []).forEach((prediction) => {
      const track = prediction.track || "open";
      if (!tracks[track]) return;
      const scored = scorePrediction(match, prediction, stakeLimits);
      if (!scored) return;
      const key = prediction.modelId;
      const row = tracks[track].get(key) || {
        modelId: key,
        points: 0,
        hits: 0,
        scoreHits: 0,
        played: 0,
        staked: 0,
        returns: 0,
        resultPoints: 0,
        scorePoints: 0,
      };
      row.points += scored.points;
      row.hits += scored.resultHit ? 1 : 0;
      row.scoreHits += scored.scoreHit ? 1 : 0;
      row.played += 1;
      row.staked += scored.staked;
      row.returns += scored.points;
      row.resultPoints += scored.resultPoints;
      row.scorePoints += scored.scorePoints;
      tracks[track].set(key, row);
    });
  });

  function rank(map) {
    return Array.from(map.values())
      .sort((a, b) => b.points - a.points || b.hits - a.hits || a.modelId.localeCompare(b.modelId))
      .map((row, index) => ({
        rank: index + 1,
        modelId: row.modelId,
        points: Number(row.points.toFixed(2)),
        hits: row.hits,
        scoreHits: row.scoreHits,
        played: row.played,
        hitRate: row.played ? Number((row.hits / row.played).toFixed(4)) : 0,
        scoreHitRate: row.played ? Number((row.scoreHits / row.played).toFixed(4)) : 0,
        avgPoints: row.played ? Number((row.points / row.played).toFixed(2)) : 0,
        staked: Number(row.staked.toFixed(2)),
        returns: Number(row.returns.toFixed(2)),
        profit: Number((row.returns - row.staked).toFixed(2)),
        roi: row.staked ? Number(((row.returns - row.staked) / row.staked).toFixed(4)) : 0,
        resultPoints: Number(row.resultPoints.toFixed(2)),
        scorePoints: Number(row.scorePoints.toFixed(2)),
      }));
  }

  const rankings = rank(tracks.open);
  return {
    updatedAt: new Date().toISOString(),
    settlement: {
      rule: `match.actual 存在即结算;开赛后 ${settlementGraceMinutes} 分钟仍无 actual 则进入 pending_result 队列`,
      generatedAt: now.toISOString(),
      graceMinutes: settlementGraceMinutes,
      stakeLimits,
      counts: settlementCounts,
      pendingResult,
      nextAction: pendingResult.length
        ? "同步或录入真实赛果后运行 npm run score"
        : "暂无待赛果结算队列",
    },
    rankings,
    open: rankings,
  };
}

function main() {
  loadProjectEnv();
  const input = path.resolve(argValue("input") || DEFAULT_INPUT);
  const output = path.resolve(argValue("output") || DEFAULT_OUTPUT);
  const data = loadMatches(input);
  const settlementGraceMinutes = Number(process.env.SETTLEMENT_GRACE_MINUTES || DEFAULT_SETTLEMENT_GRACE_MINUTES);
  const leaderboard = makeLeaderboard(data.matches || [], { settlementGraceMinutes });
  writeJson(output, leaderboard);
  console.log(`[score] wrote ${output}`);
}

if (require.main === module) main();

module.exports = {
  makeLeaderboard,
  scorePrediction,
  safeStake,
  settlementStatusForMatch,
};
