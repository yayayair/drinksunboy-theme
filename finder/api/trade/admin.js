// Admin queue for people tagged trade-admin (Yair, Sam).
// GET  ?t=           → orders waiting for approval, orders ready to invoice, QuickBooks status
// POST { t, action } → approve | reject | preview | invoice | qbo-search
// Nothing here emails anyone. "invoice" creates an UNSENT QuickBooks invoice.
import { guard, body } from '../../lib/common.js';
import { verifyToken, loadCustomer } from '../../lib/trade.js';
import { gql, check, ADMIN_URL } from '../../lib/shopify.js';
import { approve, deny } from '../../lib/approve.js';
import * as slack from '../../lib/slack.js';
import * as qbo from '../../lib/qbo.js';
import { loadTradeDoc, preview, create, markInvoiced } from '../../lib/invoice.js';

const strip = t => t.replace(/\s*\(trade\)\s*$/i, '');
const attrsOf = o => Object.fromEntries((o.customAttributes || []).map(a => [a.key, a.value]));
const LIST_FOR = kind => `id name createdAt tags ${kind === 'draft' ? 'note: note2' : 'note'} poNumber customAttributes { key value }
  totalPriceSet { shopMoney { amount } } subtotalPriceSet { shopMoney { amount } }
  shippingAddress { name company address1 city provinceCode zip }
  customer { id displayName email qbo: metafield(namespace: "sunboy", key: "qbo_customer_id") { value } }
  lineItems(first: 50) { nodes { title quantity originalUnitPriceSet { shopMoney { amount } } } }`;

function shape(o, kind) {
  const id = o.id.split('/').pop();
  return {
    id: o.id, kind, name: o.name, date: o.createdAt, tags: o.tags, note: o.note || '', po: o.poNumber || '',
    attrs: attrsOf(o), total: Number(o.totalPriceSet.shopMoney.amount),
    goods: o.lineItems.nodes.reduce((s, l) => s + Number(l.originalUnitPriceSet.shopMoney.amount) * l.quantity, 0),
    customer: o.customer ? { name: o.customer.displayName, email: o.customer.email, qbo: o.customer.qbo?.value || '' } : null,
    ship: o.shippingAddress, test: o.tags.includes('trade-test'),
    items: o.lineItems.nodes.map(l => ({ title: strip(l.title), qty: l.quantity, unit: Number(l.originalUnitPriceSet.shopMoney.amount) })),
    adminUrl: `${ADMIN_URL}/${kind === 'draft' ? 'draft_orders' : 'orders'}/${id}`
  };
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  const b = req.method === 'POST' ? body(req) : req.query || {};
  const cid = verifyToken(b.t);
  if (!cid) return res.status(401).json({ error: 'Please sign in again.' });
  let me;
  try { me = await loadCustomer(cid); } catch (e) { return res.status(502).json({ error: 'Shopify is unavailable right now.' }); }
  if (!me?.admin) return res.status(403).json({ error: 'Admins only.' });

  try {
    if (req.method === 'GET') {
      const d = await gql(`{
        pending: draftOrders(first: 50, reverse: true, query: "tag:needs-approval AND status:open") { nodes { ${LIST_FOR('draft')} } }
        draftsReady: draftOrders(first: 50, reverse: true, query: "tag:trade-test AND tag:invoice-ready AND status:open") { nodes { ${LIST_FOR('draft')} } }
        ready: orders(first: 50, reverse: true, query: "tag:invoice-ready AND -tag:invoiced") { nodes { ${LIST_FOR('order')} } }
      }`);
      return res.status(200).json({
        me: { name: me.name },
        pending: d.pending.nodes.filter(o => o.tags.includes('needs-approval') && !o.tags.includes('rejected')).map(o => shape(o, 'draft')),
        ready: d.ready.nodes.filter(o => o.tags.includes('invoice-ready') && !o.tags.includes('invoiced')).map(o => shape(o, 'order')).concat(d.draftsReady.nodes.filter(o => o.tags.includes('invoice-ready') && !o.tags.includes('needs-approval') && !o.tags.includes('rejected')).map(o => shape(o, 'draft'))),
        qbo: await qbo.status(), qboConnectUrl: process.env.QBO_CLIENT_ID ? await qbo.authorizeUrl(cid) : ''
      });
    }

    const id = String(b.id || '');
    const by = me.firstName || me.name;
    if (b.action === 'approve') {
      const r = await approve(id, by);
      if (!r.already) await slack.recordDecision(id, slack.decisionLine('approve', r, by)).catch(e => console.error('slack', e.message));
      return res.status(r.already ? 409 : 200).json(r.already ? { error: r.message } : r);
    }
    if (b.action === 'reject') {
      const reason = String(b.reason || '').slice(0, 300);
      const r = await deny(id, by, reason);
      if (!r.already) await slack.recordDecision(id, slack.decisionLine('deny', r, by, reason)).catch(e => console.error('slack', e.message));
      return res.status(r.already ? 409 : 200).json(r.already ? { error: r.message } : r);
    }
    if (b.action === 'qbo-search') {
      return res.status(200).json({ customers: await qbo.findCustomers(String(b.q || '').slice(0, 60)) });
    }
    if (b.action === 'preview' || b.action === 'invoice') {
      const doc = await loadTradeDoc(id);
      const p = await preview(doc, b.qboCustomerId);
      const view = { ...p, _where: undefined };
      if (b.action === 'preview') return res.status(200).json({ preview: view });
      if (!b.confirm) return res.status(400).json({ error: 'Confirm first.' });
      const r = await create(doc, p);
      await markInvoiced(doc, r.id, p.customer.id);
      return res.status(200).json({ ok: true, existed: r.existed, invoiceId: r.id, link: qbo.invoiceLink(r.id),
        message: `${r.existed ? 'Already in' : 'Created in'} QuickBooks as ${p.docNumber} (not sent).` });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('trade/admin', e.message);
    return res.status(502).json({ error: e.message.slice(0, 300) });
  }
}
