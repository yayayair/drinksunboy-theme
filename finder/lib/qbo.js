// QuickBooks Online: OAuth connection + the few calls the trade shop needs.
// Invoices are created UNSENT (EmailStatus NotSet). Nothing here ever emails or sends an invoice.
import crypto from 'node:crypto';
import { vaultGet, vaultSet } from './vault.js';

const ID = () => process.env.QBO_CLIENT_ID, SECRET = () => process.env.QBO_CLIENT_SECRET;
export const REDIRECT = 'https://sunboy-finder.vercel.app/api/qbo/callback';
const EXPECTED_REALM = process.env.QBO_REALM || '9130351807689026'; // SUNBOY's QuickBooks company
const BASE = () => process.env.QBO_ENV === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com';
const MINOR = 'minorversion=75';

export function state(cid) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', String(process.env.TRADE_SIGNING_KEY)).update(`qbo.${cid}.${ts}`).digest('hex');
  return `${cid}.${ts}.${sig}`;
}
export function checkState(s) {
  const [cid, ts, sig] = String(s || '').split('.');
  if (!cid || !ts || !sig || Date.now() / 1000 - Number(ts) > 900) return null;
  const want = crypto.createHmac('sha256', String(process.env.TRADE_SIGNING_KEY)).update(`qbo.${cid}.${ts}`).digest('hex');
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig)) ? cid : null;
}

// Endpoints come from Intuit's discovery document (cached), with the documented defaults as a fallback.
const DISCOVERY = () => process.env.QBO_ENV === 'sandbox'
  ? 'https://developer.api.intuit.com/.well-known/openid_sandbox_configuration'
  : 'https://developer.api.intuit.com/.well-known/openid_configuration';
let disco = { at: 0, auth: 'https://appcenter.intuit.com/connect/oauth2', token: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer' };
export async function endpoints() {
  if (Date.now() - disco.at < 24 * 3600_000) return disco;
  try {
    const d = await (await fetch(DISCOVERY())).json();
    if (d.authorization_endpoint && d.token_endpoint) disco = { at: Date.now(), auth: d.authorization_endpoint, token: d.token_endpoint };
  } catch (e) { console.error('qbo discovery', e.message); }
  return disco;
}

export async function authorizeUrl(cid) {
  const e = await endpoints();
  return e.auth + '?' + new URLSearchParams({
    client_id: ID(), response_type: 'code', scope: 'com.intuit.quickbooks.accounting', redirect_uri: REDIRECT, state: state(cid)
  });
}

async function tokenCall(params) {
  const r = await fetch((await endpoints()).token, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${ID()}:${SECRET()}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    console.error('qbo token error', JSON.stringify({ status: r.status, intuit_tid: r.headers.get('intuit_tid') || '', error: d.error || '' }));
    const err = new Error(`QuickBooks token ${r.status}: ${d.error || ''}`);
    err.reconnect = d.error === 'invalid_grant' || r.status === 400 || r.status === 401;
    throw err;
  }
  return d;
}

export async function connect(code, realmId, by) {
  if (String(realmId) !== EXPECTED_REALM) throw new Error('That isn’t the SUNBOY QuickBooks company.');
  const d = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT });
  await vaultSet('qbo', { realmId, access: d.access_token, accessExp: Date.now() + d.expires_in * 1000, refresh: d.refresh_token, by, at: new Date().toISOString() });
}

async function session() {
  const v = await vaultGet('qbo');
  if (!v) throw new Error('QuickBooks isn’t connected yet.');
  if (v.needsReconnect) throw new Error('QuickBooks needs to be reconnected. Use “Reconnect QuickBooks” at the top of this page.');
  if (Date.now() < v.accessExp - 120_000) return v;
  let d;
  try { d = await tokenCall({ grant_type: 'refresh_token', refresh_token: v.refresh }); }
  catch (e) {
    if (e.reconnect) { await vaultSet('qbo', { ...v, needsReconnect: true }); throw new Error('QuickBooks needs to be reconnected. Use “Reconnect QuickBooks” at the top of this page.'); }
    throw e;
  }
  const nv = { ...v, access: d.access_token, accessExp: Date.now() + d.expires_in * 1000, refresh: d.refresh_token || v.refresh };
  await vaultSet('qbo', nv);
  return nv;
}

