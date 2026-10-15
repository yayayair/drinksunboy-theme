// Intuit redirects here after an admin clicks "Connect to QuickBooks" on the trade admin page.
import { checkState, connect } from '../../lib/qbo.js';
import { loadCustomer } from '../../lib/trade.js';

export default async function handler(req, res) {
  const q = req.query || {};
  const page = msg => res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(
    `<!doctype html><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:40px;max-width:520px;margin:auto">
     <h2>QuickBooks</h2><p>${msg}</p><p><a href="https://drinksunboy.com/pages/trade-admin">Back to trade admin</a></p>`);
  try {
    const cid = checkState(q.state);
    if (!cid) return page('That link expired. Start again from the trade admin page.');
    const me = await loadCustomer(cid);
    if (!me?.admin) return page('Only trade admins can connect QuickBooks.');
    if (q.error) return page('QuickBooks connection was cancelled.');
    await connect(String(q.code || ''), String(q.realmId || ''), me.name);
    return page('Connected. Invoices are only created when you click “Create invoice”, and they are never sent automatically.');
  } catch (e) {
    console.error('qbo/callback', e.message);
    return page('Couldn’t connect: ' + String(e.message).replace(/[<>]/g, '').slice(0, 200));
  }
}
