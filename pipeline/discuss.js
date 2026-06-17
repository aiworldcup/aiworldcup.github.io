const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./lib/env");
const { callModelText } = require("./predict");

const MODELS_PATH = path.join(__dirname, "..", "public", "data", "models.json");
const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "discussions.json");
const MESSAGE_CHAR_LIMIT = 56;
const FINAL_MESSAGE_CHAR_LIMIT = 72;
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

// 每个模型一套鲜明人格:性格 + 招牌口吻 + 偏好视角。目标是让同一场比赛里
// 12 个 AI 说话各有各的味,互相点名、互相打脸,而不是一个腔调念赔率。
const STYLE_PROFILES = {
  "claude-fable-5": "你是一句定调的战术老炮,画面感强,从不解释太多,开口就是结论。",
  "claude-opus-4-8": "你是圈里最稳的老法师,只信底层逻辑。习惯先认可别人半句、再用『但是』掀桌,专挑全场集体忽略的那个反向风险。克制、不喊口号,一针见血。",
  "claude-sonnet-4-6": "你是辩证派,凡事看两面。别人越一边倒,你越冷冷补一句隐患。爱用『你们想简单了』开头,点破一个细节就收。",
  "gpt-5-5": "你是群里的控场主持,总想把跑偏的话题拉回主线、爱给框架,但容易被吐槽『说了等于没说』。这次你偏要甩个敢担责的判断,堵住嘴。",
  "gemini-3-1": "你是数据情报官,张口就是冷门数字和外部变量(伤停、旅途、天气、历史交锋)。专用一个别人不知道的数据打脸全场,从不空谈感觉。",
  "qwen-3-7-max": "你是混迹竞彩多年的老炮,江湖气重,敢梭哈也敢泼冷水。说话接地气带市井味,最爱拆穿『看着很稳其实是陷阱』的盘。",
  "minimax-m3": "你是嘴最快的梗王球迷,反应快、爱抬杠、专拆稳胆。谁的结论太顺,你第一个唱反调,一句话里能塞俩梗。",
  "kimi-k2-6": "你是阵型细节控,只盯一个点死磕——某条边路、某个肋部空当、某次盯人漏洞。别人聊大势,你偏从一个微观细节推出胜负。",
  "mimo-v2-5-pro": "你是场边助教,短平快从不长篇。专补别人没提到的那个风险点,一句话戳醒全场。",
  "grok-4-3": "你是群里最毒舌的杠精,专怼共识、专戳痛点,语气尖、带网络梗。谁的话最多人点头,你第一个跳出来唱反调——但怼得有理有据,不是无脑黑。",
  "muse-spark": "你是内容策划,最会提炼戏剧冲突和传播点,一句话给比赛安一个故事线。",
  "deepseek-v4pro": "你是推演派理工男,爱把整场写成剧本:开局如何、转折点在哪、谁先顶不住。用因果链说话,逻辑严丝合缝。",
  "glm-5-1": "你是资深中文体育编辑,表达顺滑、画面感强、结论干脆。爱用一句像标题一样的金句收尾。",
  "doubao-seed-2-0-pro": "你是短视频解说,口语化、节奏快、爱制造悬念和反转,开口就像『家人们这场有意思了』,但观点得真。",
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
  return text;
}

function hasFinalPrediction(value) {
  const text = String(value || "");
  const result = resultFromFinalText(text);
  const score = scoreFromText(text);
  const scoreResult = scoreResultFromScore(score);
  return Boolean(result && score && scoreResult && result === scoreResult);
}

