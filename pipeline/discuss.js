const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/env");
const { callModelText } = require("./predict");

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

function beijingDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateKey, days) {
  const base = new Date(`${dateKey}T00:00:00+08:00`);
  base.setUTCDate(base.getUTCDate() + days);
  return beijingDateKey(base);
}

function parseArgs(argv) {
  const args = { date: addDays(beijingDateKey(), 1), limit: 4, matchId: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--date" && next) {
      args.date = next;
      i += 1;
    } else if (key === "--limit" && next) {
      args.limit = Math.max(1, Number(next) || args.limit);
      i += 1;
    } else if (key === "--match" && next) {
      args.matchId = next;
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
    .slice(0, 180);
}

function oddsLine(match) {
  const odds = match.odds && match.odds.result ? match.odds.result : {};
  return `胜 ${odds.home ?? "未知"} / 平 ${odds.draw ?? "未知"} / 负 ${odds.away ?? "未知"}`;
}

function buildDiscussionPrompt(match, model, previousMessages) {
  const history = previousMessages.length
    ? previousMessages
      .slice(-8)
      .map((message) => `${message.modelName}: ${message.text}`)
      .join("\n")
    : "暂无,你先开场。";
  return `你在「世界杯 AI 擂台」的赛前圆桌群聊里发言。

比赛: ${match.home.team} vs ${match.away.team}
阶段: ${match.stage || "世界杯"}
开赛时间: ${match.kickoff}
胜平负赔率: ${oddsLine(match)}
你的身份: ${model.name},公司/机构: ${model.vendor}

前面群聊:
${history}

请只输出中文自然语言,不要 JSON,不要 Markdown。
你只说两句话:第一句给出你的核心判断,第二句回应或补充一个风险点。
每句话尽量短,总长度不超过 90 个中文字符。`;
}

async function discuss() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const models = readJson(MODELS_PATH, { models: [] }).models.filter((model) => model.enabled !== false);
  const matchesData = readJson(MATCHES_PATH, { matches: [] });
  const existing = readJson(OUTPUT_PATH, { updatedAt: null, mode: "pipeline", discussions: [] });
  const existingDiscussions = existing.discussions || [];
  const targetMatches = (matchesData.matches || [])
    .filter((match) => (args.matchId ? match.id === args.matchId : beijingDateKey(match.kickoff) === args.date))
    .filter((match) => !match.actual)
    .slice(0, args.limit);

  if (!targetMatches.length) {
    console.warn(`[discuss] ${args.matchId || args.date} 没有可讨论的未完赛比赛。`);
    return;
  }

  const nextDiscussions = existingDiscussions.filter((item) => !targetMatches.some((match) => match.id === item.matchId));
  let generated = 0;
  const now = new Date().toISOString();

  for (const match of targetMatches) {
    const messages = [];
    for (const model of models) {
      try {
        const text = await callModelText(model.id, buildDiscussionPrompt(match, model, messages));
        if (!text) {
          console.warn(`[discuss] ${model.id} 缺少 key,跳过`);
          continue;
        }
        const cleaned = cleanText(text);
        if (!cleaned) continue;
        messages.push({
          modelId: model.id,
          modelName: model.name,
          vendor: model.vendor,
          turn: messages.length + 1,
          text: cleaned,
          timestamp: new Date().toISOString(),
        });
        generated += 1;
      } catch (err) {
        console.warn(`[discuss] ${model.id} 失败: ${err.message}`);
      }
    }

    if (messages.length) {
      nextDiscussions.push({
        matchId: match.id,
        sealedAt: now,
        messages,
      });
    }
  }

  if (!generated) {
    console.warn("[discuss] 没有生成任何群聊消息,未写入 discussions.json。请填写至少一个模型 API key 后重试。");
    return;
  }

  writeJson(OUTPUT_PATH, {
    updatedAt: now,
    mode: "pipeline",
    note: "由 pipeline/discuss.js 生成。每条消息来自对应模型 API,用于赛前圆桌展示。",
    discussions: nextDiscussions.sort((a, b) => String(a.matchId).localeCompare(String(b.matchId))),
  });
  console.log(`[discuss] wrote ${OUTPUT_PATH}, messages=${generated}`);
}

if (require.main === module) {
  discuss().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { discuss, buildDiscussionPrompt };
