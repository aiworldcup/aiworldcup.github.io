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
  if (/结论[:：]?\s*(平局|打平|平)/.test(value) || /冷平|逼平/.test(value)) return "draw";
  if (/结论[:：]?\s*(客胜|客队胜|负)/.test(value)) return "away";
  if (/结论[:：]?\s*(主胜|主队胜|胜)/.test(value)) return "home";
  if (/平局|打平/.test(value)) return "draw";
  if (/客胜|客队/.test(value)) return "away";
  if (/主胜|主场|主队/.test(value)) return "home";
  return "";
}

function scoreFromDiscussionText(text) {
  const matches = Array.from(String(text || "").matchAll(/[0-9０-９一二三四五六七八九零〇]+\s*[-:：比]\s*[0-9０-９一二三四五六七八九零〇]+/g));
  const match = matches[matches.length - 1];
  if (!match) return "";
  return match[0]
    .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[：比]/g, "-")
    .replace(/\s+/g, "");
}

function finalMessagesByModel(messages) {
  const finalByModel = {};
  (messages || []).forEach(message => {
    if (message.modelId) finalByModel[message.modelId] = message;
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

