// Public SUNBOY events built from the Connecteam schedule.
// Rules (agreed with Yair, Oct 2026):
//  - A shift is public when its Job is a tasting/event job (In-Store Sampling, Event(s), Event (Day Rate), Total Wine…),
//    it is published, someone is assigned, and its title doesn't contain "private".
//  - Internal jobs (SUNBOY Tasks, Manager Test, packing…) never show.
//  - Shift notes are internal and are never returned. The public blurb is written from the job type.
//  - People only appear when their Connecteam profile has a "Show on website" field set to yes; first name only,
//    plus profile photo and an optional "Website bio" field. Everyone else is "the SUNBOY crew".
import * as cteam from './connecteam.js';

const PUBLIC_JOB = /sampl|event|total wine|tasting|festival|activation/i;
const INTERNAL_JOB = /task|test|pack|admin|office|training|warehouse|private/i;
const TTL = 10 * 60 * 1000;
let cache = null, inflight = null;
const geo = new Map();

const strip = s => String(s || '').replace(/\s+/g, ' ').trim();
const truthy = v => {
  if (Array.isArray(v)) return v.some(truthy);
  if (v && typeof v === 'object') return truthy(v.value ?? v.name ?? v.label ?? v.text);
  return /^(yes|true|y|1|on|show)$/i.test(String(v ?? '').trim());
};
const fieldValue = f => {
  const v = f.value ?? f.values ?? f.selectedOptions ?? f.options ?? f.text;
  if (Array.isArray(v)) return v.map(x => (x && typeof x === 'object') ? (x.value ?? x.name ?? x.label ?? '') : x).join(', ');
  if (v && typeof v === 'object') return v.value ?? v.name ?? v.label ?? '';
  return v ?? '';
};
const fieldName = f => String(f.name || f.customFieldName || f.title || '');

function person(u) {
  const fields = u.customFields || [];
  const show = fields.find(f => /website|web site|site/i.test(fieldName(f)) && /show|public|display|feature|appear/i.test(fieldName(f)));
  if (!show || !truthy(fieldValue(show))) return null;
  const bio = fields.find(f => /bio/i.test(fieldName(f)));
  return {
    name: strip(u.firstName).split(' ')[0] || 'SUNBOY crew',
    photo: u.profilePictureUrl || '',
    bio: bio ? strip(fieldValue(bio)).slice(0, 400) : ''
  };
}

// "URL for Event (For SUNBOY Website)" shift field → public link (http/https only).
function eventUrl(sh) {
  const f = (sh.customFields || []).find(f => /url|link|website|ticket/i.test(fieldName(f)));
  let v = f ? strip(fieldValue(f)) : '';
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
  try { const u = new URL(v); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : ''; } catch { return ''; }
}

function kindOf(jobTitle, title) {
  if (/fest|concert|series|amphi|stadium|night|party|pool|parade|market\b|fair|race|game|show|acl|pride/i.test(title)) return 'event';
  if (/sampl|tasting/i.test(jobTitle)) return 'tasting';
  return 'event';
}
const BLURB = {
  tasting: 'Free tastings in store. Come say hi, try the lineup and grab your favorite. 21+ to taste.',
  event: 'Find the SUNBOY crew, grab an ice-cold can and say hi. 21+.'
};

function cityState(address) {
  const m = String(address || '').match(/,\s*([^,]+?),\s*([A-Z]{2})\b(?:\s*\d{5})?/);
  return m ? { city: m[1].trim(), state: m[2] } : { city: '', state: '' };
}

