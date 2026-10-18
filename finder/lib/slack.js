// #trade-orders in Slack: one message per trade order, with Approve / Deny buttons.
// Needs SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET (from the "SUNBOY Trade Orders" Slack app) and, optionally,
// SLACK_CHANNEL (a channel ID or name; default "trade-orders"). Without a token nothing is posted.
// Who may decide: Slack users whose Slack email belongs to a Shopify customer tagged trade-admin,
// or whose Slack user ID is listed in SLACK_APPROVERS (comma-separated).
import crypto from 'node:crypto';
import { gql, ADMIN_URL } from './shopify.js';

const TOKEN = () => String(process.env.SLACK_BOT_TOKEN || '').trim();
export const enabled = () => !!TOKEN();

export async function api(method, payload) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${TOKEN()}` },
    body: JSON.stringify(payload)
  });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new Error(`Slack ${method}: ${d.error || r.status}`);
  return d;
}

// Slack request signing (v0). Rejects anything older than 5 minutes.
export function verify(raw, headers) {
  const secret = String(process.env.SLACK_SIGNING_SECRET || '').trim();
  const ts = headers['x-slack-request-timestamp'], sig = String(headers['x-slack-signature'] || '');
  if (!secret || !ts || !sig.startsWith('v0=')) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const want = 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex');
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

let chanCache = '';
export async function channel() {
  const want = String(process.env.SLACK_CHANNEL || 'trade-orders').replace(/^#/, '').trim();
  if (/^[CG][A-Z0-9]{6,}$/.test(want)) return want;
  if (chanCache) return chanCache;
  let cursor = '';
  do {
    const d = await api('conversations.list', { limit: 1000, exclude_archived: true, types: 'public_channel,private_channel', cursor });
    const hit = (d.channels || []).find(c => c.name === want);
    if (hit) return (chanCache = hit.id);
    cursor = d.response_metadata?.next_cursor || '';
  } while (cursor);
  throw new Error(`Slack channel #${want} not found (invite the SUNBOY Trade Orders app to it)`);
}

const money = n => '$' + Number(n || 0).toFixed(2);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const draftUrl = id => `${ADMIN_URL}/draft_orders/${String(id).split('/').pop()}`;
const orderUrl = id => `${ADMIN_URL}/orders/${String(id).split('/').pop()}`;

// The order card. `decision` replaces the buttons once someone has approved or denied.
export function card(o, decision) {
  const team = o.role === 'team';
  const kind = team ? 'Team order (SUNBOY-paid)' : `Distributor order, co-op ${o.quote.coop}%`;
  const headline = `${o.test ? '[TEST] ' : ''}${o.name} · ${o.person.name}`;
  const fields = [
    `*From*\n${esc(o.person.name)}${o.person.email ? `\n${esc(o.person.email)}` : ''}`,
    `*Type*\n${kind}`,
    `*Goods at SUNBOY cost*\n${money(o.quote.goods)}`,
    `*${o.quote.covered ? 'Paid by' : 'Billed to distributor'}*\n${o.quote.covered ? 'SUNBOY' : money(o.quote.total) + ' (Net 30)'}`,
    `*Ship to*\n${esc([o.ship?.company || o.ship?.name, o.ship?.city, o.ship?.provinceCode].filter(Boolean).join(', ')) || '—'}`,
    `*Shipping*\n${o.quote.shipping ? money(o.quote.shipping) : 'Free'}`
  ];
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: headline.slice(0, 150), emoji: true } },
    { type: 'section', fields: fields.map(text => ({ type: 'mrkdwn', text })) },
    { type: 'section', text: { type: 'mrkdwn', text: '*Items*\n' + o.items.map(i => `• ${i.qty}× ${esc(i.title)}${i.unit != null ? ` (${money(i.unit)} ea.)` : ''}`).join('\n').slice(0, 2900) } }
  ];
  const extra = [];
  if (o.po) extra.push(`*PO:* ${esc(o.po)}`);
  if (o.market) extra.push(`*Market / distributor:* ${esc(o.market)}`);
  if (o.reason) extra.push(`*Why the distributor hasn't bought it:* ${esc(o.reason)}`);
  if (o.purpose) extra.push(`*What it's for:* ${esc(o.purpose)}`);
  if (o.note) extra.push(`*Note:* ${esc(o.note)}`);
  if (extra.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: extra.join('\n').slice(0, 2900) } });
  if (o.test) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: ':test_tube: Test account: approving only tags the draft. It never ships.' }] });

  if (!o.needsApproval) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `:package: Sent straight to Rack'd. <${orderUrl(o.id)}|Open in Shopify>` }] });
  } else if (decision) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: decision }] });
  } else {
    blocks.push({ type: 'actions', block_id: 'trade_decision', elements: [
      { type: 'button', action_id: 'approve', style: 'primary', text: { type: 'plain_text', text: 'Approve' }, value: o.id,
        confirm: { title: { type: 'plain_text', text: 'Approve this order?' }, text: { type: 'mrkdwn', text: o.test ? 'Test order: it gets tagged approved and never ships.' : `${o.name} goes to Rack'd to ship.` }, confirm: { type: 'plain_text', text: 'Approve' }, deny: { type: 'plain_text', text: 'Cancel' } } },
      { type: 'button', action_id: 'deny', style: 'danger', text: { type: 'plain_text', text: 'Deny' }, value: o.id },
      { type: 'button', action_id: 'open', text: { type: 'plain_text', text: 'Open in Shopify' }, url: draftUrl(o.id) }
    ] });
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Or reply in this thread with *approve*, or *deny* and a reason (e.g. "deny: already sent last month").' }] });
  }
  const text = `${o.needsApproval ? 'Needs approval: ' : 'New order: '}${headline}`;
  return { text, blocks };
}

