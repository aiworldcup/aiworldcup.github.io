const SCORE_SCOPE_REGULAR_TIME = "regularTime";
const SCORE_SCOPE_FINAL = "finalIncludingExtraTime";
const SCORE_SCOPE_UNKNOWN = "unknown";

function normalizeScore(value) {
  const match = String(value || "").trim().match(/^(\d+)\s*[:-]\s*(\d+)$/);
  if (!match) return "";
  return `${Number(match[1])}-${Number(match[2])}`;
}

function resultFromScore(score) {
  const match = String(score || "").match(/^(\d+)-(\d+)$/);
  if (!match) return "";
  const home = Number(match[1]);
  const away = Number(match[2]);
  if (home === away) return "draw";
  return home > away ? "home" : "away";
}

function normalizeScoreScope(value) {
  const scope = String(value || "").trim();
  if (scope === SCORE_SCOPE_REGULAR_TIME) return SCORE_SCOPE_REGULAR_TIME;
  if (scope === SCORE_SCOPE_FINAL) return SCORE_SCOPE_FINAL;
  if (scope === SCORE_SCOPE_UNKNOWN) return SCORE_SCOPE_UNKNOWN;
  return "";
}

function defaultScoreScopeForSource(sourceName) {
  if (sourceName === "jingcai" || sourceName === "local-result-fallback") {
    return SCORE_SCOPE_REGULAR_TIME;
  }
  return SCORE_SCOPE_UNKNOWN;
}

function scoreScopeForEntry(entry, sourceName) {
  return normalizeScoreScope(entry && entry.scoreScope) || defaultScoreScopeForSource(sourceName);
}

function scoreForEntry(entry) {
  return normalizeScore(entry && (entry.officialScore || entry.score || entry.actualScore));
}

function resultForEntry(entry, score) {
  const explicit = String((entry && (entry.result || entry.actualResult)) || "").trim();
  if (["home", "draw", "away"].includes(explicit)) return explicit;
  return resultFromScore(score);
}

function actualForEntry(entry, sourceName) {
  const score = scoreForEntry(entry);
  const result = resultForEntry(entry, score);
  if (!score || !result) return null;
  return {
    result,
    score,
    scoreScope: scoreScopeForEntry(entry, sourceName),
  };
}

function scoreScopeFromEspnEvent(event) {
  const status = event && event.status ? event.status : {};
  const type = status.type || {};
  const period = Number(status.period ?? type.period ?? "");
  const text = [
    type.name,
    type.description,
    type.detail,
    type.shortDetail,
    status.displayClock,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  if (period > 2 || /AET|AFTER EXTRA|EXTRA TIME|PEN|PENALT/.test(text)) {
    return SCORE_SCOPE_FINAL;
  }
  if (/FT|FULL TIME|FINAL|STATUS_FINAL/.test(text)) return SCORE_SCOPE_REGULAR_TIME;
  return SCORE_SCOPE_UNKNOWN;
}

module.exports = {
  SCORE_SCOPE_FINAL,
  SCORE_SCOPE_REGULAR_TIME,
  SCORE_SCOPE_UNKNOWN,
  actualForEntry,
  normalizeScore,
  normalizeScoreScope,
  resultForEntry,
  resultFromScore,
  scoreForEntry,
  scoreScopeForEntry,
  scoreScopeFromEspnEvent,
};
