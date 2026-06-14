const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./lib/env");
const { syncRealData } = require("./sync-real-data");
const { makeLeaderboard } = require("./score");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const LEADERBOARD_PATH = path.join(__dirname, "..", "public", "data", "leaderboard.json");
const DISCUSSIONS_PATH = path.join(__dirname, "..", "public", "data", "discussions.json");

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

async function settle() {
  loadProjectEnv();
  await syncRealData();
  const data = readJson(MATCHES_PATH);
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
