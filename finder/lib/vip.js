// VIP / SRS Brand Finder Web Services client (signed requests, per the July 2022 spec).
import crypto from 'node:crypto';

const URL_BASE = 'https://api.vtinfo.com/analytics/v2/finder';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = n => String(n).padStart(2, '0');

function stamp(d = new Date()) {
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:00 GMT`;
}

// params: array of [key, value] pairs, in the order they are sent.
export async function vip(params) {
  const custID = process.env.VIP_CUST_ID;
  const secret = process.env.VIP_SHARED_CODE;
  if (!custID || !secret) throw new Error('VIP credentials missing');
  const qs = params.filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  const ts = stamp();
  const sig = crypto.createHash('sha256').update(ts + secret + qs + custID).digest('hex').toLowerCase();
  const r = await fetch(`${URL_BASE}?${qs}`, {
    headers: { vipCustID: custID, vipTimestamp: ts, vipSignature: sig, Accept: 'application/json' },
    redirect: 'follow'
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`VIP ${r.status}: ${text.slice(0, 200)}`); }
  if (!r.ok) throw new Error(`VIP ${r.status}: ${data.errMsg || text.slice(0, 200)}`);
  return data;
}

let brandCache = { at: 0, brands: [] };
export async function brands() {
  if (Date.now() - brandCache.at < 12 * 3600 * 1000 && brandCache.brands.length) return brandCache.brands;
  const d = await vip([['action', 'brands'], ['format', 'json']]);
  const list = d.brand || d.brands || [];
  brandCache = { at: Date.now(), brands: Array.isArray(list) ? list : [] };
  return brandCache.brands;
}
