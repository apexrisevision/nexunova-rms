/* ══ Team report — what each member did, over any period, per project ════════
   Director / manager only. Three levels:
     · a period — today, a week, a month, or any from–to
     · a project — KBH / FMH / Awami, built from the leads that actually exist
     · a member — their whole history in that window: how many leads they were
       given, what they did with them, day by day, and every note they wrote

   Nothing new is recorded to make this work. lead_activities has been capturing
   kind = call / whatsapp / visit / note / stage with the note text in `body` all
   along; there was simply no screen. The whole file is a reader.

   Kept out of sales-portal.html on purpose — that file is 8,000+ lines.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var NO_PROJECT = '00000000-0000-0000-0000-000000000000';
  var TR = { from: null, to: null, member: null, project: null, preset: 'today', data: null };

  (function () {
    var st = document.createElement('style');
    st.textContent =
      ".dr-wrap{padding:12px 12px 90px}" +
      ".dr-load,.dr-msg{padding:24px;text-align:center;color:var(--fk-text-muted)}" +
      /* period + project controls */
      ".dr-ctl{border:1px solid var(--fk-border);border-radius:12px;background:var(--fk-bg-card);" +
        "overflow:hidden;margin-bottom:14px}" +
      ".dr-ctl-h{padding:9px 13px;border-bottom:1px solid var(--fk-border);background:var(--fk-bg-subtle);" +
        "font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--fk-text)}" +
      ".dr-r{display:flex;gap:7px;flex-wrap:wrap;align-items:center;padding:10px 13px}" +
      ".dr-r+.dr-r{border-top:1px solid var(--fk-border)}" +
      ".dr-lb{width:58px;flex:none;font-size:11px;font-weight:700;letter-spacing:.07em;" +
        "text-transform:uppercase;color:var(--fk-text-muted)}" +
      ".dr-p{height:34px;padding:0 13px;border:1px solid var(--fk-border);border-radius:9px;" +
        "background:var(--fk-bg-subtle);font:inherit;font-size:var(--fs-secondary);font-weight:600;" +
        "color:var(--fk-text);display:inline-flex;align-items:center;gap:7px;cursor:pointer;transition:.16s}" +
      ".dr-p:hover{border-color:var(--fk-primary);background:var(--fk-bg-card)}" +
      ".dr-p.on{background:var(--fk-primary);border-color:var(--fk-primary);color:#fff}" +
      ".dr-p b{font-weight:700;font-size:11px;padding:1px 6px;border-radius:999px;" +
        "background:var(--fk-border);color:var(--fk-text-muted)}" +
      ".dr-p.on b{background:rgba(255,255,255,.24);color:#fff}" +
      ".dr-date{height:34px;border:1px solid var(--fk-border);border-radius:9px;background:var(--fk-bg-subtle);" +
        "color:var(--fk-text);padding:0 9px;font:inherit;font-size:var(--fs-secondary)}" +
      ".dr-date:focus{outline:0;border-color:var(--fk-primary);background:var(--fk-bg-card)}" +
      ".dr-out{padding:9px 13px;border-top:1px solid var(--fk-border);background:var(--fk-bg-subtle);" +
        "font-size:var(--fs-caption);color:var(--fk-text-muted)}" +
      ".dr-out b{color:var(--fk-text);font-weight:700}" +
      /* tiles */
      ".dr-tiles{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}" +
      ".dr-tile{flex:1;min-width:104px;border:1px solid var(--fk-border);border-radius:12px;" +
        "background:var(--fk-bg-card);padding:9px 12px 10px}" +
      ".dr-tile .k{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--fk-text-muted)}" +
      ".dr-tile .v{font-size:20px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}" +
      ".dr-tile .s{font-size:11px;color:var(--fk-text-muted);font-variant-numeric:tabular-nums}" +
      /* member rows */
      ".dr-row{width:100%;text-align:left;border:1px solid var(--fk-border);border-radius:12px;" +
        "background:var(--fk-bg-card);padding:11px 13px;margin-bottom:8px;font:inherit;color:inherit;" +
        "cursor:pointer;display:block}" +
      ".dr-row:hover{border-color:var(--fk-primary)}" +
      ".dr-row.quiet{opacity:.72}" +
      ".dr-top{display:flex;align-items:center;gap:9px}" +
      ".dr-nm{font-weight:700;font-size:var(--fs-body);flex:1;min-width:0;overflow:hidden;" +
        "text-overflow:ellipsis;white-space:nowrap}" +
      ".dr-when{font-size:var(--fs-caption);color:var(--fk-text-muted);font-variant-numeric:tabular-nums;flex:none}" +
      ".dr-bits{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}" +
      ".dr-b{font-size:var(--fs-caption);border:1px solid var(--fk-border);border-radius:999px;padding:2px 9px;" +
        "background:var(--fk-bg-subtle);font-variant-numeric:tabular-nums}" +
      ".dr-b b{font-weight:700}" +
      ".dr-b.hot{border-color:transparent;background:var(--fk-primary-chip);color:var(--fk-primary)}" +
      ".dr-b.warn{border-color:transparent;background:var(--fk-warning-surface);color:var(--fk-warning)}" +
      ".dr-b.none{color:var(--fk-text-muted)}" +
      /* per-day rollup */
      ".dr-days{border:1px solid var(--fk-border);border-radius:12px;background:var(--fk-bg-card);overflow:hidden}" +
      ".dr-d{display:flex;align-items:center;gap:8px;padding:8px 13px;border-bottom:1px solid var(--fk-border);" +
        "font-size:var(--fs-secondary)}" +
      ".dr-d:last-child{border-bottom:0}" +
      ".dr-d .dd{width:96px;flex:none;font-weight:600}" +
      ".dr-d .bar{flex:1;height:6px;border-radius:99px;background:var(--fk-bg-subtle);overflow:hidden}" +
      ".dr-d .bar i{display:block;height:100%;background:var(--fk-primary);border-radius:99px}" +
      ".dr-d .dn{flex:none;font-variant-numeric:tabular-nums;color:var(--fk-text-muted);font-size:var(--fs-caption)}" +
      /* timeline */
      ".dr-ent{display:flex;gap:10px;padding:10px 2px;border-bottom:1px solid var(--fk-border)}" +
      ".dr-ent:last-child{border-bottom:0}" +
      ".dr-t{font-size:var(--fs-caption);color:var(--fk-text-muted);font-variant-numeric:tabular-nums;" +
        "flex:none;width:78px;padding-top:2px}" +
      ".dr-ic{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex:none;font-size:12px}" +
      ".dr-body{flex:1;min-width:0}" +
      ".dr-lead{font-weight:600;font-size:var(--fs-secondary)}" +
      ".dr-txt{font-size:var(--fs-secondary);color:var(--fk-text);margin-top:2px;white-space:pre-wrap;word-break:break-word}" +
      ".dr-kind{font-size:var(--fs-caption);color:var(--fk-text-muted)}" +
      ".dr-sec{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;" +
        "color:var(--fk-text-muted);margin:16px 2px 8px}" +
      "@media (max-width:560px){.dr-lb{width:100%}.dr-t{width:70px}}";
    document.head.appendChild(st);
  })();

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* Everything here is a working day in Pakistan, so the date the screen asks
     for and the day the server measures have to be the same day. */
  function todayPK() {
    var d = new Date(Date.now() + (new Date().getTimezoneOffset() * 60000) + 5 * 3600000);
    return d.toISOString().slice(0, 10);
  }
  function shift(iso, days) {
    var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function monthStart(iso) { return iso.slice(0, 8) + '01'; }
  function prevMonth(iso) {
    var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 10);
  }
  function monthEnd(iso) {
    var d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  }
  function dayName(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB',
      { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
  }
  function stamp(ts, withDate) {
    if (!ts) return '';
    var o = { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' };
    if (withDate) { o.day = '2-digit'; o.month = 'short'; }
    return new Date(ts).toLocaleString('en-GB', o).replace(',', '');
  }

  var PRESETS = [
    ['today',  'Today',      function () { var t = todayPK(); return [t, t]; }],
    ['7d',     'Last 7 days',function () { var t = todayPK(); return [shift(t, -6), t]; }],
    ['month',  'This month', function () { var t = todayPK(); return [monthStart(t), t]; }],
    ['last',   'Last month', function () { var p = prevMonth(todayPK()); return [p, monthEnd(p)]; }]
  ];

  var KIND = {
    call:     { i: '📞', c: 'var(--fk-info-chip)',    t: 'var(--fk-info)',    lbl: 'Called' },
    whatsapp: { i: '💬', c: 'var(--fk-success-chip)', t: 'var(--fk-success)', lbl: 'WhatsApp' },
    visit:    { i: '📍', c: 'var(--fk-primary-chip)', t: 'var(--fk-primary)', lbl: 'Visit' },
    meeting:  { i: '📍', c: 'var(--fk-primary-chip)', t: 'var(--fk-primary)', lbl: 'Meeting' },
    note:     { i: '📝', c: 'var(--fk-warning-chip)', t: 'var(--fk-warning)', lbl: 'Note' },
    stage:    { i: '🏷️', c: 'var(--fk-primary-chip)', t: 'var(--fk-primary)', lbl: 'Status' },
    assigned: { i: '➕', c: 'var(--fk-bg-subtle)',    t: 'var(--fk-text-muted)', lbl: 'Assigned' }
  };

  // ── entry ────────────────────────────────────────────────────────────────
  window.renderDailyReport = async function () {
    if (!TR.from) { var t = todayPK(); TR.from = t; TR.to = t; TR.preset = 'today'; }
    TR.member = null;
    await _load();
  };
  window.renderTeamReport = window.renderDailyReport;      // the honest name

  async function _load() {
    var host = $('app-body'); if (!host) return;
    host.innerHTML = '<div class="dr-wrap"><div class="dr-load">Loading the report…</div></div>';
    var r;
    try {
      r = await sb.rpc('get_activity_report', {
        p_session_token: TOKEN, p_from: TR.from, p_to: TR.to,
        p_member_id: TR.member, p_project_id: TR.project, p_limit: 400 });
    } catch (e) {
      host.innerHTML = '<div class="dr-wrap"><div class="dr-msg">Could not reach the server.</div></div>'; return;
    }
    var d = r.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) {
      host.innerHTML = '<div class="dr-wrap"><div class="dr-msg">' +
        (d && d.error === 'forbidden' ? 'This report is for managers and directors.'
                                      : 'Could not load the report.') + '</div></div>';
      return;
    }
    TR.data = d;
    TR.member ? _paintMember() : _paintTeam();
  }

  // ── the controls: period, then project ───────────────────────────────────
  function _controls() {
    var d = TR.data, projs = d.projects || [];
    var period = PRESETS.map(function (p) {
      return '<button class="dr-p' + (TR.preset === p[0] ? ' on' : '') + '" data-preset="' + p[0] + '">' +
             p[1] + '</button>';
    }).join('') +
      '<span style="width:1px;height:20px;background:var(--fk-border);margin:0 3px"></span>' +
      '<input class="dr-date" type="date" id="tr-from" value="' + TR.from + '" max="' + todayPK() + '">' +
      '<span style="font-size:var(--fs-caption);color:var(--fk-text-muted)">to</span>' +
      '<input class="dr-date" type="date" id="tr-to" value="' + TR.to + '" max="' + todayPK() + '">';

    /* Tabs are built from the leads that exist, not from a hardcoded list — so
       an Awami tab appears the day the team has an Awami lead, and leads nobody
       tagged to a project get their own tab instead of hiding between them. */
    var project = '<button class="dr-p' + (TR.project ? '' : ' on') + '" data-proj="">All projects</button>' +
      projs.map(function (p) {
        return '<button class="dr-p' + (TR.project === p.id ? ' on' : '') + '" data-proj="' + esc(p.id) + '">' +
               esc(p.tag) + ' <b>' + (p.leads || 0) + '</b></button>';
      }).join('') +
      (d.untagged_leads
        ? '<button class="dr-p' + (TR.project === NO_PROJECT ? ' on' : '') + '" data-proj="' + NO_PROJECT + '">' +
          'No project <b>' + d.untagged_leads + '</b></button>' : '');

    var span = d.days === 1 ? dayName(d.from)
      : dayName(d.from) + ' – ' + dayName(d.to) + '  ·  ' + d.days + ' days';
    return '<div class="dr-ctl">' +
      '<div class="dr-ctl-h">Report</div>' +
      '<div class="dr-r"><span class="dr-lb">Period</span>' + period + '</div>' +
      '<div class="dr-r"><span class="dr-lb">Project</span>' + project + '</div>' +
      '<div class="dr-out" id="tr-out">' + esc(span) + '</div></div>';
  }

  function _bindControls() {
    var box = document.querySelector('.dr-ctl'); if (!box) return;
    box.onclick = function (e) {
      var b = e.target.closest('.dr-p'); if (!b) return;
      if (b.dataset.preset) {
        var p = PRESETS.filter(function (x) { return x[0] === b.dataset.preset; })[0];
        if (!p) return;
        var r = p[2](); TR.preset = p[0]; TR.from = r[0]; TR.to = r[1];
      } else {
        TR.project = b.dataset.proj || null;
      }
      TR.member = null; _load();
    };
    ['tr-from', 'tr-to'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.onchange = function () {
        var f = $('tr-from').value, t = $('tr-to').value;
        if (!f || !t) return;
        if (f > t) { var s = f; f = t; t = s; }
        TR.from = f; TR.to = t; TR.preset = null; TR.member = null; _load();
      };
    });
  }

  // ── the team over the window ─────────────────────────────────────────────
  function _paintTeam() {
    var d = TR.data, t = d.totals || {}, ms = d.members || [];
    var worked = ms.filter(function (m) { return m.entries > 0; });
    var quiet  = ms.filter(function (m) { return !m.entries; });

    var h = '<div class="dr-wrap">' + _controls() +
      '<div class="dr-tiles">' +
        _tile('Worked', (t.worked || 0) + ' of ' + (t.members || 0), (t.silent || 0) + ' did nothing') +
        _tile('Leads given', t.given || 0, (t.won_of_given || 0) + ' won so far') +
        _tile('People reached', t.contacted || 0, (t.calls || 0) + ' calls · ' + (t.whatsapp || 0) + ' WhatsApp') +
        _tile('Status moved', t.status_changes || 0, (t.notes || 0) + ' note' + ((t.notes || 0) === 1 ? '' : 's')) +
      '</div>';

    if (!ms.length) h += '<div class="dr-msg">Nobody reports to you yet.</div>';
    else {
      if (worked.length) h += '<div class="dr-sec">Worked in this period · ' + worked.length + '</div>' + worked.map(_row).join('');
      if (quiet.length)  h += '<div class="dr-sec">Nothing recorded · ' + quiet.length + '</div>' + quiet.map(_row).join('');
    }
    $('app-body').innerHTML = h + '</div>';
    _bindControls();
  }
  function _tile(k, v, s) {
    return '<div class="dr-tile"><div class="k">' + esc(k) + '</div>' +
           '<div class="v">' + esc(String(v)) + '</div>' +
           '<div class="s">' + esc(s || '') + '</div></div>';
  }
  function _row(m) {
    var bits = [];
    if (m.given) bits.push(b('hot', '<b>' + m.given + '</b> given' +
      (m.given_by_me && m.given_by_me !== m.given ? ' (' + m.given_by_me + ' by you)' : '')));
    if (m.contacted) bits.push(b('', '<b>' + m.contacted + '</b> reached'));
    if (m.calls)     bits.push(b('', m.calls + ' call' + (m.calls === 1 ? '' : 's')));
    if (m.whatsapp)  bits.push(b('', m.whatsapp + ' WhatsApp'));
    if (m.visits)    bits.push(b('', m.visits + ' visit' + (m.visits === 1 ? '' : 's')));
    if (m.notes)     bits.push(b('', m.notes + ' note' + (m.notes === 1 ? '' : 's')));
    if (m.status_changes) bits.push(b('', m.status_changes + ' status'));
    if (m.won_of_given)   bits.push(b('hot', m.won_of_given + ' won · ' + m.conversion + '%'));
    // the numbers that say the period did NOT go well
    if (m.never_opened_of_given) bits.push(b('warn', m.never_opened_of_given + ' never opened'));
    if (m.overdue)               bits.push(b('warn', m.overdue + ' overdue'));
    if (!bits.length)            bits.push(b('none', 'no activity recorded'));

    var when = m.entries
      ? m.active_days + ' active day' + (m.active_days === 1 ? '' : 's')
      : (m.open_leads ? m.open_leads + ' open' : '');
    return '<button class="dr-row' + (m.entries ? '' : ' quiet') + '" data-m="' + esc(m.id) + '" ' +
      'onclick="_drOpen(\'' + esc(m.id) + '\')">' +
      '<div class="dr-top"><span class="dr-nm">' + esc(m.name) + '</span>' +
      '<span class="dr-when">' + esc(when) + '</span></div>' +
      '<div class="dr-bits">' + bits.join('') + '</div></button>';
  }
  function b(cls, html) { return '<span class="dr-b ' + cls + '">' + html + '</span>'; }

  // ── one member's whole period ────────────────────────────────────────────
  window._drOpen = function (id) { TR.member = id; _load(); };
  window._drBack = function () { TR.member = null; _load(); };

  function _paintMember() {
    var d = TR.data, m = (d.members || [])[0] || {}, days = d.by_day || [], es = d.entries || [];
    var peak = days.reduce(function (n, x) { return Math.max(n, x.entries || 0); }, 0) || 1;
    var span = d.days === 1 ? dayName(d.from) : dayName(d.from) + ' – ' + dayName(d.to);

    var h = '<div class="dr-wrap">' +
      '<button class="backbtn" onclick="_drBack()" style="margin-bottom:10px">‹ Team report</button>' +
      '<div style="font-weight:700;font-size:var(--fs-title)">' + esc(m.name || '') + '</div>' +
      '<div style="font-size:var(--fs-caption);color:var(--fk-text-muted);margin-bottom:12px">' +
        esc(span) + ' · ' + d.days + ' day' + (d.days === 1 ? '' : 's') +
        (TR.project ? ' · ' + esc(_projName()) : '') + '</div>' +

      '<div class="dr-tiles">' +
        _tile('Leads given', m.given || 0, (m.given_by_me || 0) + ' by you') +
        _tile('Reached', m.contacted || 0, (m.calls || 0) + ' calls · ' + (m.whatsapp || 0) + ' WhatsApp') +
        _tile('Won', m.won_of_given || 0, (m.conversion || 0) + '% of what they were given') +
        _tile('Active days', m.active_days || 0, 'of ' + d.days) +
      '</div>' +
      '<div class="dr-tiles">' +
        _tile('Wrote', m.notes || 0, 'note' + ((m.notes || 0) === 1 ? '' : 's')) +
        _tile('Status moved', m.status_changes || 0, (m.lost_of_given || 0) + ' lost') +
        _tile('Never opened', m.never_opened_of_given || 0, 'of what they were given') +
        _tile('Open now', m.open_leads || 0, (m.overdue || 0) + ' overdue') +
      '</div>';

    if (days.length > 1) {
      h += '<div class="dr-sec">Day by day</div><div class="dr-days">' +
        days.map(function (x) {
          return '<div class="dr-d"><span class="dd">' + esc(dayName(x.day)) + '</span>' +
            '<span class="bar"><i style="width:' + Math.round((x.entries / peak) * 100) + '%"></i></span>' +
            '<span class="dn">' + x.contacted + ' reached · ' + x.entries + '</span></div>';
        }).join('') + '</div>';
    }

    if (!es.length) {
      h += '<div class="dr-msg">Nothing recorded in this period.</div>';
    } else {
      h += '<div class="dr-sec">Everything they did · ' + (d.entries_total || es.length) +
           (d.entries_capped ? ' (showing the latest ' + es.length + ')' : '') + '</div>' +
           '<div class="card">' + es.map(function (e) { return _entry(e, d.days > 1); }).join('') + '</div>';
    }
    $('app-body').innerHTML = h + '</div>';
  }
  function _projName() {
    if (TR.project === NO_PROJECT) return 'No project';
    var p = (TR.data.projects || []).filter(function (x) { return x.id === TR.project; })[0];
    return p ? p.tag : '';
  }
  function _entry(e, withDate) {
    var k = KIND[e.kind] || { i: '•', c: 'var(--fk-bg-subtle)', t: 'var(--fk-text-muted)', lbl: e.kind };
    /* A note's text IS the point of this screen — it is what the rep wrote and
       what the director could never see. A call with no note still matters, so
       the kind is shown either way. */
    var said = e.body ? '<div class="dr-txt">' + esc(e.body) + '</div>' : '';
    var tail = [k.lbl];
    if (e.outcome) tail.push(esc(e.outcome));
    if (e.project) tail.push(esc(e.project));
    return '<div class="dr-ent">' +
      '<span class="dr-t">' + esc(stamp(e.at, withDate)) + '</span>' +
      '<span class="dr-ic" style="background:' + k.c + ';color:' + k.t + '">' + k.i + '</span>' +
      '<span class="dr-body">' +
        '<span class="dr-lead">' + esc(e.lead || '—') + '</span>' +
        '<div class="dr-kind">' + tail.join(' · ') + '</div>' + said +
      '</span></div>';
  }
})();
