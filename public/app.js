// 世界杯 AI 擂台 — 前端逻辑
// 纯静态:fetch 本地 JSON,失败时回退到 sample 数据。

let MODELS = {};
let MATCHES = [];
let LEADERBOARD = { rankings: [], open: [] };
let CHAMPIONS = [];
let DISCUSSIONS = [];
let selectedDateKey = '';
const ACTIVE_TRACK = 'open';
const ASIA_SHANGHAI = 'Asia/Shanghai';
const DAY_MS = 24 * 60 * 60 * 1000;
const MATCH_SETTLEMENT_GRACE_MS = 150 * 60 * 1000;
const STAKE_LIMITS = {
  result: 200,
  score: 100,
  total: 300
};

window.addEventListener('error', event => {
  const el = document.getElementById('matches');
  if (!el) return;
  el.innerHTML = `<div class="empty-state">
    <strong>页面数据加载异常</strong>
    <span>${escapeHTML(event.message || '请刷新重试')}</span>
  </div>`;
});

async function loadJSON(path, fallback) {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    if (fallback) {
      console.warn(`加载 ${path} 失败,回退到 ${fallback}`);
      try { return await (await fetch(fallback, { cache: 'no-store' })).json(); }
      catch (_) { return null; }
    }
    return null;
  }
}

function modelMeta(id) {
  return MODELS[id] || { name: id, vendor: '', color: '#888' };
}

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const RESULT_LABEL = { home: '主胜', draw: '平', away: '客胜' };
const RESULT_SHORT = { home: '主', draw: '平', away: '客' };

