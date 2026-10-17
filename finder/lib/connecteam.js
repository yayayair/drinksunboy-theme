// Connecteam API (read only). Key lives in the CONNECTEAM_API_KEY env var.
const BASE = 'https://api.connecteam.com';

export const hasKey = () => !!process.env.CONNECTEAM_API_KEY;

export async function ct(path, params = {}) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    [].concat(v).forEach(x => u.searchParams.append(k, String(x)));
  }
  const r = await fetch(u, { headers: { 'X-API-KEY': process.env.CONNECTEAM_API_KEY || '', accept: 'application/json' } });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  if (!r.ok) {
    const err = new Error(`connecteam ${r.status} ${path}`);
    err.status = r.status; err.detail = json?.detail || json?.message || text.slice(0, 200);
    throw err;
  }
  return json;
}

// Pages through any list endpoint that uses limit/offset + paging.offset.
export async function all(path, params, key, max = 2000) {
  const out = []; let offset = 0;
  for (let i = 0; i < 20 && out.length < max; i++) {
    const d = await ct(path, { ...params, limit: params?.limit || 500, offset });
    const list = d?.data?.[key] || [];
    out.push(...list);
    const next = d?.paging?.offset;
    if (!list.length || next === undefined || next === null || next === offset) break;
    offset = next;
  }
  return out;
}

export const schedulers = () => ct('/scheduler/v1/schedulers').then(d => d?.data?.schedulers || []);
export const shifts = (schedulerId, startTime, endTime, extra = {}) =>
  all(`/scheduler/v1/schedulers/${schedulerId}/shifts`, { startTime, endTime, ...extra }, 'shifts');
