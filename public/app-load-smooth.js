// 世界杯 AI 擂台 — 前端逻辑
// 纯静态:fetch 本地 JSON,失败时回退到 sample 数据。

let MODELS = {};
let MATCHES = [];
let LEADERBOARD = { rankings: [], open: [] };
let CHAMPIONS = [];
let DISCUSSIONS = [];
let GROUPS = {};
let JINGCAI_SINGLE = { matches: [], sources: [] };
let MATCH_BY_ID = new Map();
let DISCUSSION_BY_MATCH = new Map();
let PREDICTIONS_BY_MATCH = new Map();
let TEAM_FLAG_BY_NAME = new Map();
let LEADERBOARD_ROWS_CACHE = null;
let ROUNDTABLE_THREADS_CACHE = null;
let MODEL_HISTORY_CACHE = new Map();
let hydratedTabs = new Set();
let lazyHydrationToken = 0;
let selectedDateKey = '';
let activeLbTrack = 'result';
let heroRoundtableTimer = null;
let compactMatchesMode = false;
let compactExpandedMatchId = '';
let roastBeerSource = 'majority';
let roastBeerScope = 'all';
const ACTIVE_TRACK = 'open';
const COMPACT_MATCHES_STORAGE_KEY = 'worldcup-ai-arena-compact-matches';
const PUBLIC_SITE_URL = 'https://aiworldcup.github.io/';

// 阵营划分:国产军团 vs 海外军团(用于核心传播钩子)
const DOMESTIC_VENDORS = ['阿里', '通义', '月之暗面', 'Moonshot', '小米', 'MiMo', 'DeepSeek', '智谱', 'MiniMax', '百度', '字节', '腾讯'];
function campOf(meta) {
  const v = String(meta?.vendor || '');
  return DOMESTIC_VENDORS.some(k => v.includes(k)) ? 'domestic' : 'overseas';
}
const ASIA_SHANGHAI = 'Asia/Shanghai';
const DAY_MS = 24 * 60 * 60 * 1000;
const MATCH_SETTLEMENT_GRACE_MS = 150 * 60 * 1000;
const DATA_REFRESH_MS = 60 * 1000;

window.addEventListener('error', event => {
  const el = document.getElementById('matches');
  if (!el) return;
  el.innerHTML = `<div class="empty-state">
    <strong>页面数据加载异常</strong>
    <span>${escapeHTML(event.message || '请刷新重试')}</span>
  </div>`;
});

async function loadJSON(path, fallback, options = {}) {
  const cache = options.cache || 'no-cache';
  try {
    const res = await fetch(path, { cache });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    if (fallback) {
      console.warn(`加载 ${path} 失败,回退到 ${fallback}`);
      try { return await (await fetch(fallback, { cache })).json(); }
      catch (_) { return null; }
    }
    return null;
  }
}

function scheduleIdleWork(callback) {
  if (window.requestIdleCallback) {
    window.requestIdleCallback(callback, { timeout: 900 });
    return;
  }
  window.setTimeout(callback, 80);
}

function resetDerivedCaches() {
  LEADERBOARD_ROWS_CACHE = null;
  ROUNDTABLE_THREADS_CACHE = null;
  MODEL_HISTORY_CACHE = new Map();
}

function discussionPredictionsFromThread(thread) {
  const messages = finalMessagesByModel(thread?.messages || []);
  return messages
    .map(message => ({
      modelId: message.modelId,
      result: resultFromDiscussionText(message.text),
      score: scoreFromDiscussionText(message.text),
      source: 'discussion'
    }))
    .filter(prediction => prediction.result && prediction.score);
}

