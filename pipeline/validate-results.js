const fs = require("fs");
const path = require("path");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const JINGCAI_PATH = path.join(__dirname, "..", "public", "data", "jingcai-single.json");
const ESPN_RESULTS_PATH = path.join(__dirname, "..", "public", "data", "espn-results.json");
const RESULT_FALLBACK_PATH = path.join(__dirname, "..", "public", "data", "result-fallback.json");
const {
  SCORE_SCOPE_REGULAR_TIME,
  actualForEntry,
} = require("./result-scope");

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sourceRows() {
  return [
    ["jingcai", readJson(JINGCAI_PATH, { matches: [] }).matches || []],
    ["espn", readJson(ESPN_RESULTS_PATH, { matches: [] }).matches || []],
    ["local-result-fallback", readJson(RESULT_FALLBACK_PATH, { matches: [] }).matches || []],
  ];
}

function validateResultData(data, rowsBySource = sourceRows()) {
  const matches = data.matches || [];
  const byId = new Map(matches.map((match) => [match.id, match]));
  const conflicts = [];

  rowsBySource.forEach(([sourceName, rows]) => {
    (rows || []).forEach((entry) => {
      if (!entry.matchId) return;
      const match = byId.get(entry.matchId);
      if (!match || !match.actual) return;
      const actual = actualForEntry(entry, sourceName);
      if (!actual || actual.scoreScope !== SCORE_SCOPE_REGULAR_TIME) return;
      if (match.actual.score !== actual.score || match.actual.result !== actual.result) {
        conflicts.push({
          matchId: match.id,
          home: match.home && match.home.team,
          away: match.away && match.away.team,
          sourceName,
          existing: match.actual,
          source: { result: actual.result, score: actual.score, scoreScope: actual.scoreScope },
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

  return { conflicts };
}

function validateResults() {
  const matches = readJson(MATCHES_PATH, { matches: [] });
  const rows = sourceRows();
  const result = validateResultData(matches, rows);
  console.log(`[validate-results] ok matches=${(matches.matches || []).length} sources=${rows.map(([, items]) => items.length).join("/")}`);
  return result;
}

if (require.main === module) {
  try {
    validateResults();
  } catch (err) {
    console.error(err.stack || err.message);
    process.exit(1);
  }
}

module.exports = { validateResultData, validateResults };
