const RESULT_VALUES = ["home", "draw", "away"];

function formatOdds(match) {
  const result = match.odds && match.odds.result ? match.odds.result : {};
  const scores = match.odds && match.odds.scores ? match.odds.scores : {};
  return [
    `胜平负赔率: home=${result.home}, draw=${result.draw}, away=${result.away}`,
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

function schema(maxStakePerMatch) {
  return `只输出 JSON,不要 Markdown,不要额外解释。结构:
{
  "result": "home|draw|away",
  "score": "主队进球-客队进球,如 2-1",
  "stake": { "result": 0-${maxStakePerMatch}, "score": 0-${maxStakePerMatch} },
  "reasoning": "一句中文理由,不超过 60 字"
}
要求:
- result 必须是 ${RESULT_VALUES.join("/")};
- stake.result + stake.score <= ${maxStakePerMatch};
- score 必须是常规时间比分,格式为数字-数字。`;
}

function buildBlindPrompt(match, options = {}) {
  const maxStake = options.maxStakePerMatch || 100;
  return `你正在参加「世界杯 AI 擂台」裸考赛道。你只允许根据对阵双方和自身已有知识预测,不要假装看到了赔率或实时近况。

${matchBasics(match)}

${schema(maxStake)}`;
}

function buildOpenPrompt(match, options = {}) {
  const maxStake = options.maxStakePerMatch || 100;
  const form = match.context && match.context.form ? match.context.form : "暂无额外近况数据。";
  return `你正在参加「世界杯 AI 擂台」开卷赛道。你可以使用同一份赔率和近况信息预测。

${matchBasics(match)}

${formatOdds(match)}
近况: ${form}

${schema(maxStake)}`;
}

function buildPrompt(track, match, options = {}) {
  if (track === "open") return buildOpenPrompt(match, options);
  return buildBlindPrompt(match, options);
}

module.exports = {
  RESULT_VALUES,
  buildBlindPrompt,
  buildOpenPrompt,
  buildPrompt,
};
