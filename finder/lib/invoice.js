// Builds (and, only when an admin clicks, creates) the QuickBooks invoice for a trade order,
// in the bookkeeper's existing format: DocNumber "POS - SNB1464", one line per item at the distributor's share,
// location + class by the ship-to state. Created UNSENT. Test orders only invoice to a "ZZ TEST" customer.
import { gql, check } from './shopify.js';
import * as qbo from './qbo.js';
import { round2 } from './trade.js';

const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };

const FIELDS = isDraft => `id name createdAt tags ${isDraft ? 'note: note2' : 'note'} poNumber customAttributes { key value }
  shippingAddress { provinceCode company city }
  shippingLine { originalPriceSet { shopMoney { amount } } }
  customer { id displayName email tags qbo: metafield(namespace: "sunboy", key: "qbo_customer_id") { value } }
  lineItems(first: 100) { nodes { title quantity originalUnitPriceSet { shopMoney { amount } }
    product { id qbo: metafield(namespace: "sunboy", key: "qbo_item_id") { value } } } }`;

export async function loadTradeDoc(id) {
  const isDraft = id.includes('/DraftOrder/');
  const d = await gql(`query($id: ID!) { node(id: $id) { ... on ${isDraft ? 'DraftOrder' : 'Order'} { ${FIELDS(isDraft)} } } }`, { id });
  if (!d.node) throw new Error('Order not found');
  return { ...d.node, isDraft };
}

export async function preview(doc, qboCustomerId) {
  const tags = doc.tags.map(t => t.toLowerCase());
  const coopTag = tags.find(t => /^coop-\d+$/.test(t));
  const coop = coopTag ? Number(coopTag.slice(5)) : 50;
  const payPct = (100 - coop) / 100;
  const test = tags.includes('trade-test');
  const custId = qboCustomerId || doc.customer?.qbo?.value || '';
  const cust = custId ? await qbo.getCustomer(custId) : null;
  const problems = [];
  if (!cust) problems.push('Pick the QuickBooks customer for this distributor.');
  if (cust && test && !/^zz test/i.test(cust.DisplayName)) problems.push('Test orders can only be invoiced to a QuickBooks customer whose name starts with "ZZ TEST".');
  if (cust && !test && /^zz test/i.test(cust.DisplayName)) problems.push('That is the test customer; pick the real distributor.');
  if (coop >= 100) problems.push('This order is SUNBOY-covered, so there is nothing to invoice.');

  const lines = [];
  for (const l of doc.lineItems.nodes) {
    const item = await qbo.matchItem(l.title, l.product?.qbo?.value);
    const unit = Number(l.originalUnitPriceSet.shopMoney.amount);
    const rate = round2(unit * payPct);
    if (!item) problems.push(`No QuickBooks item matches "${l.title.replace(/\s*\(trade\)\s*$/i, '')}".`);
    lines.push({ title: l.title.replace(/\s*\(trade\)\s*$/i, ''), qty: l.quantity, unit, rate, amount: round2(rate * l.quantity), item: item ? { id: item.Id, name: item.FullyQualifiedName } : null });
  }
  const ship = Number(doc.shippingLine?.originalPriceSet?.shopMoney?.amount || 0);
  if (ship > 0) {
    const si = await qbo.shippingItem();
    if (!si) problems.push('No "Shipping & Handling" item in QuickBooks.');
    lines.push({ title: 'Shipping', qty: 1, unit: ship, rate: ship, amount: ship, item: si ? { id: si.Id, name: si.FullyQualifiedName } : null, shipping: true });
  }
  const stateName = STATES[doc.shippingAddress?.provinceCode] || '';
  const where = await qbo.locationFor(stateName);
  const num = doc.name.replace('#', '');
  return {
    docNumber: `${test ? 'TEST' : 'POS'} - ${num}`.slice(0, 21),
    date: doc.createdAt.slice(0, 10),
    customer: cust ? { id: cust.Id, name: cust.DisplayName } : null,
    location: where.dep ? where.dep.Name : '', klass: where.cls ? where.cls.Name : '',
    lines, total: round2(lines.reduce((s, l) => s + l.amount, 0)), coop, test, problems,
    memo: [doc.poNumber ? `PO ${doc.poNumber}` : '', `Shopify order ${doc.name}`].filter(Boolean).join(' · '),
    _where: where
  };
}

export async function create(doc, p) {
  if (p.problems.length) throw new Error(p.problems.join(' '));
  const existing = await qbo.invoiceByDoc(p.docNumber);
  if (existing) return { id: existing.Id, existed: true };
  const desc = doc.poNumber ? `PO ${doc.poNumber}` : `Shopify ${doc.name}`;
  const inv = {
    CustomerRef: { value: p.customer.id },
    DocNumber: p.docNumber,
    TxnDate: p.date,
    PrivateNote: `Created from the SUNBOY trade shop (${doc.name}). Co-op ${p.coop}%.`,
    CustomerMemo: { value: p.memo },
    EmailStatus: 'NotSet',
    Line: p.lines.map(l => ({
      DetailType: 'SalesItemLineDetail', Amount: l.amount, Description: l.shipping ? 'Shipping' : desc,
      SalesItemLineDetail: { ItemRef: { value: l.item.id }, Qty: l.qty, UnitPrice: l.rate, ...(p._where.cls ? { ClassRef: { value: p._where.cls.Id } } : {}) }
    }))
  };
  if (p._where.dep) inv.DepartmentRef = { value: p._where.dep.Id };
  const created = await qbo.createInvoice(inv);
  return { id: created.Id, existed: false };
}

// Remember the mapping and mark the Shopify order/draft as invoiced.
export async function markInvoiced(doc, invoiceId, qboCustomerId) {
  const mf = [{ ownerId: doc.id, namespace: 'sunboy', key: 'qbo_invoice_id', type: 'single_line_text_field', value: String(invoiceId) }];
  if (doc.customer && qboCustomerId && doc.customer.qbo?.value !== qboCustomerId)
    mf.push({ ownerId: doc.customer.id, namespace: 'sunboy', key: 'qbo_customer_id', type: 'single_line_text_field', value: String(qboCustomerId) });
  const d = await gql(`mutation($m: [MetafieldsSetInput!]!, $id: ID!) {
    metafieldsSet(metafields: $m) { userErrors { field message } }
    tagsAdd(id: $id, tags: ["invoiced"]) { userErrors { field message } }
    tagsRemove(id: $id, tags: ["invoice-ready"]) { userErrors { field message } } }`, { m: mf, id: doc.id });
  check(d.metafieldsSet, 'metafields'); check(d.tagsAdd, 'tagsAdd');
}
