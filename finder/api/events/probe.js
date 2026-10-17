// TEMPORARY read-only look at the Connecteam setup, used once to wire up events. Delete after setup.
import crypto from 'node:crypto';
import * as cteam from '../../lib/connecteam.js';
const H = '6bd5faefa83d187b65f2918f529594b09cc08e7506681e0332c6b19b3f35f80d';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const k = String((req.query || {}).k || '');
  if (crypto.createHash('sha256').update(k).digest('hex') !== H) return res.status(404).json({ error: 'not found' });
  try {
      // Read-only look at the Connecteam setup so events can be wired up. Admins only.
      if (!cteam.hasKey()) return res.status(200).json({ ok: false, error: 'CONNECTEAM_API_KEY is not set' });
      const out = { ok: true, schedulers: [] };
      const scheds = await cteam.schedulers();
      const now = Math.floor(Date.now() / 1000);
      for (const s of scheds.slice(0, 10)) {
        const sid = s.schedulerId ?? s.id;
        const row = { id: sid, name: s.name, keys: Object.keys(s) };
        try {
          const list = await cteam.shifts(sid, now - 14 * 86400, now + 60 * 86400);
          row.shiftCount = list.length;
          row.shiftKeys = list[0] ? Object.keys(list[0]) : [];
          row.sample = list.slice(0, 3).map(x => JSON.parse(JSON.stringify(x, (k, v) => (/user|name|phone|email/i.test(k) && typeof v === 'string' && k !== 'title') ? '[hidden]' : v)));
          row.titles = [...new Set(list.map(x => x.title).filter(Boolean))].slice(0, 40);
        } catch (e) { row.shiftError = `${e.status || ''} ${e.detail || e.message}`; }
        try { const l = await cteam.ct(`/scheduler/v1/schedulers/${sid}/shift_layers`); row.layers = l?.data || l; } catch (e) { row.layerError = `${e.status || ''} ${e.detail || e.message}`; }
        out.schedulers.push(row);
      }
      try { const j = await cteam.ct('/jobs/v1/jobs', { limit: 100 }); out.jobs = (j?.data?.jobs || []).map(x => ({ id: x.jobId ?? x.id, title: x.title, keys: Object.keys(x) })); } catch (e) { out.jobsError = `${e.status || ''} ${e.detail || e.message}`; }
      try { const u = await cteam.ct('/users/v1/users', { limit: 5 }); const list = u?.data?.users || []; out.userKeys = list[0] ? Object.keys(list[0]) : []; out.userCustomFields = list[0]?.customFields?.map(f => f.name || f.customFieldName) || []; } catch (e) { out.usersError = `${e.status || ''} ${e.detail || e.message}`; }
      return res.status(200).json(out);

  } catch (e) { return res.status(502).json({ error: `${e.status || ''} ${e.detail || e.message}` }); }
}
