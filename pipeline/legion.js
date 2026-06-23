#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/env");
const { callModelText } = require("./predict");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODELS_PATH = path.join(PROJECT_ROOT, "public", "data", "models.json");

const DEFAULT_CONCURRENCY = 4;
const DOMESTIC_MODEL_IDS = new Set([
  "qwen-3-7-max",
  "minimax-m3",
  "kimi-k2-6",
  "mimo-v2-5-pro",
  "deepseek-v4pro",
  "glm-5-1",
  "doubao-seed-2-0-pro",
]);

function loadLegionEnv() {
  return {
    ...loadEnv(path.join(PROJECT_ROOT, ".env")),
    ...loadEnv(path.join(PROJECT_ROOT, ".env.claude-gateways")),
  };
}

function readModels() {
  return JSON.parse(fs.readFileSync(MODELS_PATH, "utf8")).models || [];
}

function enabledModels() {
  return readModels().filter((model) => model.enabled !== false);
}

function normalizeModelIds(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectModels(options = {}) {
  let models = enabledModels();
  const ids = normalizeModelIds(options.models || options.modelIds);
  if (ids.length) models = models.filter((model) => ids.includes(model.id) || ids.includes(model.name));
  if (options.group === "domestic") models = models.filter((model) => DOMESTIC_MODEL_IDS.has(model.id));
  if (options.group === "overseas") models = models.filter((model) => !DOMESTIC_MODEL_IDS.has(model.id));
  return models;
}

async function runPool(items, concurrency, worker) {
  const limit = Math.max(1, Number(concurrency) || DEFAULT_CONCURRENCY);
  const results = new Array(items.length);
  let cursor = 0;

  async function next() {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;
    results[index] = await worker(items[index], index);
    await next();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

async function askModel(modelId, prompt, options = {}) {
  loadLegionEnv();
  if (options.timeoutMs) process.env.API_TIMEOUT_MS = String(options.timeoutMs);
  const startedAt = Date.now();
  try {
    const text = await callModelText(modelId, prompt);
    return {
      ok: text !== null,
      modelId,
      text: text === null ? "" : String(text).trim(),
      durationMs: Date.now() - startedAt,
      ...(text === null ? { error: "missing_api_key" } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      modelId,
      text: "",
      error: String(err && err.message || err),
      durationMs: Date.now() - startedAt,
    };
  }
}

async function askLegion(prompt, options = {}) {
  loadLegionEnv();
  if (options.timeoutMs) process.env.API_TIMEOUT_MS = String(options.timeoutMs);
  const models = selectModels(options);
  const results = await runPool(models, options.concurrency || DEFAULT_CONCURRENCY, async (model) => {
    const result = await askModel(model.id, prompt, options);
    return {
      ...result,
      modelName: model.name,
      vendor: model.vendor,
    };
  });
  return {
    prompt,
    generatedAt: new Date().toISOString(),
    total: results.length,
    ok: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
}

function parseArgs(argv) {
  const args = {
    prompt: "",
    models: "",
    group: "all",
    concurrency: DEFAULT_CONCURRENCY,
    format: "text",
    timeoutMs: 0,
    listModels: false,
  };
  const promptParts = [];

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if ((key === "--models" || key === "-m") && next) {
      args.models = next;
      i += 1;
    } else if (key === "--group" && next) {
      args.group = next;
      i += 1;
    } else if (key === "--domestic") {
      args.group = "domestic";
    } else if (key === "--overseas") {
      args.group = "overseas";
    } else if ((key === "--concurrency" || key === "-c") && next) {
      args.concurrency = Number(next) || DEFAULT_CONCURRENCY;
      i += 1;
    } else if ((key === "--timeout" || key === "-t") && next) {
      args.timeoutMs = Number(next) || 0;
      i += 1;
    } else if ((key === "--format" || key === "-f") && next) {
      args.format = next;
      i += 1;
    } else if (key === "--list-models") {
      args.listModels = true;
    } else if (key === "--help" || key === "-h") {
      args.help = true;
    } else {
      promptParts.push(key);
    }
  }

  args.prompt = promptParts.join(" ").trim();
  return args;
}

function printHelp() {
  console.log(`AI Legion

Usage:
  ai-legion "your prompt"
  ai-legion --models qwen-3-7-max,gemini-3-1 "your prompt"
  ai-legion --domestic "your prompt"
  ai-legion --format json "your prompt"

Options:
  -m, --models <ids>       Comma-separated model ids or names
      --domestic           Use domestic models only
      --overseas           Use overseas models only
  -c, --concurrency <n>    Parallel calls, default ${DEFAULT_CONCURRENCY}
  -t, --timeout <ms>       Override API_TIMEOUT_MS for this run
  -f, --format <text|json> Output format, default text
      --list-models        Print enabled model ids
`);
}

function printModels() {
  for (const model of enabledModels()) {
    const group = DOMESTIC_MODEL_IDS.has(model.id) ? "domestic" : "overseas";
    console.log(`${model.id}\t${model.name}\t${group}`);
  }
}

function printTextReport(output) {
  console.log(`Prompt: ${output.prompt}`);
  console.log(`Models: ${output.ok}/${output.total} ok, ${output.failed} failed`);
  for (const item of output.results) {
    console.log("");
    console.log(`## ${item.modelName} (${item.modelId})`);
    if (item.ok) {
      console.log(item.text || "(empty)");
    } else {
      console.log(`ERROR: ${item.error}`);
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }
  if (args.listModels) {
    printModels();
    return;
  }
  if (!args.prompt) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const output = await askLegion(args.prompt, args);
  if (args.format === "json") {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printTextReport(output);
  }
  if (output.failed) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  PROJECT_ROOT,
  askLegion,
  askModel,
  enabledModels,
  selectModels,
  loadLegionEnv,
  main,
};
