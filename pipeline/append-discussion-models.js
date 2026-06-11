const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./lib/env");
const { callModelText } = require("./predict");
const { buildDiscussionPrompt, turnBudget } = require("./discuss");

const MODELS_PATH = path.join(__dirname, "..", "public", "data", "models.json");
const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "discussions.json");

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function parseArgs(argv) {
  const args = { matchId: "", modelIds: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--match" && next) {
      args.matchId = next;
      i += 1;
    } else if (key === "--models" && next) {
      args.modelIds = next.split(",").map((item) => item.trim()).filter(Boolean);
      i += 1;
    }
  }
  return args;
}

function cleanText(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*["'“”]+|["'“”]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function hasFinalPrediction(value) {
  const text = String(value || "");
  const hasResult = /(主胜|客胜|平局|打平|平|胜|负)/.test(text);
  const hasScore = /[0-9０-９一二三四五六七八九零〇]+\s*[-:：比]\s*[0-9０-９一二三四五六七八九零〇]+/.test(text);
  return hasResult && hasScore;
}

function buildFinalRetryPrompt(match, model) {
  return `你是${model.name},正在聊${match.home.team} vs ${match.away.team}。
只输出一句中文,必须包含胜平负方向和具体比分。
格式类似:结论主胜,比分2-1。`;
}

async function appendDiscussionModels() {
  loadProjectEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.matchId || !args.modelIds.length) {
    throw new Error("用法: node pipeline/append-discussion-models.js --match fixture-id --models model-a,model-b");
  }

  const modelsData = readJson(MODELS_PATH, { models: [] }).models;
  const matches = readJson(MATCHES_PATH, { matches: [] }).matches;
  const output = readJson(OUTPUT_PATH, { updatedAt: null, mode: "pipeline", discussions: [] });
  const match = matches.find((item) => item.id === args.matchId);
  if (!match) throw new Error(`找不到比赛: ${args.matchId}`);

  let thread = output.discussions.find((item) => item.matchId === args.matchId);
  if (!thread) {
    thread = { matchId: args.matchId, sealedAt: null, messages: [] };
    output.discussions.push(thread);
  }

  const models = args.modelIds.map((id) => {
    const model = modelsData.find((item) => item.id === id);
    if (!model) throw new Error(`找不到模型: ${id}`);
    return model;
  });

  for (const model of models) {
    for (let round = 1; round <= turnBudget(model.id); round += 1) {
      const isFinalTurn = round >= turnBudget(model.id);
      let text = await callModelText(model.id, buildDiscussionPrompt(match, model, thread.messages, round, isFinalTurn));
      let cleaned = cleanText(text);
      if (isFinalTurn && !hasFinalPrediction(cleaned)) {
        text = await callModelText(model.id, buildFinalRetryPrompt(match, model));
        cleaned = cleanText(text);
      }
      if (isFinalTurn && !hasFinalPrediction(cleaned)) {
        throw new Error(`${model.id} 最后发言缺少预测/比分: ${cleaned}`);
      }
      if (!cleaned) throw new Error(`${model.id} 返回空文本`);
      thread.messages.push({
        modelId: model.id,
        modelName: model.name,
        vendor: model.vendor,
        turn: thread.messages.length + 1,
        round,
        text: cleaned,
        timestamp: new Date().toISOString(),
      });
      console.log(`[append-discussion] ${model.id} r${round}: ${cleaned}`);
    }
  }

  const now = new Date().toISOString();
  thread.sealedAt = now;
  output.updatedAt = now;
  writeJson(OUTPUT_PATH, output);
}

if (require.main === module) {
  appendDiscussionModels().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { appendDiscussionModels };