// Post a new order; remembers where the message lives on the draft so either side can update it later.
export async function postOrder(o) {
  if (!enabled()) return null;
  const ch = await channel();
  const r = await api('chat.postMessage', { channel: ch, ...card(o), unfurl_links: false });
  const payload = JSON.stringify({ channel: r.channel, ts: r.ts, card: slim(o) });
  await gql(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { message } } }`,
    { m: [{ ownerId: o.id, namespace: 'sunboy', key: 'slack_message', type: 'json', value: payload }] }).catch(e => console.error('slack metafield', e.message));
  return r;
}

const slim = o => ({ id: o.id, name: o.name, test: o.test, role: o.role, needsApproval: o.needsApproval, quote: o.quote,
  person: { name: o.person.name, email: o.person.email }, ship: o.ship, items: o.items, po: o.po, market: o.market, reason: o.reason, purpose: o.purpose, note: o.note });

export async function savedMessage(draftId) {
  const d = await gql(`query($id: ID!) { draftOrder(id: $id) { m: metafield(namespace: "sunboy", key: "slack_message") { value } } }`, { id: draftId });
  try { return JSON.parse(d.draftOrder?.m?.value || 'null'); } catch { return null; }
}

// After a decision (from Slack or the Trade Admin page): swap the buttons for the outcome and note it in the thread.
export async function recordDecision(draftId, line, saved) {
  if (!enabled()) return;
  saved = saved || await savedMessage(draftId);
  if (!saved?.ts) return;
  await api('chat.update', { channel: saved.channel, ts: saved.ts, ...card(saved.card, line) });
  await api('chat.postMessage', { channel: saved.channel, thread_ts: saved.ts, text: line.replace(/<[^|>]+\|([^>]+)>/g, '$1') });
}

export function decisionLine(action, r, who, reason) {
  if (r.already) return `:information_source: ${r.message}`;
  if (action === 'approve') return r.orderId
    ? `:white_check_mark: Approved by ${who}. Now order <${orderUrl(r.orderId)}|${r.name}>, on its way to Rack'd.`
    : `:white_check_mark: Approved by ${who} (test order: stays a draft, never ships).`;
  return `:x: Denied by ${who}${reason ? `: ${reason}` : '.'}`;
}

// Is this Slack user allowed to approve? Cached per warm instance.
const who = new Map();
export async function approver(userId) {
  const hit = who.get(userId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit;
  let out = null;
  try {
    const u = (await api('users.info', { user: userId })).user || {};
    const name = u.profile?.first_name || u.real_name?.split(' ')[0] || u.name || 'someone';
    const list = String(process.env.SLACK_APPROVERS || '').split(',').map(s => s.trim()).filter(Boolean);
    let ok = list.includes(userId);
    const email = u.profile?.email;
    if (!ok && email) {
      const d = await gql(`query($q: String!) { customers(first: 5, query: $q) { nodes { email tags } } }`, { q: `email:${JSON.stringify(email)}` });
      ok = d.customers.nodes.some(c => String(c.email).toLowerCase() === email.toLowerCase() && c.tags.map(t => t.toLowerCase()).includes('trade-admin'));
    }
    out = { ok, name, at: Date.now() };
  } catch (e) { console.error('slack approver', e.message); return { ok: false, name: 'someone' }; }
  who.set(userId, out);
  if (who.size > 200) who.clear();
  return out;
}
