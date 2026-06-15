const fs = require("fs");
const path = require("path");

const MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "jingcai-single.json");
const SPORTTERY_URL = "https://www.sporttery.cn/jc/zqsgkj/";
const SPORTTERY_API = "https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry";
const ASIA_SHANGHAI = "Asia/Shanghai";

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
      // Fall through and rewrite invalid JSON.
    }
  }
  writeJson(filePath, data);
  return true;
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

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function cleanTeamName(value) {
  return String(value || "")
    .replace(/[（(]\s*[+-]?\d+\s*[)）]/g, "")
    .replace(/\s+/g, "")
    .replace(/　/g, "")
    .trim();
}

function normalizeTeamName(value) {
  return cleanTeamName(value)
    .replace(/土尔其/g, "土耳其")
    .replace(/荷蘭/g, "荷兰")
    .replace(/摩洛哥队/g, "摩洛哥")
    .replace(/日本队/g, "日本")
    .replace(/瑞典队/g, "瑞典")
    .replace(/突尼斯队/g, "突尼斯");
}

function scoreText(homeScore, awayScore) {
  if (homeScore === undefined || awayScore === undefined || homeScore === null || awayScore === null) return "";
  const home = String(homeScore).trim();
  const away = String(awayScore).trim();
  return home && away ? `${home}:${away}` : "";
}

function pick(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return row[key];
  }
  return "";
}

function parseTeamPair(value) {
  const text = String(value || "")
    .replace(/[（(]\s*[+-]?\d+\s*[)）]/g, "")
    .replace(/\s+/g, "");
  const match = text.match(/^(.+?)(?:VS|vs|V|－|-)(.+)$/);
  if (!match) return null;
  return {
    homeTeam: cleanTeamName(match[1]),
    awayTeam: cleanTeamName(match[2]),
  };
}

function normalizeOfficialRow(row) {
  const pair = parseTeamPair(pick(row, [
    "matchName",
    "matchNameFull",
    "matchInfo",
    "matchTeams",
    "matchTeam",
    "teams",
    "matchAgainst",
  ]));
  const homeTeam = cleanTeamName(pick(row, [
    "homeTeam",
    "allHomeTeam",
    "homeTeamName",
    "homeTeamAllName",
    "homeName",
    "hostTeam",
    "hostTeamName",
    "teamH",
  ]) || pair?.homeTeam);
  const awayTeam = cleanTeamName(pick(row, [
    "awayTeam",
    "allAwayTeam",
    "awayTeamName",
    "awayTeamAllName",
    "awayName",
    "guestTeam",
    "guestTeamName",
    "teamA",
  ]) || pair?.awayTeam);
  const officialScore = String(pick(row, [
    "score",
    "sectionsNo999",
    "fullScore",
    "finalScore",
    "matchScore",
    "wholeScore",
  ]) || scoreText(
    pick(row, ["homeScore", "homeFullScore", "homeGoal", "scoreH"]),
    pick(row, ["awayScore", "awayFullScore", "awayGoal", "scoreA"])
  )).trim();

  return {
    jingcaiMatchId: String(pick(row, ["matchId", "id", "matchID", "match_id", "eventId"]) || "").trim(),
    matchNum: String(pick(row, ["matchNumStr", "matchNum", "matchNo", "matchSerial", "num"]) || "").trim(),
    matchDate: String(pick(row, ["matchDate", "businessDate", "saleDate", "date"]) || "").slice(0, 10),
    league: String(pick(row, ["leagueName", "leagueNameAbb", "leagueNameAbbr", "league", "competitionName"]) || "").trim(),
    homeTeam,
    awayTeam,
    officialScore,
  };
}

function isUsefulOfficialRow(row) {
  return !!(row.homeTeam && row.awayTeam && row.matchDate);
}

function collectObjects(value, out = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectObjects(item, out));
    return out;
  }
  if (!value || typeof value !== "object") return out;
  out.push(value);
  Object.values(value).forEach((item) => collectObjects(item, out));
  return out;
}

