#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { askModel, enabledModels } = require("./legion");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MATCHES_PATH = path.join(PROJECT_ROOT, "public", "data", "matches.json");
const CHAMPION_PATH = path.join(PROJECT_ROOT, "public", "data", "champion-predictions.json");

const ROUND_ORDER = ["round32", "round16", "quarterfinal", "semifinal", "final"];
const ROUND_LABELS = {
  round32: "32 强毒圈",
  round16: "16 强毒圈",
  quarterfinal: "8 强毒圈",
  semifinal: "半决赛毒圈",
  final: "决赛毒圈",
};
const STAGE_TO_ROUND = {
  "World Cup · Round of 32": "round32",
  "World Cup · Round of 16": "round16",
  "World Cup · Quarter-finals": "quarterfinal",
  "World Cup · Semi-finals": "semifinal",
  "World Cup · Final": "final",
};
const ROUND32_EXCLUDED_OPENER = "wc2026-ko-01";
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 90000;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function roundIndex(roundId) {
  return ROUND_ORDER.indexOf(roundId);
}

function previousRoundId(roundId) {
  const index = roundIndex(roundId);
  if (index <= 0) return null;
  return ROUND_ORDER[index - 1];
}

function roundLabel(roundId) {
  return ROUND_LABELS[roundId] || roundId;
}

function matchRoundId(match) {
  return STAGE_TO_ROUND[match?.stage] || "";
}

function isPlaceholderTeam(team) {
  return !team || /^胜者|^Winner|待定|TBD/i.test(String(team.team || team.name || team));
}

function candidateMatchesForRound(matches, roundId, options = {}) {
  if (!ROUND_ORDER.includes(roundId)) throw new Error(`unknown roundId: ${roundId}`);
  return (matches || [])
    .filter((match) => matchRoundId(match) === roundId)
    .filter((match) => {
      if (roundId === "round32" && match.id === ROUND32_EXCLUDED_OPENER) return false;
      if (isPlaceholderTeam(match.home) || isPlaceholderTeam(match.away)) return false;
      if (options.includeCompleted) return true;
      return !match.actual;
    });
}

function candidateTeamsForRound(matches) {
  return (matches || []).flatMap((match) => [
    {
      team: match.home.team,
      flag: match.home.flag,
      matchId: match.id,
      opponent: match.away.team,
      side: "home",
    },
    {
      team: match.away.team,
      flag: match.away.flag,
      matchId: match.id,
      opponent: match.home.team,
      side: "away",
    },
  ]);
}

function excludedMatchesForRound(matches, roundId) {
  if (roundId !== "round32") return [];
  const opener = (matches || []).find((match) => match.id === ROUND32_EXCLUDED_OPENER);
  if (!opener) return [];
  return [{
    matchId: opener.id,
    home: opener.home?.team || "",
    away: opener.away?.team || "",
    reason: "已完赛, 初始毒圈跳过",
  }];
}

function teamLookup(candidateTeams) {
  return new Map((candidateTeams || []).map((item) => [item.team, item]));
}

function normalizePickName(value) {
  return String(value || "").trim();
}

function validateModelOutput(output, context) {
  const issues = [];
  const rawPicks = Array.isArray(output?.picks) ? output.picks.map(normalizePickName).filter(Boolean) : [];
  const line = String(output?.line || "").trim();
  const expected = Number(context.allowedPicks) || 0;
  const lookup = teamLookup(context.candidateTeams || []);
  const seenTeams = new Set();
  const seenMatches = new Map();
  const picks = [];

  if (rawPicks.length !== expected) {
    issues.push({
      type: "invalid_pick_count",
      message: `需要 ${expected} 个选择, 实际返回 ${rawPicks.length} 个。`,
    });
  }
  if (!line) {
    issues.push({ type: "missing_line", message: "缺少一句中文理由/台词。" });
  }

  for (const team of rawPicks) {
    if (seenTeams.has(team)) {
      issues.push({ type: "duplicate_team", message: `重复选择 ${team}。` });
      continue;
    }
    seenTeams.add(team);
    const candidate = lookup.get(team);
    if (!candidate) {
      issues.push({ type: "unknown_team", message: `${team} 不在本轮候选池。` });
      continue;
    }
    if (seenMatches.has(candidate.matchId)) {
      issues.push({
        type: "same_match_hedge",
        message: `${team} 与 ${seenMatches.get(candidate.matchId)} 来自同一场, 禁止同场对冲。`,
      });
      continue;
    }
    seenMatches.set(candidate.matchId, team);
    picks.push({
      team: candidate.team,
      flag: candidate.flag,
      matchId: candidate.matchId,
      opponent: candidate.opponent,
      side: candidate.side,
    });
  }

  return {
    valid: issues.length === 0,
    picks,
    line,
    issues,
  };
}

