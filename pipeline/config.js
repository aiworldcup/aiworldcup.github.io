const DEFAULT_MAX_STAKE_PER_MATCH = 100;
const DEFAULT_API_BASE = "https://v3.football.api-sports.io";
const DEFAULT_TIMEOUT_MS = 12000;

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getConfig(env = process.env) {
  return {
    maxStakePerMatch: toNumber(env.MAX_STAKE_PER_MATCH, DEFAULT_MAX_STAKE_PER_MATCH),
    oddsApiBase: String(env.ODDS_API_BASE || env.APISPORTS_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, ""),
    oddsApiKey: String(env.ODDS_API_KEY || env.APISPORTS_API_KEY || "").trim(),
    oddsBookmakerId: String(env.ODDS_BOOKMAKER_ID || "").trim(),
    requestTimeoutMs: toNumber(env.REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

module.exports = {
  DEFAULT_MAX_STAKE_PER_MATCH,
  DEFAULT_API_BASE,
  DEFAULT_TIMEOUT_MS,
  getConfig,
};
