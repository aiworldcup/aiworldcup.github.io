const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./lib/env");
const { callModelText } = require("./predict");

const MODELS_PATH = path.join(__dirname, "..", "public", "data", "models.json");
const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "discussions.json");
const MESSAGE_CHAR_LIMIT = 46;
const FINAL_MESSAGE_CHAR_LIMIT = 60;
const DEFAULT_DISCUSS_TIMEOUT_MS = 25000;
const ACTIVE_TALKERS = new Set([
  "qwen-3-7-max",
  "minimax-m3",
  "mimo-v2-5-pro",
  "grok-4-3",
  "deepseek-v4pro",
  "glm-5-1",
  "doubao-seed-2-0-pro",
]);

const STYLE_PROFILES = {
  "claude-fable-5": "像战术评论员,一句定调,有画面感,不解释太多。",
  "claude-opus-4-8": "像冷静庄家,只讲概率漏洞,不煽情。",
  "gpt-5-5": "像控场主持,一句归纳分歧,把话题往结论推。",
  "gemini-3-1": "像数据记者,抓一个外部变量,别铺背景。",
  "qwen-3-7-max": "像老练竞彩玩家,敢讲性价比,会泼冷水。",
  "minimax-m3": "像快嘴球迷,嘴快、有梗,专拆稳胆。",
  "kimi-k2-6": "像细节派观察员,只抓一个空间或阵型细节。",
  "mimo-v2-5-pro": "像助教在场边喊话,短句,直接补风险点。",
  "grok-4-3": "像挑刺反方,专门质疑共识,语气尖一点。",
  "muse-spark": "像内容策划,更会提炼传播点和戏剧性。",
  "claude-sonnet-4-6": "像平衡派分析师,只指出一个被忽视的反向风险。",
  "deepseek-v4pro": "像推演派,一句写出比赛脚本和转折点。",
  "glm-5-1": "像中文体育编辑,表达顺滑,结论清楚。",
  "doubao-seed-2-0-pro": "像短视频解说,口语化,有悬念,但别废话。",
};

function turnBudget(modelId) {
  if (modelId === "claude-fable-5") return 1;
  if (modelId === "claude-opus-4-8") return 1;
  if (ACTIVE_TALKERS.has(modelId)) return 2;
  return 1;
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
  const args = { date: addDays(beijingDateKey(), 1), limit: 4, matchId: "", modelIds: [], skipExisting: false };
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
    } else if (key === "--skip-existing") {
      args.skipExisting = true;
    }
  }
  return args;
}

