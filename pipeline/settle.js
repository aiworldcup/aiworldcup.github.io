const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./lib/env");
const { syncRealData } = require("./sync-real-data");
const { loadEnabledModelIds, makeLeaderboard } = require("./score");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const LEADERBOARD_PATH = path.join(__dirname, "..", "public", "data", "leaderboard.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function settle() {
  loadProjectEnv();
  await syncRealData();
  const data = readJson(MATCHES_PATH);
  const settlementGraceMinutes = Number(process.env.SETTLEMENT_GRACE_MINUTES || 150);
  const leaderboard = makeLeaderboard(data.matches || [], {
    settlementGraceMinutes,
    modelIds: loadEnabledModelIds(),
  });
  writeJson(LEADERBOARD_PATH, leaderboard);
  const pending = leaderboard.settlement && leaderboard.settlement.pendingResult
    ? leaderboard.settlement.pendingResult.length
    : 0;
  console.log(`[settle] wrote ${LEADERBOARD_PATH}`);
  console.log(`[settle] pending_result=${pending}`);
}

if (require.main === module) {
  settle().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { settle };