function rebuildDataIndexes() {
  MATCH_BY_ID = new Map();
  DISCUSSION_BY_MATCH = new Map();
  PREDICTIONS_BY_MATCH = new Map();
  TEAM_FLAG_BY_NAME = new Map();

  MATCHES.forEach(match => {
    MATCH_BY_ID.set(match.id, match);
    if (match.home?.team) TEAM_FLAG_BY_NAME.set(match.home.team, flagIcon(match.home.flag || (match.placeholder ? '🏆' : '')));
    if (match.away?.team) TEAM_FLAG_BY_NAME.set(match.away.team, flagIcon(match.away.flag || (match.placeholder ? '🏆' : '')));
  });

  DISCUSSIONS.forEach(thread => {
    if (thread?.matchId) DISCUSSION_BY_MATCH.set(thread.matchId, thread);
  });

  MATCHES.forEach(match => {
    const trackPredictions = (match.predictions || []).filter(p => !p.track || p.track === ACTIVE_TRACK);
    const predictions = trackPredictions.length
      ? trackPredictions
      : discussionPredictionsFromThread(DISCUSSION_BY_MATCH.get(match.id));
    PREDICTIONS_BY_MATCH.set(match.id, predictions);
  });

  resetDerivedCaches();
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

function matchDateCounts() {
  return MATCHES.reduce((counts, match) => {
    const key = matchDateKey(match);
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
}

function availableDateKeys() {
  const today = beijingDateKey();
  const matchDates = Array.from(new Set(MATCHES.map(matchDateKey).filter(Boolean))).sort();
  return matchDates.length ? matchDates : [today];
}

function dateHasOpenMatch(dateKey, now = new Date()) {
  const cutoff = now.getTime() - MATCH_SETTLEMENT_GRACE_MS;
  return MATCHES
    .filter(match => matchDateKey(match) === dateKey)
    .some(match => {
      if (match.actual) return false;
      const kickoff = new Date(match.kickoff).getTime();
      return Number.isFinite(kickoff) ? kickoff >= cutoff : true;
    });
}

function matchesForSelectedDate() {
  return MATCHES.filter(match => matchDateKey(match) === selectedDateKey);
}

function restoreMatchViewPreference() {
  try {
    compactMatchesMode = localStorage.getItem(COMPACT_MATCHES_STORAGE_KEY) === '1';
  } catch (_) {
    compactMatchesMode = false;
  }
}

function pickInitialDate(now = new Date()) {
  const today = beijingDateKey(now);
  const keys = availableDateKeys();
  if (keys.includes(today) && dateHasOpenMatch(today, now)) return today;
  const upcoming = keys.find(key => key > today);
  if (upcoming) return upcoming;
  const recent = [...keys].reverse().find(key => key <= today);
  return recent || keys[keys.length - 1] || today;
}

function renderDateQuick() {
  const el = document.getElementById('date-quick');
  if (!el) return;
  const keys = availableDateKeys();
  const counts = matchDateCounts();
  if (!keys.includes(selectedDateKey)) selectedDateKey = pickInitialDate();
  el.innerHTML = keys.map(key => {
    const count = counts.get(key) || 0;
    const active = key === selectedDateKey ? ' active' : '';
    const empty = count ? '' : ' empty-date';
    return `<button class="date-btn${active}${empty}" data-date="${key}">
      <span>${dateLabel(key)}</span>
      <small>${dateSubLabel(key)} · ${count ? `${count} 场` : '暂无比赛'}</small>
    </button>`;
  }).join('');
  el.querySelectorAll('.date-btn').forEach(button => {
    button.addEventListener('click', () => {
      selectedDateKey = button.dataset.date;
      compactExpandedMatchId = '';
      renderDateQuick();
      renderMatches();
      renderDiscussions();
      // 补全：切换日期时也触发卡片的渐显动画
      window.requestAnimationFrame(() => {
        initRevealMotion();
      });
    });
  });
  const activeButton = el.querySelector('.date-btn.active');
  if (activeButton) {
    window.requestAnimationFrame(() => {
      const targetLeft = activeButton.offsetLeft - (el.clientWidth - activeButton.clientWidth) / 2;
      el.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
    });
  }
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
      <span>排行榜口径</span><strong>命中率</strong>
    </div>`;
  }

  renderCampBattle(rows.resultRows);

  if (!rows.resultRows.length && !rows.scoreRows.length) {
    el.innerHTML = '<div class="empty">暂无模型数据</div>';
    return;
  }

  el.innerHTML = activeLbTrack === 'score'
    ? renderLeaderboardBlock('比分榜', '具体比分命中数', rows.scoreRows, 'score')
    : renderLeaderboardBlock('赛果榜', '胜平负命中率', rows.resultRows, 'result');

  wireLeaderboardHistory();
}

// 国产军团 vs 海外军团:把"哪个阵营更会算球"做成可截图的对战条
function renderCampBattle(resultRows) {
  const el = document.getElementById('camp-battle');
  if (!el) return;
  const camps = { domestic: { hits: 0, preds: 0, n: 0 }, overseas: { hits: 0, preds: 0, n: 0 } };
  resultRows.forEach(row => {
    const c = camps[campOf(row)];
    c.hits += row.resultHits;
    c.preds += row.predictions;
    c.n += 1;
  });
  const dRate = camps.domestic.preds ? camps.domestic.hits / camps.domestic.preds : 0;
  const oRate = camps.overseas.preds ? camps.overseas.hits / camps.overseas.preds : 0;
  const settled = camps.domestic.preds + camps.overseas.preds;

  if (!settled) {
    el.innerHTML = `<div class="camp-head">🇨🇳 国产军团 <span>VS</span> 🌍 海外军团</div>
      <div class="camp-waiting">开赛结算后,这里实时比拼两大阵营的赛果命中率 —— 看国产 AI 能不能赢。</div>
      <div class="camp-roster">
        <span>国产 ${camps.domestic.n} 个模型</span>
        <span>海外 ${camps.overseas.n} 个模型</span>
      </div>`;
    return;
  }

  const dPct = Math.round(dRate * 100);
  const oPct = Math.round(oRate * 100);
  const total = dRate + oRate || 1;
  const dWidth = Math.round((dRate / total) * 100);
  const leader = dRate === oRate ? '平分秋色' : dRate > oRate ? '国产军团领先 🔥' : '海外军团领先';

  el.innerHTML = `<div class="camp-head">🇨🇳 国产军团 <span>VS</span> 🌍 海外军团</div>
    <div class="camp-scoreline">
      <div class="camp-side camp-domestic">
        <strong>${dPct}%</strong>
        <small>${camps.domestic.hits}/${camps.domestic.preds} 命中 · ${camps.domestic.n} 个模型</small>
      </div>
      <div class="camp-verdict">${leader}</div>
      <div class="camp-side camp-overseas">
        <strong>${oPct}%</strong>
        <small>${camps.overseas.hits}/${camps.overseas.preds} 命中 · ${camps.overseas.n} 个模型</small>
      </div>
    </div>
    <div class="camp-bar"><span class="camp-bar-d" style="width:${dWidth}%"></span><span class="camp-bar-o" style="width:${100 - dWidth}%"></span></div>`;
}

function renderLeaderboardBlock(title, subtitle, rows, type) {
  const activeRows = rows.filter(row => row.predictions > 0);
  if (!activeRows.length) {
    return `<section class="leaderboard-block">
      <div class="leaderboard-block-head">
        <strong>${title}</strong>
        <span>${subtitle}</span>
      </div>
      <div class="empty-state">
        <strong>${title}赛后更新</strong>
        <span>有真实赛果和封盘预测后,这里会自动生成排名。</span>
      </div>
    </section>`;
  }

  const table = activeRows.map((row, index) => {
    const activeText = row.predictions
      ? `已结算预测 ${row.predictions} 场`
      : row.pending
        ? `${row.pending} 场等待赛果`
        : '等待预测';
    const rankClass = index < 3 ? ` is-top top-${index + 1}` : '';
    return `<button type="button" class="lb-row${rankClass}" data-model="${escapeHTML(row.modelId)}" aria-label="查看 ${escapeHTML(row.name)} 的历史猜测数据">
      <div class="lb-rank">${index + 1}</div>
      <div class="lb-main">
        <div class="lb-name"><span class="lb-dot" style="background:${row.color}"></span>${escapeHTML(row.name)}</div>
        <div class="lb-vendor">${escapeHTML(row.vendor || '')} · ${activeText} · 点开看历史</div>
      </div>
      <div class="lb-stat">
        <span>${type === 'score' ? '比分' : '赛果'}</span>
        <strong>${type === 'score' ? `${row.scoreHits}/${row.predictions || 0}` : `${row.resultHits}/${row.predictions || 0}`}</strong>
      </div>
      <div class="lb-stat">
        <span>${type === 'score' ? '比分率' : '命中率'}</span>
        <strong>${type === 'score' ? formatPercent(row.scoreHits, row.predictions) : formatPercent(row.resultHits, row.predictions)}</strong>
      </div>
      <div class="lb-stat">
        <span>${type === 'score' ? '赛果辅助' : '精确比分'}</span>
        <strong>${type === 'score' ? `${row.resultHits}/${row.predictions || 0}` : row.scoreHits}</strong>
      </div>
      <div class="lb-stat">
        <span>${type === 'score' ? '赛果率' : '比分率'}</span>
        <strong>${type === 'score' ? formatPercent(row.resultHits, row.predictions) : formatPercent(row.scoreHits, row.predictions)}</strong>
      </div>
    </button>`;
  }).join('');

  return `<section class="leaderboard-block">
    <div class="leaderboard-block-head">
      <strong>${title}</strong>
      <span>${subtitle}</span>
    </div>
    <div class="lb-table">${table}</div>
  </section>`;
}

function renderMatches() {
  const el = document.getElementById('matches');
  const section = document.getElementById('matches-section');
  if (!el) return;
  renderMatchSummary();
  section?.classList.toggle('is-compact-match-mode', compactMatchesMode);
  const selectedMatches = matchesForSelectedDate();
  if (!selectedMatches.length) {
    el.classList.remove('is-compact-list');
    el.innerHTML = `<div class="empty-state">
      <strong>${dateLabel(selectedDateKey)}暂无比赛</strong>
      <span>预测席位先留空。下一批比赛会在开赛前一天封盘后更新。</span>
    </div>`;
    return;
  }
  el.classList.toggle('is-compact-list', compactMatchesMode);
  el.innerHTML = compactMatchesMode
    ? renderCompactMatchList(selectedMatches)
    : selectedMatches.map(renderMatchCard).join('');
  if (compactMatchesMode) wireCompactMatchList(el);
}

function matchPredictionSummary(match) {
  const displayPredictions = predictionsForMatch(match);
  const issues = discussionIssuesForMatch(match.id);
  const counts = displayPredictions.reduce((acc, prediction) => {
    acc[prediction.result] = (acc[prediction.result] || 0) + 1;
    return acc;
  }, { home: 0, draw: 0, away: 0 });
  const total = displayPredictions.length || 0;
  const scoreCounts = displayPredictions.reduce((acc, prediction) => {
    if (!prediction.score) return acc;
    acc[prediction.score] = (acc[prediction.score] || 0) + 1;
    return acc;
  }, {});
  const hotScore = Object.entries(scoreCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const lean = ['home', 'draw', 'away'].slice().sort((a, b) => counts[b] - counts[a])[0];
  return {
    displayPredictions,
    counts,
    total,
    issues,
    lean,
    leanText: total ? `${RESULT_LABEL[lean]} ${counts[lean]}/${total}` : '暂无预测',
    hotScoreText: hotScore ? `${hotScore[0]} · ${hotScore[1]} 票` : '暂无',
    predictionCountText: total ? `${total} 位模型` : (issues.length ? `${issues.length} 个异常` : '待定'),
  };
}

function renderCompactMatchList(matches) {
  return `<div class="compact-match-list">
    ${matches.map(renderCompactMatchRow).join('')}
  </div>`;
}

function renderCompactMatchRow(match) {
  const summary = matchPredictionSummary(match);
  const lifecycle = matchLifecycle(match);
  const finished = !!match.actual;
  const score = finished ? String(match.actual.score || '').replace('-', ':') : 'VS';
  const expanded = compactExpandedMatchId === match.id;
  const kickoff = formatKickoff(match.kickoff);
  const pct = key => summary.total ? Math.round((summary.counts[key] / summary.total) * 100) : 0;
  const flex = key => summary.total ? (summary.counts[key] || 0.18) : 0;
  const shareHTML = summary.total
    ? `<span class="compact-share is-home" style="flex:${flex('home')}"><b>主</b>${pct('home')}%</span>
        <span class="compact-share is-draw" style="flex:${flex('draw')}"><b>平</b>${pct('draw')}%</span>
        <span class="compact-share is-away" style="flex:${flex('away')}"><b>客</b>${pct('away')}%</span>`
    : '<span class="compact-share is-empty" style="flex:1">暂无预测</span>';
  const homeFlag = flagIcon(match.home.flag || (match.placeholder ? '🏆' : ''));
  const awayFlag = flagIcon(match.away.flag || (match.placeholder ? '🏆' : ''));
  return `<section class="compact-match-item ${expanded ? 'is-expanded' : ''}">
    <button type="button" class="compact-match-toggle" data-match="${escapeHTML(match.id)}" aria-expanded="${expanded ? 'true' : 'false'}">
      <div class="compact-match-main">
        <div class="compact-teams">
          <span>${homeFlag} ${escapeHTML(match.home.team)}</span>
          <b>${escapeHTML(score)}</b>
          <span>${escapeHTML(match.away.team)} ${awayFlag}</span>
        </div>
        <span class="match-status status-${lifecycle.tone}">${escapeHTML(lifecycle.label)}</span>
      </div>
      <div class="compact-pred-row" aria-label="模型预测比例">
        ${shareHTML}
      </div>
      <div class="compact-match-foot">
        <span class="compact-match-time">${escapeHTML(kickoff)}</span>
        <span>热门比分 <strong>${escapeHTML(summary.hotScoreText)}</strong></span>
        <span>${summary.issues.length ? `<b class="compact-issue">API超时 ${summary.issues.length}</b> · ` : ''}${summary.predictionCountText} · ${expanded ? '收起详情' : '查看详情'}</span>
      </div>
    </button>
    ${expanded ? `<div class="compact-match-detail">${renderMatchCard(match)}</div>` : ''}
  </section>`;
}

function wireCompactMatchList(root) {
  root.querySelectorAll('.compact-match-toggle').forEach(button => {
    button.addEventListener('click', () => {
      compactExpandedMatchId = compactExpandedMatchId === button.dataset.match ? '' : button.dataset.match;
      renderMatches();
      window.requestAnimationFrame(() => {
        initRevealMotion();
        const expanded = compactExpandedMatchId ? document.querySelector(`.compact-match-item.is-expanded`) : null;
        if (expanded) expanded.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      });
    });
  });
}

function roastBeerFixtureLabel(match) {
  return `${flagIcon(match.home.flag)} ${match.home.team} VS ${match.away.team} ${flagIcon(match.away.flag)}`;
}

function jingcaiSingleEntries() {
  return Array.isArray(JINGCAI_SINGLE?.matches) ? JINGCAI_SINGLE.matches : [];
}

function isSameJingcaiTeamPair(match, entry) {
  const home = String(entry.homeTeam || entry.home || '').trim();
  const away = String(entry.awayTeam || entry.away || '').trim();
  if (!home || !away) return false;
  return home === match.home.team && away === match.away.team;
}

function isJingcaiSingleMatch(match) {
  return jingcaiSingleEntries().some(entry => {
    if (entry.matchId && entry.matchId === match.id) return true;
    if (entry.sourceFixtureId && String(entry.sourceFixtureId) === String(match.sourceFixtureId || '')) return true;
    if (!isSameJingcaiTeamPair(match, entry)) return false;
    if (!entry.kickoff) return true;
    return Math.abs(new Date(entry.kickoff).getTime() - new Date(match.kickoff).getTime()) < 90 * 60 * 1000;
  });
}

function jingcaiEntriesForDate(dateKey = selectedDateKey) {
  const selectedIds = new Set(MATCHES.filter(match => matchDateKey(match) === dateKey).map(match => match.id));
  return jingcaiSingleEntries().filter(entry => {
    if (entry.matchDate === dateKey) return true;
    if (entry.matchId && selectedIds.has(entry.matchId)) return true;
    if (entry.kickoff && beijingDateKey(entry.kickoff) === dateKey) return true;
    return false;
  });
}

function jingcaiSingleMatchesForSelectedDate() {
  return matchesForSelectedDate().filter(isJingcaiSingleMatch);
}

function roastBeerScopeMatches() {
  const selected = matchesForSelectedDate().filter(match => predictionsForMatch(match).length);
  if (roastBeerScope === 'jingcai') return selected.filter(isJingcaiSingleMatch);
  return selected;
}

function roastBeerScopeLabel() {
  return roastBeerScope === 'jingcai' ? '竞彩单关' : '当前日期全部比赛';
}

function roastBeerSourceNote() {
  if (roastBeerScope !== 'jingcai') {
    const count = matchesForSelectedDate().length;
    return `${dateLabel(selectedDateKey)}全部 ${count} 场比赛。`;
  }
  const source = JINGCAI_SINGLE?.sources?.[0];
  const verifiedAt = JINGCAI_SINGLE?.updatedAt ? `核对时间 ${new Date(JINGCAI_SINGLE.updatedAt).toLocaleString('zh-CN', { timeZone: ASIA_SHANGHAI })}` : '核对时间待补';
  const verifiedCount = jingcaiSingleMatchesForSelectedDate().length || jingcaiEntriesForDate().length;
  const playableCount = roastBeerScopeMatches().length;
  const unavailableCount = Math.max(0, verifiedCount - playableCount);
  const availabilityText = verifiedCount
    ? `${dateLabel(selectedDateKey)}官方单关 ${verifiedCount} 场,可生成 ${playableCount} 场${unavailableCount ? `,${unavailableCount} 场暂无模型预测` : ''}。`
    : `${dateLabel(selectedDateKey)}官方单关 0 场。`;
  return `竞彩单关以中国竞彩网“仅显示胜平负单固场次”口径核对。${availabilityText}${verifiedAt}${source?.href ? ` · ${source.href}` : ''}`;
}

function roastBeerSplitText(counts, total) {
  if (!total) return '暂无票型';
  return `${RESULT_SHORT.home}${counts.home || 0}/${total} · ${RESULT_SHORT.draw}${counts.draw || 0}/${total} · ${RESULT_SHORT.away}${counts.away || 0}/${total}`;
}

function roastBeerModelFlavor(modelId, meta) {
  const flavors = {
    'claude-fable-5': 'Fable 这票像赛前写好寓言:看着温柔,落点挺狠。',
    'claude-opus-4-8': 'Opus 属于西装革履拍桌派,嘴上克制,选项一点不手软。',
    'gpt-5-5': 'GPT-5.5 走工整路线,像把战术板擦了三遍才肯下结论。',
    'gemini-3-1': 'Gemini 这次开了全球视角,连天气和节奏都要一起盘。',
    'qwen-3-7-max': 'Qwen 这票像国产算盘打出来的,不花哨,但很敢落子。',
    'minimax-m3': 'MiniMax 讲话短,下手快,有点像替补席突然冲出来补一脚。',
    'kimi-k2-6': 'Kimi 这波是夜读派,资料翻到最后一页才给你一句狠的。',
    'mimo-v2-5-pro': 'MiMo 这票带点工程师味,参数调完,啤酒开盖。',
    'grok-4-3': 'Grok 反骨值拉满,别人还在算概率,它已经开始挑衅比分了。',
    'muse-spark': 'Muse Spark 像艺术生看球,讲究灵感,但比分也敢写死。',
    'claude-sonnet-4-6': 'Sonnet 这票有诗意,但诗写到最后还是要落在比分上。',
    'deepseek-v4pro': 'DeepSeek 这波往深水区扎,看起来冷静,其实刀挺快。',
    'glm-5-1': 'GLM 像理科生押题,步骤清楚,答案直接交卷。',
    'doubao-seed-2-0-pro': '豆包这票短平快,不讲废话,直接把锅端上桌。'
  };
  return flavors[modelId] || (campOf(meta) === 'domestic'
    ? `${meta.name} 这票有国产军团的硬气,不绕弯,直接亮牌。`
    : `${meta.name} 这票带海外军团的视角,看着松弛,其实很会拿捏节奏。`);
}

function buildRoastBeerText(payload) {
  const disclaimer = '只负责烤啤,不负责上头;赛后回来挖坟。';
  const siteLink = '围观AI世界杯擂台: https://aiworldcup.github.io/';
  const lines = payload.entries.map((entry, index) =>
    `${index + 1}. ${entry.fixture}: ${entry.result} / ${entry.score}${entry.extra ? `（${entry.extra}）` : ''}`
  ).join('\n');
  if (payload.source === 'majority') {
    return `【世界杯AI烤啤｜${payload.scopeLabel}】
${payload.scopeMeta}
AI 模型共识先拍桌:
${lines}
人多不一定是真理,但吵架时声音确实最大。
${disclaimer}
${siteLink}`;
  }
  return `【世界杯AI烤啤｜${payload.scopeLabel}】
${payload.scopeMeta}
我这张跟 ${payload.modelName}:
${lines}
${payload.flavor}
${disclaimer}
${siteLink}`;
}

function roastBeerMajorityEntry(match) {
  const summary = matchPredictionSummary(match);
  if (!summary.total) return null;
  const result = RESULT_LABEL[summary.lean] || summary.lean || '待定';
  const score = summary.hotScoreText.split(' · ')[0] || '待定';
  return {
    match,
    fixture: roastBeerFixtureLabel(match),
    kickoff: formatKickoff(match.kickoff),
    result,
    score,
    extra: `${roastBeerSplitText(summary.counts, summary.total)} · 热门 ${summary.hotScoreText}`
  };
}

function roastBeerModelEntry(match, modelId) {
  const prediction = predictionsForMatch(match).find(item => item.modelId === modelId);
  if (!prediction) return null;
  return {
    match,
    fixture: roastBeerFixtureLabel(match),
    kickoff: formatKickoff(match.kickoff),
    result: RESULT_LABEL[prediction.result] || prediction.result || '待定',
    score: prediction.score || '待定',
    extra: formatKickoff(match.kickoff)
  };
}

function roastBeerPayload(matches, source, modelId) {
  const sourceMatches = matches || [];
  if (!sourceMatches.length) return null;
  if (source === 'model') {
    const fallbackPrediction = sourceMatches.flatMap(match => predictionsForMatch(match))[0];
    if (!modelId && fallbackPrediction) modelId = fallbackPrediction.modelId;
    const entries = sourceMatches.map(match => roastBeerModelEntry(match, modelId)).filter(Boolean);
    if (!entries.length) return null;
    const meta = modelMeta(modelId);
    const payload = {
      source: 'model',
      scopeLabel: roastBeerScopeLabel(),
      scopeMeta: `${dateLabel(selectedDateKey)} · ${entries.length} 场`,
      modelName: meta.name,
      modelVendor: meta.vendor || '参赛模型',
      flavor: roastBeerModelFlavor(modelId, meta),
      entries
    };
    return { ...payload, text: buildRoastBeerText(payload) };
  }
  const entries = sourceMatches.map(roastBeerMajorityEntry).filter(Boolean);
  if (!entries.length) return null;
  const payload = {
    source: 'majority',
    scopeLabel: roastBeerScopeLabel(),
    scopeMeta: `${dateLabel(selectedDateKey)} · ${entries.length} 场`,
    modelCount: `${entries.length} 场比赛`,
    entries
  };
  return { ...payload, text: buildRoastBeerText(payload) };
}

function renderRoastBeerResult(payload) {
  if (!payload) {
    const source = JINGCAI_SINGLE?.sources?.[0];
    let emptyText = '当前范围没有可用模型预测。';
    if (roastBeerScope === 'jingcai') {
      const verifiedCount = jingcaiSingleMatchesForSelectedDate().length || jingcaiEntriesForDate().length;
      emptyText = verifiedCount
        ? `当前日期核对到 ${verifiedCount} 场竞彩单关,但暂无可用模型预测。核对口径:中国竞彩网“仅显示胜平负单固场次”。${source?.href ? ` 来源:${source.href}` : ''}`
        : `当前日期未核对到竞彩单关比赛。核对口径:中国竞彩网“仅显示胜平负单固场次”。${source?.href ? ` 来源:${source.href}` : ''}`;
    }
    return `<div class="empty-state">
      <strong>当前范围还没法烤</strong>
      <span>${escapeHTML(emptyText)}</span>
    </div>`;
  }
  const sourceText = payload.source === 'majority'
    ? `模型共识 · ${payload.modelCount}`
    : `${payload.modelName} · ${payload.modelVendor}`;
  const pickRows = payload.entries.map(entry => `<div class="roast-pick-row">
    <span>${escapeHTML(entry.fixture)}</span>
    <strong>${escapeHTML(entry.result)} / ${escapeHTML(entry.score)}</strong>
  </div>`).join('');
  return `<h3>${escapeHTML(payload.scopeLabel)}</h3>
    <div class="roast-result-grid">
      <div class="roast-result-box"><span>来源</span><strong>${escapeHTML(sourceText)}</strong></div>
      <div class="roast-result-box"><span>范围</span><strong>${escapeHTML(payload.scopeMeta)}</strong></div>
    </div>
    <div class="roast-pick-list">${pickRows}</div>`;
}

function sortModelIdsByResultRank(modelIds) {
  const rankRows = buildLeaderboardRows().resultRows || [];
  const rankMap = new Map(rankRows.map((row, index) => [row.modelId, { index, row }]));
  return modelIds.slice().sort((a, b) => {
    const rankA = rankMap.get(a);
    const rankB = rankMap.get(b);
    if (rankA && rankB) return rankA.index - rankB.index;
    if (rankA) return -1;
    if (rankB) return 1;
    return modelMeta(a).name.localeCompare(modelMeta(b).name, 'zh-CN');
  });
}

function updateRoastBeerModelOptions(matches, preferredModelId = '') {
  const modelSelect = document.getElementById('roast-model-select');
  const modelField = document.getElementById('roast-model-field');
  if (!modelSelect || !modelField) return;
  const predictions = (matches || []).flatMap(match => predictionsForMatch(match));
  const modelIds = sortModelIdsByResultRank(Array.from(new Set(predictions.map(prediction => prediction.modelId))));
  const currentModelId = preferredModelId || modelSelect.value;
  modelSelect.innerHTML = modelIds.length ? modelIds.map(modelId => {
    const meta = modelMeta(modelId);
    const count = (matches || []).filter(match => predictionsForMatch(match).some(prediction => prediction.modelId === modelId)).length;
    const label = `${meta.name} · 覆盖 ${count} 场`;
    return `<option value="${escapeHTML(modelId)}">${escapeHTML(label)}</option>`;
  }).join('') : '<option value="">暂无模型预测</option>';
  if (currentModelId && modelIds.includes(currentModelId)) {
    modelSelect.value = currentModelId;
  }
  modelSelect.disabled = !modelIds.length;
  modelField.hidden = roastBeerSource !== 'model';
}

function updateRoastBeerPreview() {
  const matches = roastBeerScopeMatches();
  const preferredModelId = document.getElementById('roast-model-select')?.value || '';
  updateRoastBeerModelOptions(matches, preferredModelId);
  const modelId = document.getElementById('roast-model-select')?.value || '';
  const payload = roastBeerPayload(matches, roastBeerSource, modelId);
  const result = document.getElementById('roast-result');
  const text = document.getElementById('roast-copy-text');
  const status = document.getElementById('roast-copy-status');
  const note = document.getElementById('roast-scope-note');
  if (result) result.innerHTML = renderRoastBeerResult(payload);
  if (text) text.value = payload?.text || '当前没有可复制的烤啤文案。';
  if (note) note.textContent = roastBeerSourceNote();
  if (status) status.textContent = '';
}

function setRoastBeerScope(scope) {
  roastBeerScope = scope === 'jingcai' ? 'jingcai' : 'all';
  document.querySelectorAll('.roast-scope-tabs button').forEach(button => {
    button.classList.toggle('is-active', button.dataset.scope === roastBeerScope);
  });
  updateRoastBeerPreview();
}

function setRoastBeerSource(source) {
  roastBeerSource = source === 'model' ? 'model' : 'majority';
  document.querySelectorAll('.roast-source-tabs button').forEach(button => {
    button.classList.toggle('is-active', button.dataset.source === roastBeerSource);
  });
  updateRoastBeerPreview();
}

function openRoastBeerStage() {
  const stage = document.getElementById('roast-beer-stage');
  if (!stage) return;
  setRoastBeerScope('all');
  setRoastBeerSource('majority');
  updateRoastBeerPreview();
  stage.classList.add('is-open');
  stage.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeRoastBeerStage() {
  const stage = document.getElementById('roast-beer-stage');
  if (!stage) return;
  stage.classList.remove('is-open');
  stage.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

async function copyRoastBeerText() {
  const textEl = document.getElementById('roast-copy-text');
  const status = document.getElementById('roast-copy-status');
  const text = textEl?.value || '';
  if (!text || text === '当前没有可复制的烤啤文案。') {
    if (status) status.textContent = '还没有可复制的内容。';
    return;
  }
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    if (status) status.textContent = '已复制,去别处开烤吧。';
  } catch (_) {
    const temp = document.createElement('textarea');
    temp.value = text;
    temp.setAttribute('readonly', '');
    temp.style.position = 'fixed';
    temp.style.left = '-9999px';
    temp.style.top = '0';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();
    temp.setSelectionRange(0, temp.value.length);
    let ok = false;
    try {
      ok = !!document.execCommand?.('copy');
    } catch (e) {
      ok = false;
    }
    temp.remove();
    if (!ok) {
      textEl?.focus();
      textEl?.select();
    }
    if (status) status.textContent = ok ? '已复制,去别处开烤吧。' : '已选中文案,可以手动复制。';
  }
}

function teamFlag(team) {
  return TEAM_FLAG_BY_NAME.get(team) || '';
}

function isGroupMatch(match) {
  return String(match.stage || '').includes('Group Stage');
}

function parseScore(score) {
  const [home, away] = String(score || '').split('-').map(Number);
  return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
}

function standingsForGroup(teams) {
  const rows = teams.map(team => ({
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
  const byTeam = new Map(rows.map(row => [row.team, row]));
  MATCHES
    .filter(match => isGroupMatch(match) && match.actual && teams.includes(match.home.team) && teams.includes(match.away.team))
    .forEach(match => {
      const score = parseScore(match.actual.score);
      if (!score) return;
      const home = byTeam.get(match.home.team);
      const away = byTeam.get(match.away.team);
      home.played += 1; away.played += 1;
      home.gf += score.home; home.ga += score.away;
      away.gf += score.away; away.ga += score.home;
      if (score.home > score.away) {
        home.win += 1; home.points += 3; away.loss += 1;
      } else if (score.home < score.away) {
        away.win += 1; away.points += 3; home.loss += 1;
      } else {
        home.draw += 1; away.draw += 1; home.points += 1; away.points += 1;
      }
    });
  rows.forEach(row => { row.gd = row.gf - row.ga; });
  return rows.sort((a, b) =>
    b.points - a.points ||
    b.gd - a.gd ||
    b.gf - a.gf ||
    a.team.localeCompare(b.team, 'zh-CN')
  );
}

function renderStandings() {
  const el = document.getElementById('standings');
  if (!el) return;
  const groupEntries = Object.entries(GROUPS || {});
  if (!groupEntries.length) {
    el.innerHTML = `<div class="empty-state">
      <strong>小组数据待确认</strong>
      <span>补齐 groups.json 后,这里会展示实时积分榜。</span>
    </div>`;
    return;
  }
  el.innerHTML = groupEntries.map(([group, teams]) => {
    const rows = standingsForGroup(teams);
    const played = MATCHES.filter(match => isGroupMatch(match) && match.actual && teams.includes(match.home.team) && teams.includes(match.away.team)).length;
    return `<article class="standing-card">
      <div class="standing-head">
        <strong>${group} 组</strong>
        <span>已赛 ${played}/6 场</span>
      </div>
      <div class="standing-table">
        <div class="standing-row standing-row-head">
          <span>#</span><span>球队</span><span>赛</span><span>胜平负</span><span>进/失</span><span>净</span><span>分</span>
        </div>
        ${rows.map((row, index) => `<div class="standing-row ${index < 2 ? 'is-advance' : index === 2 ? 'is-third' : ''}">
          <span>${index + 1}</span>
          <span>${teamFlag(row.team)} ${escapeHTML(row.team)}</span>
          <span>${row.played}</span>
          <span>${row.win}-${row.draw}-${row.loss}</span>
          <span>${row.gf}/${row.ga}</span>
          <span>${row.gd > 0 ? `+${row.gd}` : row.gd}</span>
          <strong>${row.points}</strong>
        </div>`).join('')}
      </div>
    </article>`;
  }).join('');
}

const KNOCKOUT_STAGES = [
  'World Cup · Round of 32',
  'World Cup · Round of 16',
  'World Cup · Quarter-finals',
  'World Cup · Semi-finals',
  'World Cup · Match for third place',
  'World Cup · Final'
];

function stageShortName(stage) {
  return String(stage || '')
    .replace('World Cup · ', '')
    .replace('Round of 32', '32 强')
    .replace('Round of 16', '16 强')
    .replace('Quarter-finals', '8 强')
    .replace('Semi-finals', '半决赛')
    .replace('Match for third place', '三四名')
    .replace('Final', '决赛');
}

function winnerName(match) {
  if (!match.actual) return '';
  if (match.actual.result === 'home') return match.home.team;
  if (match.actual.result === 'away') return match.away.team;
  return '待定';
}

function focusMatch(matchId) {
  const match = MATCH_BY_ID.get(matchId);
  if (!match) return;
  selectedDateKey = matchDateKey(match);
  renderDateQuick();
  renderMatches();
  window.requestAnimationFrame(() => {
    const el = document.getElementById(`match-${matchId}`);
    const offset = (document.getElementById('tabbar')?.offsetHeight || 0) + 10;
    const top = (el || document.getElementById('matches-section')).getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  });
}

function renderBracket() {
  const el = document.getElementById('bracket-section');
  if (!el) return;
  const knockout = MATCHES.filter(match => KNOCKOUT_STAGES.includes(match.stage));
  if (!knockout.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<div class="bracket-head">
    <strong>淘汰赛路径</strong>
    <span>横向滑动查看完整路径</span>
  </div>
  <div class="bracket-track">
    ${KNOCKOUT_STAGES.map(stage => {
      const items = knockout.filter(match => match.stage === stage);
      if (!items.length) return '';
      return `<section class="bracket-round">
        <h3>${stageShortName(stage)}</h3>
        ${items.map(match => {
          const winner = winnerName(match);
          const score = match.actual?.score || '待定';
          return `<button type="button" class="bracket-match ${match.actual ? 'is-settled' : ''}" data-match="${escapeHTML(match.id)}">
            <span class="${winner === match.home.team ? 'is-winner' : ''}">${teamFlag(match.home.team)} ${escapeHTML(match.home.team)}</span>
            <b>${escapeHTML(score)}</b>
            <span class="${winner === match.away.team ? 'is-winner' : ''}">${escapeHTML(match.away.team)} ${teamFlag(match.away.team)}</span>
          </button>`;
        }).join('')}
      </section>`;
    }).join('')}
  </div>`;
  el.querySelectorAll('.bracket-match').forEach(btn => {
    btn.addEventListener('click', () => focusMatch(btn.dataset.match));
  });
}

function resultFromDiscussionText(text) {
  const value = String(text || '');
  const directionPattern = '(主负|主队负|客胜|客队胜|负|主胜|主队胜|胜|平局|打平|闷平|冷平|逼平|平)';
  const marked = value.match(new RegExp(`(?:结论|预测|看好|我站|我押|我买|我信|我赌|倾向|更倾向|最终|收束)[:：]?\\s*[^。！？!?；;]{0,20}?${directionPattern}`));
  if (marked) return resultFromDirectionToken(marked[1]);
  const nearScore = value.match(new RegExp(`${directionPattern}(?![？?])\\s*(?:[,，、:：;；-]\\s*)?(?:比分)?\\s*[0-9０-９一二三四五六七八九零〇]+\\s*[-:：比]\\s*[0-9０-９一二三四五六七八九零〇]+`));
  if (nearScore) return resultFromDirectionToken(nearScore[1]);
  if (/闷平|冷平|逼平|打平|平局/.test(value)) return 'draw';
  if (/主负|主队负|客胜(?![？?])|客队胜/.test(value)) return 'away';
  if (/主胜(?![？?])|主队胜/.test(value)) return 'home';
  return '';
}

function resultFromDirectionToken(token) {
  const value = String(token || '');
  if (/平局|打平|闷平|冷平|逼平|^平$/.test(value)) return 'draw';
  if (/主负|主队负|客胜|客队胜|^负$/.test(value)) return 'away';
  if (/主胜|主队胜|^胜$/.test(value)) return 'home';
  return '';
}

function scoreResultFromScore(score) {
  const match = String(score || '').match(/^(\d+)-(\d+)$/);
  if (!match) return '';
  const home = Number(match[1]);
  const away = Number(match[2]);
  if (home === away) return 'draw';
  return home > away ? 'home' : 'away';
}

function scoreFromDiscussionText(text) {
  const matches = Array.from(String(text || '').matchAll(/[0-9０-９一二三四五六七八九零〇]+\s*[-:：比]\s*[0-9０-９一二三四五六七八九零〇]+/g));
  const match = matches[matches.length - 1];
  if (!match) return '';
  return match[0]
    .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[:：比]/g, '-')
    .replace(/\s+/g, '');
}

function hasDiscussionPrediction(message) {
  return Boolean(resultFromDiscussionText(message?.text) && scoreFromDiscussionText(message?.text));
}

function discussionPredictionsForMatch(matchId) {
  return discussionPredictionsFromThread(discussionForMatch(matchId));
}

function predictionsForMatch(match) {
  if (match?.id && PREDICTIONS_BY_MATCH.has(match.id)) {
    return PREDICTIONS_BY_MATCH.get(match.id);
  }
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
  return { key: 'needs-result', tone: 'needs-result', label: '待赛果结算', detail: '赛果同步后自动进入排行榜' };
}

function buildLeaderboardRows() {
  if (LEADERBOARD_ROWS_CACHE) return LEADERBOARD_ROWS_CACHE;
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
        resultHits: 0,
        scoreHits: 0,
        predictions: 0,
        settledMatches: 0,
        predicted: 0,
        pending: 0
      };
    }
    return rowsByModel[modelId];
  };

  Object.keys(MODELS).forEach(ensure);

  MATCHES.forEach(match => {
    predictionsForMatch(match).forEach(prediction => {
      const row = ensure(prediction.modelId);
      row.predicted += 1;
      if (!match.actual) {
        row.pending += 1;
        return;
      }
      row.predictions += 1;
      row.settledMatches += 1;
      row.resultHits += prediction.result === match.actual.result ? 1 : 0;
      row.scoreHits += prediction.score === match.actual.score ? 1 : 0;
    });
  });

  const mergeResultRows = sourceRows => (sourceRows || []).forEach(source => {
    const row = ensure(source.modelId);
    row.resultHits = Number(source.resultHits ?? source.hits) || 0;
    row.scoreHits = Number(source.scoreHits) || 0;
    row.predictions = Number(source.predictions ?? source.played) || 0;
    row.settledMatches = Number(source.settledMatches) || row.settledMatches;
  });
  const mergeScoreRows = sourceRows => (sourceRows || []).forEach(source => {
    const row = ensure(source.modelId);
    row.scoreHits = Number(source.scoreHits ?? source.hits) || 0;
    row.resultHits = Number(source.resultHits) || row.resultHits;
    row.predictions = Number(source.predictions ?? source.played) || 0;
    row.settledMatches = Number(source.settledMatches) || row.settledMatches;
  });
  mergeResultRows(LEADERBOARD.resultRankings || LEADERBOARD.rankings || LEADERBOARD.open);
  mergeScoreRows(LEADERBOARD.scoreRankings);

  const rows = Object.values(rowsByModel)
    .filter(row => row.enabled)
    .map(row => ({
      ...row,
      resultHitRate: row.predictions ? row.resultHits / row.predictions : null,
      scoreHitRate: row.predictions ? row.scoreHits / row.predictions : null
    }));

  LEADERBOARD_ROWS_CACHE = {
    resultRows: rows.slice().sort((a, b) =>
      (b.resultHitRate || 0) - (a.resultHitRate || 0) ||
      b.resultHits - a.resultHits ||
      b.predictions - a.predictions ||
      b.scoreHits - a.scoreHits ||
      a.name.localeCompare(b.name, 'zh-CN')
    ),
    scoreRows: rows.slice().sort((a, b) =>
      b.scoreHits - a.scoreHits ||
      (b.scoreHitRate || 0) - (a.scoreHitRate || 0) ||
      b.resultHits - a.resultHits ||
      b.predictions - a.predictions ||
      a.name.localeCompare(b.name, 'zh-CN')
    )
  };
  return LEADERBOARD_ROWS_CACHE;
}

