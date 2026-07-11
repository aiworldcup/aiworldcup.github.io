const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ROUND_ORDER, computeSealedPicksHash } = require("./champion-gauntlet");

const DEFAULT_PATH = path.join(__dirname, "..", "public", "data", "champion-predictions.json");
const DEFAULT_MATCHES_PATH = path.join(__dirname, "..", "public", "data", "matches.json");
const VALID_ROUND_STATUSES = new Set(["open", "locked", "settled", "skipped"]);
const VALID_ENTRY_STATUSES = new Set(["alive", "eliminated", "issue"]);

function entryCompletionMs(entry) {
  const completed = Date.parse(entry?.completedAt || "");
  if (Number.isFinite(completed)) return completed;
  const called = Date.parse(entry?.calledAt || "");
  if (!Number.isFinite(called)) return null;
  return called + Math.max(0, Number(entry?.durationMs) || 0);
}

function loadKnownMatches(filePath = DEFAULT_MATCHES_PATH) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return new Map((data.matches || []).map((match) => [match.id, match]));
}

function validateImmutableBaseline(data, baselineData) {
  if (!baselineData?.gauntlet?.rounds) return [];
  const errors = [];
  const currentRounds = new Map((data?.gauntlet?.rounds || []).map((round) => [round.roundId, round]));
  for (const baselineRound of baselineData.gauntlet.rounds) {
    const currentRound = currentRounds.get(baselineRound.roundId);
    for (const baselineEntry of baselineRound.entries || []) {
      if (baselineRound.status === "open" && baselineEntry.status === "issue") continue;
      const currentEntry = currentRound?.entries?.find((entry) => entry.modelId === baselineEntry.modelId);
      if (baselineEntry.status === "issue" && currentEntry?.status !== "issue") {
        errors.push(`round ${baselineRound.roundId} model ${baselineEntry.modelId}: locked issue entry differs from committed baseline`);
      } else if (!currentEntry || JSON.stringify(currentEntry.picks || []) !== JSON.stringify(baselineEntry.picks || [])) {
        errors.push(`round ${baselineRound.roundId} model ${baselineEntry.modelId}: sealed picks differ from committed baseline`);
      }
    }
  }
  return errors;
}

