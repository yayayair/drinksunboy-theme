// GET /api/stores?zip=12345 | lat=..&lng=.. [&flavor=coconut] [&miles=25] [&days=60]
import { guard, clientIp, isZip, num, titleCase } from '../lib/common.js';
import { vip, brands } from '../lib/vip.js';
import { brandsFor, FLAVORS } from '../lib/flavors.js';

const cache = new Map();

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const q = req.query || {};
  const zip = isZip(q.zip) ? q.zip : null;
  const lat = num(q.lat, -90, 90), lng = num(q.lng, -180, 180);
  if (!zip && (lat === null || lng === null)) return res.status(400).json({ error: 'Enter a 5-digit ZIP or share your location.' });
  const miles = Math.round(num(q.miles, 1, 100) || 25);
  const days = Math.round(num(q.days, 7, 365) || 60);
  const flavor = FLAVORS[q.flavor] ? q.flavor : '';

  const key = [zip, lat?.toFixed(3), lng?.toFixed(3), miles, days, flavor].join('|');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return res.status(200).json(hit.body);

  try {
    let brandParam = '';
    if (flavor) {
      const list = brandsFor(flavor, await brands());
      if (list.length) brandParam = list.join(',');
    }
    const params = [['action', 'results'], ['format', 'json']];
    if (brandParam) params.push(['brand', brandParam]);
    if (zip) params.push(['zip', zip]);
    if (lat !== null && lng !== null) { params.push(['lat', lat.toFixed(6)]); params.push(['long', lng.toFixed(6)]); }
    params.push(['miles', miles], ['page', 0], ['pagesize', 100]);
    const ip = clientIp(req); if (ip) params.push(['ip', ip]);

    const d = await vip(params);
    const raw = d.location || d.locations || [];
    const now = Date.now();
    const all = raw.map((l, i) => {
      const ls = String(l.lastSold || '');
      const soldAt = ls.length === 8 ? Date.UTC(+ls.slice(0, 4), +ls.slice(4, 6) - 1, +ls.slice(6, 8)) : null;
      return {
        id: `${l.zip}-${i}-${String(l.dba || '').slice(0, 12)}`,
        name: titleCase(l.dba), street: titleCase(l.street), city: titleCase(l.city), state: l.state, zip: l.zip,
        lat: Number(l.lat), lng: Number(l.long), phone: l.phoneFormatted || l.phone || '',
        distance: Number(l.distance), onPremise: l.storeTypeRollup === 'on',
        daysAgo: soldAt ? Math.max(0, Math.round((now - soldAt) / 864e5)) : null
      };
    });
    let stores = all.filter(s => s.daysAgo === null || s.daysAgo <= days);
    let widened = false;
    if (stores.length < 5 && all.length > stores.length) { stores = all; widened = true; }
    const body = {
      stores: stores.slice(0, 60), total: stores.length, widened, days, miles, flavor,
      online: (d.onlineVendor || []).map(v => ({ name: v.dba, url: v.url }))
    };
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 500) cache.clear();
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(body);
  } catch (e) {
    console.error('stores error', e.message);
    return res.status(502).json({ error: 'The store finder is taking a breather. Try again in a minute.' });
  }
}
