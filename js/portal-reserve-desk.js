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
    reqs: [],            // pending requests from the public link
    reqBusy: null,       // id of the request being decided
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
      /* Quiet until it is armed, then it says the unit's name out loud —
         because the second tap puts a unit back on sale and the dealer
         holding it is not told. */
      ".db-rel{height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--fk-border);" +
      "  background:var(--fk-bg-card);color:var(--fk-text-muted);font-size:12px;font-weight:600;" +
      "  white-space:nowrap}" +
      ".db-rel:hover{border-color:var(--fk-danger);color:var(--fk-danger)}" +
      ".db-rel.on{border-color:var(--fk-danger);background:var(--fk-danger);color:#fff}" +
      ".db-rel:disabled{opacity:.5;cursor:default}" +
      /* Asked on the card, under the request it is about. */
      ".rq-pick{margin-top:9px;padding-top:9px;border-top:1px solid var(--fk-border)}" +
      ".rq-pl{font-size:10px;font-weight:650;letter-spacing:.1em;text-transform:uppercase;" +
      "  color:var(--fk-text-muted);margin-bottom:7px}" +
      ".rq-pc{display:flex;gap:6px;flex-wrap:wrap}" +
      ".rq-t{height:34px;padding:0 12px;border-radius:9px;border:1px solid var(--fk-border);" +
      "  background:var(--fk-bg-card);font-size:12.5px;font-weight:600;white-space:nowrap}" +
      ".rq-t:hover{border-color:var(--fk-primary);color:var(--fk-primary)}" +
      ".rq-t.perm{border-style:dashed}" +
      /* A change request is a different question and looks like one. */
      ".rq-c.chg{border-left:3px solid var(--fk-primary)}" +
      ".rq-k{font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;" +
      "  color:var(--fk-primary);margin-right:7px}" +
      ".rq-was{margin-top:6px;font-size:12px;color:var(--fk-text-muted);line-height:1.45}" +
      ".rq-was b{color:var(--fk-text);font-weight:650}" +
      ".rq-cancel{margin-top:8px;height:30px;padding:0 11px;border-radius:8px;" +
      "  border:1px solid var(--fk-border);background:var(--fk-bg-card);" +
      "  color:var(--fk-text-muted);font-size:12px;font-weight:600}" +
      /* A permanent tag is not a louder version of a temporary one, it is a
         different KIND of act — so it does not borrow the colour the timed
         tags use. A dashed edge and the infinity mark carry it. */
      ".rd-chip.perm{border-style:dashed}" +
      ".rd-chip.perm.on{border-style:solid}" +
      ".rd-note-perm{margin-top:13px;padding:9px 11px;border:1px solid var(--fk-border);" +
      "  border-radius:var(--fk-radius);color:var(--fk-text-muted);" +
      "  font-size:var(--fk-fs-label);line-height:1.45}" +
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
      /* The list sits in the flow rather than floating: the desk is used on a
         phone, where an absolutely positioned menu ends up under the keyboard. */
      ".rd-sugg{margin-top:7px;border:1px solid var(--fk-border);border-radius:11px;background:var(--fk-bg-card);overflow:auto;max-height:min(46vh,320px)}" +
      ".rd-sg{display:flex;align-items:baseline;gap:10px;width:100%;padding:10px 12px;border:0;border-bottom:1px solid var(--fk-border);background:none;color:var(--fk-text);font:inherit;text-align:left;cursor:pointer}" +
      ".rd-sg:last-of-type{border-bottom:0}" +
      ".rd-sg:hover,.rd-sg.on{background:var(--fk-primary-tint)}" +
      ".rd-sg .n{font-weight:700;min-width:80px}" +
      ".rd-sg .f{flex:1;min-width:0;font-size:var(--fs-caption);color:var(--fk-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".rd-sg .a{font-size:var(--fs-caption);color:var(--fk-text-muted);white-space:nowrap}" +
      ".rd-sg-more{padding:8px 12px;font-size:var(--fs-caption);color:var(--fk-text-muted);border-top:1px solid var(--fk-border)}" +
      /* THE REQUEST QUEUE. Sits above everything because it is the only part of
         this screen where somebody is waiting on an answer. Deliberately plain:
         a unit, who asked, how long they asked for, and two buttons. */
      ".rq{margin-bottom:16px}" +
      ".rq-h{font-weight:700;margin:0 2px 8px;display:flex;align-items:center;gap:8px}" +
      ".rq-n{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--fk-warning-tint,#FFF4E5);color:#8A5300}" +
      ".rq-c{border:1px solid var(--fk-border);border-radius:11px;background:var(--fk-bg-card);padding:12px 13px;margin-bottom:8px}" +
      ".rq-top{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}" +
      ".rq-u{font-weight:700;font-size:var(--fs-section)}" +
      ".rq-m{font-size:var(--fs-caption);color:var(--fk-text-muted)}" +
      ".rq-w{margin-left:auto;font-size:var(--fs-caption);color:var(--fk-text-muted)}" +
      ".rq-by{margin-top:5px;font-size:var(--fs-secondary)}" +
      ".rq-by b{font-weight:650}" +
      ".rq-gone{margin-top:7px;font-size:var(--fs-caption);color:var(--fk-danger)}" +
      ".rq-a{display:flex;gap:8px;margin-top:11px}" +
      ".rq-a button{flex:1;height:40px;border-radius:9px;font:inherit;font-size:var(--fs-secondary);font-weight:650;border:1px solid var(--fk-border);background:var(--fk-bg-card);color:var(--fk-text);cursor:pointer}" +
      ".rq-a .ok{border-color:transparent;background:var(--fk-primary);color:#fff}" +
      ".rq-a button:disabled{opacity:.45;cursor:default}" +
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
      ".db-opts{display:flex;gap:14px;flex-wrap:wrap;margin:2px 2px 10px}" +
      ".db-opts label{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-caption);color:var(--fk-text-muted);font-weight:600;cursor:pointer}" +
      ".db-opts input{width:15px;height:15px;accent-color:var(--fk-primary);cursor:pointer}" +
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
    /* A hold with no expiry date is PERMANENT, not unknown and not lapsed.
       Returning '' here would have printed nothing at all beside a unit that
       is off the market for good. */
    if (iso === null) return 'no expiry';
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
    /* The queue is fetched BEFORE the first paint so the desk never appears
       without requests that are already waiting — a director glancing at it and
       seeing nothing, a second before three cards appear, would trust the
       nothing. It is awaited but not gated on: if it fails the desk still
       renders, just without the queue. */
    await _loadReqs();
    if (!_alive('desk')) return;
    _paint(host);
  };

  /* The tags this project offers, in the order the RPC ranked them. Keyed on
     id like everything else here: a status NAME is a display string and two
     projects can spell the same idea differently. */
  function _tags() { return (DESK.data && DESK.data.statuses) || []; }

  /* THE QUEUE FROM THE PUBLIC LINK.
     Loaded beside the desk rather than inside get_reserve_desk: it changes on
     a different rhythm (a dealer taps at any moment, the unit list does not)
     and a failure to read it must not take the desk down with it. */
  async function _loadReqs() {
    var r;
    try {
      r = await sb.rpc('list_reservation_requests',
        { p_session_token: TOKEN, p_project_id: null });
    } catch (e) { return false; }
    var d = r && r.data;
    if (!d || !d.success) return false;
    DESK.reqs = d.requests || [];
    _badge(DESK.reqs.length);
    return true;
  }

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
    if (c === 'HOLD')   return 'Put on hold';
    if (c === 'BOOKED') return 'Book';
    if (c === 'RESERVED') return 'Reserve';
    /* A tenant-invented tag has no verb anybody can guess, so the button says
       the tag's own name rather than pretending it is a reservation. */
    return 'Mark ' + String(t.name || 'Reserved');
  }

  /* Permanent tags take the unit off the market with no end date. The days
     control is not merely ignored for them — it is hidden, because a number
     sitting next to a permanent hold reads like a promise the system will
     not keep. */
  /* Called on every tag change and once on paint. Also pulls the tag's own
     default duration across, so "Verbally Hold, 1 day" needs no second tap. */
  function _syncNature() {
    var perm = _armedPermanent(), t = _armedTag();
    var lb = _q('#rd-days-lb'), box = _q('#rd-days'), note = _q('#rd-perm-note');
    if (lb)   lb.style.display   = perm ? 'none' : '';
    if (box)  box.style.display  = perm ? 'none' : '';
    if (note) note.style.display = perm ? '' : 'none';
    if (!perm && t && t.days) {
      var n = Number(t.days);
      if (n >= 1 && n <= 90) {
        DESK.days = n;
        var cu = _q('#rd-dcust'); if (cu) cu.value = ([1, 3, 7, 15].indexOf(n) < 0) ? String(n) : '';
        _syncDays();
      }
    }
  }

  function _armedPermanent() {
    var t = _armedTag();
    return !!t && t.nature === 'permanent';
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

        '<div id="rd-reqs" class="rq"></div>' +

        '<div class="rd-bar">' +
          '<div class="rd-lb">Unit</div>' +
          '<input class="rd-in" id="rd-unit" autocomplete="off" autocapitalize="characters" ' +
                 'spellcheck="false" enterkeyhint="next" placeholder="LG-12">' +
          '<div id="rd-hit"></div>' +
          '<div id="rd-sugg" class="rd-sugg" style="display:none"></div>' +

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
                         (t.nature === 'permanent' ? ' perm' : '') +
                         '" data-tag="' + esc(t.id) + '" data-nature="' + esc(t.nature || '') + '"' +
                         (t.days ? ' data-days="' + esc(t.days) + '"' : '') + '>' + esc(t.name) +
                         (t.nature === 'permanent' ? ' \u221e' : '') + '</button>';
                }).join('') +
              '</div>'
            : '') +

          /* Was "Hold for". With On Hold now one of the tags, that label asked
             two different questions with the same word. */
          '<div class="rd-lb" style="margin-top:13px" id="rd-days-lb">Expires in</div>' +
          '<div class="rd-note-perm" id="rd-perm-note" style="display:none">' +
            'This takes the unit off the market with no end date. It will not release itself \u2014 somebody has to undo it here.' +
          '</div>' +
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
    _syncNature();
    _paintReqs();
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
      unit.addEventListener('input', function () {
        _lookup(unit.value);
        _paintSuggest(unit.value);
      });
      unit.addEventListener('keydown', function (e) {
        /* Arrows walk the list, Escape puts it away, and Enter takes whatever
           is lit. With nothing lit Enter does what it always did — moves on to
           the requester — so the old muscle memory of typing a full number and
           pressing Enter is untouched. */
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (_moveSuggest(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
          return;
        }
        if (e.key === 'Escape') { _closeSuggest(); return; }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (SG.at >= 0) { _takeSuggest(SG.at); return; }
        _closeSuggest();
        var r = _q('#rd-req'); if (r) r.focus();
      });
      /* Leaving the box closes the list, but not before a click on it has
         landed — blur fires first, so the close is deferred by a frame. */
      unit.addEventListener('blur', function () { SG.t = setTimeout(_closeSuggest, 160); });
    }

    var sugg = _q('#rd-sugg');
    if (sugg) sugg.addEventListener('mousedown', function (e) {
      /* mousedown, not click: the input blurs on mousedown and the deferred
         close would otherwise race the click. */
      var b = e.target.closest('.rd-sg'); if (!b) return;
      e.preventDefault();
      _takeSuggest(Number(b.getAttribute('data-i')));
    });

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
      _syncNature();
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
  /* TYPE-AHEAD ON THE UNIT BOX.
     Type L and every AVAILABLE unit on a floor beginning with L is offered;
     type G after it and the list narrows to LG; see the one you want and tap
     it instead of finishing the number.

     Only available units are listed, because this box exists to book. A unit
     that is already held is not a suggestion, it is an answer to a different
     question — and typing its number in full still gives the holder card
     underneath, which is where that question is answered.

     Matching ignores separators on both sides, so LG1 finds LG-1 the same way
     the exact lookup already forgave a missing dash. */
  function _norm(x) { return String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  function _suggest(key) {
    var k = _norm(key);
    if (!k) return [];
    var all = (DESK.data && DESK.data.units) || [], out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].s !== 'available') continue;
      if (_norm(all[i].n).indexOf(k) !== 0) continue;
      out.push(all[i]);
    }
    /* Unit-wise, like every list in the report: floor in its configured order,
       then the numeric tail, so LG-2 comes before LG-10 rather than after it. */
    out.sort(function (a, b) {
      var ra = Number(a.r || 999), rb = Number(b.r || 999);
      if (ra !== rb) return ra - rb;
      var na = parseInt(String(a.n).replace(/\D+/g, ''), 10) || 0;
      var nb = parseInt(String(b.n).replace(/\D+/g, ''), 10) || 0;
      if (na !== nb) return na - nb;
      return String(a.n).localeCompare(String(b.n));
    });
    return out;
  }

  /* `t` holds the deferred close armed by blur. Leaving the box schedules a
     close 160ms later so a click on the list can land first — but if anything
     REOPENS the list inside that window, the old timer arrives and shuts a list
     that was never the one it was told to close. Picking a suggestion and
     immediately typing again does exactly that. The timer is cancelled by every
     paint, so only the most recent blur can ever close anything. */
  var SG = { list: [], at: -1, t: null };
  var SG_CAP = 24;

  function _paintSuggest(key) {
    var box = _q('#rd-sugg'); if (!box) return;
    if (SG.t) { clearTimeout(SG.t); SG.t = null; }
    SG.list = _suggest(key); SG.at = -1;
    /* An exact, unambiguous hit has already been answered above the list; a
       one-item list repeating it is noise. */
    if (SG.list.length === 1 && _norm(SG.list[0].n) === _norm(key)) SG.list = [];
    if (!SG.list.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
    var show = SG.list.slice(0, SG_CAP);
    box.innerHTML = show.map(function (u, i) {
      return '<button type="button" class="rd-sg" data-i="' + i + '">' +
        '<span class="n">' + esc(u.n) + '</span>' +
        '<span class="f">' + esc(u.f || '') + '</span>' +
        (Number(u.a) ? '<span class="a">' + esc(Number(u.a).toLocaleString('en-US', { maximumFractionDigits: 2 })) +
                       ' ' + esc(u.u || 'sqft') + '</span>' : '') +
      '</button>';
    }).join('') +
      (SG.list.length > SG_CAP
        ? '<div class="rd-sg-more">' + (SG.list.length - SG_CAP) + ' more \u2014 keep typing</div>'
        : '');
    box.style.display = 'block';
  }

  function _closeSuggest() {
    if (SG.t) { clearTimeout(SG.t); SG.t = null; }
    var box = _q('#rd-sugg'); if (!box) return;
    box.innerHTML = ''; box.style.display = 'none'; SG.list = []; SG.at = -1;
  }

  /* Taking one fills the box with the real unit number and then runs the same
     resolution a typed number runs, so a picked unit and a typed one end up in
     exactly the same state — there is no second path to keep in step. */
  function _takeSuggest(i) {
    var u = SG.list[i]; if (!u) return;
    var el = _q('#rd-unit'); if (el) { el.value = u.n; }
    _closeSuggest();
    _lookup(u.n);
    var r = _q('#rd-req'); if (r) { try { r.focus(); } catch (e) {} }
  }

  function _moveSuggest(step) {
    var box = _q('#rd-sugg'); if (!box || !SG.list.length) return false;
    var n = Math.min(SG.list.length, SG_CAP);
    /* Cycle through -1, 0 … n-1, where -1 means nothing is lit. Done on
       SG.at + 1 so the modulo has a 0-based run to work on; the first version
       wrapped straight back to -1 and the down arrow did nothing at all. */
    SG.at = ((SG.at + 1 + step) + (n + 1)) % (n + 1) - 1;
    var btns = box.querySelectorAll('.rd-sg');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', i === SG.at);
    if (SG.at >= 0 && btns[SG.at]) { try { btns[SG.at].scrollIntoView({ block: 'nearest' }); } catch (e) {} }
    return true;
  }

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
      if (go) go.disabled = true;
      /* Half a unit number is not a mistake, it is the middle of typing one.
         While the list below is offering matches this says nothing at all; the
         red line is kept for a number that genuinely matches nothing. */
      /* No class either: `.rd-hit` draws a bordered box, and an empty one sits
         under the field looking like a control that failed to load. */
      if (_suggest(key).length) { hit.className = ''; hit.innerHTML = ''; return; }
      hit.className = 'rd-hit no';
      hit.innerHTML = 'No available unit starts with <b>' + esc(key) + '</b> in this project.';
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
        /* A permanent hold arrives with exp null. The old test hid the whole
           clause, so the one kind of hold that never lets go was also the one
           that said nothing about how long it lasts. */
        (u.h.exp ? ' · ' + esc(_left(u.h.exp)) + ', to ' + esc(_pkDate(u.h.exp))
                 : ' · no expiry') +
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
      /* null for a permanent tag: the server ignores it either way, but
         sending 7 alongside a permanent hold would put a number in the
         request log that never meant anything. */
      p_expiry_days: _armedPermanent() ? null : DESK.days,
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
    var verb = tg === 'HOLD' ? 'put on hold for' : tg === 'BOOKED' ? 'booked for'
             : tg === 'RESERVED' ? 'reserved for' : (String(d.tag || 'marked') + ' for');
    /* Permanent comes back with no days, and " · nulld" is how a good
       confirmation turns into a bug report. */
    var span = (d.expiry_days == null) ? 'no expiry' : (d.expiry_days + 'd');
    toast(esc(d.unit_no || u.n) + ' ' + verb + ' ' + d.requested_by + ' · ' + span, 'ok');
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
    /* The unit just booked is no longer available, so a list left open would be
       offering it. */
    _closeSuggest();
    /* A queued request for the unit just booked can no longer be approved, and a
       card that still says it can is a button that will fail. */
    _refreshReqs();
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

  /* One card per request, oldest first, with what the dealer chose already
     filled in. Nothing here asks a second question: the duration is theirs,
     the name is theirs, and the only decision left is yes or no. */
  function _paintReqs() {
    var box = _q('#rd-reqs'); if (!box) return;
    var rows = DESK.reqs || [];
    if (!rows.length) { box.innerHTML = ''; return; }

    box.innerHTML =
      '<div class="rq-h">Requests from the link ' +
        '<span class="rq-n">' + rows.length + '</span></div>' +
      rows.map(function (r) {
        var mins = Number(r.minutes_waiting || 0);
        var waited = mins < 1 ? 'just now'
                   : mins < 60 ? mins + ' min ago'
                   : Math.round(mins / 60) + 'h ago';
        /* TWO KINDS OF ASK IN ONE QUEUE. 'new' wants a unit; 'change' wants a
           different tag on one this dealer already holds. Answering them the
           same way would be answering the wrong question. */
        var isChg = r.kind === 'change';
        return '<div class="rq-c' + (isChg ? ' chg' : '') + '" data-r="' + esc(r.id) + '">' +
          '<div class="rq-top">' +
            (isChg ? '<span class="rq-k">Change</span>' : '') +
            '<span class="rq-u">' + esc(r.unit_no) + '</span>' +
            '<span class="rq-m">' + esc(r.floor) +
              (Number(r.area) ? ' \u00b7 ' + esc(_area(r.area, r.area_unit)) : '') + '</span>' +
            '<span class="rq-w">' + esc(waited) + '</span>' +
          '</div>' +
          '<div class="rq-by">' +
            (r.requested_by ? '<b>' + esc(r.requested_by) + '</b>' :
              '<span class="rq-m">no name given</span>') +
            /* A permanent ask has no duration, and " ·  day" is not a
               sentence. It names what was asked for instead. */
            (r.days == null
              ? (r.asked_tag ? ' · ' + esc(r.asked_tag) : '')
              : ' · ' + esc(r.days) + ' day' + (Number(r.days) === 1 ? '' : 's')) +
            ' \u00b7 <span class="rq-m">' + esc(r.ref) + '</span>' +
          '</div>' +
          /* Say it BEFORE the tap. Approving a unit that has gone fails, and a
             button that is going to fail should look like one. */
          (isChg
            ? '<div class="rq-was">Held as <b>' + esc(r.current_tag || 'Reserved') + '</b>' +
              (r.note ? ' · “' + esc(r.note) + '”' : '') + '</div>'
            /* A change request is about a unit that is ALREADY held, so
               still_free is false by definition and the warning below would
               be a lie on every one of them. */
            : (r.still_free ? ''
              : '<div class="rq-gone">This unit is no longer available — approving will not book it.</div>')) +
          /* APPROVE ASKS WHICH. It used to apply whatever tag happened to be
             armed on the desk behind this queue — invisible from here, and
             wrong the moment the last booking was a Pagri and this one is not.
             The question is asked where the decision is made. */
          '<div class="rq-a">' +
            '<button class="ok" data-act="approve"' + ((isChg || r.still_free) ? '' : ' disabled') +
              '>Approve\u2026</button>' +
            '<button data-act="decline">Decline</button>' +
          '</div>' +
          '<div class="rq-pick" hidden>' +
            '<div class="rq-pl">Approve as</div>' +
            '<div class="rq-pc">' +
              _tags().map(function (t) {
                return '<button class="rq-t' + (t.nature === 'permanent' ? ' perm' : '') +
                       '" data-tag="' + esc(t.id) + '" data-nature="' + esc(t.nature || '') + '">' +
                       esc(t.name) + (t.nature === 'permanent' ? ' \u221e' : '') + '</button>';
              }).join('') +
            '</div>' +
            '<button class="rq-cancel" data-act="cancelpick">Cancel</button>' +
          '</div>' +
        '</div>';
      }).join('');

    /* Bound once per painted list, for the same reason Undo is: _paintReqs
       runs after every decision, and stacking a listener each time would make
       the fifth Approve fire five decisions. */
    if (!box.__reqBound) { box.addEventListener('click', _reqClick); box.__reqBound = true; }
  }

  /* Only one card asks at a time: two open pickers is two half-made
     decisions sitting next to each other. */
  function _reqPick(card, on) {
    var box = _q('#rd-reqs'); if (!box) return;
    var all = box.querySelectorAll('.rq-c');
    for (var i = 0; i < all.length; i++) {
      var p = all[i].querySelector('.rq-pick'), a = all[i].querySelector('.rq-a');
      var open = on && all[i] === card;
      if (p) p.hidden = !open;
      if (a) a.hidden = open;
    }
  }

  async function _reqClick(e) {
    /* The tag buttons carry no data-act, so they are read first. */
    var tg = e.target.closest('.rq-t');
    if (tg) {
      var card0 = tg.closest('.rq-c'); if (!card0) return;
      return _reqDecide(card0, card0.getAttribute('data-r'), 'approve',
                        tg.getAttribute('data-tag'), tg);
    }
    var b = e.target.closest('button[data-act]'); if (!b) return;
    if (b.getAttribute('data-act') === 'cancelpick') {
      var c1 = b.closest('.rq-c'); if (c1) _reqPick(c1, false);
      return;
    }
    if (b.getAttribute('data-act') === 'approve') {
      var c2 = b.closest('.rq-c'); if (c2) _reqPick(c2, true);
      return;
    }
    var card = b.closest('.rq-c'); if (!card) return;
    return _reqDecide(card, card.getAttribute('data-r'),
                      b.getAttribute('data-act'), null, b);
  }

  /* One decision, whichever button reached it: Decline arrives with no tag,
     Approve arrives carrying the one that was chosen. */
  async function _reqDecide(card, id, act, tagId, b) {
    if (!card || !id) return;
    if (DESK.reqBusy) return;
    DESK.reqBusy = id;
    var all = card.querySelectorAll('button');
    for (var i = 0; i < all.length; i++) all[i].disabled = true;
    b.textContent = act === 'approve' ? 'Approving\u2026' : 'Declining\u2026';

    var res;
    try {
      res = await sb.rpc('decide_reservation_request',
        { p_session_token: TOKEN, p_request_id: id, p_action: act,
          /* The tag chosen ON THE CARD, because that is where the decision was
             made. The desk's armed chip is the fallback for a client that has
             not been redeployed, and null still means Reserved server-side. */
          p_unit_status_id: tagId || DESK.statusId || null });
    } catch (e2) { res = null; }
    DESK.reqBusy = null;
    var d = res && res.data;

    if (d && d.error === 'session_expired') return sessionGone();
    if (!d) { toast('Could not reach the server.', 'err'); return _refreshReqs(); }

    if (d.success && d.status === 'approved') {
      var bk = d.booking || {};
      /* A permanent tag comes back with no days, and ' · d' is not a
         confirmation anybody can read. */
      var span = (bk.expiry_days == null) ? 'no expiry' : (bk.expiry_days + 'd');
      toast(esc(bk.unit_no || '') + ' · ' + esc(bk.tag || 'reserved') + ' for ' +
            esc(bk.requested_by || '') + ' · ' + span, 'ok');
    } else if (d.success && d.status === 'declined') {
      toast('Declined \u2014 the dealer will see it on the link.', 'ok');
    } else if (d.error === 'already_decided') {
      toast(d.message || 'Already decided.', 'warn');
    } else if (d.error === 'could_not_book') {
      /* The server now says WHY, and whether the request survived. Saying
         "that unit was taken" for a tag the desk may not apply told the
         operator the one thing that was not true. */
      toast(d.message || 'That unit was taken before this was approved.', 'err');
    } else {
      toast((d && d.message) || 'Could not complete that.', 'err');
    }

    /* The whole desk is reloaded, not just the queue: approving books a unit,
       so the board, the index and today's list are all now out of date. */
    await _refreshReqs(true);
  }

  /* ══ THE WATCH ═════════════════════════════════════════════════════════
     A request arrives while somebody is looking at the Daybook, or at nothing
     at all. Two things had to change: the sidebar has to say a request is
     waiting from anywhere in the portal, and the desk has to notice one
     arriving while it is already open.

     One timer does both. It is the only poller in this module and it only
     runs while the tab is VISIBLE — a phone in a pocket must not poll — and
     it catches up the moment the tab comes back rather than waiting out the
     interval.

     Forty-five seconds. A request is answered in minutes, not seconds, so
     anything faster is noise on a mobile connection; anything much slower and
     a dealer is left staring at their phone. */
  var WATCH = { t: null, on: false, stop: false };

  function _badge(n) {
    var b = document.getElementById('nav-badge-requests');
    if (!b) return;
    if (n > 0) {
      b.textContent = n > 99 ? '99+' : String(n);
      b.classList.add('show', 'bdg-amber');
    } else {
      b.classList.remove('show', 'bdg-amber');
      b.textContent = '';
    }
    /* A collapsed group header sums its children, so the count still shows
       when Company is folded away. */
    try { if (typeof _syncGroupBadges === 'function') _syncGroupBadges(); } catch (e) {}
    /* And on a phone the whole rail is behind the burger, so the count is
       set somewhere nobody can see. A dot says there is something in there. */
    var burger = document.querySelector('.sb-toggle');
    if (burger) burger.classList.toggle('has-req', n > 0);
  }

  async function _watchTick() {
    if (WATCH.stop || document.hidden) return;
    var tok; try { tok = TOKEN; } catch (e) { return; }
    if (!tok) return;
    if (!_mayUse()) { WATCH.stop = true; _badge(0); return; }

    var r;
    try {
      r = await sb.rpc('list_reservation_requests',
        { p_session_token: tok, p_project_id: null });   // see _loadReqs
    } catch (e) { return; }          // a blip keeps the last count, never blanks it
    var d = r && r.data;
    if (!d) return;
    if (d.error === 'session_expired') { WATCH.stop = true; return; }
    /* A role that cannot use the desk will answer this way every time. Stop
       rather than ask again for the life of the session. */
    if (d.error === 'role_cannot_sell' || d.error === 'forbidden') {
      WATCH.stop = true; _badge(0); return;
    }
    if (!d.success) return;

    var was = (DESK.reqs || []).map(function (x) { return x.id; }).join(',');
    DESK.reqs = d.requests || [];
    _badge(DESK.reqs.length);

    /* Repaint only if the desk is on screen AND the set actually changed —
       redrawing under a thumb that is reaching for Approve is its own bug. */
    var now = DESK.reqs.map(function (x) { return x.id; }).join(',');
    if (was !== now && _alive('desk') && !DESK.reqBusy && document.getElementById('rd-reqs')) {
      _paintReqs();
    }
  }

  function _startWatch() {
    if (WATCH.on) return;
    WATCH.on = true;
    _watchTick();
    WATCH.t = setInterval(_watchTick, 45000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) _watchTick();      // catch up on return
    });
  }

  /* Started once the shell has a session. Deferred rather than run at load,
     because this file is parsed before login has happened. */
  (function boot() {
    var tries = 0;
    var iv = setInterval(function () {
      var tok; try { tok = TOKEN; } catch (e) { tok = null; }
      if (tok) { clearInterval(iv); _startWatch(); return; }
      if (++tries > 60) clearInterval(iv);      // no session in a minute: give up quietly
    }, 1000);
  })();

  async function _refreshReqs(full) {
    if (full) {
      var okd = await _load(DESK.projectId, true);
      if (!_alive('desk')) return;
      if (okd === 'expired') return sessionGone();
    }
    await _loadReqs();
    if (!_alive('desk')) return;
    if (full) { _paint(document.getElementById('app-body')); }
    else { _paintReqs(); }
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
  /* WHAT THE REPORT CARRIES.
     Movement and Released are the two blocks that answer "what changed"; the
     rest of the page answers "where things stand". Not every reader wants
     both, and a board page is judged on what it does not say as much as on
     what it does, so they are switches rather than fixtures. Default ON,
     because that is what the page did before the switches existed.

     Kept in localStorage: it is a per-reader convenience, not shared state,
     and it must survive a refresh or the setting is a nuisance rather than a
     preference. Every read and write is guarded — a private window, cleared
     site data or a browser set to block storage all throw here rather than
     return empty, and the report must still render. */
  function _pref(key, dflt) {
    try {
      var v = localStorage.getItem('rms.daybook.' + key);
      return v === null ? dflt : v === '1';
    } catch (e) { return dflt; }
  }
  function _setPref(key, on) {
    try { localStorage.setItem('rms.daybook.' + key, on ? '1' : '0'); } catch (e) {}
  }

  var DB = { data: null, date: null,
             showMovement: _pref('movement', true),
             showReleased: _pref('released', true) };

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
        /* Placed with the export buttons, not with the date controls: these
           change what the report SAYS, not which period it covers. */
        '<div class="db-opts">' +
          '<label><input type="checkbox" id="db-mv"' + (DB.showMovement ? ' checked' : '') +
            '> Movement</label>' +
          '<label><input type="checkbox" id="db-rl"' + (DB.showReleased ? ' checked' : '') +
            '> Released</label>' +
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
        (d.ledger && DB.showMovement ? _dbSec('Movement · ' + _periodShort(d), '',
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
          ? _dbTable(['Unit', 'Tag', 'Floor', 'Requested by', 'Buyer', 'Expires', ''],
              resv.map(function (r) {
                return ['<b>' + esc(r.unit_no) + '</b>',
                        '<span class="tg ' + _tagCls(r.tag_code) + '">' + esc(r.tag || 'Reserved') + '</span>',
                        esc(r.floor),
                        esc(r.requested_by) + (r.agent_code ? ' <span class="t">(' + esc(r.agent_code) + ')</span>' : ''),
                        r.client_name ? esc(r.client_name) : '<span class="t">—</span>',
                        esc(_pkDate(r.expiry_date)),
                        /* TODAY'S HOLDS NEEDED THIS TOO. Release only sat on
                           'Held from before', so a hold made TODAY by somebody
                           else had no release anywhere: the desk's own list is
                           filtered to your own bookings, and this section had no
                           button. A standing hold is a standing hold whether it
                           was taken this morning or last week. */
                        (r.res_id && _isLive(r)
                          ? '<button class="db-rel" data-rel="' + esc(r.res_id) +
                            '" data-unit="' + esc(r.unit_no) + '">Release</button>'
                          : '')];
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
            _dbTable(['Unit', 'Tag', 'Floor', 'Size', 'Reserved by', 'Reserved on', 'Expires', 'Left', ''],
              heldEarlier.map(function (r) {
                var L = _holdLeft(r);
                return ['<b>' + esc(r.unit_no) + '</b>',
                        '<span class="tg ' + _tagCls(r.tag_code) + '">' + esc(r.tag || 'Reserved') + '</span>',
                        esc(r.floor),
                        '<span class="n">' + esc(_area(r.area, r.area_unit)) + '</span>',
                        esc(r.requested_by) + (r.agent_code ? ' <span class="t">(' + esc(r.agent_code) + ')</span>' : ''),
                        esc(_pkDate(r.reserved_at)), esc(_pkDate(r.expiry_date)),
                        '<span class="n' + (L.tone ? ' db-' + L.tone : '') + '">' + esc(L.t) + '</span>',
                        /* A hold you can see is a hold you can let go of. Until now
                           this list named a unit on every row and gave you nothing to
                           press, and the only way back was the Reservations screen in
                           RMS — for a hold you had booked yourself. */
                        (r.res_id
                          ? '<button class="db-rel" data-rel="' + esc(r.res_id) +
                            '" data-unit="' + esc(r.unit_no) + '">Release</button>'
                          : '')];
              }))
          : '<div class="rd-empty">Nothing is held from an earlier day.</div>') +

        /* The minus line, named. "− Released 1" is a number nobody can check
           until the unit is on the page beside it. */
        ((d.released || []).length && DB.showReleased ? _dbSec('Released in this period', d.released.length,
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
    /* Repaint from the payload already in hand. Refetching would be a round
       trip to change nothing but which parts of it are drawn. */
    [['#db-mv', 'movement', 'showMovement'], ['#db-rl', 'released', 'showReleased']]
      .forEach(function (spec) {
        var el = _dbq(spec[0]); if (!el) return;
        el.addEventListener('change', function () {
          DB[spec[2]] = !!el.checked;
          _setPref(spec[1], DB[spec[2]]);
          var host = document.getElementById('app-body');
          if (host && DB.data) _dbPaint(host);
        });
      });

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

    /* Delegated on the root: the table is rebuilt on every render and a
       listener per button would stack one for each redraw. */
    var root = _dbRoot();
    if (root) root.addEventListener('click', _dbRelease);
  }

  /* RELEASING IS NOT UNDOING. Undo on the desk is for a booking made a moment
     ago by mistake; this is a standing hold, days old, that somebody has
     decided to let go of before its time. It asks first, because the unit
     goes back on sale the instant it is pressed and the dealer holding it
     will not be told. */
  var DBREL = null;
  async function _dbRelease(e) {
    var b = e.target.closest('.db-rel'); if (!b || DBREL) return;
    var id = b.getAttribute('data-rel'), unit = b.getAttribute('data-unit') || 'this unit';
    if (!id) return;
    if (b.getAttribute('data-armed') !== '1') {
      /* One tap arms, the second releases. A confirm() dialog on a phone is a
         system box nobody reads; the button saying what it is about to do is
         read, because it is the thing under the thumb. */
      var all = _dbRoot().querySelectorAll('.db-rel[data-armed="1"]');
      for (var i = 0; i < all.length; i++) {
        all[i].removeAttribute('data-armed'); all[i].textContent = 'Release';
        all[i].classList.remove('on');
      }
      b.setAttribute('data-armed', '1');
      b.textContent = 'Release ' + unit + '?';
      b.classList.add('on');
      return;
    }
    DBREL = id;
    b.disabled = true; b.textContent = 'Releasing\u2026';
    var res;
    try { res = await sb.rpc('cancel_reservation', { p_session_token: TOKEN, p_reservation_id: id }); }
    catch (e2) { res = null; }
    DBREL = null;
    var d = res && res.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (d && d.success) {
      toast(unit + ' released \u2014 it is back on sale.', 'ok');
      /* The whole book is redrawn, not the row: releasing moves a unit out of
         the held column and into available, and the ledger above has to agree
         with the table below. */
      window.renderDaybook();
      return;
    }
    b.disabled = false; b.removeAttribute('data-armed');
    b.textContent = 'Release'; b.classList.remove('on');
    toast((d && (d.message || d.error)) === 'not_found_or_not_yours'
      ? 'That hold is not yours to release.'
      : ((d && (d.message || d.error)) || 'Could not release that hold.'), 'err');
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

    if (d.ledger && d.ledger.held && DB.showMovement) {
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
    /* PERMANENT FIRST, because every test below it is a number comparison
       and null loses all of them quietly: Number(null) is 0, so a hold that
       never expires would have been drawn in red as "0h" — the most
       urgent thing on the page, and the exact opposite of the truth. */
    if (r.permanent || r.days_left == null) return { t: '\u221e', tone: null };
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
    var showMv = (d.showMovement === undefined) ? DB.showMovement !== false : d.showMovement !== false;
    var showRl = (d.showReleased === undefined) ? DB.showReleased !== false : d.showReleased !== false;
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
    /* The switches reach the PDF because the PDF is the report. A page that
       shows one thing on screen and prints another is the disagreement this
       whole build keeps closing. */
    var lg = showMv ? (d.ledger || {}) : {};
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
                  ed ? _dShort(r.expiry_date) : { v: 'No expiry', cls: 'mut' },
                  days == null ? { v: '\u221e', cls: 'n mut' } : { v: days + 'd', pill: 'amber', cls: 'n' }];
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
         follow-up nobody made and a hold that was cancelled is a decision.

         Switched off, it leaves no trace: no heading, no number and no "none"
         line, because a reader who turned it off did not ask to be told it is
         absent. `skip` is dropped from the section list entirely. */
      { title: 'Released In This Period', unit: 'unit', noun: 'releases',
        skip: !showRl,
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
    secs = secs.filter(function (x) { return !x.skip; });
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
