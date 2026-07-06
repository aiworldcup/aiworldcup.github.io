const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { getConfig } = require("./config");
const { loadProjectEnv } = require("./lib/env");
const { sealMatch } = require("./lib/seal");
const { buildPrompt, RESULT_VALUES } = require("./prompts");
const { fetchMatchesWithOdds } = require("./odds");

const MODELS_PATH = path.join(__dirname, "..", "public", "data", "models.json");
const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "matches.json");

const PROVIDERS = {
  "claude-fable-5": { env: "DK_ANTHROPIC_API_KEY", baseEnv: "DK_ANTHROPIC_API_BASE", base: "https://dk.claudecode.love/v1", modelEnv: "DK_CLAUDE_FABLE_MODEL", modelEnvFallbacks: ["CLAUDE_FABLE_MODEL"], model: "claude-fable-5", protocol: "claude-cli", maxTurns: 1 },
  "claude-opus-4-8": { env: "DK_OPUS_ANTHROPIC_API_KEY", envFallbacks: ["DK_CLAUDE_OPUS_API_KEY", "ANTHROPIC_API_KEY"], baseEnv: "DK_OPUS_ANTHROPIC_API_BASE", baseEnvFallbacks: ["ANTHROPIC_API_BASE"], base: "https://dk.claudecode.love/v1", modelEnv: "DK_CLAUDE_OPUS_MODEL", modelEnvFallbacks: ["DK_ANTHROPIC_MODEL", "CLAUDE_OPUS_MODEL"], model: "claude-opus-4-8" },
  "gpt-5-5": { env: "ZENMUX_API_KEY", baseEnv: "ZENMUX_API_BASE", base: "https://zenmux.ai/api/v1", modelEnv: "GPT_5_5_MODEL", modelEnvFallbacks: ["OPENAI_MODEL"], model: "openai/gpt-5.5", protocol: "responses" },
  "gemini-3-1": { env: "GEMINI_API_KEY", envFallbacks: ["ZENMUX_API_KEY", "GOOGLE_API_KEY"], baseEnv: "GOOGLE_GEMINI_BASE_URL", base: "https://generativelanguage.googleapis.com/v1beta", modelEnv: "GEMINI_MODEL", modelEnvFallbacks: ["GOOGLE_MODEL"], model: "gemini-3.1-pro" },
  "qwen-3-7-max": { env: "ZENMUX_API_KEY", baseEnv: "ZENMUX_API_BASE", base: "https://zenmux.ai/api/v1", modelEnv: "QWEN_MODEL", modelEnvFallbacks: ["DASHSCOPE_MODEL"], model: "qwen/qwen3.7-max", protocol: "responses" },
  "minimax-m3": { env: "ZENMUX_API_KEY", baseEnv: "ZENMUX_API_BASE", base: "https://zenmux.ai/api/v1", modelEnv: "MINIMAX_MODEL", model: "minimax/minimax-m3", protocol: "responses" },
  "kimi-k2-6": { env: "ZENMUX_API_KEY", baseEnv: "ZENMUX_API_BASE", base: "https://zenmux.ai/api/v1", modelEnv: "KIMI_MODEL", modelEnvFallbacks: ["MOONSHOT_MODEL"], model: "moonshotai/kimi-k2.6", protocol: "responses" },
  "mimo-v2-5-pro": { env: "ZENMUX_API_KEY", baseEnv: "ZENMUX_API_BASE", base: "https://zenmux.ai/api/v1", modelEnv: "ZENMUX_MIMO_MODEL", modelEnvFallbacks: ["MIMO_ZENMUX_MODEL"], model: "xiaomi/mimo-v2.5-pro", protocol: "responses" },
  "grok-4-3": { env: "ZENMUX_API_KEY", baseEnv: "ZENMUX_API_BASE", base: "https://zenmux.ai/api/v1", modelEnv: "GROK_MODEL", modelEnvFallbacks: ["XAI_MODEL"], model: "x-ai/grok-4.3", protocol: "responses" },
  "muse-spark": { env: "ZENMUX_API_KEY", baseEnv: "ZENMUX_API_BASE", base: "https://zenmux.ai/api/v1", modelEnv: "MUSE_MODEL", model: "muse-spark", protocol: "responses" },
  "claude-sonnet-4-6": { env: "ZENMUX_API_KEY", envFallbacks: ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"], baseEnv: "ZENMUX_API_BASE", base: "https://zenmux.ai/api/v1", modelEnv: "CLAUDE_SONNET_MODEL", modelEnvFallbacks: ["ANTHROPIC_DEFAULT_SONNET_MODEL"], model: "anthropic/claude-sonnet-4.6", protocol: "responses" },
  "deepseek-v4pro": { env: "ZENMUX_API_KEY", baseEnv: "ZENMUX_API_BASE", base: "https://zenmux.ai/api/v1", modelEnv: "DEEPSEEK_MODEL", model: "deepseek/deepseek-v4-pro", protocol: "responses" },
  "glm-5-1": { env: "ZENMUX_API_KEY", baseEnv: "ZENMUX_API_BASE", base: "https://zenmux.ai/api/v1", modelEnv: "GLM_MODEL", modelEnvFallbacks: ["ZHIPU_MODEL"], model: "z-ai/glm-5.1", protocol: "responses" },
  "doubao-seed-2-0-pro": { env: "ZENMUX_API_KEY", baseEnv: "ZENMUX_API_BASE", base: "https://zenmux.ai/api/v1", modelEnv: "DOUBAO_MODEL", model: "bytedance/doubao-seed-2.0-pro", protocol: "responses" },
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function extractJson(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`模型未返回 JSON: ${raw.slice(0, 120)}`);
    return JSON.parse(match[0]);
  }
}

