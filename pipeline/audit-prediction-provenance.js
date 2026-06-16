const fs = require("fs");
const path = require("path");
const {
  discussionPredictionMapFor,
  finalMessagesByModel,
  resultFromDiscussionText,
  scoreFromDiscussionText,
} = require("./score");

const DEFAULT_MATCHES = path.join(__dirname, "..", "public", "data", "matches.json");
const DEFAULT_DISCUSSIONS = path.join(__dirname, "..", "public", "data", "discussions.json");

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function scoreResult(score) {
  const match = String(score || "").match(/^(\d+)-(\d+)$/);
  if (!match) return "";
  const home = Number(match[1]);
  const away = Number(match[2]);
  if (home === away) return "draw";
  return home > away ? "home" : "away";
}

function fixtureName(match) {
  return `${match.home && match.home.team} vs ${match.away && match.away.team}`;
}

function hasBareScoreWithoutDirection(text) {
  return Boolean(scoreFromDiscussionText(text) && !resultFromDiscussionText(text));
}

function audit(match, thread, predictions) {
  const errors = [];
  const warnings = [];
  const finals = finalMessagesByModel(thread.messages || []);
  const finalByModel = new Map(finals.map((message) => [message.modelId, message]));

  predictions.forEach((prediction, modelId) => {
    const message = finalByModel.get(modelId);
    const result = resultFromDiscussionText(message && message.text);
    const score = scoreFromDiscussionText(message && message.text);
    const expectedResult = scoreResult(score);
    if (!message || !result || !score) {
      errors.push({
        type: "missing_source_prediction",
        matchId: match.id,
        fixture: fixtureName(match),
        modelId,
        prediction,
      });
      return;
    }
    if (prediction.result !== result || prediction.score !== score) {
      errors.push({
        type: "source_mismatch",
        matchId: match.id,
        fixture: fixtureName(match),
        modelId,
        prediction,
        parsedFromSource: { result, score },
        text: message.text,
      });
    }
    if (expectedResult && result !== expectedResult) {
      errors.push({
        type: "result_score_conflict",
        matchId: match.id,
        fixture: fixtureName(match),
        modelId,
        result,
        score,
        expectedResult,
        text: message.text,
      });
    }
  });

  (thread.messages || []).forEach((message) => {
    if (hasBareScoreWithoutDirection(message.text)) {
      warnings.push({
        type: "bare_score_not_counted",
        matchId: match.id,
        fixture: fixtureName(match),
        modelId: message.modelId,
        modelName: message.modelName,
        turn: message.turn,
        round: message.round,
        text: message.text,
      });
    }
  });

  return { errors, warnings };
}

function main() {
  const matchesPath = path.resolve(process.argv[2] || DEFAULT_MATCHES);
  const discussionsPath = path.resolve(process.argv[3] || DEFAULT_DISCUSSIONS);
  const matches = readJson(matchesPath, { matches: [] }).matches || [];
  const discussions = readJson(discussionsPath, { discussions: [] }).discussions || [];
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const errors = [];
  const warnings = [];
  let predictionCount = 0;

  discussions.forEach((thread) => {
    const match = matchById.get(thread.matchId);
    if (!match) return;
    const predictions = discussionPredictionMapFor(match, discussions);
    predictionCount += predictions.size;
    const result = audit(match, thread, predictions);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  });

  const summary = {
    ok: errors.length === 0,
    matches: matches.length,
    discussions: discussions.length,
    discussionPredictions: predictionCount,
    warnings: warnings.length,
  };
  if (errors.length) {
    console.error(JSON.stringify({ ...summary, errors }, null, 2));
    process.exit(1);
  }
  console.log(`[audit-prediction-provenance] ok discussions=${discussions.length} predictions=${predictionCount} warnings=${warnings.length}`);
  if (warnings.length) {
    console.log(JSON.stringify({ warnings }, null, 2));
  }
}

if (require.main === module) main();
