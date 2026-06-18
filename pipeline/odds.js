const fs = require("fs");
const path = require("path");
const { getConfig } = require("./config");
const { loadEnv } = require("./lib/env");

const SAMPLE_PATH = path.join(__dirname, "..", "public", "data", "sample-matches.json");
const DEFAULT_ODDS_FALLBACK_PATH = path.join(__dirname, "..", "public", "data", "odds-fallback.json");
const HOUR_MS = 60 * 60 * 1000;
const SPORTTERY_MATCH_LIST_URL = "https://www.sporttery.cn/jc/zqspf/";
const SPORTTERY_MATCH_LIST_API = "https://webapi.sporttery.cn/gateway/uniform/football/getMatchListV1.qry";
const ASIA_SHANGHAI = "Asia/Shanghai";

const TEAM_ALIASES = {
  "Bosnia & Herzegovina": ["Bosnia and Herzegovina", "Bosnia-Herzegovina"],
  "Cape Verde Islands": ["Cape Verde", "Cabo Verde"],
  "Congo DR": ["DR Congo", "Democratic Republic of Congo", "Congo Democratic Republic", "民主刚果", "刚果金", "刚果(金)"],
  "Curaçao": ["Curacao"],
  Czechia: ["Czech Republic"],
  "Ivory Coast": ["Cote d'Ivoire", "Côte d'Ivoire"],
  "South Korea": ["Korea Republic", "Korea", "Republic of Korea"],
  "Türkiye": ["Turkey", "Turkiye"],
  USA: ["United States", "United States of America", "USMNT"],
};

function hasResultOdds(match) {
  const odds = match && match.odds && match.odds.result ? match.odds.result : {};
  return !isDisallowedOddsProvider(match && match.odds && match.odds.provider)
    && ["home", "draw", "away"].every((key) => Number.isFinite(Number(odds[key])) && Number(odds[key]) > 0);
}

function isDisallowedOddsProvider(provider) {
  return provider === "computed-strength-fallback" || provider === "emergency-fallback";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function roundOdd(value) {
  return Number(Math.max(1.01, Math.min(25, value)).toFixed(2));
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function teamCandidates(team) {
  const values = [team && team.teamEn, team && team.team].filter(Boolean);
  values.slice().forEach((name) => {
    (TEAM_ALIASES[name] || []).forEach((alias) => values.push(alias));
  });
  return Array.from(new Set(values.map(normalizeName).filter(Boolean)));
}

function namesMatch(value, candidates) {
  const normalized = normalizeName(value);
  return candidates.some((candidate) => normalized === candidate);
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, done: () => clearTimeout(timer) };
}

function beijingDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ASIA_SHANGHAI,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
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
  if (hasResultOdds(match)) {
    match.odds = {
      ...(match.odds || {}),
      provider: "api-sports",
      source: "primary-api",
      syncedAt: new Date().toISOString(),
    };
  }
  return match;
}

async function fetchFixturesByDate(date, config = getConfig()) {
  const payload = await fetchApi("/fixtures", { date }, config);
  return (Array.isArray(payload.response) ? payload.response : []).map(normalizeFixture);
}

async function hydrateOddsFromApiSports(match, config = getConfig()) {
  if (!match.sourceFixtureId) return match;
  const params = { fixture: String(match.sourceFixtureId) };
  if (config.oddsBookmakerId) params.bookmaker = config.oddsBookmakerId;
  const payload = await fetchApi("/odds", params, config);
  return applyOddsPayload(match, payload, config);
}

function sportteryHeaders(referer = SPORTTERY_MATCH_LIST_URL) {
  return {
    Accept: "application/json, text/javascript, */*; q=0.01",
    Referer: referer,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  };
}

