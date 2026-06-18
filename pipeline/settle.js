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
const RESULT_FALLBACK_PATH = path.join(__dirname, "..", "public", "data", "result-fallback.json");

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

function scoreForEntry(entry) {
  return normalizedScore(entry.officialScore || entry.score || entry.actualScore);
}

function resultForEntry(entry, score) {
  const explicit = String(entry.result || entry.actualResult || "").trim();
  if (["home", "draw", "away"].includes(explicit)) return explicit;
  return resultFromScore(score);
}

function applyActualEntries(data, entries, sourceName) {
  const byId = new Map((entries || [])
    .filter((entry) => entry.matchId && scoreForEntry(entry))
    .map((entry) => [entry.matchId, entry]));
  let changed = 0;
  (data.matches || []).forEach((match) => {
    const entry = byId.get(match.id);
    if (!entry) return;
    const score = scoreForEntry(entry);
    const result = resultForEntry(entry, score);
    if (!score || !result) return;
    if (match.actual) {
      if (match.actual.score !== score || match.actual.result !== result) {
        console.warn(`[settle] keep existing actual for ${match.id}; ${sourceName}=${score} existing=${match.actual.score}`);
      }
      return;
    }
    match.actual = { result, score };
    match.actualSource = {
      provider: sourceName,
      sourceLabel: entry.sourceLabel || entry.source || null,
      sourceHref: entry.sourceHref || entry.href || null,
      syncedAt: new Date().toISOString(),
    };
    changed += 1;
  });
  return changed;
}

function applyJingcaiActuals(data) {
  const jingcai = fs.existsSync(JINGCAI_PATH) ? readJson(JINGCAI_PATH) : { matches: [] };
  return applyActualEntries(data, jingcai.matches || [], "jingcai");
}

function applyFallbackActuals(data) {
  const fallback = fs.existsSync(RESULT_FALLBACK_PATH) ? readJson(RESULT_FALLBACK_PATH) : { matches: [] };
  return applyActualEntries(data, fallback.matches || [], "local-result-fallback");
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
  const jingcaiActualsChanged = applyJingcaiActuals(data);
  const fallbackActualsChanged = applyFallbackActuals(data);
  const actualsChanged = jingcaiActualsChanged + fallbackActualsChanged;
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
  console.log(`[settle] ${matchesChanged ? "wrote" : "unchanged"} ${MATCHES_PATH}; applied_jingcai_actuals=${jingcaiActualsChanged}; applied_fallback_actuals=${fallbackActualsChanged}`);
  console.log(`[settle] ${changed ? "wrote" : "unchanged"} ${LEADERBOARD_PATH}`);
  console.log(`[settle] pending_result=${pending}`);
}

if (require.main === module) {
  settle().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  applyActualEntries,
  applyFallbackActuals,
  applyJingcaiActuals,
  settle,
};
