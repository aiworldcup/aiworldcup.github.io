const fs = require("fs");
const path = require("path");

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq === -1) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (!key) return null;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

function loadEnv(filePath = path.join(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  const loaded = {};
  raw.split(/\r?\n/).forEach((line) => {
    const pair = parseEnvLine(line);
    if (!pair) return;
    const [key, value] = pair;
    loaded[key] = value;
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  });
  return loaded;
}

function loadProjectEnv() {
  return {
    ...loadEnv(path.join(process.cwd(), ".env")),
    ...loadEnv(path.join(process.cwd(), ".env.claude-gateways")),
  };
}

module.exports = { loadEnv, loadProjectEnv };
