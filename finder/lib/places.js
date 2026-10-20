// Puts each store where Google Maps has it. VIP's own coordinates are often approximate (street or ZIP level),
// so pins could land a block or more away. For every store we ask Google Places for that business at that
// address and, when Google's answer is clearly the same place, use Google's pin and address.
// Results are cached per store, so Google is asked about each store only now and then.
const TTL = 30 * 24 * 3600 * 1000, MAX_MOVE_KM = 3;
const cache = new Map();

const words = n => String(n || '').toLowerCase().replace(/&|\+/g, ' and ').replace(/['’`.]/g, '').split(/[^a-z0-9]+/)
  .filter(w => w.length > 1 && !/^(the|and|of|at|store|inc|llc|nyc|ny|co|company|shop|market|deli|bar|restaurant)$/.test(w));
function sameName(a, b) {
  const A = words(a), B = words(b);
  if (!A.length || !B.length) return false;
  const hit = A.filter(w => B.includes(w) || B.some(x => x.length > 3 && (x.startsWith(w) || w.startsWith(x)))).length;
  return hit / A.length >= 0.5;
}
const num = s => (String(s || '').match(/^\s*(\d+[a-z]?)/i) || [])[1] || '';
function km(a, b) {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function search(key, textQuery) {
  const body = { textQuery, maxResultCount: 1, regionCode: 'us' };
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName,places.location,places.addressComponents,places.formattedAddress,places.types' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`places ${r.status}`);
  return ((await r.json()).places || [])[0] || null;
}

const part = (p, type, short) => { const c = (p.addressComponents || []).find(c => (c.types || []).includes(type)); return c ? (short ? c.shortText : c.longText) : ''; };

// Returns { lat, lng, street?, city?, zip?, gname?, src } or null to keep VIP's data.
async function placeOne(key, s) {
  const id = `${s.name}|${s.street}|${s.zip}`.toLowerCase();
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const vipPt = Number.isFinite(s.lat) && Number.isFinite(s.lng) ? { lat: s.lat, lng: s.lng } : null;
  const addr = `${s.street}, ${s.city}, ${s.state} ${s.zip}`;
  // Google's answer has to be in the same ZIP as VIP's address (or, failing that, close to VIP's pin).
  // VIP's pins can be miles off, so its pin alone isn't a reason to reject Google.
  const sameArea = (p, pt) => String(part(p, 'postal_code')).slice(0, 5) === String(s.zip).slice(0, 5) || (vipPt && km(vipPt, pt) <= MAX_MOVE_KM);
  let v = null;
  try {
    // 1) the business itself
    const p = await search(key, `${s.name}, ${addr}`);
    const pt = p?.location && { lat: p.location.latitude, lng: p.location.longitude };
    const sameNumber = p && num(s.street) && num(s.street) === num(part(p, 'street_number'));
    if (pt && sameArea(p, pt) && (sameName(s.name, p.displayName?.text) || sameNumber)) {
      const street = [part(p, 'street_number'), part(p, 'route', true)].filter(Boolean).join(' ');
      v = { ...pt, src: 'google-place',
        ...(street && sameNumber ? { street } : {}),
        ...(sameName(s.name, p.displayName?.text) ? { gname: p.displayName.text } : {}) };
    } else {
      // 2) not found as a business: at least put the pin on the street address
      const a = await search(key, addr);
      const apt = a?.location && { lat: a.location.latitude, lng: a.location.longitude };
      if (apt && sameArea(a, apt) && num(s.street) && num(s.street) === num(part(a, 'street_number'))) v = { ...apt, src: 'google-address' };
    }
    if (!v) console.log('places: kept VIP pin for', JSON.stringify({ name: s.name, addr, vip: vipPt, google: p ? { name: p.displayName?.text, zip: part(p, 'postal_code'), num: part(p, 'street_number'), at: pt } : null }));
  } catch (e) { console.error('places', e.message); return null; } // don't cache failures
  cache.set(id, { at: Date.now(), v });
  if (cache.size > 20000) cache.clear();
  return v;
}

// Corrects a list of stores in place (in parallel, a few at a time). Never fails the search.
export async function placeStores(stores) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !stores.length) return stores;
  let i = 0;
  const worker = async () => {
    while (i < stores.length) {
      const s = stores[i++];
      const v = await placeOne(key, s);
      if (!v) continue;
      s.vipLat = s.lat; s.vipLng = s.lng;
      s.lat = Math.round(v.lat * 1e6) / 1e6; s.lng = Math.round(v.lng * 1e6) / 1e6;
      if (v.street) s.street = v.street;
      if (v.gname) s.gname = v.gname;
      s.located = v.src;
    }
  };
  await Promise.race([
    Promise.all(Array.from({ length: 12 }, worker)),
    new Promise(r => setTimeout(r, 6000)) // never hold a search up for long; unplaced stores keep VIP's pin
  ]);
  return stores;
}

export { km };