function validateSidelineOutput(output) {
  const line = String(output?.line || "").trim();
  const picks = Array.isArray(output?.picks) ? output.picks.filter(Boolean) : [];
  const issues = [];
  if (!line) issues.push({ type: "missing_line", message: "出局模型也必须留一句场边台词。" });
  if (picks.length) issues.push({ type: "eliminated_model_picked", message: "出局模型不能再提交冠军选择。" });
  return { valid: issues.length === 0, line, issues };
}

function latestRound(gauntlet, roundId) {
  return (gauntlet?.rounds || []).find((round) => round.roundId === roundId);
}

function modelStateForRound(gauntlet, roundId, modelId) {
  if (roundId === "round32") {
    return { status: "alive", allowedPicks: 3, previousAlivePicks: [] };
  }
  const previous = latestRound(gauntlet, previousRoundId(roundId));
  const previousEntry = previous?.entries?.find((entry) => entry.modelId === modelId);
  const previousAlivePicks = Array.isArray(previousEntry?.alivePicks) ? previousEntry.alivePicks : [];
  if (!previous || previous.status !== "settled") {
    return { status: "blocked", allowedPicks: 0, previousAlivePicks: [] };
  }
  if (!previousEntry || previousEntry.status === "eliminated" || previousAlivePicks.length === 0) {
    return { status: "eliminated", allowedPicks: 0, previousAlivePicks: [] };
  }
  return { status: "alive", allowedPicks: previousAlivePicks.length, previousAlivePicks };
}

function championFactMap(championData) {
  const map = new Map();
  for (const item of championData?.teams || []) {
    map.set(item.team, item);
  }
  return map;
}

function formatCandidateLine(match, factMap) {
  const sides = [match.home, match.away].map((team) => {
    const fact = factMap.get(team.team);
    const score = fact?.scores?.total !== undefined ? `雷达${fact.scores.total}` : "雷达-";
    const tags = (fact?.badges || fact?.tags || []).slice(0, 3).join("/");
    const next = fact?.nextMatch?.opponent ? `下个对手:${fact.nextMatch.opponent}` : "";
    return `${team.team}(${team.flag || ""},#${fact?.rank || "-"},${score}${tags ? `,${tags}` : ""}${next ? `,${next}` : ""})`;
  });
  return `- ${match.id}: ${sides[0]} vs ${sides[1]}`;
}

function buildCompactAlivePrompt({ model, roundId, allowedPicks, candidateMatches, championData, previousAlivePicks = [] }) {
  const factMap = championFactMap(championData);
  const radar = (championData?.teams || []).slice(0, 8)
    .map((item) => `${item.team}#${item.rank}/雷达${item.scores?.total ?? "-"}${item.badges?.length ? `/${item.badges.slice(0, 2).join("+")}` : ""}`)
    .join("; ");
  const candidates = (candidateMatches || []).map((match) => `${match.id}:${match.home.team} vs ${match.away.team}`).join("; ");
  const aliveText = previousAlivePicks.length ? `上轮活口:${previousAlivePicks.map((item) => item.team).join("、")}` : "首轮";
  return [
    `${model.name || model.id} 参加世界杯冠军毒圈。${roundLabel(roundId)} ${aliveText}。`,
    `必须精确选 ${allowedPicks} 队;只能从候选池选;禁止同场对冲;整轮结束结算,0活口永久出局。`,
    `冠军雷达参考:${radar}`,
    `候选池:${candidates}`,
    "只返回一行 JSON,不要解释,不要 Markdown:",
    "{\"picks\":[\"阿根廷\",\"法国\",\"德国\"],\"line\":\"一句中文理由,认真但有梗。\"}",
  ].join("\n");
}

