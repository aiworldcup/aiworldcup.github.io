const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type,x-admin-token'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function beijingDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function normalizePath(value) {
  try {
    const raw = String(value || '/');
    const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'https://worldcup-ai-arena.local');
    return `${url.pathname || '/'}${url.hash && url.hash.startsWith('#debate=') ? '#debate' : ''}`.slice(0, 180);
  } catch (_) {
    return '/';
  }
}

function referrerHost(value) {
  if (!value) return 'direct';
  try {
    return new URL(String(value)).hostname.replace(/^www\./, '').slice(0, 120) || 'direct';
  } catch (_) {
    return 'unknown';
  }
}

function deviceType(ua, width) {
  const userAgent = String(ua || '').toLowerCase();
  const screenWidth = Number(width) || 0;
  if (/ipad|tablet/.test(userAgent)) return 'tablet';
  if (/mobile|iphone|android/.test(userAgent) || (screenWidth && screenWidth < 760)) return 'mobile';
  return 'desktop';
}

function browserName(ua) {
  const value = String(ua || '');
  if (/Edg\//.test(value)) return 'Edge';
  if (/Chrome\//.test(value) && !/Chromium/.test(value)) return 'Chrome';
  if (/Safari\//.test(value) && !/Chrome\//.test(value)) return 'Safari';
  if (/Firefox\//.test(value)) return 'Firefox';
  return 'Other';
}

function osName(ua) {
  const value = String(ua || '');
  if (/iPhone|iPad|iPod/.test(value)) return 'iOS';
  if (/Android/.test(value)) return 'Android';
  if (/Mac OS X/.test(value)) return 'macOS';
  if (/Windows/.test(value)) return 'Windows';
  if (/Linux/.test(value)) return 'Linux';
  return 'Other';
}

async function sha256(value) {
  const input = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return true;
  const url = new URL(request.url);
  const token = request.headers.get('x-admin-token') || url.searchParams.get('token') || '';
  return token && token === env.ADMIN_TOKEN;
}

async function collect(request, env) {
  if (!env.DB) return json({ ok: false, error: 'D1 database is not configured' }, 500);
  const body = await request.json().catch(() => ({}));
  const now = new Date();
  const ua = request.headers.get('user-agent') || '';
  const cf = request.cf || {};
  const visitorSeed = body.visitorId || `${request.headers.get('cf-connecting-ip') || ''}:${ua}`;
  const sessionSeed = body.sessionId || `${visitorSeed}:${beijingDay(now)}`;
  const visitorHash = await sha256(`${visitorSeed}:${env.VISITOR_SALT || 'worldcup-ai-arena'}`);
  const sessionHash = await sha256(`${sessionSeed}:${env.VISITOR_SALT || 'worldcup-ai-arena'}`);
  const path = normalizePath(body.path);
  const country = String(cf.country || body.country || 'unknown').slice(0, 40);
  const device = deviceType(ua, body.screenWidth);
  const referrer = referrerHost(body.referrer);

  await env.DB.prepare(`INSERT INTO events
    (ts, day, visitor_hash, session_hash, path, referrer, device, browser, os, country, language, timezone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      now.toISOString(),
      beijingDay(now),
      visitorHash,
      sessionHash,
      path,
      referrer,
      device,
      browserName(ua),
      osName(ua),
      country,
      String(body.language || '').slice(0, 40),
      String(body.timezone || '').slice(0, 60)
    )
    .run();

  return json({ ok: true });
}

async function all(db, sql, ...binds) {
  const result = await db.prepare(sql).bind(...binds).all();
  return result.results || [];
}

async function first(db, sql, ...binds) {
  return await db.prepare(sql).bind(...binds).first();
}

async function stats(request, env) {
  if (!await requireAdmin(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return json({ ok: false, error: 'D1 database is not configured' }, 500);

  const url = new URL(request.url);
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days')) || 30));
  const today = beijingDay();
  const total = await first(env.DB, `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors FROM events`);
  const todayRow = await first(env.DB, `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors FROM events WHERE day = ?`, today);
  const dayRows = await all(env.DB, `SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
    FROM events GROUP BY day ORDER BY day DESC LIMIT ?`, days);
  const topPaths = await all(env.DB, `SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
    FROM events GROUP BY path ORDER BY views DESC LIMIT 12`);
  const referrers = await all(env.DB, `SELECT referrer, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
    FROM events GROUP BY referrer ORDER BY views DESC LIMIT 12`);
  const devices = await all(env.DB, `SELECT device, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
    FROM events GROUP BY device ORDER BY views DESC`);
  const countries = await all(env.DB, `SELECT country, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
    FROM events GROUP BY country ORDER BY views DESC LIMIT 12`);
  const recent = await all(env.DB, `SELECT ts, day, path, referrer, device, browser, os, country
    FROM events ORDER BY id DESC LIMIT 30`);

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    today,
    total: {
      views: total?.views || 0,
      visitors: total?.visitors || 0
    },
    todayStats: {
      views: todayRow?.views || 0,
      visitors: todayRow?.visitors || 0
    },
    daily: dayRows.reverse(),
    topPaths,
    referrers,
    devices,
    countries,
    recent
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'worldcup-ai-arena-analytics' });
    }
    if (url.pathname === '/api/collect' && request.method === 'POST') return collect(request, env);
    if (url.pathname === '/api/stats' && request.method === 'GET') return stats(request, env);
    return json({ ok: false, error: 'not found' }, 404);
  }
};