async function fetchSportteryMatchList(config = getConfig()) {
  const url = new URL(SPORTTERY_MATCH_LIST_API);
  url.searchParams.set("clientCode", "3001");
  const timeout = withTimeout(config.requestTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: sportteryHeaders(),
      signal: timeout.controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Sporttery ${response.status}: ${text.slice(0, 120)}`);
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error(`Sporttery response is not JSON: ${text.slice(0, 120)}`);
    }
  } finally {
    timeout.done();
  }
}

function sportteryRows(payload) {
  return (((payload && payload.value && payload.value.matchInfoList) || [])
    .flatMap((group) => group.subMatchList || []));
}

function sportteryTeamNames(row, side) {
  return [
    row && row[`${side}TeamAllName`],
    row && row[`${side}TeamAbbName`],
    row && row[`${side}TeamName`],
  ].filter(Boolean);
}

function sportteryRowMatches(row, match) {
  const dateKey = beijingDateKey(match.kickoff || Date.now());
  const rowDate = String(row.matchDate || row.businessDate || "").slice(0, 10);
  if (rowDate && rowDate !== dateKey) return false;
  const homeCandidates = teamCandidates(match.home);
  const awayCandidates = teamCandidates(match.away);
  return sportteryTeamNames(row, "home").some((name) => namesMatch(name, homeCandidates))
    && sportteryTeamNames(row, "away").some((name) => namesMatch(name, awayCandidates));
}

function extractSportteryResultOdds(row) {
  const had = (Array.isArray(row && row.oddsList) ? row.oddsList : [])
    .find((item) => item && item.poolCode === "HAD");
  if (!had) return { home: null, draw: null, away: null };
  return {
    home: toNumber(had.h),
    draw: toNumber(had.d),
    away: toNumber(had.a),
  };
}

async function hydrateOddsFromSporttery(match, config = getConfig()) {
  const payload = await fetchSportteryMatchList(config);
  const row = sportteryRows(payload).find((item) => sportteryRowMatches(item, match));
  if (!row) throw new Error("中国竞彩网未匹配到同场比赛");
  const result = extractSportteryResultOdds(row);
  const hydrated = {
    ...match,
    odds: {
      ...(match.odds || {}),
      result,
      scores: (match.odds && match.odds.scores) || {},
      provider: "sporttery",
      source: "official-website",
      sourceMatchId: row.matchId || null,
      sourceMatchNum: row.matchNumStr || row.matchNum || null,
      sourceHref: SPORTTERY_MATCH_LIST_URL,
      syncedAt: new Date().toISOString(),
    },
  };
  if (!hasResultOdds(hydrated)) throw new Error("中国竞彩网 HAD 赔率不完整");
  return hydrated;
}

function backupEventMatches(event, match) {
  const homeCandidates = teamCandidates(match.home);
  const awayCandidates = teamCandidates(match.away);
  const eventHome = event && event.home_team;
  const eventAway = event && event.away_team;
  return (
    namesMatch(eventHome, homeCandidates) && namesMatch(eventAway, awayCandidates)
  ) || (
    namesMatch(eventHome, awayCandidates) && namesMatch(eventAway, homeCandidates)
  );
}

function pickBackupEvent(events, match) {
  const kickoff = new Date(match.kickoff || 0).getTime();
  return (Array.isArray(events) ? events : [])
    .filter((event) => backupEventMatches(event, match))
    .sort((a, b) => {
      const aDiff = Math.abs(new Date(a.commence_time || 0).getTime() - kickoff);
      const bDiff = Math.abs(new Date(b.commence_time || 0).getTime() - kickoff);
      return aDiff - bDiff;
    })[0] || null;
}

function extractBackupResultOdds(event, match) {
  const homeCandidates = teamCandidates(match.home);
  const awayCandidates = teamCandidates(match.away);
  const buckets = { home: [], draw: [], away: [] };
  (Array.isArray(event.bookmakers) ? event.bookmakers : []).forEach((bookmaker) => {
    (Array.isArray(bookmaker.markets) ? bookmaker.markets : [])
      .filter((market) => market.key === "h2h")
      .forEach((market) => {
        (Array.isArray(market.outcomes) ? market.outcomes : []).forEach((outcome) => {
          const name = outcome && outcome.name;
          const price = toNumber(outcome && outcome.price);
          if (!price) return;
          if (normalizeName(name) === "draw") buckets.draw.push(price);
          else if (namesMatch(name, homeCandidates)) buckets.home.push(price);
          else if (namesMatch(name, awayCandidates)) buckets.away.push(price);
        });
      });
  });
  const average = (values) => values.length
    ? roundOdd(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
  return {
    home: average(buckets.home),
    draw: average(buckets.draw),
    away: average(buckets.away),
  };
}

async function hydrateOddsFromBackupApi(match, config = getConfig()) {
  if (!config.backupOddsApiKey) throw new Error("缺少 BACKUP_ODDS_API_KEY 或 THE_ODDS_API_KEY");
  if (!config.backupOddsSportKey) throw new Error("缺少 BACKUP_ODDS_SPORT_KEY");
  const kickoff = new Date(match.kickoff || Date.now());
  const params = new URLSearchParams({
    apiKey: config.backupOddsApiKey,
    markets: "h2h",
    oddsFormat: "decimal",
    commenceTimeFrom: new Date(kickoff.getTime() - 4 * HOUR_MS).toISOString(),
    commenceTimeTo: new Date(kickoff.getTime() + 4 * HOUR_MS).toISOString(),
  });
  if (config.backupOddsBookmakers) params.set("bookmakers", config.backupOddsBookmakers);
  else params.set("regions", config.backupOddsRegions || "uk,eu,us,au");

  const url = `${config.backupOddsApiBase}/sports/${encodeURIComponent(config.backupOddsSportKey)}/odds?${params}`;
  const timeout = withTimeout(config.requestTimeoutMs);
  try {
    const res = await fetch(url, { signal: timeout.controller.signal });
    if (!res.ok) throw new Error(`The Odds API 请求失败: ${res.status}`);
    const payload = await res.json();
    const event = pickBackupEvent(payload, match);
    if (!event) throw new Error("The Odds API 未匹配到同场比赛");
    const result = extractBackupResultOdds(event, match);
    const hydrated = {
      ...match,
      odds: {
        ...(match.odds || {}),
        result,
        scores: (match.odds && match.odds.scores) || {},
        provider: "the-odds-api",
        source: "backup-api",
        sourceEventId: event.id || null,
        syncedAt: new Date().toISOString(),
      },
    };
    if (!hasResultOdds(hydrated)) throw new Error("The Odds API 返回盘口不完整");
    return hydrated;
  } finally {
    timeout.done();
  }
}

function readLocalFallbackEntries(config = getConfig()) {
  const candidates = [
    config.backupOddsFallbackPath,
    DEFAULT_ODDS_FALLBACK_PATH,
  ].filter(Boolean);
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const data = readJson(filePath);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.matches)) return data.matches;
    if (data && typeof data === "object") return Object.entries(data).map(([id, value]) => ({ id, ...value }));
  }
  return [];
}

function hydrateOddsFromLocalFallback(match, config = getConfig()) {
  const entries = readLocalFallbackEntries(config);
  const entry = entries.find((item) => {
    if (item.id && String(item.id) === String(match.id)) return true;
    if (item.matchId && String(item.matchId) === String(match.id)) return true;
    if (item.sourceFixtureId && String(item.sourceFixtureId) === String(match.sourceFixtureId || "")) return true;
    return false;
  });
  if (!entry) throw new Error("本地备用赔率文件未命中");
  const source = entry.source || entry.oddsSource || {};
  const sourceHref = entry.sourceHref || source.href || "";
  const sourceLabel = entry.sourceLabel || source.label || entry.provider || "";
  if (!sourceHref && !sourceLabel) throw new Error("本地备用赔率必须标注权威来源");
  const result = entry.result || (entry.odds && entry.odds.result) || {};
  const hydrated = {
    ...match,
    odds: {
      ...(match.odds || {}),
      result: {
        home: toNumber(result.home),
        draw: toNumber(result.draw),
        away: toNumber(result.away),
      },
      scores: (entry.odds && entry.odds.scores) || (match.odds && match.odds.scores) || {},
      provider: entry.provider || "local-authoritative",
      source: "local-authoritative",
      sourceHref,
      sourceLabel,
      syncedAt: new Date().toISOString(),
    },
  };
  if (!hasResultOdds(hydrated)) throw new Error("本地备用赔率文件盘口不完整");
  return hydrated;
}

async function hydrateOddsForMatch(match, config = getConfig()) {
  const attempts = [];
  try {
    const hydrated = await hydrateOddsFromApiSports({ ...match }, config);
    if (hasResultOdds(hydrated)) return hydrated;
    attempts.push("api-sports: no result odds");
  } catch (err) {
    attempts.push(`api-sports: ${err.message}`);
  }

  try {
    const hydrated = await hydrateOddsFromSporttery({ ...match }, config);
    if (hasResultOdds(hydrated)) return hydrated;
    attempts.push("sporttery: no result odds");
  } catch (err) {
    attempts.push(`sporttery: ${err.message}`);
  }

  try {
    const hydrated = await hydrateOddsFromBackupApi({ ...match }, config);
    if (hasResultOdds(hydrated)) return hydrated;
    attempts.push("the-odds-api: no result odds");
  } catch (err) {
    attempts.push(`the-odds-api: ${err.message}`);
  }

  try {
    const hydrated = hydrateOddsFromLocalFallback({ ...match }, config);
    if (hasResultOdds(hydrated)) return hydrated;
    attempts.push("local-fallback: no result odds");
  } catch (err) {
    attempts.push(`local-fallback: ${err.message}`);
  }

  throw new Error(`赔率主备源均失败: ${attempts.join("; ")}`);
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
  hydrateOddsFromApiSports,
  hydrateOddsFromSporttery,
  hydrateOddsFromBackupApi,
  hydrateOddsFromLocalFallback,
  hasResultOdds,
  isDisallowedOddsProvider,
  normalizeFixture,
  applyOddsPayload,
};
