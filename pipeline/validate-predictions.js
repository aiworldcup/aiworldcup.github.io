const fs = require("fs");
const path = require("path");
const { discussionPredictionMapFor } = require("./score");

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

function finalMessagesByModel(messages) {
  const finalByModel = {};
  (messages || []).forEach((message) => {
    if (message.modelId) finalByModel[message.modelId] = message;
  });
  return finalByModel;
}

function validateStructuredPredictions(matches) {
  const errors = [];
  matches.forEach((match) => {
    (match.predictions || []).forEach((prediction) => {
      const expected = scoreResult(prediction.score);
      if (prediction.result && expected && prediction.result !== expected) {
        errors.push({
          type: "structured_prediction_conflict",
          status: match.actual ? "settled" : "open",
          matchId: match.id,
          fixture: fixtureName(match),
          modelId: prediction.modelId,
          result: prediction.result,
          score: prediction.score,
          expectedResult: expected,
        });
      }
    });
  });
  return errors;
}

function validateDiscussionPredictions(matches, discussions) {
  const errors = [];
  const threadByMatch = new Map((discussions || []).map((thread) => [thread.matchId, thread]));
  matches.forEach((match) => {
    const predictions = discussionPredictionMapFor(match, discussions);
    const finals = finalMessagesByModel(threadByMatch.get(match.id)?.messages || []);
    predictions.forEach((prediction) => {
      const expected = scoreResult(prediction.score);
      if (prediction.result && expected && prediction.result !== expected) {
        const message = finals[prediction.modelId] || {};
        errors.push({
          type: "discussion_prediction_conflict",
          status: match.actual ? "settled" : "open",
          matchId: match.id,
          fixture: fixtureName(match),
          modelId: prediction.modelId,
          modelName: message.modelName,
          result: prediction.result,
          score: prediction.score,
          expectedResult: expected,
          text: message.text || "",
        });
      }
    });
  });
  return errors;
}

function runParserSmokeTests() {
  const cases = [
    {
      text: "家人们别不信邪！美国主场要爆冷翻车！结论：主负，比分1-2。",
      expected: { result: "away", score: "1-2" },
    },
    {
      text: "沙特主场草皮浇水都能浇出个助攻，1-1闷平，乌拉圭别想偷鸡。",
      expected: { result: "draw", score: "1-1" },
    },
    {
      text: "克罗地亚老球皮上半场控节奏直接磨死三狮，平，比分1-1。",
      expected: { result: "draw", score: "1-1" },
    },
    {
      text: "@MiniMax-M3 客胜？热浪里挪威老将膝盖先软，结论:主胜,比分2-1。",
      expected: { result: "home", score: "2-1" },
    },
    {
      text: "结论:客胜,比分0-1;理由:防反致命",
      expected: { result: "away", score: "0-1" },
    },
  ];
  const fakeMatch = {
    id: "parser-smoke",
    home: { team: "主队" },
    away: { team: "客队" },
    predictions: [],
  };
  const errors = cases.flatMap((item, index) => {
    const discussions = [{
      matchId: fakeMatch.id,
      messages: [{ modelId: `case-${index}`, text: item.text, turn: 1 }],
    }];
    const prediction = discussionPredictionMapFor(fakeMatch, discussions).get(`case-${index}`) || {};
    if (prediction.result === item.expected.result && prediction.score === item.expected.score) return [];
    return [{
      type: "parser_smoke_test_failed",
      case: index + 1,
      text: item.text,
      expected: item.expected,
      actual: { result: prediction.result || "", score: prediction.score || "" },
    }];
  });
  const overwriteDiscussions = [{
    matchId: fakeMatch.id,
    messages: [
      { modelId: "case-overwrite", text: "结论:平局,比分1-1;理由:铁桶拖死", turn: 2 },
      { modelId: "case-overwrite", text: "主队真拿不下2-0。", turn: 1 },
    ],
  }];
  const overwritePrediction = discussionPredictionMapFor(fakeMatch, overwriteDiscussions).get("case-overwrite") || {};
  if (overwritePrediction.result !== "draw" || overwritePrediction.score !== "1-1") {
    errors.push({
      type: "parser_smoke_test_failed",
      case: "overwrite-negated-score",
      text: overwriteDiscussions[0].messages.map((message) => message.text).join(" / "),
      expected: { result: "draw", score: "1-1" },
      actual: { result: overwritePrediction.result || "", score: overwritePrediction.score || "" },
    });
  }
  return errors;
}

function main() {
  const matchesPath = path.resolve(process.argv[2] || DEFAULT_MATCHES);
  const discussionsPath = path.resolve(process.argv[3] || DEFAULT_DISCUSSIONS);
  const matches = readJson(matchesPath, { matches: [] }).matches || [];
  const discussions = readJson(discussionsPath, { discussions: [] }).discussions || [];
  const errors = [
    ...runParserSmokeTests(),
    ...validateStructuredPredictions(matches),
    ...validateDiscussionPredictions(matches, discussions),
  ];
  const open = errors.filter((item) => item.status === "open").length;
  const settled = errors.filter((item) => item.status === "settled").length;
  if (errors.length) {
    console.error(JSON.stringify({
      ok: false,
      errors: errors.length,
      open,
      settled,
      details: errors,
    }, null, 2));
    process.exit(1);
  }
  console.log(`[validate-predictions] ok matches=${matches.length} discussions=${discussions.length}`);
}

if (require.main === module) main();
