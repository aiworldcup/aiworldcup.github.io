// 世界杯 AI 擂台 — 前端逻辑
// 纯静态:fetch 本地 JSON,失败时回退到 sample 数据。

let MODELS = {};
let MATCHES = [];
let LEADERBOARD = { rankings: [], open: [] };
let CHAMPIONS = [];
let DISCUSSIONS = [];
let selectedDateKey = '';
const ACTIVE_TRACK = 'open';

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
    timeZone: 'Asia/Shanghai',
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
    timeZone: 'Asia/Shanghai',
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
  const finished = selectedMatches.filter(m => m.actual).length;
  const sealed = selectedMatches.filter(m => !m.actual && m.sealedAt).length;
  el.textContent = `${selectedDateKey} · ${selectedMatches.length} 场比赛 · ${finished} 场已结算 · ${sealed} 场已封盘`;
}

function renderLeaderboard() {
  const el = document.getElementById('leaderboard');
  const rows = (LEADERBOARD.rankings || LEADERBOARD.open || []).slice().sort((a, b) => b.points - a.points);
  if (!rows.length) { el.innerHTML = '<li class="empty">暂无排名数据</li>'; return; }
  el.innerHTML = rows.map((r, i) => {
    const m = modelMeta(r.modelId);
    return `<li class="lb-row">
      <div class="lb-rank">${i + 1}</div>
      <div>
        <div class="lb-name"><span class="lb-dot" style="background:${m.color}"></span>${m.name}
          <span class="lb-vendor">${m.vendor}</span></div>
      </div>
      <div style="text-align:right">
        <div class="lb-points">${Math.round(r.points)}</div>
        <div class="lb-sub">命中 ${r.hits}/${r.played}</div>
      </div>
    </li>`;
  }).join('');
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

function renderMatchCard(m) {
  const o = m.odds?.result || {};
  const finished = !!m.actual;
  const trackPredictions = (m.predictions || []).filter(p => !p.track || p.track === ACTIVE_TRACK);
  const displayPredictions = trackPredictions.length ? trackPredictions : discussionPredictionsForMatch(m.id);
  const hasPredictions = displayPredictions.length > 0;
  const status = finished
    ? `<span class="match-status status-final">已结束 · ${m.actual.score} · ${RESULT_LABEL[m.actual.result] || ''}</span>`
    : hasPredictions || m.sealedAt
      ? `<span class="match-status status-sealed">已封盘 · 待开赛</span>`
      : `<span class="match-status status-pending">预测待更新</span>`;

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
    ? `${Math.round(totalStake / displayPredictions.length)} / 100`
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
    ? `封盘 ${new Date(thread.sealedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
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
      ? `已封盘 · ${new Date(thread.sealedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
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
    if (lb.updatedAt) u.textContent = '更新于 ' + new Date(lb.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  }

  const champions = await loadJSON('data/champion-predictions.json');
  CHAMPIONS = champions?.predictions || [];

  const discussions = await loadJSON('data/discussions.json');
  DISCUSSIONS = discussions?.discussions || [];

  renderDateQuick();
  renderLeaderboard();
  renderMatches();
  renderChampionPredictions();
  renderDiscussions();
}

init();
