/* "You are here" on the Find Us map, in the style of Apple's Find My: a blue dot with a white ring,
   a soft pulse, and a faint circle showing how precise the location is. It follows you as you move.
   It only appears once the visitor has shared their location ("Use my location", or a browser that
   already allowed this site). The location stays in the browser: nothing is stored or sent anywhere. */
(function () {
  var root = document.getElementById('sb-finder');
  if (!root || !navigator.geolocation || !window.isSecureContext) return;
  var map = null, marker = null, el = null, me = null, watching = false, ctrl = false;

  // metres per screen pixel at this latitude and zoom (Mapbox uses 512px tiles)
  function mpp(lat, zoom) { return 78271.517 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom); }
  function sizeAccuracy() {
    if (!el || !me || !map) return;
    var r = Math.min(me.acc / mpp(me.lat, map.getZoom()), 240);
    el.style.setProperty('--acc', (r > 14 ? r : 0) + 'px');
  }

  function addCenterButton() {
    if (ctrl) return; ctrl = true;
    map.addControl({
      onAdd: function () {
        var box = document.createElement('div');
        box.className = 'mapboxgl-ctrl mapboxgl-ctrl-group sb-me-ctrl';
        box.innerHTML = '<button type="button" aria-label="Center on my location" title="Center on my location">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20.5 3.5 3.5 10.6l7 2.9 2.9 7z" fill="currentColor"/></svg></button>';
        box.querySelector('button').addEventListener('click', function () {
          if (me) map.easeTo({ center: [me.lng, me.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
        });
        return box;
      },
      onRemove: function () {}
    }, 'top-left');
  }

  function draw() {
    if (!map || !me || !window.mapboxgl) return;
    if (!marker) {
      el = document.createElement('div');
      el.className = 'sb-me';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'You are here');
      el.innerHTML = '<span class="sb-me__acc"></span><span class="sb-me__halo"></span><span class="sb-me__dot"></span>';
      marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([me.lng, me.lat]).addTo(map);
      map.on('zoom', sizeAccuracy);
      addCenterButton();
    } else {
      marker.setLngLat([me.lng, me.lat]);
    }
    sizeAccuracy();
  }

  function update(p) { me = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy || 50 }; draw(); }
  function watch() {
    if (watching) return; watching = true;
    navigator.geolocation.watchPosition(update, function (e) { if (e && e.code === 1) watching = false; },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  }

  function onMap() { map = root.sbMap; draw(); }
  if (root.sbMap) onMap(); else root.addEventListener('sb:map', onMap, { once: true });

  // Start following only once the browser says yes, so the visitor is never asked twice.
  var perm = null;
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(function (s) {
      perm = s;
      if (s.state === 'granted') watch(); // already allowed on this device: show the dot right away
      s.onchange = function () { if (s.state === 'granted') watch(); };
    }).catch(function () {});
  }
  // "Use my location" (on the page, or in the sticky bar on phones, which taps the same button)
  root.addEventListener('click', function (e) {
    if (!e.target.closest('[data-sb-finder-geo]')) return;
    if (perm) {
      var tries = 0, t = setInterval(function () {
        if (perm.state === 'granted') { clearInterval(t); watch(); }
        else if (perm.state === 'denied' || ++tries > 30) clearInterval(t);
      }, 1000);
    } else {
      setTimeout(watch, 4000); // older browsers without the permissions check
    }
  });
})();