function validateChampionGauntletData(data, options = {}) {
  const errors = [];
  const knownMatches = options.knownMatches || loadKnownMatches();
  const rounds = data?.gauntlet?.rounds;
  if (!Array.isArray(rounds)) return ["gauntlet.rounds must be an array"];
  const roundIds = new Set();
  let previousIndex = -1;

  for (const round of rounds) {
    const prefix = `round ${round?.roundId || "unknown"}`;
    const index = ROUND_ORDER.indexOf(round?.roundId);
    if (index < 0) errors.push(`${prefix}: unknown round id`);
    if (roundIds.has(round?.roundId)) errors.push(`${prefix}: duplicate round`);
    roundIds.add(round?.roundId);
    if (index >= 0 && index <= previousIndex) errors.push(`${prefix}: rounds are out of order`);
    if (index >= 0) previousIndex = index;
    if (!VALID_ROUND_STATUSES.has(round?.status)) errors.push(`${prefix}: invalid status ${round?.status}`);
    if (["locked", "settled"].includes(round?.status)) {
      if (!round?.sealedPicksHash) errors.push(`${prefix}: missing sealed picks hash`);
      else if (round.sealedPicksHash !== computeSealedPicksHash(round)) errors.push(`${prefix}: sealed picks hash mismatch`);
    }

    const deadlineMs = Date.parse(round?.deadlineAt || "");
    if (round?.deadlineAt && !Number.isFinite(deadlineMs)) errors.push(`${prefix}: invalid deadlineAt`);
    const excludedIds = new Set((round?.excludedMatches || []).map((item) => item.matchId).filter(Boolean));
    const candidates = new Map((round?.candidateTeams || []).map((item) => [`${item.matchId}|${item.team}`, item]));
    const modelIds = new Set();

    if (round?.status === "skipped" && (round?.entries || []).length) {
      errors.push(`${prefix}: skipped round must not contain entries`);
    }

    for (const entry of round?.entries || []) {
      const entryPrefix = `${prefix} model ${entry?.modelId || "unknown"}`;
      if (!entry?.modelId) errors.push(`${entryPrefix}: missing modelId`);
      if (modelIds.has(entry?.modelId)) errors.push(`${entryPrefix}: duplicate model entry`);
      modelIds.add(entry?.modelId);
      if (!VALID_ENTRY_STATUSES.has(entry?.status)) errors.push(`${entryPrefix}: invalid status ${entry?.status}`);
      const picks = Array.isArray(entry?.picks) ? entry.picks : [];
      const issues = Array.isArray(entry?.issues) ? entry.issues : [];

      if (entry?.status === "issue" && picks.length) errors.push(`${entryPrefix}: issue entry contains picks`);
      if (entry?.status !== "issue" && issues.length) errors.push(`${entryPrefix}: valid entry contains issues`);
      if (entry?.status === "alive" && picks.length !== Number(entry?.allowedPicks)) {
        errors.push(`${entryPrefix}: pick count does not match allowedPicks`);
      }

      const pickedMatches = new Set();
      for (const pick of picks) {
        const knownMatch = knownMatches.get(pick?.matchId);
        if (!knownMatch) errors.push(`${entryPrefix}: pick references unknown match ${pick?.matchId}`);
        else if (![knownMatch.home?.team, knownMatch.away?.team].includes(pick?.team)) {
          errors.push(`${entryPrefix}: pick team does not belong to match ${pick?.matchId}`);
        }
        if (excludedIds.has(pick?.matchId)) errors.push(`${entryPrefix}: pick references excluded match ${pick?.matchId}`);
        if (pickedMatches.has(pick?.matchId)) errors.push(`${entryPrefix}: multiple picks from match ${pick?.matchId}`);
        pickedMatches.add(pick?.matchId);
        if (candidates.size && !candidates.has(`${pick?.matchId}|${pick?.team}`)) {
          errors.push(`${entryPrefix}: pick is outside frozen candidate pool`);
        }
      }

      if (entry?.status !== "issue" && Number.isFinite(deadlineMs) && picks.length) {
        const calledMs = Date.parse(entry?.calledAt || "");
        const completionMs = entryCompletionMs(entry);
        if (!Number.isFinite(calledMs)) errors.push(`${entryPrefix}: missing call start evidence`);
        else if (calledMs >= deadlineMs) errors.push(`${entryPrefix}: call started after deadline`);
        if (completionMs === null) errors.push(`${entryPrefix}: missing call completion evidence`);
        else if (Number.isFinite(calledMs) && completionMs < calledMs) errors.push(`${entryPrefix}: completion precedes call start`);
        else if (completionMs >= deadlineMs) errors.push(`${entryPrefix}: accepted pick completed after deadline`);
      }
    }
  }
  return [...errors, ...validateImmutableBaseline(data, options.baselineData)];
}

function committedChampionBaseline() {
  try {
    const text = execFileSync("git", ["show", "HEAD:public/data/champion-predictions.json"], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function main() {
  const filePath = path.resolve(process.argv[2] || DEFAULT_PATH);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const errors = validateChampionGauntletData(data, {
    knownMatches: loadKnownMatches(),
    baselineData: committedChampionBaseline(),
  });
  if (errors.length) {
    errors.forEach((error) => console.error(`[validate-champion] ${error}`));
    throw new Error(`[validate-champion] failed with ${errors.length} error(s)`);
  }
  console.log(`[validate-champion] ok rounds=${data.gauntlet?.rounds?.length || 0}`);
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
  entryCompletionMs,
  loadKnownMatches,
  validateImmutableBaseline,
  validateChampionGauntletData,
};
