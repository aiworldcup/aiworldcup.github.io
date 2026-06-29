const fs = require("fs");
const path = require("path");

const DEFAULT_MATCHES = path.join(__dirname, "..", "public", "data", "matches.json");
const DEFAULT_GROUPS = path.join(__dirname, "..", "public", "data", "groups.json");

const BRACKET_SOURCE_HREF = "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage";
const SCHEDULE_SOURCE_HREF = "https://www.sbnation.com/soccer/1120771/world-cup-schedule-scores-round-32";

const ROUND_OF_32_SPECS = [
  {
    id: "wc2026-ko-01",
    fifaMatchNumber: 73,
    kickoff: "2026-06-28T19:00:00+00:00",
    home: { rank: "runnerUp", group: "A" },
    away: { rank: "runnerUp", group: "B" },
    actual: { result: "away", score: "0-1" },
  },
  {
    id: "wc2026-ko-02",
    fifaMatchNumber: 76,
    kickoff: "2026-06-29T17:00:00+00:00",
    home: { rank: "winner", group: "C" },
    away: { rank: "runnerUp", group: "F" },
  },
  {
    id: "wc2026-ko-03",
    fifaMatchNumber: 74,
    kickoff: "2026-06-29T20:30:00+00:00",
    home: { rank: "winner", group: "E" },
    away: { rank: "third", matchNumber: 74 },
  },
  {
    id: "wc2026-ko-04",
    fifaMatchNumber: 75,
    kickoff: "2026-06-30T01:00:00+00:00",
    home: { rank: "winner", group: "F" },
    away: { rank: "runnerUp", group: "C" },
  },
  {
    id: "wc2026-ko-05",
    fifaMatchNumber: 78,
    kickoff: "2026-06-30T17:00:00+00:00",
    home: { rank: "runnerUp", group: "E" },
    away: { rank: "runnerUp", group: "I" },
  },
  {
    id: "wc2026-ko-06",
    fifaMatchNumber: 77,
    kickoff: "2026-06-30T21:00:00+00:00",
    home: { rank: "winner", group: "I" },
    away: { rank: "third", matchNumber: 77 },
  },
  {
    id: "wc2026-ko-07",
    fifaMatchNumber: 79,
    kickoff: "2026-07-01T01:00:00+00:00",
    home: { rank: "winner", group: "A" },
    away: { rank: "third", matchNumber: 79 },
  },
  {
    id: "wc2026-ko-08",
    fifaMatchNumber: 80,
    kickoff: "2026-07-01T16:00:00+00:00",
    home: { rank: "winner", group: "L" },
    away: { rank: "third", matchNumber: 80 },
  },
  {
    id: "wc2026-ko-09",
    fifaMatchNumber: 82,
    kickoff: "2026-07-01T20:00:00+00:00",
    home: { rank: "winner", group: "G" },
    away: { rank: "third", matchNumber: 82 },
  },
  {
    id: "wc2026-ko-10",
    fifaMatchNumber: 81,
    kickoff: "2026-07-02T00:00:00+00:00",
    home: { rank: "winner", group: "D" },
    away: { rank: "third", matchNumber: 81 },
  },
  {
    id: "wc2026-ko-11",
    fifaMatchNumber: 84,
    kickoff: "2026-07-02T19:00:00+00:00",
    home: { rank: "winner", group: "H" },
    away: { rank: "runnerUp", group: "J" },
  },
  {
    id: "wc2026-ko-12",
    fifaMatchNumber: 83,
    kickoff: "2026-07-02T23:00:00+00:00",
    home: { rank: "runnerUp", group: "K" },
    away: { rank: "runnerUp", group: "L" },
  },
  {
    id: "wc2026-ko-13",
    fifaMatchNumber: 85,
    kickoff: "2026-07-03T03:00:00+00:00",
    home: { rank: "winner", group: "B" },
    away: { rank: "third", matchNumber: 85 },
  },
  {
    id: "wc2026-ko-14",
    fifaMatchNumber: 88,
    kickoff: "2026-07-03T18:00:00+00:00",
    home: { rank: "runnerUp", group: "D" },
    away: { rank: "runnerUp", group: "G" },
  },
  {
    id: "wc2026-ko-15",
    fifaMatchNumber: 86,
    kickoff: "2026-07-03T22:00:00+00:00",
    home: { rank: "winner", group: "J" },
    away: { rank: "runnerUp", group: "H" },
  },
  {
    id: "wc2026-ko-16",
    fifaMatchNumber: 87,
    kickoff: "2026-07-04T01:30:00+00:00",
    home: { rank: "winner", group: "K" },
    away: { rank: "third", matchNumber: 87 },
  },
];

