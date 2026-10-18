// GET /api/events → upcoming public SUNBOY events from Connecteam (tastings, festivals, activations).
// Refreshes from Connecteam about every 10 minutes; the CDN keeps a copy for up to 5.
import { guard } from '../lib/common.js';
import { hasKey } from '../lib/connecteam.js';
import { publicEvents } from '../lib/events.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  if (!hasKey()) return res.status(200).json({ events: [] });
  try {
    const body = await publicEvents();
    res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=300, stale-while-revalidate=900');
    return res.status(200).json(body);
  } catch (e) {
    console.error('events', e.status || '', e.detail || e.message);
    return res.status(502).json({ events: [], error: 'Events are taking a breather.' });
  }
}
