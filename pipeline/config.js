const DEFAULT_API_BASE = "https://v3.football.api-sports.io";
const DEFAULT_BACKUP_ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const DEFAULT_EU_ODDS_REGIONS = "eu";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_FOOTBALL_CONFIG_PATH = "/Users/tom/.openclaw/workspace/football/config.json";

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getConfig(env = process.env) {
  const footballConfig = readFootballConfig(env.FOOTBALL_CONFIG_PATH || DEFAULT_FOOTBALL_CONFIG_PATH);
  return {
    oddsApiBase: String(env.ODDS_API_BASE || env.APISPORTS_API_BASE || footballConfig.apiBase || DEFAULT_API_BASE).replace(/\/+$/, ""),
    oddsApiKey: String(env.ODDS_API_KEY || env.APISPORTS_API_KEY || footballConfig.apiKey || "").trim(),
    oddsBookmakerId: String(env.ODDS_BOOKMAKER_ID || "").trim(),
    euroOddsApiBase: String(env.EURO_ODDS_API_BASE || env.THE_ODDS_API_BASE || DEFAULT_BACKUP_ODDS_API_BASE).replace(/\/+$/, ""),
    euroOddsApiKey: String(env.EURO_ODDS_API_KEY || env.THE_ODDS_API_KEY || env.BACKUP_ODDS_API_KEY || "").trim(),
    euroOddsSportKey: String(env.EURO_ODDS_SPORT_KEY || env.THE_ODDS_SPORT_KEY || env.BACKUP_ODDS_SPORT_KEY || "soccer_fifa_world_cup").trim(),
    euroOddsRegions: String(env.EURO_ODDS_REGIONS || env.THE_ODDS_REGIONS || DEFAULT_EU_ODDS_REGIONS).trim(),
    euroOddsBookmakers: String(env.EURO_ODDS_BOOKMAKERS || env.THE_ODDS_BOOKMAKERS || "").trim(),
    backupOddsApiBase: String(env.BACKUP_ODDS_API_BASE || env.THE_ODDS_API_BASE || DEFAULT_BACKUP_ODDS_API_BASE).replace(/\/+$/, ""),
    backupOddsApiKey: String(env.BACKUP_ODDS_API_KEY || env.THE_ODDS_API_KEY || "").trim(),
    backupOddsSportKey: String(env.BACKUP_ODDS_SPORT_KEY || env.THE_ODDS_SPORT_KEY || "soccer_fifa_world_cup").trim(),
    backupOddsRegions: String(env.BACKUP_ODDS_REGIONS || env.THE_ODDS_REGIONS || "uk,eu,us,au").trim(),
    backupOddsBookmakers: String(env.BACKUP_ODDS_BOOKMAKERS || env.THE_ODDS_BOOKMAKERS || "").trim(),
    backupOddsFallbackPath: String(env.ODDS_FALLBACK_PATH || "").trim(),
    requestTimeoutMs: toNumber(env.REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    footballConfigPath: env.FOOTBALL_CONFIG_PATH || DEFAULT_FOOTBALL_CONFIG_PATH,
  };
}

function readFootballConfig(filePath) {
  try {
    const fs = require("fs");
    if (!filePath || !fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return {};
  }
}

module.exports = {
  DEFAULT_API_BASE,
  DEFAULT_BACKUP_ODDS_API_BASE,
  DEFAULT_EU_ODDS_REGIONS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_FOOTBALL_CONFIG_PATH,
  getConfig,
};
