/* SUNBOY trade admin: approvals and the QuickBooks "Create invoice" queue. Nothing here sends email. */
(function () {
  var app = document.querySelector('[data-admin-app]');
  if (!app) return;
  var API = app.dataset.api.replace(/\/$/, ''), T = app.dataset.token, data = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(n) { return '$' + Number(n || 0).toFixed(2); }
  function post(body) {
    body.t = T;
    return fetch(API + '/api/trade/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }
  function load() {
    fetch(API + '/api/trade/admin?t=' + encodeURIComponent(T)).then(function (r) { return r.json(); }).then(function (d) {
      if (d.error) { app.innerHTML = '<div class="sb-trade__status">' + esc(d.error) + '</div>'; return; }
      data = d; render();
    }).catch(function () { app.innerHTML = '<div class="sb-trade__status">Couldn’t load. Refresh in a minute.</div>'; });
  }
  function meta(o) {
    var a = o.attrs, rows = [];
    ['Placed by', 'Order type', 'Market / distributor', 'Why the distributor hasn’t bought it', 'What it’s for', 'PO number'].forEach(function (k) { if (a[k]) rows.push('<div><dt>' + esc(k) + '</dt><dd>' + esc(a[k]) + '</dd></div>'); });
    if (o.ship) rows.push('<div><dt>Ship to</dt><dd>' + esc([o.ship.company || o.ship.name, o.ship.address1, o.ship.city, o.ship.provinceCode, o.ship.zip].filter(Boolean).join(', ')) + '</dd></div>');
    if (o.note) rows.push('<div><dt>Note</dt><dd>' + esc(o.note) + '</dd></div>');
    return '<dl class="sb-tadmin__meta">' + rows.join('') + '</dl>';
  }
  function items(o) {
    return '<ul class="sb-tadmin__items">' + o.items.map(function (i) { return '<li>' + i.qty + '× ' + esc(i.title) + ' <span>' + $(i.unit) + '</span></li>'; }).join('') + '</ul>' +
      '<p class="sb-tadmin__tot">Goods at SUNBOY cost <b>' + $(o.goods) + '</b> · Order total <b>' + $(o.total) + '</b></p>';
  }
  function render() {
    var q = data.qbo;
    app.innerHTML =
      '<div class="sb-tadmin__qbo">' + (q.connected
        ? 'QuickBooks connected' + (q.by ? ' by ' + esc(q.by) : '') + '. Invoices are created only when you click, and never sent.'
        : (data.qboConnectUrl ? (q.reconnect ? 'QuickBooks needs to be reconnected (access expired or was revoked).' : 'QuickBooks isn’t connected.') + ' <a class="sb-btn sb-btn--teal" href="' + esc(data.qboConnectUrl) + '">' + (q.reconnect ? 'Reconnect' : 'Connect') + ' QuickBooks</a>' : 'QuickBooks isn’t set up yet (waiting on the Intuit app keys).')) + '</div>' +
      '<h2 class="sb-trade__h3">Waiting for approval (' + data.pending.length + ')</h2>' +
      '<ul class="sb-tadmin__list">' + (data.pending.map(function (o, i) {
        return '<li class="sb-tadmin__card' + (o.test ? ' is-test' : '') + '" data-p="' + i + '">' +
          '<header><b>' + esc(o.name) + '</b> ' + (o.test ? '<span class="sb-tag">TEST</span> ' : '') + esc(o.customer ? o.customer.name : '') + ' <span>' + new Date(o.date).toLocaleString() + '</span></header>' +
          meta(o) + items(o) +
          '<div class="sb-tadmin__actions"><button type="button" class="sb-btn sb-btn--teal" data-approve>Approve' + (o.test ? ' (test)' : ' & ship') + '</button>' +
          '<a class="sb-btn" href="' + esc(o.adminUrl) + '" target="_blank" rel="noopener">Edit in Shopify</a>' +
          '<button type="button" class="sb-btn" data-reject>Not approved</button></div>' +
          '<div class="sb-tadmin__reject" hidden><label>Reason (saved on the draft, not sent)<input data-reason></label><button type="button" class="sb-btn sb-btn--solid" data-reject-go>Mark not approved</button></div>' +
          '<p class="sb-tadmin__msg" data-msg></p></li>';
      }).join('') || '<li class="sb-trade__muted">Nothing waiting.</li>') + '</ul>' +
      '<h2 class="sb-trade__h3">Ready to invoice (' + data.ready.length + ')</h2>' +
      '<ul class="sb-tadmin__list">' + (data.ready.map(function (o, i) {
        return '<li class="sb-tadmin__card' + (o.test ? ' is-test' : '') + '" data-r="' + i + '">' +
          '<header><b>' + esc(o.name) + '</b> ' + (o.test ? '<span class="sb-tag">TEST</span> ' : '') + esc(o.customer ? o.customer.name : '') + ' <span>' + new Date(o.date).toLocaleDateString() + '</span></header>' +
          items(o) +
          '<div class="sb-tadmin__qbocust"><label>QuickBooks customer<input data-qsearch placeholder="Search QuickBooks customers"' + (q.connected ? '' : ' disabled') + '></label><ul data-qresults></ul>' +
          '<p data-qchosen>' + (o.customer && o.customer.qbo ? 'Saved mapping: QuickBooks customer #' + esc(o.customer.qbo) : 'No QuickBooks customer picked yet.') + '</p></div>' +
          '<div class="sb-tadmin__actions"><button type="button" class="sb-btn" data-preview' + (q.connected ? '' : ' disabled') + '>Preview invoice</button>' +
          '<a class="sb-btn" href="' + esc(o.adminUrl) + '" target="_blank" rel="noopener">Open in Shopify</a></div>' +
          '<div data-pv></div><p class="sb-tadmin__msg" data-msg></p></li>';
      }).join('') || '<li class="sb-trade__muted">Nothing to invoice.</li>') + '</ul>';
    wire();
  }
  function wire() {
    app.querySelectorAll('[data-p]').forEach(function (li) {
      var o = data.pending[li.dataset.p], msg = li.querySelector('[data-msg]');
      li.querySelector('[data-approve]').addEventListener('click', function () {
        var b = this; if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = o.test ? 'Tap again to approve (test)' : 'Tap again to approve & send to Rack’d'; return; }
        b.disabled = true; msg.textContent = 'Approving…';
        post({ action: 'approve', id: o.id }).then(function (d) { msg.textContent = d.message || d.error; if (d.ok) setTimeout(load, 1200); else b.disabled = false; });
      });
      li.querySelector('[data-reject]').addEventListener('click', function () { li.querySelector('.sb-tadmin__reject').hidden = false; });
      li.querySelector('[data-reject-go]').addEventListener('click', function () {
        msg.textContent = 'Saving…';
        post({ action: 'reject', id: o.id, reason: li.querySelector('[data-reason]').value }).then(function (d) { msg.textContent = d.message || d.error; if (d.ok) setTimeout(load, 1200); });
      });
    });
    app.querySelectorAll('[data-r]').forEach(function (li) {
      var o = data.ready[li.dataset.r], msg = li.querySelector('[data-msg]'), chosen = o.customer && o.customer.qbo || '', tmr;
      var s = li.querySelector('[data-qsearch]'), res = li.querySelector('[data-qresults]');
      s.addEventListener('input', function () {
        clearTimeout(tmr); if (s.value.trim().length < 2) { res.innerHTML = ''; return; }
        tmr = setTimeout(function () {
          post({ action: 'qbo-search', q: s.value.trim() }).then(function (d) {
            res.innerHTML = (d.customers || []).map(function (c) { return '<li><button type="button" data-c="' + esc(c.id) + '">' + esc(c.name) + (c.email ? ' <small>' + esc(c.email) + '</small>' : '') + '</button></li>'; }).join('') || '<li>No matches</li>';
            res.querySelectorAll('[data-c]').forEach(function (b) { b.addEventListener('click', function () { chosen = b.dataset.c; li.querySelector('[data-qchosen]').textContent = 'Picked: ' + b.textContent; res.innerHTML = ''; s.value = ''; }); });
          });
        }, 300);
      });
      li.querySelector('[data-preview]').addEventListener('click', function () {
        var pv = li.querySelector('[data-pv]'); msg.textContent = 'Building preview…';
        post({ action: 'preview', id: o.id, qboCustomerId: chosen }).then(function (d) {
          msg.textContent = '';
          if (d.error) { msg.textContent = d.error; return; }
          var p = d.preview;
          pv.innerHTML = '<div class="sb-tadmin__inv"><p><b>' + esc(p.docNumber) + '</b> · ' + esc(p.date) + ' · ' + esc(p.customer ? p.customer.name : 'No customer') + (p.location ? ' · Location ' + esc(p.location) : '') + (p.klass ? ' · Class ' + esc(p.klass) : '') + '</p>' +
            '<table><thead><tr><th>QuickBooks item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>' +
            p.lines.map(function (l) { return '<tr><td>' + (l.item ? esc(l.item.name) : '<b>Missing: ' + esc(l.title) + '</b>') + '</td><td>' + l.qty + '</td><td>' + $(l.rate) + '</td><td>' + $(l.amount) + '</td></tr>'; }).join('') +
            '</tbody><tfoot><tr><td colspan="3">Total (co-op ' + p.coop + '%)</td><td><b>' + $(p.total) + '</b></td></tr></tfoot></table>' +
            (p.problems.length ? '<p class="sb-trade__err">' + p.problems.map(esc).join('<br>') + '</p>'
              : '<label class="sb-tadmin__ok"><input type="checkbox" data-sure> I checked this. Create it in QuickBooks <b>without sending it</b>.</label><button type="button" class="sb-btn sb-btn--solid" data-create disabled>Create invoice</button>') + '</div>';
          var sure = pv.querySelector('[data-sure]'), go = pv.querySelector('[data-create]');
          if (sure) sure.addEventListener('change', function () { go.disabled = !sure.checked; });
          if (go) go.addEventListener('click', function () {
            go.disabled = true; msg.textContent = 'Creating in QuickBooks…';
            post({ action: 'invoice', id: o.id, qboCustomerId: chosen || (p.customer && p.customer.id), confirm: true }).then(function (r) {
              msg.innerHTML = r.ok ? esc(r.message) + ' <a href="' + esc(r.link) + '" target="_blank" rel="noopener">Open in QuickBooks</a>' : esc(r.error);
              if (r.ok) setTimeout(load, 4000); else go.disabled = false;
            });
          });
        });
      });
    });
  }
  load();
})();
