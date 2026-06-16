const fs = require("fs");
const path = require("path");
const { getConfig } = require("./config");
const { loadProjectEnv } = require("./lib/env");
const { hydrateOddsForMatch } = require("./odds");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");

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
  const args = { date: addDays(beijingDateKey(), 1), matchIds: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--date" && next) {
      args.date = next;
      i += 1;
    } else if (key === "--match" && next) {
      args.matchIds.push(next);
      i += 1;
    } else if (key === "--matches" && next) {
      args.matchIds.push(...next.split(",").map((item) => item.trim()).filter(Boolean));
      i += 1;
    }
  }
  return args;
}

function hasResultOdds(match) {
  const odds = match && match.odds && match.odds.result ? match.odds.result : {};
  return ["home", "draw", "away"].every((key) => Number.isFinite(Number(odds[key])) && Number(odds[key]) > 0);
}

function mergeOdds(existing, hydrated) {
  const current = existing.odds || {};
  const next = hydrated.odds || {};
  return {
    result: {
      ...(current.result || {}),
      ...Object.fromEntries(Object.entries(next.result || {}).filter(([, value]) => value !== null && value !== undefined)),
    },
    scores: {
      ...(current.scores || {}),
      ...Object.fromEntries(Object.entries(next.scores || {}).filter(([, value]) => value !== null && value !== undefined)),
    },
  };
}

async function syncOdds() {
  loadProjectEnv();
  const config = getConfig();
  const args = parseArgs(process.argv.slice(2));
  const data = readJson(MATCHES_PATH, { matches: [] });
  const targets = (data.matches || [])
    .filter((match) => (args.matchIds.length ? args.matchIds.includes(match.id) : beijingDateKey(match.kickoff) === args.date))
    .filter((match) => !match.placeholder && !match.actual);

  let changed = 0;
  for (const match of targets) {
    try {
      const hydrated = await hydrateOddsForMatch({ ...match, odds: { result: { home: null, draw: null, away: null }, scores: {} } }, config);
      if (!hasResultOdds(hydrated)) {
        console.warn(`[sync-odds] ${match.id} ${match.home.team} vs ${match.away.team}: no result odds`);
        continue;
      }
      match.odds = mergeOdds(match, hydrated);
      changed += 1;
      const odds = match.odds.result;
      console.log(`[sync-odds] ${match.id} ${match.home.team} vs ${match.away.team}: ${odds.home}/${odds.draw}/${odds.away}`);
    } catch (err) {
      console.warn(`[sync-odds] ${match.id} failed: ${err.message}`);
    }
  }

  if (!changed) {
    console.log("[sync-odds] no changes");
    return;
  }
  data.source = {
    ...(data.source || {}),
    oddsSyncedAt: new Date().toISOString(),
  };
  writeJson(MATCHES_PATH, data);
  console.log(`[sync-odds] wrote ${MATCHES_PATH}, changed=${changed}`);
}

if (require.main === module) {
  syncOdds().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { syncOdds };