function firstEnv(keys) {
  for (const key of keys.filter(Boolean)) {
    const value = String(process.env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function uniqueItems(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function providerApiKey(provider) {
  return firstEnv([provider.env, ...(provider.envFallbacks || [])]);
}

function providerModel(provider) {
  return firstEnv([provider.modelEnv, ...(provider.modelEnvFallbacks || [])]) || provider.model;
}

function providerBase(provider) {
  return firstEnv([provider.baseEnv, ...(provider.baseEnvFallbacks || [])]) || provider.base || "";
}

function isZenmuxVertexBase(base) {
  return /zenmux\.ai\/api\/vertex-ai/.test(String(base || ""));
}

function geminiApiKeys(provider, base) {
  const keys = isZenmuxVertexBase(base)
    ? ["ZENMUX_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]
    : ["GEMINI_API_KEY", "GOOGLE_API_KEY"];
  return uniqueItems(keys)
    .map((key) => ({ key, value: String(process.env[key] || "").trim() }))
    .filter((item) => item.value);
}

function splitArgs(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const matches = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return matches.map((item) => item.replace(/^["']|["']$/g, ""));
}

function normalizePrediction(modelId, track, payload) {
  const result = RESULT_VALUES.includes(payload.result) ? payload.result : "draw";
  const score = /^\d+\-\d+$/.test(String(payload.score || "")) ? String(payload.score) : "1-1";
  return {
    modelId,
    track,
    result,
    score,
    reasoning: String(payload.reasoning || "").slice(0, 120),
  };
}

function apiTimeoutMs() {
  return Math.max(1000, Number(process.env.API_TIMEOUT_MS) || 60000);
}

async function callOpenAICompatible(provider, prompt, apiKey, options = {}) {
  const base = String(providerBase(provider)).replace(/\/+$/, "");
  if (!base) throw new Error("缺少 OpenAI-compatible API base");
  const body = {
    model: providerModel(provider),
    messages: [{ role: "user", content: prompt }],
  };
  if (options.json) body.response_format = { type: "json_object" };
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(apiTimeoutMs()),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`模型 API 请求失败: ${res.status} ${await res.text()}`);
  const payload = await res.json();
  return payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : "";
}

function extractResponsesText(payload) {
  if (payload.output_text) return payload.output_text;
  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.text) parts.push(content.text);
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

async function callResponsesCompatible(provider, prompt, apiKey, options = {}) {
  const base = String(providerBase(provider)).replace(/\/+$/, "");
  if (!base) throw new Error("缺少 Responses API base");
  const body = {
    model: providerModel(provider),
    input: prompt,
  };
  if (options.json) {
    body.text = { format: { type: "json_object" } };
  }
  const res = await fetch(`${base}/responses`, {
    method: "POST",
    signal: AbortSignal.timeout(apiTimeoutMs()),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Responses 请求失败: ${res.status} ${await res.text()}`);
  return extractResponsesText(await res.json());
}

async function callAnthropic(provider, prompt, apiKey, options = {}) {
  const base = String(providerBase(provider)).replace(/\/+$/, "");
  const endpoint = /zenmux\.ai\/api\/anthropic$/.test(base) ? `${base}/v1/messages` : `${base}/messages`;
  const timeoutMs = apiTimeoutMs();
  const res = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: providerModel(provider),
      max_tokens: options.maxTokens || 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic 请求失败: ${res.status} ${await res.text()}`);
  const payload = await res.json();
  const text = (payload.content || []).map((part) => part.text || "").join("\n").trim();
  if (text) return text;

  const thinking = (payload.content || []).map((part) => part.thinking || "").join("\n");
  const quotedSentences = Array.from(thinking.matchAll(/[“"]([^“”"]{6,80}[。！？])["”]/g));
  const candidates = quotedSentences
    .map((match) => match[1])
    .filter((sentence) => !/(输出|JSON|Markdown|字符|一句|这次|不要|只说|中文自然语言)/.test(sentence));
  const lastQuoted = candidates[candidates.length - 1];
  return lastQuoted || "";
}

function extractClaudeCliText(stdout) {
  const raw = String(stdout || "").trim();
  if (!raw) return "";
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (_) {
    return raw;
  }
  if (payload.is_error) {
    throw new Error(payload.result || payload.error || "Claude Code CLI 返回错误");
  }
  if (payload.subtype && payload.subtype !== "success") {
    throw new Error(payload.result || `Claude Code CLI 返回 ${payload.subtype}`);
  }
  return String(payload.result || payload.text || "").trim();
}

async function callClaudeCli(provider, prompt, apiKey) {
  const timeoutMs = Math.max(1000, Number(process.env.CLAUDE_CLI_TIMEOUT_MS || process.env.API_TIMEOUT_MS) || 180000);
  const model = providerModel(provider);
  const base = providerBase(provider);
  const args = [
    "-p",
    prompt,
    "--model",
    model,
    "--output-format",
    "json",
    "--max-turns",
    String(provider.maxTurns || 1),
    "--no-session-persistence",
    ...splitArgs(process.env.CLAUDE_CLI_EXTRA_ARGS),
  ];
  const env = { ...process.env };
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  if (base) {
    env.ANTHROPIC_BASE_URL = base;
    env.ANTHROPIC_API_BASE = base;
  }
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Claude Code CLI 超时: ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Claude Code CLI 退出 ${code}: ${(stderr || stdout).slice(0, 500)}`));
        return;
      }
      try {
        resolve(extractClaudeCliText(stdout));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function shouldTryNextGeminiKey(err) {
  const text = String(err && err.message || "");
  return [401, 403, 404].includes(err && err.status)
    || /model_not_available|not included|permission|unauthorized|forbidden|api key/i.test(text);
}

async function callGeminiWithKey(provider, prompt, apiKey, options = {}) {
  const model = providerModel(provider);
  const base = String(process.env[provider.baseEnv] || provider.base || "").replace(/\/+$/, "");
  const isZenmuxVertex = isZenmuxVertexBase(base);
  const [publisher, ...modelParts] = model.includes("/") ? model.split("/") : ["google", model];
  const vertexModel = modelParts.join("/");
  const url = isZenmuxVertex
    ? `${base}/v1/publishers/${encodeURIComponent(publisher)}/models/${encodeURIComponent(vertexModel)}:generateContent`
    : `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  };
  if (options.json) body.generationConfig = { responseMimeType: "application/json" };
  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(apiTimeoutMs()),
    headers: {
      ...(isZenmuxVertex ? { authorization: `Bearer ${apiKey}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`Gemini 请求失败: ${res.status} ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  const payload = await res.json();
  return (((payload.candidates || [])[0] || {}).content || {}).parts
    ? payload.candidates[0].content.parts.map((part) => part.text || "").join("\n")
    : "";
}

async function callGemini(provider, prompt, options = {}) {
  const base = String(process.env[provider.baseEnv] || provider.base || "").replace(/\/+$/, "");
  const apiKeys = geminiApiKeys(provider, base);
  if (!apiKeys.length) return null;

  let lastErr;
  for (const item of apiKeys) {
    try {
      return await callGeminiWithKey(provider, prompt, item.value, options);
    } catch (err) {
      lastErr = err;
      if (!shouldTryNextGeminiKey(err)) throw err;
      console.warn(`[predict] Gemini ${item.key} 不可用,尝试下一个 key: ${String(err.message || err).slice(0, 180)}`);
    }
  }
  throw lastErr;
}

async function callModel(modelId, track, match, config) {
  const provider = PROVIDERS[modelId];
  if (!provider) throw new Error(`未配置模型 provider: ${modelId}`);
  const prompt = buildPrompt(track, match);
  if (modelId.startsWith("gemini-")) {
    const text = await callGemini(provider, prompt, { json: true });
    if (text === null) return null;
    return normalizePrediction(modelId, track, extractJson(text));
  }

  const apiKey = providerApiKey(provider);
  if (!apiKey) return null;

  let text;
  if (provider.protocol === "claude-cli") text = await callClaudeCli(provider, prompt, apiKey);
  else if (provider.protocol === "responses") text = await callResponsesCompatible(provider, prompt, apiKey, { json: true });
  else if (provider.protocol === "anthropic" || modelId.startsWith("claude-")) text = await callAnthropic(provider, prompt, apiKey);
  else text = await callOpenAICompatible(provider, prompt, apiKey, { json: true });
  return normalizePrediction(modelId, track, extractJson(text));
}

async function callModelText(modelId, prompt) {
  const provider = PROVIDERS[modelId];
  if (!provider) throw new Error(`未配置模型 provider: ${modelId}`);
  if (modelId.startsWith("gemini-")) return callGemini(provider, prompt);

  const apiKey = providerApiKey(provider);
  if (!apiKey) return null;

  if (provider.protocol === "claude-cli") return callClaudeCli(provider, prompt, apiKey);
  if (provider.protocol === "responses") return callResponsesCompatible(provider, prompt, apiKey);
  if (provider.protocol === "anthropic" || modelId.startsWith("claude-")) {
    return callAnthropic(provider, prompt, apiKey, { maxTokens: provider.maxTokens || 900 });
  }
  return callOpenAICompatible(provider, prompt, apiKey);
}

async function predictAll() {
  loadProjectEnv();
  const config = getConfig();
  const models = readJson(MODELS_PATH).models.filter((model) => model.enabled !== false);
  const matchesData = await fetchMatchesWithOdds();
  const now = new Date().toISOString();
  const nextMatches = [];
  let predictionCount = 0;

  for (const match of matchesData.matches || []) {
    const predictions = [];
    for (const model of models) {
      for (const track of ["open"]) {
        try {
          const prediction = await callModel(model.id, track, match, config);
          if (!prediction) {
            console.warn(`[predict] ${model.id} 缺少 key,跳过 ${track}`);
            continue;
          }
          predictions.push(prediction);
          predictionCount += 1;
        } catch (err) {
          console.warn(`[predict] ${model.id}/${track} 失败: ${err.message}`);
        }
      }
    }
    nextMatches.push(sealMatch({ ...match, predictions: [] }, predictions, now));
  }

  if (predictionCount === 0) {
    console.warn("[predict] 没有生成任何预测,未写入 matches.json。请填写至少一个模型 API key 后重试。");
    return;
  }

  writeJson(OUTPUT_PATH, { matches: nextMatches });
  console.log(`[predict] wrote ${OUTPUT_PATH}`);
}

if (require.main === module) {
  predictAll().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  PROVIDERS,
  predictAll,
  normalizePrediction,
  extractJson,
  callModelText,
};
