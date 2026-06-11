const fs = require("fs");
const path = require("path");
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

function predictionMapFor(match, track = "open") {
  const map = new Map();
  (match.predictions || []).forEach((prediction) => {
    if ((prediction.track || "open") === track && prediction.modelId) map.set(prediction.modelId, prediction);
  });
  return map;
}

function makeRows(modelIds) {
  const rows = new Map();
  modelIds.forEach((modelId) => {
    rows.set(modelId, {
      modelId,
      predictions: 0,
      resultHits: 0,
      scoreHits: 0,
      settledMatches: 0,
    });
  });
  return rows;
}

function rowFor(rows, modelId) {
  if (!rows.has(modelId)) {
    rows.set(modelId, {
      modelId,
      predictions: 0,
      resultHits: 0,
      scoreHits: 0,
      settledMatches: 0,
    });
  }
  return rows.get(modelId);
}

function withRates(row, kind = "result") {
  const predictions = row.predictions || 0;
  const resultHitRate = predictions ? Number((row.resultHits / predictions).toFixed(4)) : 0;
  const scoreHitRate = predictions ? Number((row.scoreHits / predictions).toFixed(4)) : 0;
  const metricHits = kind === "score" ? row.scoreHits : row.resultHits;
  const metricHitRate = kind === "score" ? scoreHitRate : resultHitRate;
  return {
    ...row,
    metric: kind,
    hits: metricHits,
    played: predictions,
    hitRate: metricHitRate,
    resultHitRate,
    scoreHitRate,
  };
}

function rankResult(rows) {
  return Array.from(rows.values())
    .map((row) => withRates(row, "result"))
    .sort((a, b) =>
      b.resultHitRate - a.resultHitRate ||
      b.resultHits - a.resultHits ||
      b.predictions - a.predictions ||
      b.scoreHits - a.scoreHits ||
      a.modelId.localeCompare(b.modelId)
    )
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function rankScore(rows) {
  return Array.from(rows.values())
    .map((row) => withRates(row, "score"))
    .sort((a, b) =>
      b.scoreHits - a.scoreHits ||
      b.scoreHitRate - a.scoreHitRate ||
      b.predictions - a.predictions ||
      a.modelId.localeCompare(b.modelId)
    )
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function makeLeaderboard(matches, options = {}) {
  const settlementGraceMinutes = options.settlementGraceMinutes || DEFAULT_SETTLEMENT_GRACE_MINUTES;
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const settlementCounts = {};
  const pendingResult = [];
  const predictionModelIds = new Set();

  (matches || []).forEach((match) => {
    (match.predictions || []).forEach((prediction) => {
      if ((prediction.track || "open") === "open" && prediction.modelId) predictionModelIds.add(prediction.modelId);
    });
  });
  const modelIds = Array.from(new Set([...(options.modelIds || []), ...predictionModelIds]));
  const rows = makeRows(modelIds);

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

    const predictions = predictionMapFor(match, "open");
    modelIds.forEach((modelId) => {
      const row = rowFor(rows, modelId);
      row.settledMatches += 1;
      const prediction = predictions.get(modelId);
      if (!prediction) return;
      row.predictions += 1;
      if (prediction.result === match.actual.result) row.resultHits += 1;
      if (prediction.score === match.actual.score) row.scoreHits += 1;
    });
  });

  const resultRankings = rankResult(rows);
  const scoreRankings = rankScore(rows);
  return {
    updatedAt: new Date().toISOString(),
    settlement: {
      rule: `match.actual 存在即结算;开赛后 ${settlementGraceMinutes} 分钟仍无 actual 则进入 pending_result 队列`,
      generatedAt: now.toISOString(),
      graceMinutes: settlementGraceMinutes,
      scoring: "赛果榜按胜平负命中率排序;比分榜按具体比分命中数排序。不再使用下注、积分或赔率结算。",
      counts: settlementCounts,
      pendingResult,
      nextAction: pendingResult.length
        ? "同步或录入真实赛果后运行 npm run score"
        : "暂无待赛果结算队列",
    },
    resultRankings,
    scoreRankings,
    rankings: resultRankings,
    open: resultRankings,
  };
}

function main() {
  loadProjectEnv();
  const input = path.resolve(argValue("input") || DEFAULT_INPUT);
  const output = path.resolve(argValue("output") || DEFAULT_OUTPUT);
  const data = loadMatches(input);
  const settlementGraceMinutes = Number(process.env.SETTLEMENT_GRACE_MINUTES || DEFAULT_SETTLEMENT_GRACE_MINUTES);
  const leaderboard = makeLeaderboard(data.matches || [], {
    settlementGraceMinutes,
  });
  writeJson(output, leaderboard);
  console.log(`[score] wrote ${output}`);
}

if (require.main === module) main();

module.exports = {
  makeLeaderboard,
  settlementStatusForMatch,
};
