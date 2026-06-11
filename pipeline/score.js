const fs = require("fs");
const path = require("path");
const { getConfig } = require("./config");
const { loadEnv } = require("./lib/env");

const DEFAULT_INPUT = path.join(__dirname, "..", "public", "data", "matches.json");
const SAMPLE_INPUT = path.join(__dirname, "..", "public", "data", "sample-matches.json");
const DEFAULT_OUTPUT = path.join(__dirname, "..", "public", "data", "leaderboard.json");

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

function safeStake(stake, maxStakePerMatch) {
  const result = Math.max(0, Number(stake && stake.result) || 0);
  const score = Math.max(0, Number(stake && stake.score) || 0);
  const total = result + score;
  if (total <= maxStakePerMatch) return { result, score };
  const ratio = maxStakePerMatch / total;
  return {
    result: result * ratio,
    score: score * ratio,
  };
}

function scorePrediction(match, prediction, maxStakePerMatch) {
  if (!match.actual) return null;
  const stake = safeStake(prediction.stake, maxStakePerMatch);
  const resultOdds = match.odds && match.odds.result ? match.odds.result : {};
  const scoreOdds = match.odds && match.odds.scores ? match.odds.scores : {};
  const resultHit = prediction.result === match.actual.result;
  const scoreHit = prediction.score === match.actual.score;
  const resultPoints = resultHit ? stake.result * (Number(resultOdds[prediction.result]) || 0) : 0;
  const scorePoints = scoreHit ? stake.score * (Number(scoreOdds[prediction.score]) || 0) : 0;
  return {
    points: resultPoints + scorePoints,
    resultHit,
    scoreHit,
  };
}

function makeLeaderboard(matches, options = {}) {
  const maxStake = options.maxStakePerMatch || getConfig().maxStakePerMatch;
  const tracks = { open: new Map() };

  (matches || []).forEach((match) => {
    if (!match.actual) return;
    (match.predictions || []).forEach((prediction) => {
      const track = prediction.track || "open";
      if (!tracks[track]) return;
      const scored = scorePrediction(match, prediction, maxStake);
      if (!scored) return;
      const key = prediction.modelId;
      const row = tracks[track].get(key) || {
        modelId: key,
        points: 0,
        hits: 0,
        scoreHits: 0,
        played: 0,
      };
      row.points += scored.points;
      row.hits += scored.resultHit ? 1 : 0;
      row.scoreHits += scored.scoreHit ? 1 : 0;
      row.played += 1;
      tracks[track].set(key, row);
    });
  });

  function rank(map) {
    return Array.from(map.values())
      .sort((a, b) => b.points - a.points || b.hits - a.hits || a.modelId.localeCompare(b.modelId))
      .map((row, index) => ({
        rank: index + 1,
        modelId: row.modelId,
        points: Number(row.points.toFixed(2)),
        hits: row.hits,
        scoreHits: row.scoreHits,
        played: row.played,
      }));
  }

  const rankings = rank(tracks.open);
  return {
    updatedAt: new Date().toISOString(),
    rankings,
    open: rankings,
  };
}

function main() {
  loadEnv();
  const input = path.resolve(argValue("input") || DEFAULT_INPUT);
  const output = path.resolve(argValue("output") || DEFAULT_OUTPUT);
  const data = loadMatches(input);
  const leaderboard = makeLeaderboard(data.matches || []);
  writeJson(output, leaderboard);
  console.log(`[score] wrote ${output}`);
}

if (require.main === module) main();

module.exports = {
  makeLeaderboard,
  scorePrediction,
  safeStake,
};