export async function status() {
  const v = await vaultGet('qbo').catch(() => null);
  if (!v) return { connected: false };
  return v.needsReconnect ? { connected: false, reconnect: true, by: v.by } : { connected: true, by: v.by, at: v.at };
}

async function api(path, init = {}) {
  const s = await session();
  const r = await fetch(`${BASE()}/v3/company/${s.realmId}/${path}${path.includes('?') ? '&' : '?'}${MINOR}`, {
    ...init, headers: { Authorization: `Bearer ${s.access}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && !init._retried) { // access token rejected early: refresh once, then retry
    await vaultSet('qbo', { ...s, accessExp: 0 });
    return api(path, { ...init, _retried: true });
  }
  if (!r.ok) {
    const tid = r.headers.get('intuit_tid') || '';
    console.error('qbo api error', JSON.stringify({ status: r.status, path: path.split('?')[0], intuit_tid: tid, fault: d.Fault || d }).slice(0, 1500));
    throw new Error(`QuickBooks ${r.status}${tid ? ' (intuit_tid ' + tid + ')' : ''}: ${JSON.stringify(d.Fault || d).slice(0, 300)}`);
  }
  return d;
}
export const query = async q => (await api('query?query=' + encodeURIComponent(q))).QueryResponse || {};
const esc = s => String(s).replace(/'/g, "\\'");

export async function findCustomers(name) {
  const r = await query(`select Id, DisplayName, PrimaryEmailAddr from Customer where Active = true and DisplayName like '%${esc(name)}%' maxresults 15`);
  return (r.Customer || []).map(c => ({ id: c.Id, name: c.DisplayName, email: c.PrimaryEmailAddr?.Address || '' }));
}
export async function getCustomer(id) {
  const r = await query(`select Id, DisplayName from Customer where Id = '${esc(id)}'`);
  return (r.Customer || [])[0] || null;
}

let itemCache = { at: 0, items: [] };
export async function items() {
  if (Date.now() - itemCache.at < 10 * 60_000 && itemCache.items.length) return itemCache.items;
  const r = await query(`select Id, Name, FullyQualifiedName, Type from Item where Active = true maxresults 1000`);
  itemCache = { at: Date.now(), items: r.Item || [] };
  return itemCache.items;
}
const norm = s => String(s || '').toLowerCase().replace(/\(trade\)/g, '').replace(/^sunboy\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
export async function matchItem(title, override) {
  const all = await items();
  if (override) return all.find(i => i.Id === String(override)) || null;
  const t = norm(title);
  return all.find(i => norm(i.Name) === t) || all.find(i => norm(i.FullyQualifiedName.split(':').pop()) === t) || null;
}
export async function shippingItem() {
  const all = await items();
  return all.find(i => /^shipping (&|and) handling$/i.test(i.Name)) || all.find(i => /^shipping$/i.test(i.Name)) || null;
}
export async function locationFor(stateName) {
  if (!stateName) return {};
  const [deps, classes] = await Promise.all([
    query(`select Id, Name from Department where Active = true maxresults 200`).catch(() => ({})),
    query(`select Id, Name from Class where Active = true maxresults 500`).catch(() => ({}))
  ]);
  const dep = (deps.Department || []).find(d => d.Name.toLowerCase() === stateName.toLowerCase());
  const cls = (classes.Class || []).find(c => c.Name.toLowerCase() === stateName.toLowerCase());
  return { dep, cls };
}
export async function invoiceByDoc(doc) {
  const r = await query(`select Id, DocNumber, TotalAmt from Invoice where DocNumber = '${esc(doc)}'`);
  return (r.Invoice || [])[0] || null;
}
export async function createInvoice(inv) {
  return (await api('invoice', { method: 'POST', body: JSON.stringify(inv) })).Invoice;
}
export const invoiceLink = id => `https://qbo.intuit.com/app/invoice?txnId=${id}`;
