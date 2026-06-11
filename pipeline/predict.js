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
  "gpt-5": { env: "OPENAI_API_KEY", base: "https://api.openai.com/v1", modelEnv: "OPENAI_MODEL", model: "gpt-5" },
  claude: { env: "ANTHROPIC_API_KEY", base: "https://api.anthropic.com/v1", modelEnv: "ANTHROPIC_MODEL", model: "claude-opus-4-1" },
  gemini: { env: "GOOGLE_API_KEY", base: "https://generativelanguage.googleapis.com/v1beta", modelEnv: "GOOGLE_MODEL", model: "gemini-2.5-pro" },
  deepseek: { env: "DEEPSEEK_API_KEY", base: "https://api.deepseek.com/v1", modelEnv: "DEEPSEEK_MODEL", model: "deepseek-chat" },
  qwen: { env: "DASHSCOPE_API_KEY", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", modelEnv: "DASHSCOPE_MODEL", model: "qwen-max" },
  grok: { env: "XAI_API_KEY", base: "https://api.x.ai/v1", modelEnv: "XAI_MODEL", model: "grok-4" },
  llama: { env: "LLAMA_API_KEY", baseEnv: "LLAMA_API_BASE", modelEnv: "LLAMA_MODEL", model: "llama-4" },
  mistral: { env: "MISTRAL_API_KEY", base: "https://api.mistral.ai/v1", modelEnv: "MISTRAL_MODEL", model: "mistral-large-latest" },
  glm: { env: "ZHIPU_API_KEY", base: "https://open.bigmodel.cn/api/paas/v4", modelEnv: "ZHIPU_MODEL", model: "glm-4-plus" },
  kimi: { env: "MOONSHOT_API_KEY", base: "https://api.moonshot.cn/v1", modelEnv: "MOONSHOT_MODEL", model: "moonshot-v1-128k" },
  doubao: { env: "DOUBAO_API_KEY", baseEnv: "DOUBAO_API_BASE", modelEnv: "DOUBAO_MODEL", model: "doubao-pro" },
  minimax: { env: "MINIMAX_API_KEY", base: "https://api.minimax.chat/v1", modelEnv: "MINIMAX_MODEL", model: "abab6.5s-chat" },
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

async function callOpenAICompatible(provider, prompt, apiKey) {
  const base = String(process.env[provider.baseEnv] || provider.base || "").replace(/\/+$/, "");
  if (!base) throw new Error("缺少 OpenAI-compatible API base");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env[provider.modelEnv] || provider.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`模型 API 请求失败: ${res.status} ${await res.text()}`);
  const payload = await res.json();
  return payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : "";
}

async function callAnthropic(provider, prompt, apiKey) {
  const res = await fetch(`${provider.base}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env[provider.modelEnv] || provider.model,
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic 请求失败: ${res.status} ${await res.text()}`);
  const payload = await res.json();
  return (payload.content || []).map((part) => part.text || "").join("\n");
}

async function callGemini(provider, prompt, apiKey) {
  const model = process.env[provider.modelEnv] || provider.model;
  const url = `${provider.base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
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
  const apiKey = String(process.env[provider.env] || "").trim();
  if (!apiKey) return null;

  const prompt = buildPrompt(track, match, { maxStakePerMatch: config.maxStakePerMatch });
  let text;
  if (modelId === "claude") text = await callAnthropic(provider, prompt, apiKey);
  else if (modelId === "gemini") text = await callGemini(provider, prompt, apiKey);
  else text = await callOpenAICompatible(provider, prompt, apiKey);
  return normalizePrediction(modelId, track, extractJson(text), config.maxStakePerMatch);
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
};
