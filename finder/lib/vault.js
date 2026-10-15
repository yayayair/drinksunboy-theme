// Small encrypted store in a private shop metafield (never rendered by the theme). Used for the QuickBooks tokens.
import crypto from 'node:crypto';
import { gql, check } from './shopify.js';

const KEY = () => crypto.createHash('sha256').update(String(process.env.TRADE_SIGNING_KEY) + '|vault').digest();
const enc = obj => {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join('.');
};
const dec = str => {
  const [iv, tag, data] = String(str).split('.').map(b => Buffer.from(b, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', KEY(), iv); d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
};

let shopId = '';
export async function vaultGet(key) {
  const d = await gql(`query($k: String!) { shop { id metafield(namespace: "sunboy_private", key: $k) { value } } }`, { k: key });
  shopId = d.shop.id;
  const v = d.shop.metafield?.value;
  if (!v) return null;
  try { return dec(v); } catch { return null; }
}
export async function vaultSet(key, obj) {
  if (!shopId) await vaultGet(key);
  const d = await gql(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`,
    { m: [{ ownerId: shopId, namespace: 'sunboy_private', key, type: 'multi_line_text_field', value: enc(obj) }] });
  check(d.metafieldsSet, 'vault');
}
