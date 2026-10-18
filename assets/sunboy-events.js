/* SUNBOY events: shared helpers for the Events page, the homepage strip and the Find Us map.
   Data comes from the finder service (/api/events), which reads the Connecteam schedule. */
(function () {
  if (window.SBEvents) return;
  var cache = {};
  function load(api) {
    api = String(api || 'https://sunboy-finder.vercel.app').replace(/\/$/, '');
    if (!cache[api]) {
      cache[api] = fetch(api + '/api/events').then(function (r) { return r.json(); })
        .then(function (d) { return (d && d.events) || []; })
        .catch(function () { return []; });
    }
    return cache[api];
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function parts(date, tz, opts) {
    try { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz }, opts)).format(date); }
    catch (e) { return new Intl.DateTimeFormat('en-US', opts).format(date); }
  }
  function ymd(date, tz) { return parts(date, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }); }
  function clock(date, tz) {
    // "4:00 PM" -> "4pm", "4:30 PM" -> "4:30pm"
    return parts(date, tz, { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(/\s?([AP])M/, function (m, a) { return a.toLowerCase() + 'm'; });
  }
  function timeRange(e) {
    var s = new Date(e.start), en = new Date(e.end), a = clock(s, e.tz), b = clock(en, e.tz);
    if (a.slice(-2) === b.slice(-2)) a = a.slice(0, -2);
    var zone = parts(s, e.tz, { timeZoneName: 'short' }).split(' ').pop();
    var mine = parts(s, undefined, { timeZoneName: 'short' }).split(' ').pop();
    return a + '–' + b + (zone !== mine ? ' ' + zone : '');
  }
  function status(e, now) {
    now = now || new Date();
    var s = new Date(e.start), en = new Date(e.end);
    var live = s <= now && now < en;
    var today = ymd(s, e.tz) === ymd(now, e.tz);
    var tomorrow = ymd(s, e.tz) === ymd(new Date(now.getTime() + 864e5), e.tz);
    var days = (s - now) / 864e5;
    return { live: live, today: today || live, tomorrow: tomorrow && !today, days: days, over: en <= now };
  }
  function dayLabel(e, long) {
    var st = status(e), s = new Date(e.start);
    if (st.live) return 'Happening now';
    if (st.today) return 'Today';
    if (st.tomorrow) return 'Tomorrow';
    return parts(s, e.tz, long ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function dateTile(e) {
    var s = new Date(e.start);
    return { dow: parts(s, e.tz, { weekday: 'short' }), day: parts(s, e.tz, { day: 'numeric' }), mon: parts(s, e.tz, { month: 'short' }) };
  }
  function place(e) { return [e.city, e.state].filter(Boolean).join(', '); }
  function dirUrl(e) { return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(e.title + ', ' + e.address); }
  function stamp(d) { return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function gcal(e) {
    return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
      action: 'TEMPLATE', text: 'SUNBOY at ' + e.title, dates: stamp(e.start) + '/' + stamp(e.end),
      location: e.address, details: e.blurb + '\n\nhttps://drinksunboy.com/pages/events'
    });
  }
  function ics(e) {
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SUNBOY//Events//EN', 'BEGIN:VEVENT',
      'UID:' + e.id + '@drinksunboy.com', 'DTSTAMP:' + stamp(new Date()), 'DTSTART:' + stamp(e.start), 'DTEND:' + stamp(e.end),
      'SUMMARY:' + ('SUNBOY at ' + e.title).replace(/[,;]/g, '\\$&'), 'LOCATION:' + String(e.address).replace(/[,;]/g, '\\$&'),
      'DESCRIPTION:' + String(e.blurb).replace(/[,;]/g, '\\$&'), 'URL:https://drinksunboy.com/pages/events', 'END:VEVENT', 'END:VCALENDAR'];
    return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
  }
  function miles(a, b) {
    var R = 3958.8, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function who(e, max) {
    if (!e.people || !e.people.length) return '';
    var names = e.people.map(function (p) { return p.name; });
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' & ' + names[1];
    if (names.length === 3) return names[0] + ', ' + names[1] + ' & ' + names[2];
    return names[0] + ', ' + names[1] + ' & the crew';
  }
  function headline(e) {
    var w = who(e);
    return w ? 'Meet ' + w + ' at ' + e.title : (e.kind === 'tasting' ? 'Tasting at ' + e.title : e.title);
  }
  var SUN = '<svg class="sb-sun" viewBox="0 0 40 40" aria-hidden="true"><g fill="currentColor">' +
    [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(function (a) { return '<rect x="18.6" y="1" width="2.8" height="7" rx="1.4" transform="rotate(' + a + ' 20 20)"/>'; }).join('') +
    '</g><circle cx="20" cy="20" r="9" fill="currentColor"/></svg>';
  function jsonLd(events) {
    var data = events.slice(0, 30).map(function (e) {
      return {
        '@context': 'https://schema.org', '@type': 'Event', name: 'SUNBOY at ' + e.title, startDate: e.start, endDate: e.end,
        eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: { '@type': 'Place', name: e.title, address: e.address, geo: { '@type': 'GeoCoordinates', latitude: e.lat, longitude: e.lng } },
        description: e.blurb, organizer: { '@type': 'Organization', name: 'SUNBOY Spiked Coconut Water', url: 'https://drinksunboy.com' },
        isAccessibleForFree: true, image: ['https://drinksunboy.com/cdn/shop/files/Favicon.png']
      };
    });
    var s = document.createElement('script'); s.type = 'application/ld+json'; s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
  }
  function where(api) {
    api = String(api || 'https://sunboy-finder.vercel.app').replace(/\/$/, '');
    return Promise.race([
      fetch(api + '/api/where').then(function (r) { return r.json(); }).catch(function () { return {}; }),
      new Promise(function (res) { setTimeout(function () { res({}); }, 2500); })
    ]).then(function (w) { return isFinite(w.lat) && isFinite(w.lng) ? w : null; });
  }
  window.SBEvents = { load: load, where: where, esc: esc, timeRange: timeRange, status: status, dayLabel: dayLabel, dateTile: dateTile, place: place,
    dirUrl: dirUrl, gcal: gcal, ics: ics, miles: miles, who: who, headline: headline, SUN: SUN, jsonLd: jsonLd };
})();