function modelHistory(modelId) {
  if (MODEL_HISTORY_CACHE.has(modelId)) return MODEL_HISTORY_CACHE.get(modelId);
  const rows = MATCHES
    .map(match => {
      const prediction = predictionsForMatch(match).find(item => item.modelId === modelId);
      if (!prediction) return null;
      const actual = match.actual || null;
      const resultHit = !!actual && prediction.result === actual.result;
      const scoreHit = !!actual && prediction.score === actual.score;
      return {
        match,
        prediction,
        actual,
        resultHit,
        scoreHit,
        settled: !!actual,
        kickoffTime: new Date(match.kickoff || 0).getTime() || 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.kickoffTime - a.kickoffTime);
  MODEL_HISTORY_CACHE.set(modelId, rows);
  return rows;
}

function modelRoundtableMessages(matchId, modelId) {
  const thread = discussionForMatch(matchId);
  if (!thread || !Array.isArray(thread.messages)) return [];
  return thread.messages
    .filter(message => message.modelId === modelId && message.text)
    .sort((a, b) => {
      const turnDelta = Number(a.turn || 0) - Number(b.turn || 0);
      if (turnDelta) return turnDelta;
      return new Date(a.timestamp || 0) - new Date(b.timestamp || 0);
    });
}

function hitBadge(label, hit) {
  return `<span class="history-badge ${hit ? 'is-hit' : 'is-miss'}">${hit ? '✓' : '✗'} ${label}</span>`;
}

function openModelHistory(modelId) {
  const meta = modelMeta(modelId);
  const rows = modelHistory(modelId);
  const settled = rows.filter(row => row.settled);
  const resultHits = settled.filter(row => row.resultHit).length;
  const scoreHits = settled.filter(row => row.scoreHit).length;
  const pending = rows.length - settled.length;
  const stage = document.getElementById('model-history-stage');
  const title = document.getElementById('model-history-title');
  const subtitle = document.getElementById('model-history-subtitle');
  const summary = document.getElementById('model-history-summary');
  const list = document.getElementById('model-history-list');
  if (!stage || !title || !subtitle || !summary || !list) return;

  title.innerHTML = `<span class="lb-dot" style="background:${meta.color}"></span>${escapeHTML(meta.name)}`;
  subtitle.textContent = `${meta.vendor || '参赛模型'} · 历史猜测数据`;
  summary.innerHTML = `<div class="history-metric">
      <span>参与比赛</span><strong>${rows.length}</strong>
    </div>
    <div class="history-metric">
      <span>赛果命中</span><strong>${resultHits}/${settled.length || 0}</strong>
    </div>
    <div class="history-metric">
      <span>比分命中</span><strong>${scoreHits}/${settled.length || 0}</strong>
    </div>
    <div class="history-metric">
      <span>待结算</span><strong>${pending}</strong>
    </div>`;

  list.innerHTML = rows.length ? rows.map(({ match, prediction, actual, resultHit, scoreHit, settled }) => {
    const actualText = actual
      ? `${RESULT_LABEL[actual.result] || actual.result} · ${actual.score}`
      : '等待真实赛果';
    const badges = settled
      ? `${hitBadge('赛果', resultHit)}${hitBadge('比分', scoreHit)}`
      : '<span class="history-badge is-pending">待结算</span>';
    const roundtableMessages = modelRoundtableMessages(match.id, modelId);
    const roundtableId = `history-rt-${match.id}-${modelId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    const roundtableButtonHtml = roundtableMessages.length ? `<div class="history-roundtable" data-loaded="false">
        <button type="button" class="history-roundtable-toggle" data-match="${escapeHTML(match.id)}" data-model="${escapeHTML(modelId)}" data-target="${escapeHTML(roundtableId)}" aria-expanded="false" aria-controls="${escapeHTML(roundtableId)}">
          查看圆桌发言（${roundtableMessages.length}）
          <span>展开</span>
        </button>
      </div>` : '';
    const roundtableLinesHtml = roundtableMessages.length
      ? `<div id="${escapeHTML(roundtableId)}" class="history-roundtable-lines" hidden></div>`
      : '';
    return `<article class="history-item">
      <div class="history-match">
        <span>${flagIcon(match.home.flag)} ${escapeHTML(match.home.team)}</span>
        <strong>VS</strong>
        <span>${escapeHTML(match.away.team)} ${flagIcon(match.away.flag)}</span>
      </div>
      <div class="history-meta">
        <span>${escapeHTML(match.stage || '世界杯')}</span>
        <span>${escapeHTML(formatKickoff(match.kickoff))}</span>
      </div>
      <div class="history-picks">
        <div>
          <span>模型预测</span>
          <strong>${escapeHTML(RESULT_LABEL[prediction.result] || prediction.result)} · ${escapeHTML(prediction.score || '-')}</strong>
        </div>
        <div>
          <span>真实赛果</span>
          <strong>${escapeHTML(actualText)}</strong>
        </div>
      </div>
      <div class="history-status-row">
        <div class="history-badges">${badges}</div>
        ${roundtableButtonHtml}
      </div>
      ${roundtableLinesHtml}
    </article>`;
  }).join('') : `<div class="empty-state">
    <strong>暂无历史猜测</strong>
    <span>这个模型还没有参与过已记录的比赛预测。</span>
  </div>`;

  stage.classList.add('is-open');
  stage.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModelHistory() {
  const stage = document.getElementById('model-history-stage');
  if (!stage) return;
  stage.classList.remove('is-open');
  stage.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function wireLeaderboardHistory() {
  document.querySelectorAll('.lb-row[data-model]').forEach(row => {
    row.addEventListener('click', () => openModelHistory(row.dataset.model));
  });
}

function renderHeroTicker() {
  const el = document.getElementById('hero-ticker');
  if (!el) return;
  const rows = buildLeaderboardRows();
  const resultLeader = rows.resultRows.find(row => row.predictions > 0);
  const scoreLeader = rows.scoreRows.find(row => row.predictions > 0 && row.scoreHits > 0);
  const settled = MATCHES.filter(match => match.actual).length;
  const hot = roundtableThreads().map(({ thread }) => hottestLine(thread.messages || [])).filter(Boolean)[0];
  const items = [
    resultLeader ? `${resultLeader.name} 赛果命中 ${resultLeader.resultHits}/${resultLeader.predictions}` : '',
    scoreLeader ? `${scoreLeader.name} 精确比分命中 ${scoreLeader.scoreHits} 次` : '',
    settled ? `已结算 ${settled} 场,榜单实时刷新` : '',
    hot ? `热评: ${hot.text}` : '',
    '国产军团 vs 海外军团,每场封盘后见真章'
  ].filter(Boolean);
  const content = items.concat(items).map(item => `<span>${escapeHTML(item)}</span>`).join('');
  el.innerHTML = `<div class="hero-ticker-track">${content}</div>`;
}

function roundtableThreads() {
  if (ROUNDTABLE_THREADS_CACHE) return ROUNDTABLE_THREADS_CACHE;
  ROUNDTABLE_THREADS_CACHE = DISCUSSIONS
    .map(thread => ({ thread, match: MATCH_BY_ID.get(thread.matchId) }))
    .filter(item => item.match && (item.thread.messages || []).length)
    .sort((a, b) => {
      const aState = matchLifecycle(a.match).key;
      const bState = matchLifecycle(b.match).key;
      const stateScore = state => {
        if (state === 'upcoming' || state === 'sealed') return 0;
        if (state === 'live' || state === 'needs-result') return 1;
        return 2;
      };
      const delta = stateScore(aState) - stateScore(bState);
      if (delta) return delta;
      return new Date(a.match.kickoff) - new Date(b.match.kickoff);
    });
  return ROUNDTABLE_THREADS_CACHE;
}

function renderHeroRoundtable() {
  const el = document.getElementById('hero-roundtable');
  if (!el) return;
  if (heroRoundtableTimer) clearInterval(heroRoundtableTimer);

  const threads = roundtableThreads();
  const featured = threads.filter(({ match }) => {
    const key = matchLifecycle(match).key;
    return key === 'upcoming' || key === 'sealed' || key === 'live' || key === 'needs-result';
  });
  const cards = (featured.length ? featured : threads).slice(0, 6).map(({ thread, match }, index) => {
    const messages = thread.messages || [];
    const hot = heroHottestLine(messages, index);
    const meta = hot ? modelMeta(hot.modelId) : null;
    const camp = meta ? campOf(meta) : '';
    const state = matchLifecycle(match);
    return `<article class="hero-rt-card" data-match="${escapeHTML(match.id)}" role="button" tabindex="0">
      <div class="hero-rt-kicker">
        <span>最毒一句</span>
        <strong class="match-status status-${state.tone}">${escapeHTML(state.label)}</strong>
      </div>
      <div class="hero-rt-fixture">
        <span>${flagIcon(match.home.flag)} ${escapeHTML(match.home.team)}</span>
        <b>VS</b>
        <span>${escapeHTML(match.away.team)} ${flagIcon(match.away.flag)}</span>
      </div>
      ${hot ? `<blockquote>${escapeHTML(hot.text)}</blockquote>
        <div class="hero-rt-speaker">
          <i style="background:${meta.color}">${escapeHTML((meta.name || '?').slice(0, 1))}</i>
          <span>${escapeHTML(meta.name)} · ${camp === 'domestic' ? '🇨🇳 国产军团' : '🌍 海外军团'}</span>
        </div>` : ''}
      <button type="button" class="hero-rt-play">看回放</button>
    </article>`;
  });

  if (!cards.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }

  el.hidden = false;
  el.innerHTML = `<div class="hero-rt-inner">
    <div class="hero-rt-head">
      <div>
        <strong>AI 圆桌热评</strong>
        <span>短头条,点开看完整回放</span>
      </div>
      <div class="hero-rt-nav" aria-label="切换圆桌热评">
        <button type="button" class="hero-rt-arrow" data-dir="-1" aria-label="上一条">‹</button>
        <button type="button" class="hero-rt-arrow" data-dir="1" aria-label="下一条">›</button>
      </div>
    </div>
    <div class="hero-rt-track">${cards.join('')}</div>
  </div>`;

  const track = el.querySelector('.hero-rt-track');
  const open = card => openDebateStage(card.dataset.match);
  el.querySelectorAll('.hero-rt-card').forEach(card => {
    card.addEventListener('click', () => open(card));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(card); }
    });
  });
  let index = 0;
  const scrollToCard = dir => {
    if (!track) return;
    index = (index + dir + cards.length) % cards.length;
    const card = track.children[index];
    if (card) track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: 'smooth' });
  };
  el.querySelectorAll('.hero-rt-arrow').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      track.dataset.paused = 'true';
      scrollToCard(Number(btn.dataset.dir) || 1);
      window.setTimeout(() => { track.dataset.paused = 'false'; }, 1600);
    });
  });
  if (!track || cards.length < 2) return;

  const autoScrollToCard = () => {
    if (track.dataset.paused === 'true') return;
    scrollToCard(1);
  };
  track.addEventListener('mouseenter', () => { track.dataset.paused = 'true'; });
  track.addEventListener('mouseleave', () => { track.dataset.paused = 'false'; });
  track.addEventListener('touchstart', () => { track.dataset.paused = 'true'; }, { passive: true });
  track.addEventListener('touchend', () => { track.dataset.paused = 'false'; }, { passive: true });
  heroRoundtableTimer = setInterval(autoScrollToCard, 4600);
}

function renderMatchCard(m) {
  const o = m.odds?.result || {};
  const finished = !!m.actual;
  const displayPredictions = predictionsForMatch(m);
  const discussionIssues = discussionIssuesForMatch(m.id);
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
  const predictionCountText = displayPredictions.length
    ? `${displayPredictions.length} 位模型${discussionIssues.length ? ` · ${discussionIssues.length} 个异常` : ''}`
    : (discussionIssues.length ? `${discussionIssues.length} 个异常` : '待定');
  const kickoff = formatKickoff(m.kickoff);
  const homeFlag = flagIcon(m.home.flag || (m.placeholder ? '🏆' : ''));
  const awayFlag = flagIcon(m.away.flag || (m.placeholder ? '🏆' : ''));
  const actualScore = finished ? String(m.actual.score || '').replace('-', ' : ') : '';
  const recap = discussionForMatch(m.id)?.recap;
  const recapHTML = recap?.hookText ? `<div class="recap-hook ${recap.godModels?.length ? 'is-god' : recap.faceSlapModels?.length ? 'is-face' : ''}">
    <strong>${recap.godModels?.length ? '封神' : recap.faceSlapModels?.length ? '打脸' : '赛后复盘'}</strong>
    <span>${escapeHTML(recap.hookText)}</span>
  </div>` : '';

  const predictionRows = displayPredictions
    .map(p => {
      const meta = modelMeta(p.modelId);
      let mark = '';
      let predClass = '';
      if (finished) {
        const rHit = p.result === m.actual.result;
        const sHit = p.score === m.actual.score;
        predClass = sHit ? ' is-score-hit' : rHit ? ' is-result-hit' : ' is-miss';
        mark = `<span class="${rHit ? 'pred-hit' : 'pred-miss'}">${rHit ? '✓胜负' : '✗胜负'}</span>
                <span class="${sHit ? 'pred-target' : 'pred-miss'}">${sHit ? '🎯比分' : '✗比分'}</span>`;
      }
      return `<div class="pred${predClass}">
        <button type="button" class="pred-model" data-model="${escapeHTML(p.modelId)}" aria-label="查看 ${escapeHTML(meta.name)} 的历史预测数据">
          <span class="lb-dot" style="background:${meta.color}"></span>${escapeHTML(meta.name)}
        </button>
        <span class="pred-pick"><b>${RESULT_LABEL[p.result] || p.result}</b> · ${p.score}</span>
        <span>${mark || (p.source === 'discussion' ? '<span class="pred-source">圆桌</span>' : '')}</span>
      </div>`;
    }).join('');
  const issueRows = discussionIssues
    .map(issue => {
      const meta = modelMeta(issue.modelId);
      return `<div class="pred pred-issue">
        <button type="button" class="pred-model" data-model="${escapeHTML(issue.modelId)}" aria-label="查看 ${escapeHTML(meta.name)} 的历史预测数据">
          <span class="lb-dot" style="background:${meta.color}"></span>${escapeHTML(meta.name)}
        </button>
        <span class="pred-pick"><b>${escapeHTML(discussionIssueLabel(issue))}</b></span>
        <span class="pred-issue-text">${escapeHTML(discussionIssueText(issue))}</span>
      </div>`;
    }).join('');
  const preds = `${predictionRows}${issueRows}` || '<div class="empty">暂无预测</div>';

  return `<article class="match" id="match-${escapeHTML(m.id)}">
    <div class="match-head">
      ${recapHTML}
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
          <span>${finished ? escapeHTML(actualScore) : 'VS'}</span>
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
          <span class="info-label">预测模型</span>
          <strong>${predictionCountText}</strong>
        </div>
      </div>
      <div class="lean-bars" aria-hidden="true">
        <span style="width:${counts.home / total * 100}%"></span>
        <span style="width:${counts.draw / total * 100}%"></span>
        <span style="width:${counts.away / total * 100}%"></span>
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
  return DISCUSSION_BY_MATCH.get(matchId);
}

function discussionIssuesForMatch(matchId) {
  const thread = discussionForMatch(matchId);
  return (thread?.issues || []).filter(issue => issue && issue.modelId);
}

function discussionIssueLabel(issue) {
  const status = String(issue.status || '');
  if (status === 'timeout') return 'API 超时';
  if (status === 'invalid_final') return '格式无效';
  if (status === 'missing_key') return '未配置 key';
  if (status === 'empty') return '空返回';
  return '调用失败';
}

function discussionIssueText(issue) {
  const round = issue.round ? `第 ${issue.round} 轮` : '本轮';
  const message = String(issue.message || '').trim();
  const short = /timeout|aborted|超时/i.test(message) ? '补跑后仍超时' : (message || '补跑未完成');
  return `${round} · ${short}`;
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
  messages.forEach(message => {
    if (!message.modelId) return;
    const current = finalByModel[message.modelId];
    if (hasDiscussionPrediction(message) || !hasDiscussionPrediction(current)) {
      finalByModel[message.modelId] = message;
    }
  });
  return Object.values(finalByModel).sort((a, b) => a.turn - b.turn);
}

// 统计这场圆桌每个模型的最终立场分布(主胜/平/客胜)
function stanceBreakdown(messages) {
  const finals = finalMessagesByModel(messages);
  const counts = { home: 0, draw: 0, away: 0 };
  finals.forEach(message => {
    const result = resultFromDiscussionText(message.text);
    if (result) counts[result] += 1;
  });
  return { counts, total: counts.home + counts.draw + counts.away };
}

// 找出最有火药味的一句(带 @反驳/打脸信号的优先)
function hottestLine(messages) {
  const CLASH = /(@|反对|太乐观|想多了|低估|高估|打脸|别|不敢|悬|翻车|爆冷|撕碎|笑|错|未必|过于|未免|然而|但是|反而|补一刀|别被带偏)/;
  const clashing = messages.filter(m => CLASH.test(String(m.text)));
  const pick = clashing[clashing.length - 1] || messages[messages.length - 1];
  if (!pick) return null;
  return { modelId: pick.modelId, text: pick.text };
}

function heroHottestLine(messages, offset = 0) {
  const CLASH = /(@|反对|太乐观|想多了|低估|高估|打脸|别|不敢|悬|翻车|爆冷|撕碎|笑|错|未必|过于|未免|然而|但是|反而|补一刀|别被带偏)/;
  const usable = messages.filter(m => !/API超时兜底|兜底/.test(String(m.text)));
  const clashing = usable.filter(m => CLASH.test(String(m.text)));
  const pool = (clashing.length ? clashing : usable.length ? usable : messages)
    .reduce((acc, message) => {
      if (!acc.some(item => item.modelId === message.modelId)) acc.push(message);
      return acc;
    }, []);
  const pick = pool.length ? pool[offset % pool.length] : null;
  return pick ? { modelId: pick.modelId, text: pick.text } : hottestLine(messages);
}

function clashSnippets(messages) {
  const SIGNAL = /(@|反对|别|打脸|补一刀|这点我服|想简单了|带偏|错|高估|低估|翻车|爆冷|但是|反而)/;
  const picks = messages.filter(message => SIGNAL.test(String(message.text))).slice(-3);
  return (picks.length ? picks : messages.slice(-3)).map(message => {
    const meta = modelMeta(message.modelId);
    return { message, meta, camp: campOf(meta) };
  });
}

function campStanceScore(messages) {
  const camps = {
    domestic: { home: 0, draw: 0, away: 0 },
    overseas: { home: 0, draw: 0, away: 0 }
  };
  finalMessagesByModel(messages).forEach(message => {
    const result = resultFromDiscussionText(message.text);
    if (!result) return;
    const camp = campOf(modelMeta(message.modelId));
    camps[camp][result] += 1;
  });
  const main = counts => {
    const key = ['home', 'draw', 'away'].sort((a, b) => counts[b] - counts[a])[0];
    return { key, label: RESULT_LABEL[key], count: counts[key] || 0 };
  };
  const domestic = main(camps.domestic);
  const overseas = main(camps.overseas);
  return { domestic, overseas };
}

function stanceBarHTML(counts, total) {
  if (!total) return '';
  const seg = (n, cls, label) => n
    ? `<span class="stance-seg ${cls}" style="flex:${n}" title="${label} ${n}">${n}</span>`
    : '';
  return `<div class="stance-bar">
    ${seg(counts.home, 'stance-home', '主胜')}
    ${seg(counts.draw, 'stance-draw', '平局')}
    ${seg(counts.away, 'stance-away', '客胜')}
  </div>`;
}

function renderRoundtableFeed() {
  const el = document.getElementById('roundtable-feed');
  if (!el) return;
  const threads = roundtableThreads();

  if (!threads.length) {
    el.innerHTML = `<div class="empty-state">
      <strong>圆桌即将开席</strong>
      <span>跑一次 <code>npm run discuss</code>,模型们就会围着每场比赛开始激辩。</span>
    </div>`;
    return;
  }

  const grouped = threads.reduce((acc, item) => {
    const key = matchDateKey(item.match);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(item);
    return acc;
  }, new Map());

  const renderCard = ({ thread, match }) => {
    const messages = thread.messages;
    const { counts, total } = stanceBreakdown(messages);
    const finalCount = finalMessagesByModel(messages).length;
    const hot = hottestLine(messages);
    const hotMeta = hot ? modelMeta(hot.modelId) : null;
    const hotCamp = hotMeta ? campOf(hotMeta) : '';
    const snippets = clashSnippets(messages);
    const campScore = campStanceScore(messages);
    const homeFlag = flagIcon(match.home.flag);
    const awayFlag = flagIcon(match.away.flag);
    const state = matchLifecycle(match);
    const statusText = state.label;
    const recap = thread.recap;
    const split = total && counts.home && (counts.draw + counts.away)
      ? '🔥 分歧激烈' : '观点交锋';

    return `<article class="rt-card" data-match="${match.id}" role="button" tabindex="0">
      ${recap?.hookText ? `<div class="recap-hook rt-recap ${recap.godModels?.length ? 'is-god' : recap.faceSlapModels?.length ? 'is-face' : ''}">
        <strong>${recap.godModels?.length ? '封神' : recap.faceSlapModels?.length ? '打脸' : '复盘'}</strong>
        <span>${escapeHTML(recap.hookText)}</span>
      </div>` : ''}
      <div class="rt-meta-row">
        <span>${escapeHTML(formatKickoff(match.kickoff))}</span>
        <span class="match-status status-${state.tone}">${escapeHTML(statusText)}</span>
      </div>
      <div class="rt-card-top">
        <div class="rt-fixture">
          <span class="rt-flag">${homeFlag}</span>
          <span class="rt-team">${escapeHTML(match.home.team)}</span>
          <span class="rt-vs">VS</span>
          <span class="rt-team">${escapeHTML(match.away.team)}</span>
          <span class="rt-flag">${awayFlag}</span>
        </div>
        <span class="rt-tag">${split}</span>
      </div>
      ${stanceBarHTML(counts, total)}
      <div class="rt-stance-legend">
        <span><i class="dot-home"></i>主胜 ${counts.home}</span>
        <span><i class="dot-draw"></i>平 ${counts.draw}</span>
        <span><i class="dot-away"></i>客胜 ${counts.away}</span>
      </div>
      ${hot ? `<div class="rt-quote rt-quote-hot">
        <div class="rt-quote-label">最毒一句</div>
        <span class="rt-quote-dot" style="background:${hotMeta.color}"></span>
        <p>“${escapeHTML(hot.text)}”<small>—— ${escapeHTML(hotMeta.name)} · ${hotCamp === 'domestic' ? '🇨🇳 国产军团' : '🌍 海外军团'}</small></p>
      </div>` : ''}
      <div class="rt-clash-list">
        ${snippets.map(({ message, meta, camp }) => `<div class="rt-clash">
          <span class="rt-clash-avatar" style="background:${meta.color}">${escapeHTML((meta.name || '?').slice(0, 1))}</span>
          <p><b>${escapeHTML(meta.name)} ${camp === 'domestic' ? '🇨🇳' : '🌍'}</b>${escapeHTML(message.text)}</p>
        </div>`).join('')}
      </div>
      <div class="rt-camp-score">
        <span>🇨🇳 看好${escapeHTML(campScore.domestic.label)} <b>${campScore.domestic.count}</b></span>
        <strong>:</strong>
        <span><b>${campScore.overseas.count}</b> 看好${escapeHTML(campScore.overseas.label)} 🌍</span>
      </div>
      <div class="rt-card-foot">
        <span>${finalCount} 个模型 · ${messages.length} 回合</span>
        <span class="rt-play">▶ 观看激辩回放</span>
      </div>
    </article>`;
  };

  el.innerHTML = Array.from(grouped.entries()).map(([dateKey, items]) => `
    <section class="rt-day-group">
      <div class="rt-day-head">
        <strong>${escapeHTML(dateLabel(dateKey))}</strong>
        <span>${escapeHTML(dateSubLabel(dateKey))} · ${items.length} 场圆桌</span>
      </div>
      <div class="rt-day-list">${items.map(renderCard).join('')}</div>
    </section>
  `).join('');

  el.querySelectorAll('.rt-card').forEach(card => {
    const open = () => openDebateStage(card.dataset.match);
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
}

// ====== 全屏沉浸式辩论回放 ======
let debateTimer = null;
let currentDebateShare = null;

function debateShareUrl(matchId) {
  const url = new URL(PUBLIC_SITE_URL);
  url.hash = `debate=${matchId}`;
  return url.toString();
}

function debateSharePayload(match, messages) {
  const hot = heroHottestLine(messages) || hottestLine(messages) || messages[messages.length - 1] || null;
  const meta = hot ? modelMeta(hot.modelId) : null;
  const fixture = `${flagIcon(match.home.flag)} ${match.home.team} VS ${match.away.team} ${flagIcon(match.away.flag)}`;
  const link = debateShareUrl(match.id);
  const quote = hot ? `${meta.name}: ${hot.text}` : `${fixture} 的圆桌回放`;
  return {
    link,
    quote,
    text: `【世界杯AI圆桌热评】\n${fixture}\n${quote}\n看完整激辩: ${link}`,
  };
}

async function copyPlainText(text) {
  if (!text) return false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const temp = document.createElement('textarea');
    temp.value = text;
    temp.setAttribute('readonly', '');
    temp.style.position = 'fixed';
    temp.style.left = '-9999px';
    temp.style.top = '0';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();
    temp.setSelectionRange(0, temp.value.length);
    let ok = false;
    try {
      ok = !!document.execCommand?.('copy');
    } catch (e) {
      ok = false;
    }
    temp.remove();
    return ok;
  }
}

function flashDebateButton(button, label) {
  if (!button) return;
  const original = button.textContent;
  button.textContent = label;
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1200);
}

async function copyDebateLine(button) {
  const ok = await copyPlainText(currentDebateShare?.text || '');
  flashDebateButton(button, ok ? '已复制' : '复制失败');
}

async function copyDebateLink(button) {
  const ok = await copyPlainText(currentDebateShare?.link || '');
  flashDebateButton(button, ok ? '已复制' : '复制失败');
}

function debateBubbleHTML(message, prevModelId) {
  const meta = modelMeta(message.modelId);
  const camp = campOf(meta);
  const side = camp === 'domestic' ? '' : ' is-right';
  const result = resultFromDiscussionText(message.text);
  const stanceTag = result
    ? `<span class="db-stance db-${result}">${RESULT_SHORT[result]}</span>` : '';
  // @ 上一个发言者(高亮交锋感)
  const replyTo = prevModelId && prevModelId !== message.modelId
    ? `<span class="db-reply">↩ 回应 ${escapeHTML(modelMeta(prevModelId).name)}</span>` : '';
  return `<div class="db-msg${side}">
    <div class="db-avatar" style="background:${meta.color}">${escapeHTML((meta.name || '?').slice(0, 1))}</div>
    <div class="db-bubble">
      <div class="db-name">${escapeHTML(meta.name)}<em>${camp === 'domestic' ? '🇨🇳' : '🌍'}</em>${stanceTag}</div>
      ${replyTo}
      <p>${escapeHTML(message.text)}</p>
    </div>
  </div>`;
}

function openDebateStage(matchId) {
  const thread = discussionForMatch(matchId);
  const match = MATCH_BY_ID.get(matchId);
  if (!thread || !match) return;
  // 写入 hash,辩论可直接分享深链
  if (history.replaceState) history.replaceState(null, '', `#debate=${matchId}`);
  const messages = (thread.messages || []).slice().sort((a, b) => a.turn - b.turn);
  currentDebateShare = debateSharePayload(match, messages);
  const stage = document.getElementById('debate-stage');
  const scroll = document.getElementById('debate-scroll');
  const titleEl = document.getElementById('debate-title');
  const stanceEl = document.getElementById('debate-stance');

  titleEl.innerHTML = `${flagIcon(match.home.flag)} ${escapeHTML(match.home.team)}
    <span>VS</span> ${escapeHTML(match.away.team)} ${flagIcon(match.away.flag)}`;
  const { counts, total } = stanceBreakdown(messages);
  stanceEl.innerHTML = `${stanceBarHTML(counts, total)}
    <div class="rt-stance-legend">
      <span><i class="dot-home"></i>主胜 ${counts.home}</span>
      <span><i class="dot-draw"></i>平 ${counts.draw}</span>
      <span><i class="dot-away"></i>客胜 ${counts.away}</span>
    </div>`;

  stage.classList.add('is-open');
  stage.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  playDebate(messages, scroll);

  const replay = () => playDebate(messages, scroll);
  const skip = () => {
    if (debateTimer) clearTimeout(debateTimer);
    let prev = null;
    scroll.innerHTML = messages.map(m => {
      const html = debateBubbleHTML(m, prev);
      prev = m.modelId;
      return html.replace('db-msg', 'db-msg db-shown');
    }).join('');
    scroll.scrollTop = scroll.scrollHeight;
  };
  document.getElementById('debate-replay').onclick = replay;
  document.getElementById('debate-skip').onclick = skip;
  document.getElementById('debate-copy-line').onclick = e => copyDebateLine(e.currentTarget);
  document.getElementById('debate-copy-link').onclick = e => copyDebateLink(e.currentTarget);
}

function playDebate(messages, scroll) {
  if (debateTimer) clearTimeout(debateTimer);
  scroll.innerHTML = '';
  let i = 0;
  let prev = null;
  const step = () => {
    if (i >= messages.length) return;
    const message = messages[i];
    const wrap = document.createElement('div');
    wrap.innerHTML = debateBubbleHTML(message, prev);
    const node = wrap.firstElementChild;
    scroll.appendChild(node);
    // 强制回流后加 shown,触发入场动画
    void node.offsetWidth;
    node.classList.add('db-shown');
    scroll.scrollTop = scroll.scrollHeight;
    prev = message.modelId;
    i += 1;
    // 按句子长度给一点节奏感,模拟"正在发言"
    const delay = Math.min(1500, 480 + String(message.text).length * 14);
    debateTimer = setTimeout(step, delay);
  };
  step();
}

function closeDebateStage() {
  const stage = document.getElementById('debate-stage');
  if (!stage) return;
  if (debateTimer) clearTimeout(debateTimer);
  stage.classList.remove('is-open');
  stage.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  currentDebateShare = null;
  if (history.replaceState && location.hash.startsWith('#debate=')) {
    history.replaceState(null, '', location.pathname);
  }
}

function renderMatchDiscussion(match) {
  const thread = discussionForMatch(match.id);
  const messages = thread?.messages || [];
  if (!messages.length) {
    return `<div class="match-discussion is-empty">
      <div class="match-discussion-title">圆桌激辩</div>
      <div class="chat-empty">
        <strong>这场还没开聊</strong>
        <span>模型输出生成后,会出现在「🔥 AI 圆桌激辩」专区。</span>
      </div>
    </div>`;
  }

  const finalCount = finalMessagesByModel(messages).length;

  return `<div class="match-discussion">
    <button type="button" class="rt-enter" data-match="${match.id}">
      <span class="rt-enter-icon">▶</span>
      <span class="rt-enter-text">
        <strong>观看 ${finalCount} 个模型激辩</strong>
        <small>${messages.length} 回合 · 互相 @、互相打脸的封盘前交锋</small>
      </span>
      <span class="rt-enter-go">回放 ›</span>
    </button>
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

function applyModels(models) {
  MODELS = {};
  if (models?.models) models.models.forEach(model => { MODELS[model.id] = model; });
  resetDerivedCaches();
}

function fetchDataBundle() {
  return Promise.all([
    loadJSON('data/matches.json', 'data/sample-matches.json'),
    loadJSON('data/leaderboard.json'),
    loadJSON('data/champion-predictions.json'),
    loadJSON('data/discussions.json'),
    loadJSON('data/groups.json'),
    loadJSON('data/jingcai-single.json')
  ]).then(([matches, leaderboard, champions, discussions, groups, jingcai]) => ({
    matches,
    leaderboard,
    champions,
    discussions,
    groups,
    jingcai
  }));
}

function renderLoadingShell() {
  const loadingHTML = '<div class="empty-state"><strong>数据加载中</strong><span>正在同步最新赛程、圆桌和排行榜。</span></div>';
  ['leaderboard', 'roundtable-feed', 'standings', 'matches', 'champion-predictions'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = loadingHTML;
  });
}

function activeTabId() {
  return document.querySelector('.tabbar .tab.is-active')?.dataset.tab || 'board';
}

function renderSectionForTab(tabId, { force = false } = {}) {
  const id = tabId || 'board';
  if (!force && hydratedTabs.has(id)) return;

  if (id === 'roundtable') {
    renderRoundtableFeed();
  } else if (id === 'board') {
    renderLeaderboard();
  } else if (id === 'standings-section') {
    renderStandings();
    renderBracket();
  } else if (id === 'matches-section') {
    renderDateQuick();
    renderMatches();
    renderDiscussions();
  } else if (id === 'champion-section') {
    renderChampionPredictions();
  }

  hydratedTabs.add(id);
  initRevealMotion(document.getElementById(id) || document);
}

function scheduleLazyHydration() {
  const token = ++lazyHydrationToken;
  const order = ['roundtable', 'matches-section', 'standings-section', 'champion-section', 'board'];
  const step = () => {
    if (token !== lazyHydrationToken) return;
    const next = order.find(id => !hydratedTabs.has(id));
    if (!next) return;
    renderSectionForTab(next, { force: true });
    scheduleIdleWork(step);
  };
  scheduleIdleWork(step);
}

function renderDataViews({ warmLazy = false } = {}) {
  renderHeroTicker();
  renderHeroRoundtable();
  renderSectionForTab(activeTabId(), { force: true });
  if (warmLazy) scheduleLazyHydration();
}

function applyDataBundle(bundle, { resetDate = false, warmLazy = false } = {}) {
  MATCHES = bundle.matches?.matches || [];
  if (bundle.leaderboard) LEADERBOARD = bundle.leaderboard;
  CHAMPIONS = bundle.champions?.predictions || [];
  DISCUSSIONS = bundle.discussions?.discussions || [];
  GROUPS = bundle.groups?.groups || {};
  JINGCAI_SINGLE = bundle.jingcai || { matches: [], sources: [] };

  rebuildDataIndexes();
  if (resetDate || !selectedDateKey) selectedDateKey = pickInitialDate();

  const updated = document.getElementById('lb-updated');
  if (updated) {
    updated.textContent = LEADERBOARD.updatedAt
      ? '更新于 ' + new Date(LEADERBOARD.updatedAt).toLocaleString('zh-CN', { timeZone: ASIA_SHANGHAI })
      : '';
  }

  hydratedTabs.clear();
  lazyHydrationToken += 1;
  renderDataViews({ warmLazy });
}

async function init() {
  restoreMatchViewPreference();
  renderLoadingShell();
  wireLeaderboardTabs();
  wireTabs();
  wireDebateStage();
  wireModelHistoryStage();
  wireMatchViewControls();
  wireRoastBeerStage();

  const modelsPromise = loadJSON('data/models.json');
  const dataPromise = fetchDataBundle();
  applyModels(await modelsPromise);
  applyDataBundle(await dataPromise, { resetDate: true, warmLazy: true });
  startDataRefresh();

  // 深链直达某场辩论回放
  const m = location.hash.match(/#debate=([\w-]+)/);
  if (m) openDebateStage(m[1]);
}

function wireMatchViewControls() {
  const checkbox = document.getElementById('compact-match-mode');
  if (!checkbox) return;
  checkbox.checked = compactMatchesMode;
  checkbox.addEventListener('change', () => {
    compactMatchesMode = checkbox.checked;
    compactExpandedMatchId = '';
    try {
      localStorage.setItem(COMPACT_MATCHES_STORAGE_KEY, compactMatchesMode ? '1' : '0');
    } catch (_) {}
    renderMatches();
    window.requestAnimationFrame(() => initRevealMotion(document.getElementById('matches') || document));
  });
}

function wireRoastBeerStage() {
  const stage = document.getElementById('roast-beer-stage');
  document.getElementById('roast-beer-open')?.addEventListener('click', openRoastBeerStage);
  document.getElementById('roast-beer-close')?.addEventListener('click', closeRoastBeerStage);
  document.getElementById('roast-beer-cancel')?.addEventListener('click', closeRoastBeerStage);
  document.getElementById('roast-copy-confirm')?.addEventListener('click', copyRoastBeerText);
  document.getElementById('roast-model-select')?.addEventListener('change', updateRoastBeerPreview);
  document.querySelectorAll('.roast-scope-tabs button').forEach(button => {
    button.addEventListener('click', () => setRoastBeerScope(button.dataset.scope));
  });
  document.querySelectorAll('.roast-source-tabs button').forEach(button => {
    button.addEventListener('click', () => setRoastBeerSource(button.dataset.source));
  });
  stage?.addEventListener('click', e => {
    if (e.target === stage) closeRoastBeerStage();
  });
}

async function refreshData({ resetDate = false } = {}) {
  const bundle = await fetchDataBundle();
  applyDataBundle(bundle, { resetDate });
}

function startDataRefresh() {
  window.setInterval(() => {
    refreshData().catch(err => console.warn('刷新数据失败', err));
  }, DATA_REFRESH_MS);
}

function wireDebateStage() {
  const stage = document.getElementById('debate-stage');
  document.getElementById('debate-close')?.addEventListener('click', closeDebateStage);
  document.getElementById('debate-close-bottom')?.addEventListener('click', closeDebateStage);
  stage?.addEventListener('click', e => {
    if (e.target === stage) closeDebateStage();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeDebateStage();
      closeModelHistory();
      closeRoastBeerStage();
    }
  });
  
  // 增加移动端下拉关闭手势 (Swipe down to close)
  let startY = 0;
  stage?.addEventListener('touchstart', e => {
    // 只有在顶部或非滚动区域时才允许下拉关闭，避免与内部滚动冲突
    const scrollEl = document.getElementById('debate-scroll');
    if (scrollEl && scrollEl.scrollTop > 0) return;
    startY = e.touches[0].clientY;
  }, { passive: true });
  stage?.addEventListener('touchend', e => {
    if (startY === 0) return;
    const endY = e.changedTouches[0].clientY;
    if (endY - startY > 80) { // 下滑超过 80px 触发关闭
      closeDebateStage();
    }
    startY = 0;
  }, { passive: true });

  // 比赛卡里的「观看激辩」入口(事件委托)
  document.getElementById('matches')?.addEventListener('click', e => {
    const modelBtn = e.target.closest('.pred-model[data-model]');
    if (modelBtn) {
      e.stopPropagation();
      openModelHistory(modelBtn.dataset.model);
      return;
    }
    const btn = e.target.closest('.rt-enter');
    if (btn) openDebateStage(btn.dataset.match);
  });
}

function wireModelHistoryStage() {
  const stage = document.getElementById('model-history-stage');
  document.getElementById('model-history-close')?.addEventListener('click', closeModelHistory);
  stage?.addEventListener('click', e => {
    if (e.target === stage) closeModelHistory();
  });
  document.getElementById('model-history-list')?.addEventListener('click', e => {
    const button = e.target.closest('.history-roundtable-toggle');
    if (!button) return;
    const wrap = button.closest('.history-roundtable');
    const lines = document.getElementById(button.dataset.target || '');
    if (!wrap || !lines) return;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    const label = button.querySelector('span');
    if (label) label.textContent = expanded ? '展开' : '收起';
    if (!expanded && wrap.dataset.loaded !== 'true') {
      const messages = modelRoundtableMessages(button.dataset.match, button.dataset.model);
      lines.innerHTML = messages.map(message => `<p>${escapeHTML(message.text)}</p>`).join('');
      wrap.dataset.loaded = 'true';
    }
    lines.hidden = expanded;
  });

  // 增加移动端下拉关闭手势 (Swipe down to close)
  let startY = 0;
  stage?.addEventListener('touchstart', e => {
    const listEl = document.getElementById('model-history-list');
    if (listEl && listEl.scrollTop > 0) return;
    startY = e.touches[0].clientY;
  }, { passive: true });
  stage?.addEventListener('touchend', e => {
    if (startY === 0) return;
    const endY = e.changedTouches[0].clientY;
    if (endY - startY > 80) {
      closeModelHistory();
    }
    startY = 0;
  }, { passive: true });
}

function wireLeaderboardTabs() {
  const tabs = document.querySelectorAll('.lb-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activeLbTrack = tab.dataset.lb;
      tabs.forEach(t => t.classList.toggle('is-active', t === tab));
      renderLeaderboard();
    });
  });
}

function initRevealMotion(root = document) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  if (!root || typeof root.querySelectorAll !== 'function') root = document;
  const nodes = root.querySelectorAll('.match, .rt-card, .standing-card, .bracket-round, .lb-row');
  if (!nodes.length) return;
  nodes.forEach(node => {
    node.classList.add('reveal-card');
    node.classList.add('is-visible');
  });
}

function preserveTabScrollHeight(scrollY) {
  const main = document.querySelector('main');
  if (!main) return;
  main.style.minHeight = `${Math.max(window.innerHeight, scrollY + window.innerHeight)}px`;
}

function restoreTabScrollPosition(scrollY) {
  preserveTabScrollHeight(scrollY);
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    window.scrollTo({ top: scrollY, behavior: 'auto' });
  }));
}

function wireTabs() {
  const tabs = Array.from(document.querySelectorAll('.tabbar .tab'));
  if (!tabs.length) return;
  const sections = tabs
    .map(tab => document.getElementById(tab.dataset.tab))
    .filter(Boolean);

  const activateTab = id => {
    tabs.forEach(tab => tab.classList.toggle('is-active', tab.dataset.tab === id));
    sections.forEach(section => {
      if (section.id === id) {
        section.style.display = 'block';
        window.requestAnimationFrame(() => {
          initRevealMotion(section);
        });
      } else {
        section.style.display = 'none';
      }
    });
  };

  // 根据 URL hash 初始化 active tab
  const hash = location.hash.replace('#', '');
  const initialTab = tabs.find(t => t.dataset.tab === hash) || tabs.find(t => t.classList.contains('is-active')) || tabs[0];
  activateTab(initialTab.dataset.tab);

  tabs.forEach(tab => {
    tab.addEventListener('click', e => {
      e.preventDefault();
      const previousScrollY = window.scrollY;
      const targetId = tab.dataset.tab;
      preserveTabScrollHeight(previousScrollY);
      let forceRender = false;
      if (targetId === 'matches-section') {
        selectedDateKey = pickInitialDate();
        compactExpandedMatchId = '';
        forceRender = true;
      }
      activateTab(targetId);
      renderSectionForTab(targetId, { force: forceRender });
      history.replaceState?.(null, '', `#${targetId}`);
      restoreTabScrollPosition(previousScrollY);
    });
  });
}

init();
