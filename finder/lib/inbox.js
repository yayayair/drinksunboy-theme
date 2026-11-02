// Website messages that need a follow-up land in Slack (#trade-orders unless SLACK_INBOX_CHANNEL says otherwise):
//  - "Request a trade account" on the Distributor Shop page → card with Approve / Decline.
//    Approve finds or creates the person in Shopify and tags them `trade` (distributor, 50% co-op by default).
//  - The general contact form → card with "Mark handled".
// Nobody outside SUNBOY is ever emailed from here. Replies to the person go out from holler@ by a human.
import * as slack from './slack.js';
import { gql, check, ADMIN_URL } from './shopify.js';

const clean = (v, n = 500) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SHOP_PAGE = 'https://drinksunboy.com/pages/sunboy-distributor-shop';

async function inboxChannel() {
  const c = String(process.env.SLACK_INBOX_CHANNEL || '').replace(/^#/, '').trim();
  return c ? (/^[CG][A-Z0-9]{6,}$/.test(c) ? c : (await slack.get('conversations.list', { limit: 1000, exclude_archived: true, types: 'public_channel,private_channel' })).channels.find(x => x.name === c)?.id) : slack.channel();
}

// fields: every contact[...] field from the form, as { label: value }
export async function postInquiry(kind, fields, page) {
  if (!slack.enabled()) throw new Error('Slack is not connected');
  const get = re => { const k = Object.keys(fields).find(k => re.test(k)); return k ? clean(fields[k], 1500) : ''; };
  const email = get(/^email$/i), name = get(/name/i), phone = get(/phone/i);
  const company = get(/distributor|company/i), message = get(/^(body|comment|message)$/i);
  const extra = Object.entries(fields).filter(([k]) => !/^(email|tags|request|body|comment|message)$/i.test(k) && !/name|phone|distributor|company/i.test(k))
    .map(([k, v]) => `*${esc(clean(k, 40))}:* ${esc(clean(v, 300))}`);
  const trade = kind === 'trade';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', emoji: true, text: (trade ? `Trade account request · ${company || name || email}` : `Website message · ${name || email}`).slice(0, 150) } },
    { type: 'section', fields: [
      `*Name*\n${esc(name) || '—'}`, `*Email*\n${email ? `<mailto:${email}|${esc(email)}>` : '—'}`,
      ...(trade ? [`*Distributor*\n${esc(company) || '—'}`] : []), `*Phone*\n${esc(phone) || '—'}`
    ].map(text => ({ type: 'mrkdwn', text })) }
  ];
  if (message || extra.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: [message ? `*Message*\n${esc(message)}` : '', ...extra].filter(Boolean).join('\n').slice(0, 2900) } });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Sent from ${esc(clean(page, 200)) || 'the website'}` }] });
  if (trade) {
    const value = JSON.stringify({ e: email, n: name, c: company, p: phone }).slice(0, 1900);
    blocks.push({ type: 'actions', block_id: 'inq_actions', elements: [
      { type: 'button', action_id: 'inq_approve', style: 'primary', text: { type: 'plain_text', text: 'Approve' }, value,
        confirm: { title: { type: 'plain_text', text: 'Give them access?' }, text: { type: 'mrkdwn', text: `${esc(email)} becomes a distributor customer in Shopify (50% co-op). Nobody is emailed.` }, confirm: { type: 'plain_text', text: 'Approve' }, deny: { type: 'plain_text', text: 'Cancel' } } },
      { type: 'button', action_id: 'inq_decline', style: 'danger', text: { type: 'plain_text', text: 'Decline' }, value: email || 'x' }
    ] });
    blocks.push({ type: 'context', block_id: 'inq_note', elements: [{ type: 'mrkdwn', text: 'Approve adds them in Shopify as a distributor (tag `trade`, 50% co-op). Nobody is emailed: tell them they can sign in at the Distributor Shop with this email. Or reply in this thread with *approve* / *decline*.' }] });
  } else {
    blocks.push({ type: 'actions', block_id: 'inq_actions', elements: [
      { type: 'button', action_id: 'inq_done', style: 'primary', text: { type: 'plain_text', text: 'Mark handled' }, value: email || 'x' }
    ] });
    blocks.push({ type: 'context', block_id: 'inq_note', elements: [{ type: 'mrkdwn', text: 'Reply to them from holler@drinksunboy.com, then mark it handled. Nobody is emailed automatically.' }] });
  }
  const text = trade ? `Trade account request from ${name || email}${company ? ' (' + company + ')' : ''}` : `Website message from ${name || email}`;
  return slack.api('chat.postMessage', { channel: await inboxChannel(), text, blocks, unfurl_links: false });
}

// Approve: find or create the customer and tag them `trade`. Returns { created, name, id, adminUrl }.
export async function approveApplicant(app) {
  const email = clean(app.e, 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That request has no valid email.');
  const d = await gql(`query($q: String!) { customers(first: 5, query: $q) { nodes { id displayName email tags } } }`, { q: `email:${JSON.stringify(email)}` });
  const hit = d.customers.nodes.find(c => String(c.email || '').toLowerCase() === email);
  if (hit) {
    const t = await gql(`mutation($id: ID!) { tagsAdd(id: $id, tags: ["trade"]) { userErrors { message } } }`, { id: hit.id });
    check(t.tagsAdd, 'tagsAdd');
    return { created: false, already: hit.tags.map(x => x.toLowerCase()).includes('trade'), name: hit.displayName, id: hit.id, adminUrl: `${ADMIN_URL}/customers/${hit.id.split('/').pop()}` };
  }
  const parts = clean(app.n, 120).split(' ');
  const input = {
    email, tags: ['trade'],
    firstName: parts[0] || undefined, lastName: parts.slice(1).join(' ') || undefined,
    note: [`Trade access requested on drinksunboy.com${app.c ? ' for ' + clean(app.c, 120) : ''}.`, app.p ? `Phone: ${clean(app.p, 40)}` : ''].filter(Boolean).join('\n')
  };
  const c = await gql(`mutation($input: CustomerInput!) { customerCreate(input: $input) { customer { id displayName } userErrors { field message } } }`, { input });
  const made = check(c.customerCreate, 'customerCreate').customer;
  return { created: true, name: made.displayName, id: made.id, adminUrl: `${ADMIN_URL}/customers/${made.id.split('/').pop()}` };
}

// A decision on a card (button or thread reply): swap the buttons for the outcome and note it in the thread.
export async function decideInquiry(action, value, who, where, blocks) {
  let line;
  try {
    if (action === 'approve') {
      const r = await approveApplicant(JSON.parse(value));
      line = `:white_check_mark: Approved by ${who}. ${r.created ? 'Added' : r.already ? 'Already set up as' : 'Tagged'} <${r.adminUrl}|${esc(r.name)}> as a distributor in Shopify (50% co-op). Let them know they can sign in at <${SHOP_PAGE}|the Distributor Shop> with this email.`;
    } else if (action === 'decline') {
      line = `:x: Declined by ${who}. They haven't been told.`;
    } else {
      line = `:white_check_mark: Handled by ${who}.`;
    }
  } catch (e) {
    console.error('inquiry', e.message);
    return slack.api('chat.postMessage', { channel: where.channel, thread_ts: where.ts, text: `:warning: Couldn't do that: ${e.message.slice(0, 200)}. You can add them in Shopify → Customers (tag \`trade\`).` });
  }
  if (blocks) {
    const kept = blocks.filter(b => b.block_id !== 'inq_actions' && b.block_id !== 'inq_note');
    kept.push({ type: 'context', elements: [{ type: 'mrkdwn', text: line }] });
    await slack.api('chat.update', { channel: where.channel, ts: where.ts, blocks: kept, text: line.replace(/<[^|>]+\|([^>]+)>/g, '$1') }).catch(e => console.error('inquiry update', e.message));
  }
  await slack.api('chat.postMessage', { channel: where.channel, thread_ts: where.ts, text: line.replace(/<[^|>]+\|([^>]+)>/g, '$1') });
}
