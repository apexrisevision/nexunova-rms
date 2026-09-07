/* ══ Reserve Desk + Daybook ══════════════════════════════════════════════════
   Awami Market hands over with 1,467 units and one person taking every booking
   off a WhatsApp group: "Unit LG-12 reserve kar do". Scrolling a board of 1,467
   tiles is the wrong instrument for that. Typing the unit number is the right
   one, so this screen is two inputs and a return key.

   SHELL CONTRACT — read before touching anything here:

   · Globals are reached BARE, never through window. sb, TOKEN, ME, toast, esc,
     pkrFull, li, _isOfficeRole, _waNum, setTab, sessionGone and _portalCopy are
     all top-level const/let in sales-portal.html, which puts them in the global
     LEXICAL scope — visible to every classic script, but absent from `window`.
     `window.sb` is undefined and always has been.
   · Every DOM read is scoped to this screen's own root node (_q / _qa below).
     A bare document.getElementById in a single-page shell will happily return
     somebody else's element with the same id; scoping makes that impossible
     rather than unlikely.
   · Entry is window.renderReserveDesk / window.renderDaybook, called from
     setTab, which is the ONE place every boot path converges on — fresh login,
     restored session, ?tab= deep link and a tab switch all arrive through
     _showApp() -> setTab(). Nothing here hooks a boot path of its own.

   THE INDEX IS CACHED. 1,467 units is 282 KB, and refetching that on every
   visit to this screen is real money on a phone. It is fetched once per project
   and then PATCHED locally as bookings happen. That is safe because the cache
   is never the authority: reserve_unit_desk re-reads availability inside its
   row lock, so a stale card cannot double-book — the worst case is a refused
   booking, and on that refusal this file refetches rather than guessing.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var DESK = {
    data: null,          // last get_reserve_desk payload
    projectId: null,     // project the cache belongs to
    fetchedAt: 0,
    idx: {},             // UNIT_NO (upper) -> unit object, for O(1) typing
    reqById: {},         // agent_id / sales_user_id -> requester   (IDENTITY)
    reqByLabel: {},      // label (lower) -> [requesters]           (typing aid only)
    sel: null,           // resolved unit
    days: 7,
    busy: false
  };
  var STALE_MS = 15 * 60 * 1000;   // a soft ceiling; bookings patch in between

  /* ── styles, once ───────────────────────────────────────────────────────── */
  (function () {
    if (document.getElementById('rd-style')) return;
    var st = document.createElement('style');
    st.id = 'rd-style';
    st.textContent =
      ".rd{padding:2px 0 90px}" +
      ".rd-bar{background:var(--fk-bg-card);border:1px solid var(--fk-border);border-radius:var(--fk-radius-card);" +
        "padding:14px;box-shadow:var(--fk-shadow);margin-bottom:12px}" +
      ".rd-lb{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--fk-text-muted);" +
        "font-weight:700;margin:0 2px 5px}" +
      ".rd-in{width:100%;height:52px;padding:0 13px;border:1px solid var(--fk-border);" +
        "border-radius:var(--fk-radius-control);background:var(--fk-bg-input,var(--fk-bg-card));" +
        "color:var(--fk-text);font:inherit;font-size:18px;font-weight:700;letter-spacing:.02em}" +
      ".rd-in:focus{outline:none;border-color:var(--fk-primary);box-shadow:0 0 0 3.5px var(--fk-primary-surface)}" +
      ".rd-in.rq{font-size:15px;font-weight:600;letter-spacing:0}" +
      ".rd-hit{margin-top:9px;border-radius:11px;padding:10px 12px;border:1px solid var(--fk-border);" +
        "background:var(--fk-bg-subtle);font-size:var(--fs-secondary);line-height:1.5}" +
      ".rd-hit.ok{border-color:var(--fk-success-edge);background:var(--fk-success-surface)}" +
      ".rd-hit.no{border-color:var(--fk-danger-edge);background:var(--fk-danger-surface)}" +
      ".rd-hit.warn{border-color:var(--fk-warning-edge);background:var(--fk-warning-surface)}" +
      ".rd-hit b{font-size:15px}" +
      ".rd-meta{color:var(--fk-text-muted);margin-top:2px}" +
      ".rd-chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:6px}" +
      ".rd-chip{height:38px;min-width:44px;padding:0 13px;border-radius:var(--fk-radius-control);" +
        "border:1px solid var(--fk-border);background:var(--fk-bg-card);color:var(--fk-text);" +
        "font:inherit;font-size:var(--fs-secondary);font-weight:600;cursor:pointer;" +
        "box-shadow:0 1px 0 rgba(15,23,42,.05)}" +
      ".rd-chip.on{background:var(--fk-primary);border-color:var(--fk-primary);color:#fff}" +
      ".rd-chip.cust{width:78px;text-align:center;font-weight:700}" +
      ".rd-go{margin-top:12px;width:100%;height:50px;border:0;border-radius:var(--fk-radius-control);" +
        "background:var(--fk-primary);color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer;" +
        "box-shadow:0 2px 0 rgba(15,23,42,.14)}" +
      ".rd-go:disabled{opacity:.5;cursor:default;box-shadow:none}" +
      ".rd-more{margin-top:10px;border-top:1px dashed var(--fk-border);padding-top:10px}" +
      ".rd-more summary{cursor:pointer;font-size:var(--fs-caption);color:var(--fk-text-muted);font-weight:600}" +
      ".rd-2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}" +
      ".rd-sm{width:100%;height:42px;padding:0 11px;border:1px solid var(--fk-border);" +
        "border-radius:var(--fk-radius-control);background:var(--fk-bg-card);color:var(--fk-text);font:inherit}" +
      ".rd-h{font-weight:700;margin:16px 2px 8px;display:flex;align-items:center;gap:8px}" +
      ".rd-h span.n{font-size:var(--fs-caption);color:var(--fk-text-muted);font-weight:600}" +
      ".rd-row{display:flex;align-items:center;gap:10px;padding:11px 13px;border:1px solid var(--fk-border);" +
        "border-radius:11px;background:var(--fk-bg-card);margin-bottom:7px}" +
      ".rd-row .u{font-weight:700;min-width:74px}" +
      ".rd-row .w{flex:1;min-width:0;font-size:var(--fs-secondary);color:var(--fk-text-muted);" +
        "overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".rd-row .t{font-size:var(--fs-caption);color:var(--fk-text-muted);flex:none}" +
      ".rd-undo{flex:none;height:32px;padding:0 11px;border-radius:9px;border:1px solid var(--fk-border);" +
        "background:var(--fk-bg-card);color:var(--fk-text);font:inherit;font-size:var(--fs-caption);" +
        "font-weight:600;cursor:pointer}" +
      ".rd-undo:disabled{opacity:.45;cursor:default}" +
      ".rd-empty{padding:20px;text-align:center;color:var(--fk-text-muted);font-size:var(--fs-secondary)}" +
      ".rd-top{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}" +
      ".rd-top select{flex:1 1 160px;min-width:0}" +
      /* ── daybook ── */
      ".db-sec{margin-bottom:16px}" +
      ".db-t{font-weight:700;margin:0 2px 7px;display:flex;align-items:center;gap:8px}" +
      ".db-t .c{font-size:var(--fs-caption);color:var(--fk-text-muted);font-weight:600}" +
      ".db-tbl{width:100%;border-collapse:collapse;font-size:var(--fs-secondary)}" +
      ".db-tbl th{text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;" +
        "color:var(--fk-text-muted);padding:6px 8px;border-bottom:1px solid var(--fk-border)}" +
      ".db-tbl td{padding:8px;border-bottom:1px solid var(--fk-border);vertical-align:top}" +
      ".db-tbl td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".db-wrap{overflow-x:auto;border:1px solid var(--fk-border);border-radius:11px;background:var(--fk-bg-card)}" +
      ".db-acts{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 14px}" +
      /* ── print: the daybook only ── */
      "#rd-print{display:none}" +
      "@media print{" +
        "body.rd-printing #screen-app,body.rd-printing #modal-host,body.rd-printing #toastbar{display:none !important}" +
        "body.rd-printing #rd-print{display:block !important;padding:0;margin:0}" +
        "#rd-print *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}" +
        "#rd-print{font:12px/1.5 Inter,system-ui,sans-serif;color:#0F172A}" +
        "#rd-print .ph{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0F172A;padding-bottom:9px;margin-bottom:12px}" +
        "#rd-print .ph img{height:44px;width:auto}" +
        "#rd-print .ph h1{font-size:17px;font-weight:700;margin:0}" +
        "#rd-print .ph .s{font-size:11px;color:#475569;margin-top:2px}" +
        "#rd-print h2{font-size:13px;font-weight:600;margin:14px 0 5px;color:#0F172A}" +
        "#rd-print table{width:100%;border-collapse:collapse;font-size:11px}" +
        "#rd-print th{background:#F1F5F9;text-align:left;padding:5px 7px;border:1px solid #CBD5E1;font-weight:600}" +
        "#rd-print td{padding:5px 7px;border:1px solid #CBD5E1}" +
        "#rd-print td.n{text-align:right;font-variant-numeric:tabular-nums}" +
        "#rd-print .sig{margin-top:34px;display:flex;gap:44px}" +
        "#rd-print .sig div{flex:1;border-top:1px solid #0F172A;padding-top:5px;font-size:10px;color:#475569}" +
        "#rd-print .none{color:#64748B;font-style:italic;font-size:11px}" +
      "}";
    document.head.appendChild(st);
  })();

  /* ── scoped DOM access. Never document.getElementById from in here. ─────── */
  function _root() { return document.getElementById('rd-root'); }
  function _q(sel) { var r = _root(); return r ? r.querySelector(sel) : null; }
  function _dbRoot() { return document.getElementById('db-root'); }
  function _dbq(sel) { var r = _dbRoot(); return r ? r.querySelector(sel) : null; }

  /* Is this screen still the one the shell is on?
     Every render here awaits an RPC, and app-body belongs to whichever tab is
     current when the await RESOLVES, not when it started. Boot proved it: a
     desk opened while _showApp() was still finishing painted itself, took a
     real booking, and was then wiped by the shell's own setTab('home') landing
     a moment later — the reservation was saved and the operator was looking at
     the dashboard. Anything that paints after an await checks this first. */
  function _alive(tab) {
    try { return typeof TAB !== 'undefined' && TAB === tab; } catch (e) { return true; }
  }

  function _mayUse() {
    // Mirrors the server: office roles and lead_entry are refused by
    // get_reserve_desk anyway, this only saves them a wasted screen.
    if (!ME || !ME.role) return true;               // unknown yet — let the server decide
    if (ME.role === 'lead_entry') return false;
    try { if (_isOfficeRole(ME.role)) return false; } catch (e) {}
    return true;
  }

  function _pkTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('en-US',
        { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Karachi' });
    } catch (e) { return ''; }
  }
  function _pkDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-US',
        { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' });
    } catch (e) { return String(iso).slice(0, 10); }
  }
  function _left(iso) {
    if (!iso) return '';
    var ms = new Date(iso) - new Date();
    if (ms <= 0) return 'expired';
    var h = Math.floor(ms / 3.6e6);
    return h < 24 ? (h + 'h left') : (Math.floor(h / 24) + 'd left');
  }

  /* ── the cache ─────────────────────────────────────────────────────────── */
  /* 03009025113 -> 0300-9025113. Also accepts +92/0092 forms, because the same
     person is stored either way depending on when they were entered. */
  function _phoneDisp(p) {
    var d = String(p == null ? '' : p).replace(/\D/g, '');
    if (d.length === 12 && d.slice(0, 2) === '92') d = '0' + d.slice(2);
    else if (d.length === 14 && d.slice(0, 4) === '0092') d = '0' + d.slice(4);
    return d.length >= 8 ? d.slice(0, 4) + '-' + d.slice(4) : String(p == null ? '' : p);
  }

  /* Two people in Awami are both called "Fawad khan" — different CNICs,
     different agent codes, 2 and 14 real sales apiece. They are not a duplicate
     and neither is going away, so the picker has to tell them apart at the
     moment of typing. The agent code does that in the data but not in the head:
     nobody recognises AGT-2026-0005. The PHONE is what the operator has just
     read in the WhatsApp group, so that is what is appended — and only to the
     entries that actually collide, so 120-odd unique names stay clean. */
  function _reindex() {
    DESK.idx = {}; DESK.reqById = {}; DESK.reqByLabel = {};
    /* Unit numbers are unique inside a tower, not across towers — LG-12 exists
       in more than one. The payload is scoped to one project server-side, but
       this index must not depend on that being true: it records EVERY unit for
       a number, so an ambiguous one is refused rather than resolved to whichever
       happened to load last. Same rule as the requester: a display string is
       never an identity. */
    var u = (DESK.data && DESK.data.units) || [], i, un;
    for (i = 0; i < u.length; i++) {
      un = String(u[i].n || '').toUpperCase();
      (DESK.idx[un] = DESK.idx[un] || []).push(u[i]);
    }

    /* THE INDEX IS KEYED ON id, NEVER ON THE LABEL.
       It used to be keyed on the label, and nine entries in the Awami picker
       carried byte-identical labels — same name, same agent code, same phone,
       differing only by tenant — so each silently overwrote the last and a pick
       resolved to whichever happened to load second. A booking would have
       succeeded with requested_by_agent_id pointing at another company's row and
       nothing on screen to say so. A label is for a person to read. Identity is
       the id. */
    var r = (DESK.data && DESK.data.requesters) || [], byName = {}, k;
    for (i = 0; i < r.length; i++) {
      k = String(r[i].name || '').trim().toLowerCase();
      byName[k] = (byName[k] || 0) + 1;
    }

    // pass 1 — name, code, and the phone only where the NAME repeats
    for (i = 0; i < r.length; i++) {
      k = String(r[i].name || '').trim().toLowerCase();
      r[i]._collides = byName[k] > 1;
      var lbl = r[i].name;
      if (r[i].code) lbl += ' · ' + r[i].code;
      if (r[i]._collides && r[i].phone) lbl += ' · ' + _phoneDisp(r[i].phone);
      r[i]._label = lbl;
    }

    // pass 2 — the company, only where that label STILL repeats. The same person
    // holds one agent row per tenant with the same name, code and phone, so this
    // is the only thing left that differs. Scoping the picker to the project's
    // company removes most of these; it does not make labels unique, because two
    // different people can share a name inside one tenant.
    var lblCount = {};
    for (i = 0; i < r.length; i++) {
      k = r[i]._label.toLowerCase();
      lblCount[k] = (lblCount[k] || 0) + 1;
    }
    for (i = 0; i < r.length; i++) {
      k = r[i]._label.toLowerCase();
      if (lblCount[k] > 1 && r[i].company) r[i]._label += ' · ' + r[i].company;
    }

    // resolve by id; the label map is a convenience for typing and may still be
    // ambiguous, so it records EVERY match rather than the last one to be seen.
    DESK.reqById = {};
    DESK.reqByLabel = {};
    for (i = 0; i < r.length; i++) {
      if (r[i].id) DESK.reqById[String(r[i].id)] = r[i];
      k = r[i]._label.toLowerCase();
      (DESK.reqByLabel[k] = DESK.reqByLabel[k] || []).push(r[i]);
    }
  }

  async function _load(projectId, force) {
    var fresh = DESK.data && DESK.projectId === projectId &&
                (Date.now() - DESK.fetchedAt) < STALE_MS;
    if (fresh && !force) return true;
    var r;
    try { r = await sb.rpc('get_reserve_desk', { p_session_token: TOKEN, p_project_id: projectId || null }); }
    catch (e) { return false; }
    var d = r && r.data;
    if (d && d.error === 'session_expired') return 'expired';
    if (!d || !d.success) return d && d.error ? d.error : false;
    DESK.data = d; DESK.projectId = projectId || null; DESK.fetchedAt = Date.now();
    _reindex();
    return true;
  }

  /* ── the screen ────────────────────────────────────────────────────────── */
  window.renderReserveDesk = async function () {
    var host = document.getElementById('app-body');
    if (!host) return;
    if (!_mayUse()) {
      host.innerHTML = '<div class="rd"><div class="card"><div class="rd-empty">' +
        'Booking is not part of your role.</div></div></div>';
      return;
    }
    host.innerHTML = _skel();

    var want = DESK.projectId;
    if (!want) {
      // default to the scope the session is locked to, else the first project
      want = (DESK.data && DESK.data.scope_project_id) || null;
    }
    var ok = await _load(want, false);
    if (!_alive('desk')) return;                       // shell moved on mid-load
    if (ok === 'expired') return sessionGone();
    if (ok !== true) {
      if (ok === 'role_cannot_sell' || ok === 'forbidden') {
        host.innerHTML = '<div class="rd"><div class="card"><div class="rd-empty">' +
          'Booking is not part of your role.</div></div></div>';
        return;
      }
      return _netErr();
    }
    _paint(host);
  };

  function _paint(host) {
    var d = DESK.data, projects = d.projects || [];
    var cur = DESK.projectId ||
              (d.scope_project_id) ||
              (projects[0] && projects[0].id) || '';
    // if no project was chosen and more than one exists, settle on the first so
    // the index is never a mix of towers
    if (!DESK.projectId && projects.length) { DESK.projectId = cur; }

    var projSel = projects.length > 1
      ? '<select class="rd-sm" id="rd-proj">' + projects.map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>' +
                 esc(p.name) + (p.company && p.company !== p.name ? ' · ' + esc(p.company) : '') + '</option>';
        }).join('') + '</select>'
      : '<div class="rd-sm" style="display:flex;align-items:center;font-weight:600">' +
        esc((projects[0] && projects[0].name) || 'Inventory') + '</div>';

    var reqOpts = (d.requesters || []).map(function (r) {
      return '<option value="' + esc(r._label) + '"></option>';
    }).join('');

    host.innerHTML =
      '<div class="rd" id="rd-root">' +
        '<div class="rd-top">' + projSel +
          '<button class="rd-chip" id="rd-refresh" title="Reload the unit list">' + li('search', 15) + '</button>' +
          '<button class="rd-chip" id="rd-daybook">' + li('fileText', 15) + ' Daybook</button>' +
        '</div>' +

        '<div class="rd-bar">' +
          '<div class="rd-lb">Unit</div>' +
          '<input class="rd-in" id="rd-unit" autocomplete="off" autocapitalize="characters" ' +
                 'spellcheck="false" enterkeyhint="next" placeholder="LG-12">' +
          '<div id="rd-hit"></div>' +

          '<div class="rd-lb" style="margin-top:13px">Who asked for it</div>' +
          '<input class="rd-in rq" id="rd-req" list="rd-reqlist" autocomplete="off" ' +
                 'enterkeyhint="done" placeholder="Type a name">' +
          '<datalist id="rd-reqlist">' + reqOpts + '</datalist>' +
          '<div id="rd-reqhit" class="rd-meta" style="margin-top:5px;font-size:var(--fs-caption)"></div>' +

          '<div class="rd-lb" style="margin-top:13px">Hold for</div>' +
          '<div class="rd-chips" id="rd-days">' +
            [1, 3, 7, 15].map(function (n) {
              return '<button class="rd-chip' + (DESK.days === n ? ' on' : '') + '" data-d="' + n + '">' + n + 'd</button>';
            }).join('') +
            '<input class="rd-chip cust" id="rd-dcust" inputmode="numeric" placeholder="…" ' +
                   'title="Any number of days, 1 to 90">' +
          '</div>' +

          '<details class="rd-more">' +
            '<summary>Buyer details (optional)</summary>' +
            '<div class="rd-2">' +
              '<input class="rd-sm" id="rd-cname" placeholder="Buyer name" autocomplete="off">' +
              '<input class="rd-sm" id="rd-cphone" placeholder="Buyer phone" inputmode="tel" autocomplete="off">' +
            '</div>' +
            '<div class="rd-2">' +
              '<input class="rd-sm" id="rd-tamt" placeholder="Token received (PKR)" inputmode="numeric" autocomplete="off">' +
              '<input class="rd-sm" id="rd-note" placeholder="Note" autocomplete="off">' +
            '</div>' +
          '</details>' +

          '<button class="rd-go" id="rd-go" disabled>Reserve</button>' +
        '</div>' +

        '<div class="rd-h">Booked today ' +
          '<span class="n" id="rd-count">' + ((d.today || []).length) + '</span></div>' +
        '<div id="rd-today"></div>' +
      '</div>';

    _wire();
    _paintToday();
    var u = _q('#rd-unit'); if (u) { try { u.focus(); } catch (e) {} }
  }

  function _wire() {
    var root = _root(); if (!root) return;

    var proj = _q('#rd-proj');
    if (proj) proj.addEventListener('change', async function () {
      DESK.projectId = proj.value; DESK.sel = null;
      var ok = await _load(proj.value, true);
      if (!_alive('desk')) return;
      if (ok === 'expired') return sessionGone();
      if (ok !== true) return _netErr();
      _paint(document.getElementById('app-body'));
    });

    var ref = _q('#rd-refresh');
    if (ref) ref.addEventListener('click', async function () {
      var ok = await _load(DESK.projectId, true);
      if (!_alive('desk')) return;
      if (ok === 'expired') return sessionGone();
      if (ok !== true) { toast('Could not reload the unit list.', 'err'); return; }
      _paint(document.getElementById('app-body'));
      toast('Unit list reloaded.', 'ok');
    });

    var db = _q('#rd-daybook');
    if (db) db.addEventListener('click', function () { setTab('daybook'); });

    var unit = _q('#rd-unit');
    if (unit) {
      unit.addEventListener('input', function () { _lookup(unit.value); });
      unit.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var r = _q('#rd-req'); if (r) r.focus();
      });
    }

    var req = _q('#rd-req');
    if (req) {
      req.addEventListener('input', _reqEcho);
      req.addEventListener('change', _reqEcho);
      req.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        _reserve();
      });
    }

    var days = _q('#rd-days');
    if (days) days.addEventListener('click', function (e) {
      var b = e.target.closest('.rd-chip[data-d]'); if (!b) return;
      DESK.days = Number(b.getAttribute('data-d')) || 7;
      var cu = _q('#rd-dcust'); if (cu) cu.value = '';
      _syncDays();
    });
    var cust = _q('#rd-dcust');
    if (cust) cust.addEventListener('input', function () {
      var n = parseInt(cust.value, 10);
      if (n >= 1 && n <= 90) { DESK.days = n; _syncDays(); }
    });

    var go = _q('#rd-go');
    if (go) go.addEventListener('click', _reserve);
  }

  function _syncDays() {
    var root = _root(); if (!root) return;
    var chips = root.querySelectorAll('.rd-chip[data-d]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('on', Number(chips[i].getAttribute('data-d')) === DESK.days);
    }
  }

  /* ── unit lookup: the holder is shown inline, so the group gets an answer
        without leaving this screen ──────────────────────────────────────── */
  function _lookup(raw) {
    var hit = _q('#rd-hit'), go = _q('#rd-go');
    var key = String(raw || '').trim().toUpperCase();
    DESK.sel = null;
    if (!hit) return;
    if (!key) { hit.innerHTML = ''; if (go) go.disabled = true; return; }

    var hits = DESK.idx[key] || [];
    if (!hits.length) {
      // forgive a missing separator: "LG12" finds "LG-12"
      var loose = key.replace(/[^A-Z0-9]/g, '');
      var keys = Object.keys(DESK.idx);
      for (var i = 0; i < keys.length && hits.length < 3; i++) {
        if (keys[i].replace(/[^A-Z0-9]/g, '') === loose) hits = hits.concat(DESK.idx[keys[i]]);
      }
    }

    if (!hits.length) {
      hit.className = 'rd-hit no';
      hit.innerHTML = 'No unit <b>' + esc(key) + '</b> in this project.';
      if (go) go.disabled = true;
      return;
    }

    /* More than one unit answers to that number. Booking the wrong tower's flat
       is not recoverable by looking at the screen afterwards, so this refuses
       and says so instead of picking one. */
    if (hits.length > 1) {
      hit.className = 'rd-hit no';
      hit.innerHTML = '<b>' + esc(key) + '</b> matches ' + hits.length +
        ' units — the desk will not guess.<div class="rd-meta">Pick the project first: ' +
        esc(hits.map(function (x) { return x.f; }).join(', ')) + '</div>';
      if (go) go.disabled = true;
      return;
    }

    var u = hits[0];

    var meta = esc(u.f) + (Number(u.a) ? ' · ' + Number(u.a).toLocaleString('en-US') + ' ' + esc(u.u || 'sqft') : '') +
               (u.p != null ? ' · ' + pkrFull(u.p) : '');

    if (u.s === 'available') {
      DESK.sel = u;
      hit.className = 'rd-hit ok';
      hit.innerHTML = '<b>' + esc(u.n) + '</b> — Available<div class="rd-meta">' + meta + '</div>';
      if (go) go.disabled = false;
      return;
    }

    if (go) go.disabled = true;
    if (u.s === 'reserved' && u.h) {
      hit.className = 'rd-hit warn';
      hit.innerHTML = '<b>' + esc(u.n) + '</b> — Reserved' +
        '<div class="rd-meta">by <b style="font-size:inherit">' + esc(u.h.by || '—') + '</b>' +
        (u.h.code ? ' (' + esc(u.h.code) + ')' : '') +
        (u.h.exp ? ' · ' + esc(_left(u.h.exp)) + ', to ' + esc(_pkDate(u.h.exp)) : '') +
        (u.h.booked ? '<br>booked by ' + esc(u.h.booked) : '') + '</div>' +
        '<div class="rd-meta">' + meta + '</div>';
      return;
    }
    hit.className = 'rd-hit no';
    hit.innerHTML = '<b>' + esc(u.n) + '</b> — ' + esc(u.sn || u.s) +
      '<div class="rd-meta">' + meta + '</div>';
  }

  /* ── requester: resolved against the picker, free text only as a fallback ─ */
  /* Returns the requester, or an 'ambiguous' marker, or free text. It NEVER
     picks one of several matches on its own: two people who look identical in
     the box are exactly the case where guessing corrupts attribution silently,
     which is the whole reason the index moved off the label. */
  function _resolveReq() {
    var el = _q('#rd-req'); if (!el) return null;
    var raw = String(el.value || '').trim();
    if (!raw) return null;
    var lo = raw.toLowerCase();

    var exact = DESK.reqByLabel[lo];
    if (exact && exact.length === 1) return exact[0];
    if (exact && exact.length > 1) return { kind: 'ambiguous', matches: exact, name: raw };

    // a unique prefix is as good as an exact pick, and much faster to type
    var keys = Object.keys(DESK.reqByLabel), hits = [];
    for (var i = 0; i < keys.length && hits.length < 3; i++) {
      if (keys[i].indexOf(lo) === 0) hits = hits.concat(DESK.reqByLabel[keys[i]]);
    }
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return { kind: 'ambiguous', matches: hits, name: raw };

    return { kind: 'free', id: null, name: raw, _label: raw };
  }

  function _reqEcho() {
    var out = _q('#rd-reqhit'); if (!out) return;
    var r = _resolveReq();
    if (!r) { out.textContent = ''; return; }
    // On a colliding name the confirmation line carries the phone too. This is
    // the last thing read before Enter, so it must name the person the same way
    // the picker did, not just the one they share a name with.
    if (r.kind === 'ambiguous') {
      out.innerHTML = '<span style="color:var(--fk-danger)">' + r.matches.length +
        ' people match that — pick one from the list:</span> ' +
        esc(r.matches.map(function (m) { return m._label; }).join('  |  '));
      return;
    }
    var ph = (r._collides && r.phone) ? ' · <b>' + esc(_phoneDisp(r.phone)) + '</b>' : '';
    if (r.kind === 'agent') out.innerHTML = 'Agent · <b>' + esc(r.code || '') + '</b> ' + esc(r.name) + ph;
    else if (r.kind === 'user') out.innerHTML = 'Portal member · ' + esc(r.name) + ph;
    else out.innerHTML = '<span style="color:var(--fk-warning)">New name — recorded as typed</span>';
  }

  /* ── the booking ───────────────────────────────────────────────────────── */
  async function _reserve() {
    if (DESK.busy) return;
    var u = DESK.sel;
    if (!u) { toast('Pick a unit that is available.', 'warn'); var ue = _q('#rd-unit'); if (ue) ue.focus(); return; }
    var r = _resolveReq();
    if (!r) { toast('Record who asked for this unit.', 'warn'); var re = _q('#rd-req'); if (re) re.focus(); return; }
    /* Refuse rather than guess. Picking one of several identical-looking people
       would write an agent id nobody chose, and dealer reporting would carry it
       silently for the life of the reservation. */
    if (r.kind === 'ambiguous') {
      toast(r.matches.length + ' people match that name — pick the exact one from the list.', 'err');
      var ra = _q('#rd-req'); if (ra) ra.focus();
      return;
    }

    var go = _q('#rd-go');
    DESK.busy = true; if (go) { go.disabled = true; go.textContent = 'Reserving…'; }

    var tamt = Number(String((_q('#rd-tamt') || {}).value || '').replace(/[^0-9.]/g, '')) || 0;
    var args = {
      p_session_token: TOKEN,
      p_unit_id: u.id,
      p_requested_by_agent_id: r.kind === 'agent' ? r.id : null,
      p_requested_by_sales_user_id: r.kind === 'user' ? r.id : null,
      p_requested_by_name: r.name,
      p_client_name: String((_q('#rd-cname') || {}).value || '').trim() || null,
      p_client_phone: String((_q('#rd-cphone') || {}).value || '').trim() || null,
      p_expiry_days: DESK.days,
      p_token_received: tamt > 0,
      p_token_amount: tamt,
      p_note: String((_q('#rd-note') || {}).value || '').trim() || null
    };

    var res;
    try { res = await sb.rpc('reserve_unit_desk', args); }
    catch (e) { res = null; }
    DESK.busy = false;
    if (go) { go.textContent = 'Reserve'; }

    var d = res && res.data;
    if (d && d.error === 'session_expired') return sessionGone();
    /* The booking is already committed or refused server-side by this point.
       If the operator has left the desk meanwhile, record the outcome in the
       cache and say so, but do not repaint a screen that is no longer here. */
    if (!_alive('desk')) {
      if (d && d.success) { _patchAfterBooking(d, r, u); toast((d.unit_no || u.n) + ' reserved.', 'ok'); }
      return;
    }

    if (!d || !d.success) {
      var msg = (d && (d.message || d.error)) || 'Could not reserve. Please try again.';
      toast(msg, 'err');
      // the cache disagreed with the database — the database is right
      if (d && (d.error === 'unit_unavailable' || d.error === 'already_reserved')) {
        await _load(DESK.projectId, true);
        if (!_alive('desk')) return;
        _paint(document.getElementById('app-body'));
      } else if (go) { go.disabled = false; }
      return;
    }

    _patchAfterBooking(d, r, u, args.p_client_name);
    toast(esc(d.unit_no || u.n) + ' reserved for ' + d.requested_by + ' · ' + d.expiry_days + 'd', 'ok');
    _clearLine();
    _paintToday();
  }

  /* Fold a successful booking into the cache. Deliberately separate from the
     painting: the row has to be recorded even when the operator has already
     navigated away, or the next visit to the desk would show a unit as free
     that this session just booked. */
  function _patchAfterBooking(d, r, u, clientName) {
    u.s = 'reserved';
    u.h = { by: d.requested_by, code: r.kind === 'agent' ? r.code : null,
            booked: (ME && ME.sales_user_name) || null, exp: d.expiry_date };
    DESK.data.today = DESK.data.today || [];
    DESK.data.today.unshift({
      id: d.reservation_id, unit_id: u.id, unit_no: d.unit_no || u.n,
      floor: u.f, by: d.requested_by, client_name: clientName || null,
      status: 'active', expiry_date: d.expiry_date, created_at: new Date().toISOString()
    });
  }

  function _clearLine() {
    var ids = ['#rd-unit', '#rd-cname', '#rd-cphone', '#rd-tamt', '#rd-note'];
    for (var i = 0; i < ids.length; i++) { var el = _q(ids[i]); if (el) el.value = ''; }
    DESK.sel = null;
    var hit = _q('#rd-hit'); if (hit) { hit.className = ''; hit.innerHTML = ''; }
    var go = _q('#rd-go'); if (go) go.disabled = true;
    // the requester is deliberately LEFT IN PLACE: a rep usually asks for
    // several units in a row, and retyping the same name each time is the thing
    // this screen exists to avoid.
    var u = _q('#rd-unit'); if (u) { try { u.focus(); } catch (e) {} }
  }

  function _paintToday() {
    var box = _q('#rd-today'); if (!box) return;
    var rows = (DESK.data && DESK.data.today) || [];
    var cnt = _q('#rd-count'); if (cnt) cnt.textContent = String(rows.length);
    if (!rows.length) {
      box.innerHTML = '<div class="card"><div class="rd-empty">Nothing booked yet today.</div></div>';
      return;
    }
    box.innerHTML = rows.map(function (r) {
      var live = r.status === 'active';
      return '<div class="rd-row" data-id="' + esc(r.id) + '">' +
        '<span class="u">' + esc(r.unit_no) + '</span>' +
        '<span class="w">' + esc(r.by || '—') +
          (r.client_name ? ' · ' + esc(r.client_name) : '') + '</span>' +
        '<span class="t">' + esc(_pkTime(r.created_at)) + '</span>' +
        (live
          ? '<button class="rd-undo" data-undo="' + esc(r.id) + '">Undo</button>'
          : '<span class="t">' + esc(r.status) + '</span>') +
      '</div>';
    }).join('');

    /* Bound ONCE per rendered list, not once per repaint. _paintToday runs after
       every booking and every undo; adding the handler here unconditionally
       would stack a new listener each time, and by the fifth booking one Undo
       click would fire five cancels. The flag lives on the node, so a fresh
       _paint (which builds a new node) gets a fresh binding. */
    if (!box.__undoBound) { box.addEventListener('click', _undoClick); box.__undoBound = true; }
  }

  async function _undoClick(e) {
    var b = e.target.closest('button[data-undo]'); if (!b) return;
    var id = b.getAttribute('data-undo');
    b.disabled = true; b.textContent = '…';
    var res;
    try { res = await sb.rpc('cancel_reservation', { p_session_token: TOKEN, p_reservation_id: id }); }
    catch (err) { res = null; }
    var d = res && res.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) {
      b.disabled = false; b.textContent = 'Undo';
      toast((d && (d.message || d.error)) || 'Could not undo.', 'err');
      return;
    }
    var rows = (DESK.data && DESK.data.today) || [], i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].id === id) {
        rows[i].status = 'cancelled';
        // find the unit by its ID, not by its number — a number can answer for
        // more than one unit, and freeing the wrong tile would show a booked
        // flat as available
        var all = DESK.idx[String(rows[i].unit_no || '').toUpperCase()] || [];
        for (var k = 0; k < all.length; k++) {
          if (all[k].id === rows[i].unit_id) { all[k].s = 'available'; all[k].h = null; break; }
        }
        break;
      }
    }
    toast('Released — the unit is Available again.', 'ok');
    _paintToday();
  }

  /* ══ DAYBOOK ═════════════════════════════════════════════════════════════ */
  var DB = { data: null, date: null };

  window.renderDaybook = async function () {
    var host = document.getElementById('app-body');
    if (!host) return;
    if (!_mayUse()) {
      host.innerHTML = '<div class="rd"><div class="card"><div class="rd-empty">' +
        'This report is not part of your role.</div></div></div>';
      return;
    }
    host.innerHTML = _skel();
    var day = DB.date || null;
    var r;
    try {
      r = await sb.rpc('get_reservation_daybook',
        { p_session_token: TOKEN, p_date: day, p_project_id: DESK.projectId || null });
    } catch (e) { return _netErr(); }
    var d = r && r.data;
    if (!_alive('daybook')) return;                    // shell moved on mid-load
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) return _netErr();
    DB.data = d; DB.date = d.date;
    _dbPaint(host);
  };

  function _dbPaint(host) {
    var d = DB.data, h = d.header || {};
    var resv = d.reserved || [], sold = d.sold || [], exp = d.expiring || [], av = d.available || [];
    var totAvail = av.reduce(function (s, f) { return s + Number(f.available || 0); }, 0);

    host.innerHTML =
      '<div class="rd" id="db-root">' +
        '<div class="rd-top">' +
          '<input class="rd-sm" type="date" id="db-date" value="' + esc(String(d.date).slice(0, 10)) + '" style="flex:0 0 auto;width:auto">' +
          '<button class="rd-chip" id="db-back">' + li('x', 14) + ' Desk</button>' +
        '</div>' +
        '<div class="db-acts">' +
          '<button class="rd-chip" id="db-copy">' + li('copy', 15) + ' Copy for WhatsApp</button>' +
          '<button class="rd-chip" id="db-wa">' + li('send', 15) + ' WhatsApp</button>' +
          '<button class="rd-chip" id="db-pdf">' + li('fileText', 15) + ' PDF</button>' +
        '</div>' +

        _dbSec('Reserved today', resv.length, resv.length
          ? _dbTable(['Unit', 'Floor', 'Requested by', 'Buyer', 'Expires'],
              resv.map(function (r) {
                return ['<b>' + esc(r.unit_no) + '</b>', esc(r.floor),
                        esc(r.requested_by) + (r.agent_code ? ' <span class="t">(' + esc(r.agent_code) + ')</span>' : ''),
                        r.client_name ? esc(r.client_name) : '<span class="t">—</span>',
                        esc(_pkDate(r.expiry_date))];
              }))
          : '<div class="rd-empty">Nothing reserved on this day.</div>') +

        _dbSec('Sold today', sold.length, sold.length
          ? _dbTable(['Unit', 'Floor', 'Sale', 'Buyer', 'Agent'],
              sold.map(function (s) {
                return ['<b>' + esc(s.unit_no) + '</b>', esc(s.floor), esc(s.sale_number || '—'),
                        esc(s.client_name || '—'), esc(s.agent || '—')];
              }))
          : '<div class="rd-empty">Nothing sold on this day.</div>') +

        _dbSec('Expiring within 48 hours', exp.length, exp.length
          ? _dbTable(['Unit', 'Floor', 'Requested by', 'Hours left'],
              exp.map(function (r) {
                return ['<b>' + esc(r.unit_no) + '</b>', esc(r.floor), esc(r.requested_by),
                        '<span class="n">' + esc(String(r.hours_left)) + '</span>'];
              }))
          : '<div class="rd-empty">Nothing expiring in the next two days.</div>') +

        _dbSec('Available by floor', totAvail,
          _dbTable(['Floor', 'Available', 'Reserved', 'Sold', 'Total'],
            av.map(function (f) {
              return [esc(f.floor),
                      '<span class="n"><b>' + esc(String(f.available)) + '</b></span>',
                      '<span class="n">' + esc(String(f.reserved)) + '</span>',
                      '<span class="n">' + esc(String(f.sold)) + '</span>',
                      '<span class="n">' + esc(String(f.total)) + '</span>'];
            }))) +
      '</div>';

    var back = _dbq('#db-back'); if (back) back.addEventListener('click', function () { setTab('desk'); });
    var dt = _dbq('#db-date');
    if (dt) dt.addEventListener('change', function () { DB.date = dt.value; window.renderDaybook(); });
    var cp = _dbq('#db-copy'); if (cp) cp.addEventListener('click', _dbCopy);
    var wa = _dbq('#db-wa'); if (wa) wa.addEventListener('click', _dbWa);
    var pf = _dbq('#db-pdf'); if (pf) pf.addEventListener('click', _dbPrint);
  }

  function _dbSec(title, count, inner) {
    return '<div class="db-sec"><div class="db-t">' + esc(title) +
      ' <span class="c">' + esc(String(count)) + '</span></div>' +
      '<div class="db-wrap">' + inner + '</div></div>';
  }
  function _dbTable(head, rows) {
    return '<table class="db-tbl"><thead><tr>' +
      head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  /* ── WhatsApp text. Clipboard is the primary path: a floor-wise list of a
        1,467-unit tower does not survive a wa.me URL, and a link that silently
        truncates is worse than a button that says "copied". ───────────────── */
  function _dbText() {
    var d = DB.data || {}, h = d.header || {};
    var L = [];
    L.push('*' + (h.project || 'Inventory') + '* — ' + _pkDate(d.date));
    if (h.company) L.push(h.company);
    L.push('');

    var resv = d.reserved || [];
    L.push('*Reserved today (' + resv.length + ')*');
    if (!resv.length) L.push('— none —');
    else resv.forEach(function (r) {
      L.push('• ' + r.unit_no + ' (' + r.floor + ') — ' + r.requested_by +
             ' · till ' + _pkDate(r.expiry_date));
    });
    L.push('');

    var sold = d.sold || [];
    L.push('*Sold today (' + sold.length + ')*');
    if (!sold.length) L.push('— none —');
    else sold.forEach(function (s) {
      L.push('• ' + s.unit_no + ' (' + s.floor + ')' + (s.agent ? ' — ' + s.agent : ''));
    });
    L.push('');

    var exp = d.expiring || [];
    if (exp.length) {
      L.push('*Expiring in 48h (' + exp.length + ')*');
      exp.forEach(function (r) {
        L.push('• ' + r.unit_no + ' — ' + r.requested_by + ' · ' + r.hours_left + 'h left');
      });
      L.push('');
    }

    L.push('*Available by floor*');
    var tot = 0;
    (d.available || []).forEach(function (f) {
      tot += Number(f.available || 0);
      L.push('• ' + f.floor + ': ' + f.available + ' of ' + f.total);
    });
    L.push('*Total available: ' + tot + '*');
    return L.join('\n');
  }

  function _dbCopy() {
    _portalCopy(_dbText(), 'Daybook copied — paste it into the group.');
  }

  var WA_MAX = 1200;   // beyond this a wa.me URL is unreliable across phones
  function _dbWa() {
    var t = _dbText();
    if (t.length > WA_MAX) {
      _portalCopy(t, 'Too long to send as a link — copied instead. Paste it into the group.');
      return;
    }
    try { window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank'); }
    catch (e) { _portalCopy(t, 'Copied — paste it into the group.'); }
  }

  /* ── PDF via print-CSS. No library: the browser's own print dialogue saves a
        PDF, and that is the route every other report in the group uses. ───── */
  function _dbPrint() {
    var d = DB.data || {}, h = d.header || {};
    var host = document.getElementById('rd-print');
    if (!host) { host = document.createElement('div'); host.id = 'rd-print'; document.body.appendChild(host); }

    function tbl(head, rows, none) {
      if (!rows.length) return '<div class="none">' + esc(none) + '</div>';
      return '<table><thead><tr>' + head.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + rows.map(function (r) {
          return '<tr>' + r.map(function (c) { return '<td' + (c && c.n ? ' class="n"' : '') + '>' +
            esc(c && c.v !== undefined ? c.v : c) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
    }

    var tot = 0; (d.available || []).forEach(function (f) { tot += Number(f.available || 0); });

    host.innerHTML =
      '<div class="ph">' +
        (h.logo_url ? '<img src="' + esc(h.logo_url) + '" alt="">' : '') +
        '<div><h1>' + esc(h.project || 'Inventory') + ' — Reservation Daybook</h1>' +
        '<div class="s">' + esc(h.company || '') + ' · ' + esc(_pkDate(d.date)) +
        ' · printed ' + esc(_pkDate(new Date().toISOString())) + '</div></div>' +
      '</div>' +

      '<h2>Reserved today (' + (d.reserved || []).length + ')</h2>' +
      tbl(['Unit', 'Floor', 'Requested by', 'Buyer', 'Booked by', 'Expires'],
        (d.reserved || []).map(function (r) {
          return [r.unit_no, r.floor,
                  r.requested_by + (r.agent_code ? ' (' + r.agent_code + ')' : ''),
                  r.client_name || '—', r.booked_by || '—', _pkDate(r.expiry_date)];
        }), 'Nothing reserved on this day.') +

      '<h2>Sold today (' + (d.sold || []).length + ')</h2>' +
      tbl(['Unit', 'Floor', 'Sale', 'Buyer', 'Agent'],
        (d.sold || []).map(function (s) {
          return [s.unit_no, s.floor, s.sale_number || '—', s.client_name || '—', s.agent || '—'];
        }), 'Nothing sold on this day.') +

      '<h2>Expiring within 48 hours (' + (d.expiring || []).length + ')</h2>' +
      tbl(['Unit', 'Floor', 'Requested by', 'Hours left'],
        (d.expiring || []).map(function (r) {
          return [r.unit_no, r.floor, r.requested_by, { v: r.hours_left, n: 1 }];
        }), 'Nothing expiring in the next two days.') +

      '<h2>Available by floor — ' + tot + ' available</h2>' +
      tbl(['Floor', 'Available', 'Reserved', 'Sold', 'Total'],
        (d.available || []).map(function (f) {
          return [f.floor, { v: f.available, n: 1 }, { v: f.reserved, n: 1 },
                  { v: f.sold, n: 1 }, { v: f.total, n: 1 }];
        }), 'No inventory.') +

      '<div class="sig"><div>Prepared by</div><div>Checked by</div><div>Approved by</div></div>';

    document.body.classList.add('rd-printing');
    var clean = function () { document.body.classList.remove('rd-printing'); };
    try { window.addEventListener('afterprint', clean, { once: true }); } catch (e) {}
    setTimeout(function () { try { window.print(); } catch (e) {} setTimeout(clean, 1500); }, 60);
  }
})();
