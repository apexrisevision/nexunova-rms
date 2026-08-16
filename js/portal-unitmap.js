/* ══ Unit Map — portal viewer ═══════════════════════════════════════════════
   Kept out of sales-portal.html on purpose: that file is already 8,000+ lines,
   and the map is self-contained.

   Colour comes from the server (_map_unit_state) and unit numbers come from the
   database — never from the labels printed on the drawing. That is what makes a
   mislabelled artwork harmless: the drawing said X10 on both split clusters for a
   while, and the map still showed 17A/B/C correctly.

   Reserve calls reserve_unit() and nothing else. No second reservation path, so
   cron_expire_reservations keeps working on everything the map creates.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MAP = { floors: [], plan: null, planId: null, sel: null,
              z: 1, tx: 0, ty: 0, drag: null };
  var COLOR = { available: ['#0ea5e9', 'rgba(14,165,233,.22)'],
                reserved:  ['#d97706', 'rgba(217,119,6,.28)'],
                sold:      ['#059669', 'rgba(5,150,105,.30)'] };


  // Styles ship with the module, so sales-portal.html stays a one-line change.
  (function () {
    var st = document.createElement('style');
    st.textContent = ".umv-wrap{padding:12px 12px 90px}.umv-h{font-weight:700;margin:4px 2px 12px}.umv-load,.umv-msg{padding:24px;text-align:center;color:var(--fk-text-muted)}.umv-floors{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:9px}.umv-floor{display:flex;flex-direction:column;gap:3px;align-items:flex-start;padding:13px 14px;border:1px solid var(--fk-border);border-radius:var(--fk-radius-md);background:var(--fk-bg-card);color:var(--fk-text);font:inherit;cursor:pointer;text-align:left}.umv-floor.soon{opacity:.55;cursor:default}.umv-fl{font-weight:700}.umv-fu{font-size:var(--fk-fs-label);color:var(--fk-text-muted)}.umv-top{display:flex;gap:10px;align-items:center;margin-bottom:9px}.umv-back{background:none;border:0;color:var(--fk-primary);font:inherit;cursor:pointer;padding:0}.umv-zoom{margin-left:auto;display:flex;gap:5px}.umv-zoom button{min-width:34px;height:30px;border:1px solid var(--fk-border);background:var(--fk-bg-card);color:var(--fk-text);border-radius:7px;font:inherit;cursor:pointer}.umv-legend{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:9px;font-size:var(--fs-caption)}.umv-chip{display:inline-flex;align-items:center;gap:5px;color:var(--fk-text-muted)}.umv-chip i{width:10px;height:10px;border-radius:3px;display:inline-block}.umv-stage{position:relative;overflow:hidden;border:1px solid var(--fk-border);border-radius:var(--fk-radius-md);background:#fff;touch-action:none}.umv-pan{position:relative;transform-origin:0 0;transition:transform .12s ease-out;line-height:0}.umv-pan img{width:100%;height:auto;display:block}.umv-pan svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.umv-soon{padding:40px 20px;text-align:center;border:1px dashed var(--fk-border);border-radius:var(--fk-radius-md)}.umv-soon-t{font-weight:700;font-size:var(--fs-section)}.umv-soon-s{color:var(--fk-text-muted);margin-top:6px}.umv-sheet-in{margin-top:12px;border:1px solid var(--fk-border);border-radius:var(--fk-radius-md);background:var(--fk-bg-card);padding:13px 15px}.umv-sh-top{display:flex;align-items:center;gap:9px;margin-bottom:9px}.umv-dot{width:11px;height:11px;border-radius:50%}.umv-state{margin-left:auto;font-size:var(--fs-caption);font-weight:700}.umv-x{background:none;border:0;color:var(--fk-text-muted);font-size:15px;cursor:pointer}.umv-rows{display:flex;flex-direction:column}.umv-row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--fk-border);font-size:var(--fs-caption)}.umv-row:last-child{border-bottom:0}.umv-row span:first-child{color:var(--fk-text-muted)}.umv-pend{color:#d97706;font-style:normal}.umv-res{margin-top:11px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.umv-res-l{font-size:var(--fs-caption);color:var(--fk-text-muted)}.umv-res-b{display:flex;gap:7px;margin-left:auto}.umv-note{margin-top:11px;font-size:var(--fs-caption);color:var(--fk-text-muted)}";
    document.head.appendChild(st);
  })();

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { return n ? Number(n).toLocaleString('en-US') : '—'; }

  // ── entry ────────────────────────────────────────────────────────────────
  window.renderUnitMap = async function () {
    var host = $('app-body'); if (!host) return;
    host.innerHTML = '<div class="umv-wrap"><div class="umv-load">Loading floors…</div></div>';
    var r;
    try { r = await sb.rpc('get_map_floors', { p_session_token: TOKEN }); }
    catch (e) { host.innerHTML = '<div class="umv-msg">Could not reach the server.</div>'; return; }
    var d = r.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) { host.innerHTML = '<div class="umv-msg">Could not load the floors.</div>'; return; }
    MAP.floors = d.floors || [];
    _floors();
  };

  function _floors() {
    var rows = MAP.floors.map(function (f) {
      var soon = f.status !== 'published';
      return '<button class="umv-floor' + (soon ? ' soon' : '') + '"' +
        (soon ? ' disabled' : ' onclick="_umvOpen(\'' + f.id + '\')"') + '>' +
        '<span class="umv-fl">' + esc(f.floor_label) + '</span>' +
        '<span class="umv-fu">' + (soon ? 'Coming soon' : f.units + ' units') + '</span></button>';
    }).join('');
    $('app-body').innerHTML =
      '<div class="umv-wrap"><div class="umv-h">Pick a floor</div><div class="umv-floors">' +
      (rows || '<div class="umv-msg">No floors yet.</div>') + '</div></div>';
  }

  window._umvOpen = async function (planId) {
    MAP.planId = planId;
    $('app-body').innerHTML = '<div class="umv-wrap"><div class="umv-load">Opening floor…</div></div>';
    var r = await sb.rpc('get_map_plan', { p_session_token: TOKEN, p_plan_id: planId });
    var d = r.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) { $('app-body').innerHTML = '<div class="umv-msg">Could not open this floor.</div>'; return; }

    // A floor whose drawing has not arrived is a normal state, not a failure.
    if (!d.ready) {
      $('app-body').innerHTML =
        '<div class="umv-wrap"><button class="umv-back" onclick="renderUnitMap()">‹ Floors</button>' +
        '<div class="umv-soon"><div class="umv-soon-t">' + esc(d.floor_label) + '</div>' +
        '<div class="umv-soon-s">' + esc(d.message || 'Coming soon.') + '</div></div></div>';
      return;
    }
    MAP.plan = d; MAP.sel = null; MAP.z = 1; MAP.tx = 0; MAP.ty = 0;
    _canvas();
  };

  function _canvas() {
    var d = MAP.plan, a = d.artwork;
    var counts = { available: 0, reserved: 0, sold: 0 };
    (d.units || []).forEach(function (u) { if (counts[u.state] != null) counts[u.state]++; });
    $('app-body').innerHTML =
      '<div class="umv-wrap">' +
        '<div class="umv-top"><button class="umv-back" onclick="renderUnitMap()">‹ Floors</button>' +
          '<b>' + esc(d.floor_label) + '</b>' +
          '<span class="umv-zoom"><button onclick="_umvZoom(-1)">−</button>' +
          '<button onclick="_umvZoom(1)">+</button><button onclick="_umvZoom(0)">Reset</button></span></div>' +
        '<div class="umv-legend">' +
          _chip('available', counts.available) + _chip('reserved', counts.reserved) + _chip('sold', counts.sold) +
        '</div>' +
        '<div class="umv-stage" id="umv-stage">' +
          '<div class="umv-pan" id="umv-pan">' +
            '<img id="umv-img" src="' + esc(a.image_path) + '" alt="">' +
            '<svg id="umv-svg" viewBox="0 0 1 1" preserveAspectRatio="none"></svg>' +
          '</div>' +
        '</div>' +
        '<div id="umv-sheet"></div>' +
      '</div>';
    var img = $('umv-img');
    if (img.complete) _paint(); else img.onload = _paint;
    _bindPan();
  }
  function _chip(k, n) {
    return '<span class="umv-chip"><i style="background:' + COLOR[k][0] + '"></i>' +
      k.charAt(0).toUpperCase() + k.slice(1) + ' <b>' + n + '</b></span>';
  }

  function _paint() {
    var svg = $('umv-svg'); if (!svg) return;
    var out = (MAP.plan.units || []).map(function (u) {
      var c = COLOR[u.state] || COLOR.available;
      var on = MAP.sel && MAP.sel.unit_id === u.unit_id;
      var pts = (u.points || []).map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
      var lx = u.label_x != null ? u.label_x : _cx(u.points)[0];
      var ly = u.label_y != null ? u.label_y : _cx(u.points)[1];
      // the number is the DB's unit_no, never the drawing's printed label
      return '<polygon data-unit="' + u.unit_id + '" points="' + pts + '" fill="' + c[1] + '" stroke="' + c[0] +
             '" stroke-width="' + (on ? 3 : 1.4) + '" vector-effect="non-scaling-stroke"' +
             ' style="cursor:pointer" onclick="_umvTap(\'' + u.unit_id + '\')"/>' +
             '<text x="' + lx + '" y="' + ly + '" font-size="0.013" text-anchor="middle"' +
             ' fill="#0f172a" style="paint-order:stroke;stroke:#fff;stroke-width:0.0045;pointer-events:none">' +
             esc(u.unit_no) + '</text>';
    }).join('');
    svg.innerHTML = out;
  }

  // Selection is a stroke change on one node — never a rebuild of the layer.
  function _highlight() {
    var svg = $('umv-svg'); if (!svg) return;
    var id = MAP.sel && MAP.sel.unit_id;
    svg.querySelectorAll('polygon').forEach(function (p) {
      p.setAttribute('stroke-width', p.getAttribute('data-unit') === id ? 3 : 1.4);
    });
  }
  function _cx(p) { var x = 0, y = 0; p.forEach(function (q) { x += q[0]; y += q[1]; }); return [x / p.length, y / p.length]; }

  // ── zoom (CSS transform) + pan ───────────────────────────────────────────
  window._umvZoom = function (dir) {
    if (dir === 0) { MAP.z = 1; MAP.tx = 0; MAP.ty = 0; }
    else MAP.z = Math.min(5, Math.max(1, MAP.z + dir * 0.4));
    if (MAP.z === 1) { MAP.tx = 0; MAP.ty = 0; }
    _applyT();
  };
  function _applyT() {
    var el = $('umv-pan'); if (!el) return;
    el.style.transform = 'translate(' + MAP.tx + 'px,' + MAP.ty + 'px) scale(' + MAP.z + ')';
  }
  function _bindPan() {
    var st = $('umv-stage'); if (!st) return;
    st.addEventListener('pointerdown', function (e) {
      if (MAP.z <= 1) return;
      MAP.drag = { x: e.clientX - MAP.tx, y: e.clientY - MAP.ty };
      st.setPointerCapture(e.pointerId);
    });
    st.addEventListener('pointermove', function (e) {
      if (!MAP.drag) return;
      MAP.tx = e.clientX - MAP.drag.x; MAP.ty = e.clientY - MAP.drag.y; _applyT();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      st.addEventListener(ev, function () { MAP.drag = null; });
    });
  }

  // ── tap a unit → server decides what this role may see ───────────────────
  window._umvTap = async function (unitId) {
    var r = await sb.rpc('get_map_unit_detail', { p_session_token: TOKEN, p_unit_id: unitId });
    var d = r.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) return toast('Could not load this unit', 'err');
    MAP.sel = d; _highlight();
    if (MAP.z < 1.8) { MAP.z = 1.8; _applyT(); }
    _sheet(d);
  };

  function _sheet(d) {
    var c = COLOR[d.state] || COLOR.available;
    var h = '<div class="umv-sheet-in"><div class="umv-sh-top">' +
      '<span class="umv-dot" style="background:' + c[0] + '"></span>' +
      '<b>' + esc(d.unit_no) + '</b>' +
      '<span class="umv-state" style="color:' + c[0] + '">' + esc(d.label || d.state) + '</span>' +
      '<button class="umv-x" onclick="_umvClose()">✕</button></div>' +
      '<div class="umv-rows">' +
        _row('Type', esc(d.type || '—')) +
        _row('Area', d.area ? Number(d.area).toLocaleString('en-US') + ' sft' : '—') +
        _row('Rate', d.rate_pending ? '<i class="umv-pend">Rate pending</i>' : 'PKR ' + money(d.price));

    // Only a director's response carries these. A rep's never has them at all.
    if (d.sale) {
      h += _row('Client', esc(d.sale.client_name || '—')) +
           _row('Phone', esc(d.sale.client_phone || '—')) +
           _row('Sale', esc(d.sale.sale_number || '—')) +
           _row('Net', 'PKR ' + money(d.sale.net_amount)) +
           _row('Paid', 'PKR ' + money(d.sale.paid)) +
           _row('Outstanding', '<b>PKR ' + money(d.sale.outstanding) + '</b>') +
           (Number(d.sale.overdue) > 0 ? _row('Overdue', '<b style="color:#dc2626">PKR ' + money(d.sale.overdue) + '</b>') : '');
    }
    if (d.reservation) {
      h += _row('Held for', esc(d.reservation.client_name || '—')) +
           _row('Expires', d.reservation.expires_at ? new Date(d.reservation.expires_at).toLocaleDateString() : '—') +
           _row('By', esc(d.reservation.reserved_by || '—'));
    }
    h += '</div>';
    // A price plan comes BEFORE a hold in the real conversation, and unlike a hold
    // it is offered even when the rate is still pending — a rep has to be able to
    // hand over a schedule while pricing is being settled.
    if (d.state === 'available') {
      h += '<div class="umv-res"><div class="umv-res-l">Price plan</div>' +
           '<div class="umv-res-b"><button class="btn btn-secondary" onclick="_umvQuote(\'' + d.unit_id + '\')">' +
           'Make a plan</button></div></div>';
    }
    if (d.can_reserve) {
      h += '<div class="umv-res"><div class="umv-res-l">Hold this unit</div>' +
           '<div class="umv-res-b"><button class="btn btn-primary" onclick="_umvReserve(\'' + d.unit_id + '\',3)">3 days</button>' +
           '<button class="btn btn-primary" onclick="_umvReserve(\'' + d.unit_id + '\',7)">7 days</button></div></div>';
    } else if (d.state === 'available' && d.rate_pending) {
      h += '<div class="umv-note">No rate on this unit yet — it cannot be held until one is set.</div>';
    }
    h += '</div>';
    $('umv-sheet').innerHTML = h;
  }
  function _row(l, v) { return '<div class="umv-row"><span>' + l + '</span><span>' + v + '</span></div>'; }
  window._umvClose = function () { MAP.sel = null; $('umv-sheet').innerHTML = ''; _highlight(); };

  // ── reserve — reserve_unit() and nothing else ────────────────────────────
  window._umvReserve = async function (unitId, days) {
    var name = prompt('Client name for this hold?');
    if (!name) return;
    var phone = prompt('Client phone?') || null;
    var r = await sb.rpc('reserve_unit', {
      p_session_token: TOKEN, p_unit_id: unitId, p_client_name: name, p_client_phone: phone,
      p_expiry_days: days, p_token_received: false, p_token_amount: null, p_note: 'Held from the unit map'
    });
    var d = r.data;
    if (!d || !d.success) return toast((d && d.message) || 'Could not hold this unit', 'err');
    toast('Held for ' + days + ' days', 'ok');
    await _umvOpen(MAP.planId);              // recolour from the server, never locally
  };

  // ── price plan → save_unit_quote() → PDF ─────────────────────────────────
  // Deliberately NOT a reservation. Nothing here touches reserve_unit, and the
  // unit is still available to the next rep the moment this closes.
  function _unit(unitId) {
    return ((MAP.plan && MAP.plan.units) || []).filter(function (x) { return x.unit_id === unitId; })[0];
  }
  function _isod(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }

  window._umvQuote = function (unitId) {
    var u = _unit(unitId);
    if (!u) return toast('Open the floor first', 'err');
    var price = Number(u.price) || 0;
    // A sensible opening offer the rep can overwrite: a fifth down, two years to pay.
    var dp = price ? Math.round(price * 0.2 / 1000) * 1000 : '';
    var mon = price ? Math.round((price - dp) / 24 / 1000) * 1000 : '';
    var s = new Date(); s.setDate(1); s.setMonth(s.getMonth() + 1);
    var e = new Date(s.getTime()); e.setMonth(e.getMonth() + 23);

    function fld(id, label, extra, val) {
      return '<div class="field"><label class="label">' + label + '</label>' +
             '<input class="input" id="' + id + '" ' + (extra || '') +
             ' value="' + (val == null ? '' : val) + '" autocomplete="off"></div>';
    }
    openModal('Price plan &mdash; ' + esc(u.unit_no),
      fld('uq-name', 'Client name', '') +
      fld('uq-phone', 'Phone <span style="color:var(--fk-text-muted);font-weight:400">(optional)</span>', 'inputmode="tel"') +
      fld('uq-disc', 'Discount (PKR)', 'inputmode="numeric"', 0) +
      fld('uq-dp', 'Down payment (PKR)', 'inputmode="numeric"', dp) +
      fld('uq-mon', 'Monthly instalment (PKR)', 'inputmode="numeric"', mon) +
      fld('uq-start', 'First instalment', 'type="date"', _isod(s)) +
      fld('uq-end', 'Last instalment', 'type="date"', _isod(e)) +
      (price ? '' : '<div class="umv-note" style="color:#d97706">This unit has no rate yet — the plan will say so on its face.</div>') +
      '<div class="umv-note">A plan does not hold the unit. It stays available until someone books it.</div>',
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" id="uq-go" onclick="_umvQuoteSave(\'' + unitId + '\')">Save &amp; make PDF</button>');
  };

  window._umvQuoteSave = async function (unitId) {
    var btn = $('uq-go'); if (btn && btn.disabled) return;
    var val = function (id) { var e = $(id); return e ? String(e.value).trim() : ''; };
    var num = function (id) { return Number(val(id).replace(/[^0-9.]/g, '')) || 0; };

    var u = _unit(unitId); if (!u) return toast('Open the floor first', 'err');
    var name = val('uq-name');
    if (!name) return toast('Who is this plan for?', 'err');
    var price = Number(u.price) || 0, disc = num('uq-disc'), dp = num('uq-dp');
    if (price && disc > price) return toast('The discount is larger than the price', 'err');
    if (price && dp > price - disc) return toast('The down payment is more than the net price', 'err');

    var label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
    try {
      var r = await sb.rpc('save_unit_quote', {
        p_session_token: TOKEN, p_unit_id: unitId, p_client_name: name,
        p_client_phone: val('uq-phone') || null, p_discount: disc,
        p_down_payment: dp, p_monthly: num('uq-mon'),
        p_start_date: val('uq-start') || null, p_end_date: val('uq-end') || null, p_lead_id: null });
      var d = r.data;
      if (d && d.error === 'session_expired') return sessionGone();
      if (!d || !d.success) throw new Error((d && d.message) || 'Could not save this plan');

      // Read it back rather than print what we sent: the PDF must show the row that
      // was actually stored, so a reprint months later matches it line for line.
      var g = await sb.rpc('get_unit_quote', { p_session_token: TOKEN, p_quote_id: d.id });
      var gd = g.data;
      if (!gd || !gd.success) throw new Error('Saved as ' + d.quote_no + ', but it could not be read back');

      var out = await QuotePDF.build({ artwork: MAP.plan.artwork, points: u.points,
        quote: gd.quote, unit: gd.unit, project: gd.project, by: gd.by });
      QuotePDF.download(out.bytes, gd.quote.quote_no + '.pdf');
      closeModal();
      toast(gd.quote.quote_no + ' saved', 'ok');
    } catch (e) {
      toast((e && e.message) || 'Could not make the plan', 'err');
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
    }
  };
})();
