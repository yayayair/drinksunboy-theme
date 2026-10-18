// Turns a cart into a Shopify draft order with SUNBOY's trade rules:
//  - prices are SUNBOY cost (the trade product price); "co-op %" is SUNBOY's share, the distributor pays the rest
//    (co-op 50 → distributor pays half; co-op 100 → SUNBOY pays it all, no invoice)
//  - every order waits for approval by default (SETTINGS.approveAll); team (rsm/internal) orders are 100% SUNBOY-paid
//  - items tagged requires-approval (cartons) also wait for approval
//  - shipping is free when the order's goods total is at least $100 (SETTINGS.freeShipMin), otherwise a flat rate
//  - orders that owe money are "payment pending, Net 30" and tagged invoice-ready for the QuickBooks queue
//  - test customers (tag trade-test) only ever get drafts: never completed, never shipped
import { gql, check } from './shopify.js';
import { catalog, catalogFor, SETTINGS, round2 } from './trade.js';

export function price(person, lines, items) {
  const allowed = catalogFor(person, items);
  const byVariant = new Map();
  allowed.forEach(p => p.variants.forEach(v => byVariant.set(v.id, { p, v })));
  const out = [], problems = [];
  for (const l of lines || []) {
    const hit = byVariant.get(l.variantId), qty = Math.floor(Number(l.qty));
    if (!hit) { problems.push('An item in your cart is no longer available.'); continue; }
    if (!(qty > 0)) continue;
    if (qty > hit.v.available) { problems.push(`Only ${hit.v.available} left of ${hit.p.title}${hit.v.title ? ' (' + hit.v.title + ')' : ''}.`); continue; }
    out.push({ ...hit, qty, lineTotal: round2(hit.v.price * qty) });
  }
  const goods = round2(out.reduce((s, l) => s + l.lineTotal, 0));
  const coop = person.coop;
  const covered = coop >= 100;
  const share = round2(goods * (100 - coop) / 100); // what the distributor owes for the goods
  const shipping = covered || goods >= SETTINGS.freeShipMin || !out.length ? 0 : SETTINGS.shipUnder;
  const total = round2(share + shipping);
  const approval = SETTINGS.approveAll || person.role === 'team' || out.some(l => l.p.approval);
  return { lines: out, goods, coop, share, shipping, total, covered, approval, problems };
}

const toAddress = a => ({
  firstName: a.firstName || '', lastName: a.lastName || '', company: a.company || '',
  address1: a.address1 || '', address2: a.address2 || '', city: a.city || '',
  provinceCode: a.provinceCode || '', zip: a.zip || '', countryCode: a.countryCodeV2 || a.countryCode || 'US', phone: a.phone || ''
});

export async function placeOrder(person, req) {
  const items = await catalog(true);
  const q = price(person, req.lines, items);
  if (q.problems.length) return { ok: false, error: q.problems.join(' ') };
  if (!q.lines.length) return { ok: false, error: 'Your cart is empty.' };

  let addr = person.addresses.find(a => a.id === req.addressId);
  if (!addr && req.address) addr = req.address;
  if (!addr || !addr.address1 || !addr.city || !addr.zip) return { ok: false, error: 'Add a shipping address.' };

  const team = person.role === 'team';
  if (team && (!String(req.market || '').trim() || !String(req.reason || '').trim()))
    return { ok: false, error: 'Tell us the market and why it’s needed.' };

  const attrs = [['Placed by', `${person.name} (${person.email})`], ['Order type', team ? 'Team (SUNBOY-paid)' : `Distributor co-op ${q.coop}%`]];
  if (req.po) attrs.push(['PO number', req.po]);
  if (team) {
    attrs.push(['Market / distributor', req.market]);
    attrs.push(['Why the distributor hasn’t bought it', req.reason]);
    if (req.purpose) attrs.push(['What it’s for', req.purpose]);
  }
  const tags = ['trade-order', team ? 'team-order' : 'distributor-order', `coop-${q.coop}`];
  if (q.approval) tags.push('needs-approval');
  if (q.covered) tags.push('sunboy-covered'); else tags.push('invoice-ready');
  if (person.test) tags.push('trade-test');

  const input = {
    purchasingEntity: { customerId: person.id },
    email: person.email,
    lineItems: q.lines.map(l => ({ variantId: l.v.id, quantity: l.qty })),
    appliedDiscount: q.coop > 0 ? {
      valueType: 'PERCENTAGE', value: q.coop,
      title: q.covered ? 'SUNBOY-covered' : `SUNBOY co-op ${q.coop}%`,
      description: q.covered ? 'Paid by SUNBOY' : `SUNBOY pays ${q.coop}% of POS cost`
    } : undefined,
    shippingLine: { title: q.shipping ? 'Trade shipping' : 'Free trade shipping', priceWithCurrency: { amount: q.shipping.toFixed(2), currencyCode: 'USD' } },
    shippingAddress: toAddress(addr),
    customAttributes: attrs.map(([key, value]) => ({ key, value: String(value).slice(0, 500) })),
    note: String(req.note || '').slice(0, 1000) || null,
    poNumber: req.po ? String(req.po).slice(0, 60) : null,
    tags,
    taxExempt: true,
    visibleToCustomer: false
  };
  if (!q.covered) input.paymentTerms = { paymentTermsTemplateId: SETTINGS.netTermsTemplate, paymentSchedules: [{ issuedAt: new Date().toISOString() }] };
  const d = await gql(`mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) {
    draftOrder { id name totalPriceSet { shopMoney { amount } } } userErrors { field message } } }`, { input });
  const draft = check(d.draftOrderCreate, 'draftOrderCreate').draftOrder;

  // What the Slack alert shows.
  const card = {
    role: person.role, test: person.test, quote: summary(q), person: { name: person.name, email: person.email },
    ship: { company: addr.company || [addr.firstName, addr.lastName].filter(Boolean).join(' '), city: addr.city, provinceCode: addr.provinceCode },
    items: q.lines.map(l => ({ title: l.p.title + (l.v.title ? ` (${l.v.title})` : ''), qty: l.qty, unit: l.v.price })),
    po: req.po ? String(req.po).slice(0, 60) : '', note: String(req.note || '').slice(0, 1000),
    market: team ? String(req.market).slice(0, 300) : '', reason: team ? String(req.reason).slice(0, 500) : '', purpose: team ? String(req.purpose || '').slice(0, 300) : ''
  };
  if (q.approval || person.test) {
    return { ok: true, status: person.test ? 'test' : 'pending', name: draft.name, draftId: draft.id, quote: summary(q),
      card: { ...card, id: draft.id, name: draft.name, needsApproval: true } };
  }
  const order = await complete(draft.id);
  return { ok: true, status: 'placed', name: order.name, orderId: order.id, quote: summary(q),
    card: { ...card, id: order.id, name: order.name, needsApproval: false } };
}

export async function complete(draftId) {
  const d = await gql(`mutation($id: ID!) { draftOrderComplete(id: $id) { draftOrder { id order { id name } } userErrors { field message } } }`, { id: draftId });
  return check(d.draftOrderComplete, 'draftOrderComplete').draftOrder.order;
}

export function summary(q) {
  return { goods: q.goods, coop: q.coop, share: q.share, shipping: q.shipping, total: q.total, covered: q.covered, approval: q.approval };
}
