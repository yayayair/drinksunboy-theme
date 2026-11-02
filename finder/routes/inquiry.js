// POST /api/inquiry → a website form that needs a follow-up (trade account request, contact form) is posted
// to Slack as a card the team can act on. Nothing is emailed to the person who wrote in.
// Body: { kind: 'trade' | 'contact', fields: { <label>: <value> }, page, t (ms spent on the page), hp (honeypot) }
import { guard, body } from '../lib/common.js';
import { postInquiry } from '../lib/inbox.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  res.setHeader('Cache-Control', 'no-store');
  const b = body(req);
  const raw = b.fields && typeof b.fields === 'object' ? b.fields : {};
  const fields = {};
  for (const [k, v] of Object.entries(raw).slice(0, 20)) if (typeof v === 'string' && v.trim()) fields[String(k).slice(0, 60)] = v.slice(0, 3000);
  const email = String(fields.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'email' });
  // Bots: filled the hidden field, or submitted faster than a person could type. Pretend it worked.
  if (b.hp || (Number(b.t) > 0 && Number(b.t) < 2500)) return res.status(200).json({ ok: true });
  try {
    await postInquiry(b.kind === 'trade' ? 'trade' : 'contact', fields, String(b.page || ''));
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('inquiry', e.message);
    return res.status(502).json({ error: 'slack' }); // the page falls back to Shopify's normal email
  }
}
