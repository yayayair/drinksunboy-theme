// Who is asking, and what they may see and order.
// The theme signs "<customerId>.<unixTime>" with a key only the theme (shop metafield) and this service know.
import crypto from 'node:crypto';
import { gql } from './shopify.js';

const MAX_AGE = 24 * 3600;

export function verifyToken(t) {
  const key = process.env.TRADE_SIGNING_KEY;
  const m = /^(\d{5,20})\.(\d{9,11})\.([a-f0-9]{64})$/.exec(String(t || ''));
  if (!key || !m) return null;
  const [, cid, ts, sig] = m;
  const want = crypto.createHmac('sha256', key).update(`${cid}.${ts}`).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  const age = Date.now() / 1000 - Number(ts);
  if (age > MAX_AGE || age < -300) return null;
  return cid;
}

const CUSTOMER = `query($id: ID!) { customer(id: $id) {
  id displayName firstName lastName email phone tags
  coop: metafield(namespace: "sunboy", key: "coop_percent") { value }
  qbo: metafield(namespace: "sunboy", key: "qbo_customer_id") { value }
  defaultAddress { id }
  addressesV2(first: 10) { nodes { id company firstName lastName address1 address2 city provinceCode zip countryCodeV2 phone } }
} }`;

export async function loadCustomer(cid) {
  const d = await gql(CUSTOMER, { id: `gid://shopify/Customer/${cid}` });
  const c = d.customer;
  if (!c) return null;
  const tags = (c.tags || []).map(t => t.toLowerCase());
  const team = tags.includes('rsm') || tags.includes('internal');
  const trade = tags.includes('trade');
  const admin = tags.includes('trade-admin');
  const role = team ? 'team' : trade ? 'trade' : 'none';
  let coop = Number(c.coop?.value);
  if (!Number.isFinite(coop) || coop < 0 || coop > 100) coop = 50;
  if (role === 'team') coop = 100;
  return {
    id: c.id, num: cid, name: c.displayName, firstName: c.firstName || '', email: c.email, phone: c.phone,
    tags, role, admin, test: tags.includes('trade-test'), coop, qboCustomerId: c.qbo?.value || '',
    addresses: (c.addressesV2?.nodes || []).map(a => ({ ...a, isDefault: a.id === c.defaultAddress?.id }))
  };
}

const CATALOG = `query($cursor: String) { products(first: 100, after: $cursor, query: "tag:trade AND -status:archived") {
  pageInfo { hasNextPage endCursor }
  nodes { id title handle tags productType status descriptionHtml
    featuredImage { url altText }
    images(first: 4) { nodes { url altText } }
    variants(first: 30) { nodes { id title sku price inventoryQuantity selectedOptions { name value } } } } } }`;

let catCache = { at: 0, items: [] };
export async function catalog(force = false) {
  if (!force && Date.now() - catCache.at < 60_000) return catCache.items;
  let cursor = null, items = [];
  do {
    const d = await gql(CATALOG, { cursor });
    items = items.concat(d.products.nodes);
    cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (cursor);
  items = items.map(p => {
    const tags = p.tags.map(t => t.toLowerCase());
    return {
      id: p.id, title: p.title.replace(/\s*\(trade\)\s*$/i, ''), handle: p.handle, type: p.productType || 'Other',
      tags, distributorOnly: tags.includes('distributor-only'), teamOnly: tags.includes('team-only'),
      approval: tags.includes('requires-approval'),
      description: (p.descriptionHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
      image: p.featuredImage?.url || p.images.nodes[0]?.url || '',
      images: p.images.nodes.map(i => i.url),
      variants: p.variants.nodes.map(v => ({
        id: v.id, title: v.title === 'Default Title' ? '' : v.title, sku: v.sku,
        price: Number(v.price), available: Math.max(0, Number(v.inventoryQuantity) || 0)
      }))
    };
  }).filter(p => p.variants.length);
  catCache = { at: Date.now(), items };
  return items;
}

// What this person may see: distributors don't see team-only items; the team doesn't see distributor-only items (cartons).
export function catalogFor(person, items) {
  return items.filter(p => person.role === 'team' ? !p.distributorOnly : !p.teamOnly);
}

export const SETTINGS = {
  freeShipMin: Number(process.env.TRADE_FREE_SHIP_MIN || 100),
  shipUnder: Number(process.env.TRADE_SHIP_UNDER ?? 15),
  netTermsTemplate: process.env.TRADE_NET_TERMS || 'gid://shopify/PaymentTermsTemplate/4' // Net 30
};

export const round2 = n => Math.round(n * 100) / 100;
