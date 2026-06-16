const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./lib/env");
const { callModelText } = require("./predict");
const {
  buildDiscussionPrompt,
  buildIssue,
  cleanText: cleanDiscussionText,
  configureDiscussionTimeout,
  hasFinalPrediction,
  issueStatusFromError,
  turnBudget,
} = require("./discuss");

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
  const args = { matchId: "", date: "", modelIds: [], retryFallbacks: false, missingOnly: false, clearFallbacks: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--match" && next) {
      args.matchId = next;
      i += 1;
    } else if (key === "--date" && next) {
      args.date = next;
      i += 1;
    } else if (key === "--models" && next) {
      args.modelIds = next.split(",").map((item) => item.trim()).filter(Boolean);
      i += 1;
    } else if (key === "--retry-fallbacks") {
      args.retryFallbacks = true;
    } else if (key === "--missing-only") {
      args.missingOnly = true;
    } else if (key === "--clear-fallbacks") {
      args.clearFallbacks = true;
    }
  }
  return args;
}

function buildFinalRetryPrompt(match, model) {
  return `你是${model.name},正在聊${match.home.team} vs ${match.away.team}。
只输出一句中文,必须包含胜平负方向和具体比分。
比分永远按主队进球-客队进球,客胜也不能把客队比分写在前面。
格式类似:结论主胜,比分2-1。`;
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

function isSyntheticFallback(message) {
  const text = String(message && message.text || "");
  return /API超时兜底[:：]/.test(text) || /^[^:：]{0,40}兜底[:：]结论[:：]/.test(text);
}

function targetMatchesForArgs(matches, args) {
  const date = args.date || addDays(beijingDateKey(), 1);
  return (matches || [])
    .filter((match) => (args.matchId ? match.id === args.matchId : beijingDateKey(match.kickoff) === date))
    .filter((match) => !match.actual && !match.placeholder);
}

function requestedModels(modelsData, args) {
  return (modelsData || [])
    .filter((model) => model.enabled !== false)
    .filter((model) => !args.modelIds.length || args.modelIds.includes(model.id));
}

function repairItemsForThread(thread, models, args) {
  const messages = thread.messages || [];
  const items = [];
  for (const model of models) {
    for (let round = 1; round <= turnBudget(model.id); round += 1) {
      const message = messages.find((item) => item.modelId === model.id && item.round === round);
      if (message && args.retryFallbacks && isSyntheticFallback(message)) {
        items.push({ model, round, message });
      } else if (!message && args.missingOnly) {
        items.push({ model, round, message: null });
      }
    }
  }
  return items;
}

function pushIssue(thread, match, model, round, status, message, extra = {}) {
  thread.issues = thread.issues || [];
  thread.issues = thread.issues.filter((issue) => !(issue.modelId === model.id && issue.round === round));
  thread.issues.push(buildIssue(match, model, round, status, message, extra));
}

async function generateRepairText(match, model, messages, round) {
  const isFinalTurn = round >= turnBudget(model.id);
  let text = await callModelText(model.id, buildDiscussionPrompt(match, model, messages, round, isFinalTurn));
  if (text === null) {
    console.warn(`[append-discussion] ${match.id}/${model.id} 缺少 key,跳过`);
    return { text: "", status: "missing_key", message: "API key 未配置,本轮跳过" };
  }
  let cleaned = cleanDiscussionText(text, isFinalTurn ? 72 : 56);
  if (isFinalTurn && !hasFinalPrediction(cleaned)) {
    text = await callModelText(model.id, buildFinalRetryPrompt(match, model));
    if (text === null) return { text: "", status: "missing_key", message: "API key 未配置,本轮跳过" };
    cleaned = cleanDiscussionText(text, 72);
  }
  if (isFinalTurn && !hasFinalPrediction(cleaned)) {
    console.warn(`[append-discussion] ${match.id}/${model.id} r${round} 最终发言仍不可解析,留空`);
    return { text: "", status: "invalid_final", message: "补跑返回了文本,但最终预测方向/比分不可解析" };
  }
  return { text: cleaned, status: "", message: "" };
}

function configureAppendTimeout() {
  const explicit = Number(process.env.DISCUSS_RETRY_TIMEOUT_MS);
  const current = Number(process.env.DISCUSS_API_TIMEOUT_MS || process.env.API_TIMEOUT_MS);
  const next = Number.isFinite(explicit) && explicit > 0
    ? explicit
    : (!Number.isFinite(current) || current < 60000)
      ? 60000
      : current;
  process.env.DISCUSS_API_TIMEOUT_MS = String(next);
  process.env.API_TIMEOUT_MS = String(next);
  if (!process.env.CLAUDE_CLI_TIMEOUT_MS || Number(process.env.CLAUDE_CLI_TIMEOUT_MS) < next) {
    process.env.CLAUDE_CLI_TIMEOUT_MS = String(next);
  }
}

async function appendDiscussionModels() {
  loadProjectEnv();
  configureAppendTimeout();
  configureDiscussionTimeout();
  const args = parseArgs(process.argv.slice(2));
  if (!args.matchId && !args.date) args.date = addDays(beijingDateKey(), 1);
  if (!args.retryFallbacks && !args.missingOnly && !args.clearFallbacks && (!args.matchId || !args.modelIds.length)) {
    throw new Error("用法: node pipeline/append-discussion-models.js --match fixture-id --models model-a,model-b [--retry-fallbacks|--missing-only|--clear-fallbacks]");
  }

  const modelsData = readJson(MODELS_PATH, { models: [] }).models;
  const matches = readJson(MATCHES_PATH, { matches: [] }).matches;
  const output = readJson(OUTPUT_PATH, { updatedAt: null, mode: "pipeline", discussions: [] });
  const targetMatches = targetMatchesForArgs(matches, args);
  if (!targetMatches.length) throw new Error(`找不到待补跑比赛: ${args.matchId || args.date}`);

  const models = requestedModels(modelsData, args);
  let changed = 0;
  for (const match of targetMatches) {
    let thread = output.discussions.find((item) => item.matchId === match.id);
    if (!thread) {
      thread = { matchId: match.id, sealedAt: null, messages: [] };
      output.discussions.push(thread);
    }

    let items = [];
    if (args.retryFallbacks || args.missingOnly) {
      items = repairItemsForThread(thread, models, args);
    } else if (!args.clearFallbacks) {
      items = models.flatMap((model) => Array.from({ length: turnBudget(model.id) }, (_, index) => ({
        model,
        round: index + 1,
        message: null,
      })));
    }

    console.log(`[append-discussion] ${match.id} ${match.home.team} vs ${match.away.team} repair=${items.length}`);
    for (const item of items) {
      const history = item.message
        ? thread.messages.filter((message) => message !== item.message)
        : thread.messages;
      let result = { text: "", status: "", message: "" };
      try {
        result = await generateRepairText(match, item.model, history, item.round);
      } catch (err) {
        console.warn(`[append-discussion] ${match.id}/${item.model.id} r${item.round} 失败: ${err.message}`);
        pushIssue(thread, match, item.model, item.round, issueStatusFromError(err), err.message || "API 调用失败", { retry: true });
        continue;
      }
      const cleaned = result.text;
      if (!cleaned && result.status) {
        pushIssue(thread, match, item.model, item.round, result.status, result.message, { retry: true });
      }
      if (!cleaned) continue;

      if (item.message) {
        item.message.text = cleaned;
        item.message.timestamp = new Date().toISOString();
        item.message.retry = true;
        item.message.syntheticFallbackReplaced = true;
        thread.issues = (thread.issues || []).filter((issue) => !(issue.modelId === item.model.id && issue.round === item.round));
      } else {
        thread.messages.push({
          modelId: item.model.id,
          modelName: item.model.name,
          vendor: item.model.vendor,
          turn: thread.messages.length + 1,
          round: item.round,
          text: cleaned,
          timestamp: new Date().toISOString(),
          retry: true,
        });
        thread.issues = (thread.issues || []).filter((issue) => !(issue.modelId === item.model.id && issue.round === item.round));
      }
      changed += 1;
      console.log(`[append-discussion] ${match.id}/${item.model.id} r${item.round}: ${cleaned}`);
    }

    if (args.clearFallbacks) {
      const before = thread.messages.length;
      thread.messages = thread.messages.filter((message) => !isSyntheticFallback(message));
      const removed = before - thread.messages.length;
      if (removed) {
        changed += removed;
        console.log(`[append-discussion] ${match.id} cleared synthetic fallbacks=${removed}`);
      }
    }
  }

  if (!changed) {
    console.log("[append-discussion] no changes");
    return;
  }
  const now = new Date().toISOString();
  output.updatedAt = now;
  writeJson(OUTPUT_PATH, output);
  console.log(`[append-discussion] wrote ${OUTPUT_PATH}, changed=${changed}`);
}

if (require.main === module) {
  appendDiscussionModels().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { appendDiscussionModels };