function resultFromFinalText(value) {
  const text = String(value || "");
  const directionPattern = "(主负|主队负|客胜|客队胜|负|主胜|主队胜|胜|平局|打平|闷平|冷平|逼平|平)";
  const marked = text.match(new RegExp(`(?:结论|预测|看好|我站|我押|我买|我信|我赌|倾向|更倾向|最终|收束)[:：]?\\s*[^。！？!?；;]{0,20}?${directionPattern}`));
  if (marked) return resultFromDirectionToken(marked[1]);
  const nearScore = text.match(new RegExp(`${directionPattern}(?![？?])\\s*(?:[,，、:：;；-]\\s*)?(?:比分)?\\s*[0-9０-９一二三四五六七八九零〇]+\\s*[-:：比]\\s*[0-9０-９一二三四五六七八九零〇]+`));
  if (nearScore) return resultFromDirectionToken(nearScore[1]);
  if (/闷平|冷平|逼平|打平|平局/.test(text)) return "draw";
  if (/主负|主队负|客胜(?![？?])|客队胜/.test(text)) return "away";
  if (/主胜(?![？?])|主队胜/.test(text)) return "home";
  return "";
}

function resultFromDirectionToken(token) {
  const value = String(token || "");
  if (/平局|打平|闷平|冷平|逼平|^平$/.test(value)) return "draw";
  if (/主负|主队负|客胜|客队胜|^负$/.test(value)) return "away";
  if (/主胜|主队胜|^胜$/.test(value)) return "home";
  return "";
}

function scoreFromText(value) {
  const matches = Array.from(String(value || "").matchAll(/[0-9０-９一二三四五六七八九零〇]+\s*[-:：比]\s*[0-9０-９一二三四五六七八九零〇]+/g));
  const match = matches[matches.length - 1];
  if (!match) return "";
  return match[0]
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[:：比]/g, "-")
    .replace(/\s+/g, "");
}

function scoreResultFromScore(score) {
  const match = String(score || "").match(/^(\d+)-(\d+)$/);
  if (!match) return "";
  const home = Number(match[1]);
  const away = Number(match[2]);
  if (home === away) return "draw";
  return home > away ? "home" : "away";
}

function oddsLine(match) {
  const odds = match.odds && match.odds.result ? match.odds.result : {};
  return `胜 ${odds.home ?? "未知"} / 平 ${odds.draw ?? "未知"} / 负 ${odds.away ?? "未知"}`;
}

function buildDiscussionPrompt(match, model, previousMessages, round, isFinalTurn = false) {
  if (model.id === "kimi-k2-6") {
    const last = previousMessages[previousMessages.length - 1];
    const lastLine = last ? `${last.modelName}: ${last.text}` : "无";
    const style = STYLE_PROFILES[model.id];
    const finalRule = isFinalTurn
      ? "只输出一行,格式必须是:结论:主胜/平局/客胜,比分X-X;理由:简短具体。"
      : "只输出一句短评,必须从一个阵型细节点给出倾向。";
    return `比赛:${match.home.team} vs ${match.away.team}
赔率:胜${match.odds?.result?.home ?? "未知"} 平${match.odds?.result?.draw ?? "未知"} 负${match.odds?.result?.away ?? "未知"}
你是Kimi K2.6。${style}
上一句:${lastLine}
${finalRule}
比分必须按主队-客队。不要解释规则,不要Markdown。`;
  }

  const history = previousMessages.length
    ? previousMessages
      .slice(-6)
      .map((message) => `${message.modelName}: ${message.text}`)
      .join("\n")
    : "暂无,你先开场。";
  const style = STYLE_PROFILES[model.id] || "像冷静的赛前观察员,表达简短,不要套话。";
  const relationRule = previousMessages.length
    ? "你必须接住上面某一句——点名某个模型反驳它、附和它再补刀、或拆穿它的盲点。开头可用「@某模型」「这点我服」「别被带偏」「补一刀」之类,但要像真人吵架,不要复读原话。"
    : "你负责开场。抛一个鲜明、敢被反驳的判断,直接点出你看好谁、担心谁,别铺垫别念赔率。";
  const fableRule = model.id === "claude-fable-5"
    ? "\n你是本场圆桌首个发言的昂贵模型,只给一句:简要理由 + 赛果方向 + 具体比分,不要铺垫。"
    : "";
  const finalRule = isFinalTurn
    ? "\n这是你本场最后一次发言,必须收束预测。固定格式:「结论:主胜/平局/客胜,比分X-X;理由」。理由不超过20字,且要带上你的人格味道。"
    : "";
  return `你在「世界杯 AI 擂台」的赛前圆桌群聊里发言。这是一场 AI 之间的真实交锋,要好看、要有观点碰撞,会被网友截图传播。

比赛: ${match.home.team} vs ${match.away.team}
阶段: ${match.stage || "世界杯"}
开赛时间: ${match.kickoff}
参考赔率(仅供你心里有数,不要照念): ${oddsLine(match)}
你的身份: ${model.name}
${style}
这是你本场第 ${round} 次发言。

前面群聊:
${history}

请只输出中文自然语言,不要 JSON,不要 Markdown。
${relationRule}
硬规则:
- 只说一句话(最多两短句),要像群聊里真人甩出来的一句,带情绪、有立场。
- 聊球本身:阵型、状态、临场、心理、爆冷点——而不是复述赔率数字。禁止说「双方都有机会」「不好说」「拭目以待」这类废话。
- 比分永远按主队进球-客队进球书写,客胜也不能把客队比分写在前面,例如主队输 1-2 要写「客胜,比分1-2」。
- 守住你的人格,别人一看就知道这句是你说的。可以有火药味、可以毒舌抬杠,但对事不对人,不许人身攻击。
- 非最后发言不超过 ${MESSAGE_CHAR_LIMIT} 个中文字符;最后发言不超过 ${FINAL_MESSAGE_CHAR_LIMIT} 个中文字符。
${fableRule}${finalRule}`;
}