const THIRD_PLACE_ASSIGNMENTS = {
  "B,D,E,F,I,J,K,L": {
    74: "D",
    77: "F",
    79: "E",
    80: "K",
    81: "B",
    82: "I",
    85: "J",
    87: "L",
  },
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

function parseScore(score) {
  const match = String(score || "").match(/^(\d+)-(\d+)$/);
  if (!match) return null;
  return { home: Number(match[1]), away: Number(match[2]) };
}

function isGroupMatch(match) {
  return String(match && match.stage || "").includes("Group Stage");
}

function compareStandingRows(a, b) {
  return b.points - a.points ||
    b.gd - a.gd ||
    b.gf - a.gf ||
    a.team.localeCompare(b.team, "zh-CN");
}

function groupRows(matches, teams, group) {
  const rows = (teams || []).map((team) => ({
    group,
    team,
    played: 0,
    win: 0,
    draw: 0,
    loss: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    points: 0,
  }));
  const byTeam = new Map(rows.map((row) => [row.team, row]));
  (matches || [])
    .filter((match) => isGroupMatch(match) && match.actual && teams.includes(match.home.team) && teams.includes(match.away.team))
    .forEach((match) => {
      const score = parseScore(match.actual.score);
      if (!score) return;
      const home = byTeam.get(match.home.team);
      const away = byTeam.get(match.away.team);
      if (!home || !away) return;
      home.played += 1;
      away.played += 1;
      home.gf += score.home;
      home.ga += score.away;
      away.gf += score.away;
      away.ga += score.home;
      if (score.home > score.away) {
        home.win += 1;
        home.points += 3;
        away.loss += 1;
      } else if (score.home < score.away) {
        away.win += 1;
        away.points += 3;
        home.loss += 1;
      } else {
        home.draw += 1;
        away.draw += 1;
        home.points += 1;
        away.points += 1;
      }
    });
  rows.forEach((row) => { row.gd = row.gf - row.ga; });
  return rows.sort(compareStandingRows);
}

function buildGroupStandings(matches, groups) {
  const byGroup = {};
  Object.entries(groups || {}).forEach(([group, teams]) => {
    byGroup[group] = groupRows(matches, teams, group);
  });
  const thirdRows = Object.entries(byGroup)
    .map(([group, rows]) => ({ ...rows[2], group }))
    .filter((row) => row && row.team);
  const bestThirds = thirdRows.sort(compareStandingRows);
  return {
    byGroup,
    bestThirds,
    qualifiedThirdGroups: bestThirds.slice(0, 8).map((row) => row.group),
  };
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

function teamObject(row, metaByName) {
  if (!row || !row.team) return null;
  const meta = metaByName.get(row.team) || { team: row.team, flag: "" };
  const output = {
    team: row.team,
    flag: meta.flag || "",
  };
  if (meta.teamEn) output.teamEn = meta.teamEn;
  return output;
}

function beijingDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function thirdAssignmentFor(standings) {
  const key = standings.qualifiedThirdGroups.slice().sort().join(",");
  return THIRD_PLACE_ASSIGNMENTS[key] || {};
}

function rowForSlot(slot, standings, thirdAssignment) {
  if (slot.rank === "winner") return (standings.byGroup[slot.group] || [])[0] || null;
  if (slot.rank === "runnerUp") return (standings.byGroup[slot.group] || [])[1] || null;
  if (slot.rank === "third") {
    const group = thirdAssignment[slot.matchNumber];
    return group ? (standings.byGroup[group] || [])[2] || null : null;
  }
  return null;
}

function knownActualSource(generatedAt) {
  return {
    provider: "manual-verified",
    sourceLabel: "Round of 32 scoreboard",
    sourceHref: SCHEDULE_SOURCE_HREF,
    syncedAt: generatedAt,
  };
}

function resolveMatch(existing, spec, standings, thirdAssignment, metaByName, generatedAt) {
  const homeRow = rowForSlot(spec.home, standings, thirdAssignment);
  const awayRow = rowForSlot(spec.away, standings, thirdAssignment);
  const home = teamObject(homeRow, metaByName);
  const away = teamObject(awayRow, metaByName);
  if (!home || !away) return existing;

  const next = {
    ...existing,
    stage: "World Cup · Round of 32",
    dateKey: beijingDateKey(spec.kickoff),
    kickoff: spec.kickoff,
    home,
    away,
    placeholder: false,
    fifaMatchNumber: spec.fifaMatchNumber,
    bracketSlot: {
      home: spec.home.rank === "third" ? `3${thirdAssignment[spec.home.matchNumber] || ""}` : `${spec.home.rank === "winner" ? "1" : "2"}${spec.home.group}`,
      away: spec.away.rank === "third" ? `3${thirdAssignment[spec.away.matchNumber] || ""}` : `${spec.away.rank === "winner" ? "1" : "2"}${spec.away.group}`,
    },
    dataSource: "fifa-knockout-derived",
    syncedAt: generatedAt,
    knockoutSource: {
      bracketHref: BRACKET_SOURCE_HREF,
      scheduleHref: SCHEDULE_SOURCE_HREF,
      generatedAt,
    },
  };

  if (!existing.actual && spec.actual) {
    next.actual = spec.actual;
    next.actualSource = existing.actualSource || knownActualSource(generatedAt);
  }

  return next;
}

function resolveKnockoutMatches(matches, groups, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const standings = buildGroupStandings(matches, groups);
  const thirdAssignment = thirdAssignmentFor(standings);
  const metaByName = teamMetaByName(matches);
  const specsById = new Map(ROUND_OF_32_SPECS.map((spec) => [spec.id, spec]));

  return (matches || []).map((match) => {
    const spec = specsById.get(match.id);
    if (!spec) return match;
    return resolveMatch(match, spec, standings, thirdAssignment, metaByName, generatedAt);
  });
}

function resolveKnockoutData(data, groups, options = {}) {
  const matches = resolveKnockoutMatches(data.matches || [], groups, options);
  return {
    ...data,
    source: {
      ...(data.source || {}),
      placeholders: matches.filter((match) => match.placeholder).length,
      knockoutSyncedAt: options.generatedAt || new Date().toISOString(),
    },
    matches,
  };
}

function main() {
  const matchesPath = path.resolve(argValue("matches", DEFAULT_MATCHES));
  const groupsPath = path.resolve(argValue("groups", DEFAULT_GROUPS));
  const outputPath = path.resolve(argValue("output", matchesPath));
  const dryRun = hasFlag("dry-run");
  const data = readJson(matchesPath, { matches: [] });
  const groups = readJson(groupsPath, { groups: {} }).groups || {};
  const generatedAt = new Date().toISOString();
  const output = resolveKnockoutData(data, groups, { generatedAt });
  const resolved = output.matches.filter((match) => match.dataSource === "fifa-knockout-derived").length;
  const summary = { matches: output.matches.length, resolved, placeholders: output.source.placeholders };

  if (dryRun) {
    console.log(JSON.stringify({ ok: true, dryRun: true, summary }, null, 2));
    return output;
  }
  writeJson(outputPath, output);
  console.log(`[knockout] wrote ${outputPath} resolved=${resolved} placeholders=${output.source.placeholders}`);
  return output;
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
  ROUND_OF_32_SPECS,
  buildGroupStandings,
  resolveKnockoutMatches,
  resolveKnockoutData,
};
