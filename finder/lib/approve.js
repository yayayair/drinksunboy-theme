// Approve or deny a trade order waiting as a Shopify draft. Shared by the Trade Admin page and Slack.
//  - approve: completes the draft into a real order (Rack'd ships it). Test orders only get tagged; they never ship.
//  - deny: tags the draft "rejected" and notes who and why. The draft is kept for the record.
// Safe to call twice: a draft that's already been decided is reported, not changed.
import { gql, check } from './shopify.js';
import { complete } from './order.js';

const slug = s => String(s || 'admin').split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9-]/g, '') || 'admin';

export async function state(id) {
  const d = await gql(`query($id: ID!) { draftOrder(id: $id) { id name status tags note: note2 order { id name } } }`, { id });
  const o = d.draftOrder;
  if (!o) throw new Error('Order not found');
  const decided = o.status === 'COMPLETED' ? 'approved' : o.tags.includes('rejected') ? 'denied' : o.tags.includes('approved') ? 'approved' : '';
  return { ...o, test: o.tags.includes('trade-test'), decided };
}

export async function approve(id, by) {
  if (!String(id).includes('/DraftOrder/')) throw new Error('bad id');
  const s = await state(id);
  if (s.decided) return { ok: false, already: s.decided, name: s.order?.name || s.name, message: `${s.name} was already ${s.decided}.` };
  const tags = ['approved', `approved-by-${slug(by)}`];
  if (s.test) {
    const d = await gql(`mutation($id: ID!, $t: [String!]!) { tagsRemove(id: $id, tags: ["needs-approval"]) { userErrors { message } } tagsAdd(id: $id, tags: $t) { userErrors { message } } }`, { id, t: tags });
    check(d.tagsAdd, 'tagsAdd');
    return { ok: true, test: true, name: s.name, message: `${s.name} approved. It's a test order, so it stays a draft and never ships.` };
  }
  const order = await complete(id);
  const d = await gql(`mutation($id: ID!, $t: [String!]!) { tagsRemove(id: $id, tags: ["needs-approval"]) { userErrors { message } } tagsAdd(id: $id, tags: $t) { userErrors { message } } }`, { id: order.id, t: tags });
  check(d.tagsAdd, 'tagsAdd');
  return { ok: true, name: order.name, orderId: order.id, draftName: s.name, message: `${s.name} approved. It's now order ${order.name} and on its way to Rack'd.` };
}

export async function deny(id, by, reason = '') {
  if (!String(id).includes('/DraftOrder/')) throw new Error('bad id');
  const s = await state(id);
  if (s.decided) return { ok: false, already: s.decided, name: s.name, message: `${s.name} was already ${s.decided}.` };
  reason = String(reason || '').trim().slice(0, 300);
  const note = [s.note, `Not approved by ${by}${reason ? ': ' + reason : ''}`].filter(Boolean).join('\n');
  const d = await gql(`mutation($id: ID!, $input: DraftOrderInput!) { draftOrderUpdate(id: $id, input: $input) { userErrors { message } } }`,
    { id, input: { tags: s.tags.filter(t => t !== 'needs-approval').concat(['rejected', `rejected-by-${slug(by)}`]), note } });
  check(d.draftOrderUpdate, 'draftOrderUpdate');
  return { ok: true, name: s.name, test: s.test, message: `${s.name} marked not approved. The draft is kept for the record.` };
}
