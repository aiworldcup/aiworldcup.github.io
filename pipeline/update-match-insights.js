const fs = require("fs");
const path = require("path");
const insights = require("../public/match-insights");
const { discussionPredictionMapFor } = require("./score");

const DEFAULT_MATCHES = path.join(__dirname, "..", "public", "data", "matches.json");
const DEFAULT_DISCUSSIONS = path.join(__dirname, "..", "public", "data", "discussions.json");
const DEFAULT_OUTPUT = path.join(__dirname, "..", "public", "data", "match-insights.json");

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function roundNumber(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function prune(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => prune(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const next = {};
    Object.entries(value).forEach(([key, item]) => {
      const pruned = prune(item);
      if (pruned !== undefined) next[key] = pruned;
    });
    return next;
  }
  if (typeof value === "number") return roundNumber(value);
  if (value === undefined) return undefined;
  return value;
}

function beijingDateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function predictionsForMatch(match, discussions) {
  const sealed = (match.predictions || [])
    .filter((prediction) => (prediction.track || "open") === "open" && prediction.modelId);
  if (sealed.length) return sealed;
  return Array.from(discussionPredictionMapFor(match, discussions).values());
}

function targetMatches(matches) {
  const date = argValue("date");
  const matchIds = new Set([
    ...parseList(argValue("match")),
    ...parseList(argValue("matches")),
  ]);
  return matches.filter((match) => {
    if (matchIds.size && !matchIds.has(match.id)) return false;
    if (date && beijingDateKey(match.kickoff) !== date) return false;
    return true;
  });
}

function serializeMatchInsight(match, discussions, generatedAt) {
  const predictions = predictionsForMatch(match, discussions);
  const content = insights.buildMatchContent(match, predictions);
  const edge = content.marketEdge || {};
  return prune({
    matchId: match.id,
    generatedAt,
    source: {
      predictionSource: predictions.some((prediction) => prediction.source === "discussion") ? "discussion" : "sealed",
      predictionCount: predictions.length,
      oddsProvider: match.odds && match.odds.provider || null,
      oddsSyncedAt: match.odds && match.odds.syncedAt || null,
      actualStatus: match.actual ? "settled" : "pre_match",
    },
    marketEdge: {
      status: edge.status,
      direction: edge.direction,
      valueSide: edge.valueSide,
      shortLabel: edge.shortLabel,
      confidence: edge.confidence,
      riskLevel: edge.riskLevel,
      marketDirection: edge.marketDirection,
      suggestion: edge.suggestion,
      sourceLabel: edge.sourceLabel,
      modelSource: edge.modelSource,
      sampleSize: edge.sampleSize,
      modelProbabilities: edge.modelProbabilities,
      marketProbabilities: edge.marketProbabilities,
      overround: edge.overround,
      primary: edge.primary,
      rows: edge.rows,
    },
  });
}

function mergeInsights(existing, updates, replaceAll) {
  if (replaceAll) return updates;
  const byMatch = new Map((existing.matches || []).map((item) => [item.matchId, item]));
  updates.forEach((item) => byMatch.set(item.matchId, item));
  return Array.from(byMatch.values());
}

function summarize(matches) {
  const counts = matches.reduce((acc, item) => {
    const status = item.marketEdge && item.marketEdge.status || "unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const valueDirections = matches
    .filter((item) => item.marketEdge && !["watch", "missing-odds"].includes(item.marketEdge.status))
    .map((item) => ({
      matchId: item.matchId,
      valueSide: item.marketEdge.shortLabel,
      ev: item.marketEdge.primary && item.marketEdge.primary.ev,
      probabilityDiff: item.marketEdge.primary && item.marketEdge.primary.diff,
    }));
  return { counts, valueDirections };
}

function updateMatchInsights() {
  const matchesPath = path.resolve(argValue("input", DEFAULT_MATCHES));
  const discussionsPath = path.resolve(argValue("discussions", DEFAULT_DISCUSSIONS));
  const outputPath = path.resolve(argValue("output", DEFAULT_OUTPUT));
  const dryRun = hasFlag("dry-run");
  const matchesData = readJson(matchesPath, { matches: [] });
  const discussionsData = readJson(discussionsPath, { discussions: [] });
  const existing = readJson(outputPath, { matches: [] });
  const matches = matchesData.matches || [];
  const targets = targetMatches(matches);
  const generatedAt = new Date().toISOString();
  const updates = targets.map((match) => serializeMatchInsight(match, discussionsData.discussions || [], generatedAt));
  const replaceAll = updates.length === matches.length;
  const mergedMatches = mergeInsights(existing, updates, replaceAll);
  const summary = summarize(updates);
  const output = {
    version: 1,
    updatedAt: generatedAt,
    source: {
      matchesPath: path.relative(path.join(__dirname, ".."), matchesPath),
      discussionsPath: path.relative(path.join(__dirname, ".."), discussionsPath),
      rule: "盘口博弈指数仅用于展示:模型概率 vs 市场归一概率,不参与排行榜结算。",
    },
    summary: {
      targetMatches: targets.length,
      totalMatches: mergedMatches.length,
      ...summary,
    },
    matches: mergedMatches,
  };

  if (!targets.length) {
    console.log("[match-insights] no target matches");
    return output;
  }
  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      output: outputPath,
      summary: output.summary,
    }, null, 2));
    return output;
  }
  writeJson(outputPath, output);
  console.log(`[match-insights] wrote ${outputPath}, targets=${targets.length}, total=${mergedMatches.length}`);
  return output;
}

if (require.main === module) {
  try {
    updateMatchInsights();
  } catch (err) {
    console.error(err.stack || err.message);
    process.exit(1);
  }
}

module.exports = {
  updateMatchInsights,
  serializeMatchInsight,
  predictionsForMatch,
};
