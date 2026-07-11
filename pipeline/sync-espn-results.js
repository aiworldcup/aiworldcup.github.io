const fs = require("fs");
const path = require("path");
const { getConfig } = require("./config");
const { scoreScopeFromEspnEvent } = require("./result-scope");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "espn-results.json");
const ESPN_SCOREBOARD_API = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const ESPN_MATCH_URL = "https://www.espn.com/soccer/match/_/gameId/";
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_RETRIES = 2;
const MATCH_TIME_TOLERANCE_MS = 18 * 60 * 60 * 1000;

const TEAM_ALIASES = {
  "Bosnia & Herzegovina": ["Bosnia and Herzegovina", "Bosnia-Herzegovina"],
  "Cape Verde Islands": ["Cape Verde", "Cabo Verde"],
  "Congo DR": ["DR Congo", "Congo Democratic Republic", "Democratic Republic of Congo"],
  "Curaçao": ["Curacao"],
  Czechia: ["Czech Republic"],
  Iran: ["IR Iran"],
  "Ivory Coast": ["Cote d'Ivoire", "Côte d'Ivoire"],
  Qatar: ["QAT"],
  "Saudi Arabia": ["KSA"],
  "South Korea": ["Korea Republic", "Korea", "Republic of Korea"],
  Türkiye: ["Turkey", "Turkiye"],
  USA: ["United States", "United States of America"],
};

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["updatedAt", "syncedAt"].includes(key))
      .map(([key, item]) => [key, comparable(item)])
  );
}

function writeJsonIfChanged(filePath, data) {
  if (fs.existsSync(filePath)) {
    try {
      const existing = readJson(filePath);
      if (JSON.stringify(comparable(existing)) === JSON.stringify(comparable(data))) return false;
    } catch (_) {
      // Rewrite invalid JSON.
    }
  }
  writeJson(filePath, data);
  return true;
}

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
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
  const values = [team && team.teamEn, team && team.team, team && team.flag].filter(Boolean);
  values.slice().forEach((name) => {
    (TEAM_ALIASES[name] || []).forEach((alias) => values.push(alias));
  });
  return Array.from(new Set(values.map(normalizeName).filter(Boolean)));
}

function namesMatch(value, candidates) {
  const normalized = normalizeName(value);
  return candidates.some((candidate) => normalized === candidate);
}

function dateKeyUTC(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function offsetDateKey(value, days) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKeyUTC(date);
}

function isoDateKey(value) {
  return String(value || "").replace(/-/g, "");
}

