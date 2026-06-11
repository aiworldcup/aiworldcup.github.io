const fs = require("fs");
const path = require("path");
const { getConfig } = require("./config");
const { loadEnv } = require("./lib/env");

const SAMPLE_PATH = path.join(__dirname, "..", "public", "data", "sample-matches.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, done: () => clearTimeout(timer) };
}

async function fetchApi(endpoint, params = {}, config = getConfig()) {
  if (!config.oddsApiKey) {
    throw new Error("缺少 ODDS_API_KEY 或 APISPORTS_API_KEY");
  }
  const query = new URLSearchParams(params);
  const url = `${config.oddsApiBase}${endpoint}${query.toString() ? `?${query}` : ""}`;
  const timeout = withTimeout(config.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "x-apisports-key": config.oddsApiKey },
      signal: timeout.controller.signal,
    });
    if (!res.ok) throw new Error(`API-SPORTS 请求失败: ${res.status}`);
    const payload = await res.json();
    if (payload && payload.errors && Object.keys(payload.errors).length > 0) {
      throw new Error(`API-SPORTS 返回错误: ${JSON.stringify(payload.errors)}`);
    }
    return payload;
  } finally {
    timeout.done();
  }
}

function getResultFromGoals(home, away) {
  if (home > away) return "home";
  if (home < away) return "away";
  return "draw";
}

function normalizeFixture(raw) {
  const fixture = raw.fixture || {};
  const league = raw.league || {};
  const home = raw.teams && raw.teams.home ? raw.teams.home : {};
  const away = raw.teams && raw.teams.away ? raw.teams.away : {};
  const goals = raw.goals || {};
  const homeGoals = toNumber(goals.home);
  const awayGoals = toNumber(goals.away);
  const status = fixture.status || {};
  const finished = ["FT", "AET", "PEN"].includes(String(status.short || "").toUpperCase());

  return {
    id: `fixture-${fixture.id}`,
    sourceFixtureId: fixture.id,
    stage: [league.name, league.round].filter(Boolean).join(" · "),
    kickoff: fixture.date,
    home: { team: home.name || "Home", flag: "" },
    away: { team: away.name || "Away", flag: "" },
    odds: {
      result: { home: null, draw: null, away: null },
      scores: {},
    },
    sealedAt: null,
    actual:
      finished && homeGoals !== null && awayGoals !== null
        ? { result: getResultFromGoals(homeGoals, awayGoals), score: `${homeGoals}-${awayGoals}` }
        : null,
    predictions: [],
  };
}

function labelToResult(label) {
  const text = String(label || "").trim().toLowerCase();
  if (["home", "1", "team 1", "home team"].includes(text)) return "home";
  if (["draw", "x"].includes(text)) return "draw";
  if (["away", "2", "team 2", "away team"].includes(text)) return "away";
  return null;
}

function normalizeScoreLabel(label) {
  const match = String(label || "").match(/(\d+)\s*[-:]\s*(\d+)/);
  return match ? `${Number(match[1])}-${Number(match[2])}` : null;
}

function applyBet(match, bet) {
  const name = String((bet && bet.name) || "").toLowerCase();
  const values = Array.isArray(bet && bet.values) ? bet.values : [];
  if (name.includes("match winner") || name === "1x2") {
    values.forEach((entry) => {
      const key = labelToResult(entry.value);
      const odd = toNumber(entry.odd);
      if (key && odd) match.odds.result[key] = odd;
    });
  }
  if (name.includes("correct score")) {
    values.forEach((entry) => {
      const score = normalizeScoreLabel(entry.value);
      const odd = toNumber(entry.odd);
      if (score && odd) match.odds.scores[score] = odd;
    });
  }
}

function applyOddsPayload(match, payload, config = getConfig()) {
  const rows = Array.isArray(payload && payload.response) ? payload.response : [];
  const targetBookmaker = config.oddsBookmakerId;
  rows.forEach((row) => {
    const bookmakers = Array.isArray(row.bookmakers) ? row.bookmakers : [];
    const selected = targetBookmaker
      ? bookmakers.filter((bookmaker) => String(bookmaker.id) === targetBookmaker)
      : bookmakers.slice(0, 1);
    selected.forEach((bookmaker) => {
      (Array.isArray(bookmaker.bets) ? bookmaker.bets : []).forEach((bet) => applyBet(match, bet));
    });
  });
  return match;
}

async function fetchFixturesByDate(date, config = getConfig()) {
  const payload = await fetchApi("/fixtures", { date }, config);
  return (Array.isArray(payload.response) ? payload.response : []).map(normalizeFixture);
}

async function hydrateOddsForMatch(match, config = getConfig()) {
  if (!match.sourceFixtureId) return match;
  const params = { fixture: String(match.sourceFixtureId) };
  if (config.oddsBookmakerId) params.bookmaker = config.oddsBookmakerId;
  const payload = await fetchApi("/odds", params, config);
  return applyOddsPayload(match, payload, config);
}

async function fetchMatchesWithOdds(options = {}) {
  loadEnv();
  const config = getConfig();
  if (!config.oddsApiKey) {
    console.warn("[odds] 缺少 ODDS_API_KEY/APISPORTS_API_KEY,回退 public/data/sample-matches.json");
    return readJson(SAMPLE_PATH);
  }

  const date = options.date || process.env.MATCH_DATE;
  if (!date) {
    console.warn("[odds] 未设置 MATCH_DATE,回退 public/data/sample-matches.json");
    return readJson(SAMPLE_PATH);
  }

  const fixtures = await fetchFixturesByDate(date, config);
  const matches = [];
  for (const fixture of fixtures.slice(0, Number(options.limit || process.env.MATCH_LIMIT || 8))) {
    matches.push(await hydrateOddsForMatch(fixture, config));
  }
  return { matches };
}

if (require.main === module) {
  const dateArg = process.argv.find((arg) => arg.startsWith("--date="));
  fetchMatchesWithOdds({ date: dateArg ? dateArg.split("=")[1] : undefined })
    .then((data) => process.stdout.write(`${JSON.stringify(data, null, 2)}\n`))
    .catch((err) => {
      console.error(err.stack || err.message);
      process.exit(1);
    });
}

module.exports = {
  fetchApi,
  fetchMatchesWithOdds,
  fetchFixturesByDate,
  hydrateOddsForMatch,
  normalizeFixture,
  applyOddsPayload,
};
