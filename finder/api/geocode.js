// GET /api/geocode?q=Brooklyn, NY  → { lat, lng, label }  (US only; Google, cached 30 days at the edge)
import { guard } from '../lib/common.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const q = String((req.query || {}).q || '').trim();
  if (!key || q.length < 2 || q.length > 160) return res.status(400).json({ error: 'Try a ZIP, city or street address.' });
  try {
    let hit = null;
    // 1) Geocoding API (cheapest). Works once "Geocoding API" is enabled for the key.
    const g = await fetch('https://maps.googleapis.com/maps/api/geocode/json?' + new URLSearchParams({ address: q, components: 'country:US', key }));
    const gd = await g.json().catch(() => ({}));
    if (gd.status === 'OK' && gd.results?.[0]) {
      const r = gd.results[0];
      hit = { lat: r.geometry.location.lat, lng: r.geometry.location.lng, label: r.formatted_address.replace(/, USA$/, '') };
    } else if (gd.status !== 'ZERO_RESULTS') {
      // 2) Fallback: Places Text Search (already enabled for store hours).
      const p = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.location,places.formattedAddress' },
        body: JSON.stringify({ textQuery: q, regionCode: 'us', maxResultCount: 1 })
      });
      const pd = await p.json().catch(() => ({}));
      const pl = pd.places?.[0];
      if (pl?.location) hit = { lat: pl.location.latitude, lng: pl.location.longitude, label: String(pl.formattedAddress || q).replace(/, USA$/, '') };
      else if (!p.ok) console.error('geocode fallback', p.status, JSON.stringify(pd).slice(0, 200), 'geocoding status', gd.status);
    }
    if (!hit) return res.status(404).json({ error: 'We couldn’t find that place. Try a ZIP or a fuller address.' });
    res.setHeader('Cache-Control', 'public, s-maxage=2592000, stale-while-revalidate=2592000');
    return res.status(200).json(hit);
  } catch (e) {
    console.error('geocode error', e.message);
    return res.status(502).json({ error: 'Search is taking a breather. Try your ZIP.' });
  }
}
