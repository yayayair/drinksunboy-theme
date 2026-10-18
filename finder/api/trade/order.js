// POST /api/trade/order  { t, lines: [{ variantId, qty }], addressId | address, po, note, market, reason, purpose }
// Every order is posted to Slack #trade-orders. Distributor orders go straight to Rack'd (alert only);
// team orders and cartons wait there (and on Trade Admin) for approval.
import { guard, body } from '../../lib/common.js';
import { verifyToken, loadCustomer } from '../../lib/trade.js';
import { placeOrder } from '../../lib/order.js';
import * as slack from '../../lib/slack.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  res.setHeader('Cache-Control', 'no-store');
  const b = body(req);
  const cid = verifyToken(b.t);
  if (!cid) return res.status(401).json({ error: 'Please sign in again.' });
  try {
    const person = await loadCustomer(cid);
    if (!person || person.role === 'none') return res.status(403).json({ error: 'This account isn’t set up for trade ordering yet.' });
    const r = await placeOrder(person, b);
    if (!r.ok) return res.status(400).json({ error: r.error });
    await slack.postOrder(r.card).catch(e => console.error('slack post', e.message));
    delete r.card;
    return res.status(200).json(r);
  } catch (e) {
    console.error('trade/order', e.message);
    return res.status(502).json({ error: 'We couldn’t place that order. Nothing was charged. Try again in a minute.' });
  }
}
