const fs = require("fs");
const path = require("path");
const { buildGroupStandings } = require("./knockout");

const DEFAULT_MATCHES = path.join(__dirname, "..", "public", "data", "matches.json");
const DEFAULT_GROUPS = path.join(__dirname, "..", "public", "data", "groups.json");
const DEFAULT_OUTPUT = path.join(__dirname, "..", "public", "data", "champion-predictions.json");

const TEAM_POWER = {
  法国: 96,
  巴西: 95,
  阿根廷: 94,
  西班牙: 92,
  英格兰: 90,
  德国: 89,
  葡萄牙: 88,
  荷兰: 87,
  比利时: 84,
  哥伦比亚: 82,
  克罗地亚: 82,
  摩洛哥: 81,
  乌拉圭: 80,
  瑞士: 78,
  美国: 77,
  墨西哥: 77,
  日本: 76,
  塞内加尔: 75,
  奥地利: 74,
  埃及: 73,
  土耳其: 73,
  澳大利亚: 72,
  挪威: 72,
  韩国: 71,
  科特迪瓦: 71,
  加拿大: 70,
  瑞典: 70,
  巴拉圭: 69,
  苏格兰: 68,
  加纳: 68,
  厄瓜多尔: 68,
  波黑: 67,
  阿尔及利亚: 67,
  捷克: 66,
  卡塔尔: 65,
  乌兹别克斯坦: 64,
  民主刚果: 64,
  伊朗: 64,
  南非: 63,
  突尼斯: 63,
  沙特阿拉伯: 62,
  库拉索: 60,
  巴拿马: 59,
  佛得角: 59,
  新西兰: 58,
  伊拉克: 58,
  海地: 56,
  约旦: 55,
};

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function rounded(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function isGroupMatch(match) {
  return String(match && match.stage || "").includes("Group Stage");
}

function isKnockoutMatch(match) {
  return match && !isGroupMatch(match) && String(match.stage || "").includes("World Cup");
}

function winningSide(match) {
  const candidates = [
    match && match.advanceResult,
    match && match.finalActual && match.finalActual.result,
    match && match.actual && match.actual.result,
  ];
  return candidates.find((result) => result === "home" || result === "away") || "";
}

function winnerName(match) {
  const result = winningSide(match);
  if (result === "home") return match.home && match.home.team;
  if (result === "away") return match.away && match.away.team;
  return "";
}

function loserName(match) {
  const winner = winnerName(match);
  if (!winner) return "";
  if (winner === (match.home && match.home.team)) return match.away && match.away.team;
  if (winner === (match.away && match.away.team)) return match.home && match.home.team;
  return "";
}

function stageShortName(stage) {
  if (String(stage).includes("Round of 32")) return "32 强";
  if (String(stage).includes("Round of 16")) return "16 强";
  if (String(stage).includes("Quarter")) return "8 强";
  if (String(stage).includes("Semi")) return "半决赛";
  if (String(stage).includes("Final")) return "决赛";
  return String(stage || "").replace("World Cup · ", "");
}

function teamMetaByName(matches) {
  const meta = new Map();
  (matches || []).forEach((match) => {
    [match.home, match.away].forEach((team) => {
      if (!team || !team.team || team.team === "待定") return;
      meta.set(team.team, {
        team: team.team,
        flag: team.flag || "",
        teamEn: team.teamEn || undefined,
      });
    });
  });
  return meta;
}

function qualifiedRows(standings) {
  const rows = new Map();
  Object.entries(standings.byGroup || {}).forEach(([group, groupRows]) => {
    groupRows.slice(0, 2).forEach((row, index) => {
      rows.set(row.team, { ...row, group, groupRank: index + 1, qualification: index === 0 ? "小组第一" : "小组第二" });
    });
  });
  (standings.bestThirds || []).slice(0, 8).forEach((row) => {
    if (!rows.has(row.team)) {
      rows.set(row.team, { ...row, group: row.group, groupRank: 3, qualification: "成绩较好小组第三" });
    }
  });
  return Array.from(rows.values());
}

function eliminatedTeams(matches) {
  const teams = new Set();
  (matches || [])
    .filter((match) => isKnockoutMatch(match) && match.actual)
    .forEach((match) => {
      const loser = loserName(match);
      if (loser) teams.add(loser);
    });
  return teams;
}

function nextMatchFor(team, matches) {
  return (matches || [])
    .filter((match) => isKnockoutMatch(match) && !match.placeholder && !match.actual)
    .filter((match) => match.home && match.away && (match.home.team === team || match.away.team === team))
    .sort((a, b) => new Date(a.kickoff || 0) - new Date(b.kickoff || 0))[0] || null;
}

function strengthForTeam(team) {
  return TEAM_POWER[team] || 62;
}

function formScore(row) {
  return rounded(clamp(
    18 +
    row.points * 7 +
    row.win * 3 +
    row.gd * 2 +
    row.gf * 0.9 -
    row.ga * 1.2 +
    (row.groupRank === 1 ? 6 : row.groupRank === 2 ? 1 : -5),
    35,
    99,
  ));
}

function strengthScore(row, form) {
  const base = strengthForTeam(row.team);
  return rounded(clamp(base * 0.86 + form * 0.14 + (row.groupRank === 1 ? 2 : 0), 40, 99));
}

function impliedChance(match, team) {
  const odds = match && match.odds && match.odds.result;
  if (!odds) return null;
  const homeOdd = Number(odds.home);
  const drawOdd = Number(odds.draw);
  const awayOdd = Number(odds.away);
  if (![homeOdd, drawOdd, awayOdd].every((odd) => Number.isFinite(odd) && odd > 1)) return null;
  const home = 1 / homeOdd;
  const draw = 1 / drawOdd;
  const away = 1 / awayOdd;
  const total = home + draw + away;
  if (!Number.isFinite(total) || total <= 0) return null;
  const side = team === match.home.team ? home : away;
  return (side / total) + (draw / total) * 0.5;
}

function pathScore(row, strength, nextMatch) {
  if (!nextMatch) return rounded(clamp(48 + (row.groupRank === 1 ? 8 : 0) + Math.max(0, row.points - 4), 42, 68));
  const chance = impliedChance(nextMatch, row.team);
  if (chance !== null) return rounded(clamp(35 + chance * 70, 35, 96));
  const opponent = nextMatch.home.team === row.team ? nextMatch.away.team : nextMatch.home.team;
  const opponentStrength = strengthForTeam(opponent);
  return rounded(clamp(63 + (strength - opponentStrength) * 0.28 + (row.groupRank === 1 ? 6 : row.groupRank === 2 ? 1 : -3), 35, 92));
}

function funScore(row, strength, path, nextMatch) {
  let score = 54;
  if (row.gf >= 8) score += 12;
  if (row.ga <= 1) score += 10;
  if (row.groupRank === 3) score += 12;
  if (strength < 74 && path >= 58) score += 12;
  if (nextMatch) {
    const opponent = nextMatch.home.team === row.team ? nextMatch.away.team : nextMatch.home.team;
    if (Math.abs(strength - strengthForTeam(opponent)) <= 6) score += 8;
  }
  return rounded(clamp(score, 35, 95));
}

function buildTags(row, scores, nextMatch) {
  const tags = [];
  const base = strengthForTeam(row.team);
  if (scores.total >= 90) tags.push("冠军相");
  if (row.points === 9) tags.push("小组赛满血");
  if (row.loss === 0) tags.push("不败金身");
  if (row.gf >= 9) tags.push("火力压迫");
  else if (row.gf >= 7) tags.push("进攻在线");
  if (row.ga <= 1) tags.push("低失球护城河");
  else if (row.ga <= 2) tags.push("防线可控");
  const chance = nextMatch ? impliedChance(nextMatch, row.team) : null;
  if (chance !== null && chance >= 0.65) tags.push("盘口顺风");
  if (chance !== null && chance <= 0.35) tags.push("冷门按钮");
  if (scores.path >= 78) tags.push("签运舒适");
  if (base >= 88) tags.push("强队牌面");
  if (row.groupRank === 3) tags.push("逆袭门票");
  if (base < 74 && scores.total >= 62) tags.push("黑马剧本");
  if (scores.total >= 84) tags.push("毒奶预警");
  if (nextMatch) {
    const opponent = nextMatch.home.team === row.team ? nextMatch.away.team : nextMatch.home.team;
    if (strengthForTeam(opponent) >= 84) tags.push("硬仗开门");
  }
  return tags.slice(0, 6);
}

function buildBadges(row, scores, tags) {
  const preferred = [];
  if (scores.total >= 90) preferred.push("冠军相");
  if (row.gf >= 9) preferred.push("火力压迫");
  if (row.ga <= 1) preferred.push("低失球护城河");
  const chance = tags.includes("盘口顺风") ? "盘口顺风" : tags.includes("冷门按钮") ? "冷门按钮" : "";
  if (chance) preferred.push(chance);
  if (scores.path >= 85) preferred.push("签运舒适");
  if (row.points === 9) preferred.push("满血通关");
  if (row.groupRank === 3) preferred.push("逆袭门票");
  if (scores.total >= 84) preferred.push("毒奶预警");
  if (strengthForTeam(row.team) < 74 && scores.total >= 62) preferred.push("黑马剧本");

  const badges = [];
  [...preferred, ...tags].forEach((tag) => {
    if (tag && !badges.includes(tag)) badges.push(tag);
  });
  return badges.slice(0, 3);
}

function scriptFor(row, scores, nextMatch) {
  if (row.points === 9 && row.gf >= 10) return "小组赛像开了高压水枪,淘汰赛先看火力能不能续杯。";
  if (row.points === 9 && row.ga <= 1) return "攻守都没露大破绽,现在最大的对手可能是被提前封神。";
  if (row.points === 9) return "三连通关很硬,但淘汰赛不发奖杯,只能发下一张考卷。";
  if (row.gf >= 8 && row.ga >= 6) return "进球很上头,丢球也刺激,这队像把过山车开进淘汰赛。";
  if (row.gf >= 8) return "进攻端火力很响,只要后防别开盲盒就有戏。";
  if (row.ga <= 1) return "防线先把地基打稳了,剧本不花,但特别适合熬死人。";
  if (row.groupRank === 3) return "从边门挤进来,节目效果已经拉满,再赢一场就变连续剧。";
  if (nextMatch && scores.path < 55) return "签运不太讲理,想走远得先把第一块硬骨头啃碎。";
  if (scores.strength >= 86) return "牌面够硬,现在拼的是淘汰赛别犯低级错。";
  return "没有大热包袱,反而适合偷偷往前拱。";
}

function reasonFor(row, scores, nextMatch) {
  const opponent = nextMatch
    ? `,下一场对${nextMatch.home.team === row.team ? nextMatch.away.team : nextMatch.home.team}`
    : ",等待下轮对阵落位";
  return `${row.qualification}${row.points}分,净胜${signed(row.gd)},硬实力${scores.strength},路径${scores.path}${opponent}`;
}

function nextMatchData(row, nextMatch) {
  if (!nextMatch) {
    return {
      status: "waiting",
      label: "等待下轮落位",
    };
  }
  const isHome = nextMatch.home.team === row.team;
  const opponent = isHome ? nextMatch.away : nextMatch.home;
  const chance = impliedChance(nextMatch, row.team);
  return {
    status: "scheduled",
    matchId: nextMatch.id,
    stage: nextMatch.stage,
    stageShort: stageShortName(nextMatch.stage),
    dateKey: nextMatch.dateKey || "",
    kickoff: nextMatch.kickoff || "",
    opponent: opponent.team,
    opponentFlag: opponent.flag || "",
    side: isHome ? "home" : "away",
    winChance: chance === null ? null : rounded(chance * 100, 1),
  };
}

function highlight(item, label, hook) {
  return {
    label,
    team: item.team,
    flag: item.flag,
    score: item.scores.total,
    hook,
  };
}

function buildHighlights(teams) {
  const favorite = teams[0] || {};
  const darkHorse = teams
    .filter((item) => strengthForTeam(item.team) < 76)
    .sort((a, b) => b.scores.total - a.scores.total || b.scores.fun - a.scores.fun)[0] || teams[teams.length - 1] || {};
  const jinxRisk = teams
    .filter((item) => item.scores.total >= 78)
    .sort((a, b) => (b.scores.form + b.scores.strength) - (a.scores.form + a.scores.strength))[0] || favorite;
  return {
    favorite: highlight(favorite, "最大热门", "数据最硬,但热度也最容易挨毒奶。"),
    darkHorse: highlight(darkHorse, "黑马剧本", "不是最大牌,但路径和状态给了它偷剧本的空间。"),
    jinxRisk: highlight(jinxRisk, "毒奶高危", "越像冠军相,越要小心淘汰赛第一脚打滑。"),
  };
}

function prune(value) {
  if (Array.isArray(value)) {
    return value.map((item) => prune(item)).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const next = {};
    Object.entries(value).forEach(([key, item]) => {
      const pruned = prune(item);
      if (pruned !== undefined) next[key] = pruned;
    });
    return next;
  }
  if (value === undefined) return undefined;
  return value;
}

function buildChampionData({ matches, groups, generatedAt = new Date().toISOString(), predictions = [] }) {
  const standings = buildGroupStandings(matches || [], groups || {});
  const eliminated = eliminatedTeams(matches || []);
  const metaByName = teamMetaByName(matches || []);
  const teams = qualifiedRows(standings)
    .filter((row) => !eliminated.has(row.team))
    .map((row) => {
      const meta = metaByName.get(row.team) || { team: row.team, flag: "" };
      const nextMatch = nextMatchFor(row.team, matches || []);
      const form = formScore(row);
      const strength = strengthScore(row, form);
      const path = pathScore(row, strength, nextMatch);
      const fun = funScore(row, strength, path, nextMatch);
      const total = rounded(clamp(form * 0.3 + strength * 0.36 + path * 0.24 + fun * 0.1), 1);
      const scores = { total, form, strength, path, fun };
      const tags = buildTags(row, scores, nextMatch);
      const badges = buildBadges(row, scores, tags);
      return prune({
        team: row.team,
        flag: meta.flag || "",
        teamEn: meta.teamEn,
        rank: 0,
        status: "alive",
        qualification: row.qualification,
        group: {
          name: row.group,
          rank: row.groupRank,
          points: row.points,
          record: `${row.win}-${row.draw}-${row.loss}`,
          gf: row.gf,
          ga: row.ga,
          gd: row.gd,
        },
        scores,
        tags,
        badges,
        reason: reasonFor(row, scores, nextMatch),
        script: scriptFor(row, scores, nextMatch),
        nextMatch: nextMatchData(row, nextMatch),
      });
    })
    .sort((a, b) => b.scores.total - a.scores.total || b.scores.strength - a.scores.strength || a.team.localeCompare(b.team, "zh-CN"))
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    updatedAt: generatedAt,
    mode: "derived",
    note: "冠军雷达由小组赛果、淘汰赛存活状态、下一场赔率/对手强度和项目内强队基准派生;模型冠军封盘后会继续展示逐模型选择。",
    source: {
      matches: (matches || []).length,
      qualifiedTeams: qualifiedRows(standings).length,
      aliveTeams: teams.length,
      settledKnockout: (matches || []).filter((match) => isKnockoutMatch(match) && match.actual).length,
    },
    highlights: buildHighlights(teams),
    teams,
    predictions,
  };
}

function main() {
  const matchesPath = path.resolve(argValue("matches", DEFAULT_MATCHES));
  const groupsPath = path.resolve(argValue("groups", DEFAULT_GROUPS));
  const outputPath = path.resolve(argValue("output", DEFAULT_OUTPUT));
  const dryRun = hasFlag("dry-run");
  const matches = readJson(matchesPath, { matches: [] }).matches || [];
  const groups = readJson(groupsPath, { groups: {} }).groups || {};
  const existing = readJson(outputPath, { predictions: [] }) || { predictions: [] };
  const data = buildChampionData({
    matches,
    groups,
    generatedAt: new Date().toISOString(),
    predictions: existing.predictions || [],
  });
  if (existing.gauntlet) data.gauntlet = existing.gauntlet;
  if (dryRun) {
    console.log(JSON.stringify({ ok: true, teams: data.teams.length, top: data.teams.slice(0, 5).map((item) => item.team) }, null, 2));
    return data;
  }
  writeJson(outputPath, data);
  console.log(`[champion] wrote ${outputPath} teams=${data.teams.length}`);
  return data;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.stack || err.message);
    process.exit(1);
  }
}

module.exports = {
  TEAM_POWER,
  buildChampionData,
};
