// One function for the small endpoints (Vercel Hobby allows 12 functions per deployment).
// vercel.json rewrites /api/<name> here with ?route=<name>, so public URLs are unchanged.
import health from '../routes/health.js';
import config from '../routes/config.js';
import brands from '../routes/brands.js';
import where from '../routes/where.js';
import coverage from '../routes/coverage.js';
import events from '../routes/events.js';

const ROUTES = { health, config, brands, where, coverage, events };

export default function handler(req, res) {
  const q = req.query || {};
  const fn = ROUTES[q.route];
  if (!fn) return res.status(404).json({ error: 'not found' });
  delete q.route;
  return fn(req, res);
}
