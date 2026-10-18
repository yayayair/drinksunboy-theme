// TEMPORARY (analysis only): GET /api/coverage?lat=..&lng=..&miles=..  → total in that circle, and when ≤ 400 the
// list of { k: name|street|zip, d: days since last delivery, on: on-premise, st: state }. Remove after use.
import { guard, num } from '../lib/common.js';
import { vip } from '../lib/vip.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const q = req.query || {};
  const lat = num(q.lat, -90, 90), lng = num(q.lng, -180, 180), miles = Math.round(num(q.miles, 1, 3000) || 0);
  if (lat === null || lng === null || !miles) return res.status(400).json({ error: 'lat, lng, miles' });
  try {
    const base = [['action', 'results'], ['format', 'json'], ['lat', lat.toFixed(6)], ['long', lng.toFixed(6)], ['miles', miles]];
    const head = await vip([...base, ['page', 0], ['pagesize', 1]]);
    const total = Number(head.total || 0);
    if (total > 400 || !total) return res.status(200).json({ total, list: null });
    const d = await vip([...base, ['page', 0], ['pagesize', 400]]);
    const now = Date.now();
    const list = (d.location || []).map(l => {
      const ls = String(l.lastSold || '');
      const t = ls.length === 8 ? Date.UTC(+ls.slice(0, 4), +ls.slice(4, 6) - 1, +ls.slice(6, 8)) : null;
      return { k: `${l.dba}|${l.street}|${l.zip}`, d: t ? Math.round((now - t) / 864e5) : null, on: l.storeTypeRollup === 'on', st: l.state };
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ total, list });
  } catch (e) {
    return res.status(502).json({ error: e.message.slice(0, 200) });
  }
}
