// 世界杯 AI 擂台 — 前端逻辑
// 纯静态:fetch 本地 JSON,失败时回退到 sample 数据。

let MODELS = {};
let MATCHES = [];
let LEADERBOARD = { blind: [], open: [] };
let currentTrack = 'blind';

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
  if (!value) return '时间待定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function renderMatchSummary() {
  const el = document.getElementById('match-summary');
  if (!el) return;
  const finished = MATCHES.filter(m => m.actual).length;
  const sealed = MATCHES.filter(m => !m.actual && m.sealedAt).length;
  el.textContent = `${MATCHES.length} 场比赛 · ${finished} 场已结算 · ${sealed} 场已封盘`;
}

function renderLeaderboard() {
  const el = document.getElementById('leaderboard');
  const rows = (LEADERBOARD[currentTrack] || []).slice().sort((a, b) => b.points - a.points);
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
  if (!MATCHES.length) { el.innerHTML = '<div class="empty">暂无比赛数据</div>'; return; }
  el.innerHTML = MATCHES.map(renderMatchCard).join('');
}

function renderMatchCard(m) {
  const o = m.odds?.result || {};
  const finished = !!m.actual;
  const status = finished
    ? `<span class="match-status status-final">已结束 · ${m.actual.score} · ${RESULT_LABEL[m.actual.result] || ''}</span>`
    : `<span class="match-status status-sealed">已封盘 · 待开赛</span>`;

  const trackPredictions = (m.predictions || []).filter(p => p.track === currentTrack);
  const counts = trackPredictions.reduce((acc, p) => {
    acc[p.result] = (acc[p.result] || 0) + 1;
    return acc;
  }, { home: 0, draw: 0, away: 0 });
  const total = trackPredictions.length || 1;
  const lean = ['home', 'draw', 'away'].slice().sort((a, b) => counts[b] - counts[a])[0];
  const leanText = trackPredictions.length
    ? `${RESULT_LABEL[lean]} ${counts[lean]}/${trackPredictions.length}`
    : '暂无预测';
  const scoreCounts = trackPredictions.reduce((acc, p) => {
    acc[p.score] = (acc[p.score] || 0) + 1;
    return acc;
  }, {});
  const hotScore = Object.entries(scoreCounts).sort((a, b) => b[1] - a[1])[0];
  const hotScoreText = hotScore ? `${hotScore[0]} · ${hotScore[1]} 票` : '暂无';
  const kickoff = formatKickoff(m.kickoff);
  const homeFlag = flagIcon(m.home.flag);
  const awayFlag = flagIcon(m.away.flag);

  const preds = trackPredictions
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
        <span class="pred-pick"><b>${RESULT_LABEL[p.result] || p.result}</b> · ${p.score}</span>
        <span>${mark}</span>
      </div>`;
    }).join('') || '<div class="empty">该赛道暂无预测</div>';

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
          <span class="info-label">规则</span>
          <strong>每模型 100 积分</strong>
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
  </article>`;
}

function switchTrack(track) {
  currentTrack = track;
  document.querySelectorAll('.track-btn').forEach(b => {
    const active = b.dataset.track === track;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active);
  });
  renderLeaderboard();
  renderMatches();
}

async function init() {
  const models = await loadJSON('data/models.json');
  if (models?.models) models.models.forEach(m => { MODELS[m.id] = m; });

  const matches = await loadJSON('data/matches.json', 'data/sample-matches.json');
  MATCHES = matches?.matches || [];

  const lb = await loadJSON('data/leaderboard.json');
  if (lb) {
    LEADERBOARD = lb;
    const u = document.getElementById('lb-updated');
    if (lb.updatedAt) u.textContent = '更新于 ' + new Date(lb.updatedAt).toLocaleString('zh-CN');
  }

  document.querySelectorAll('.track-btn').forEach(b =>
    b.addEventListener('click', () => switchTrack(b.dataset.track)));

  switchTrack('blind');
}

init();