function buildModelPrompt({ model, status, roundId, allowedPicks, candidateMatches, championData, previousAlivePicks = [] }) {
  if (status === "eliminated") {
    return [
      `你是 ${model.name || model.id}, 世界杯 AI 冠军毒圈圆桌里你已经没有活口。`,
      "本轮你不能再选冠军,只能留一句中文场边台词。可以加油、自嘲、嘴硬或阴阳怪气,但不要点名新选择。",
      "只能返回 JSON,不要代码块,格式:",
      "{\"line\":\"一句短台词\",\"picks\":[]}",
    ].join("\n");
  }

  if (model.id === "mimo-v2-5-pro") {
    return buildCompactAlivePrompt({ model, roundId, allowedPicks, candidateMatches, championData, previousAlivePicks });
  }

  const factMap = championFactMap(championData);
  const previousText = previousAlivePicks.length
    ? `上一轮活口: ${previousAlivePicks.map((item) => item.team).join("、")}`
    : "这是首轮入圈。";
  const candidates = (candidateMatches || []).map((match) => formatCandidateLine(match, factMap)).join("\n");

  return [
    `你是 ${model.name || model.id}, 正在参加世界杯 AI 冠军毒圈圆桌。`,
    `本轮: ${roundLabel(roundId)}。${previousText}`,
    `规则: 你必须从下面候选队里精确选择 ${allowedPicks} 支冠军存活目标。禁止同场对冲,也就是同一场比赛的两队不能同时选。`,
    "按整轮结束结算: 你选的队晋级就是活口,全灭则永久出局;出局后只能场边发言。",
    "判断要认真: 考虑出线形式、己身实力、路径、赔率/热度风险,但台词要有梗。",
    "候选池:",
    candidates,
    "只能返回 JSON,不要代码块,不要解释,格式:",
    "{\"picks\":[\"巴西\",\"德国\",\"法国\"],\"line\":\"一句短中文理由,认真但有梗。\"}",
  ].join("\n");
}

function parseModelJson(text) {
  const raw = String(text || "").trim();
  const stripped = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = stripped.indexOf("{");
  if (start < 0) throw new Error("missing_json_object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < stripped.length; i += 1) {
    const char = stripped[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(stripped.slice(start, i + 1));
    }
  }
  throw new Error("unterminated_json_object");
}

