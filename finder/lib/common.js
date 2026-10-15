// Shared helpers: origin checks, CORS, simple rate limiting, input validation.
const ALLOWED = /^https:\/\/(([a-z0-9-]+\.)*drinksunboy\.com|[a-z0-9-]+\.myshopify\.com|([a-z0-9-]+\.)*shopifypreview\.com)$/i;

export function originOf(req) {
  const o = req.headers.origin;
  if (o) return o;
  const r = req.headers.referer || '';
  try { return new URL(r).origin; } catch { return ''; }
}

// Vercel parses JSON bodies; accept text bodies too.
export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

// Returns true if the request may proceed. Sets CORS headers for allowed origins.
export function guard(req, res) {
  const origin = originOf(req);
  if (!ALLOWED.test(origin)) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return false; }
  if (!rateOk(clientIp(req))) { res.status(429).json({ error: 'slow down' }); return false; }
  return true;
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';
}

const hits = new Map();
function rateOk(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = 240;
  const list = (hits.get(ip) || []).filter(t => now - t < win);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length <= max;
}

export const isZip = v => /^\d{5}$/.test(String(v || ''));
export const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

// VIP names arrive upper-case and sometimes HTML-encoded ("CRAFT &amp; CARRY").
export function decode(s) {
  return String(s || '').replace(/&(amp|#38);/gi, '&').replace(/&(#39|apos|#x27);/gi, "'").replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}
const SMALL = /\b(And|Of|At|In|On|The|By|For|To)\b/g;
export function titleCase(s) {
  const t = decode(s).toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase())
    .replace(/\b(Llc|Inc|Usa|Nyc|Bbq|Cvs|Ipa|Ues|Uws)\b/g, m => m.toUpperCase()).replace(/'S\b/g, "'s")
    .replace(/\bTrader Joes\b/g, "Trader Joe's").replace(/\bH E B\b|\bHeb\b/g, 'H-E-B').replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase());
  return t.replace(SMALL, (m, w, i) => (i === 0 ? m : m.toLowerCase()));
}
