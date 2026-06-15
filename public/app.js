// 世界杯 AI 擂台 — 前端逻辑
// 纯静态:fetch 本地 JSON,失败时回退到 sample 数据。

let MODELS = {};
let MATCHES = [];
let LEADERBOARD = { rankings: [], open: [] };
let CHAMPIONS = [];
let DISCUSSIONS = [];
let GROUPS = {};
let selectedDateKey = '';
let activeLbTrack = 'result';
let heroRoundtableTimer = null;
let manualTabScrollUntil = 0;
const ACTIVE_TRACK = 'open';

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

function teamFlag(team) {
  const match = MATCHES.find(item => item.home.team === team || item.away.team === team);
  if (!match) return '';
  return flagIcon(match.home.team === team ? match.home.flag : match.away.flag);
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
  const match = MATCHES.find(item => item.id === matchId);
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

function discussionPredictionsForMatch(matchId) {
  const thread = discussionForMatch(matchId);
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
  return { key: 'needs-result', tone: 'needs-result', label: '待赛果结算', detail: '赛果同步后自动进入排行榜' };
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

  return {
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
}

function modelHistory(modelId) {
  return MATCHES
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
      <div class="history-badges">${badges}</div>
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
  return DISCUSSIONS
    .map(thread => ({ thread, match: MATCHES.find(m => m.id === thread.matchId) }))
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
        <span>今日最劲爆圆桌</span>
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
      <button type="button" class="hero-rt-play">▶ 看激辩</button>
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
        <span>进站先看模型互怼</span>
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
  const predictionCountText = displayPredictions.length ? `${displayPredictions.length} 位模型` : '待定';
  const kickoff = formatKickoff(m.kickoff);
  const homeFlag = flagIcon(m.home.flag || (m.placeholder ? '🏆' : ''));
  const awayFlag = flagIcon(m.away.flag || (m.placeholder ? '🏆' : ''));
  const actualScore = finished ? String(m.actual.score || '').replace('-', ' : ') : '';
  const recap = discussionForMatch(m.id)?.recap;
  const recapHTML = recap?.hookText ? `<div class="recap-hook ${recap.godModels?.length ? 'is-god' : recap.faceSlapModels?.length ? 'is-face' : ''}">
    <strong>${recap.godModels?.length ? '封神' : recap.faceSlapModels?.length ? '打脸' : '赛后复盘'}</strong>
    <span>${escapeHTML(recap.hookText)}</span>
  </div>` : '';

  const preds = displayPredictions
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
    }).join('') || '<div class="empty">暂无预测</div>';

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
  const match = MATCHES.find(m => m.id === matchId);
  if (!thread || !match) return;
  // 写入 hash,辩论可直接分享深链
  if (history.replaceState) history.replaceState(null, '', `#debate=${matchId}`);
  const messages = (thread.messages || []).slice().sort((a, b) => a.turn - b.turn);
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

async function init() {
  const models = await loadJSON('data/models.json');
  if (models?.models) models.models.forEach(m => { MODELS[m.id] = m; });

  await refreshData({ resetDate: true });

  wireLeaderboardTabs();
  wireScrollSpy();
  wireDebateStage();
  wireModelHistoryStage();
  startDataRefresh();

  // 深链直达某场辩论回放
  const m = location.hash.match(/#debate=([\w-]+)/);
  if (m) openDebateStage(m[1]);
}

async function refreshData({ resetDate = false } = {}) {
  const matches = await loadJSON('data/matches.json', 'data/sample-matches.json');
  MATCHES = matches?.matches || [];
  if (resetDate || !selectedDateKey) selectedDateKey = pickInitialDate();

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

  const groups = await loadJSON('data/groups.json');
  GROUPS = groups?.groups || {};

  renderHeroMetrics();
  renderHeroTicker();
  renderHeroRoundtable();
  renderDateQuick();
  renderLeaderboard();
  renderRoundtableFeed();
  renderStandings();
  renderBracket();
  renderMatches();
  renderChampionPredictions();
  renderDiscussions();
  initRevealMotion();
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

function initRevealMotion() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const nodes = document.querySelectorAll('.match, .rt-card, .standing-card, .bracket-round, .lb-row');
  if (!nodes.length || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  nodes.forEach(node => {
    if (node.classList.contains('is-visible')) return;
    node.classList.add('reveal-card');
    observer.observe(node);
  });
}

function wireScrollSpy() {
  const tabs = Array.from(document.querySelectorAll('.tabbar .tab'));
  if (!tabs.length) return;
  const sections = tabs
    .map(tab => document.getElementById(tab.dataset.tab))
    .filter(Boolean);
  const activateTab = id => {
    tabs.forEach(tab => tab.classList.toggle('is-active', tab.dataset.tab === id));
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', e => {
      const section = document.getElementById(tab.dataset.tab);
      if (!section) return;
      e.preventDefault();
      manualTabScrollUntil = Date.now() + 900;
      activateTab(tab.dataset.tab);
      const offset = (document.getElementById('tabbar')?.offsetHeight || 0) + 10;
      const top = section.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
      history.replaceState?.(null, '', `#${tab.dataset.tab}`);
    });
  });

  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => {
    if (Date.now() < manualTabScrollUntil) return;
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const id = entry.target.id;
      activateTab(id);
    });
  }, { rootMargin: '-28% 0px -58% 0px', threshold: 0 });
  sections.forEach(section => observer.observe(section));
}

init();