function dateRange(from, to) {
  const out = [];
  const current = new Date(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6, 8)}T00:00:00Z`);
  const end = new Date(`${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6, 8)}T00:00:00Z`);
  while (current <= end) {
    out.push(dateKeyUTC(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return out;
}

function relevantEspnDates(matches, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const lookbackDays = Number(options.lookbackDays || DEFAULT_LOOKBACK_DAYS);
  const oldest = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  const keys = new Set();
  (matches || [])
    .filter((match) => !match.placeholder && match.kickoff)
    .filter((match) => {
      const kickoff = new Date(match.kickoff).getTime();
      return Number.isFinite(kickoff) && kickoff <= now.getTime() && kickoff >= oldest;
    })
    .forEach((match) => {
      keys.add(offsetDateKey(match.kickoff, -1));
      keys.add(offsetDateKey(match.kickoff, 0));
      keys.add(offsetDateKey(match.kickoff, 1));
    });
  return Array.from(keys).sort();
}

function requestedDateKeys(matches, options = {}) {
  if (options.date) return [isoDateKey(options.date)];
  if (options.from || options.to) {
    const today = dateKeyUTC(new Date());
    return dateRange(isoDateKey(options.from || options.to || today), isoDateKey(options.to || options.from || today));
  }
  return relevantEspnDates(matches, options);
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, done: () => clearTimeout(timer) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchEspnScoreboard(dateKey, config = getConfig()) {
  const url = new URL(ESPN_SCOREBOARD_API);
  url.searchParams.set("dates", dateKey);
  const timeout = withTimeout(config.requestTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: timeout.controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`ESPN ${response.status}: ${text.slice(0, 120)}`);
    return JSON.parse(text);
  } finally {
    timeout.done();
  }
}

async function fetchEspnScoreboardWithRetry(dateKey, config = getConfig(), retries = DEFAULT_RETRIES) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchEspnScoreboard(dateKey, config);
    } catch (err) {
      lastError = err;
      if (attempt >= retries) break;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
}

function homeAwayCompetitors(event) {
  const competitors = (((event.competitions || [])[0] || {}).competitors || []);
  return {
    home: competitors.find((item) => item.homeAway === "home") || null,
    away: competitors.find((item) => item.homeAway === "away") || null,
  };
}

function competitorName(competitor) {
  return competitor && competitor.team && (competitor.team.displayName || competitor.team.name || competitor.team.shortDisplayName);
}

function eventMatchesLocalMatch(event, match) {
  const { home, away } = homeAwayCompetitors(event);
  if (!home || !away) return false;
  const eventTime = new Date(event.date || 0).getTime();
  const matchTime = new Date(match.kickoff || 0).getTime();
  if (!Number.isFinite(eventTime) || !Number.isFinite(matchTime)) return false;
  if (Math.abs(eventTime - matchTime) > MATCH_TIME_TOLERANCE_MS) return false;
  return namesMatch(competitorName(home), teamCandidates(match.home))
    && namesMatch(competitorName(away), teamCandidates(match.away));
}

function resultFromScore(home, away) {
  if (home > away) return "home";
  if (home < away) return "away";
  return "draw";
}

function toScore(value) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : null;
}

function entryFromEvent(event, match) {
  const status = event.status && event.status.type;
  if (!status || !status.completed) return null;
  const { home, away } = homeAwayCompetitors(event);
  const homeScore = toScore(home && home.score);
  const awayScore = toScore(away && away.score);
  if (homeScore === null || awayScore === null) return null;
  const advanceResult = home?.winner === true && away?.winner !== true
    ? "home"
    : away?.winner === true && home?.winner !== true
      ? "away"
      : null;
  const statusText = `${status.description || ""} ${status.shortDetail || ""}`;
  const advanceMethod = /pen/i.test(statusText)
    ? "penalties"
    : /extra|aet/i.test(statusText)
      ? "extra-time"
      : "regulation";
  return {
    matchId: match.id,
    espnEventId: String(event.id || ""),
    matchDate: match.kickoff ? new Date(match.kickoff).toISOString().slice(0, 10) : "",
    eventDate: event.date || null,
    league: "FIFA World Cup",
    homeTeam: match.home && match.home.team,
    awayTeam: match.away && match.away.team,
    score: `${homeScore}:${awayScore}`,
    result: resultFromScore(homeScore, awayScore),
    ...(advanceResult ? { advanceResult, advanceMethod } : {}),
    scoreScope: scoreScopeFromEspnEvent(event),
    sourceLabel: "ESPN Scoreboard",
    sourceHref: event.id ? `${ESPN_MATCH_URL}${event.id}` : ESPN_SCOREBOARD_API,
    syncedAt: new Date().toISOString(),
  };
}

function mapEspnEventsToMatches(events, matches) {
  const entries = [];
  (events || []).forEach((event) => {
    const match = (matches || []).find((item) => !item.placeholder && eventMatchesLocalMatch(event, item));
    if (!match) return;
    const entry = entryFromEvent(event, match);
    if (entry) entries.push(entry);
  });
  return entries;
}

function mergeEntry(existing, fresh) {
  if (!existing) return fresh;
  return {
    ...existing,
    ...fresh,
    score: fresh.score || existing.score,
    result: fresh.result || existing.result,
    advanceResult: fresh.advanceResult || existing.advanceResult,
    advanceMethod: fresh.advanceMethod || existing.advanceMethod,
    scoreScope: fresh.scoreScope || existing.scoreScope,
    sourceLabel: fresh.sourceLabel || existing.sourceLabel,
    sourceHref: fresh.sourceHref || existing.sourceHref,
  };
}

function mergeEntries(existing, freshEntries) {
  const byMatchId = new Map((existing.matches || []).map((entry) => [entry.matchId, entry]));
  freshEntries.forEach((entry) => byMatchId.set(entry.matchId, mergeEntry(byMatchId.get(entry.matchId), entry)));
  return Array.from(byMatchId.values()).sort((a, b) => {
    const ka = `${a.matchDate || ""}|${a.eventDate || ""}|${a.matchId || ""}`;
    const kb = `${b.matchDate || ""}|${b.eventDate || ""}|${b.matchId || ""}`;
    return ka.localeCompare(kb);
  });
}

async function syncEspnResults(options = {}) {
  const matches = readJson(MATCHES_PATH, { matches: [] }).matches || [];
  const dateKeys = requestedDateKeys(matches, options);
  const config = getConfig();
  const freshEntries = [];
  const errors = [];

  for (const dateKey of dateKeys) {
    try {
      const payload = await fetchEspnScoreboardWithRetry(dateKey, config);
      freshEntries.push(...mapEspnEventsToMatches(payload.events || [], matches));
    } catch (err) {
      errors.push(`${dateKey}: ${err.message}`);
      if (options.soft === false) throw err;
      console.warn(`[espn-results] ${dateKey} skipped: ${err.message}`);
    }
  }

  const existing = readJson(OUTPUT_PATH, { version: 1, matches: [] });
  const merged = mergeEntries(existing, freshEntries);
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    status: errors.length ? "partial" : "verified",
    source: {
      label: "ESPN public scoreboard",
      href: ESPN_SCOREBOARD_API,
      note: "No API key. ESPN dates use North American match-day buckets, so the sync checks adjacent UTC dates around local kickoff.",
    },
    checkedDateKeys: dateKeys,
    errors,
    matches: merged,
  };

  const changed = options.dryRun ? false : writeJsonIfChanged(OUTPUT_PATH, next);
  console.log(`[espn-results] dates=${dateKeys.length} fresh=${freshEntries.length} total=${merged.length} changed=${changed}`);
  return { changed, dates: dateKeys.length, fresh: freshEntries.length, total: merged.length, errors };
}

async function main() {
  await syncEspnResults({
    date: argValue("date"),
    from: argValue("from"),
    to: argValue("to"),
    lookbackDays: Number(argValue("lookback-days") || process.env.ESPN_RESULTS_LOOKBACK_DAYS || DEFAULT_LOOKBACK_DAYS),
    soft: !hasFlag("strict"),
    dryRun: hasFlag("dry-run"),
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  entryFromEvent,
  eventMatchesLocalMatch,
  mapEspnEventsToMatches,
  requestedDateKeys,
  syncEspnResults,
};
