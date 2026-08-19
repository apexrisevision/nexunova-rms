/* ══ Leads I gave — what happened after I handed them over ═══════════════════
   The director's own words: "I want all the details to keep coming back after I
   assign a lead, so I can go and ask — you have not even opened it, or you
   opened it and never told me what the client said."

   Those two sentences are literally the two middle rows of this screen. A lead
   walks a chain after it leaves his hands, and each broken link has its own
   complaint:

     given → NOT OPENED             "you have not even opened it"
           → opened, NO CONTACT     "you opened it and never rang"
           → contacted, NO UPDATE   "you rang and never said what he told you"
           → updated                here is what the client said

   Nothing new is recorded to make this work — lead_assignments, lead_views and
   lead_activities have held all of it for months, they were never joined. The
   whole file is a reader over get_given_leads.

   Colours: four steps of the validated status palette, and every one of them
   also carries its words and its count, so nobody has to read colour alone.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var NO_PROJECT = '00000000-0000-0000-0000-000000000000';
  var GL = { from: null, to: null, project: null, state: null, data: null, preset: 'month' };

  /* The four links of the chain, worst first. Order is the chain's order, not a
     ranking by size — a filter that reordered them would make the screen
     unreadable from one visit to the next. */
  var STATES = [
    ['not_opened',          'Not opened',        'they have not opened it at all',            1],
    ['opened_no_contact',   'No contact',        'opened it, never rang',                     2],
    ['contacted_no_update', 'No update',         'rang, never said what the client told them', 3],
    ['updated',             'Updated',           'they told you what happened',               4]
  ];
  var LBL = {}, WHY = {}, TONE = {};
  STATES.forEach(function (s) { LBL[s[0]] = s[1]; WHY[s[0]] = s[2]; TONE[s[0]] = s[3]; });

  (function () {
    var st = document.createElement('style');
    /* Validated with the dataviz checker against both surfaces:
         light  #C81E1E #EDA100 #2563EB #15803D  — all checks pass
         dark   #DC4A4A #C98500 #3B82F6 #1BAF7A  — passes; the red/amber pair sits
                in the 6–8 CVD band, which is legal only with secondary encoding,
                and every chip here carries its label and its number. */
    st.textContent =
      ":root{--gl-1:#C81E1E;--gl-2:#EDA100;--gl-3:#2563EB;--gl-4:#15803D}" +
      "html[data-theme='dark']{--gl-1:#DC4A4A;--gl-2:#C98500;--gl-3:#3B82F6;--gl-4:#1BAF7A}" +
      ".gl-wrap{padding:12px 12px 90px}" +
      ".gl-msg{padding:24px;text-align:center;color:var(--fk-text-muted)}" +
      /* the four buckets, as the filter */
      ".gl-bs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}" +
      ".gl-b{flex:1;min-width:132px;text-align:left;border:1px solid var(--fk-border);border-radius:12px;" +
        "background:var(--fk-bg-card);padding:9px 12px 10px;font:inherit;cursor:pointer;" +
        "position:relative;overflow:hidden;transition:.16s}" +
      ".gl-b:hover{border-color:var(--fk-text-muted)}" +
      ".gl-b:before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--t)}" +
      ".gl-b.on{border-color:var(--t);box-shadow:0 0 0 1px var(--t) inset}" +
      ".gl-b .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--t);line-height:1.15}" +
      ".gl-b .k{font-size:var(--fs-secondary);font-weight:600;color:var(--fk-text);margin-top:1px}" +
      ".gl-b .w{font-size:var(--fk-fs-label);color:var(--fk-text-muted);margin-top:2px;line-height:1.35}" +
      /* who is holding them up */
      ".gl-sec{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;" +
        "color:var(--fk-text-muted);margin:16px 2px 8px}" +
      ".gl-m{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--fk-border);" +
        "border-radius:11px;background:var(--fk-bg-card);margin-bottom:7px}" +
      ".gl-m-n{flex:1;min-width:0;font-size:var(--fs-body);font-weight:600;" +
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".gl-m-n span{display:block;font-size:var(--fk-fs-label);font-weight:400;color:var(--fk-text-muted)}" +
      ".gl-nums{display:flex;gap:5px;flex:none}" +
      ".gl-n{min-width:30px;text-align:center;padding:3px 6px;border-radius:7px;font-size:var(--fs-caption);" +
        "font-weight:700;font-variant-numeric:tabular-nums;background:var(--fk-bg-subtle);color:var(--fk-text-muted)}" +
      ".gl-n.hot{background:color-mix(in srgb,var(--t) 15%,var(--fk-bg-card));color:var(--t)}" +
      ".gl-chase{flex:none;height:28px;padding:0 11px;border:1px solid var(--fk-border);border-radius:8px;" +
        "background:var(--fk-bg-card);font:inherit;font-size:12px;font-weight:600;color:var(--fk-primary);cursor:pointer}" +
      ".gl-chase:hover{border-color:var(--fk-primary)}" +
      /* one lead */
      ".gl-l{display:flex;gap:10px;padding:10px 12px;border:1px solid var(--fk-border);border-radius:11px;" +
        "background:var(--fk-bg-card);margin-bottom:7px;cursor:pointer;transition:.16s;" +
        "border-left:3px solid var(--t)}" +
      ".gl-l:hover{border-color:var(--fk-text-muted);border-left-color:var(--t)}" +
      ".gl-l-b{flex:1;min-width:0}" +
      ".gl-l-t{display:flex;align-items:baseline;gap:7px}" +
      ".gl-l-nm{font-size:var(--fs-body);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".gl-tag{flex:none;font-size:var(--fk-fs-label);color:var(--fk-text-muted);background:var(--fk-bg-subtle);" +
        "border-radius:var(--fk-radius-pill);padding:1px 8px;white-space:nowrap}" +
      ".gl-l-s{font-size:var(--fs-caption);color:var(--fk-text-muted);margin-top:2px}" +
      ".gl-l-s b{color:var(--t);font-weight:600}" +
      ".gl-said{margin-top:5px;font-size:var(--fs-caption);color:var(--fk-text);background:var(--fk-bg-subtle);" +
        "border-radius:8px;padding:6px 9px;line-height:1.45}" +
      ".gl-stuck{flex:none;align-self:center;text-align:right;font-size:var(--fs-caption);" +
        "font-variant-numeric:tabular-nums;color:var(--fk-text-muted)}" +
      ".gl-more{width:100%;height:36px;border:1px dashed var(--fk-border);border-radius:10px;" +
        "background:transparent;font:inherit;font-size:var(--fs-secondary);color:var(--fk-text-muted);cursor:pointer}";
    document.head.appendChild(st);
  })();

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.esc ? window.esc(s) : String(s == null ? '' : s); }

  /* Date.now() is already epoch — timezone-free. Karachi has no DST, so a flat
     +5 is the whole conversion; adding getTimezoneOffset() on a PKT machine
     cancels it exactly and hands back yesterday's date after 7pm. */
  function todayPK() { return new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10); }
  function shift(iso, n) {
    var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function monthStart(iso) { return iso.slice(0, 8) + '01'; }
  function dayName(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB',
      { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
  }
  function ago(h) {
    h = Number(h) || 0;
    if (h < 1) return 'just now';
    if (h < 24) return h + 'h';
    var d = Math.floor(h / 24);
    return d + ' day' + (d === 1 ? '' : 's');
  }
  function when(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString('en-GB',
      { day: '2-digit', month: 'short', timeZone: 'Asia/Karachi' });
  }

  var PRESETS = [
    ['7d',    'Last 7 days', function () { var t = todayPK(); return [shift(t, -6), t]; }],
    ['month', 'This month',  function () { var t = todayPK(); return [monthStart(t), t]; }],
    ['30d',   'Last 30 days',function () { var t = todayPK(); return [shift(t, -29), t]; }]
  ];

  // ── entry ────────────────────────────────────────────────────────────────
  window.renderGivenLeads = async function () {
    if (!GL.from) { var t = todayPK(); GL.from = monthStart(t); GL.to = t; GL.preset = 'month'; }
    await _load();
  };

  async function _load() {
    var host = $('app-body'); if (!host) return;
    host.innerHTML = '<div class="gl-wrap"><div class="gl-msg">Loading…</div></div>';
    var r;
    try {
      r = await sb.rpc('get_given_leads', {
        p_session_token: TOKEN, p_from: GL.from, p_to: GL.to,
        p_member_id: null, p_project_id: GL.project, p_state: GL.state });
    } catch (e) {
      host.innerHTML = '<div class="gl-wrap"><div class="gl-msg">Could not reach the server.</div></div>'; return;
    }
    var d = r.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) {
      host.innerHTML = '<div class="gl-wrap"><div class="gl-msg">' +
        (d && d.error === 'forbidden' ? 'This screen is for managers and directors.'
                                      : 'Could not load this.') + '</div></div>';
      return;
    }
    GL.data = d;
    _paint();
  }

  // ── the controls, same shape as the Team report's ────────────────────────
  function _controls() {
    var d = GL.data, projs = d.projects || [];
    var period = PRESETS.map(function (p) {
      return '<button class="dr-p' + (GL.preset === p[0] ? ' on' : '') + '" data-preset="' + p[0] + '">' +
             p[1] + '</button>';
    }).join('') +
      '<span style="width:1px;height:20px;background:var(--fk-border);margin:0 3px"></span>' +
      '<input class="dr-date" type="date" id="gl-from" value="' + GL.from + '" max="' + todayPK() + '">' +
      '<span style="font-size:var(--fs-caption);color:var(--fk-text-muted)">to</span>' +
      '<input class="dr-date" type="date" id="gl-to" value="' + GL.to + '" max="' + todayPK() + '">';

    var project = '<button class="dr-p' + (GL.project ? '' : ' on') + '" data-proj="">All projects</button>' +
      projs.map(function (p) {
        return '<button class="dr-p' + (GL.project === p.id ? ' on' : '') + '" data-proj="' + esc(p.id) + '">' +
               esc(p.tag) + ' <b>' + (p.leads || 0) + '</b></button>';
      }).join('') +
      (d.untagged_leads
        ? '<button class="dr-p' + (GL.project === NO_PROJECT ? ' on' : '') + '" data-proj="' + NO_PROJECT + '">' +
          'No project <b>' + d.untagged_leads + '</b></button>' : '');

    var c = d.counts || {};
    var span = dayName(d.from) + ' – ' + dayName(d.to) + '  ·  you handed over ' +
               (c.total || 0) + ' lead' + ((c.total || 0) === 1 ? '' : 's');
    return '<div class="dr-ctl">' +
      '<div class="dr-ctl-h">Leads I gave</div>' +
      '<div class="dr-r"><span class="dr-lb">Period</span>' + period + '</div>' +
      '<div class="dr-r"><span class="dr-lb">Project</span>' + project + '</div>' +
      '<div class="dr-out">' + esc(span) + '</div></div>';
  }

  function _buckets() {
    var c = GL.data.counts || {};
    return '<div class="gl-bs">' + STATES.map(function (s) {
      return '<button class="gl-b' + (GL.state === s[0] ? ' on' : '') + '" data-state="' + s[0] + '" ' +
             'style="--t:var(--gl-' + s[3] + ')">' +
             '<div class="v">' + (c[s[0]] || 0) + '</div>' +
             '<div class="k">' + s[1] + '</div>' +
             '<div class="w">' + s[2] + '</div></button>';
    }).join('') + '</div>';
  }

  function _members() {
    var ms = GL.data.by_member || [];
    if (!ms.length) return '';
    return '<div class="gl-sec">Who is holding them up</div>' + ms.map(function (m) {
      var behind = (m.not_opened || 0) + (m.opened_no_contact || 0) + (m.contacted_no_update || 0);
      var nums = STATES.map(function (s) {
        var n = m[s[0]] || 0;
        return '<span class="gl-n' + (n && s[0] !== 'updated' ? ' hot' : '') +
               '" style="--t:var(--gl-' + s[3] + ')" title="' + esc(s[1] + ' — ' + s[2]) + '">' + n + '</span>';
      }).join('');
      return '<div class="gl-m">' +
        '<div class="gl-m-n">' + esc(m.name) +
          '<span>' + (m.given || 0) + ' given · ' +
          (behind ? behind + ' still waiting on them' : 'all accounted for') + '</span></div>' +
        '<div class="gl-nums">' + nums + '</div>' +
        (behind ? '<button class="gl-chase" data-chase="' + esc(m.id) + '">Chase</button>' : '') +
        '</div>';
    }).join('');
  }

  var SHOWN = 40;
  function _leads() {
    var ls = GL.data.leads || [];
    if (!ls.length) {
      return '<div class="gl-msg">' +
        (GL.state ? 'Nothing in this one — ' + WHY[GL.state] + ' does not describe any lead here.'
                  : 'You did not hand over any leads in this period.') + '</div>';
    }
    var head = GL.state ? LBL[GL.state] + ' · ' + ls.length
                        : 'Every lead you gave · ' + ls.length;
    var rows = ls.slice(0, SHOWN).map(_row).join('');
    var more = ls.length > SHOWN
      ? '<button class="gl-more" id="gl-more">Show the other ' + (ls.length - SHOWN) + '</button>' : '';
    return '<div class="gl-sec">' + esc(head) + '</div>' + rows + more;
  }

  function _row(l) {
    /* The subtitle is the ANSWER to "where did it stop", written as the sentence
       he would say out loud — not a status word he has to decode. */
    var line;
    if (l.state === 'not_opened')          line = 'never opened it';
    else if (l.state === 'opened_no_contact') line = 'opened ' + when(l.opened_at) + ', never rang';
    else if (l.state === 'contacted_no_update') line = 'contacted ' + when(l.contacted_at) + ', said nothing since';
    else line = 'last update ' + when((l.last_said && l.last_said.at) || l.last_touch);

    var said = (l.last_said && l.last_said.body)
      ? '<div class="gl-said">' + esc(l.last_said.body) + '</div>' : '';

    return '<div class="gl-l" style="--t:var(--gl-' + TONE[l.state] + ')" data-lead="' + esc(l.lead_id) + '">' +
      '<div class="gl-l-b">' +
        '<div class="gl-l-t"><span class="gl-l-nm">' + esc(l.name || 'Unnamed') + '</span>' +
          (l.project ? '<span class="gl-tag">' + esc(l.project) + '</span>' : '') + '</div>' +
        '<div class="gl-l-s">with ' + esc(l.to || '—') + ' since ' + esc(when(l.given_at)) +
          ' · <b>' + esc(line) + '</b></div>' + said +
      '</div>' +
      '<div class="gl-stuck">' + esc(ago(l.stuck_hours)) + '<br><span style="opacity:.7">quiet</span></div>' +
      '</div>';
  }

  function _paint() {
    var host = $('app-body'); if (!host) return;
    host.innerHTML = '<div class="gl-wrap">' + _controls() + _buckets() + _members() + _leads() + '</div>';
    _wire();
  }

  function _wire() {
    var host = $('app-body');
    host.querySelectorAll('[data-preset]').forEach(function (b) {
      b.onclick = function () {
        var p = PRESETS.filter(function (x) { return x[0] === b.dataset.preset; })[0];
        if (!p) return;
        var r = p[2](); GL.preset = p[0]; GL.from = r[0]; GL.to = r[1]; SHOWN = 40; _load();
      };
    });
    ['gl-from', 'gl-to'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.onchange = function () {
        GL.from = $('gl-from').value || GL.from;
        GL.to = $('gl-to').value || GL.to;
        GL.preset = ''; SHOWN = 40; _load();
      };
    });
    host.querySelectorAll('[data-proj]').forEach(function (b) {
      b.onclick = function () { GL.project = b.dataset.proj || null; SHOWN = 40; _load(); };
    });
    // a second tap on the open bucket clears it — a filter you cannot get out of
    // is a trap, and there is no other "all" control on this row
    host.querySelectorAll('[data-state]').forEach(function (b) {
      b.onclick = function () {
        GL.state = (GL.state === b.dataset.state) ? null : b.dataset.state; SHOWN = 40; _load();
      };
    });
    host.querySelectorAll('[data-lead]').forEach(function (b) {
      b.onclick = function () {
        if (typeof gotoLead === 'function') gotoLead(b.dataset.lead);
      };
    });
    host.querySelectorAll('[data-chase]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); _chase(b.dataset.chase); };
    });
    var mo = $('gl-more');
    if (mo) mo.onclick = function () { SHOWN += 60; _paint(); };
  }

  /* One tap to go and ask. The message is built from the same three numbers on
     the row, so what he sends and what he is looking at cannot drift apart. */
  function _chase(id) {
    var m = (GL.data.by_member || []).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!m) return;
    var a = (window.TEAM_DATA || []).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!a || !a.phone) { try { toast('No phone on file for ' + m.name, 'err'); } catch (e) {} return; }
    var bits = [];
    if (m.not_opened)          bits.push(m.not_opened + ' you have not opened yet');
    if (m.opened_no_contact)   bits.push(m.opened_no_contact + ' opened but not contacted');
    if (m.contacted_no_update) bits.push(m.contacted_no_update + ' contacted with no update from you');
    var msg = 'Following up on the ' + (m.given || 0) + ' lead' + ((m.given || 0) === 1 ? '' : 's') +
      ' assigned to you (' + dayName(GL.data.from) + ' to ' + dayName(GL.data.to) + '): ' +
      bits.join(', ') + '. Please update them today.';
    var num = (typeof _waNum === 'function') ? _waNum(a.phone) : String(a.phone).replace(/[^0-9]/g, '');
    window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank');
  }
})();
