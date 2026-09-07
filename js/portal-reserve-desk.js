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
      /* ══ PRINT — a board report ═══════════════════════════════════════════
         Rebuilt, not tweaked. The previous sheet was a restrained typographic
         register and read as thin on a boardroom table; this one carries weight:
         a full-bleed masthead, large numerals, numbered sections, and position
         shown as bars rather than only as digits.

         Still paginated in JS (see _dbBuild). Chrome supports neither @page
         margin boxes nor counter(pages), so "Page 2 of 3", a running header that
         starts on page 2, a repeating thead and an unsplittable signature block
         are unreachable from CSS alone. Every page is a real 210×297mm box with
         NO padding of its own, which is what lets the masthead bleed to the
         edge; the content column supplies the 14mm side margins instead.

         PRINT COLOUR. This design is carried by its backgrounds — navy band,
         tinted cards, coloured bars. print-color-adjust:exact is set on html,
         body AND every page, which is what keeps them when Chrome's "Background
         graphics" box is unchecked. Verified against a real printBackground:false
         render, not assumed.

         FONT. Inter is not in this repo and a CDN font fails at print time, so
         the stack is Segoe UI / system-ui — the sanctioned fallback. Weight, not
         family, carries the hierarchy.                                        */
      "#rd-print{display:none}" +
      "@page{size:A4 portrait;margin:0}" +
      "@media print{" +
        "html,body{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}" +
        "body.rd-printing #screen-app,body.rd-printing #btabs,body.rd-printing #modal-host," +
        "body.rd-printing #toastbar,body.rd-printing #loc-bar,body.rd-printing #pwa-bar," +
        "body.rd-printing #verify-gate{display:none !important}" +
        "body.rd-printing #rd-print{display:block !important}" +
      "}" +
      "#rd-print{--navy:#0B2545;--navy2:#13315C;--ink:#111827;--slate:#64748B;" +
        "--line:#D6DBE3;--tint:#F3F5F9;--amber:#D97706;--red:#B42318;--avail:#E2E8F0;" +
        "--sans:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif}" +
      "#rd-print .rd-pg{width:210mm;height:297mm;padding:0;box-sizing:border-box;position:relative;" +
        "background:#FFF;color:var(--ink);font-family:var(--sans);font-size:10pt;line-height:1.45;" +
        "font-variant-numeric:tabular-nums;overflow:hidden;" +
        "-webkit-print-color-adjust:exact;print-color-adjust:exact;" +
        "page-break-after:always;break-after:page}" +
      "#rd-print .rd-pg:last-child{page-break-after:auto;break-after:auto}" +
      /* flow-root, not a plain block. The first child carries a 14mm top margin and a
   plain block lets that margin COLLAPSE out of the parent, so scrollHeight came
   back 14mm short and the paginator believed a page had room it did not — the
   last block ran 5mm into the footer rule. A block formatting context makes the
   measurement honest. */
      "#rd-print .col{padding:0 14mm;display:flow-root}" +
      /* ── masthead, page 1, full bleed ── */
      "#rd-print .mh{height:42mm;padding:6mm 14mm 4mm;box-sizing:border-box;position:relative;" +
        "background:linear-gradient(90deg,var(--navy) 0%,var(--navy2) 100%);color:#FFF;display:flex;" +
        "justify-content:space-between;align-items:flex-start}" +
      "#rd-print .mh-amber{position:absolute;left:0;right:0;bottom:0;height:3pt;background:var(--amber)}" +
      "#rd-print .mh-logo{height:14mm;width:auto;display:block;margin-bottom:2mm}" +
      "#rd-print .mh-name{font-size:12pt;font-weight:700;color:#FFF;padding-bottom:1.5mm;" +
        "border-bottom:.5pt solid rgba(255,255,255,.9);display:inline-block;margin-bottom:2mm}" +
      "#rd-print .mh-proj{font-size:11pt;font-weight:600;letter-spacing:.14em;color:rgba(255,255,255,.8);line-height:1.2}" +
      "#rd-print .mh-t{font-size:28pt;font-weight:700;letter-spacing:-.01em;line-height:1.05;margin:.5mm 0 1mm}" +
      "#rd-print .mh-d{font-size:11pt;font-weight:400;color:rgba(255,255,255,.8);line-height:1.2}" +
      "#rd-print .mh-r{text-align:right;font-size:9pt;color:rgba(255,255,255,.8);line-height:1.5}" +
      /* ── running header, pages 2+ ── */
      "#rd-print .rh{height:10mm;padding:0 14mm;box-sizing:border-box;background:#FFF;" +
        "border-bottom:.5pt solid var(--line);display:flex;align-items:center;" +
        "justify-content:space-between;margin-bottom:6mm}" +
      "#rd-print .rh .l{font-size:8pt;color:var(--slate)}" +
      "#rd-print .rh .r{font-size:8pt;font-weight:600;color:var(--navy);display:flex;align-items:center;gap:2mm}" +
      "#rd-print .rh .sq{width:3mm;height:3mm;background:var(--navy);display:inline-block}" +
      /* ── band labels ── */
      "#rd-print .lbl{font-size:8pt;font-weight:600;color:var(--slate);text-transform:uppercase;" +
        "letter-spacing:.12em;margin-bottom:4mm}" +
      /* ── KPI cards ── */
      "#rd-print .kpis{display:flex;gap:6mm}" +
      "#rd-print .kpi{flex:1;background:var(--tint);padding:10mm 6mm;box-sizing:border-box;border-radius:2px}" +
      "#rd-print .kpi.sec{background:#FFF;border:.5pt solid var(--line);padding:8mm 6mm}" +
      "#rd-print .kpi .k{font-size:8pt;font-weight:600;color:var(--slate);text-transform:uppercase;" +
        "letter-spacing:.12em}" +
      "#rd-print .kpi .v{font-size:32pt;font-weight:700;color:var(--navy);line-height:1.1;margin-top:2mm}" +
      "#rd-print .kpi.sec .v{font-size:24pt;color:var(--ink)}" +
      "#rd-print .kpi .s{font-size:9pt;font-weight:400;color:var(--slate);margin-top:1mm}" +
      "#rd-print .kpi .v.red{color:var(--red)}" +
      /* ── stacked bars ── */
      "#rd-print .bar{display:flex;height:8mm;width:100%;margin-top:6mm;background:var(--avail);border-radius:2px;overflow:hidden}" +
      "#rd-print .bar i{display:block;height:100%}" +
      "#rd-print .bar i.sold{background:var(--navy)}" +
      "#rd-print .bar i.res{background:var(--amber)}" +
      "#rd-print .bar i.av{background:var(--avail)}" +
      "#rd-print .lg{display:flex;gap:8mm;margin-top:3mm;font-size:8pt;color:var(--slate)}" +
      "#rd-print .lg span{display:flex;align-items:center;gap:2mm}" +
      "#rd-print .lg i{width:3mm;height:3mm;display:inline-block}" +
      "#rd-print .mini{display:flex;height:4mm;width:45mm;background:var(--avail);border-radius:1px;overflow:hidden}" +
      "#rd-print .mini i{display:block;height:100%}" +
      /* ── sections ── */
      "#rd-print .sec-h{display:flex;align-items:baseline;gap:4mm;border-bottom:1pt solid var(--navy);" +
        "padding-bottom:3mm;margin-bottom:6mm}" +
      "#rd-print .sec-n{font-size:20pt;font-weight:700;color:rgba(11,37,69,.25);line-height:1}" +
      "#rd-print .sec-t{font-size:14pt;font-weight:700;color:var(--ink);flex:1}" +
      "#rd-print .pill{font-size:8pt;font-weight:600;padding:1mm 3mm;border-radius:2px;white-space:nowrap}" +
      "#rd-print .pill.count{background:var(--tint);color:var(--slate)}" +
      "#rd-print .pill.amber{background:#FDF3E7;color:var(--amber)}" +
      "#rd-print .pill.red{background:#FBEAE8;color:var(--red)}" +
      /* ── tables ── */
      "#rd-print table{width:100%;border-collapse:collapse;font-size:10pt}" +
      "#rd-print thead{display:table-header-group}" +
      "#rd-print tr{page-break-inside:avoid;break-inside:avoid}" +
      "#rd-print th{font-size:8pt;font-weight:600;color:var(--slate);text-transform:uppercase;" +
        "letter-spacing:.10em;text-align:left;background:var(--tint);padding:3mm 2mm;" +
        "white-space:nowrap;border-bottom:.5pt solid var(--line)}" +
      "#rd-print td{padding:0 2mm;height:9mm;vertical-align:middle;color:var(--ink);white-space:nowrap}" +
      "#rd-print td.wrap{white-space:normal}" +
      "#rd-print tbody tr:nth-child(even) td{background:var(--tint)}" +
      "#rd-print tbody tr:last-child td{border-bottom:.5pt solid var(--line)}" +
      "#rd-print th.n,#rd-print td.n{text-align:right}" +
      "#rd-print td.u{font-weight:600}" +
      "#rd-print td.mut{color:var(--slate)}" +
      "#rd-print td.code{font-size:9pt;color:var(--slate)}" +
      "#rd-print tr.tot td{border-top:1pt solid var(--navy);font-weight:700;background:var(--tint)}" +
      /* ── empty state ── */
      "#rd-print .empty{height:18mm;background:var(--tint);display:flex;align-items:center;" +
        "justify-content:center;font-size:10pt;color:var(--slate);border-radius:2px}" +
      /* ── signatures ── */
      "#rd-print .sig{display:flex;gap:30mm;margin-top:16mm}" +
      "#rd-print .sig div{width:70mm}" +
      "#rd-print .sig .rule{border-top:.5pt solid var(--ink);margin-bottom:2mm}" +
      "#rd-print .sig .l{font-size:8pt;font-weight:600;color:var(--slate);text-transform:uppercase;" +
        "letter-spacing:.10em}" +
      /* ── footer ── */
      "#rd-print .ft{position:absolute;left:14mm;right:14mm;bottom:9mm;border-top:1pt solid var(--navy);" +
        "padding-top:2.5mm;display:flex;justify-content:space-between;font-size:7.5pt;color:var(--slate)}" +
      "#rd-print .ft .c{font-weight:600;letter-spacing:.06em}" +
      /* on screen the pages sit on a grey field so they read as sheets */
      "@media screen{body.rd-printing #screen-app,body.rd-printing #btabs," +
        "body.rd-printing #modal-host,body.rd-printing #toastbar,body.rd-printing #loc-bar," +
        "body.rd-printing #pwa-bar,body.rd-printing #verify-gate{display:none !important}" +
        "#rd-print.preview{display:block;background:#8a8a8a;padding:10mm 0}" +
        "#rd-print.preview .rd-pg{margin:0 auto 10mm;box-shadow:0 1px 4px rgba(0,0,0,.4)}}";
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

    /* THE DAYBOOK IS ONE PROJECT'S BOOK, like the desk it belongs to.
       This used to pass DESK.projectId || null, and null means "the whole
       dealer group" to get_reservation_daybook — so opening the Daybook without
       opening the desk first produced a report that mixed three towers: floors
       called MF and Mezzanine next to Awami's, an Available figure of 1,799,
       and reservations from another tenant listed as today's. It read as an
       Awami document and was not one. Warming the desk index resolves the
       project the same way the desk does, and the call is cached, so arriving
       here from the desk costs nothing. */
    if (!DESK.projectId) {
      var w = await _load(null, false);
      if (w === 'expired') return sessionGone();
      if (w === true && DESK.data) {
        DESK.projectId = DESK.data.scope_project_id ||
                         (DESK.data.projects && DESK.data.projects[0] && DESK.data.projects[0].id) || null;
      }
      if (!_alive('daybook')) return;
    }

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

  /* ══ THE DAYBOOK AS A BOARD REPORT ═══════════════════════════════════════
     Paginated here rather than by the browser: Chrome supports neither @page
     margin boxes nor counter(pages), so "Page 2 of 3", a running header that
     begins on page 2, a thead that repeats after a break and a signature block
     that cannot be split are all unreachable from CSS alone.

     A page carries NO padding of its own — that is what lets the masthead bleed
     to the paper edge — so the content column supplies the 14mm side margins and
     the usable height is worked out per page from what the band above it took.

     Content is unchanged. Every figure still comes from get_reservation_daybook;
     the four KPI totals are summed from the floor table on the client, which is
     why no RPC moved.                                                        */

  var PG = { W: 210, H: 297 };                  // mm
  var BAND = { mast: 42, run: 16, foot: 20 };   // mm consumed above / below the column

  function _mm() {
    var p = document.createElement('div');
    p.style.cssText = 'position:absolute;visibility:hidden;width:100mm';
    document.body.appendChild(p);
    var px = p.getBoundingClientRect().width / 100;
    document.body.removeChild(p);
    return px || 3.7795;
  }
  function _printHost() {
    var host = document.getElementById('rd-print');
    if (!host) { host = document.createElement('div'); host.id = 'rd-print'; document.body.appendChild(host); }
    return host;
  }
  function _el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function _num(n) { return Number(n || 0).toLocaleString('en-US'); }
  function _pct(n, d) { return d ? (Math.round(n / d * 1000) / 10).toFixed(1) + '%' : '0.0%'; }

  var _MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var _DAY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  /* A Date shifted into Pakistan time, or null. A board report must not fail to
     render because one row is missing a date — it prints an em dash and the rest
     of the page still arrives. */
  function _pk(iso) {
    if (iso == null || iso === '') return null;
    var d;
    try { d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Karachi' })); }
    catch (e) { d = new Date(iso); }
    return isNaN(d.getTime()) ? null : d;
  }
  function _dLong(iso) { var d = _pk(iso); if (!d) return '—';   // Monday, 07 September 2026
    return _DAY[d.getDay()] + ', ' + String(d.getDate()).padStart(2, '0') + ' ' +
           _MON[d.getMonth()] + ' ' + d.getFullYear(); }
  function _dShort(iso) { var d = _pk(iso); if (!d) return '—';  // 07 Sep 2026
    return String(d.getDate()).padStart(2, '0') + ' ' + _MON[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear(); }
  function _dCaps(iso) { return _dShort(iso).toUpperCase(); }
  function _dRef(iso) { var d = _pk(iso) || new Date();   // 20260907
    return '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }
  function _initials(s) {
    return String(s || '').trim().split(/\s+/).map(function (w) { return w.charAt(0); })
      .join('').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'RP';
  }
  /* A segment under half a percent still has to be visible, or a board reads a
     sold unit as none at all. Floor is 1.5mm, taken from the largest segment. */
  function _seg(parent, cls, value, total, widthMM) {
    if (!total || value <= 0) return;
    var pct = value / total, mm = pct * widthMM;
    if (mm < 1.5) mm = 1.5;
    var i = _el('i', cls);
    i.style.width = mm.toFixed(2) + 'mm';
    parent.appendChild(i);
  }

  function _dbBuild() {
    var d = DB.data || {}, h = d.header || {};
    var host = _printHost();
    host.className = '';
    host.innerHTML = '';
    host.style.cssText = 'display:block;position:absolute;left:-99999px;top:0;width:' + PG.W + 'mm';

    var MM = _mm();
    var COLW = PG.W - 28;                       // content column, mm
    var project = h.project || 'Project';
    var company = h.company || '';
    var dateISO = d.date;

    /* ── figures: summed from the floor table, client-side ─────────────── */
    var avail = d.available || [];
    var tSold = 0, tRes = 0, tAv = 0, tAll = 0;
    avail.forEach(function (f) {
      tSold += Number(f.sold || 0); tRes += Number(f.reserved || 0);
      tAv += Number(f.available || 0); tAll += Number(f.total || 0);
    });

    var pages = [], body = null, pageNo = 0;

    function newPage(first) {
      var pg = _el('div', 'rd-pg');
      pages.push(pg); host.appendChild(pg); pageNo++;

      if (first) {
        var mh = _el('div', 'mh');
        var L = _el('div');
        if (h.logo_url) {
          var img = document.createElement('img'); img.className = 'mh-logo'; img.src = h.logo_url; img.alt = '';
          L.appendChild(img);
        } else {
          // No logo on file. The company name, ruled, stands in for it — never a
          // single letter, which reads as a placeholder rather than a mark.
          L.appendChild(_el('div', 'mh-name', company || project));
        }
        L.appendChild(_el('div', 'mh-proj', project.toUpperCase()));
        L.appendChild(_el('div', 'mh-t', 'Reservation Daybook'));
        L.appendChild(_el('div', 'mh-d', _dLong(dateISO)));
        var R = _el('div', 'mh-r');
        [company, 'Karkhano, Peshawar',
         'Report ref: ' + _initials(project) + '-DB-' + _dRef(dateISO)]
          .filter(Boolean).forEach(function (t) { R.appendChild(_el('div', null, t)); });
        mh.appendChild(L); mh.appendChild(R);
        mh.appendChild(_el('div', 'mh-amber'));
        pg.appendChild(mh);
      } else {
        var rh = _el('div', 'rh');
        rh.appendChild(_el('div', 'l', project + '  ·  Reservation Daybook  ·  ' + _dShort(dateISO)));
        var r = _el('div', 'r');
        r.appendChild(_el('span', 'sq'));
        r.appendChild(_el('span', null, 'Fourteen Group'));
        rh.appendChild(r);
        pg.appendChild(rh);
      }

      body = _el('div', 'col');
      pg.appendChild(body);
      body.__limit = (PG.H - (first ? BAND.mast : BAND.run) - BAND.foot) * MM;
      return pg;
    }
    function fits() { return body.scrollHeight <= body.__limit; }
    function push(node) {
      body.appendChild(node);
      if (!fits() && body.childNodes.length > 1) { body.removeChild(node); newPage(false); body.appendChild(node); }
      return node;
    }

    newPage(true);

    /* ── PROJECT POSITION ──────────────────────────────────────────────── */
    var pos = _el('div');
    pos.style.marginTop = '14mm';
    pos.appendChild(_el('div', 'lbl', 'Project position · Cumulative'));
    var k1 = _el('div', 'kpis');
    [['Total units', _num(tAll), null, 'var(--navy)'],
     ['Sold', _num(tSold), _pct(tSold, tAll) + ' of inventory', 'var(--navy)'],
     ['Reserved', _num(tRes), _pct(tRes, tAll) + ' of inventory', 'var(--amber)'],
     ['Available', _num(tAv), _pct(tAv, tAll) + ' of inventory', 'var(--avail)']
    ].forEach(function (c) {
      var card = _el('div', 'kpi');
      card.style.borderTop = '4pt solid ' + c[3];
      card.appendChild(_el('div', 'k', c[0]));
      card.appendChild(_el('div', 'v', c[1]));
      if (c[2]) card.appendChild(_el('div', 's', c[2]));
      k1.appendChild(card);
    });
    pos.appendChild(k1);

    var bar = _el('div', 'bar');
    _seg(bar, 'sold', tSold, tAll, COLW);
    _seg(bar, 'res', tRes, tAll, COLW);
    pos.appendChild(bar);
    var lg = _el('div', 'lg');
    [['var(--navy)', 'Sold', tSold], ['var(--amber)', 'Reserved', tRes],
     ['var(--avail)', 'Available', tAv]].forEach(function (x) {
      var s = _el('span'); var i = _el('i'); i.style.background = x[0];
      s.appendChild(i); s.appendChild(_el('span', null, x[1] + '  ' + _num(x[2])));
      lg.appendChild(s);
    });
    pos.appendChild(lg);
    body.appendChild(pos);

    /* ── TODAY'S ACTIVITY ──────────────────────────────────────────────── */
    var nRes = (d.reserved || []).length, nSold = (d.sold || []).length, nExp = (d.expiring || []).length;
    var act = _el('div');
    act.style.marginTop = '12mm';
    act.appendChild(_el('div', 'lbl', "Today's activity · " + _dCaps(dateISO)));
    var k2 = _el('div', 'kpis');
    [['Reserved today', nRes, 'var(--amber)', false],
     ['Sold today', nSold, 'var(--navy)', false],
     ['Expiring within 48h', nExp, 'var(--red)', nExp > 0]
    ].forEach(function (c) {
      var card = _el('div', 'kpi sec');
      card.style.borderTop = '3pt solid ' + c[2];
      card.appendChild(_el('div', 'k', c[0]));
      card.appendChild(_el('div', 'v' + (c[3] ? ' red' : ''), _num(c[1])));
      k2.appendChild(card);
    });
    act.appendChild(k2);
    push(act);

    /* ── sections ──────────────────────────────────────────────────────── */
    function secHead(no, title, count, unit) {
      var hd = _el('div', 'sec-h');
      hd.appendChild(_el('div', 'sec-n', no));
      hd.appendChild(_el('div', 'sec-t', title));
      hd.appendChild(_el('div', 'pill count', _num(count) + ' ' + unit + (count === 1 ? '' : 's')));
      return hd;
    }
    function thead(cols) {
      var t = _el('thead'), tr = _el('tr');
      cols.forEach(function (c) { tr.appendChild(_el('th', c[1] === 'n' ? 'n' : null, c[0])); });
      t.appendChild(tr); return t;
    }
    function cell(spec) {                       // string | {v,cls} | {node}
      if (spec && spec.node) { var td = _el('td', spec.cls || null); td.appendChild(spec.node); return td; }
      if (spec && typeof spec === 'object') {
        var t2 = _el('td', spec.cls || null);
        if (spec.pill) { t2.appendChild(_el('span', 'pill ' + spec.pill, spec.v)); }
        else t2.textContent = spec.v;
        return t2;
      }
      return _el('td', null, spec);
    }
    function trow(cells, cls) {
      var tr = _el('tr', cls || null);
      cells.forEach(function (c) { tr.appendChild(cell(c)); });
      return tr;
    }

    var secs = [
      { no: '01', title: 'Reservations Today', unit: 'unit',
        cols: [['Unit'], ['Floor'], ['Requested by'], ['Agent code'], ['Booked by'], ['Buyer'], ['Expires'], ['Days left', 'n']],
        rows: (d.reserved || []).map(function (r) {
          var ed = _pk(r.expiry_date);
          var days = ed ? Math.max(0, Math.ceil((ed - new Date()) / 864e5)) : null;
          return [{ v: r.unit_no, cls: 'u' }, r.floor, r.requested_by,
                  { v: r.agent_code || '—', cls: 'code' }, r.booked_by || '—',
                  r.client_name ? r.client_name : { v: '—', cls: 'mut' },
                  _dShort(r.expiry_date),
                  days == null ? { v: '—', cls: 'n mut' } : { v: days + 'd', pill: 'amber', cls: 'n' }];
        }),
        empty: function () { return 'No units reserved on ' + _dLong(dateISO).split(', ')[1] + '.'; } },

      { no: '02', title: 'Sales Today', unit: 'unit',
        cols: [['Unit'], ['Floor'], ['Buyer'], ['Agent'], ['Sale ref']],
        rows: (d.sold || []).map(function (s) {
          return [{ v: s.unit_no, cls: 'u' }, s.floor, s.client_name || '—', s.agent || '—',
                  { v: s.sale_number || '—', cls: 'code' }];
        }),
        empty: function () { return 'No units sold on ' + _dLong(dateISO).split(', ')[1] + '.'; } },

      { no: '03', title: 'Expiring Within 48 Hours', unit: 'reservation',
        cols: [['Unit'], ['Floor'], ['Requested by'], ['Expires'], ['Hours left', 'n']],
        rows: (d.expiring || []).map(function (r) {
          return [{ v: r.unit_no, cls: 'u' }, r.floor, r.requested_by, _dShort(r.expiry_date),
                  { v: r.hours_left + 'h', pill: 'red', cls: 'n' }];
        }),
        empty: function () { return 'No reservations expire within 48 hours of ' + _dLong(dateISO).split(', ')[1] + '.'; } },

      { no: '04', title: 'Floor-wise Position', unit: 'floor',
        cols: [['Floor'], ['Distribution'], ['Sold', 'n'], ['Reserved', 'n'], ['Available', 'n'], ['Total', 'n'], ['% Sold', 'n']],
        rows: avail.map(function (f) {
          var t = Number(f.total || 0);
          var m = _el('div', 'mini');
          _seg(m, 'sold', Number(f.sold || 0), t, 45);
          _seg(m, 'res', Number(f.reserved || 0), t, 45);
          return [f.floor, { node: m }, { v: _num(f.sold), cls: 'n' }, { v: _num(f.reserved), cls: 'n' },
                  { v: _num(f.available), cls: 'n' }, { v: _num(t), cls: 'n' },
                  { v: _pct(Number(f.sold || 0), t), cls: 'n' }];
        }),
        total: ['Total', '', { v: _num(tSold), cls: 'n' }, { v: _num(tRes), cls: 'n' },
                { v: _num(tAv), cls: 'n' }, { v: _num(tAll), cls: 'n' }, { v: _pct(tSold, tAll), cls: 'n' }],
        empty: function () { return 'No inventory recorded for this project.'; } }
    ];

    secs.forEach(function (sec) {
      var block = _el('div');
      block.style.marginTop = '12mm';
      block.appendChild(secHead(sec.no, sec.title, sec.rows.length, sec.unit));

      if (!sec.rows.length) {
        block.appendChild(_el('div', 'empty', sec.empty()));
        push(block);
        return;
      }

      var table = _el('table');
      table.appendChild(thead(sec.cols));
      var tb = _el('tbody'); table.appendChild(tb);
      block.appendChild(table);
      push(block);

      for (var i = 0; i < sec.rows.length; i++) {
        tb.appendChild(trow(sec.rows[i]));
        if (!fits()) {
          tb.removeChild(tb.lastChild);
          if (i < 2 && body.childNodes.length > 1) {      // never strand the heading
            body.removeChild(block); newPage(false); body.appendChild(block); i--; continue;
          }
          newPage(false);
          block = _el('div');
          table = _el('table'); table.appendChild(thead(sec.cols));
          tb = _el('tbody'); table.appendChild(tb);
          block.appendChild(table);
          body.appendChild(block);
          i--;
        }
      }
      if (sec.total) {
        tb.appendChild(trow(sec.total, 'tot'));
        if (!fits()) {
          tb.removeChild(tb.lastChild);
          newPage(false);
          var t2 = _el('table'); t2.appendChild(thead(sec.cols));
          var tb2 = _el('tbody'); t2.appendChild(tb2);
          tb2.appendChild(trow(sec.total, 'tot'));
          var b2 = _el('div'); b2.appendChild(t2);
          body.appendChild(b2);
        }
      }
    });

    /* ── signatures, never split ───────────────────────────────────────── */
    var sig = _el('div', 'sig');
    [['Prepared by', 'Reservation Desk'], ['Approved by', 'Director']].forEach(function (p) {
      var c = _el('div');
      c.appendChild(_el('div', 'rule'));
      c.appendChild(_el('div', 'l', p[0] + ' — ' + p[1]));
      sig.appendChild(c);
    });
    push(sig);

    /* ── footer on every page ──────────────────────────────────────────── */
    var now = new Date().toISOString();
    var stamp = 'Generated ' + _dShort(now) + ' ' + _pkTime(now) + ' PKT · Fourteen Group RMS';
    pages.forEach(function (pg, i) {
      var ft = _el('div', 'ft');
      ft.appendChild(_el('span', null, stamp));
      ft.appendChild(_el('span', 'c', 'CONFIDENTIAL — FOR BOARD OF DIRECTORS'));
      ft.appendChild(_el('span', null, 'Page ' + (i + 1) + ' of ' + pages.length));
      pg.appendChild(ft);
    });

    host.style.cssText = '';
    return pages.length;
  }

  function _dbPrint() {
    _dbBuild();
    document.body.classList.add('rd-printing');
    var clean = function () { document.body.classList.remove('rd-printing'); };
    try { window.addEventListener('afterprint', clean, { once: true }); } catch (e) {}
    setTimeout(function () { try { window.print(); } catch (e) {} setTimeout(clean, 1500); }, 60);
  }

  /* The verification harness renders the same pages on screen. It accepts a
     payload so the harness never has to reach inside this module for DB — and
     so a padded, page-break-forcing render can be produced without writing a
     single row anywhere. */
  window._dbPreview = function (data, date) {
    if (data) { DB.data = data; DB.date = date || data.date; }
    var n = _dbBuild();
    _printHost().className = 'preview';
    document.body.classList.add('rd-printing');
    return n;
  };

})();
