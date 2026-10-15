// GET /api/config → public, browser-safe settings for the Find Us page (Mapbox pk. token lives in Vercel env, not the theme repo).
import { guard } from '../lib/common.js';

export default function handler(req, res) {
  if (!guard(req, res)) return;
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  return res.status(200).json({ mapbox: process.env.MAPBOX_PUBLIC_TOKEN || '' });
}
