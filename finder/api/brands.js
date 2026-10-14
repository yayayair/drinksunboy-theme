// GET /api/brands → VIP brand names (used to map flavors). Origin-restricted.
import { guard } from '../lib/common.js';
import { brands } from '../lib/vip.js';
export default async function handler(req, res) {
  if (!guard(req, res)) return;
  try { return res.status(200).json({ brands: await brands() }); }
  catch (e) { console.error('brands', e.message); return res.status(502).json({ error: e.message.replace(/sig[^ ]*/gi, '') }); }
}
