const crypto = require("crypto");

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPrediction(prediction) {
  const content = {
    modelId: prediction.modelId,
    track: prediction.track,
    result: prediction.result,
    score: prediction.score,
    reasoning: prediction.reasoning || "",
    timestamp: prediction.timestamp,
  };
  return `sha256:${crypto.createHash("sha256").update(stableStringify(content)).digest("hex")}`;
}

function sealPrediction(prediction, timestamp = new Date().toISOString()) {
  const sealed = {
    ...prediction,
    timestamp: prediction.timestamp || timestamp,
  };
  return {
    ...sealed,
    hash: hashPrediction(sealed),
  };
}

function sealMatch(match, predictions, timestamp = new Date().toISOString()) {
  return {
    ...match,
    sealedAt: match.sealedAt || timestamp,
    predictions: predictions.map((prediction) => sealPrediction(prediction, timestamp)),
  };
}

module.exports = {
  stableStringify,
  hashPrediction,
  sealPrediction,
  sealMatch,
};
