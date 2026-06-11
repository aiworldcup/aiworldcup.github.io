const DEFAULT_MAX_RESULT_STAKE_PER_MATCH = 200;
const DEFAULT_MAX_SCORE_STAKE_PER_MATCH = 100;
const DEFAULT_MAX_STAKE_PER_MATCH = DEFAULT_MAX_RESULT_STAKE_PER_MATCH + DEFAULT_MAX_SCORE_STAKE_PER_MATCH;
const DEFAULT_MATCH_GRANT_POINTS = 100;
const DEFAULT_API_BASE = "https://v3.football.api-sports.io";
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_FOOTBALL_CONFIG_PATH = "/Users/tom/.openclaw/workspace/football/config.json";

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getConfig(env = process.env) {
  const footballConfig = readFootballConfig(env.FOOTBALL_CONFIG_PATH || DEFAULT_FOOTBALL_CONFIG_PATH);
  const maxResultStakePerMatch = toNumber(env.MAX_RESULT_STAKE_PER_MATCH, DEFAULT_MAX_RESULT_STAKE_PER_MATCH);
  const maxScoreStakePerMatch = toNumber(env.MAX_SCORE_STAKE_PER_MATCH, DEFAULT_MAX_SCORE_STAKE_PER_MATCH);
  return {
    maxResultStakePerMatch,
    maxScoreStakePerMatch,
    maxStakePerMatch: toNumber(env.MAX_TOTAL_STAKE_PER_MATCH, maxResultStakePerMatch + maxScoreStakePerMatch),
    matchGrantPoints: toNumber(env.MATCH_GRANT_POINTS, DEFAULT_MATCH_GRANT_POINTS),
    oddsApiBase: String(env.ODDS_API_BASE || env.APISPORTS_API_BASE || footballConfig.apiBase || DEFAULT_API_BASE).replace(/\/+$/, ""),
    oddsApiKey: String(env.ODDS_API_KEY || env.APISPORTS_API_KEY || footballConfig.apiKey || "").trim(),
    oddsBookmakerId: String(env.ODDS_BOOKMAKER_ID || "").trim(),
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
  DEFAULT_MAX_STAKE_PER_MATCH,
  DEFAULT_MAX_RESULT_STAKE_PER_MATCH,
  DEFAULT_MAX_SCORE_STAKE_PER_MATCH,
  DEFAULT_MATCH_GRANT_POINTS,
  DEFAULT_API_BASE,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_FOOTBALL_CONFIG_PATH,
  getConfig,
};