function formatNumber(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return digits ? '0.0' : '0';
  return num.toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function formatPercent(part, total) {
  const p = Number(part) || 0;
  const t = Number(total) || 0;
  if (!t) return '-';
  return `${Math.round((p / t) * 100)}%`;
}

function relativeTime(ms) {
  const abs = Math.abs(ms);
  const days = Math.floor(abs / DAY_MS);
  const hours = Math.floor((abs % DAY_MS) / (60 * 60 * 1000));
  const minutes = Math.max(1, Math.round((abs % (60 * 60 * 1000)) / (60 * 1000)));
  if (days > 0) return `${days}天${hours ? `${hours}小时` : ''}`;
  if (hours > 0) return `${hours}小时${minutes ? `${minutes}分` : ''}`;
  return `${minutes}分钟`;
}

function flagIcon(value) {
  const raw = String(value || '').trim();
  if (!raw) return '🏳';
  if (/^[A-Za-z]{2}$/.test(raw)) {
    return raw
      .toUpperCase()
      .split('')
      .map(char => String.fromCodePoint(127397 + char.charCodeAt(0)))
      .join('');
  }
  return raw;
}

function formatKickoff(value) {
  if (!value) return '时间待定 · 北京时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    timeZone: ASIA_SHANGHAI,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }) + ' 北京时间';
}

function beijingParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ASIA_SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function beijingDateKey(value = new Date()) {
  const parts = beijingParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateKey, days) {
  const base = new Date(`${dateKey}T00:00:00+08:00`);
  base.setUTCDate(base.getUTCDate() + days);
  return beijingDateKey(base);
}

function dateLabel(dateKey) {
  const today = beijingDateKey();
  const tomorrow = addDays(today, 1);
  const afterTomorrow = addDays(today, 2);
  if (dateKey === today) return '今天';
  if (dateKey === tomorrow) return '明天';
  if (dateKey === afterTomorrow) return '后天';
  const parts = beijingParts(`${dateKey}T00:00:00+08:00`);
  return `${parts.month}/${parts.day}`;
}

function dateSubLabel(dateKey) {
  const parts = beijingParts(`${dateKey}T00:00:00+08:00`);
  const weekMap = { Sun: '周日', Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六' };
  return weekMap[parts.weekday] || parts.weekday || '';
}

function matchDateKey(match) {
  if (match.dateKey) return match.dateKey;
  return beijingDateKey(match.kickoff);
}

function availableDateKeys() {
  const today = beijingDateKey();
  const matchDates = MATCHES.map(matchDateKey).sort();
  const maxDate = matchDates[matchDates.length - 1] || addDays(today, 6);
  const keys = new Set([today, addDays(today, 1), addDays(today, 2)]);
  matchDates.forEach(key => keys.add(key));
  for (let key = today; key <= maxDate; key = addDays(key, 1)) keys.add(key);
  return Array.from(keys).sort();
}

function matchesForSelectedDate() {
  return MATCHES.filter(match => matchDateKey(match) === selectedDateKey);
}

function pickInitialDate() {
  const today = beijingDateKey();
  const upcoming = MATCHES
    .map(matchDateKey)
    .filter(key => key >= today)
    .sort()[0];
  return upcoming || today;
}

function renderDateQuick() {
  const el = document.getElementById('date-quick');
  if (!el) return;
  const keys = availableDateKeys();
  el.innerHTML = keys.map(key => {
    const count = MATCHES.filter(match => matchDateKey(match) === key).length;
    const active = key === selectedDateKey ? ' active' : '';
    const empty = count ? '' : ' empty-date';
    return `<button class="date-btn${active}${empty}" data-date="${key}">
      <span>${dateLabel(key)}</span>
      <small>${dateSubLabel(key)} · ${count ? `${count} 场` : '待更新'}</small>
    </button>`;
  }).join('');
  el.querySelectorAll('.date-btn').forEach(button => {
    button.addEventListener('click', () => {
      selectedDateKey = button.dataset.date;
      renderDateQuick();
      renderMatches();
      renderDiscussions();
    });
  });
}

function renderMatchSummary() {
  const el = document.getElementById('match-summary');
  if (!el) return;
  const selectedMatches = matchesForSelectedDate();
  const states = selectedMatches.map(match => matchLifecycle(match));
  const settled = states.filter(item => item.key === 'settled').length;
  const sealed = states.filter(item => item.key === 'sealed').length;
  const live = states.filter(item => item.key === 'live').length;
  const needsResult = states.filter(item => item.key === 'needs-result').length;
  el.textContent = `${selectedDateKey} · ${selectedMatches.length} 场比赛 · ${sealed} 场已封盘 · ${live} 场进行中 · ${needsResult} 场待赛果 · ${settled} 场已结算`;
}

function renderLeaderboard() {
  const el = document.getElementById('leaderboard');
  if (!el) return;
  const rows = buildLeaderboardRows();
  const summary = document.getElementById('leaderboard-summary');
  const settledMatches = MATCHES.filter(match => !!match.actual).length;
  const pendingMatches = MATCHES.filter(match => !match.actual && predictionsForMatch(match).length).length;
  if (summary) {
    summary.innerHTML = `<div class="lb-summary-card">
      <span>已结算比赛</span><strong>${settledMatches}</strong>
    </div>
    <div class="lb-summary-card">
      <span>待结算预测</span><strong>${pendingMatches}</strong>
    </div>
    <div class="lb-summary-card">
      <span>排行榜口径</span><strong>赔率积分</strong>
    </div>`;
  }
  if (!rows.length) {
    el.innerHTML = '<div class="empty">暂无模型数据</div>';
    return;
  }

  const podium = rows.slice(0, 3).map((row, index) => `<div class="lb-podium-card rank-${index + 1}">
    <span class="lb-crown">#${index + 1}</span>
    <div class="lb-podium-name"><span class="lb-dot" style="background:${row.color}"></span>${escapeHTML(row.name)}</div>
    <small>${escapeHTML(row.vendor || '')}</small>
    <strong>${formatNumber(row.points, row.points % 1 ? 1 : 0)}</strong>
    <span>${row.played ? `胜率 ${formatPercent(row.hits, row.played)}` : `${row.pending} 场待结算`}</span>
  </div>`).join('');

  const table = rows.map((row, index) => {
    const activeText = row.played
      ? `已结算 ${row.played} 场`
      : row.pending
        ? `${row.pending} 场等待赛果`
        : '等待预测';
    return `<div class="lb-row">
      <div class="lb-rank">${index + 1}</div>
      <div class="lb-main">
        <div class="lb-name"><span class="lb-dot" style="background:${row.color}"></span>${escapeHTML(row.name)}</div>
        <div class="lb-vendor">${escapeHTML(row.vendor || '')} · ${activeText}</div>
      </div>
      <div class="lb-stat">
        <span>积分</span>
        <strong>${formatNumber(row.points, row.points % 1 ? 1 : 0)}</strong>
      </div>
      <div class="lb-stat">
        <span>胜率</span>
        <strong>${formatPercent(row.hits, row.played)}</strong>
      </div>
      <div class="lb-stat">
        <span>比分</span>
        <strong>${formatPercent(row.scoreHits, row.played)}</strong>
      </div>
      <div class="lb-stat">
        <span>均分</span>
        <strong>${row.played ? formatNumber(row.avgPoints, 1) : '-'}</strong>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="lb-podium">${podium}</div><div class="lb-table">${table}</div>`;
}

function renderMatches() {
  const el = document.getElementById('matches');
  renderMatchSummary();
  const selectedMatches = matchesForSelectedDate();
  if (!selectedMatches.length) {
    el.innerHTML = `<div class="empty-state">
      <strong>${dateLabel(selectedDateKey)}暂无比赛</strong>
      <span>预测席位先留空。下一批比赛会在开赛前一天封盘后更新。</span>
    </div>`;
    return;
  }
  el.innerHTML = selectedMatches.map(renderMatchCard).join('');
}

function resultFromDiscussionText(text) {
  const value = String(text || '');
  if (/结论[:：]?\s*(平局|打平|平)/.test(value) || /冷平|逼平/.test(value)) return 'draw';
  if (/结论[:：]?\s*(客胜|客队胜|负)/.test(value)) return 'away';
  if (/结论[:：]?\s*(主胜|主队胜|胜)/.test(value)) return 'home';
  if (/平局|打平/.test(value)) return 'draw';
  if (/客胜|客队/.test(value)) return 'away';
  if (/主胜|主场|主队/.test(value)) return 'home';
  return '';
}

function scoreFromDiscussionText(text) {
  const matches = Array.from(String(text || '').matchAll(/[0-9０-９一二三四五六七八九零〇]+\s*[-:：比]\s*[0-9０-９一二三四五六七八九零〇]+/g));
  const match = matches[matches.length - 1];
  if (!match) return '';
  return match[0]
    .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[：比]/g, '-')
    .replace(/\s+/g, '');
}

function stakeFromDiscussionText(text) {
  const value = String(text || '').replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
  const resultMatch = value.match(/(?:胜平负|方向|赛果|结果|主胜|平局|客胜)[^0-9]{0,8}(?:押|投|下注)\s*(\d+)/);
  const scoreMatch = value.match(/比分[^0-9]{0,8}(?:押|投|下注)\s*(\d+)/);
  const result = resultMatch ? Number(resultMatch[1]) : 0;
  const score = scoreMatch ? Number(scoreMatch[1]) : 0;
  return { result, score };
}

function stakeText(prediction) {
  const result = Number(prediction.stake?.result) || 0;
  const score = Number(prediction.stake?.score) || 0;
  if (!result && !score) return '';
  return `赛果${result} / 比分${score}`;
}

function safeStake(stake, limits = STAKE_LIMITS) {
  let result = Math.min(limits.result, Math.max(0, Number(stake?.result) || 0));
  let score = Math.min(limits.score, Math.max(0, Number(stake?.score) || 0));
  const total = result + score;
  if (!total || total <= limits.total) return { result, score, total };
  const ratio = limits.total / total;
  result = Math.min(limits.result, result * ratio);
  score = Math.min(limits.score, score * ratio);
  return { result, score, total: result + score };
}

function scorePrediction(match, prediction) {
  if (!match.actual) return null;
  const stake = safeStake(prediction.stake);
  const resultOdds = match.odds?.result || {};
  const scoreOdds = match.odds?.scores || {};
  const resultHit = prediction.result === match.actual.result;
  const scoreHit = prediction.score === match.actual.score;
  const resultPoints = resultHit ? stake.result * (Number(resultOdds[prediction.result]) || 0) : 0;
  const scorePoints = scoreHit ? stake.score * (Number(scoreOdds[prediction.score]) || 0) : 0;
  return {
    points: resultPoints + scorePoints,
    staked: stake.total,
    resultHit,
    scoreHit
  };
}

function discussionPredictionsForMatch(matchId) {
  const thread = discussionForMatch(matchId);
  const messages = finalMessagesByModel(thread?.messages || []);
  return messages
    .map(message => ({
      modelId: message.modelId,
      result: resultFromDiscussionText(message.text),
      score: scoreFromDiscussionText(message.text),
      stake: stakeFromDiscussionText(message.text),
      source: 'discussion'
    }))
    .filter(prediction => prediction.result && prediction.score);
}

function predictionsForMatch(match) {
  const trackPredictions = (match.predictions || []).filter(p => !p.track || p.track === ACTIVE_TRACK);
  return trackPredictions.length ? trackPredictions : discussionPredictionsForMatch(match.id);
}

function matchLifecycle(match, now = new Date()) {
  if (match.placeholder) {
    return { key: 'placeholder', tone: 'pending', label: '席位待定', detail: '淘汰赛对阵确认后开放预测' };
  }
  if (match.actual) {
    return {
      key: 'settled',
      tone: 'final',
      label: '已结算',
      detail: `${match.actual.score} · ${RESULT_LABEL[match.actual.result] || ''}`
    };
  }
  if (!match.kickoff) {
    return { key: 'unscheduled', tone: 'pending', label: '时间待定', detail: '等待官方赛程确认' };
  }
  const kickoff = new Date(match.kickoff);
  if (Number.isNaN(kickoff.getTime())) {
    return { key: 'unscheduled', tone: 'pending', label: '时间待定', detail: '等待官方赛程确认' };
  }
  const diff = kickoff.getTime() - now.getTime();
  const hasPredictions = predictionsForMatch(match).length > 0 || !!match.sealedAt;
  if (diff > DAY_MS) {
    return {
      key: 'scheduled',
      tone: 'pending',
      label: '等待预测',
      detail: `距开赛${relativeTime(diff)},赛前一天进入预测窗口`
    };
  }
  if (diff > 0) {
    return hasPredictions
      ? { key: 'sealed', tone: 'sealed', label: '已封盘', detail: `距开赛${relativeTime(diff)},开赛后锁定展示` }
      : { key: 'prediction-window', tone: 'hot', label: '预测窗口', detail: `距开赛${relativeTime(diff)},等待模型封盘` };
  }
  if (Math.abs(diff) <= MATCH_SETTLEMENT_GRACE_MS) {
    return { key: 'live', tone: 'live', label: '比赛进行中', detail: '赛后同步真实赛果再结算' };
  }
  return { key: 'needs-result', tone: 'needs-result', label: '待赛果结算', detail: '赛果同步后自动进入积分榜' };
}

function buildLeaderboardRows() {
  const rowsByModel = {};
  const ensure = modelId => {
    const meta = modelMeta(modelId);
    if (!rowsByModel[modelId]) {
      rowsByModel[modelId] = {
        modelId,
        name: meta.name,
        vendor: meta.vendor,
        color: meta.color,
        enabled: meta.enabled !== false,
        points: 0,
        hits: 0,
        scoreHits: 0,
        played: 0,
        predicted: 0,
        pending: 0,
        staked: 0,
        returns: 0
      };
    }
    return rowsByModel[modelId];
  };

  Object.keys(MODELS).forEach(ensure);

  MATCHES.forEach(match => {
    predictionsForMatch(match).forEach(prediction => {
      const row = ensure(prediction.modelId);
      row.predicted += 1;
      const stake = safeStake(prediction.stake);
      if (!match.actual) {
        row.pending += 1;
        row.staked += stake.total;
        return;
      }
      const scored = scorePrediction(match, prediction);
      if (!scored) return;
      row.played += 1;
      row.hits += scored.resultHit ? 1 : 0;
      row.scoreHits += scored.scoreHit ? 1 : 0;
      row.points += scored.points;
      row.returns += scored.points;
      row.staked += scored.staked;
    });
  });

  const scoredRows = LEADERBOARD.rankings || LEADERBOARD.open || [];
  scoredRows.forEach(source => {
    const row = ensure(source.modelId);
    row.points = Number(source.points) || 0;
    row.hits = Number(source.hits) || 0;
    row.scoreHits = Number(source.scoreHits) || 0;
    row.played = Number(source.played) || 0;
    if (source.staked !== undefined) row.staked = Number(source.staked) || row.staked;
    if (source.returns !== undefined) row.returns = Number(source.returns) || row.points;
  });

  return Object.values(rowsByModel)
    .filter(row => row.enabled)
    .map(row => ({
      ...row,
      profit: row.returns - row.staked,
      avgPoints: row.played ? row.points / row.played : 0,
      hitRate: row.played ? row.hits / row.played : null,
      scoreHitRate: row.played ? row.scoreHits / row.played : null
    }))
    .sort((a, b) =>
      b.points - a.points ||
      b.played - a.played ||
      b.predicted - a.predicted ||
      a.name.localeCompare(b.name, 'zh-CN')
    );
}

function renderHeroMetrics() {
  const el = document.getElementById('hero-metrics');
  if (!el) return;
  const lifecycles = MATCHES.map(match => matchLifecycle(match));
  const settled = lifecycles.filter(item => item.key === 'settled').length;
  const needsResult = lifecycles.filter(item => item.key === 'needs-result').length;
  const totalPredictions = MATCHES.reduce((sum, match) => sum + predictionsForMatch(match).length, 0);
  const enabledModels = Object.values(MODELS).filter(model => model.enabled !== false).length;
  el.innerHTML = [
    ['比赛席位', MATCHES.length],
    ['参赛模型', enabledModels],
    ['已出预测', totalPredictions],
    ['待结算', needsResult || settled]
  ].map(([label, value]) => `<div class="hero-metric"><strong>${value}</strong><span>${label}</span></div>`).join('');
}

function renderMatchCard(m) {
  const o = m.odds?.result || {};
  const finished = !!m.actual;
  const displayPredictions = predictionsForMatch(m);
  const hasPredictions = displayPredictions.length > 0;
  const lifecycle = matchLifecycle(m);
  const status = `<span class="match-status status-${lifecycle.tone}">${lifecycle.label}</span>`;

  const counts = displayPredictions.reduce((acc, p) => {
    acc[p.result] = (acc[p.result] || 0) + 1;
    return acc;
  }, { home: 0, draw: 0, away: 0 });
  const total = displayPredictions.length || 1;
  const lean = ['home', 'draw', 'away'].slice().sort((a, b) => counts[b] - counts[a])[0];
  const leanText = displayPredictions.length
    ? `${RESULT_LABEL[lean]} ${counts[lean]}/${displayPredictions.length}`
    : '暂无预测';
  const scoreCounts = displayPredictions.reduce((acc, p) => {
    acc[p.score] = (acc[p.score] || 0) + 1;
    return acc;
  }, {});
  const hotScore = Object.entries(scoreCounts).sort((a, b) => b[1] - a[1])[0];
  const hotScoreText = hotScore ? `${hotScore[0]} · ${hotScore[1]} 票` : '暂无';
  const totalStake = displayPredictions.reduce((acc, p) => acc + (Number(p.stake?.result) || 0) + (Number(p.stake?.score) || 0), 0);
  const avgStakeText = displayPredictions.length && totalStake
    ? `${Math.round(totalStake / displayPredictions.length)} / ${STAKE_LIMITS.total}`
    : '待定';
  const kickoff = formatKickoff(m.kickoff);
  const homeFlag = flagIcon(m.home.flag || (m.placeholder ? '🏆' : ''));
  const awayFlag = flagIcon(m.away.flag || (m.placeholder ? '🏆' : ''));

  const preds = displayPredictions
    .map(p => {
      const meta = modelMeta(p.modelId);
      let mark = '';
      if (finished) {
        const rHit = p.result === m.actual.result;
        const sHit = p.score === m.actual.score;
        mark = `<span class="${rHit ? 'pred-hit' : 'pred-miss'}">${rHit ? '✓胜负' : '✗胜负'}</span>
                <span class="${sHit ? 'pred-hit' : 'pred-miss'}">${sHit ? '✓比分' : '✗比分'}</span>`;
      }
      return `<div class="pred">
        <span class="pred-model"><span class="lb-dot" style="background:${meta.color}"></span>${meta.name}</span>
        <span class="pred-pick"><b>${RESULT_LABEL[p.result] || p.result}</b> · ${p.score}<small>${stakeText(p)}</small></span>
        <span>${mark || (p.source === 'discussion' ? '<span class="pred-source">圆桌</span>' : '')}</span>
      </div>`;
    }).join('') || '<div class="empty">暂无预测</div>';

  const settleSteps = [
    ['预测', hasPredictions || lifecycle.key === 'settled'],
    ['封盘', !!m.sealedAt || hasPredictions || lifecycle.key === 'settled'],
    ['赛果', !!m.actual],
    ['结算', lifecycle.key === 'settled']
  ].map(([label, done]) => `<span class="${done ? 'done' : ''}">${label}</span>`).join('');

  return `<article class="match">
    <div class="match-head">
      <div class="match-meta">
        <span>${m.stage || '世界杯'}</span>
        <span>${kickoff}</span>
      </div>
      <div class="match-teams" aria-label="${m.home.team} 对阵 ${m.away.team}">
        <div class="team team-home">
          <span class="team-flag" aria-hidden="true">${homeFlag}</span>
          <span class="team-name">${m.home.team}</span>
          <span class="team-label">主队</span>
        </div>
        <div class="vs">
          <span>VS</span>
          ${status}
          <small>${lifecycle.detail}</small>
        </div>
        <div class="team team-away">
          <span class="team-flag" aria-hidden="true">${awayFlag}</span>
          <span class="team-name">${m.away.team}</span>
          <span class="team-label">客队</span>
        </div>
      </div>
      <div class="match-info-grid">
        <div class="info-box">
          <span class="info-label">模型倾向</span>
          <strong>${leanText}</strong>
        </div>
        <div class="info-box">
          <span class="info-label">胜平负赔率</span>
          <strong>${RESULT_SHORT.home} ${o.home ?? '-'} · ${RESULT_SHORT.draw} ${o.draw ?? '-'} · ${RESULT_SHORT.away} ${o.away ?? '-'}</strong>
        </div>
        <div class="info-box">
          <span class="info-label">热门比分</span>
          <strong>${hotScoreText}</strong>
        </div>
        <div class="info-box">
          <span class="info-label">平均下注</span>
          <strong>${avgStakeText}</strong>
        </div>
      </div>
      <div class="lean-bars" aria-hidden="true">
        <span style="width:${counts.home / total * 100}%"></span>
        <span style="width:${counts.draw / total * 100}%"></span>
        <span style="width:${counts.away / total * 100}%"></span>
      </div>
      <div class="settlement-strip settlement-${lifecycle.key}">
        <div>
          <span>结算链路</span>
          <strong>${lifecycle.label}</strong>
        </div>
        <div class="settlement-steps">${settleSteps}</div>
      </div>
    </div>
    <div class="pred-title">模型预测</div>
    <div class="preds">${preds}</div>
    ${renderMatchDiscussion(m)}
  </article>`;
}

function renderChampionPredictions() {
  const el = document.getElementById('champion-predictions');
  if (!el) return;
  if (!CHAMPIONS.length) {
    el.innerHTML = `<div class="empty-state">
      <strong>冠军预测待封盘</strong>
      <span>真实模型预测生成后,这里会展示冠军共识和逐模型选择。</span>
    </div>`;
    return;
  }
  const consensus = CHAMPIONS.reduce((acc, item) => {
    const key = item.team;
    acc[key] = acc[key] || { team: item.team, flag: item.flag, count: 0, confidence: 0 };
    acc[key].count += 1;
    acc[key].confidence += Number(item.confidence) || 0;
    return acc;
  }, {});
  const leaders = Object.values(consensus)
    .sort((a, b) => b.count - a.count || b.confidence - a.confidence)
    .slice(0, 3);
  const leaderRows = leaders.map((item, index) => `<div class="champion-leader">
    <span class="champion-rank">${index + 1}</span>
    <span class="champion-flag">${flagIcon(item.flag)}</span>
    <span>${item.team}</span>
    <strong>${item.count} 票</strong>
  </div>`).join('');

  const modelRows = CHAMPIONS.map(item => {
    const meta = modelMeta(item.modelId);
    return `<div class="champion-pick">
      <div class="champion-model"><span class="lb-dot" style="background:${meta.color}"></span>${meta.name}</div>
      <div class="champion-team"><span>${flagIcon(item.flag)}</span><strong>${item.team}</strong></div>
      <div class="champion-reason">${item.reasoning || ''}</div>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="champion-card champion-consensus">
    <div class="champion-title">模型共识</div>
    ${leaderRows}
  </div>
  <div class="champion-card">
    <div class="champion-title">逐模型选择</div>
    <div class="champion-list">${modelRows}</div>
  </div>`;
}

function discussionForMatch(matchId) {
  return DISCUSSIONS.find(item => item.matchId === matchId);
}

function renderChatMessages(messages) {
  return messages.map(message => {
    const meta = modelMeta(message.modelId);
    const side = message.turn % 2 === 0 ? ' is-right' : '';
    return `<div class="chat-message${side}">
      <div class="chat-avatar" style="background:${meta.color}">${escapeHTML((meta.name || '?').slice(0, 1))}</div>
      <div class="chat-bubble">
        <div class="chat-name">${escapeHTML(meta.name)}<span>${escapeHTML(meta.vendor)}</span></div>
        <p>${escapeHTML(message.text)}</p>
      </div>
    </div>`;
  }).join('');
}

function finalMessagesByModel(messages) {
  const finalByModel = {};
  messages.forEach(message => { finalByModel[message.modelId] = message; });
  return Object.values(finalByModel).sort((a, b) => a.turn - b.turn);
}

function renderMatchDiscussion(match) {
  const thread = discussionForMatch(match.id);
  const messages = thread?.messages || [];
  if (!messages.length) {
    return `<div class="match-discussion is-empty">
      <div class="match-discussion-title">圆桌过程</div>
      <div class="chat-empty">
        <strong>这场还没开聊</strong>
        <span>模型输出生成后,会直接出现在这场比赛下方。</span>
      </div>
    </div>`;
  }

  const finalCount = finalMessagesByModel(messages).length;
  const status = thread?.sealedAt
    ? `封盘 ${new Date(thread.sealedAt).toLocaleString('zh-CN', { timeZone: ASIA_SHANGHAI, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    : '已生成';

  return `<div class="match-discussion">
    <div class="match-discussion-head">
      <div>
        <div class="match-discussion-title">圆桌过程</div>
        <span>上方模型预测来自各模型最后结论 · ${status}</span>
      </div>
      <strong>${finalCount} 位模型</strong>
    </div>
    <details class="chat-details">
      <summary>展开 ${messages.length} 条讨论记录</summary>
      <div class="chat-window match-chat">${renderChatMessages(messages)}</div>
    </details>
  </div>`;
}

function renderDiscussions() {
  const el = document.getElementById('discussion-feed');
  if (!el) return;
  const selectedMatches = matchesForSelectedDate();
  if (!selectedMatches.length) {
    el.innerHTML = `<div class="empty-state">
      <strong>${dateLabel(selectedDateKey)}暂无群聊</strong>
      <span>没有比赛的日期不会生成模型讨论。</span>
    </div>`;
    return;
  }

  const blocks = selectedMatches.map(match => {
    const thread = discussionForMatch(match.id);
    const messages = thread?.messages || [];
    const title = `${match.home.team} vs ${match.away.team}`;
    const status = thread?.sealedAt
      ? `已封盘 · ${new Date(thread.sealedAt).toLocaleString('zh-CN', { timeZone: ASIA_SHANGHAI })}`
      : '讨论待生成';
    const body = messages.length ? renderChatMessages(messages) : `<div class="chat-empty">
      <strong>这场还没开聊</strong>
      <span>跑一次 <code>npm run discuss</code> 后,这里会显示模型短评。每个模型默认两句。</span>
    </div>`;

    return `<article class="discussion-card">
      <div class="discussion-head">
        <div>
          <strong>${escapeHTML(title)}</strong>
          <span>${escapeHTML(formatKickoff(match.kickoff))}</span>
        </div>
        <small>${escapeHTML(status)}</small>
      </div>
      <div class="chat-window">${body}</div>
    </article>`;
  }).join('');

  el.innerHTML = blocks;
}

async function init() {
  const models = await loadJSON('data/models.json');
  if (models?.models) models.models.forEach(m => { MODELS[m.id] = m; });

  const matches = await loadJSON('data/matches.json', 'data/sample-matches.json');
  MATCHES = matches?.matches || [];
  selectedDateKey = pickInitialDate();

  const lb = await loadJSON('data/leaderboard.json');
  if (lb) {
    LEADERBOARD = lb;
      const u = document.getElementById('lb-updated');
    if (lb.updatedAt) u.textContent = '更新于 ' + new Date(lb.updatedAt).toLocaleString('zh-CN', { timeZone: ASIA_SHANGHAI });
  }

  const champions = await loadJSON('data/champion-predictions.json');
  CHAMPIONS = champions?.predictions || [];

  const discussions = await loadJSON('data/discussions.json');
  DISCUSSIONS = discussions?.discussions || [];

  renderHeroMetrics();
  renderDateQuick();
  renderLeaderboard();
  renderMatches();
  renderChampionPredictions();
  renderDiscussions();
}

init();
