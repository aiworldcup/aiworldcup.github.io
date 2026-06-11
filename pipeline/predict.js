const fs = require("fs");
const path = require("path");
const { getConfig } = require("./config");
const { loadEnv } = require("./lib/env");
const { sealMatch } = require("./lib/seal");
const { buildPrompt, RESULT_VALUES } = require("./prompts");
const { fetchMatchesWithOdds } = require("./odds");

const MODELS_PATH = path.join(__dirname, "..", "public", "data", "models.json");
const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "matches.json");

const PROVIDERS = {
  "claude-fable-5": { env: "ANTHROPIC_API_KEY", baseEnv: "ANTHROPIC_API_BASE", base: "https://api.anthropic.com/v1", modelEnv: "CLAUDE_FABLE_MODEL", model: "claude-fable-5" },
  "claude-opus-4-8": { env: "ANTHROPIC_API_KEY", baseEnv: "ANTHROPIC_API_BASE", base: "https://api.anthropic.com/v1", modelEnv: "CLAUDE_OPUS_MODEL", model: "claude-opus-4-8" },
  "gpt-5-5": { env: "OPENAI_API_KEY", base: "https://api.openai.com/v1", modelEnv: "OPENAI_MODEL", model: "gpt-5.5" },
  "gemini-3-1": { env: "GEMINI_API_KEY", envFallbacks: ["ZENMUX_API_KEY", "GOOGLE_API_KEY"], baseEnv: "GOOGLE_GEMINI_BASE_URL", base: "https://generativelanguage.googleapis.com/v1beta", modelEnv: "GEMINI_MODEL", modelEnvFallbacks: ["GOOGLE_MODEL"], model: "gemini-3.1-pro" },
  "qwen-3-7-max": { env: "DASHSCOPE_API_KEY", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", modelEnv: "DASHSCOPE_MODEL", model: "qwen3.7-max" },
  "minimax-m3": { env: "MINIMAX_API_KEY", base: "https://api.minimax.chat/v1", modelEnv: "MINIMAX_MODEL", model: "minimax-m3" },
  "kimi-k2-6": { env: "MOONSHOT_API_KEY", base: "https://api.moonshot.cn/v1", modelEnv: "MOONSHOT_MODEL", model: "kimi-k2.6" },
  "mimo-v2-5-pro": { env: "MIMO_API_KEY", baseEnv: "MIMO_API_BASE", modelEnv: "MIMO_MODEL", model: "mimo-v2.5-pro", protocol: "anthropic" },
  "grok-4-3": { env: "XAI_API_KEY", base: "https://api.x.ai/v1", modelEnv: "XAI_MODEL", model: "grok-4.3" },
  "muse-spark": { env: "MUSE_API_KEY", baseEnv: "MUSE_API_BASE", modelEnv: "MUSE_MODEL", model: "muse-spark" },
  "claude-sonnet-4-6": { env: "ANTHROPIC_API_KEY", baseEnv: "ANTHROPIC_API_BASE", base: "https://api.anthropic.com/v1", modelEnv: "CLAUDE_SONNET_MODEL", model: "claude-sonnet-4-6" },
  "deepseek-v4pro": { env: "DEEPSEEK_API_KEY", base: "https://api.deepseek.com/v1", modelEnv: "DEEPSEEK_MODEL", model: "deepseek-v4pro" },
  "glm-5-1": { env: "ZHIPU_API_KEY", base: "https://open.bigmodel.cn/api/paas/v4", modelEnv: "ZHIPU_MODEL", model: "glm-5.1" },
  "doubao-seed-1-5-thinking-pro": { env: "DOUBAO_API_KEY", baseEnv: "DOUBAO_API_BASE", modelEnv: "DOUBAO_MODEL", model: "doubao-1-5-thinking-pro-250428" },
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

function providerApiKey(provider) {
  return firstEnv([provider.env, ...(provider.envFallbacks || [])]);
}

function providerModel(provider) {
  return firstEnv([provider.modelEnv, ...(provider.modelEnvFallbacks || [])]) || provider.model;
}

function normalizePrediction(modelId, track, payload, maxStakePerMatch) {
  const result = RESULT_VALUES.includes(payload.result) ? payload.result : "draw";
  const score = /^\d+\-\d+$/.test(String(payload.score || "")) ? String(payload.score) : "1-1";
  const stake = payload.stake || {};
  let resultStake = Math.max(0, Number(stake.result) || 0);
  let scoreStake = Math.max(0, Number(stake.score) || 0);
  const total = resultStake + scoreStake;
  if (total <= 0) {
    resultStake = Math.round(maxStakePerMatch * 0.7);
    scoreStake = maxStakePerMatch - resultStake;
  } else if (total > maxStakePerMatch) {
    resultStake = Math.floor((resultStake / total) * maxStakePerMatch);
    scoreStake = maxStakePerMatch - resultStake;
  }
  return {
    modelId,
    track,
    result,
    score,
    stake: { result: resultStake, score: scoreStake },
    reasoning: String(payload.reasoning || "").slice(0, 120),
  };
}

async function callOpenAICompatible(provider, prompt, apiKey, options = {}) {
  const base = String(process.env[provider.baseEnv] || provider.base || "").replace(/\/+$/, "");
  if (!base) throw new Error("缺少 OpenAI-compatible API base");
  const body = {
    model: providerModel(provider),
    messages: [{ role: "user", content: prompt }],
  };
  if (options.json) body.response_format = { type: "json_object" };
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
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

async function callAnthropic(provider, prompt, apiKey, options = {}) {
  const base = String(process.env[provider.baseEnv] || provider.base || "").replace(/\/+$/, "");
  const timeoutMs = Math.max(1000, Number(process.env.API_TIMEOUT_MS) || 60000);
  const res = await fetch(`${base}/messages`, {
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

async function callGemini(provider, prompt, apiKey, options = {}) {
  const model = providerModel(provider);
  const base = String(process.env[provider.baseEnv] || provider.base || "").replace(/\/+$/, "");
  const isZenmuxVertex = /zenmux\.ai\/api\/vertex-ai/.test(base);
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
    headers: {
      ...(isZenmuxVertex ? { authorization: `Bearer ${apiKey}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini 请求失败: ${res.status} ${await res.text()}`);
  const payload = await res.json();
  return (((payload.candidates || [])[0] || {}).content || {}).parts
    ? payload.candidates[0].content.parts.map((part) => part.text || "").join("\n")
    : "";
}

async function callModel(modelId, track, match, config) {
  const provider = PROVIDERS[modelId];
  if (!provider) throw new Error(`未配置模型 provider: ${modelId}`);
  const apiKey = providerApiKey(provider);
  if (!apiKey) return null;

  const prompt = buildPrompt(track, match, { maxStakePerMatch: config.maxStakePerMatch });
  let text;
  if (modelId.startsWith("claude-") || provider.protocol === "anthropic") text = await callAnthropic(provider, prompt, apiKey);
  else if (modelId.startsWith("gemini-")) text = await callGemini(provider, prompt, apiKey, { json: true });
  else text = await callOpenAICompatible(provider, prompt, apiKey, { json: true });
  return normalizePrediction(modelId, track, extractJson(text), config.maxStakePerMatch);
}

async function callModelText(modelId, prompt) {
  const provider = PROVIDERS[modelId];
  if (!provider) throw new Error(`未配置模型 provider: ${modelId}`);
  const apiKey = providerApiKey(provider);
  if (!apiKey) return null;

  if (modelId.startsWith("claude-") || provider.protocol === "anthropic") return callAnthropic(provider, prompt, apiKey, { maxTokens: 900 });
  if (modelId.startsWith("gemini-")) return callGemini(provider, prompt, apiKey);
  return callOpenAICompatible(provider, prompt, apiKey);
}

async function predictAll() {
  loadEnv();
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
