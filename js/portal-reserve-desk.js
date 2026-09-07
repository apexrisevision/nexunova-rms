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
    statusId: null,      // which tag the next booking applies (id, never a name)
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
      /* One chip, three tags. Colour carries the difference in commitment, not
         the wording alone, because these are read at a glance in a list. */
      ".tg{flex:none;font-size:11px;font-weight:650;padding:2px 8px;border-radius:999px;border:1px solid transparent;white-space:nowrap}" +
      ".tg-hold{background:#FFF4E5;color:#8A5300;border-color:#F3D9B0}" +
      ".tg-reserved{background:#E9F0FB;color:#22508F;border-color:#C9DAF2}" +
      ".tg-booked{background:#E9F7EF;color:#1C6B3F;border-color:#C4E6D3}" +
      /* Only the DESK uses this. Its "Booked today" list keeps cancelled rows so
         the operator can see what they undid; the daybook drops them entirely. */
      ".tg-off{background:var(--fk-bg-soft,#F1F2F4);color:var(--fk-text-muted);border-color:var(--fk-border);text-decoration:line-through}" +
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
      ".db-asat{padding:8px 10px;font-size:11px;color:var(--fk-text-soft);border-bottom:1px solid var(--fk-border)}" +
      ".db-rng{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}" +
      ".db-rng label{font-size:var(--fs-caption);color:var(--fk-text-muted);font-weight:600}" +
      ".db-rng input{flex:0 0 auto;width:auto}" +
      ".db-tbl td .db-red{color:#B3261E;font-weight:650}" +
      ".db-tbl td .db-amber{color:#9A6510;font-weight:650}" +
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
      "#rd-print .mh{height:30mm;padding:6mm 14mm 4mm;box-sizing:border-box;position:relative;" +
        "background:linear-gradient(90deg,var(--navy) 0%,var(--navy2) 100%);color:#FFF;display:flex;" +
        "justify-content:space-between;align-items:flex-start}" +
      "#rd-print .mh-amber{position:absolute;left:0;right:0;bottom:0;height:3pt;background:var(--amber)}" +
      "#rd-print .mh-logo{height:14mm;width:auto;display:block;margin-bottom:2mm}" +
      "#rd-print .mh-name{font-size:12pt;font-weight:700;color:#FFF;padding-bottom:1.5mm;" +
        "border-bottom:.5pt solid rgba(255,255,255,.9);display:inline-block;margin-bottom:2mm}" +
      "#rd-print .mh-proj{font-size:10pt;font-weight:600;letter-spacing:.14em;color:rgba(255,255,255,.8);line-height:1.2}" +
      "#rd-print .mh-t{font-size:24pt;font-weight:700;letter-spacing:-.01em;line-height:1.05;margin:.5mm 0 1mm}" +
      "#rd-print .mh-d{font-size:10pt;font-weight:400;color:rgba(255,255,255,.8);line-height:1.2}" +
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
      /* ── stacked bars ── */
      /* ── compact summary: one block, no cards, no fills ── */
      "#rd-print .sum-l{font-size:7pt;font-weight:600;color:var(--slate);text-transform:uppercase;" +
        "letter-spacing:.12em;margin-bottom:1mm}" +
      "#rd-print .sum-r{display:flex;align-items:center;gap:5mm;flex-wrap:wrap}" +
      "#rd-print .sum-i{display:flex;align-items:baseline;gap:2mm}" +
      "#rd-print .sum-i .k{font-size:7pt;font-weight:600;color:var(--slate);text-transform:uppercase;" +
        "letter-spacing:.10em}" +
      "#rd-print .sum-i .v{font-size:13pt;font-weight:700;color:var(--ink);line-height:1.1}" +
      "#rd-print .sum-i .p{font-size:9pt;font-weight:400;color:var(--slate)}" +
      "#rd-print .sum-r .sep{width:0;height:6mm;border-left:.5pt solid var(--line)}" +
      "#rd-print .sum-pkr{font-size:8.5pt;color:var(--slate);margin-top:1mm}" +
      "#rd-print .sum-b{margin-top:4mm}" +
      /* The movement block. Deliberately a table and not more figure cards:
         opening, added, released and closing only mean anything read across. */
      "#rd-print .mv{margin-top:4mm}" +
      "#rd-print table.mv-t{width:auto;min-width:110mm}" +
      "#rd-print table.mv-t th{background:transparent;border-bottom:.5pt solid var(--line)}" +
      "#rd-print table.mv-t td{height:5mm}" +
      "#rd-print table.mv-t td:first-child{font-weight:600}" +
      "#rd-print table.mv-t tr:last-child td{border-bottom:0}" +
      "#rd-print .mv-c{font-weight:700}" +
      "#rd-print .sum-b .sum-i .v{font-size:11pt}" +
      /* ── sections ── */
      "#rd-print .sec-h{display:flex;align-items:baseline;gap:3mm;border-bottom:.5pt solid var(--navy);" +
        "padding-bottom:2mm;margin-bottom:3mm}" +
      "#rd-print .sec-n{font-size:11pt;font-weight:700;color:rgba(11,37,69,.30);line-height:1}" +
      "#rd-print .sec-t{font-size:11pt;font-weight:700;color:var(--ink);flex:1}" +
      "#rd-print .pill{font-size:7pt;font-weight:600;padding:.6mm 2mm;border-radius:2px;white-space:nowrap}" +
      "#rd-print .pill.count{background:var(--tint);color:var(--slate)}" +
      "#rd-print .pill.amber{background:#FDF3E7;color:var(--amber)}" +
      "#rd-print .pill.red{background:#FBEAE8;color:var(--red)}" +
      "#rd-print .pill.hold{background:#FFF4E5;color:#8A5300}" +
      "#rd-print .pill.reserved{background:#E9F0FB;color:#22508F}" +
      "#rd-print .pill.booked{background:#E9F7EF;color:#1C6B3F}" +
      "#rd-print .pill.off{background:var(--tint);color:var(--slate);text-decoration:line-through}" +
      /* ── tables ── */
      "#rd-print table{width:100%;border-collapse:collapse;font-size:8.5pt}" +
      "#rd-print thead{display:table-header-group}" +
      "#rd-print tr{page-break-inside:avoid;break-inside:avoid}" +
      "#rd-print th{font-size:8pt;font-weight:600;color:var(--slate);text-transform:uppercase;" +
        "letter-spacing:.10em;text-align:left;background:var(--tint);padding:2mm;font-size:7.5pt;" +
        "white-space:nowrap;border-bottom:.5pt solid var(--line)}" +
      "#rd-print td{padding:0 2mm;height:6mm;vertical-align:middle;color:var(--ink);white-space:nowrap}" +
      "#rd-print td.wrap{white-space:normal}" +
      "#rd-print tbody tr:nth-child(even) td{background:var(--tint)}" +
      "#rd-print tbody tr:last-child td{border-bottom:.5pt solid var(--line)}" +
      "#rd-print th.n,#rd-print td.n{text-align:right}" +
      "#rd-print td.u{font-weight:600}" +
      "#rd-print td.mut{color:var(--slate)}" +
      "#rd-print td.code{font-size:8pt;color:var(--slate)}" +
      "#rd-print .wc{font-size:7.5pt;color:var(--slate)}" +
      "#rd-print .sec-note{font-size:7.5pt;color:var(--slate);margin:-1mm 0 2.5mm;font-style:italic}" +
      "#rd-print tr.tot td{border-top:1pt solid var(--navy);font-weight:700;background:var(--tint);font-size:8.5pt}" +
      /* ── empty state ── */
      /* No signature rules. Nobody signed this page: it is generated from the
         desk's own records and is read, not countersigned. Two ruled lines
         asking for signatures that never arrive make it look unfinished. */
      /* ── footer ── */
      "#rd-print .ft{position:absolute;left:14mm;right:14mm;bottom:9mm;border-top:1pt solid var(--navy);" +
        "padding-top:2.5mm;display:flex;justify-content:space-between;font-size:7pt;color:var(--slate)}" +
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

  /* The tags this project offers, in the order the RPC ranked them. Keyed on
     id like everything else here: a status NAME is a display string and two
     projects can spell the same idea differently. */
  function _tags() { return (DESK.data && DESK.data.statuses) || []; }

  /* Falls back to Reserved when nothing is armed, which is what the desk did
     before this existed and what the RPC still defaults to. */
  function _armedTag() {
    var t = _tags();
    if (!t.length) return null;
    var hit = null;
    for (var i = 0; i < t.length; i++) if (t[i].id === DESK.statusId) hit = t[i];
    if (hit) return hit;
    for (var j = 0; j < t.length; j++) if (String(t[j].code).toUpperCase() === 'RESERVED') return t[j];
    return t[0];
  }

  /* The button says what it is about to do, because with three tags "Reserve"
     would be wrong two times out of three. */
  function _goLabel() {
    var t = _armedTag();
    if (!t) return 'Reserve';
    var c = String(t.code).toUpperCase();
    return c === 'HOLD' ? 'Put on hold' : c === 'BOOKED' ? 'Book' : 'Reserve';
  }

  /* Class from the CODE, never the name: the name is what a tenant typed into
     its own settings and can read anything. */
  /* Print pill name for a tag code. Separate from the screen's class because
     the two style systems are separate; both read the CODE, never the name. */
  function _pillOf(code) {
    var c = String(code || 'RESERVED').toUpperCase();
    return c === 'HOLD' ? 'hold' : c === 'BOOKED' ? 'booked' : 'reserved';
  }

  /* Does any floor carry a unit in a state with no column of its own? */
  function _avOther(av) {
    return (av || []).some(function (f) { return Number(f.other || 0) > 0; });
  }

  function _tagCls(code) {
    var c = String(code || 'RESERVED').toUpperCase();
    return c === 'HOLD' ? 'tg-hold' : c === 'BOOKED' ? 'tg-booked' : 'tg-reserved';
  }

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

    /* Arm a tag before the first paint so the chips are never all off and the
       button never reads for a tag nobody chose. */
    var tags = _tags();
    if (!DESK.statusId) { var a0 = _armedTag(); DESK.statusId = a0 ? a0.id : null; }

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

          /* WHAT KIND OF HOLD. The list comes from the RPC, which reads the
             project's own category_unit_statuses — never hardcoded here, so a
             project that has not configured On Hold simply shows fewer chips.
             Sold is not among them: this desk writes no sale, and a unit marked
             sold with no sale behind it is money that exists nowhere. */
          (tags.length > 1
            ? '<div class="rd-lb" style="margin-top:13px">Mark as</div>' +
              '<div class="rd-chips" id="rd-tags">' +
                tags.map(function (t) {
                  return '<button class="rd-chip' + (DESK.statusId === t.id ? ' on' : '') +
                         '" data-tag="' + esc(t.id) + '">' + esc(t.name) + '</button>';
                }).join('') +
              '</div>'
            : '') +

          /* Was "Hold for". With On Hold now one of the tags, that label asked
             two different questions with the same word. */
          '<div class="rd-lb" style="margin-top:13px">Expires in</div>' +
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

          '<button class="rd-go" id="rd-go" disabled>' + esc(_goLabel()) + '</button>' +
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

    /* Repainting the whole desk to move one chip would blow away the unit the
       operator has already typed and resolved, so the chips are toggled in
       place and only the button label is rewritten. */
    var tagbox = _q('#rd-tags');
    if (tagbox) tagbox.addEventListener('click', function (e) {
      var b = e.target.closest('.rd-chip[data-tag]'); if (!b) return;
      DESK.statusId = b.getAttribute('data-tag');
      var all = tagbox.querySelectorAll('.rd-chip[data-tag]');
      for (var i = 0; i < all.length; i++) {
        all[i].classList.toggle('on', all[i].getAttribute('data-tag') === DESK.statusId);
      }
      var g = _q('#rd-go'); if (g) g.textContent = _goLabel();
    });

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
    /* Was `u.s === 'reserved'`. get_reserve_desk returns the status code
       lowercased for anything it does not special-case, so a unit tagged On
       Hold arrives as 'hold' and a Booked one as 'booked' — both fell past this
       branch into the generic line and showed no holder at all. Typing LG-12
       said "On Hold" and nothing else: not who asked for it, not until when,
       which is the entire reason the holder block exists. The test is now
       "somebody holds it", not "it is called Reserved". */
    if (u.h) {
      hit.className = 'rd-hit warn';
      hit.innerHTML = '<b>' + esc(u.n) + '</b> — ' + esc(u.sn || 'Reserved') +
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
    DESK.busy = true; if (go) { go.disabled = true; go.textContent = 'Saving…'; }

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
      p_note: String((_q('#rd-note') || {}).value || '').trim() || null,
      /* null is a valid answer: the RPC then falls back to Reserved exactly as
         it did before this parameter existed. */
      p_unit_status_id: DESK.statusId || null
    };

    var res;
    try { res = await sb.rpc('reserve_unit_desk', args); }
    catch (e) { res = null; }
    DESK.busy = false;
    if (go) { go.textContent = _goLabel(); }

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
    /* The verb comes from the tag the SERVER stamped, not from the chip that
       was armed in the browser: if the two ever disagree, the database is the
       one telling the truth. */
    var tg = String(d.tag_code || 'RESERVED').toUpperCase();
    var verb = tg === 'HOLD' ? 'put on hold for' : tg === 'BOOKED' ? 'booked for' : 'reserved for';
    toast(esc(d.unit_no || u.n) + ' ' + verb + ' ' + d.requested_by + ' · ' + d.expiry_days + 'd', 'ok');
    _clearLine();
    _paintToday();
  }

  /* Fold a successful booking into the cache. Deliberately separate from the
     painting: the row has to be recorded even when the operator has already
     navigated away, or the next visit to the desk would show a unit as free
     that this session just booked. */
  function _patchAfterBooking(d, r, u, clientName) {
    /* Both of these come from the SERVER's answer, not from the chip that was
       armed here. It hardcoded 'reserved' and no tag, so a unit booked as On
       Hold painted itself Reserved on the board and in "Booked today" until the
       next refetch — the optimistic patch quietly disagreeing with the row that
       had just been written. */
    var tcode = String(d.tag_code || 'RESERVED').toUpperCase();
    u.s = tcode === 'HOLD' ? 'hold' : tcode === 'BOOKED' ? 'booked' : 'reserved';
    u.sn = d.tag || u.sn || 'Reserved';
    u.h = { by: d.requested_by, code: r.kind === 'agent' ? r.code : null,
            booked: (ME && ME.sales_user_name) || null, exp: d.expiry_date };
    DESK.data.today = DESK.data.today || [];
    DESK.data.today.unshift({
      id: d.reservation_id, unit_id: u.id, unit_no: d.unit_no || u.n,
      floor: u.f, by: d.requested_by, client_name: clientName || null,
      tag: d.tag || 'Reserved', tag_code: tcode,
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
      /* A released row keeps its tag but wears it struck through, so the list
         reads as "this WAS a hold" rather than as a live one. */
      var tcls = live ? _tagCls(r.tag_code) : 'tg-off';
      return '<div class="rd-row" data-id="' + esc(r.id) + '">' +
        '<span class="u">' + esc(r.unit_no) + '</span>' +
        '<span class="tg ' + tcls + '">' + esc(r.tag || 'Reserved') + '</span>' +
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

    /* A single date is still a period, of one day. DB.from/DB.to are the range;
       DB.date is kept as the label a one-day report prints. */
    var from = DB.from || DB.date || null;
    var to   = DB.to   || DB.date || null;
    var r;
    try {
      r = await sb.rpc('get_reservation_daybook',
        { p_session_token: TOKEN, p_date: null, p_project_id: DESK.projectId || null,
          p_from: from, p_to: to });
    } catch (e) { return _netErr(); }
    var d = r && r.data;
    if (!_alive('daybook')) return;                    // shell moved on mid-load
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) return _netErr();
    DB.data = d; DB.date = d.date; DB.from = d.from; DB.to = d.to;
    _dbPaint(host);
  };

  function _dbPaint(host) {
    var d = DB.data, h = d.header || {};
    var resv = _liveOnly(d.reserved), sold = d.sold || [], exp = d.expiring || [], av = d.available || [];
    /* `holding` is the whole active set and is not date-scoped, so it is stamped
       with the server's clock rather than with the date in the picker. */
    var hold = d.holding || [];
    var heldEarlier = _heldEarlier(hold);
    var genISO = d.generated_at || new Date().toISOString();
    var totAvail = av.reduce(function (s, f) { return s + Number(f.available || 0); }, 0);

    host.innerHTML =
      '<div class="rd" id="db-root">' +
        '<div class="rd-top">' +
          /* Two ways in, because they answer different questions. Today is one
             press for the thing asked for most; From/To is for a week, a month
             or a single past day. Nothing outside the range reaches the page. */
          '<button class="rd-chip' + (_isToday(d) ? ' on' : '') + '" id="db-today">Today</button>' +
          '<span class="db-rng">' +
            '<label>From</label>' +
            '<input class="rd-sm" type="date" id="db-from" value="' + esc(String(d.from || d.date).slice(0, 10)) + '">' +
            '<label>To</label>' +
            '<input class="rd-sm" type="date" id="db-to" value="' + esc(String(d.to || d.date).slice(0, 10)) + '">' +
          '</span>' +
          '<button class="rd-chip" id="db-back">' + li('x', 14) + ' Desk</button>' +
        '</div>' +
        '<div class="db-acts">' +
          '<button class="rd-chip" id="db-copy">' + li('copy', 15) + ' Copy for WhatsApp</button>' +
          '<button class="rd-chip" id="db-wa">' + li('send', 15) + ' WhatsApp</button>' +
          '<button class="rd-chip" id="db-pdf">' + li('fileText', 15) + ' PDF</button>' +
        '</div>' +

        /* "Booked today" rather than "Reserved today": with three tags in play
           the old heading named only one of them. A booking that was undone is
           not here at all — see the RPC. The desk's own list still has it. */
        /* The same four numbers as the PDF, in the same order. If the screen
           and the paper ever disagree about an opening balance, the one being
           looked at is the one that will be believed. */
        (d.ledger ? _dbSec('Movement · ' + _periodShort(d), '',
          _dbTable(['', 'Opening', '+ Added', '− Released', '= Closing'],
            [['Held', d.ledger.held], ['Sold', d.ledger.sold]].map(function (row) {
              var v = row[1] || {};
              return ['<b>' + esc(row[0]) + '</b>',
                      '<span class="n">' + esc(String(v.opening || 0)) + '</span>',
                      '<span class="n">' + esc(String(v.added || 0)) + '</span>',
                      '<span class="n">' + esc(String(v.removed || 0)) + '</span>',
                      '<span class="n"><b>' + esc(String(v.closing || 0)) + '</b></span>'];
            }).concat([[
              '<b>Available</b>',
              '<span class="n">' + esc(String((d.ledger.available || {}).opening || 0)) + '</span>',
              '<span class="t">—</span>', '<span class="t">—</span>',
              '<span class="n"><b>' + esc(String((d.ledger.available || {}).closing || 0)) + '</b></span>'
            ]]))) : '') +

        _dbSec(d.single_day ? 'Booked today' : 'Booked in this period', resv.length, resv.length
          ? _dbTable(['Unit', 'Tag', 'Floor', 'Requested by', 'Buyer', 'Expires'],
              resv.map(function (r) {
                return ['<b>' + esc(r.unit_no) + '</b>',
                        '<span class="tg ' + _tagCls(r.tag_code) + '">' + esc(r.tag || 'Reserved') + '</span>',
                        esc(r.floor),
                        esc(r.requested_by) + (r.agent_code ? ' <span class="t">(' + esc(r.agent_code) + ')</span>' : ''),
                        r.client_name ? esc(r.client_name) : '<span class="t">—</span>',
                        esc(_pkDate(r.expiry_date))];
              }))
          : '<div class="rd-empty">Nothing booked ' + esc(_periodPhrase(d)) + '.</div>') +

        _dbSec(d.single_day ? 'Sold today' : 'Sold in this period', sold.length, sold.length
          ? _dbTable(['Unit', 'Floor', 'Sale', 'Buyer', 'Agent'],
              sold.map(function (s) {
                return ['<b>' + esc(s.unit_no) + '</b>', esc(s.floor), esc(s.sale_number || '—'),
                        esc(s.client_name || '—'), esc(s.agent || '—')];
              }))
          : '<div class="rd-empty">Nothing sold ' + esc(_periodPhrase(d)) + '.</div>') +

        /* UNITS ON HOLD, in place of "Expiring within 48 hours". Everything that
           section listed is in this one wearing a red chip, so keeping both would
           have shown the same units twice — and the screen has to tell the same
           story as the PDF, or the two disagree about the same day.

           It lists only what was held BEFORE this day, because section 01 above
           already lists the day's own bookings and printing both made three
           bookings read as six. The total is stated in the line beneath the
           heading rather than dropped. */
        _dbSec('Held from before', heldEarlier.length, heldEarlier.length
          ? '<div class="db-asat">As at ' + esc(_pkDate(genISO)) + ' ' + esc(_pkTime(genISO)) +
            ' PKT — still held from before the period; bookings inside it are listed above.' +
            (heldEarlier.length !== hold.length ? ' ' + hold.length + ' held in total.' : '') +
            '</div>' +
            _dbTable(['Unit', 'Tag', 'Floor', 'Size', 'Reserved by', 'Reserved on', 'Expires', 'Left'],
              heldEarlier.map(function (r) {
                var L = _holdLeft(r);
                return ['<b>' + esc(r.unit_no) + '</b>',
                        '<span class="tg ' + _tagCls(r.tag_code) + '">' + esc(r.tag || 'Reserved') + '</span>',
                        esc(r.floor),
                        '<span class="n">' + esc(_area(r.area, r.area_unit)) + '</span>',
                        esc(r.requested_by) + (r.agent_code ? ' <span class="t">(' + esc(r.agent_code) + ')</span>' : ''),
                        esc(_pkDate(r.reserved_at)), esc(_pkDate(r.expiry_date)),
                        '<span class="n' + (L.tone ? ' db-' + L.tone : '') + '">' + esc(L.t) + '</span>'];
              }))
          : '<div class="rd-empty">Nothing is held from an earlier day.</div>') +

        /* The minus line, named. "− Released 1" is a number nobody can check
           until the unit is on the page beside it. */
        ((d.released || []).length ? _dbSec('Released in this period', d.released.length,
          _dbTable(['Unit', 'Floor', 'Reserved by', 'Taken', 'Went', 'How'],
            d.released.map(function (r) {
              var how = r.went === 'cancelled' ? 'Cancelled' : r.went === 'sold' ? 'Sold' : 'Lapsed';
              return ['<b>' + esc(r.unit_no) + '</b>', esc(r.floor),
                      esc(r.requested_by) + (r.agent_code ? ' <span class="t">(' + esc(r.agent_code) + ')</span>' : ''),
                      esc(_pkDate(r.reserved_at)), esc(_pkDate(r.went_at)),
                      '<span class="tg tg-off">' + esc(how) + '</span>'];
            }))) : '') +

        /* Same five states as the PDF, same order, so the two never disagree
           about a floor. Other only appears when a floor actually has some. */
        _dbSec('Available by floor', totAvail,
          _dbTable(['Floor', 'Available', 'On hold', 'Reserved', 'Booked', 'Sold']
                     .concat(_avOther(av) ? ['Other'] : []).concat(['Total']),
            av.map(function (f) {
              return [esc(f.floor),
                      '<span class="n"><b>' + esc(String(f.available || 0)) + '</b></span>',
                      '<span class="n">' + esc(String(f.hold || 0)) + '</span>',
                      '<span class="n">' + esc(String(f.reserved || 0)) + '</span>',
                      '<span class="n">' + esc(String(f.booked || 0)) + '</span>',
                      '<span class="n">' + esc(String(f.sold || 0)) + '</span>']
                     .concat(_avOther(av) ? ['<span class="n">' + esc(String(f.other || 0)) + '</span>'] : [])
                     .concat(['<span class="n">' + esc(String(f.total || 0)) + '</span>']);
            }))) +
      '</div>';

    var back = _dbq('#db-back'); if (back) back.addEventListener('click', function () { setTab('desk'); });
    var tdy = _dbq('#db-today');
    if (tdy) tdy.addEventListener('click', function () {
      DB.from = null; DB.to = null; DB.date = null;   // let the server say what today is
      window.renderDaybook();
    });
    /* Both ends refetch, and a range entered backwards is straightened by the
       RPC rather than refused — it is a slip, not a request for nothing. */
    ['#db-from', '#db-to'].forEach(function (sel) {
      var el = _dbq(sel); if (!el) return;
      el.addEventListener('change', function () {
        DB.from = (_dbq('#db-from') || {}).value || null;
        DB.to   = (_dbq('#db-to')   || {}).value || null;
        DB.date = null;
        window.renderDaybook();
      });
    });
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
    L.push('*' + (h.project || 'Inventory') + '* — ' + _periodShort(d));
    if (h.company) L.push(h.company);
    L.push('');

    /* Cancelled bookings are not in this payload and are not listed here. The
       group reads every line as a unit that is off the board, so a released one
       appearing at all — even labelled — was the thing being complained about.
       "On hold now" below is the authoritative answer to what is unavailable. */
    var resv = _liveOnly(d.reserved);
    L.push('*' + (d.single_day ? 'Booked today' : 'Booked in this period') + ' (' + resv.length + ')*');
    if (!resv.length) L.push('— none —');
    else resv.forEach(function (r) {
      L.push('• ' + r.unit_no + ' (' + r.floor + ') — ' + (r.tag || 'Reserved') +
             ' for ' + r.requested_by + ' · till ' + _pkDate(r.expiry_date));
    });
    L.push('');

    var sold = d.sold || [];
    L.push('*' + (d.single_day ? 'Sold today' : 'Sold in this period') + ' (' + sold.length + ')*');
    if (!sold.length) L.push('— none —');
    else sold.forEach(function (s) {
      L.push('• ' + s.unit_no + ' (' + s.floor + ')' + (s.agent ? ' — ' + s.agent : ''));
    });
    L.push('');

    /* The standing position, in place of the 48-hour slice — which was a subset
       of this list and printed the same units twice. This is the part the group
       actually acts on: what is off the board right now and when it returns. */
    var hold = _heldEarlier(d.holding);
    if (hold.length) {
      L.push('*Also held, from before (' + hold.length + ')*');
      hold.forEach(function (r) {
        var L2 = _holdLeft(r);
        L.push('• ' + r.unit_no + ' (' + r.floor + ') — ' + (r.tag || 'Reserved') +
               ' · ' + r.requested_by + ' · ' + (r.overdue ? 'LAPSED' : L2.t + ' left'));
      });
      L.push('');
    }

    if (d.ledger && d.ledger.held) {
      var lh = d.ledger.held, lav = d.ledger.available || {};
      L.push('*Movement*');
      L.push('Held: ' + (lh.opening || 0) + ' + ' + (lh.added || 0) + ' \u2212 ' +
             (lh.removed || 0) + ' = *' + (lh.closing || 0) + '*');
      L.push('Available: ' + (lav.opening || 0) + ' \u2192 *' + (lav.closing || 0) + '*');
      L.push('');
    }

    L.push('*Available by floor*');
    var tot = 0;
    (d.available || []).forEach(function (f) {
      tot += Number(f.available || 0);
      /* Held, not broken down: the group asks "can I sell it", and any of
         the three tags answers no. The daybook itself carries the split. */
      var held = Number(f.hold || 0) + Number(f.reserved || 0) + Number(f.booked || 0);
      L.push('• ' + f.floor + ': ' + f.available + ' of ' + f.total +
             (held ? '  (' + held + ' held)' : ''));
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
  var BAND = { mast: 30, run: 16, foot: 20 };   // mm consumed above / below the column

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
  /* PKR the way it is read here: crore and lac, not millions. */
  function _pkr(n) {
    n = Number(n || 0);
    if (n >= 1e7) return 'PKR ' + (n / 1e7).toFixed(2) + ' Cr';
    if (n >= 1e5) return 'PKR ' + (n / 1e5).toFixed(2) + ' Lac';
    return 'PKR ' + n.toLocaleString('en-US');
  }

  var _MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var _DAY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  /* A Date shifted into Pakistan time, or null. A board report must not fail to
     render because one row is missing a date — it prints an em dash and the rest
     of the page still arrives. */
  /* 1,250 sqft — the unit comes from the row, never assumed. */
  function _area(n, u) {
    n = Number(n || 0);
    if (!n) return '\u2014';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + (u || 'sqft');
  }
  /* One definition of urgency, read by both the screen and the print builder.
     Two copies of these thresholds would eventually drift, and the drift would
     show up as a unit that is red on the page and calm on the screen. */
  /* A cancelled booking is not on this report at all — the RPC filters it out,
     and this filters it again on the way in. Belt and braces on purpose: an
     older RPC still deployed somewhere would otherwise put a released unit back
     on a page that is pasted into the sales group as "off the board". */
  function _isLive(r) { return !r.status || r.status === 'active'; }

  /* THE HELD LIST MINUS WHAT SECTION 01 ALREADY SHOWED.
     Three bookings printed as six because both sections were right: one is the
     day's movement, the other the standing position, and on a day when nothing
     has been released they are the same rows. The flag comes from the server,
     computed against the same Karachi day section 01 filters on — matching on
     unit numbers here would have worked too, and would have been the third
     time in this build that a display string was used as a key. */
  /* Is the report showing today, and only today? */
  function _isToday(d) {
    if (!d || !d.single_day) return false;
    var pk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
    var y = pk.getFullYear() + '-' + String(pk.getMonth() + 1).padStart(2, '0') +
            '-' + String(pk.getDate()).padStart(2, '0');
    return String(d.to || d.date).slice(0, 10) === y;
  }

  /* How the period is named on the page. A single day keeps the old wording;
     a range says both ends, because "today" on a report covering a week is the
     kind of label that gets quoted back wrongly. */
  function _periodLabel(d, caps) {
    var a = d.from || d.date, b = d.to || d.date;
    if (d.single_day || String(a).slice(0,10) === String(b).slice(0,10)) {
      return caps ? _dCaps(b) : _dLong(b);
    }
    return (caps ? _dCaps(a) : _dShort(a)) + '  \u2192  ' + (caps ? _dCaps(b) : _dShort(b));
  }
  /* "on 07 September" for a day, "between 01 and 07 September" for a range —
     so the empty states read as sentences rather than as a date stuck on. */
  function _periodPhrase(d) {
    var a = d.from || d.date, b = d.to || d.date;
    if (String(a).slice(0,10) === String(b).slice(0,10)) {
      return 'on ' + _dLong(b).split(', ')[1];
    }
    return 'between ' + _dShort(a) + ' and ' + _dShort(b);
  }

  function _periodShort(d) {
    var a = d.from || d.date, b = d.to || d.date;
    return (String(a).slice(0,10) === String(b).slice(0,10))
      ? _dShort(b) : _dShort(a) + ' \u2013 ' + _dShort(b);
  }

  function _heldEarlier(hold) {
    return (hold || []).filter(function (r) { return !r.booked_today; });
  }
  function _liveOnly(rows) { return (rows || []).filter(_isLive); }

  function _holdLeft(r) {
    if (r.overdue) return { t: 'LAPSED', tone: 'red' };
    if (Number(r.hours_left) <= 48) return { t: r.hours_left + 'h', tone: 'red' };
    if (Number(r.days_left) <= 7)  return { t: r.days_left + 'd', tone: 'amber' };
    return { t: r.days_left + 'd', tone: null };
  }
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
    var tSold = 0, tRes = 0, tHold = 0, tBook = 0, tAv = 0, tOther = 0, tAll = 0;
    avail.forEach(function (f) {
      tSold  += Number(f.sold || 0);     tRes   += Number(f.reserved || 0);
      tHold  += Number(f.hold || 0);     tBook  += Number(f.booked || 0);
      tAv    += Number(f.available || 0); tOther += Number(f.other || 0);
      tAll   += Number(f.total || 0);
    });
    /* The Other column is drawn only when something is in it. On Awami it is
       always zero; a project with Dead or Mortgaged units gets the column and
       the row still adds up to the total either way. */
    var showOther = tOther > 0;
    /* Every unit that is not available is off the market, whichever tag it
       wears. The position line needs one figure for that, or a reader has to
       add three columns in their head to answer "how much is gone". */
    var tHeld = tRes + tHold + tBook;

    var pages = [], body = null, pageNo = 0;

    function newPage(first) {
      var pg = _el('div', 'rd-pg');
      pages.push(pg); host.appendChild(pg); pageNo++;

      if (first) {
        var mh = _el('div', 'mh');
        var L = _el('div');
        // The company is named on the RIGHT of the band. It used to be printed on
        // the left as well, which read as a mistake rather than as emphasis.
        if (h.logo_url) {
          var img = document.createElement('img'); img.className = 'mh-logo'; img.src = h.logo_url; img.alt = '';
          L.appendChild(img);
        }
        L.appendChild(_el('div', 'mh-proj', project.toUpperCase()));
        L.appendChild(_el('div', 'mh-t', 'Reservation Daybook'));
        /* A week-long report headed with a single date is the kind of label
           that gets quoted back as fact. Both ends, whenever there are two. */
        L.appendChild(_el('div', 'mh-d', _periodLabel(d, false)));
        var R = _el('div', 'mh-r');
        [company, 'Karkhano, Peshawar',
         'Report ref: ' + _initials(project) + '-DB-' + _dRef(dateISO)]
          .filter(Boolean).forEach(function (t) { R.appendChild(_el('div', null, t)); });
        mh.appendChild(L); mh.appendChild(R);
        mh.appendChild(_el('div', 'mh-amber'));
        pg.appendChild(mh);
      } else {
        var rh = _el('div', 'rh');
        rh.appendChild(_el('div', 'l', project + '  ·  Reservation Daybook  ·  ' + _periodShort(d)));
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

    /* ── SUMMARY ────────────────────────────────────────────────────────
       One block, about 28mm, in place of ~90mm of cards and a full-width bar.
       A board report is read, not scanned from across a room, so the position
       is a line of figures rather than four boxes.

       WHAT IS NOT HERE, and why. Cumulative money and period buckets are not in
       get_reservation_daybook: `available` carries counts only, and `price` /
       `amount` exist solely on TODAY's rows. So the PKR line states today's
       value — which is what the data actually is — and the period table shows
       counts it can prove and an em dash where it cannot. Nothing here is
       inferred; a board figure that is quietly wrong is worse than one absent. */
    function sumRow(items, small) {
      var r = _el('div', 'sum-r' + (small ? ' sum-b' : ''));
      items.forEach(function (it, i) {
        if (i) r.appendChild(_el('div', 'sep'));
        var c = _el('div', 'sum-i');
        c.appendChild(_el('span', 'k', it[0]));
        c.appendChild(_el('span', 'v', it[1]));
        if (it[2]) c.appendChild(_el('span', 'p', '(' + it[2] + ')'));
        r.appendChild(c);
      });
      return r;
    }

    var hold = d.holding || [];
    /* Narrowed for the printed rows only. Everything that counts or adds up
       money below still reads `hold`: the standing position is the whole set,
       whether or not part of it happened today. */
    var heldEarlier = _heldEarlier(hold);
    /* Only the bookings that still stand. Counting a released one here said
       PKR 1.53 Cr was held on a day when nothing was: the figure has to follow
       the same live/released split as the counts beside it. */
    /* One filtered list, read by the summary and by section 01 alike, so the
       money and the rows can never be counting different things. */
    var dayRows = _liveOnly(d.reserved);
    var todayResVal = dayRows.reduce(function (a, r) { return a + Number(r.price || 0); }, 0);
    var todaySoldVal = (d.sold || []).reduce(function (a, r) { return a + Number(r.amount || 0); }, 0);

    var sum = _el('div');
    sum.style.marginTop = '7mm';
    sum.appendChild(_el('div', 'sum-l', 'Project position'));
    sum.appendChild(sumRow([
      ['Total', _num(tAll), null],
      ['Sold', _num(tSold), _pct(tSold, tAll)],
      ['Held', _num(tHeld), _pct(tHeld, tAll)],
      ['Available', _num(tAv), _pct(tAv, tAll)]
    ], false));
    /* The split under it, because "held" is three different promises and the
       board wants to know which. Suppressed entirely when nothing is held. */
    if (tHeld || tOther) {
      sum.appendChild(_el('div', 'sum-pkr',
        'Of which: on hold ' + _num(tHold) + '  \u00b7  reserved ' + _num(tRes) +
        '  \u00b7  booked ' + _num(tBook) +
        (tOther ? '  \u00b7  other ' + _num(tOther) : '')));
    }
    /* `holding` is the whole active set, not a day's slice, so the value tied up
       in reservations IS derivable now — unlike the sold and period figures,
       which stay date-bound. Stated separately for exactly that reason. */
    var holdVal = hold.reduce(function (a, r) { return a + Number(r.price || 0); }, 0);
    sum.appendChild(_el('div', 'sum-pkr',
      'Booked ' + _pkr(todayResVal) + '  ·  Sold ' + _pkr(todaySoldVal) +
      (hold.length ? '  ·  Held ' + _pkr(holdVal) + ' across ' + _num(hold.length) +
                     ' unit' + (hold.length === 1 ? '' : 's') : '') +
      /* From NOW, not from the period: the only figure on the page about what
         happens next rather than about what happened. */
      ((d.expiring || []).length ? '  \u00b7  ' + _num(d.expiring.length) +
                                   ' expiring within 48h' : '')));

    /* ── MOVEMENT ──────────────────────────────────────────────────────────
       What Rashid asked for in his own words: opening, the plus and minus
       during the period, and closing. A table rather than more figure cards,
       because these four numbers only mean anything read across a row.

       Removed is not counted anywhere — the RPC derives it as opening + added
       − closing, so if any of the three were wrong the row would visibly fail
       to add up rather than quietly under-report. */
    var lg = d.ledger || {};
    if (lg.held) {
      var mv = _el('div', 'mv');
      mv.appendChild(_el('div', 'sum-l', 'Movement \u00b7 ' + _periodLabel(d, true)));
      var mt = _el('table', 'mv-t');
      var mh2 = _el('thead'), mhr = _el('tr');
      ['', 'Opening', '+ Added', '\u2212 Released', '= Closing'].forEach(function (c, i) {
        mhr.appendChild(_el('th', i ? 'n' : null, c));
      });
      mh2.appendChild(mhr); mt.appendChild(mh2);
      var mb = _el('tbody');
      [['Held', lg.held], ['Sold', lg.sold]].forEach(function (row) {
        var v = row[1] || {}, tr = _el('tr');
        tr.appendChild(_el('td', null, row[0]));
        [v.opening, v.added, v.removed].forEach(function (n) {
          tr.appendChild(_el('td', 'n', _num(n || 0)));
        });
        tr.appendChild(_el('td', 'n mv-c', _num(v.closing || 0)));
        mb.appendChild(tr);
      });
      /* Available has no movement of its own — it is what the other two leave
         behind — so the middle columns are blank rather than filled with a
         number that would look like a count of something. */
      var av = lg.available || {}, atr = _el('tr');
      atr.appendChild(_el('td', null, 'Available'));
      atr.appendChild(_el('td', 'n', _num(av.opening || 0)));
      atr.appendChild(_el('td', 'n mut', '\u2014'));
      atr.appendChild(_el('td', 'n mut', '\u2014'));
      atr.appendChild(_el('td', 'n mv-c', _num(av.closing || 0)));
      mb.appendChild(atr);
      mt.appendChild(mb); mv.appendChild(mt);
      sum.appendChild(mv);
    }



    /* The PERIOD table is not here. It cost 28mm of page and carried seven em
       dashes and two numbers, because get_reservation_daybook is a single-date
       report: `available` has counts only, and `price` / `amount` exist solely
       on today's rows, so week, month and cumulative value cannot be derived
       from it. It comes back when the RPC can answer it, not before. */
    body.appendChild(sum);

    /* ── sections ──────────────────────────────────────────────────────── */
    function secHead(no, title, count, unit) {
      var hd = _el('div', 'sec-h');
      hd.appendChild(_el('div', 'sec-n', no));
      hd.appendChild(_el('div', 'sec-t', title));
      hd.appendChild(_el('div', 'pill count', _num(count) + ' ' + unit + (count === 1 ? '' : 's')));
      return hd;
    }
    /* A name alone is not an identity here: two salespeople share one, which is
       why the picker was keyed on agent_id. The code rides beside the name so
       the printed line can be resolved to a person too. */
    function whoCell(name, code) {
      if (!code) return name || '\u2014';
      var w = _el('span');
      w.appendChild(document.createTextNode(name || '\u2014'));
      w.appendChild(_el('span', 'wc', '  \u00b7 ' + code));
      return { node: w };
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

    /* One stamp, so the section note and the page footer cannot disagree. The
       server's clock is preferred over the browser's: the hold list was computed
       there, and `days_left` was measured against that same now(). */
    var genISO = d.generated_at || new Date().toISOString();

    var secs = [
      /* "Reservations Today" named one of the three tags this desk can now
         apply, so it was wrong on two rows in three. */
      /* The headings say what the report covers. "Booked Today" on a report
         spanning a week is the kind of label a reader trusts and should not. */
      { title: d.single_day ? 'Booked Today' : 'Booked In This Period',
        unit: 'unit', noun: 'bookings',
        cols: [['Unit'], ['Tag'], ['Floor'], ['Requested by'], ['Booked by'], ['Buyer'], ['Expires'], ['Left', 'n']],
        rows: dayRows.map(function (r) {
          var ed = _pk(r.expiry_date);
          var days = ed ? Math.max(0, Math.ceil((ed - new Date()) / 864e5)) : null;
          return [{ v: r.unit_no, cls: 'u' },
                  { v: r.tag || 'Reserved', pill: _pillOf(r.tag_code) },
                  r.floor,
                  whoCell(r.requested_by, r.agent_code),
                  r.booked_by || '—',
                  r.client_name ? r.client_name : { v: '—', cls: 'mut' },
                  _dShort(r.expiry_date),
                  days == null ? { v: '—', cls: 'n mut' } : { v: days + 'd', pill: 'amber', cls: 'n' }];
        }),
        empty: function () { return 'No units booked ' + _periodPhrase(d) + '.'; } },

      { title: d.single_day ? 'Sales Today' : 'Sales In This Period',
        unit: 'unit', noun: 'sales',
        cols: [['Unit'], ['Floor'], ['Buyer'], ['Agent'], ['Sale ref']],
        rows: (d.sold || []).map(function (s) {
          return [{ v: s.unit_no, cls: 'u' }, s.floor, s.client_name || '—', s.agent || '—',
                  { v: s.sale_number || '—', cls: 'code' }];
        }),
        empty: function () { return 'No units sold ' + _periodPhrase(d) + '.'; } },

      /* UNITS ON HOLD — the standing position, and the only section on this page
         that is not about one date.

         It replaces "Expiring Within 48 Hours" rather than joining it. Every row
         that section printed is in this one, carrying a red pill, so keeping both
         would print the same units twice on a report specced as a single page.

         Ordered by when the unit comes back, soonest first, because that is the
         order the list is worked: the top of it is what has to be chased today.
         The booking date is still a column, so the other reading is available
         to the eye even though it is not the sort. */
      { title: 'Held From Before', unit: 'unit', noun: 'earlier holds', undated: true,
        note: 'As at ' + _dShort(genISO) + ' ' + _pkTime(genISO) + ' PKT \u2014 still held from before ' +
              _dShort(d.from || dateISO) + ', soonest to lapse first. Bookings inside the period are in 01' +
              (heldEarlier.length !== hold.length
                ? '; ' + _num(hold.length) + ' unit' + (hold.length === 1 ? '' : 's') + ' held in total.'
                : '.'),
        cols: [['Unit'], ['Tag'], ['Floor'], ['Size', 'n'], ['Reserved by'],
               ['Buyer'], ['Reserved on'], ['Expires'], ['Left', 'n']],
        rows: heldEarlier.map(function (r) {
          var L = _holdLeft(r);
          var left = L.tone ? { v: L.t, pill: L.tone, cls: 'n' } : { v: L.t, cls: 'n' };
          return [{ v: r.unit_no, cls: 'u' },
                  { v: r.tag || 'Reserved', pill: _pillOf(r.tag_code) },
                  r.floor,
                  { v: _area(r.area, r.area_unit), cls: 'n' },
                  whoCell(r.requested_by, r.agent_code),
                  r.client_name ? r.client_name : { v: '\u2014', cls: 'mut' },
                  _dShort(r.reserved_at), _dShort(r.expiry_date), left];
        }),
        empty: function () { return 'Nothing is held from an earlier day.'; } },

      /* Five states across, in the order a unit travels: on hold, reserved,
         booked, sold — then what is still free. Before this the table showed
         three of them and a unit tagged On Hold or Booked was counted in Total
         and in no column at all, which is how 1,467 came to sit above
         0 + 0 + 1,466. */
      /* THE MINUS LINE, NAMED. The movement table says one unit left the hold
         list; this says which one and how. Without it "− Released 1" is a
         number nobody can check. Cancelled, lapsed and sold are different
         events and the column says which, because a hold that expired is a
         follow-up nobody made and a hold that was cancelled is a decision. */
      { title: 'Released In This Period', unit: 'unit', noun: 'releases',
        cols: [['Unit'], ['Tag'], ['Floor'], ['Reserved by'], ['Taken'], ['Went'], ['How']],
        rows: (d.released || []).map(function (r) {
          var how = r.went === 'cancelled' ? { v: 'Cancelled', pill: 'off' }
                  : r.went === 'sold'      ? { v: 'Sold', pill: 'booked' }
                  :                          { v: 'Lapsed', pill: 'red' };
          return [{ v: r.unit_no, cls: 'u' },
                  { v: r.tag || 'Reserved', pill: 'off' },
                  r.floor,
                  whoCell(r.requested_by, r.agent_code),
                  _dShort(r.reserved_at), _dShort(r.went_at), how];
        }),
        empty: function () { return 'Nothing was released ' + _periodPhrase(d) + '.'; } },

      { title: 'Floor-wise Position', unit: 'floor', noun: 'inventory',
        cols: [['Floor'], ['On hold', 'n'], ['Reserved', 'n'], ['Booked', 'n'], ['Sold', 'n']]
              .concat(showOther ? [['Other', 'n']] : [])
              .concat([['Available', 'n'], ['Total', 'n'], ['% Sold', 'n']]),
        rows: avail.map(function (f) {
          var t = Number(f.total || 0);
          return [f.floor,
                  { v: _num(f.hold), cls: 'n' }, { v: _num(f.reserved), cls: 'n' },
                  { v: _num(f.booked), cls: 'n' }, { v: _num(f.sold), cls: 'n' }]
                 .concat(showOther ? [{ v: _num(f.other), cls: 'n' }] : [])
                 .concat([{ v: _num(f.available), cls: 'n' }, { v: _num(t), cls: 'n' },
                          { v: _pct(Number(f.sold || 0), t), cls: 'n' }]);
        }),
        total: ['Total',
                { v: _num(tHold), cls: 'n' }, { v: _num(tRes), cls: 'n' },
                { v: _num(tBook), cls: 'n' }, { v: _num(tSold), cls: 'n' }]
               .concat(showOther ? [{ v: _num(tOther), cls: 'n' }] : [])
               .concat([{ v: _num(tAv), cls: 'n' }, { v: _num(tAll), cls: 'n' },
                        { v: _pct(tSold, tAll), cls: 'n' }]),
        empty: function () { return 'No inventory recorded for this project.'; } }
    ];

    /* An empty section gets no heading, no number and no box — those are three
       pieces of furniture around the word "none". They collapse into one line
       placed where they would have been, and the numbering follows what is
       actually on the page. */
    var live = secs.filter(function (x) { return x.rows.length; });
    var bare = secs.filter(function (x) { return !x.rows.length; });

    live.forEach(function (sec, si) {
      var block = _el('div');
      block.style.marginTop = si === 0 ? '8mm' : '7mm';
      block.appendChild(secHead(String(si + 1).padStart(2, '0'), sec.title, sec.rows.length, sec.unit));
      if (sec.note) block.appendChild(_el('div', 'sec-note', sec.note));

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

    if (bare.length) {
      /* "No units on hold on 07 September" would be a lie about a list that is
         not date-scoped, so the dateless sections get their own sentence. */
      var dated = bare.filter(function (x) { return !x.undated; }).map(function (x) { return x.noun; });
      var free  = bare.filter(function (x) { return x.undated; }).map(function (x) { return x.noun; });
      var lines = [];
      if (dated.length) lines.push('No ' + dated.join(' and no ') + ' ' + _periodPhrase(d) + '.');
      if (free.length)  lines.push('No ' + free.join(' and no ') + ' at this moment.');
      var none = _el('div', 'noneline');
      none.style.marginTop = '7mm';
      none.textContent = lines.join('  ');
      push(none);
    }

    /* No "Prepared by / Approved by". Removed on request: the desk generates this
       page from its own records, nobody countersigns it, and two ruled lines
       waiting for signatures that never come made a finished report look
       provisional. The footer already says who generated it and when. */

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
