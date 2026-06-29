const fs = require("fs");
const path = require("path");
const { getConfig } = require("./config");
const { loadProjectEnv } = require("./lib/env");
const { fetchApi, hydrateOddsForMatch, isDisallowedOddsProvider, normalizeFixture } = require("./odds");
const { resolveKnockoutData } = require("./knockout");
const { buildChampionData } = require("./champion");

const MATCHES_OUT = path.join(__dirname, "..", "public", "data", "matches.json");
const CHAMPIONS_OUT = path.join(__dirname, "..", "public", "data", "champion-predictions.json");
const GROUPS_PATH = path.join(__dirname, "..", "public", "data", "groups.json");
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
  Czechia: "CZ",
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
  Czechia: "捷克",
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

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["syncedAt", "preservedAt", "updatedAt"].includes(key))
      .map(([key, item]) => [key, comparable(item)])
  );
}

function writeJsonIfChanged(filePath, data) {
  if (fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (JSON.stringify(comparable(existing)) === JSON.stringify(comparable(data))) {
        return false;
      }
    } catch (_) {
      // Fall through and rewrite invalid JSON.
    }
  }
  writeJson(filePath, data);
  return true;
}

function readExistingMatches() {
  try {
    if (!fs.existsSync(MATCHES_OUT)) return new Map();
    const data = JSON.parse(fs.readFileSync(MATCHES_OUT, "utf8"));
    return new Map((data.matches || []).map((match) => [match.id, match]));
  } catch (err) {
    console.warn(`[sync] existing matches ignored: ${err.message}`);
    return new Map();
  }
}

function readExistingChampionPredictions() {
  try {
    if (!fs.existsSync(CHAMPIONS_OUT)) return [];
    const data = JSON.parse(fs.readFileSync(CHAMPIONS_OUT, "utf8"));
    return data.predictions || [];
  } catch (err) {
    console.warn(`[sync] existing champion predictions ignored: ${err.message}`);
    return [];
  }
}

function readGroups() {
  try {
    if (!fs.existsSync(GROUPS_PATH)) return {};
    return JSON.parse(fs.readFileSync(GROUPS_PATH, "utf8")).groups || {};
  } catch (err) {
    console.warn(`[sync] groups ignored: ${err.message}`);
    return {};
  }
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

function mergeExistingMatch(fresh, existing) {
  if (!existing) return fresh;
  const existingOdds = isDisallowedOddsProvider(existing.odds && existing.odds.provider)
    ? { result: {}, scores: {} }
    : (existing.odds || {});
  const freshOdds = fresh.odds || {};
  const mergeNonNull = (existingValues = {}, freshValues = {}) => {
    const merged = { ...existingValues };
    Object.entries(freshValues).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") merged[key] = value;
    });
    return merged;
  };
  const merged = {
    ...fresh,
    sealedAt: existing.sealedAt || fresh.sealedAt || null,
    predictions: Array.isArray(existing.predictions) ? existing.predictions : fresh.predictions || [],
    odds: {
      result: mergeNonNull(
        existingOdds.result || {},
        freshOdds.result || {},
      ),
      scores: mergeNonNull(
        existingOdds.scores || {},
        freshOdds.scores || {},
      ),
      provider: freshOdds.provider || existingOdds.provider || null,
      source: freshOdds.source || existingOdds.source || null,
      sourceEventId: freshOdds.sourceEventId || existingOdds.sourceEventId || null,
      sourceMatchId: freshOdds.sourceMatchId || existingOdds.sourceMatchId || null,
      sourceMatchNum: freshOdds.sourceMatchNum || existingOdds.sourceMatchNum || null,
      sourceHref: freshOdds.sourceHref || existingOdds.sourceHref || null,
      sourceLabel: freshOdds.sourceLabel || existingOdds.sourceLabel || null,
      syncedAt: freshOdds.syncedAt || existingOdds.syncedAt || null,
    },
    actual: existing.actual || fresh.actual || null,
    preservedAt: existing.preservedAt || fresh.syncedAt || new Date().toISOString(),
  };
  if (existing.actualSource || fresh.actualSource) {
    merged.actualSource = existing.actualSource || fresh.actualSource;
  }
  return merged;
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
  loadProjectEnv();
  const config = getConfig();
  const syncedAt = new Date().toISOString();
  if (!config.oddsApiKey) {
    throw new Error("缺少 API-SPORTS key。请配置 ODDS_API_KEY/APISPORTS_API_KEY 或保留 football config。");
  }

  const fixtures = await fetchWorldCupFixtures(config);
  if (!fixtures.length) {
    throw new Error("API 未返回 2026 World Cup fixtures。");
  }

  const existingById = readExistingMatches();
  const limit = Number(process.env.SYNC_ODDS_LIMIT || 32);
  const matches = [];
  for (const fixture of fixtures) {
    const needOdds = matches.length < limit;
    const match = needOdds ? await hydrateOddsSafely(fixture, config) : fixture;
    const fresh = {
      ...match,
      actual: null,
      predictions: [],
      dataSource: "api-sports",
      syncedAt,
    };
    matches.push(mergeExistingMatch(fresh, existingById.get(fresh.id)));
  }

  const rawMatches = matches.length >= TARGET_MATCH_COUNT
    ? matches
    : [
      ...matches,
      ...createKnockoutPlaceholders(matches.length).map((match) => mergeExistingMatch(match, existingById.get(match.id))),
    ];
  const outputData = resolveKnockoutData({
    source: {
      provider: "API-SPORTS",
      league: WORLD_CUP_LEAGUE_ID,
      season: WORLD_CUP_SEASON,
      apiFixtures: matches.length,
      totalMatches: rawMatches.length,
      placeholders: rawMatches.filter((match) => match.placeholder).length,
      syncedAt,
    },
    matches: rawMatches,
  }, readGroups(), { generatedAt: syncedAt });

  const matchesChanged = writeJsonIfChanged(MATCHES_OUT, outputData);

  const championsChanged = writeJsonIfChanged(CHAMPIONS_OUT, buildChampionData({
    matches: outputData.matches,
    groups: readGroups(),
    generatedAt: syncedAt,
    predictions: readExistingChampionPredictions(),
  }));

  console.log(`[sync] ${matchesChanged ? "wrote" : "unchanged"} ${outputData.matches.length} fixtures at ${MATCHES_OUT} (${matches.length} API + ${outputData.source.placeholders} placeholders)`);
  console.log(`[sync] ${championsChanged ? "wrote" : "unchanged"} champion predictions at ${CHAMPIONS_OUT}`);
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
