// GET /api/trade/me?t=<signed token>  → who you are, your co-op %, addresses, the catalog you can order from,
// and your recent orders. Consumers (no trade/rsm/internal tag) get role "none" and nothing else.
import { guard } from '../../lib/common.js';
import { verifyToken, loadCustomer, catalog, catalogFor, SETTINGS } from '../../lib/trade.js';
import { gql } from '../../lib/shopify.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  const cid = verifyToken((req.query || {}).t);
  if (!cid) return res.status(401).json({ error: 'Please sign in again.' });
  try {
    const person = await loadCustomer(cid);
    if (!person || person.role === 'none') return res.status(200).json({ role: 'none', name: person?.firstName || '' });
    const [items, history] = await Promise.all([catalog(), recent(cid)]);
    return res.status(200).json({
      role: person.role, admin: person.admin, test: person.test,
      name: person.name, firstName: person.firstName, email: person.email, coop: person.coop,
      addresses: person.addresses,
      settings: { freeShipMin: SETTINGS.freeShipMin, shipUnder: SETTINGS.shipUnder, approveAll: SETTINGS.approveAll },
      catalog: catalogFor(person, items),
      history
    });
  } catch (e) {
    console.error('trade/me', e.message);
    return res.status(502).json({ error: 'The trade shop is taking a breather. Try again in a minute.' });
  }
}

async function recent(cid) {
  const d = await gql(`query($q: String!, $dq: String!) {
    orders(first: 10, reverse: true, query: $q) { nodes { name createdAt displayFinancialStatus displayFulfillmentStatus tags
      totalPriceSet { shopMoney { amount } } lineItems(first: 20) { nodes { title quantity } } } }
    draftOrders(first: 10, reverse: true, query: $dq) { nodes { name createdAt status tags
      totalPriceSet { shopMoney { amount } } lineItems(first: 20) { nodes { title quantity } } } }
  }`, { q: `customer_id:${cid}`, dq: `customer_id:${cid} AND status:open` });
  const strip = t => t.replace(/\s*\(trade\)\s*$/i, '');
  const orders = d.orders.nodes.map(o => ({
    name: o.name, date: o.createdAt, total: Number(o.totalPriceSet.shopMoney.amount),
    status: o.displayFulfillmentStatus === 'FULFILLED' ? 'Shipped' : o.displayFulfillmentStatus === 'UNFULFILLED' ? 'Processing' : o.displayFulfillmentStatus.replace(/_/g, ' ').toLowerCase(),
    items: o.lineItems.nodes.map(l => `${l.quantity}× ${strip(l.title)}`)
  }));
  const drafts = d.draftOrders.nodes.filter(o => o.tags.includes('trade-order')).map(o => ({
    name: o.name, date: o.createdAt, total: Number(o.totalPriceSet.shopMoney.amount),
    status: o.tags.includes('rejected') ? 'Not approved' : o.tags.includes('trade-test') ? 'Test (not shipped)' : 'Waiting for approval',
    items: o.lineItems.nodes.map(l => `${l.quantity}× ${strip(l.title)}`)
  }));
  return drafts.concat(orders);
}
