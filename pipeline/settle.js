const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./lib/env");
const { syncRealData } = require("./sync-real-data");
const { syncJingcaiSingle } = require("./sync-jingcai-single");
const { makeLeaderboard } = require("./score");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const LEADERBOARD_PATH = path.join(__dirname, "..", "public", "data", "leaderboard.json");
const DISCUSSIONS_PATH = path.join(__dirname, "..", "public", "data", "discussions.json");
const JINGCAI_PATH = path.join(__dirname, "..", "public", "data", "jingcai-single.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["updatedAt", "generatedAt"].includes(key))
      .map(([key, item]) => [key, comparable(item)])
  );
}

function writeJsonIfChanged(filePath, data) {
  if (fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (JSON.stringify(comparable(existing)) === JSON.stringify(comparable(data))) return false;
    } catch (_) {
      // Rewrite invalid JSON.
    }
  }
  writeJson(filePath, data);
  return true;
}

function resultFromScore(score) {
  const match = String(score || "").match(/^(\d+)-(\d+)$/);
  if (!match) return "";
  const home = Number(match[1]);
  const away = Number(match[2]);
  if (home === away) return "draw";
  return home > away ? "home" : "away";
}

function normalizedScore(value) {
  const match = String(value || "").trim().match(/^(\d+)\s*[:-]\s*(\d+)$/);
  if (!match) return "";
  return `${Number(match[1])}-${Number(match[2])}`;
}

function applyJingcaiActuals(data) {
  const jingcai = fs.existsSync(JINGCAI_PATH) ? readJson(JINGCAI_PATH) : { matches: [] };
  const byId = new Map((jingcai.matches || [])
    .filter((entry) => entry.matchId && entry.officialScore)
    .map((entry) => [entry.matchId, entry]));
  let changed = 0;
  (data.matches || []).forEach((match) => {
    const entry = byId.get(match.id);
    if (!entry) return;
    const score = normalizedScore(entry.officialScore);
    const result = resultFromScore(score);
    if (!score || !result) return;
    if (match.actual) {
      if (match.actual.score !== score || match.actual.result !== result) {
        console.warn(`[settle] keep existing actual for ${match.id}; jingcai=${score} existing=${match.actual.score}`);
      }
      return;
    }
    match.actual = { result, score };
    changed += 1;
  });
  return changed;
}

async function settle() {
  loadProjectEnv();
  try {
    await syncRealData();
  } catch (err) {
    console.warn(`[settle] syncRealData failed; continue with existing matches: ${err.message}`);
  }
  await syncJingcaiSingle({ soft: true });
  const data = readJson(MATCHES_PATH);
  const actualsChanged = applyJingcaiActuals(data);
  const matchesChanged = writeJsonIfChanged(MATCHES_PATH, data);
  const discussionsData = fs.existsSync(DISCUSSIONS_PATH) ? readJson(DISCUSSIONS_PATH) : { discussions: [] };
  const settlementGraceMinutes = Number(process.env.SETTLEMENT_GRACE_MINUTES || 150);
  const leaderboard = makeLeaderboard(data.matches || [], {
    discussions: discussionsData.discussions || [],
    settlementGraceMinutes,
  });
  const changed = writeJsonIfChanged(LEADERBOARD_PATH, leaderboard);
  const pending = leaderboard.settlement && leaderboard.settlement.pendingResult
    ? leaderboard.settlement.pendingResult.length
    : 0;
  console.log(`[settle] ${matchesChanged ? "wrote" : "unchanged"} ${MATCHES_PATH}; applied_jingcai_actuals=${actualsChanged}`);
  console.log(`[settle] ${changed ? "wrote" : "unchanged"} ${LEADERBOARD_PATH}`);
  console.log(`[settle] pending_result=${pending}`);
}

if (require.main === module) {
  settle().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { settle };