async function runPool(items, concurrency, worker) {
  const limit = Math.max(1, Number(concurrency) || DEFAULT_CONCURRENCY);
  const results = new Array(items.length);
  let cursor = 0;

  async function next() {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;
    results[index] = await worker(items[index], index);
    await next();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

function entryIsReusable(entry) {
  return entry && entry.status !== "issue" && (!entry.issues || entry.issues.length === 0) && entry.calledAt;
}

async function buildEntry({ model, state, roundId, candidateMatches, candidateTeams, championData, askModelFn, timeoutMs, generatedAt }) {
  if (state.status === "blocked") {
    return {
      modelId: model.id,
      modelName: model.name,
      vendor: model.vendor,
      status: "issue",
      allowedPicks: 0,
      picks: [],
      alivePicks: [],
      eliminatedPicks: [],
      line: "",
      calledAt: generatedAt,
      durationMs: 0,
      issues: [{ type: "previous_round_unsettled", message: "上一轮尚未整轮结算,本轮不能开选。" }],
    };
  }

  const prompt = buildModelPrompt({
    model,
    status: state.status,
    roundId,
    allowedPicks: state.allowedPicks,
    candidateMatches,
    championData,
    previousAlivePicks: state.previousAlivePicks,
  });
  const result = await askModelFn(model.id, prompt, { timeoutMs });
  const base = {
    modelId: model.id,
    modelName: model.name,
    vendor: model.vendor,
    status: state.status === "eliminated" ? "eliminated" : "alive",
    allowedPicks: state.allowedPicks,
    picks: [],
    alivePicks: [],
    eliminatedPicks: [],
    line: "",
    calledAt: generatedAt,
    durationMs: result?.durationMs || 0,
    issues: [],
  };

  if (!result?.ok) {
    return {
      ...base,
      status: "issue",
      issues: [{ type: result?.error || "model_call_failed", message: result?.error || "模型调用失败。" }],
    };
  }
  if (!String(result.text || "").trim()) {
    return {
      ...base,
      status: "issue",
      issues: [{ type: "empty", message: "模型空返回,未提供可校验 JSON。" }],
    };
  }

  try {
    const parsed = parseModelJson(result.text);
    if (state.status === "eliminated") {
      const checked = validateSidelineOutput(parsed);
      if (!checked.valid) return { ...base, status: "issue", issues: checked.issues };
      return { ...base, status: "eliminated", line: checked.line };
    }
    const checked = validateModelOutput(parsed, { roundId, candidateMatches, candidateTeams, allowedPicks: state.allowedPicks });
    if (!checked.valid) return { ...base, status: "issue", line: checked.line, issues: checked.issues };
    return { ...base, picks: checked.picks, line: checked.line };
  } catch (err) {
    return {
      ...base,
      status: "issue",
      issues: [{ type: "invalid_json", message: String(err && err.message || err) }],
    };
  }
}

function summarizeRound(round) {
  const summary = {
    aliveModels: 0,
    eliminatedModels: 0,
    issueModels: 0,
    totalPicks: 0,
    topTeams: [],
  };
  const votes = new Map();

  for (const entry of round.entries || []) {
    if (entry.status === "issue") summary.issueModels += 1;
    else if (entry.status === "eliminated") summary.eliminatedModels += 1;
    else if (entry.status === "alive") summary.aliveModels += 1;

    for (const pick of entry.picks || []) {
      summary.totalPicks += 1;
      const item = votes.get(pick.team) || { team: pick.team, flag: pick.flag, votes: 0, modelIds: [] };
      item.votes += 1;
      item.modelIds.push(entry.modelId);
      votes.set(pick.team, item);
    }
  }

  summary.topTeams = Array.from(votes.values())
    .sort((a, b) => b.votes - a.votes || a.team.localeCompare(b.team, "zh-CN"))
    .slice(0, 12);
  return summary;
}

async function generateRoundData({ roundId, matches, models, championData, askModelFn = askModel, missingOnly = false, concurrency = DEFAULT_CONCURRENCY, timeoutMs = DEFAULT_TIMEOUT_MS, generatedAt = new Date().toISOString() }) {
  const existingGauntlet = championData.gauntlet || {};
  const existingRound = latestRound(existingGauntlet, roundId);
  const existingEntries = new Map((existingRound?.entries || []).map((entry) => [entry.modelId, entry]));
  const candidateMatches = candidateMatchesForRound(matches, roundId);
  const candidateTeams = candidateTeamsForRound(candidateMatches);
  const modelList = models || enabledModels();

  const entries = await runPool(modelList, concurrency, async (model) => {
    const existing = existingEntries.get(model.id);
    if (missingOnly && entryIsReusable(existing)) return existing;
    const state = modelStateForRound(existingGauntlet, roundId, model.id);
    return buildEntry({
      model,
      state,
      roundId,
      candidateMatches,
      candidateTeams,
      championData,
      askModelFn,
      timeoutMs,
      generatedAt,
    });
  });

  const round = {
    roundId,
    label: roundLabel(roundId),
    status: entries.some((entry) => entry.status === "issue") ? "open" : "locked",
    startedAt: existingRound?.startedAt || generatedAt,
    lockedAt: entries.some((entry) => entry.status === "issue") ? null : generatedAt,
    settledAt: null,
    pickCountRule: roundId === "round32"
      ? { type: "fixed", count: 3, description: "首轮剩余 15 场 30 队,每个 AI 固定 3 票。" }
      : { type: "survivor_count", description: "本轮可选数量等于上一整轮活口数;0 活口永久出局。" },
    candidateTeams,
    excludedMatches: excludedMatchesForRound(matches, roundId),
    entries,
  };
  round.summary = summarizeRound(round);
  return round;
}

function resultWinnerTeam(match) {
  const result = match?.actual?.result;
  if (result === "home") return match.home.team;
  if (result === "away") return match.away.team;
  return "";
}

function settleRoundData(round, matches, settledAt = new Date().toISOString()) {
  const matchIds = Array.from(new Set((round.candidateTeams || []).map((item) => item.matchId).filter(Boolean)));
  const matchById = new Map((matches || []).map((match) => [match.id, match]));
  const pending = matchIds.filter((matchId) => !matchById.get(matchId)?.actual);
  if (pending.length) throw new Error(`pending ${round.roundId} matches: ${pending.join(",")}`);

  const winners = new Map(matchIds.map((matchId) => [matchId, resultWinnerTeam(matchById.get(matchId))]));
  const entries = (round.entries || []).map((entry) => {
    if (entry.status === "issue") return entry;
    if (entry.status === "eliminated" && !(entry.picks || []).length) return entry;
    const alivePicks = [];
    const eliminatedPicks = [];
    for (const pick of entry.picks || []) {
      if (winners.get(pick.matchId) === pick.team) alivePicks.push(pick);
      else eliminatedPicks.push(pick);
    }
    return {
      ...entry,
      status: alivePicks.length ? "alive" : "eliminated",
      alivePicks,
      eliminatedPicks,
      settledAt,
    };
  });
  const settled = { ...round, status: "settled", settledAt, entries };
  settled.summary = summarizeRound(settled);
  return settled;
}

function mergeGauntletRound(championData, round, updatedAt = new Date().toISOString()) {
  const gauntlet = {
    updatedAt,
    mode: "real-model",
    note: "AI 冠军毒圈圆桌: 0 活口永久出局,出局后只能场边发言。",
    ...(championData.gauntlet || {}),
  };
  const rounds = (gauntlet.rounds || []).filter((item) => item.roundId !== round.roundId);
  rounds.push(round);
  rounds.sort((a, b) => roundIndex(a.roundId) - roundIndex(b.roundId));
  gauntlet.updatedAt = updatedAt;
  gauntlet.rounds = rounds;
  return { ...championData, updatedAt, gauntlet };
}

function parseArgs(argv) {
  const args = {
    roundId: "round32",
    settle: false,
    missingOnly: false,
    dryRun: false,
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    matchesPath: MATCHES_PATH,
    championPath: CHAMPION_PATH,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--round" && next) {
      args.roundId = next;
      i += 1;
    } else if (key === "--settle") {
      args.settle = true;
    } else if (key === "--missing-only") {
      args.missingOnly = true;
    } else if (key === "--dry-run") {
      args.dryRun = true;
    } else if (key === "--concurrency" && next) {
      args.concurrency = Number(next) || DEFAULT_CONCURRENCY;
      i += 1;
    } else if (key === "--timeout" && next) {
      args.timeoutMs = Number(next) || DEFAULT_TIMEOUT_MS;
      i += 1;
    } else if (key === "--matches" && next) {
      args.matchesPath = path.resolve(next);
      i += 1;
    } else if (key === "--champion" && next) {
      args.championPath = path.resolve(next);
      i += 1;
    } else if (key === "--help" || key === "-h") {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Champion gauntlet

Usage:
  npm run champion:gauntlet -- --round round32
  npm run champion:gauntlet -- --round round32 --missing-only
  npm run champion:gauntlet:settle -- --round round32

Options:
  --round <id>        round32 | round16 | quarterfinal | semifinal | final
  --missing-only      keep valid existing entries, rerun missing/issue entries
  --settle            settle a locked round after the whole round has results
  --concurrency <n>   parallel model calls, default ${DEFAULT_CONCURRENCY}
  --timeout <ms>      per-model API timeout, default ${DEFAULT_TIMEOUT_MS}
  --dry-run           print output summary without writing JSON
`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }
  const matches = readJson(args.matchesPath).matches || [];
  const championData = readJson(args.championPath);
  const generatedAt = new Date().toISOString();
  let nextChampionData;

  if (args.settle) {
    const round = latestRound(championData.gauntlet, args.roundId);
    if (!round) throw new Error(`round not found: ${args.roundId}`);
    const settled = settleRoundData(round, matches, generatedAt);
    nextChampionData = mergeGauntletRound(championData, settled, generatedAt);
  } else {
    const round = await generateRoundData({
      roundId: args.roundId,
      matches,
      championData,
      missingOnly: args.missingOnly,
      concurrency: args.concurrency,
      timeoutMs: args.timeoutMs,
      generatedAt,
    });
    nextChampionData = mergeGauntletRound(championData, round, generatedAt);
  }

  const round = latestRound(nextChampionData.gauntlet, args.roundId);
  const issueCount = round.entries.filter((entry) => entry.status === "issue").length;
  if (args.dryRun) {
    console.log(JSON.stringify({ roundId: round.roundId, status: round.status, summary: round.summary, issueCount }, null, 2));
  } else {
    writeJson(args.championPath, nextChampionData);
    console.log(`[champion-gauntlet] wrote ${args.championPath} round=${round.roundId} status=${round.status} issues=${issueCount}`);
  }
  if (issueCount && !args.settle) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  ROUND_ORDER,
  ROUND_LABELS,
  candidateMatchesForRound,
  candidateTeamsForRound,
  validateModelOutput,
  validateSidelineOutput,
  modelStateForRound,
  buildModelPrompt,
  parseModelJson,
  generateRoundData,
  settleRoundData,
  mergeGauntletRound,
  summarizeRound,
  main,
};
