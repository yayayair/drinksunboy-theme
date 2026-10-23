// Puts each store where its street address really is. VIP's own coordinates are often approximate
// (sometimes miles off), so every store's address is looked up once with Google's Geocoding API
// (the cheap one) and the answer is saved for good in a small file in Vercel Blob storage.
// After that, the same store never costs another Google lookup.
//
// Saved file: finder/store-locations.json  →  { "<name|street|zip>": { lat, lng, at } | { none: 1, at } }
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

const comp = (r, type) => (r.address_components || []).find(c => (c.types || []).includes(type));

// One Geocoding API call per store, ever. Returns { lat, lng } or { none: 1 }; null = try again later.
async function geocode(key, s) {
  if (Date.now() < deniedUntil) return null;
  const addr = `${s.street}, ${s.city}, ${s.state} ${s.zip}`;
  const r = await fetch('https://maps.googleapis.com/maps/api/geocode/json?' + new URLSearchParams({ address: addr, components: 'country:US', key }));
  const d = await r.json().catch(() => ({}));
  if (d.status === 'REQUEST_DENIED' || d.status === 'OVER_DAILY_LIMIT' || d.status === 'OVER_QUERY_LIMIT') {
    deniedUntil = Date.now() + 10 * 60 * 1000;
    console.error('geocode', d.status, String(d.error_message || '').slice(0, 160));
    return null;
  }
  if (d.status === 'ZERO_RESULTS') return { none: 1 };
  if (d.status !== 'OK' || !d.results?.[0]) return null;
  const g = d.results[0];
  const pt = { lat: g.geometry.location.lat, lng: g.geometry.location.lng };
  const vipPt = Number.isFinite(s.lat) && Number.isFinite(s.lng) ? { lat: s.lat, lng: s.lng } : null;
  const sameZip = String(comp(g, 'postal_code')?.short_name || '').slice(0, 5) === String(s.zip).slice(0, 5);
  const sameNumber = !num(s.street) || num(s.street) === num(comp(g, 'street_number')?.short_name);
  const precise = g.geometry.location_type !== 'APPROXIMATE'; // APPROXIMATE = just the town or ZIP, no better than VIP
  if (precise && sameNumber && (sameZip || (vipPt && km(vipPt, pt) <= MAX_MOVE_KM))) return pt;
  console.log('places: kept VIP pin for', JSON.stringify({ name: s.name, addr, got: g.formatted_address, type: g.geometry.location_type }));
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
  s.located = 'google';
}

export { km };
