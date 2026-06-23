const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./lib/env");
const { syncRealData } = require("./sync-real-data");
const { syncJingcaiSingle } = require("./sync-jingcai-single");
const { syncEspnResults } = require("./sync-espn-results");
const { makeLeaderboard } = require("./score");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const LEADERBOARD_PATH = path.join(__dirname, "..", "public", "data", "leaderboard.json");
const DISCUSSIONS_PATH = path.join(__dirname, "..", "public", "data", "discussions.json");
const JINGCAI_PATH = path.join(__dirname, "..", "public", "data", "jingcai-single.json");
const ESPN_RESULTS_PATH = path.join(__dirname, "..", "public", "data", "espn-results.json");
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

function applyActualEntries(data, entries, sourceName, options = {}) {
  const conflicts = Array.isArray(options.conflicts) ? options.conflicts : null;
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
        if (conflicts) {
          conflicts.push({
            matchId: match.id,
            home: match.home && match.home.team,
            away: match.away && match.away.team,
            sourceName,
            sourceScore: score,
            sourceResult: result,
            existingScore: match.actual.score,
            existingResult: match.actual.result,
            sourceLabel: entry.sourceLabel || entry.source || null,
            sourceHref: entry.sourceHref || entry.href || null,
          });
        }
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

function applyJingcaiActuals(data, options = {}) {
  const jingcai = fs.existsSync(JINGCAI_PATH) ? readJson(JINGCAI_PATH) : { matches: [] };
  return applyActualEntries(data, jingcai.matches || [], "jingcai", options);
}

function applyEspnActuals(data, options = {}) {
  const espn = fs.existsSync(ESPN_RESULTS_PATH) ? readJson(ESPN_RESULTS_PATH) : { matches: [] };
  return applyActualEntries(data, espn.matches || [], "espn", options);
}

function applyFallbackActuals(data, options = {}) {
  const fallback = fs.existsSync(RESULT_FALLBACK_PATH) ? readJson(RESULT_FALLBACK_PATH) : { matches: [] };
  return applyActualEntries(data, fallback.matches || [], "local-result-fallback", options);
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function settle() {
  loadProjectEnv();
  try {
    await syncRealData();
  } catch (err) {
    console.warn(`[settle] syncRealData failed; continue with existing matches: ${err.message}`);
  }
  await syncJingcaiSingle({ soft: true });
  try {
    await syncEspnResults({ soft: true });
  } catch (err) {
    console.warn(`[settle] syncEspnResults failed; continue with existing result caches: ${err.message}`);
  }
  const data = readJson(MATCHES_PATH);
  const resultConflicts = [];
  const conflictOptions = { conflicts: resultConflicts };
  const jingcaiActualsChanged = applyJingcaiActuals(data, conflictOptions);
  const espnActualsChanged = applyEspnActuals(data, conflictOptions);
  const fallbackActualsChanged = applyFallbackActuals(data, conflictOptions);
  const actualsChanged = jingcaiActualsChanged + espnActualsChanged + fallbackActualsChanged;
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
  console.log(`[settle] ${matchesChanged ? "wrote" : "unchanged"} ${MATCHES_PATH}; applied_jingcai_actuals=${jingcaiActualsChanged}; applied_espn_actuals=${espnActualsChanged}; applied_fallback_actuals=${fallbackActualsChanged}; applied_total_actuals=${actualsChanged}`);
  console.log(`[settle] ${changed ? "wrote" : "unchanged"} ${LEADERBOARD_PATH}`);
  console.log(`[settle] pending_result=${pending}`);
  if (resultConflicts.length) {
    const conflictText = resultConflicts
      .map((item) => `${item.matchId}:${item.home}-${item.away} existing=${item.existingScore}/${item.existingResult} ${item.sourceName}=${item.sourceScore}/${item.sourceResult}`)
      .join("; ");
    console.warn(`[settle] result_conflicts=${resultConflicts.length}; ${conflictText}`);
    if (hasFlag("fail-on-conflict") || process.env.SETTLE_FAIL_ON_CONFLICT === "1") {
      throw new Error(`[settle] result_conflicts=${resultConflicts.length}; refusing strict settlement publish: ${conflictText}`);
    }
  }
  if (pending && (hasFlag("fail-on-pending") || process.env.SETTLE_FAIL_ON_PENDING === "1")) {
    const ids = (leaderboard.settlement.pendingResult || []).map((item) => `${item.matchId}:${item.home}-${item.away}`).join(", ");
    throw new Error(`[settle] pending_result=${pending}; refusing strict settlement publish: ${ids}`);
  }
}

if (require.main === module) {
  settle().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  applyActualEntries,
  applyEspnActuals,
  applyFallbackActuals,
  applyJingcaiActuals,
  settle,
};
