const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/env");
const { callModelText } = require("./predict");

const MODELS_PATH = path.join(__dirname, "..", "public", "data", "models.json");
const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "discussions.json");

const STYLE_PROFILES = {
  "claude-fable-5": "像战术评论员,短促、有画面感,敢下判断。",
  "claude-opus-4-8": "像冷静的赔率分析师,克制、结构化,会指出概率和风险。",
  "gpt-5-5": "像主持人型分析师,会归纳分歧并推动讨论。",
  "gemini-3-1": "像数据记者,关注赛程、节奏和外部变量。",
  "qwen-3-7-max": "像务实竞彩玩家,重视赔率性价比和冷门概率。",
  "minimax-m3": "像快嘴球迷,表达直接,会抛出反直觉看法。",
  "kimi-k2-6": "像细节派观察员,抓阵型、空间和比赛走势。",
  "mimo-v2-5-pro": "像轻量但敏锐的助理教练,句子短,会补充具体风险点。",
  "grok-4-3": "像挑刺的反方嘉宾,会质疑共识。",
  "muse-spark": "像内容策划,更会提炼传播点和戏剧性。",
  "claude-sonnet-4-6": "像平衡派分析师,稳健,会调和乐观与谨慎。",
  "deepseek-v4pro": "像推演派,喜欢从攻防转换和比赛脚本切入。",
  "glm-5-1": "像中文体育编辑,表达顺滑,会做清晰结论。",
  "doubao-seed-1-5-thinking-pro": "像短视频解说,口语化,抓重点和悬念。",
};

function turnBudget(modelId) {
  if (modelId === "claude-fable-5") return 1;
  if (modelId === "claude-opus-4-8") return 2;
  return 3;
}

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
  const args = { date: addDays(beijingDateKey(), 1), limit: 4, matchId: "", modelIds: [] };
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

function oddsLine(match) {
  const odds = match.odds && match.odds.result ? match.odds.result : {};
  return `胜 ${odds.home ?? "未知"} / 平 ${odds.draw ?? "未知"} / 负 ${odds.away ?? "未知"}`;
}

function buildDiscussionPrompt(match, model, previousMessages, round, isFinalTurn = false) {
  const history = previousMessages.length
    ? previousMessages
      .slice(-10)
      .map((message) => `${message.modelName}: ${message.text}`)
      .join("\n")
    : "暂无,你先开场。";
  const style = STYLE_PROFILES[model.id] || "像冷静的赛前观察员,表达简短,不要套话。";
  const relationRule = previousMessages.length
    ? "必须接住前面至少一位 AI 的观点:可以同意、反驳、补充遗漏风险,但不要重复原话。"
    : "你负责开场,给出一个明确判断,为后面的 AI 留出可讨论的风险点。";
  const finalRule = isFinalTurn
    ? "\n这是你本场最后一次发言,必须导向预测结论,并包含胜平负方向和具体比分,格式可类似:「结论:主胜,比分 2-1」。"
    : "";
  return `你在「世界杯 AI 擂台」的赛前圆桌群聊里发言。

比赛: ${match.home.team} vs ${match.away.team}
阶段: ${match.stage || "世界杯"}
开赛时间: ${match.kickoff}
胜平负赔率: ${oddsLine(match)}
你的身份: ${model.name},公司/机构: ${model.vendor}
你的语言风格: ${style}
这是你本场第 ${round} 次发言。

前面群聊:
${history}

请只输出中文自然语言,不要 JSON,不要 Markdown。
${relationRule}
你这次只说一句话,不超过 45 个中文字符。${finalRule}`;
}

function buildRetryPrompt(match, model, previousMessages, round, isFinalTurn = false) {
  const last = previousMessages[previousMessages.length - 1];
  const lastLine = last ? `${last.modelName}: ${last.text}` : "暂无。";
  const style = STYLE_PROFILES[model.id] || "简短直接。";
  const finalRule = isFinalTurn
    ? "这是你最后一句,必须给出胜平负方向和比分,例如:结论主胜,比分2-1。"
    : "必须回应上一句或补充一个新风险。";
  return `你是${model.name},正在聊${match.home.team} vs ${match.away.team}。
你的风格:${style}
上一句:${lastLine}
这是你本场第 ${round} 次发言。
${finalRule}
只输出一句中文短句,不超过 35 个中文字符。`;
}

function buildTurnSchedule(models) {
  const budgets = new Map(models.map((model) => [model.id, turnBudget(model.id)]));
  const turns = [];
  let hasTurn = true;
  for (let round = 1; hasTurn; round += 1) {
    hasTurn = false;
    for (const model of models) {
      if ((budgets.get(model.id) || 0) >= round) {
        turns.push({ model, round });
        hasTurn = true;
      }
    }
  }
  return turns;
}

async function discuss() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const models = readJson(MODELS_PATH, { models: [] }).models
    .filter((model) => model.enabled !== false)
    .filter((model) => !args.modelIds.length || args.modelIds.includes(model.id));
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
    const turns = buildTurnSchedule(models);
    for (const { model, round } of turns) {
      const isFinalTurn = round >= turnBudget(model.id);
      try {
        let text = await callModelText(model.id, buildDiscussionPrompt(match, model, messages, round, isFinalTurn));
        if (text === null) {
          console.warn(`[discuss] ${model.id} 缺少 key,跳过`);
          continue;
        }
        let cleaned = cleanText(text);
        if (!cleaned || (isFinalTurn && !hasFinalPrediction(cleaned))) {
          text = await callModelText(model.id, buildRetryPrompt(match, model, messages, round, isFinalTurn));
          cleaned = cleanText(text);
        }
        if (isFinalTurn && cleaned && !hasFinalPrediction(cleaned)) {
          console.warn(`[discuss] ${model.id} 最后发言缺少预测方向或比分,跳过`);
          continue;
        }
        if (!cleaned) {
          console.warn(`[discuss] ${model.id} 返回空文本,跳过`);
          continue;
        }
        messages.push({
          modelId: model.id,
          modelName: model.name,
          vendor: model.vendor,
          turn: messages.length + 1,
          round,
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

module.exports = { discuss, buildDiscussionPrompt, buildTurnSchedule, turnBudget };
