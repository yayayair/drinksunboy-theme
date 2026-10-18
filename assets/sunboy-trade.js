/* SUNBOY trade shop: catalog, cart and "Submit order" for distributors and the team.
   Prices shown are SUNBOY cost; co-op % is SUNBOY's share. The server re-checks every number. */
(function () {
  var app = document.querySelector('[data-trade-app]');
  if (!app) return;
  var API = app.dataset.api.replace(/\/$/, ''), T = app.dataset.token, CID = app.dataset.cid;
  var hi = document.querySelector('[data-hi]'), applyEl = document.querySelector('[data-apply]');
  var KEY = 'sbTradeCart:' + CID;
  var me = null, cart = load(), filter = 'All', busy = false;

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(n) { return '$' + Number(n || 0).toFixed(2); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function img(u, w) { return u ? u + (u.indexOf('?') > -1 ? '&' : '?') + 'width=' + w : ''; }

  fetch(API + '/api/trade/me?t=' + encodeURIComponent(T)).then(function (r) { return r.json(); }).then(function (d) {
    if (d.error) { app.innerHTML = '<div class="sb-trade__status">' + esc(d.error) + ' <a href="' + esc(app.dataset.logout) + '">Sign out</a></div>'; return; }
    if (d.role === 'none') {
      hi.textContent = 'Hi ' + (d.name || 'there') + '. Your account isn’t set up for trade ordering yet.';
      app.innerHTML = '<div class="sb-trade__status">If you’re a distributor representative, request access below and we’ll turn it on.</div>';
      if (applyEl) applyEl.hidden = false;
      return;
    }
    me = d;
    // drop cart lines that no longer exist
    var ok = {}; me.catalog.forEach(function (p) { p.variants.forEach(function (v) { ok[v.id] = v; }); });
    Object.keys(cart).forEach(function (k) { if (!ok[k]) delete cart[k]; else cart[k] = Math.min(cart[k], ok[k].available); if (!cart[k]) delete cart[k]; });
    save();
    hi.innerHTML = me.role === 'team'
      ? 'Hi ' + esc(me.firstName || me.name) + '. Team orders are <b>paid by SUNBOY</b> and wait for approval from Yair or Sam.'
      : 'Hi ' + esc(me.firstName || me.name) + '. Your co-op: <b>SUNBOY pays ' + me.coop + '%</b>' + (me.coop >= 100 ? ', so your orders are free.' : ', you pay ' + (100 - me.coop) + '%, billed to your account.');
    render();
  }).catch(function () {
    app.innerHTML = '<div class="sb-trade__status">The trade shop is taking a breather. Refresh in a minute.</div>';
  });

  function variantOf(id) { var hit = null; me.catalog.some(function (p) { return p.variants.some(function (v) { if (v.id === id) { hit = { p: p, v: v }; return true; } }); }); return hit; }

  function quote() {
    var lines = [], goods = 0, approval = me.role === 'team' || !!(me.settings && me.settings.approveAll);
    Object.keys(cart).forEach(function (id) {
      var h = variantOf(id); if (!h) return;
      var qty = cart[id]; goods += h.v.price * qty; if (h.p.approval) approval = true;
      lines.push({ id: id, p: h.p, v: h.v, qty: qty, total: r2(h.v.price * qty) });
    });
    goods = r2(goods);
    var covered = me.coop >= 100, share = r2(goods * (100 - me.coop) / 100);
    var ship = covered || !lines.length || goods >= me.settings.freeShipMin ? 0 : me.settings.shipUnder;
    return { lines: lines, goods: goods, credit: r2(goods - share), share: share, ship: ship, total: r2(share + ship), covered: covered, approval: approval };
  }

  function priceLine(v) {
    if (me.coop >= 100) return '<span class="sb-tp__cost">' + $(v.price) + '</span> <span class="sb-tp__you">Covered by SUNBOY</span>';
    return '<span class="sb-tp__cost">SUNBOY cost ' + $(v.price) + '</span> <span class="sb-tp__you">You pay ' + $(v.price * (100 - me.coop) / 100) + '</span>';
  }

  function render() {
    var types = ['All'];
    me.catalog.forEach(function (p) { if (types.indexOf(p.type) < 0) types.push(p.type); });
    var links = ['<a href="#sb-orders">Your orders</a>'];
    if (me.admin) links.push('<a href="' + esc(app.dataset.adminUrl) + '"><b>Approvals & invoices</b></a>');
    links.push('<a href="' + esc(app.dataset.logout) + '">Sign out</a>');
    app.innerHTML =
      (me.test ? '<div class="sb-trade__test">TEST ACCOUNT: orders stay as drafts and never ship.</div>' : '') +
      '<div class="sb-trade__storehead"><h2 class="sb-trade__h2 sb-display">' + esc(app.dataset.storeHeading || 'SUNBOY Trade Store') + '</h2><nav class="sb-trade__links">' + links.join('') + '</nav></div>' +
      '<div class="sb-trade__grid">' +
        '<div class="sb-trade__main">' +
          '<div class="sb-finder__chips sb-trade__chips">' + types.map(function (t) { return '<button type="button" class="sb-chip' + (t === filter ? ' is-on' : '') + '" data-type="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>' +
          '<ul class="sb-trade__products" data-products></ul>' +
        '</div>' +
        '<aside class="sb-trade__cart" data-cart></aside>' +
      '</div>' +
      '<section class="sb-trade__history" id="sb-orders" data-history></section>' +
      '<button type="button" class="sb-trade__cartbtn sb-btn sb-btn--solid" data-cartbtn hidden></button>';
    products(); cartView(); history();
    app.querySelectorAll('.sb-trade__chips .sb-chip').forEach(function (b) { b.addEventListener('click', function () { filter = b.dataset.type; render(); }); });
    app.querySelector('[data-cartbtn]').addEventListener('click', function () { app.classList.add('show-cart'); app.querySelector('[data-cart]').scrollIntoView({ behavior: 'smooth' }); });
  }

  function products() {
    var el = app.querySelector('[data-products]');
    var list = me.catalog.filter(function (p) { return filter === 'All' || p.type === filter; });
    el.innerHTML = list.map(function (p) {
      var v0 = p.variants.find(function (v) { return v.available > 0; }) || p.variants[0];
      var out = !p.variants.some(function (v) { return v.available > 0; });
      var opts = p.variants.length > 1 ? '<select data-variant>' + p.variants.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v === v0 ? ' selected' : '') + (v.available ? '' : ' disabled') + '>' + esc(v.title) + (v.available ? '' : ' (out)') + '</option>'; }).join('') + '</select>' : '<input type="hidden" data-variant value="' + esc(v0.id) + '">';
      return '<li class="sb-tp' + (out ? ' is-out' : '') + '" data-pid="' + esc(p.id) + '">' +
        '<div class="sb-tp__img">' + (p.image ? '<img src="' + esc(img(p.image, 500)) + '" alt="" loading="lazy">' : '') + (p.approval ? '<span class="sb-tp__flag">Needs approval</span>' : '') + '</div>' +
        '<h3 class="sb-tp__title">' + esc(p.title) + '</h3>' +
        '<p class="sb-tp__price" data-price>' + priceLine(v0) + '</p>' +
        '<p class="sb-tp__stock" data-stock>' + (out ? 'Out of stock' : v0.available + ' available') + '</p>' +
        '<div class="sb-tp__buy">' + opts +
          '<div class="sb-qty"><button type="button" data-step="-1" aria-label="Less">−</button><input type="number" inputmode="numeric" min="1" value="1" data-qty aria-label="Quantity"><button type="button" data-step="1" aria-label="More">+</button></div>' +
          '<button type="button" class="sb-btn sb-btn--teal sb-tp__add" data-add' + (out ? ' disabled' : '') + '>' + (out ? 'Out' : 'Add') + '</button>' +
        '</div></li>';
    }).join('') || '<li class="sb-trade__empty">Nothing here yet.</li>';
    el.querySelectorAll('.sb-tp').forEach(function (li) {
      var sel = li.querySelector('[data-variant]'), qty = li.querySelector('[data-qty]');
      function cur() { return variantOf(sel.value).v; }
      if (sel.tagName === 'SELECT') sel.addEventListener('change', function () { var v = cur(); li.querySelector('[data-price]').innerHTML = priceLine(v); li.querySelector('[data-stock]').textContent = v.available ? v.available + ' available' : 'Out of stock'; });
      li.querySelectorAll('[data-step]').forEach(function (b) { b.addEventListener('click', function () { qty.value = Math.max(1, Math.min(cur().available || 1, (parseInt(qty.value, 10) || 1) + Number(b.dataset.step))); }); });
      li.querySelector('[data-add]').addEventListener('click', function () {
        var v = cur(), n = Math.max(1, parseInt(qty.value, 10) || 1);
        cart[v.id] = Math.min(v.available, (cart[v.id] || 0) + n); save(); cartView();
        var b = this; b.textContent = 'Added ✓'; setTimeout(function () { b.textContent = 'Add'; }, 1200);
      });
    });
  }

  function cartView() {
    var q = quote(), el = app.querySelector('[data-cart]'), btn = app.querySelector('[data-cartbtn]');
    var count = q.lines.reduce(function (s, l) { return s + l.qty; }, 0);
    btn.hidden = !count; btn.textContent = 'Cart · ' + count + ' item' + (count === 1 ? '' : 's') + ' · ' + (q.covered ? 'SUNBOY-paid' : $(q.total));
    if (!q.lines.length) { el.innerHTML = '<h2 class="sb-trade__h3">Your order</h2><p class="sb-trade__muted">Add items to start an order.</p>'; return; }
    var more = !q.covered && q.ship > 0 ? '<p class="sb-trade__nudge">Add ' + $(me.settings.freeShipMin - q.goods) + ' more (at SUNBOY cost) for free shipping.</p>' : '';
    var addr = me.addresses.length
      ? '<label>Ship to<select data-addr>' + me.addresses.map(function (a) { return '<option value="' + esc(a.id) + '"' + (a.isDefault ? ' selected' : '') + '>' + esc([a.company || [a.firstName, a.lastName].join(' '), a.address1, a.city, a.provinceCode].filter(Boolean).join(', ')) + '</option>'; }).join('') + '<option value="new">Another address…</option></select></label>'
      : '';
    var newAddr = '<div class="sb-trade__newaddr" data-newaddr' + (me.addresses.length ? ' hidden' : '') + '>' +
      '<label>Name<input data-a="firstName" placeholder="First"><input data-a="lastName" placeholder="Last"></label>' +
      '<label>Company<input data-a="company"></label><label>Street<input data-a="address1"></label><label>Apt / suite<input data-a="address2"></label>' +
      '<label>City<input data-a="city"></label><label>State<input data-a="provinceCode" maxlength="2" placeholder="NY"></label><label>ZIP<input data-a="zip" inputmode="numeric"></label><label>Phone<input data-a="phone"></label></div>';
    var team = me.role === 'team';
    el.innerHTML = '<h2 class="sb-trade__h3">Your order</h2>' +
      '<ul class="sb-trade__lines">' + q.lines.map(function (l) {
        return '<li><span class="sb-trade__ln">' + esc(l.p.title) + (l.v.title ? ' <small>' + esc(l.v.title) + '</small>' : '') + '</span>' +
          '<span class="sb-qty sb-qty--sm"><button type="button" data-dec="' + esc(l.id) + '">−</button><b>' + l.qty + '</b><button type="button" data-inc="' + esc(l.id) + '">+</button></span>' +
          '<span class="sb-trade__lt">' + $(l.total) + '</span></li>';
      }).join('') + '</ul>' +
      '<dl class="sb-trade__sum">' +
        '<div><dt>Goods at SUNBOY cost</dt><dd>' + $(q.goods) + '</dd></div>' +
        '<div><dt>' + (q.covered ? 'Paid by SUNBOY' : 'SUNBOY co-op (' + me.coop + '%)') + '</dt><dd>−' + $(q.credit) + '</dd></div>' +
        '<div><dt>Shipping</dt><dd>' + (q.ship ? $(q.ship) : 'Free') + '</dd></div>' +
        '<div class="sb-trade__total"><dt>' + (q.covered ? 'You pay' : 'Billed to your account (Net 30)') + '</dt><dd>' + $(q.total) + '</dd></div>' +
      '</dl>' + more +
      '<form class="sb-trade__checkout" data-checkout>' + addr + newAddr +
        (team
          ? '<label>Market or distributor *<input name="market" required placeholder="e.g. Sunset Distributing, LA"></label>' +
            '<label>Why hasn’t the distributor bought this POS? *<textarea name="reason" rows="2" required></textarea></label>' +
            '<label>What’s it for?<input name="purpose" placeholder="Event, account, activation…"></label>'
          : '<label>PO number (optional)<input name="po"></label>') +
        '<label>Notes for the warehouse<textarea name="note" rows="2"></textarea></label>' +
        (q.approval ? '<p class="sb-trade__approval">This order waits for approval from Yair or Sam before it ships.</p>' : '') +
        '<button class="sb-btn sb-btn--solid sb-trade__submit" type="submit">' + (q.approval ? 'Send for approval' : 'Submit order') + '</button>' +
        '<p class="sb-trade__err" data-err role="alert"></p>' +
      '</form>';
    el.querySelectorAll('[data-dec],[data-inc]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.dec || b.dataset.inc, h = variantOf(id);
        cart[id] = (cart[id] || 0) + (b.dataset.inc ? 1 : -1);
        if (h && cart[id] > h.v.available) cart[id] = h.v.available;
        if (cart[id] <= 0) delete cart[id];
        save(); cartView();
      });
    });
    var sel = el.querySelector('[data-addr]');
    if (sel) sel.addEventListener('change', function () { el.querySelector('[data-newaddr]').hidden = sel.value !== 'new'; });
    el.querySelector('[data-checkout]').addEventListener('submit', submit);
  }

  function submit(e) {
    e.preventDefault();
    if (busy) return;
    var f = e.target, err = f.querySelector('[data-err]'), q = quote();
    var body = { t: T, lines: q.lines.map(function (l) { return { variantId: l.id, qty: l.qty }; }), note: f.note.value, po: f.po ? f.po.value : '' };
    if (f.market) { body.market = f.market.value; body.reason = f.reason.value; body.purpose = f.purpose.value; }
    var sel = f.querySelector('[data-addr]');
    if (sel && sel.value !== 'new') body.addressId = sel.value;
    else { body.address = {}; f.querySelectorAll('[data-a]').forEach(function (i) { body.address[i.dataset.a] = i.value.trim(); }); body.address.countryCode = 'US'; }
    busy = true; err.textContent = '';
    var btn = f.querySelector('.sb-trade__submit'); btn.disabled = true; btn.innerHTML = '<span class="sb-finder__spin"></span> Sending…';
    fetch(API + '/api/trade/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(function (d) {
        busy = false;
        if (!d.ok) { err.textContent = d.error || 'Something went wrong.'; btn.disabled = false; btn.textContent = 'Try again'; return; }
        cart = {}; save();
        var msg = d.status === 'placed' ? 'Order <b>' + esc(d.name) + '</b> is in. Rack’d will ship it, and ' + (d.quote.covered ? 'SUNBOY covers it.' : 'it’ll be billed to your account.')
          : d.status === 'pending' ? '<b>' + esc(d.name) + '</b> was sent for approval. It ships as soon as Yair or Sam approves it.'
          : '<b>' + esc(d.name) + '</b> saved as a TEST draft. Nothing ships.';
        app.querySelector('[data-cart]').innerHTML = '<div class="sb-trade__done"><h2 class="sb-trade__h3">Thank you!</h2><p>' + msg + '</p><button type="button" class="sb-btn" data-again>Start another order</button></div>';
        app.querySelector('[data-again]').addEventListener('click', function () { cartView(); });
        app.querySelector('[data-cartbtn]').hidden = true;
        refreshHistory();
      }).catch(function () { busy = false; err.textContent = 'Network hiccup. Nothing was placed. Try again.'; btn.disabled = false; btn.textContent = 'Try again'; });
  }

  function history() {
    var el = app.querySelector('[data-history]');
    var list = me.history || [];
    function tone(st) { return /ship/i.test(st) ? 'ok' : /not approved/i.test(st) ? 'no' : /wait|test/i.test(st) ? 'wait' : 'go'; }
    el.innerHTML = '<h2 class="sb-trade__h3">Your orders</h2>' + (list.length
      ? '<ul class="sb-orders">' + list.map(function (o) {
          return '<li class="sb-order"><div class="sb-order__top"><b class="sb-order__name">' + esc(o.name) + '</b>' +
            '<span class="sb-order__pill is-' + tone(o.status) + '">' + esc(o.status) + '</span></div>' +
            '<div class="sb-order__meta">' + new Date(o.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + $(o.total) + '</div>' +
            '<p class="sb-order__items">' + esc(o.items.join(' · ')) + '</p></li>';
        }).join('') + '</ul>'
      : '<p class="sb-trade__muted">No orders yet. Your trade orders will show up here.</p>');
  }
  function refreshHistory() {
    fetch(API + '/api/trade/me?t=' + encodeURIComponent(T)).then(function (r) { return r.json(); }).then(function (d) { if (d.history) { me.history = d.history; me.catalog = d.catalog; history(); products(); } });
  }
})();
