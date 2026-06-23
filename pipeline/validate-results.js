const fs = require("fs");
const path = require("path");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const JINGCAI_PATH = path.join(__dirname, "..", "public", "data", "jingcai-single.json");
const ESPN_RESULTS_PATH = path.join(__dirname, "..", "public", "data", "espn-results.json");
const RESULT_FALLBACK_PATH = path.join(__dirname, "..", "public", "data", "result-fallback.json");

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizedScore(value) {
  const match = String(value || "").trim().match(/^(\d+)\s*[:-]\s*(\d+)$/);
  if (!match) return "";
  return `${Number(match[1])}-${Number(match[2])}`;
}

function resultFromScore(score) {
  const match = String(score || "").match(/^(\d+)-(\d+)$/);
  if (!match) return "";
  const home = Number(match[1]);
  const away = Number(match[2]);
  if (home === away) return "draw";
  return home > away ? "home" : "away";
}

function scoreForEntry(entry) {
  return normalizedScore(entry.officialScore || entry.score || entry.actualScore);
}

function resultForEntry(entry, score) {
  const explicit = String(entry.result || entry.actualResult || "").trim();
  if (["home", "draw", "away"].includes(explicit)) return explicit;
  return resultFromScore(score);
}

function sourceRows() {
  return [
    ["jingcai", readJson(JINGCAI_PATH, { matches: [] }).matches || []],
    ["espn", readJson(ESPN_RESULTS_PATH, { matches: [] }).matches || []],
    ["local-result-fallback", readJson(RESULT_FALLBACK_PATH, { matches: [] }).matches || []],
  ];
}

function validateResults() {
  const matches = readJson(MATCHES_PATH, { matches: [] }).matches || [];
  const byId = new Map(matches.map((match) => [match.id, match]));
  const conflicts = [];

  sourceRows().forEach(([sourceName, rows]) => {
    (rows || []).forEach((entry) => {
      if (!entry.matchId) return;
      const match = byId.get(entry.matchId);
      if (!match || !match.actual) return;
      const score = scoreForEntry(entry);
      const result = resultForEntry(entry, score);
      if (!score || !result) return;
      if (match.actual.score !== score || match.actual.result !== result) {
        conflicts.push({
          matchId: match.id,
          home: match.home && match.home.team,
          away: match.away && match.away.team,
          sourceName,
          existing: match.actual,
          source: { result, score },
        });
      }
    });
  });

  if (conflicts.length) {
    conflicts.forEach((item) => {
      console.error(`[validate-results] conflict ${item.matchId} ${item.home}-${item.away}: matches=${item.existing.score}/${item.existing.result} ${item.sourceName}=${item.source.score}/${item.source.result}`);
    });
    throw new Error(`[validate-results] result source conflicts=${conflicts.length}`);
  }

  console.log(`[validate-results] ok matches=${matches.length} sources=${sourceRows().map(([, rows]) => rows.length).join("/")}`);
  return { conflicts };
}

if (require.main === module) {
  try {
    validateResults();
  } catch (err) {
    console.error(err.stack || err.message);
    process.exit(1);
  }
}

module.exports = { validateResults };