function cleanText(value, limit = MESSAGE_CHAR_LIMIT) {
  const text = String(value || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*["'“”]+|["'“”]+\s*$/g, "")
    .replace(/^(作为|身为|从我的角度看|我认为|我觉得)[^,，。！？!?]{0,18}[,，。！？!?]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return compactSentence(dedupeRepeatedText(text), limit);
}

function dedupeRepeatedText(value) {
  let text = String(value || "").trim();
  const evenHalf = text.length % 2 === 0 ? text.length / 2 : 0;
  if (evenHalf && text.slice(0, evenHalf).trim() === text.slice(evenHalf).trim()) {
    text = text.slice(0, evenHalf).trim();
  }
  const marker = text.slice(0, Math.min(18, text.length));
  const repeatedFrom = marker.length >= 8 ? text.indexOf(marker, marker.length) : -1;
  if (repeatedFrom > 0) {
    text = text.slice(0, repeatedFrom).trim();
  }

  const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) || [text];
  const cleaned = [];
  for (const sentence of sentences.map((item) => item.trim()).filter(Boolean)) {
    if (cleaned[cleaned.length - 1] !== sentence) cleaned.push(sentence);
  }
  return cleaned.join("");
}

function compactSentence(value, limit) {
  let text = String(value || "").trim();
  if (!text) return "";
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) || [text];
  if (sentences.length > 2) text = sentences.slice(0, 2).join("").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
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

function oddsNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : Infinity;
}

function fallbackPrediction(match) {
  const odds = match.odds && match.odds.result ? match.odds.result : {};
  const options = [
    { result: "主胜", score: "2-1", odds: oddsNumber(odds.home) },
    { result: "平局", score: "1-1", odds: oddsNumber(odds.draw) },
    { result: "客胜", score: "1-2", odds: oddsNumber(odds.away) },
  ].sort((a, b) => a.odds - b.odds);
  return Number.isFinite(options[0].odds) ? options[0] : options[1];
}

function buildGuaranteedFinalText(match, model, reason) {
  const prediction = fallbackPrediction(match);
  const note = reason ? "API超时兜底" : "兜底";
  return `${model.name}${note}:结论:${prediction.result},比分${prediction.score}`;
}

function buildDiscussionPrompt(match, model, previousMessages, round, isFinalTurn = false) {
  const history = previousMessages.length
    ? previousMessages
      .slice(-6)
      .map((message) => `${message.modelName}: ${message.text}`)
      .join("\n")
    : "暂无,你先开场。";
  const style = STYLE_PROFILES[model.id] || "像冷静的赛前观察员,表达简短,不要套话。";
  const relationRule = previousMessages.length
    ? "必须接住上一句或最近一个共识,用「我反对」「这点我买」「补一刀」「别忽略」这类口吻开头;不要重复原话。"
    : "你负责开场,抛出一个明确且可被反驳的判断,别铺垫。";
  const fableRule = model.id === "claude-fable-5"
    ? "\n你是本场圆桌首个发言的昂贵模型,只给一句:简要理由 + 赛果方向 + 具体比分,不要铺垫。"
    : "";
  const finalRule = isFinalTurn
    ? "\n这是你本场最后一次发言,必须收束预测。固定格式:「结论:主胜/平局/客胜,比分X-X;理由」。理由不超过18字。"
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
硬规则:
- 只说一句话,不要第二段。
- 禁止复述赔率,禁止说「双方都有机会」「不好说」。
- 非最后发言不超过 ${MESSAGE_CHAR_LIMIT} 个中文字符;最后发言不超过 ${FINAL_MESSAGE_CHAR_LIMIT} 个中文字符。
- 要有一点火药味,但不能人身攻击。
${fableRule}${finalRule}`;
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
只输出一句中文短句,要接话,要有观点,不超过 ${isFinalTurn ? FINAL_MESSAGE_CHAR_LIMIT : MESSAGE_CHAR_LIMIT} 个中文字符。`;
}

async function callFinalTurnText(match, model, messages, round) {
  try {
    let text = await callModelText(model.id, buildDiscussionPrompt(match, model, messages, round, true));
    if (text === null) {
      console.warn(`[discuss] ${model.id} 缺少 key,使用最终预测兜底`);
      return buildGuaranteedFinalText(match, model, "missing-key");
    }
    let cleaned = cleanText(text, FINAL_MESSAGE_CHAR_LIMIT);
    if (!cleaned || !hasFinalPrediction(cleaned)) {
      text = await callModelText(model.id, buildRetryPrompt(match, model, messages, round, true));
      cleaned = cleanText(text, FINAL_MESSAGE_CHAR_LIMIT);
    }
    if (cleaned && hasFinalPrediction(cleaned)) return cleaned;
    console.warn(`[discuss] ${model.id} 最后发言缺少预测方向或比分,使用最终预测兜底`);
    return buildGuaranteedFinalText(match, model, "invalid-final");
  } catch (err) {
    console.warn(`[discuss] ${model.id} 最后发言失败: ${err.message}; 使用最终预测兜底`);
    return buildGuaranteedFinalText(match, model, err.message);
  }
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

function configureDiscussionTimeout() {
  const explicit = Number(process.env.DISCUSS_API_TIMEOUT_MS);
  const current = Number(process.env.API_TIMEOUT_MS);
  const next = Number.isFinite(explicit) && explicit > 0
    ? explicit
    : (!Number.isFinite(current) || current <= 0 || current > 60000)
      ? DEFAULT_DISCUSS_TIMEOUT_MS
      : current;
  process.env.API_TIMEOUT_MS = String(Math.max(1000, next));
  if (!process.env.CLAUDE_CLI_TIMEOUT_MS || Number(process.env.CLAUDE_CLI_TIMEOUT_MS) > 60000) {
    process.env.CLAUDE_CLI_TIMEOUT_MS = process.env.API_TIMEOUT_MS;
  }
}

async function discuss() {
  loadProjectEnv();
  configureDiscussionTimeout();
  const args = parseArgs(process.argv.slice(2));
  const models = readJson(MODELS_PATH, { models: [] }).models
    .filter((model) => model.enabled !== false)
    .filter((model) => !args.modelIds.length || args.modelIds.includes(model.id));
  const matchesData = readJson(MATCHES_PATH, { matches: [] });
  const existing = readJson(OUTPUT_PATH, { updatedAt: null, mode: "pipeline", discussions: [] });
  const existingDiscussions = existing.discussions || [];
  const existingMatchIds = new Set(existingDiscussions.map((item) => item.matchId));
  const targetMatches = (matchesData.matches || [])
    .filter((match) => (args.matchId ? match.id === args.matchId : beijingDateKey(match.kickoff) === args.date))
    .filter((match) => !match.actual)
    .filter((match) => !args.skipExisting || !existingMatchIds.has(match.id))
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
        if (isFinalTurn) {
          const cleaned = await callFinalTurnText(match, model, messages, round);
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
          continue;
        }

        let text = await callModelText(model.id, buildDiscussionPrompt(match, model, messages, round, isFinalTurn));
        if (text === null) {
          console.warn(`[discuss] ${model.id} 缺少 key,跳过`);
          continue;
        }
        let cleaned = cleanText(text, MESSAGE_CHAR_LIMIT);
        if (!cleaned || (isFinalTurn && !hasFinalPrediction(cleaned))) {
          text = await callModelText(model.id, buildRetryPrompt(match, model, messages, round, isFinalTurn));
          cleaned = cleanText(text, isFinalTurn ? FINAL_MESSAGE_CHAR_LIMIT : MESSAGE_CHAR_LIMIT);
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

module.exports = {
  discuss,
  buildDiscussionPrompt,
  buildTurnSchedule,
  turnBudget,
  fallbackPrediction,
  buildGuaranteedFinalText,
  hasFinalPrediction,
  cleanText,
  MESSAGE_CHAR_LIMIT,
  FINAL_MESSAGE_CHAR_LIMIT,
  DEFAULT_DISCUSS_TIMEOUT_MS,
  configureDiscussionTimeout,
};
