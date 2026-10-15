// Shopify Admin API client for the SUNBOY Trade app (Dev Dashboard app, client-credentials grant).
// Tokens last 24h; we cache one per warm function instance and refresh before it expires.
const SHOP = process.env.SHOPIFY_SHOP || 'sunboy-powered-by-taprm.myshopify.com';
const API = '2025-07';
let tok = { value: '', exp: 0 };

async function token() {
  if (tok.value && Date.now() < tok.exp - 60_000) return tok.value;
  const id = process.env.SHOPIFY_CLIENT_ID, secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Shopify app credentials missing');
  const r = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: id, client_secret: secret, grant_type: 'client_credentials' })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Shopify token ${r.status}: ${JSON.stringify(d).slice(0, 200)}`);
  tok = { value: d.access_token, exp: Date.now() + (Number(d.expires_in) || 86399) * 1000 };
  return tok.value;
}

export async function gql(query, variables = {}) {
  const r = await fetch(`https://${SHOP}/admin/api/${API}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await token() },
    body: JSON.stringify({ query, variables })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.errors) throw new Error(`Shopify ${r.status}: ${JSON.stringify(d.errors || d).slice(0, 300)}`);
  return d.data;
}

// Throws on mutation userErrors so callers can't miss them.
export function check(payload, label) {
  const errs = payload && (payload.userErrors || []);
  if (errs.length) throw new Error(`${label}: ${errs.map(e => e.message).join('; ')}`);
  return payload;
}

export const SHOP_DOMAIN = SHOP;
export const ADMIN_URL = 'https://admin.shopify.com/store/' + SHOP.replace('.myshopify.com', '');
