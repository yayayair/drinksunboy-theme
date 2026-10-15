// Approval alerts. OFF until Yair approves the wording and channel: set SLACK_ALERTS=on and SLACK_WEBHOOK_URL in Vercel.
import { ADMIN_URL } from './shopify.js';

export function pendingMessage(person, r) {
  const q = r.quote;
  return {
    text: `New ${person.role === 'team' ? 'team' : 'carton'} order waiting for approval: ${r.name} from ${person.name}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${r.name}* from *${person.name}* is waiting for approval\nGoods at SUNBOY cost: *$${q.goods.toFixed(2)}*` } },
      { type: 'actions', elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Review & approve' }, url: 'https://drinksunboy.com/pages/trade-admin' },
        { type: 'button', text: { type: 'plain_text', text: 'Open draft in Shopify' }, url: `${ADMIN_URL}/draft_orders/${String(r.draftId).split('/').pop()}` }
      ] }
    ]
  };
}

export async function notifyPending(person, r) {
  if (process.env.SLACK_ALERTS !== 'on' || !process.env.SLACK_WEBHOOK_URL) return false;
  const res = await fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pendingMessage(person, r)) });
  return res.ok;
}
