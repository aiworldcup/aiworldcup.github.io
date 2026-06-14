const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./lib/env");
const { syncRealData } = require("./sync-real-data");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const DISCUSSIONS_PATH = path.join(__dirname, "..", "public", "data", "discussions.json");

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] || null;
}

async function main() {
  loadProjectEnv();
  const date = argValue("date") || addDays(beijingDateKey(), 1);
  const limit = Number(argValue("limit") || process.env.AUTO_ROUNDTABLE_LIMIT || 8);

  await syncRealData();

  const matches = readJson(MATCHES_PATH, { matches: [] }).matches || [];
  const discussions = readJson(DISCUSSIONS_PATH, { discussions: [] }).discussions || [];
  const discussed = new Set(discussions.map((item) => item.matchId));
  const targets = matches
    .filter((match) => beijingDateKey(match.kickoff) === date)
    .filter((match) => !match.placeholder && !match.actual)
    .filter((match) => !discussed.has(match.id));

  if (!targets.length) {
    console.log(`[auto-roundtable] ${date} no target matches; skip discussion.`);
    return;
  }

  const selected = targets.slice(0, limit);
  console.log(`[auto-roundtable] ${date} targets=${selected.map((match) => match.id).join(",")}`);
  let failed = 0;
  for (const match of selected) {
    console.log(`[auto-roundtable] discuss ${match.id}: ${match.home.team} vs ${match.away.team}`);
    const result = spawnSync(process.execPath, [
      path.join(__dirname, "discuss.js"),
      "--match",
      match.id,
      "--skip-existing",
    ], {
      cwd: path.join(__dirname, ".."),
      env: process.env,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      failed += 1;
      console.warn(`[auto-roundtable] ${match.id} failed with status ${result.status}`);
    }
  }

  if (failed) console.warn(`[auto-roundtable] failed matches=${failed}; generated matches are kept, next run can retry missing ones.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { main, beijingDateKey, addDays };
