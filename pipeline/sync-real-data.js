const fs = require("fs");
const path = require("path");
const { getConfig } = require("./config");
const { loadEnv } = require("./lib/env");
const { fetchApi, hydrateOddsForMatch, normalizeFixture } = require("./odds");

const MATCHES_OUT = path.join(__dirname, "..", "public", "data", "matches.json");
const CHAMPIONS_OUT = path.join(__dirname, "..", "public", "data", "champion-predictions.json");
const WORLD_CUP_LEAGUE_ID = "1";
const WORLD_CUP_SEASON = "2026";
const TARGET_MATCH_COUNT = 104;

const KNOCKOUT_SLOTS = [
  ["Round of 32", "2026-06-28", 3],
  ["Round of 32", "2026-06-29", 3],
  ["Round of 32", "2026-06-30", 3],
  ["Round of 32", "2026-07-01", 3],
  ["Round of 32", "2026-07-02", 2],
  ["Round of 32", "2026-07-03", 2],
  ["Round of 16", "2026-07-04", 2],
  ["Round of 16", "2026-07-05", 2],
  ["Round of 16", "2026-07-06", 2],
  ["Round of 16", "2026-07-07", 2],
  ["Quarter-finals", "2026-07-09", 1],
  ["Quarter-finals", "2026-07-10", 2],
  ["Quarter-finals", "2026-07-11", 1],
  ["Semi-finals", "2026-07-14", 1],
  ["Semi-finals", "2026-07-15", 1],
  ["Match for third place", "2026-07-18", 1],
  ["Final", "2026-07-19", 1],
];

const TEAM_FLAGS = {
  Argentina: "AR",
  Algeria: "DZ",
  Brazil: "BR",
  France: "FR",
  Spain: "ES",
  England: "GB",
  Germany: "DE",
  Austria: "AT",
  Portugal: "PT",
  Netherlands: "NL",
  Belgium: "BE",
  "Bosnia & Herzegovina": "BA",
  Croatia: "HR",
  Mexico: "MX",
  "United States": "US",
  USA: "US",
  Canada: "CA",
  Japan: "JP",
  Poland: "PL",
  Uruguay: "UY",
  Italy: "IT",
  Morocco: "MA",
  Switzerland: "CH",
  Denmark: "DK",
  Colombia: "CO",
  "Cape Verde Islands": "CV",
  "Congo DR": "CD",
  "Curaçao": "CW",
  "Czech Republic": "CZ",
  Egypt: "EG",
  Haiti: "HT",
  "South Korea": "KR",
  Korea: "KR",
  Australia: "AU",
  Iran: "IR",
  Iraq: "IQ",
  "Ivory Coast": "CI",
  Jordan: "JO",
  "New Zealand": "NZ",
  Norway: "NO",
  Panama: "PA",
  Paraguay: "PY",
  Senegal: "SN",
  "Saudi Arabia": "SA",
  Qatar: "QA",
  Ghana: "GH",
  Tunisia: "TN",
  "South Africa": "ZA",
  Serbia: "RS",
  Ecuador: "EC",
  Sweden: "SE",
  "Türkiye": "TR",
  Uzbekistan: "UZ",
  Cameroon: "CM",
  Wales: "GB",
  Scotland: "GB",
};

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function flagFor(teamName) {
  return TEAM_FLAGS[teamName] || "";
}

function withTeamFlags(match) {
  return {
    ...match,
    home: { ...match.home, flag: match.home.flag || flagFor(match.home.team) },
    away: { ...match.away, flag: match.away.flag || flagFor(match.away.team) },
  };
}

function createKnockoutPlaceholders(existingCount) {
  const placeholders = [];
  let slotNumber = 1;
  KNOCKOUT_SLOTS.forEach(([round, dateKey, count]) => {
    for (let index = 1; index <= count; index += 1) {
      placeholders.push({
        id: `wc2026-ko-${String(slotNumber).padStart(2, "0")}`,
        sourceFixtureId: null,
        stage: `World Cup · ${round}`,
        dateKey,
        kickoff: null,
        home: { team: "待定", flag: "🏆" },
        away: { team: "待定", flag: "🏆" },
        odds: {
          result: { home: null, draw: null, away: null },
          scores: {},
        },
        sealedAt: null,
        actual: null,
        predictions: [],
        placeholder: true,
        dataSource: "fifa-schedule-placeholder",
        syncedAt: new Date().toISOString(),
      });
      slotNumber += 1;
    }
  });
  return placeholders.slice(0, Math.max(0, TARGET_MATCH_COUNT - existingCount));
}

async function fetchWorldCupFixtures(config) {
  const payload = await fetchApi("/fixtures", {
    league: WORLD_CUP_LEAGUE_ID,
    season: WORLD_CUP_SEASON,
  }, config);
  return (Array.isArray(payload.response) ? payload.response : [])
    .map(normalizeFixture)
    .map(withTeamFlags)
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
}

async function hydrateOddsSafely(match, config) {
  try {
    return await hydrateOddsForMatch(match, config);
  } catch (err) {
    console.warn(`[sync] odds unavailable for ${match.id}: ${err.message}`);
    return match;
  }
}

async function syncRealData() {
  loadEnv();
  const config = getConfig();
  if (!config.oddsApiKey) {
    throw new Error("缺少 API-SPORTS key。请配置 ODDS_API_KEY/APISPORTS_API_KEY 或保留 football config。");
  }

  const fixtures = await fetchWorldCupFixtures(config);
  if (!fixtures.length) {
    throw new Error("API 未返回 2026 World Cup fixtures。");
  }

  const limit = Number(process.env.SYNC_ODDS_LIMIT || 16);
  const matches = [];
  for (const fixture of fixtures) {
    const needOdds = matches.length < limit;
    const match = needOdds ? await hydrateOddsSafely(fixture, config) : fixture;
    matches.push({
      ...match,
      predictions: [],
      dataSource: "api-sports",
      syncedAt: new Date().toISOString(),
    });
  }

  const allMatches = matches.length >= TARGET_MATCH_COUNT
    ? matches
    : [...matches, ...createKnockoutPlaceholders(matches.length)];

  writeJson(MATCHES_OUT, {
    source: {
      provider: "API-SPORTS",
      league: WORLD_CUP_LEAGUE_ID,
      season: WORLD_CUP_SEASON,
      apiFixtures: matches.length,
      totalMatches: allMatches.length,
      placeholders: allMatches.filter((match) => match.placeholder).length,
      syncedAt: new Date().toISOString(),
    },
    matches: allMatches,
  });

  writeJson(CHAMPIONS_OUT, {
    updatedAt: new Date().toISOString(),
    predictions: [],
    note: "等待真实模型冠军预测封盘后更新。",
  });

  console.log(`[sync] wrote ${allMatches.length} fixtures to ${MATCHES_OUT} (${matches.length} API + ${allMatches.length - matches.length} placeholders)`);
  console.log(`[sync] cleared simulated champion predictions in ${CHAMPIONS_OUT}`);
}

if (require.main === module) {
  syncRealData().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  syncRealData,
  fetchWorldCupFixtures,
};
