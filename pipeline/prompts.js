const RESULT_VALUES = ["home", "draw", "away"];

function formatOdds(match) {
  const result = match.odds && match.odds.result ? match.odds.result : {};
  const scores = match.odds && match.odds.scores ? match.odds.scores : {};
  const provider = match.odds && match.odds.provider ? ` (${match.odds.provider})` : "";
  return [
    `胜平负赔率${provider}: home=${result.home}, draw=${result.draw}, away=${result.away}`,
    `比分赔率: ${Object.entries(scores)
      .map(([score, odd]) => `${score}=${odd}`)
      .join(", ")}`,
  ].join("\n");
}

function matchBasics(match) {
  return [
    `比赛ID: ${match.id}`,
    `阶段: ${match.stage || "未知"}`,
    `开赛时间: ${match.kickoff}`,
    `主队: ${match.home && match.home.team}`,
    `客队: ${match.away && match.away.team}`,
  ].join("\n");
}

function schema() {
  return `只输出 JSON,不要 Markdown,不要额外解释。结构:
{
  "result": "home|draw|away",
  "score": "主队进球-客队进球,如 2-1",
  "reasoning": "一句中文理由,不超过 60 字"
}
要求:
- result 必须是 ${RESULT_VALUES.join("/")};
- score 必须是常规时间比分,格式为数字-数字。`;
}

function buildPredictionPrompt(match, options = {}) {
  const form = match.context && match.context.form ? match.context.form : "暂无额外近况数据。";
  return `你正在参加「世界杯 AI 擂台」。榜单只统计两个结果:是否猜中胜平负,以及是否猜中具体比分。请基于同一份对阵、赔率和近况信息预测。

${matchBasics(match)}

${formatOdds(match)}
近况: ${form}

${schema()}`;
}

function buildPrompt(track, match, options = {}) {
  return buildPredictionPrompt(match, options);
}

module.exports = {
  RESULT_VALUES,
  buildPredictionPrompt,
  buildPrompt,
};
