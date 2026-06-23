// 世界杯 AI 擂台 — 盘口博弈指数
// 纯函数:根据现有比赛、赔率和模型预测派生盘口定价分歧。

(function attachMatchInsights(root) {
  const RESULT_KEYS = ['home', 'draw', 'away'];
  const RESULT_LABELS = { home: '主胜', draw: '平局', away: '客胜' };
  const RESULT_SHORT = { home: '主', draw: '平', away: '客' };

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatProbability(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    return `${Math.round(number * 100)}%`;
  }

  function formatSignedPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    const signed = number > 0 ? '+' : '';
    return `${signed}${Math.round(number * 100)}%`;
  }

  function formatOdds(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '-';
    return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  function resultOdds(match) {
    return match && match.odds && match.odds.result ? match.odds.result : {};
  }

  function hasCompleteResultOdds(match) {
    const odds = resultOdds(match);
    return RESULT_KEYS.every((key) => {
      const value = toNumber(odds[key]);
      return value && value > 1;
    });
  }

  function normalizeProbabilities(input) {
    if (!input) return null;
    const values = {
      home: toNumber(input.home ?? input.home_win ?? input.homeWin),
      draw: toNumber(input.draw),
      away: toNumber(input.away ?? input.away_win ?? input.awayWin),
    };
    if (!RESULT_KEYS.every((key) => values[key] !== null && values[key] >= 0)) return null;

    let sum = RESULT_KEYS.reduce((total, key) => total + values[key], 0);
    if (!sum) return null;
    if (sum > 1.01 && sum <= 100.5) {
      RESULT_KEYS.forEach((key) => {
        values[key] /= 100;
      });
      sum = RESULT_KEYS.reduce((total, key) => total + values[key], 0);
    }
    if (Math.abs(sum - 1) > 0.015) {
      RESULT_KEYS.forEach((key) => {
        values[key] /= sum;
      });
    }
    return values;
  }

  function storedModelProbabilities(match) {
    const candidates = [
      match && match.marketEdge && match.marketEdge.modelProbabilities,
      match && match.marketEdge && match.marketEdge.probabilities,
      match && match.handicapPrediction && match.handicapPrediction.modelProbabilities,
      match && match.oddsPrediction && match.oddsPrediction.modelProbabilities,
      match && match.marketPrediction && match.marketPrediction.probabilities,
      match && match.content && match.content.marketEdge && match.content.marketEdge.modelProbabilities,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeProbabilities(candidate);
      if (normalized) return normalized;
    }
    return null;
  }

  function marketProbabilities(match) {
    if (!hasCompleteResultOdds(match)) return null;
    const odds = resultOdds(match);
    const implied = {};
    let impliedSum = 0;
    RESULT_KEYS.forEach((key) => {
      implied[key] = 1 / Number(odds[key]);
      impliedSum += implied[key];
    });
    const probabilities = {};
    RESULT_KEYS.forEach((key) => {
      probabilities[key] = implied[key] / impliedSum;
    });
    return {
      probabilities,
      implied,
      impliedSum,
      overround: Math.max(0, impliedSum - 1),
    };
  }

  function predictionProbabilities(predictions) {
    const valid = (predictions || []).filter((prediction) => RESULT_KEYS.includes(prediction && prediction.result));
    if (!valid.length) return null;
    const smoothing = valid.length >= 6 ? 0.5 : 1;
    const denominator = valid.length + smoothing * RESULT_KEYS.length;
    const counts = { home: 0, draw: 0, away: 0 };
    valid.forEach((prediction) => {
      counts[prediction.result] += 1;
    });
    const probabilities = {};
    RESULT_KEYS.forEach((key) => {
      probabilities[key] = (counts[key] + smoothing) / denominator;
    });
    return {
      probabilities,
      counts,
      sampleSize: valid.length,
      source: 'models',
      sourceLabel: `模型共识 ${valid.length} 票`,
    };
  }

  function modelProbabilities(match, predictions, market) {
    const stored = storedModelProbabilities(match);
    if (stored) {
      return {
        probabilities: stored,
        sampleSize: (predictions || []).length,
        source: 'stored',
        sourceLabel: '结构化模型概率',
      };
    }
    const fromPredictions = predictionProbabilities(predictions);
    if (fromPredictions) return fromPredictions;
    if (market && market.probabilities) {
      return {
        probabilities: market.probabilities,
        sampleSize: 0,
        source: 'market',
        sourceLabel: '市场归一基准',
      };
    }
    return null;
  }

  function maxEntry(probabilities) {
    if (!probabilities) return null;
    return RESULT_KEYS
      .map((key) => ({ key, probability: probabilities[key] || 0 }))
      .sort((a, b) => b.probability - a.probability)[0] || null;
  }

  function riskLevel(primary, model, market) {
    if (!primary) return '高';
    if (model && model.source === 'market') return '高';
    if ((model && model.sampleSize && model.sampleSize < 5) || primary.key === 'draw') return '中高';
    if ((market && market.overround > 0.1) || Math.abs(primary.diff) > 0.18) return '中高';
    if (primary.ev >= 0.12 && primary.diff >= 0.07) return '中';
    return '中';
  }

  function missingOddsCopy(match) {
    if (match && match.placeholder) {
      return {
        label: '盘口未开',
        source: '等待官方对阵',
        suggestion: '淘汰赛或待定对阵尚未产生真实胜平负盘口，暂不计算盘口博弈方向。',
      };
    }
    if (match && match.actual) {
      return {
        label: '历史盘口缺失',
        source: '赛前盘口未留存',
        suggestion: '该场缺少可校验的赛前胜平负赔率，赛后不补造历史盘口，因此不计算盘口博弈方向。',
      };
    }
    return {
      label: '暂无真实盘口',
      source: '主备赔率源未覆盖',
      suggestion: '当前主备赔率源暂未提供完整胜平负盘口；拿到真实赔率后再计算市场隐含概率和盘口博弈方向。',
    };
  }

  function buildMarketEdge(match, predictions) {
    const market = marketProbabilities(match);
    if (!market) {
      const copy = missingOddsCopy(match);
      return {
        status: 'missing-odds',
        valueSide: copy.label,
        shortLabel: copy.label,
        direction: '观望',
        confidence: '-',
        riskLevel: '高',
        sourceLabel: copy.source,
        suggestion: copy.suggestion,
        rows: [],
      };
    }
    const model = modelProbabilities(match, predictions, market);
    const odds = resultOdds(match);
    const rows = RESULT_KEYS.map((key) => {
      const modelProbability = model && model.probabilities ? model.probabilities[key] : market.probabilities[key];
      const marketProbability = market.probabilities[key];
      const marketOdds = Number(odds[key]);
      const fairOdds = modelProbability > 0 ? 1 / modelProbability : null;
      return {
        key,
        label: RESULT_LABELS[key],
        shortLabel: RESULT_SHORT[key],
        modelProbability,
        marketProbability,
        probabilityDiff: modelProbability - marketProbability,
        diff: modelProbability - marketProbability,
        marketOdds,
        fairOdds,
        ev: modelProbability * marketOdds - 1,
      };
    });
    const sorted = rows.slice().sort((a, b) => b.ev - a.ev || b.diff - a.diff);
    const primary = sorted[0];
    const marketFavorite = maxEntry(market.probabilities);
    const modelIsMarketOnly = model && model.source === 'market';
    let status = 'watch';
    let direction = '观望';
    let confidence = 'C';
    let valueSide = '市场定价接近';
    if (!modelIsMarketOnly && primary && primary.ev > 0.08 && primary.diff > 0.05) {
      status = 'strong-value';
      direction = primary.label;
      confidence = primary.ev > 0.14 && primary.diff > 0.08 ? 'A-' : 'B';
      valueSide = `${primary.label}被低估`;
    } else if (!modelIsMarketOnly && primary && primary.ev >= 0.03 && primary.diff >= 0.025) {
      status = 'light-value';
      direction = primary.label;
      confidence = 'C+';
      valueSide = `${primary.label}轻微低估`;
    }
    const risk = riskLevel(primary, model, market);
    const marketDirection = marketFavorite ? `市场更看好${RESULT_LABELS[marketFavorite.key]}` : '市场方向待定';
    const shortLabel = status === 'watch' ? '观望' : valueSide;
    const suggestion = status === 'watch'
      ? (modelIsMarketOnly
        ? '暂无模型概率时只展示市场归一基准，不给盘口方向。'
        : '模型概率与市场定价差距不够大，当前更适合观望。')
      : `模型认为${primary.label}相对市场有价差；若临场阵容或赔率快速变化，需要重新评估。`;

    return {
      status,
      direction,
      valueSide,
      shortLabel,
      confidence,
      riskLevel: risk,
      marketDirection,
      suggestion,
      sourceLabel: model ? model.sourceLabel : '模型概率待生成',
      modelSource: model ? model.source : 'none',
      sampleSize: model ? model.sampleSize : 0,
      modelProbabilities: model && model.probabilities,
      marketProbabilities: market.probabilities,
      overround: market.overround,
      primary,
      rows,
    };
  }

  function buildMatchContent(match, predictions = []) {
    return {
      marketEdge: buildMarketEdge(match, predictions),
    };
  }

  const api = {
    RESULT_KEYS,
    RESULT_LABELS,
    RESULT_SHORT,
    buildMatchContent,
    formatOdds,
    formatProbability,
    formatSignedPercent,
    hasCompleteResultOdds,
    marketProbabilities,
    modelProbabilities,
  };

  root.WorldCupInsights = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
