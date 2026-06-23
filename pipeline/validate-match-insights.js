const fs = require("fs");
const path = require("path");
const { serializeMatchInsight } = require("./update-match-insights");

const DEFAULT_MATCHES = path.join(__dirname, "..", "public", "data", "matches.json");
const DEFAULT_DISCUSSIONS = path.join(__dirname, "..", "public", "data", "discussions.json");
const DEFAULT_INSIGHTS = path.join(__dirname, "..", "public", "data", "match-insights.json");
const EPS = 0.0025;
const ODDS_EPS = 0.035;

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function near(a, b, eps = EPS) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= eps;
}

function fixtureName(match) {
  return `${match.home && match.home.team} vs ${match.away && match.away.team}`;
}

function validateProbabilities(errors, match, scope, probabilities) {
  if (!probabilities) return;
  const keys = ["home", "draw", "away"];
  keys.forEach((key) => {
    const value = Number(probabilities[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push({
        type: "invalid_probability",
        matchId: match.id,
        fixture: fixtureName(match),
        scope,
        key,
        value: probabilities[key],
      });
    }
  });
  const total = sum(keys.map((key) => probabilities[key]));
  if (!near(total, 1, 0.004)) {
    errors.push({
      type: "probability_sum_not_one",
      matchId: match.id,
      fixture: fixtureName(match),
      scope,
      total,
    });
  }
}

function validateRows(errors, match, edge) {
  if (!edge || edge.status === "missing-odds") return;
  if (!Array.isArray(edge.rows) || edge.rows.length !== 3) {
    errors.push({
      type: "market_edge_rows_missing",
      matchId: match.id,
      fixture: fixtureName(match),
      rows: edge && edge.rows && edge.rows.length,
    });
    return;
  }
  edge.rows.forEach((row) => {
    if (!["home", "draw", "away"].includes(row.key)) {
      errors.push({ type: "market_edge_bad_key", matchId: match.id, fixture: fixtureName(match), key: row.key });
      return;
    }
    const modelProbability = Number(row.modelProbability);
    const marketProbability = Number(row.marketProbability);
    const marketOdds = Number(row.marketOdds);
    const fairOdds = Number(row.fairOdds);
    const ev = Number(row.ev);
    const diff = Number(row.diff ?? row.probabilityDiff);
    if (modelProbability > 0 && !near(fairOdds, 1 / modelProbability, ODDS_EPS)) {
      errors.push({
        type: "fair_odds_formula_mismatch",
        matchId: match.id,
        fixture: fixtureName(match),
        key: row.key,
        fairOdds,
        expected: 1 / modelProbability,
      });
    }
    if (Number.isFinite(modelProbability) && Number.isFinite(marketOdds) && !near(ev, modelProbability * marketOdds - 1, 0.004)) {
      errors.push({
        type: "ev_formula_mismatch",
        matchId: match.id,
        fixture: fixtureName(match),
        key: row.key,
        ev,
        expected: modelProbability * marketOdds - 1,
      });
    }
    if (Number.isFinite(modelProbability) && Number.isFinite(marketProbability) && !near(diff, modelProbability - marketProbability, 0.004)) {
      errors.push({
        type: "probability_diff_formula_mismatch",
        matchId: match.id,
        fixture: fixtureName(match),
        key: row.key,
        diff,
        expected: modelProbability - marketProbability,
      });
    }
  });
}

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["generatedAt", "source"].includes(key))
        .map(([key, item]) => [key, comparable(item)])
    );
  }
  if (typeof value === "number") return Number(value.toFixed(4));
  return value;
}

function validateFreshness(errors, match, discussions, stored) {
  const expected = serializeMatchInsight(match, discussions, stored.generatedAt || "validation");
  const left = comparable(stored);
  const right = comparable(expected);
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    errors.push({
      type: "match_insight_stale",
      matchId: match.id,
      fixture: fixtureName(match),
      hint: "Run npm run insights to regenerate public/data/match-insights.json.",
    });
  }
}

function validateMatchInsights() {
  const matchesPath = path.resolve(process.argv[2] || DEFAULT_MATCHES);
  const discussionsPath = path.resolve(process.argv[3] || DEFAULT_DISCUSSIONS);
  const insightsPath = path.resolve(process.argv[4] || DEFAULT_INSIGHTS);
  const matches = readJson(matchesPath, { matches: [] }).matches || [];
  const discussions = readJson(discussionsPath, { discussions: [] }).discussions || [];
  const data = readJson(insightsPath, { matches: [] });
  const byMatch = new Map((data.matches || []).map((item) => [item.matchId, item]));
  const errors = [];

  matches.forEach((match) => {
    const stored = byMatch.get(match.id);
    if (!stored) {
      errors.push({
        type: "match_insight_missing",
        matchId: match.id,
        fixture: fixtureName(match),
      });
      return;
    }
    const edge = stored.marketEdge || {};
    validateProbabilities(errors, match, "model", edge.modelProbabilities);
    validateProbabilities(errors, match, "market", edge.marketProbabilities);
    validateRows(errors, match, edge);
    validateFreshness(errors, match, discussions, stored);
  });

  if (errors.length) {
    console.error(JSON.stringify({
      ok: false,
      errors: errors.length,
      details: errors,
    }, null, 2));
    process.exit(1);
  }
  console.log(`[validate-match-insights] ok matches=${matches.length} insights=${byMatch.size}`);
}

if (require.main === module) validateMatchInsights();

module.exports = {
  validateMatchInsights,
};
