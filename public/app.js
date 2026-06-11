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
  if (!MATCHES.length) { el.innerHTML = '<div class="empty">暂无比赛数据</div>'; return; }
  el.innerHTML = MATCHES.map(renderMatchCard).join('');
}

function renderMatchCard(m) {
  const o = m.odds?.result || {};
  const finished = !!m.actual;
  const status = finished
    ? `<div class="match-status status-final">已结束 · 比分 ${m.actual.score} · ${RESULT_LABEL[m.actual.result] || ''}</div>`
    : `<div class="match-status status-sealed">🔒 已封盘 · 待开赛</div>`;

  const preds = (m.predictions || [])
    .filter(p => p.track === currentTrack)
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
      <div class="match-stage">${m.stage || ''}</div>
      <div class="match-teams">
        <span>${m.home.flag || ''} ${m.home.team}</span>
        <span class="vs">VS</span>
        <span>${m.away.team} ${m.away.flag || ''}</span>
      </div>
      <div class="match-odds">
        <span class="odd">主 <b>${o.home ?? '-'}</b></span>
        <span class="odd">平 <b>${o.draw ?? '-'}</b></span>
        <span class="odd">客 <b>${o.away ?? '-'}</b></span>
      </div>
      ${status}
    </div>
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