function buildRetryPrompt(match, model, previousMessages, round, isFinalTurn = false) {
  const last = previousMessages[previousMessages.length - 1];
  const lastLine = last ? `${last.modelName}: ${last.text}` : "暂无。";
  const style = STYLE_PROFILES[model.id] || "简短直接。";
  const finalRule = isFinalTurn
    ? "这是你最后一句,必须给出胜平负方向和比分,比分永远按主队进球-客队进球,例如:结论主胜,比分2-1。"
    : "必须回应上一句或补充一个新风险。";
  return `你是${model.name},在世界杯圆桌群聊里聊${match.home.team} vs ${match.away.team}。
${style}
上一句:${lastLine}
这是你本场第 ${round} 次发言。
${finalRule}
只输出一句中文短句,要接住上一句、有鲜明立场和你的人格味,聊球别念赔率,不超过 ${isFinalTurn ? FINAL_MESSAGE_CHAR_LIMIT : MESSAGE_CHAR_LIMIT} 个中文字符。`;
}

async function callFinalTurnText(match, model, messages, round, options = {}) {
  const phase = options.retry ? "补跑" : "首轮";
  try {
    let text = await callModelText(model.id, buildDiscussionPrompt(match, model, messages, round, true));
    if (text === null) {
      console.warn(`[discuss] ${model.id} 缺少 key,跳过最后发言`);
      return null;
    }
    let cleaned = cleanText(text, FINAL_MESSAGE_CHAR_LIMIT);
    if (!cleaned || !hasFinalPrediction(cleaned)) {
      text = await callModelText(model.id, buildRetryPrompt(match, model, messages, round, true));
      cleaned = cleanText(text, FINAL_MESSAGE_CHAR_LIMIT);
    }
    if (cleaned && hasFinalPrediction(cleaned)) return cleaned;
    console.warn(`[discuss] ${model.id} ${phase}最后发言缺少预测方向或比分,留空`);
    return null;
  } catch (err) {
    console.warn(`[discuss] ${model.id} ${phase}最后发言失败: ${err.message}; 留空`);
    return null;
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

function buildIssue(match, model, round, status, message, extra = {}) {
  return {
    modelId: model.id,
    modelName: model.name,
    vendor: model.vendor,
    round,
    status,
    message,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

function issueStatusFromError(err) {
  const text = String(err && err.message || err || "");
  if (/timeout|timed out|aborted|超时/i.test(text)) return "timeout";
  return "failed";
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
  const generatedDiscussions = [];
  const finalRetryQueue = [];
  let generated = 0;
  const now = new Date().toISOString();

  for (const match of targetMatches) {
    const messages = [];
    const issues = [];
    const turns = buildTurnSchedule(models);
    for (const { model, round } of turns) {
      const isFinalTurn = round >= turnBudget(model.id);
      try {
        if (isFinalTurn) {
          const cleaned = await callFinalTurnText(match, model, messages, round);
          if (!cleaned) {
            finalRetryQueue.push({ match, model, messages, issues, round });
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
          continue;
        }

        let text = await callModelText(model.id, buildDiscussionPrompt(match, model, messages, round, isFinalTurn));
        if (text === null) {
          console.warn(`[discuss] ${model.id} 缺少 key,跳过`);
          issues.push(buildIssue(match, model, round, "missing_key", "API key 未配置,本轮跳过"));
          continue;
        }
        let cleaned = cleanText(text, MESSAGE_CHAR_LIMIT);
        if (!cleaned || (isFinalTurn && !hasFinalPrediction(cleaned))) {
          text = await callModelText(model.id, buildRetryPrompt(match, model, messages, round, isFinalTurn));
          cleaned = cleanText(text, isFinalTurn ? FINAL_MESSAGE_CHAR_LIMIT : MESSAGE_CHAR_LIMIT);
        }
        if (!cleaned) {
          console.warn(`[discuss] ${model.id} 返回空文本,跳过`);
          issues.push(buildIssue(match, model, round, "empty", "API 返回空文本,本轮跳过"));
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
        issues.push(buildIssue(match, model, round, issueStatusFromError(err), err.message || "API 调用失败"));
      }
    }

    if (messages.length || issues.length) {
      generatedDiscussions.push({
        matchId: match.id,
        sealedAt: now,
        messages,
        ...(issues.length ? { issues } : {}),
      });
    }
  }

  if (finalRetryQueue.length) {
    console.warn(`[discuss] 首轮最后发言留空 ${finalRetryQueue.length} 条,开始整轮结束后的补跑。`);
  }

  for (const item of finalRetryQueue) {
    const discussion = generatedDiscussions.find((entry) => entry.matchId === item.match.id);
    const messages = discussion ? discussion.messages : item.messages;
    const cleaned = await callFinalTurnText(item.match, item.model, messages, item.round, { retry: true });
    if (!cleaned) {
      console.warn(`[discuss] ${item.match.id}/${item.model.id} 补跑仍为空,不写入兜底消息`);
      const targetIssues = discussion
        ? (discussion.issues = discussion.issues || [])
        : item.issues;
      targetIssues.push(buildIssue(item.match, item.model, item.round, "timeout", "API 超时或补跑仍未返回有效最终预测", { retry: true }));
      continue;
    }

    if (!discussion) {
      generatedDiscussions.push({
        matchId: item.match.id,
        sealedAt: now,
        messages,
        ...(item.issues.length ? { issues: item.issues } : {}),
      });
    }
    messages.push({
      modelId: item.model.id,
      modelName: item.model.name,
      vendor: item.model.vendor,
      turn: messages.length + 1,
      round: item.round,
      text: cleaned,
      timestamp: new Date().toISOString(),
      retry: true,
    });
    generated += 1;
  }

  nextDiscussions.push(...generatedDiscussions);

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
  hasFinalPrediction,
  cleanText,
  MESSAGE_CHAR_LIMIT,
  FINAL_MESSAGE_CHAR_LIMIT,
  DEFAULT_DISCUSS_TIMEOUT_MS,
  configureDiscussionTimeout,
  buildIssue,
  issueStatusFromError,
};
