// GET /api/where → the visitor's approximate city from Vercel's edge (IP-based), so Find Us can open on nearby spots.
// Nothing is stored or logged. Non-US or unknown → {} and the page falls back to New York City.
import { guard } from '../lib/common.js';

export default function handler(req, res) {
  if (!guard(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  const h = req.headers;
  const country = h['x-vercel-ip-country'];
  const lat = parseFloat(h['x-vercel-ip-latitude']), lng = parseFloat(h['x-vercel-ip-longitude']);
  if (country !== 'US' || !isFinite(lat) || !isFinite(lng)) return res.status(200).json({});
  let city = '';
  try { city = decodeURIComponent(h['x-vercel-ip-city'] || ''); } catch (e) { city = ''; }
  const region = h['x-vercel-ip-country-region'] || '';
  return res.status(200).json({ lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, label: [city, region].filter(Boolean).join(', ') });
}
