/* Website messages → Slack. Every Shopify contact form on the site (the trade-account request on the
   Distributor Shop page, the contact form) is sent to the SUNBOY service, which posts it in Slack
   #trade-orders for someone to follow up. Nothing is emailed to the person who wrote in.
   If the service can't be reached, the form submits the normal Shopify way, so the email to
   holler@drinksunboy.com still arrives and nothing is lost. Newsletter signups are not touched. */
(function () {
  var API = 'https://sunboy-finder.vercel.app/api/inquiry';
  var started = Date.now();

  function isContact(form) {
    var a = form.querySelector('input[name="form_type"]');
    return a && a.value === 'contact' && !form.querySelector('input[name="contact[tags]"][value*="newsletter"]');
  }

  function fieldsOf(form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      var m = /^contact\[(.+)\]$/.exec(el.name || '');
      if (!m || el.type === 'hidden' && m[1] !== 'Request') return;
      if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
      if (String(el.value || '').trim()) out[m[1]] = el.value;
    });
    return out;
  }

  function thanks(form, trade) {
    var p = document.createElement('p');
    p.className = trade ? 'sb-trade__ok' : 'form__message';
    p.setAttribute('role', 'status');
    p.setAttribute('tabindex', '-1');
    p.textContent = trade
      ? 'Thanks! We’ll set up your account and let you know when you can sign in.'
      : 'Thanks for reaching out! We’ll get back to you soon.';
    form.innerHTML = '';
    form.appendChild(p);
    p.focus();
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement) || !isContact(form) || form.dataset.sbNative) return;
    if (!window.fetch || !form.checkValidity()) return;
    e.preventDefault();
    var fields = fieldsOf(form);
    var trade = /trade/i.test(fields.Request || '');
    var btn = form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    var native = function () { form.dataset.sbNative = '1'; if (btn) btn.disabled = false; HTMLFormElement.prototype.submit.call(form); };
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: trade ? 'trade' : 'contact', fields: fields, page: location.href.split('?')[0], t: Date.now() - started,
        hp: (form.querySelector('input[name="sb_hp"]') || {}).value || '' }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (r.ok) thanks(form, trade); else native();
    }).catch(function () { clearTimeout(timer); native(); });
  }, true);
})();
