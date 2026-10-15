// GET /api/hours?name=..&address=..&lat=..&lng=..  → Google's listing name, today's hours + open now (Google Places, cached 1 day at the edge)
import { guard } from '../lib/common.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const { name = '', address = '' } = req.query || {};
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!key || !name || name.length > 120 || address.length > 200) return res.status(400).json({ error: 'bad request' });
  try {
    const body = { textQuery: `${name}, ${address}`, maxResultCount: 1 };
    if (Number.isFinite(lat) && Number.isFinite(lng)) body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 300 } };
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.googleMapsUri,places.businessStatus,places.regularOpeningHours.weekdayDescriptions,places.utcOffsetMinutes'
      },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (!r.ok) { console.error('places', r.status, JSON.stringify(d).slice(0, 300)); return res.status(502).json({ error: 'hours unavailable' }); }
    const p = (d.places || [])[0];
    const out = p ? {
      name: p.displayName?.text || null,
      mapsUrl: p.googleMapsUri || null,
      closed: p.businessStatus && p.businessStatus !== 'OPERATIONAL',
      week: p.regularOpeningHours?.weekdayDescriptions || [],
      utcOffset: p.utcOffsetMinutes ?? null
    } : { mapsUrl: null, week: [] };
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json(out);
  } catch (e) {
    console.error('hours error', e.message);
    return res.status(502).json({ error: 'hours unavailable' });
  }
}
