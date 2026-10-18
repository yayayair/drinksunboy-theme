// POST /api/slack — Slack calls this for button clicks (Interactivity), the Deny form, and thread replies (Events).
// Every request is checked against SLACK_SIGNING_SECRET. Slack wants an answer within 3 seconds, so the work
// (completing the Shopify order, updating the message) carries on after we reply.
import { waitUntil } from '@vercel/functions';
import * as slack from '../lib/slack.js';
import { approve, deny } from '../lib/approve.js';

export const config = { api: { bodyParser: false } };

// Reads the exact bytes Slack signed. Never touch req.body first: that would parse (and change) them.
function readRaw(req) {
  return new Promise((ok, fail) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', c => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => ok(s));
    req.on('error', fail);
  });
}

function parse(raw, ctype) {
  if (/json/.test(ctype)) { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
  const p = new URLSearchParams(raw);
  if (p.get('payload')) { try { return JSON.parse(p.get('payload')); } catch { return {}; } }
  return Object.fromEntries(p);
}

const APPROVE = /^\s*(approve|approved|ship it|:white_check_mark:|✅)(?=$|[\s.!,:])/i;
const DENY = /^\s*(deny|denied|reject|rejected|decline|declined)(?=$|[\s.!,:\-–—])[\s:,.!\-–—]*(.*)$/is;

async function decide(action, id, who, reason, where) {
  const saved = await slack.savedMessage(id).catch(() => null);
  const thread = where || (saved && { channel: saved.channel, ts: saved.ts });
  try {
    const r = action === 'approve' ? await approve(id, who) : await deny(id, who, reason);
    const line = slack.decisionLine(action, r, who, reason);
    if (r.already) {
      if (thread) await slack.api('chat.postMessage', { channel: thread.channel, thread_ts: thread.ts, text: line });
      return;
    }
    if (saved) await slack.recordDecision(id, line, saved);
    else if (thread) await slack.api('chat.postMessage', { channel: thread.channel, thread_ts: thread.ts, text: line });
  } catch (e) {
    console.error('slack decide', e.message);
    if (thread) await slack.api('chat.postMessage', { channel: thread.channel, thread_ts: thread.ts,
      text: `:warning: Couldn't ${action} that order: ${e.message.slice(0, 200)}. Try again, or use the Trade Admin page.` }).catch(() => {});
  }
}

const nope = (channel, ts, user) => slack.api('chat.postEphemeral', { channel, user, thread_ts: ts,
  text: 'Only trade admins (Yair and Sam) can approve or deny trade orders.' }).catch(() => {});

// Thread reply on an order message: "approve" or "deny: reason".
async function onMessage(ev) {
  if (ev.type !== 'message' || ev.subtype || ev.bot_id || !ev.thread_ts || ev.thread_ts === ev.ts) return;
  const text = String(ev.text || '').trim();
  const isDeny = DENY.exec(text), isApprove = !isDeny && APPROVE.test(text) && text.split(/\s+/).length <= 4;
  if (!isDeny && !isApprove) return;
  const h = await slack.get('conversations.history', { channel: ev.channel, latest: ev.thread_ts, inclusive: true, limit: 1 });
  const parent = (h.messages || [])[0];
  if (!parent || !parent.bot_id) return;
  const actions = (parent.blocks || []).find(b => b.block_id === 'trade_decision');
  const id = actions?.elements?.find(e => e.action_id === 'approve')?.value;
  if (!id) {
    if ((parent.blocks || []).length && /trade|order/i.test(parent.text || '')) await slack.api('chat.postMessage', { channel: ev.channel, thread_ts: ev.thread_ts, text: ':information_source: This order has already been decided.' });
    return;
  }
  const me = await slack.approver(ev.user);
  if (!me.ok) return nope(ev.channel, ev.thread_ts, ev.user);
  await decide(isDeny ? 'deny' : 'approve', id, me.name, isDeny ? isDeny[2].trim() : '', { channel: ev.channel, ts: ev.thread_ts });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const raw = await readRaw(req);
  const data = parse(raw, String(req.headers['content-type'] || ''));
  const signedOk = slack.verify(raw, req.headers);

  // Slack checks the URL once when the app is set up (before the signing secret is in Vercel).
  if (data.type === 'url_verification') {
    if (process.env.SLACK_SIGNING_SECRET && !signedOk) return res.status(401).end();
    return res.status(200).json({ challenge: data.challenge });
  }
  if (!signedOk) return res.status(401).json({ error: 'bad signature' });
  if (req.headers['x-slack-retry-num']) return res.status(200).end(); // we already took it the first time

  if (data.type === 'event_callback') {
    waitUntil(onMessage(data.event || {}).catch(e => console.error('slack event', e.message)));
    return res.status(200).end();
  }

  if (data.type === 'block_actions') {
    const a = (data.actions || [])[0] || {};
    const channel = data.channel?.id, ts = data.message?.ts, user = data.user?.id;
    if (a.action_id !== 'approve' && a.action_id !== 'deny') return res.status(200).end();
    const me = await slack.approver(user);
    if (!me.ok) { waitUntil(nope(channel, ts, user)); return res.status(200).end(); }
    if (a.action_id === 'approve') {
      waitUntil(decide('approve', a.value, me.name, '', { channel, ts }));
      return res.status(200).end();
    }
    try {
      await slack.api('views.open', { trigger_id: data.trigger_id, view: {
        type: 'modal', callback_id: 'deny_order', private_metadata: JSON.stringify({ id: a.value, channel, ts }),
        title: { type: 'plain_text', text: 'Deny order' }, submit: { type: 'plain_text', text: 'Deny' }, close: { type: 'plain_text', text: 'Cancel' },
        blocks: [{ type: 'input', block_id: 'reason', optional: true, label: { type: 'plain_text', text: 'Reason (kept on the order in Shopify)' },
          element: { type: 'plain_text_input', action_id: 'reason', multiline: true, max_length: 300 } }]
      } });
    } catch (e) { console.error('slack modal', e.message); }
    return res.status(200).end();
  }

  if (data.type === 'view_submission' && data.view?.callback_id === 'deny_order') {
    let meta = {}; try { meta = JSON.parse(data.view.private_metadata || '{}'); } catch {}
    const me = await slack.approver(data.user?.id);
    if (!me.ok) return res.status(200).json({ response_action: 'errors', errors: { reason: 'Only trade admins can deny orders.' } });
    const reason = data.view.state?.values?.reason?.reason?.value || '';
    waitUntil(decide('deny', meta.id, me.name, reason.trim(), meta.channel ? { channel: meta.channel, ts: meta.ts } : null));
    return res.status(200).end();
  }
  return res.status(200).end();
}
