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

const TEAM_NAME_ZH = {
  Algeria: "阿尔及利亚",
  Argentina: "阿根廷",
  Australia: "澳大利亚",
  Austria: "奥地利",
  Belgium: "比利时",
  "Bosnia & Herzegovina": "波黑",
  Brazil: "巴西",
  Canada: "加拿大",
  "Cape Verde Islands": "佛得角",
  Colombia: "哥伦比亚",
  "Congo DR": "民主刚果",
  Croatia: "克罗地亚",
  "Curaçao": "库拉索",
  "Czech Republic": "捷克",
  Ecuador: "厄瓜多尔",
  Egypt: "埃及",
  England: "英格兰",
  France: "法国",
  Germany: "德国",
  Ghana: "加纳",
  Haiti: "海地",
  Iran: "伊朗",
  Iraq: "伊拉克",
  "Ivory Coast": "科特迪瓦",
  Japan: "日本",
  Jordan: "约旦",
  Mexico: "墨西哥",
  Morocco: "摩洛哥",
  Netherlands: "荷兰",
  "New Zealand": "新西兰",
  Norway: "挪威",
  Panama: "巴拿马",
  Paraguay: "巴拉圭",
  Portugal: "葡萄牙",
  Qatar: "卡塔尔",
  "Saudi Arabia": "沙特阿拉伯",
  Scotland: "苏格兰",
  Senegal: "塞内加尔",
  "South Africa": "南非",
  "South Korea": "韩国",
  Spain: "西班牙",
  Sweden: "瑞典",
  Switzerland: "瑞士",
  Tunisia: "突尼斯",
  "Türkiye": "土耳其",
  USA: "美国",
  Uruguay: "乌拉圭",
  Uzbekistan: "乌兹别克斯坦",
  "待定": "待定",
};

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function flagFor(teamName) {
  return TEAM_FLAGS[teamName] || "";
}

function nameZhFor(teamName) {
  return TEAM_NAME_ZH[teamName] || teamName || "待定";
}

function withTeamFlags(match) {
  return {
    ...match,
    home: {
      ...match.home,
      teamEn: match.home.team,
      team: nameZhFor(match.home.team),
      flag: match.home.flag || flagFor(match.home.team),
    },
    away: {
      ...match.away,
      teamEn: match.away.team,
      team: nameZhFor(match.away.team),
      flag: match.away.flag || flagFor(match.away.team),
    },
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
