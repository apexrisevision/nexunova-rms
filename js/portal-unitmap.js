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

  var MAP = { floors: [], plan: null, planId: null, sel: null, focus: null,
              base: null, onResize: null, z: 1, tx: 0, ty: 0, drag: null, proj: null, projects: null };
  var COLOR = { available: ['#0ea5e9', 'rgba(14,165,233,.22)'],
                reserved:  ['#d97706', 'rgba(217,119,6,.28)'],
                sold:      ['#059669', 'rgba(5,150,105,.30)'] };


  // Styles ship with the module, so sales-portal.html stays a one-line change.
  (function () {
    var st = document.createElement('style');
    st.textContent = ".umv-wrap{padding:12px 12px 90px}.umv-h{font-weight:700;margin:4px 2px 12px}.umv-load,.umv-msg{padding:24px;text-align:center;color:var(--fk-text-muted)}.umv-floors{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:9px}.umv-floor{display:flex;flex-direction:column;gap:3px;align-items:flex-start;padding:13px 14px;border:1px solid var(--fk-border);border-radius:var(--fk-radius-md);background:var(--fk-bg-card);color:var(--fk-text);font:inherit;cursor:pointer;text-align:left}.umv-floor.soon{opacity:.55;cursor:default}.umv-hd{margin:2px 2px 16px}.umv-hd-t{font-size:var(--fs-title);font-weight:700;letter-spacing:-.02em}.umv-hd-s{color:var(--fk-text-muted);font-size:var(--fs-secondary);margin-top:3px;font-weight:500}.umv-sec{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:16px 2px 8px}.umv-sec-t{font-size:var(--fk-fs-label);text-transform:uppercase;letter-spacing:.06em;font-weight:600;color:var(--fk-text-muted)}.umv-sec-c{font-size:var(--fs-caption);color:var(--fk-text-muted)}.umv-floor{position:relative;transition:border-color .14s,background .14s,transform .14s}.umv-floor:not(.soon):hover{border-color:var(--fk-primary);background:var(--fk-primary-tint);transform:translateY(-1px)}.umv-go{position:absolute;right:11px;top:50%;transform:translateY(-50%);color:var(--fk-text-muted);line-height:0}.umv-floor:not(.soon):hover .umv-go{color:var(--fk-primary)}.umv-blank{border:1px solid var(--fk-border);border-radius:var(--fk-radius-md);background:var(--fk-bg-card);padding:34px 24px;text-align:center}.umv-blank-i{width:48px;height:48px;margin:0 auto 12px;border-radius:14px;display:grid;place-items:center;background:var(--fk-bg-subtle);color:var(--fk-text-muted)}.umv-blank-t{font-weight:700;font-size:var(--fs-section)}.umv-blank-s{color:var(--fk-text-muted);margin:6px auto 0;max-width:44ch;line-height:1.5;font-size:var(--fs-secondary)}.umv-blank-b{margin-top:16px;height:36px;padding:0 18px;border:1px solid var(--fk-border);border-radius:9px;background:var(--fk-bg-subtle);color:var(--fk-text);font:inherit;font-weight:600;cursor:pointer}.umv-blank-b:hover{border-color:var(--fk-primary);color:var(--fk-primary)}.umv-fl{font-weight:700}.umv-fu{font-size:var(--fk-fs-label);color:var(--fk-text-muted)}.umv-top{display:flex;gap:10px;align-items:center;margin-bottom:9px}.umv-back{background:none;border:0;color:var(--fk-primary);font:inherit;cursor:pointer;padding:0}.umv-zoom{margin-left:auto;display:flex;gap:5px}.umv-zoom button{min-width:34px;height:30px;border:1px solid var(--fk-border);background:var(--fk-bg-card);color:var(--fk-text);border-radius:7px;font:inherit;cursor:pointer}.umv-legend{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:9px;font-size:var(--fs-caption)}.umv-chip{display:inline-flex;align-items:center;gap:5px;color:var(--fk-text-muted)}.umv-chip i{width:10px;height:10px;border-radius:3px;display:inline-block}.umv-stage{position:relative;overflow:hidden;border:1px solid var(--fk-border);border-radius:var(--fk-radius-md);background:#fff;touch-action:none;height:min(70vh,760px);min-height:320px}.umv-pan{position:absolute;left:0;top:0;width:100%;transform-origin:0 0;transition:transform .55s cubic-bezier(.22,.61,.36,1);line-height:0}@media (prefers-reduced-motion:reduce){.umv-pan{transition:none}}.umv-out{position:absolute;left:10px;top:10px;z-index:3;display:none;align-items:center;gap:6px;height:34px;padding:0 13px;border:1px solid var(--fk-border);border-radius:999px;background:var(--fk-bg-card);color:var(--fk-text);font:inherit;font-size:var(--fs-caption);font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(15,23,42,.18)}.umv-stage.focus .umv-out{display:inline-flex}.umv-pan img{width:100%;height:auto;display:block}.umv-pan svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.umv-soon{padding:40px 20px;text-align:center;border:1px dashed var(--fk-border);border-radius:var(--fk-radius-md)}.umv-soon-t{font-weight:700;font-size:var(--fs-section)}.umv-soon-s{color:var(--fk-text-muted);margin-top:6px}.umv-sheet-in{margin-top:12px;border:1px solid var(--fk-border);border-radius:var(--fk-radius-md);background:var(--fk-bg-card);padding:13px 15px}.umv-sh-top{display:flex;align-items:center;gap:9px;margin-bottom:9px}.umv-dot{width:11px;height:11px;border-radius:50%}.umv-state{margin-left:auto;font-size:var(--fs-caption);font-weight:700}.umv-x{background:none;border:0;color:var(--fk-text-muted);font-size:15px;cursor:pointer}.umv-rows{display:flex;flex-direction:column}.umv-row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--fk-border);font-size:var(--fs-caption)}.umv-row:last-child{border-bottom:0}.umv-row span:first-child{color:var(--fk-text-muted)}.umv-pend{color:#d97706;font-style:normal}.umv-res{margin-top:11px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.umv-res-l{font-size:var(--fs-caption);color:var(--fk-text-muted)}.umv-res-b{display:flex;gap:7px;margin-left:auto}.umv-note{margin-top:11px;font-size:var(--fs-caption);color:var(--fk-text-muted)}";
    document.head.appendChild(st);
  })();

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { return n ? Number(n).toLocaleString('en-US') : '—'; }
  // like money(), but a real zero prints as 0 — "Paid: PKR —" read as missing data
  function amount(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }

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

    /* The company builds three towers and only one of them has a drawing so far.
       Listing the projects that happen to have plans would silently answer
       "which building am I looking at?" with the only one available — so the
       chooser is built from every project the person can see, and a tower with
       no drawing says so rather than being left out. */
    if (MAP.projects === null) {
      try {
        var pr = await sb.rpc('get_project_profiles', { p_session_token: TOKEN });
        MAP.projects = (pr.data && pr.data.projects) || [];
      } catch (e) { MAP.projects = []; }
    }
    _floors();
  };

  /* The picker used to be a bare grid under the words "Pick a floor", and when a
     project had no drawing yet it said "No floors yet." and nothing else — a
     dead end that reads as a broken screen rather than as work not yet done.

     Two things changed. The floors are grouped under their project, because a
     dealer-group login sees KBH's floors and FMH's floors in the same call and a
     flat grid mixed them; and the empty case now says who publishes a floor plan
     and where the same units can be seen meanwhile. */
  function _floors() {
    var head = '<div class="umv-hd"><div class="umv-hd-t">Unit map</div>' +
      '<div class="umv-hd-s">The floor drawing, coloured by what is available.</div></div>';

    // Every project the person can see, whether or not it has a drawing yet.
    var order = [], byProject = {};
    (MAP.projects || []).forEach(function (p) {
      var k = p.project_name || 'Project';
      if (!byProject[k]) { byProject[k] = []; order.push(k); }
    });
    MAP.floors.forEach(function (f) {
      var k = f.project_name || 'Project';
      if (!byProject[k]) { byProject[k] = []; order.push(k); }
      byProject[k].push(f);
    });
    var many = order.length > 1;
    if (many && order.indexOf(MAP.proj) < 0) {
      // Open on a tower that actually has something to show.
      var withPlans = order.filter(function (n) { return byProject[n].length; });
      MAP.proj = withPlans.length ? withPlans[0] : order[0];
    }
    var chooser = !many ? '' :
      '<div style="margin:0 2px 7px;font-size:var(--fk-fs-label);text-transform:uppercase;' +
      'letter-spacing:.06em;font-weight:600;color:var(--fk-text-muted)">Choose a project</div>' +
      '<div class="projchips" style="margin-bottom:14px">' + order.map(function (name) {
        var live = byProject[name].filter(function (f) { return f.status === 'published'; }).length;
        return '<div class="pchip' + (name === MAP.proj ? ' on' : '') + '" ' +
          'onclick="_umvProj(' + JSON.stringify(name).replace(/"/g, '&quot;') + ')">' +
          esc(name) + '<span style="opacity:.72;font-weight:500"> · ' +
          (live ? live + ' floor' + (live === 1 ? '' : 's') : 'no plan yet') + '</span></div>';
      }).join('') + '</div>';

    var shown = many ? (byProject[MAP.proj] || []) : MAP.floors;

    if (!shown.length) {
      $('app-body').innerHTML = '<div class="umv-wrap">' + head + chooser +
        '<div class="umv-blank">' +
          '<div class="umv-blank-i"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" ' +
            'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>' +
            '<path d="M9 9v12"/><path d="M15 3v6"/></svg></div>' +
          '<div class="umv-blank-t">No floor plan published yet</div>' +
          '<div class="umv-blank-s">A floor appears here once the office uploads its drawing and ' +
            'marks each apartment on it. Until then the same units are listed on the Units screen.</div>' +
          '<button class="umv-blank-b" onclick="setTab(\'board\')">Open Units</button>' +
        '</div></div>';
      return;
    }

    var body = (many ? [MAP.proj] : order).map(function (name) {
      var live = byProject[name].filter(function (f) { return f.status === 'published'; }).length;
      var sec = many
        ? '<div class="umv-sec"><span class="umv-sec-t">' + esc(name) + '</span>' +
          '<span class="umv-sec-c">' + live + ' of ' + byProject[name].length + ' ready</span></div>'
        : '';
      return sec + '<div class="umv-floors">' + byProject[name].map(function (f) {
        var soon = f.status !== 'published';
        return '<button class="umv-floor' + (soon ? ' soon' : '') + '"' +
          (soon ? ' disabled' : ' onclick="_umvOpen(\'' + f.id + '\')"') + '>' +
          '<span class="umv-fl">' + esc(f.floor_label) + '</span>' +
          '<span class="umv-fu">' + (soon ? 'Coming soon' : f.units + ' units') + '</span>' +
          (soon ? '' : '<span class="umv-go"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
            'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="m9 18 6-6-6-6"/></svg></span>') +
          '</button>';
      }).join('') + '</div>';
    }).join('');

    $('app-body').innerHTML = '<div class="umv-wrap">' + head + chooser + body +
      '<div class="umv-legend" style="margin:14px 2px 0">' +
        '<span class="umv-chip"><i style="background:' + COLOR.available[0] + '"></i>Available</span>' +
        '<span class="umv-chip"><i style="background:' + COLOR.reserved[0] + '"></i>Reserved</span>' +
        '<span class="umv-chip"><i style="background:' + COLOR.sold[0] + '"></i>Sold</span>' +
      '</div></div>';
  }

  // Picking a project redraws the floor list; the map itself is untouched.
  window._umvProj = function (name) { MAP.proj = name; _floors(); };

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
    MAP.plan = d; MAP.sel = null; MAP.focus = null; MAP.z = 1; MAP.tx = 0; MAP.ty = 0;
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
          '<button class="umv-out" id="umv-out" onclick="_umvClose()">&lsaquo; All units</button>' +
          '<div class="umv-pan" id="umv-pan">' +
            '<img id="umv-img" src="' + esc(a.image_path) + '" alt="">' +
            '<svg id="umv-svg" viewBox="0 0 1 1" preserveAspectRatio="none"></svg>' +
          '</div>' +
        '</div>' +
        '<div id="umv-sheet"></div>' +
      '</div>';
    var img = $('umv-img');
    var go = function () { _paint(); _fitAll(true); };
    if (img.complete) go(); else img.onload = go;
    _bindPan();
    if (!MAP.onResize) {
      MAP.onResize = function () { if ($('umv-stage')) { MAP.focus ? _focusOn(MAP.focus, true) : _fitAll(true); } };
      window.addEventListener('resize', MAP.onResize);
    }
  }
  function _chip(k, n) {
    return '<span class="umv-chip"><i style="background:' + COLOR[k][0] + '"></i>' +
      k.charAt(0).toUpperCase() + k.slice(1) + ' <b>' + n + '</b></span>';
  }

  /* FOCUS — one unit, alone.
     A client being shown a flat should see that flat and nothing else. So the
     focused state is not "a bit more zoom": the view flies to the unit's own
     bounding box, and a veil with a hole cut out of it covers the rest of the
     drawing. The hole is the unit's real outline, so what stays visible is the
     flat's own plan — walls, rooms, balcony — at full resolution. */
  // Strong enough that a neighbouring flat cannot be read. At .93 the surrounding
  // plan was still legible, which is not "only this unit" — it is a dimmer floor.
  var VEIL = 'rgba(255,255,255,.965)';

  function _paint() {
    var svg = $('umv-svg'); if (!svg) return;
    if (MAP.focus) return _paintFocus(svg, MAP.focus);
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

  function _paintFocus(svg, u) {
    var c = COLOR[u.state] || COLOR.available;
    var pts = (u.points || []).map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
    var lx = u.label_x != null ? u.label_x : _cx(u.points)[0];
    var ly = u.label_y != null ? u.label_y : _cx(u.points)[1];
    // The label rides the zoom with everything else, so it stays at drawing scale —
    // sizing it against the unit made it swallow the flat it was labelling.
    var fs = 0.01;
    svg.innerHTML =
      '<defs><mask id="umv-hole" maskUnits="userSpaceOnUse" x="0" y="0" width="1" height="1">' +
        '<rect x="0" y="0" width="1" height="1" fill="#fff"/>' +
        '<polygon points="' + pts + '" fill="#000"/></mask></defs>' +
      '<rect x="0" y="0" width="1" height="1" fill="' + VEIL + '" mask="url(#umv-hole)"' +
        ' style="cursor:zoom-out" onclick="_umvClose()"/>' +
      '<polygon data-unit="' + u.unit_id + '" points="' + pts + '" fill="none" stroke="' + c[0] +
        '" stroke-width="3" vector-effect="non-scaling-stroke" style="pointer-events:none"/>' +
      '<text x="' + lx + '" y="' + ly + '" font-size="' + fs + '" text-anchor="middle" font-weight="700"' +
        ' fill="#0f172a" style="paint-order:stroke;stroke:#fff;stroke-width:' + (fs * 0.34) +
        ';pointer-events:none">' + esc(u.unit_no) + '</text>';
  }

  // ── the view: fit a normalised box into the stage ────────────────────────
  function _box(p) {
    var x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    (p || []).forEach(function (q) {
      x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]);
      x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]);
    });
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  // The drawing is mostly margin and a title band — the building itself is barely
  // half the sheet. Framing the UNITS instead of the paper is most of why the map
  // stopped looking small.
  function _unitsBox() {
    var b = { x0: 1, y0: 1, x1: 0, y1: 0 };
    (MAP.plan.units || []).forEach(function (u) {
      var q = _box(u.points);
      b.x0 = Math.min(b.x0, q.x0); b.y0 = Math.min(b.y0, q.y0);
      b.x1 = Math.max(b.x1, q.x1); b.y1 = Math.max(b.y1, q.y1);
    });
    if (b.x1 <= b.x0) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    var px = (b.x1 - b.x0) * 0.03, py = (b.y1 - b.y0) * 0.05;
    return { x0: Math.max(0, b.x0 - px), y0: Math.max(0, b.y0 - py),
             x1: Math.min(1, b.x1 + px), y1: Math.min(1, b.y1 + py) };
  }
  function _view(b, fill) {
    var st = $('umv-stage'); if (!st) return null;
    var SW = st.clientWidth, SH = st.clientHeight;
    var a = MAP.plan.artwork || {};
    var img = $('umv-img');
    var ar = (img && img.naturalWidth) ? img.naturalHeight / img.naturalWidth
           : (a.h && a.w ? a.h / a.w : 2 / 3);
    var PW = SW, PH = SW * ar;                       // the pan at scale 1
    var bw = (b.x1 - b.x0) * PW, bh = (b.y1 - b.y0) * PH;
    if (!(bw > 0 && bh > 0)) return null;
    var z = Math.max(0.15, Math.min(Math.min(SW * fill / bw, SH * fill / bh), 60));
    return { z: z, tx: SW / 2 - z * ((b.x0 + b.x1) / 2) * PW,
                   ty: SH / 2 - z * ((b.y0 + b.y1) / 2) * PH };
  }
  function _apply(v, animate) {
    if (!v) return;
    var el = $('umv-pan'); if (!el) return;
    if (!animate) { el.style.transition = 'none'; }
    MAP.z = v.z; MAP.tx = v.tx; MAP.ty = v.ty; _applyT();
    if (!animate) { void el.offsetWidth; el.style.transition = ''; }
  }
  function _fitAll(instant) {
    MAP.base = _view(_unitsBox(), 0.98);
    _apply(MAP.base, !instant);
  }
  function _focusOn(u, instant) {
    _apply(_view(_box(u.points), 0.74), !instant);
  }

  // ── zoom (CSS transform) + pan ───────────────────────────────────────────
  window._umvZoom = function (dir) {
    if (dir === 0) { MAP.focus = null; _setFocusChrome(false); _paint(); return _fitAll(false); }
    var st = $('umv-stage'); if (!st) return;
    var SW = st.clientWidth, SH = st.clientHeight;
    var floor = (MAP.base && MAP.base.z ? MAP.base.z : 1) * 0.6;
    var nz = Math.max(floor, Math.min(MAP.z * (dir > 0 ? 1.4 : 1 / 1.4), 60));
    var k = nz / MAP.z;                              // keep the stage centre still
    MAP.tx = SW / 2 - (SW / 2 - MAP.tx) * k;
    MAP.ty = SH / 2 - (SH / 2 - MAP.ty) * k;
    MAP.z = nz; _applyT();
  };
  function _setFocusChrome(on) {
    var st = $('umv-stage'); if (st) st.classList.toggle('focus', !!on);
  }
  function _applyT() {
    var el = $('umv-pan'); if (!el) return;
    el.style.transform = 'translate(' + MAP.tx + 'px,' + MAP.ty + 'px) scale(' + MAP.z + ')';
  }
  function _bindPan() {
    var st = $('umv-stage'); if (!st) return;
    // ⚠ NEVER call setPointerCapture on pointerdown here. With the pointer captured
    // by the stage, the browser dispatches the CLICK to the stage too — the polygon's
    // own onclick never runs, so every tap after the first one appeared to re-open
    // whichever unit was opened first. That is exactly the bug that reached the
    // owner. Capture only once a real drag has started, and never before.
    st.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.umv-out')) return;   // the button is not a drag handle
      MAP.swallow = false;
      MAP.drag = { sx: e.clientX, sy: e.clientY, x: e.clientX - MAP.tx, y: e.clientY - MAP.ty,
                   id: e.pointerId, moved: false };
    });
    st.addEventListener('pointermove', function (e) {
      var d = MAP.drag; if (!d) return;
      if (!d.moved) {
        if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 6) return;   // a tap wobbles
        d.moved = true;
        try { st.setPointerCapture(d.id); } catch (err) {}
        // dragging is direct manipulation — it must not lag behind an animation
        var el = $('umv-pan'); if (el) el.style.transition = 'none';
      }
      MAP.tx = e.clientX - d.x; MAP.ty = e.clientY - d.y; _applyT();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      st.addEventListener(ev, function () {
        var d = MAP.drag; MAP.drag = null;
        var el = $('umv-pan'); if (el) el.style.transition = '';
        if (d && d.moved) {
          try { st.releasePointerCapture(d.id); } catch (err) {}
          MAP.swallow = true;          // a drag that ends over a unit must not open it
        }
      });
    });
  }

  // ── tap a unit → server decides what this role may see ───────────────────
  window._umvTap = async function (unitId) {
    if (MAP.swallow) { MAP.swallow = false; return; }   // that was a pan, not a tap
    var r = await sb.rpc('get_map_unit_detail', { p_session_token: TOKEN, p_unit_id: unitId });
    var d = r.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) return toast('Could not load this unit', 'err');
    MAP.sel = d;
    // the geometry lives on the plan; the detail comes from the server
    var u = ((MAP.plan && MAP.plan.units) || []).filter(function (x) { return x.unit_id === unitId; })[0];
    if (u) {
      MAP.focus = u;
      _setFocusChrome(true);
      _paint();                    // veil + this unit alone
      _focusOn(u, false);          // and fly to it
    } else { _highlight(); }
    _sheet(d);
  };

  function _sheet(d) {
    var c = COLOR[d.state] || COLOR.available;
    var h = '<div class="umv-sheet-in"><div class="umv-sh-top">' +
      '<span class="umv-dot" style="background:' + c[0] + '"></span>' +
      '<b>' + esc(d.unit_no) + '</b>' +
      '<span class="umv-state" style="color:' + c[0] + '">' +
        esc(d.label || (d.state || '').charAt(0).toUpperCase() + (d.state || '').slice(1)) + '</span>' +
      '<button class="umv-x" onclick="_umvClose()">✕</button></div>' +
      '<div class="umv-rows">' +
        _row('Type', esc(d.type || '—')) +
        _row('Area', d.area ? Number(d.area).toLocaleString('en-US') + ' sft' : '—');

    // A sold unit's price never reaches a rep, so there is no Rate row to draw —
    // the test is "did the server send one", never "should I hide one".
    if (d.rate_pending) h += _row('Rate', '<i class="umv-pend">Rate pending</i>');
    else if (d.price != null) h += _row('Rate', 'PKR ' + money(d.price));

    // Three tiers, all decided by get_map_unit_detail: a rep's sold unit carries
    // the buyer's NAME and nothing else about them; a director's carries the rest.
    if (d.sale) {
      h += _row('Client', esc(d.sale.client_name || '—'));
      if (d.sale.client_phone) h += _row('Phone', esc(d.sale.client_phone));
      if (d.sale.sale_number)  h += _row('Sale', esc(d.sale.sale_number));
      // nothing paid yet is "PKR 0", not a dash — money() reads 0 as "no value"
      if (d.sale.net_amount != null)  h += _row('Net', 'PKR ' + amount(d.sale.net_amount));
      if (d.sale.paid != null)        h += _row('Paid', 'PKR ' + amount(d.sale.paid));
      if (d.sale.outstanding != null) h += _row('Outstanding', '<b>PKR ' + amount(d.sale.outstanding) + '</b>');
      if (Number(d.sale.overdue) > 0) h += _row('Overdue', '<b style="color:#dc2626">PKR ' + money(d.sale.overdue) + '</b>');
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
  window._umvClose = function () {
    MAP.sel = null; MAP.focus = null;
    var sh = $('umv-sheet'); if (sh) sh.innerHTML = '';
    _setFocusChrome(false);
    _paint();                      // every unit back, veil gone
    _fitAll(false);                // and fly back out to the whole floor
  };

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