function extractOfficialRows(payload) {
  const seen = new Set();
  return collectObjects(payload)
    .map(normalizeOfficialRow)
    .filter(isUsefulOfficialRow)
    .filter((row) => {
      const key = [
        row.jingcaiMatchId,
        row.matchNum,
        row.matchDate,
        row.homeTeam,
        row.awayTeam,
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function fetchOfficialPage(from, to, pageNo = 1, pageSize = 100) {
  const url = new URL(SPORTTERY_API);
  url.searchParams.set("matchBeginDate", from);
  url.searchParams.set("matchEndDate", to);
  url.searchParams.set("leagueId", "");
  url.searchParams.set("isFix", "1");
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("matchPage", "1");
  url.searchParams.set("pcOrWap", "1");
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: SPORTTERY_URL,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sporttery ${response.status}: ${text.slice(0, 120)}`);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Sporttery response is not JSON: ${text.slice(0, 120)}`);
  }
}

async function fetchOfficialRows(from, to) {
  const rows = [];
  const seen = new Set();
  for (let pageNo = 1; pageNo <= 20; pageNo += 1) {
    const payload = await fetchOfficialPage(from, to, pageNo);
    const pageRows = extractOfficialRows(payload);
    let added = 0;
    pageRows.forEach((row) => {
      const key = [
        row.jingcaiMatchId,
        row.matchNum,
        row.matchDate,
        row.homeTeam,
        row.awayTeam,
      ].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(row);
      added += 1;
    });
    if (!added || pageRows.length < 100) break;
  }
  return rows;
}

function matchDateKey(match) {
  if (match.dateKey) return match.dateKey;
  return match.kickoff ? beijingDateKey(match.kickoff) : "";
}

function sameTeamPair(match, row) {
  return normalizeTeamName(match.home.team) === normalizeTeamName(row.homeTeam)
    && normalizeTeamName(match.away.team) === normalizeTeamName(row.awayTeam);
}

function findLocalMatch(row, matches) {
  const exact = matches.find((match) => match.id === row.matchId);
  if (exact) return exact;
  const sameDate = matches.filter((match) => matchDateKey(match) === row.matchDate);
  return sameDate.find((match) => sameTeamPair(match, row))
    || matches.find((match) => sameTeamPair(match, row));
}

function mapOfficialRows(rows, matches) {
  return rows
    .map((row) => {
      const match = findLocalMatch(row, matches);
      if (!match) return null;
      return {
        matchId: match.id,
        jingcaiMatchId: row.jingcaiMatchId || undefined,
        matchNum: row.matchNum || undefined,
        matchDate: row.matchDate,
        league: row.league || "世界杯",
        homeTeam: match.home.team,
        awayTeam: match.away.team,
        kickoff: match.kickoff || null,
        officialScore: row.officialScore || undefined,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.kickoff || a.matchDate).localeCompare(String(b.kickoff || b.matchDate)));
}

function mergeEntries(existing, fresh) {
  const byMatchId = new Map((existing.matches || []).map((entry) => [entry.matchId, entry]));
  fresh.forEach((entry) => byMatchId.set(entry.matchId, entry));
  return Array.from(byMatchId.values()).sort((a, b) => {
    const ka = `${a.matchDate || ""}|${a.kickoff || ""}|${a.matchId || ""}`;
    const kb = `${b.matchDate || ""}|${b.kickoff || ""}|${b.matchId || ""}`;
    return ka.localeCompare(kb);
  });
}

async function syncJingcaiSingle(options = {}) {
  const today = beijingDateKey();
  const from = options.from || addDays(today, -3);
  const to = options.to || addDays(today, 1);
  const soft = options.soft !== false;
  const dryRun = !!options.dryRun;

  let officialRows = [];
  try {
    officialRows = await fetchOfficialRows(from, to);
  } catch (err) {
    if (!soft) throw err;
    console.warn(`[jingcai-single] sync skipped: ${err.message}`);
    return { changed: false, rows: 0, entries: 0, error: err.message };
  }

  const matches = readJson(MATCHES_PATH, { matches: [] }).matches || [];
  const freshEntries = mapOfficialRows(officialRows, matches);
  const existing = readJson(OUTPUT_PATH, { version: 1, matches: [] });
  const merged = mergeEntries(existing, freshEntries);
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    status: "verified",
    sources: [
      {
        label: "中国竞彩网足球赛果开奖",
        href: SPORTTERY_URL,
        note: "自动同步使用官方“仅显示胜平负单固场次”口径;官方接口使用 isFix=1 查询单固场次。",
      },
    ],
    matches: merged,
  };

  const changed = dryRun ? false : writeJsonIfChanged(OUTPUT_PATH, next);
  console.log(`[jingcai-single] ${from}..${to} officialRows=${officialRows.length} mapped=${freshEntries.length} changed=${changed}`);
  return { changed, rows: officialRows.length, entries: freshEntries.length };
}

async function main() {
  const today = beijingDateKey();
  const date = argValue("date");
  const from = argValue("from") || date || addDays(today, -3);
  const to = argValue("to") || date || addDays(today, 1);
  await syncJingcaiSingle({
    from,
    to,
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
  addDays,
  beijingDateKey,
  cleanTeamName,
  extractOfficialRows,
  mapOfficialRows,
  normalizeOfficialRow,
  syncJingcaiSingle,
};
