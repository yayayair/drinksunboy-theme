// Puts each store where Google Maps has it, with Google's spelling of its name and street. VIP's own
// coordinates are often approximate (sometimes miles off). Each store is looked up on Google Places ONCE,
// and the answer is saved for good in a small file in Vercel Blob storage, so the same store never costs
// another Google lookup. (Without this, every search re-asked Google about every store: that was the $242.)
//
// Saved file: finder/store-locations.json  →  { "<name|street|zip>": { lat, lng, street?, gname?, at } | { none: 1, at } }
import { get, put } from '@vercel/blob';
import { waitUntil } from '@vercel/functions';

const FILE = 'finder/store-locations.json';
const RETRY_MISS_MS = 30 * 24 * 3600 * 1000;   // a store Google couldn't place is retried after 30 days
const MAX_MOVE_KM = 3;

let saved = null, loading = null, fresh = {}, saving = null, deniedUntil = 0;

const idOf = s => `${s.name}|${s.street}|${s.zip}`.toLowerCase();
const num = s => (String(s || '').match(/^\s*(\d+[a-z]?)/i) || [])[1] || '';
function km(a, b) {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function readFile() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return {};
  try {
    const r = await get(FILE, { access: 'public', useCache: false });
    if (!r || r.statusCode !== 200) return {};
    return JSON.parse(await new Response(r.stream).text()) || {};
  } catch (e) {
    if (!/not.?found/i.test(e.message || e.name || '')) console.error('places load', e.message);
    return {};
  }
}
async function load() {
  if (saved) return saved;
  if (!loading) loading = readFile().then(d => (saved = d)).finally(() => { loading = null; });
  return loading;
}

// Merge what this instance learned into the saved file (re-reading first, so other instances' work is kept).
async function save() {
  if (!process.env.BLOB_READ_WRITE_TOKEN || !Object.keys(fresh).length) return;
  const batch = fresh; fresh = {};
  try {
    const latest = await readFile();
    const merged = { ...latest, ...batch };
    await put(FILE, JSON.stringify(merged), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 });
    saved = merged;
  } catch (e) {
    console.error('places save', e.message);
    fresh = { ...batch, ...fresh }; // try again next time
  }
}
function scheduleSave() {
  if (saving) return;
  saving = save().finally(() => { saving = null; });
  try { waitUntil(saving); } catch {}
}

const part = (p, type, short) => { const c = (p.addressComponents || []).find(c => (c.types || []).includes(type)); return c ? (short ? c.shortText : c.longText) : ''; };
const words = n => String(n || '').toLowerCase().replace(/&|\+/g, ' and ').replace(/['’`.]/g, '').split(/[^a-z0-9]+/)
  .filter(w => w.length > 1 && !/^(the|and|of|at|store|inc|llc|nyc|ny|co|company|shop|market|deli|bar|restaurant)$/.test(w));
function sameName(a, b) {
  const A = words(a), B = words(b);
  if (!A.length || !B.length) return false;
  return A.filter(w => B.includes(w) || B.some(x => x.length > 3 && (x.startsWith(w) || w.startsWith(x)))).length / A.length >= 0.5;
}

async function search(key, textQuery) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName,places.location,places.addressComponents' },
    body: JSON.stringify({ textQuery, maxResultCount: 1, regionCode: 'us' })
  });
  if (r.status === 403 || r.status === 429) { deniedUntil = Date.now() + 10 * 60 * 1000; console.error('places', r.status); return undefined; }
  if (!r.ok) throw new Error(`places ${r.status}`);
  return ((await r.json()).places || [])[0] || null;
}

// One Google Places lookup per store, ever (two if Google doesn't know the business and we fall back to the
// street address). Returns { lat, lng, street?, gname? } or { none: 1 }; null = couldn't ask Google, try later.
async function geocode(key, s) {
  if (Date.now() < deniedUntil) return null;
  const addr = `${s.street}, ${s.city}, ${s.state} ${s.zip}`;
  const vipPt = Number.isFinite(s.lat) && Number.isFinite(s.lng) ? { lat: s.lat, lng: s.lng } : null;
  const at = p => p?.location && { lat: p.location.latitude, lng: p.location.longitude };
  const sameArea = (p, pt) => String(part(p, 'postal_code')).slice(0, 5) === String(s.zip).slice(0, 5) || (vipPt && km(vipPt, pt) <= MAX_MOVE_KM);
  const sameNumber = p => num(s.street) && num(s.street) === num(part(p, 'street_number'));

  // 1) the business itself: Google's pin, street and proper name
  const p = await search(key, `${s.name}, ${addr}`);
  if (p === undefined) return null;
  const pt = at(p), named = p && sameName(s.name, p.displayName?.text);
  if (pt && sameArea(p, pt) && (named || sameNumber(p))) {
    const street = [part(p, 'street_number'), part(p, 'route', true)].filter(Boolean).join(' ');
    return { ...pt, ...(street && sameNumber(p) ? { street } : {}), ...(named ? { gname: p.displayName.text } : {}) };
  }
  // 2) not found as a business: at least put the pin on the street address
  const a = await search(key, addr);
  if (a === undefined) return null;
  const apt = at(a);
  if (apt && sameArea(a, apt) && sameNumber(a)) return apt;
  console.log('places: kept VIP pin for', JSON.stringify({ name: s.name, addr, google: p?.displayName?.text || null }));
  return { none: 1 };
}

// Corrects a list of stores in place. Never fails or noticeably slows a search.
export async function placeStores(stores) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!stores.length) return stores;
  const known = await load();
  const now = Date.now();
  const todo = [];
  for (const s of stores) {
    const v = fresh[idOf(s)] || known[idOf(s)];
    if (v && !v.none) apply(s, v);
    else if (!v || (v.none && now - v.at > RETRY_MISS_MS)) todo.push(s);
  }
  if (key && todo.length) {
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const s = todo[i++];
        try {
          const v = await geocode(key, s);
          if (!v) continue;
          fresh[idOf(s)] = { ...v, at: now };
          if (!v.none) apply(s, v);
        } catch (e) { console.error('geocode', e.message); }
      }
    };
    await Promise.race([Promise.all(Array.from({ length: 10 }, worker)), new Promise(r => setTimeout(r, 6000))]);
    scheduleSave();
  }
  return stores;
}

function apply(s, v) {
  s.vipLat = s.lat; s.vipLng = s.lng;
  s.lat = Math.round(v.lat * 1e6) / 1e6; s.lng = Math.round(v.lng * 1e6) / 1e6;
  if (v.street) s.street = v.street;
  if (v.gname) s.gname = v.gname;
  s.located = 'google';
}

export { km };
