const fs = require("fs");
const path = require("path");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const DISCUSSIONS_PATH = path.join(__dirname, "..", "public", "data", "discussions.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function resultFromDiscussionText(text) {
  const value = String(text || "");
  const directionPattern = "(主负|主队负|客胜|客队胜|负|主胜|主队胜|胜|平局|打平|闷平|冷平|逼平|平)";
  const marked = value.match(new RegExp(`(?:结论|预测|看好|我站|我押|我买|我信|我赌|倾向|更倾向|最终|收束)[:：]?\\s*[^。！？!?；;]{0,20}?${directionPattern}`));
  if (marked) return resultFromDirectionToken(marked[1]);
  const nearScore = value.match(new RegExp(`${directionPattern}(?![？?])\\s*(?:[,，、:：;；-]\\s*)?(?:比分)?\\s*[0-9０-９一二三四五六七八九零〇]+\\s*[-:：比]\\s*[0-9０-９一二三四五六七八九零〇]+`));
  if (nearScore) return resultFromDirectionToken(nearScore[1]);
  if (/闷平|冷平|逼平|打平|平局/.test(value)) return "draw";
  if (/主负|主队负|客胜(?![？?])|客队胜/.test(value)) return "away";
  if (/主胜(?![？?])|主队胜/.test(value)) return "home";
  return "";
}

function resultFromDirectionToken(token) {
  const value = String(token || "");
  if (/平局|打平|闷平|冷平|逼平|^平$/.test(value)) return "draw";
  if (/主负|主队负|客胜|客队胜|^负$/.test(value)) return "away";
  if (/主胜|主队胜|^胜$/.test(value)) return "home";
  return "";
}

function scoreResultFromScore(score) {
  const match = String(score || "").match(/^(\d+)-(\d+)$/);
  if (!match) return "";
  const home = Number(match[1]);
  const away = Number(match[2]);
  if (home === away) return "draw";
  return home > away ? "home" : "away";
}

function scoreFromDiscussionText(text) {
  const matches = Array.from(String(text || "").matchAll(/[0-9０-９一二三四五六七八九零〇]+\s*[-:：比]\s*[0-9０-９一二三四五六七八九零〇]+/g));
  const match = matches[matches.length - 1];
  if (!match) return "";
  return match[0]
    .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[:：比]/g, "-")
    .replace(/\s+/g, "");
}

function hasDiscussionPrediction(message) {
  return Boolean(resultFromDiscussionText(message && message.text) && scoreFromDiscussionText(message && message.text));
}

function finalMessagesByModel(messages) {
  const finalByModel = {};
  (messages || []).forEach(message => {
    if (!message.modelId) return;
    const current = finalByModel[message.modelId];
    if (hasDiscussionPrediction(message) || !hasDiscussionPrediction(current)) {
      finalByModel[message.modelId] = message;
    }
  });
  return Object.values(finalByModel).sort((a, b) => (a.turn || 0) - (b.turn || 0));
}

function oppositeMiss(predicted, actual) {
  return (actual === "home" && predicted === "away") || (actual === "away" && predicted === "home");
}

function makeHook(match, godModels, faceSlapModels) {
  if (godModels.length) {
    const names = godModels.slice(0, 2).map(item => item.modelName).join("、");
    return `${names} 精确命中 ${match.actual.score},这场直接封神`;
  }
  if (faceSlapModels.length) {
    const names = faceSlapModels.slice(0, 2).map(item => item.modelName).join("、");
    return `${names} 赛前方向猜反,赛后打脸现场`;
  }
  return `${match.home.team} ${match.actual.score} ${match.away.team},圆桌预测赛后复盘`;
}

function recapFor(match, thread) {
  const finals = finalMessagesByModel(thread.messages || []);
  const godModels = [];
  const faceSlapModels = [];
  finals.forEach(message => {
    const predictedResult = resultFromDiscussionText(message.text);
    const predictedScore = scoreFromDiscussionText(message.text);
    if (!predictedResult) return;
    const item = {
      modelId: message.modelId,
      modelName: message.modelName || message.modelId,
      predictedResult,
      predictedScore,
      text: message.text,
    };
    if (predictedResult === match.actual.result && predictedScore === match.actual.score) {
      godModels.push(item);
    } else if (oppositeMiss(predictedResult, match.actual.result)) {
      faceSlapModels.push(item);
    }
  });
  return {
    generatedAt: new Date().toISOString(),
    actual: match.actual,
    godModels,
    faceSlapModels,
    hookText: makeHook(match, godModels, faceSlapModels),
  };
}

function main() {
  const matches = readJson(MATCHES_PATH).matches || [];
  const discussions = readJson(DISCUSSIONS_PATH);
  const byId = new Map(matches.map(match => [match.id, match]));
  let updated = 0;
  discussions.discussions = (discussions.discussions || []).map(thread => {
    const match = byId.get(thread.matchId);
    if (!match || !match.actual || !(thread.messages || []).length) return thread;
    updated += 1;
    return {
      ...thread,
      recap: recapFor(match, thread),
    };
  });
  discussions.updatedAt = discussions.updatedAt || new Date().toISOString();
  writeJson(DISCUSSIONS_PATH, discussions);
  console.log(`[recap] updated ${updated} discussion recap fields`);
}

if (require.main === module) main();