async function locate(title, address, lat, lng) {
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const cs = cityState(address);
    if (cs.city) return { lat, lng, ...cs, address };
  }
  const key = `${title}|${address}`.toLowerCase();
  if (geo.has(key)) return geo.get(key);
  let out = { lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null, ...cityState(address), address };
  const gkey = process.env.GOOGLE_PLACES_API_KEY;
  if (gkey && (out.lat === null || !out.city)) {
    try {
      const body = { textQuery: [title, address].filter(Boolean).join(', '), regionCode: 'us', maxResultCount: 1 };
      if (out.lat !== null) body.locationBias = { circle: { center: { latitude: out.lat, longitude: out.lng }, radius: 2000 } };
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': gkey, 'X-Goog-FieldMask': 'places.location,places.formattedAddress' },
        body: JSON.stringify(body)
      });
      const p = (await r.json().catch(() => ({}))).places?.[0];
      if (p?.location) {
        const fa = String(p.formattedAddress || '').replace(/, USA$/, '');
        out = { lat: out.lat ?? p.location.latitude, lng: out.lng ?? p.location.longitude, ...cityState(fa + ', USA'), address: out.address && /\d{5}/.test(out.address) ? out.address : fa };
      }
    } catch (e) { console.error('events geocode', e.message); }
  }
  geo.set(key, out);
  if (geo.size > 1000) geo.clear();
  return out;
}

async function build() {
  const now = Math.floor(Date.now() / 1000);
  const [scheds, jobsRes, users] = await Promise.all([
    cteam.schedulers(),
    cteam.all('/jobs/v1/jobs', { limit: 100 }, 'jobs').catch(() => []),
    cteam.all('/users/v1/users', {}, 'users').catch(() => [])
  ]);
  const jobs = {};
  // Sub-jobs (e.g. "Events / Full day") are matched by their full path. Job titles carry pay info, so they're never published.
  const walk = (j, path) => { const t = [...path, j.title || '']; jobs[j.jobId] = t.join(' / '); (j.subJobs || []).forEach(s => walk(s, t)); };
  jobsRes.forEach(j => walk(j, []));
  const people = {};
  users.forEach(u => { if (!u.isArchived) people[u.userId] = person(u); });

  const shifts = [];
  for (const s of scheds.filter(s => !s.isArchived)) {
    const list = await cteam.shifts(s.schedulerId, now - 12 * 3600, now + 75 * 86400, { isPublished: true });
    shifts.push(...list);
  }

  const groups = new Map();
  for (const sh of shifts) {
    const title = strip(sh.title);
    const job = jobs[sh.jobId] || '';
    if (!title || /private/i.test(title)) continue;
    if (!sh.isPublished || !(sh.assignedUserIds || []).length) continue;
    if (INTERNAL_JOB.test(job) || !PUBLIC_JOB.test(job)) continue;
    if (sh.endTime < now) continue;
    const gps = sh.locationData?.gps || {};
    const address = strip(gps.address);
    const key = [title.toLowerCase(), sh.startTime, address.toLowerCase()].join('|');
    let g = groups.get(key);
    if (!g) {
      g = { title, job, start: sh.startTime, end: sh.endTime, tz: sh.timezone || 'America/New_York', address, lat: Number(gps.latitude), lng: Number(gps.longitude), users: new Set(), url: '' };
      groups.set(key, g);
    }
    g.end = Math.max(g.end, sh.endTime);
    if (!g.url) g.url = eventUrl(sh);
    sh.assignedUserIds.forEach(id => g.users.add(id));
  }

  const events = [];
  for (const [key, g] of groups) {
    const where = await locate(g.title, g.address, g.lat, g.lng);
    if (!Number.isFinite(where.lat) || !Number.isFinite(where.lng)) continue;
    const kind = kindOf(g.job, g.title);
    const crew = [...g.users].map(id => people[id]).filter(Boolean);
    events.push({
      id: Buffer.from(key).toString('base64url').slice(0, 16) + g.start.toString(36),
      title: g.title, kind, label: kind === 'tasting' ? 'In-store tasting' : 'Event', blurb: BLURB[kind],
      start: new Date(g.start * 1000).toISOString(), end: new Date(g.end * 1000).toISOString(), tz: g.tz,
      address: where.address || g.address, city: where.city, state: where.state,
      lat: Math.round(where.lat * 1e5) / 1e5, lng: Math.round(where.lng * 1e5) / 1e5,
      people: crew, url: g.url
    });
  }
  events.sort((a, b) => a.start.localeCompare(b.start));
  return { updated: new Date().toISOString(), events };
}

export async function publicEvents() {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (!inflight) inflight = build().then(body => { cache = { at: Date.now(), body }; return body; }).finally(() => { inflight = null; });
  try { return await inflight; }
  catch (e) { if (cache) return cache.body; throw e; }
}
