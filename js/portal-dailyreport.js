/* ══ Daily report — what each member did today ═══════════════════════════════
   Director / manager only. Two levels:
     · the team's day — one line per member: who worked, who was silent, how many
       leads they were given, how many people they actually reached
     · one member's day — every call, every WhatsApp, every note they wrote and
       every status they moved, in order, with the lead it belongs to

   Nothing new is recorded to make this work. lead_activities has been capturing
   kind = call / whatsapp / visit / note / stage with the note text in `body` all
   along; there was simply no screen. The whole file is a reader.

   Kept out of sales-portal.html on purpose — that file is 8,000+ lines.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var DR = { day: null, member: null, data: null, entries: null, q: '' };

  (function () {
    var st = document.createElement('style');
    st.textContent =
      ".dr-wrap{padding:12px 12px 90px}" +
      ".dr-load,.dr-msg{padding:24px;text-align:center;color:var(--fk-text-muted)}" +
      /* day picker */
      ".dr-day{display:flex;align-items:center;gap:8px;margin:2px 0 12px}" +
      ".dr-day b{font-size:var(--fs-body);font-weight:700;flex:1;text-align:center}" +
      ".dr-day .sub{display:block;font-size:var(--fs-caption);font-weight:500;color:var(--fk-text-muted)}" +
      ".dr-nav{width:36px;height:36px;border:1px solid var(--fk-border);border-radius:10px;background:var(--fk-bg-card);" +
        "color:var(--fk-text);font:inherit;cursor:pointer;flex:none}" +
      ".dr-nav[disabled]{opacity:.4;cursor:default}" +
      /* the day's shape, at a glance */
      ".dr-tiles{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}" +
      ".dr-tile{flex:1;min-width:104px;border:1px solid var(--fk-border);border-radius:12px;" +
        "background:var(--fk-bg-card);padding:9px 12px 10px}" +
      ".dr-tile .k{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--fk-text-muted)}" +
      ".dr-tile .v{font-size:20px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}" +
      ".dr-tile .s{font-size:11px;color:var(--fk-text-muted);font-variant-numeric:tabular-nums}" +
      /* member rows */
      ".dr-row{width:100%;text-align:left;border:1px solid var(--fk-border);border-radius:12px;background:var(--fk-bg-card);" +
        "padding:11px 13px;margin-bottom:8px;font:inherit;color:inherit;cursor:pointer;display:block}" +
      ".dr-row:hover{border-color:var(--fk-primary)}" +
      ".dr-row.quiet{opacity:.72}" +
      ".dr-top{display:flex;align-items:center;gap:9px}" +
      ".dr-nm{font-weight:700;font-size:var(--fs-body);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".dr-when{font-size:var(--fs-caption);color:var(--fk-text-muted);font-variant-numeric:tabular-nums;flex:none}" +
      ".dr-bits{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}" +
      ".dr-b{font-size:var(--fs-caption);border:1px solid var(--fk-border);border-radius:999px;padding:2px 9px;" +
        "background:var(--fk-bg-subtle);font-variant-numeric:tabular-nums}" +
      ".dr-b b{font-weight:700}" +
      ".dr-b.hot{border-color:transparent;background:var(--fk-primary-chip);color:var(--fk-primary)}" +
      ".dr-b.warn{border-color:transparent;background:var(--fk-warning-surface);color:var(--fk-warning)}" +
      ".dr-b.none{color:var(--fk-text-muted)}" +
      /* one member's timeline */
      ".dr-ent{display:flex;gap:10px;padding:10px 2px;border-bottom:1px solid var(--fk-border)}" +
      ".dr-ent:last-child{border-bottom:0}" +
      ".dr-t{font-size:var(--fs-caption);color:var(--fk-text-muted);font-variant-numeric:tabular-nums;flex:none;width:46px;padding-top:2px}" +
      ".dr-ic{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex:none;font-size:12px}" +
      ".dr-body{flex:1;min-width:0}" +
      ".dr-lead{font-weight:600;font-size:var(--fs-secondary)}" +
      ".dr-txt{font-size:var(--fs-secondary);color:var(--fk-text);margin-top:2px;white-space:pre-wrap;word-break:break-word}" +
      ".dr-kind{font-size:var(--fs-caption);color:var(--fk-text-muted)}" +
      ".dr-sec{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--fk-text-muted);" +
        "margin:16px 2px 8px}";
    document.head.appendChild(st);
  })();

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* Everything here is a working day in Pakistan, so the day the screen asks for
     and the day the server measures have to be the same day. */
  function todayPK() {
    var d = new Date(Date.now() + (new Date().getTimezoneOffset() * 60000) + 5 * 3600000);
    return d.toISOString().slice(0, 10);
  }
  function shiftDay(iso, days) {
    var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function dayLabel(iso) {
    var t = todayPK();
    if (iso === t) return 'Today';
    if (iso === shiftDay(t, -1)) return 'Yesterday';
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US',
      { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
  }
  function clock(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('en-GB',
      { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
  }

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
    if (!DR.day) DR.day = todayPK();
    DR.member = null; DR.entries = null;
    await _load();
  };

  async function _load() {
    var host = $('app-body'); if (!host) return;
    host.innerHTML = '<div class="dr-wrap"><div class="dr-load">Loading the day…</div></div>';
    var r;
    try { r = await sb.rpc('get_daily_report',
      { p_session_token: TOKEN, p_day: DR.day, p_member_id: DR.member }); }
    catch (e) { host.innerHTML = '<div class="dr-wrap"><div class="dr-msg">Could not reach the server.</div></div>'; return; }
    var d = r.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) {
      host.innerHTML = '<div class="dr-wrap"><div class="dr-msg">' +
        (d && d.error === 'forbidden' ? 'This report is for managers and directors.'
                                      : 'Could not load the report.') + '</div></div>';
      return;
    }
    DR.data = d;
    if (DR.member) { DR.entries = d.entries || []; _paintMember(); } else _paintTeam();
  }

  function _dayBar(sub) {
    var atToday = DR.day >= todayPK();
    return '<div class="dr-day">' +
      '<button class="dr-nav" onclick="_drDay(-1)" aria-label="Previous day">‹</button>' +
      '<b>' + esc(dayLabel(DR.day)) + '<span class="sub">' + esc(sub || DR.day) + '</span></b>' +
      '<button class="dr-nav" onclick="_drDay(1)" aria-label="Next day"' + (atToday ? ' disabled' : '') + '>›</button>' +
      '</div>';
  }
  window._drDay = function (n) {
    var next = shiftDay(DR.day, n);
    if (next > todayPK()) return;            // there is no tomorrow to report on
    DR.day = next; _load();
  };

  // ── the team's day ───────────────────────────────────────────────────────
  function _paintTeam() {
    var d = DR.data, t = d.totals || {}, ms = d.members || [];
    var worked = ms.filter(function (m) { return m.entries > 0; });
    var quiet  = ms.filter(function (m) { return !m.entries; });

    var h = '<div class="dr-wrap">' + _dayBar(DR.day) +
      '<div class="dr-tiles">' +
        _tile('Worked', (t.worked || 0) + ' of ' + (t.members || 0), (t.silent || 0) + ' nothing yet') +
        _tile('People reached', t.contacted || 0, (t.calls || 0) + ' calls · ' + (t.whatsapp || 0) + ' WhatsApp') +
        _tile('Status moved', t.status_changes || 0, (t.notes || 0) + ' note' + ((t.notes || 0) === 1 ? '' : 's')) +
        _tile('Leads given', t.given_today || 0, 'handed out today') +
      '</div>';

    if (!ms.length) {
      h += '<div class="dr-msg">Nobody reports to you yet.</div>';
    } else {
      if (worked.length) h += '<div class="dr-sec">Worked today</div>' + worked.map(_row).join('');
      if (quiet.length)  h += '<div class="dr-sec">Nothing recorded yet</div>' + quiet.map(_row).join('');
    }
    $('app-body').innerHTML = h + '</div>';
  }
  function _tile(k, v, s) {
    return '<div class="dr-tile"><div class="k">' + esc(k) + '</div>' +
           '<div class="v">' + esc(String(v)) + '</div>' +
           '<div class="s">' + esc(s || '') + '</div></div>';
  }
  function _row(m) {
    var bits = [];
    if (m.given_today) bits.push(b('hot', m.given_today + ' given' +
      (m.given_by_me && m.given_by_me !== m.given_today ? ' (' + m.given_by_me + ' by you)' : '')));
    if (m.contacted) bits.push(b('', '<b>' + m.contacted + '</b> reached'));
    if (m.calls)     bits.push(b('', m.calls + ' call' + (m.calls === 1 ? '' : 's')));
    if (m.whatsapp)  bits.push(b('', m.whatsapp + ' WhatsApp'));
    if (m.visits)    bits.push(b('', m.visits + ' visit' + (m.visits === 1 ? '' : 's')));
    if (m.notes)     bits.push(b('', m.notes + ' note' + (m.notes === 1 ? '' : 's')));
    if (m.status_changes) bits.push(b('', m.status_changes + ' status'));
    if (m.won)       bits.push(b('hot', m.won + ' won'));
    // the two numbers that are about the day NOT going well
    if (m.never_opened) bits.push(b('warn', m.never_opened + ' never opened'));
    if (m.overdue)      bits.push(b('warn', m.overdue + ' overdue'));
    if (!bits.length)   bits.push(b('none', 'no activity recorded'));

    var when = m.entries
      ? clock(m.first_at) + '–' + clock(m.last_at)
      : (m.open_leads ? m.open_leads + ' open' : '');
    return '<button class="dr-row' + (m.entries ? '' : ' quiet') + '" onclick="_drOpen(\'' + esc(m.id) + '\')">' +
      '<div class="dr-top"><span class="dr-nm">' + esc(m.name) + '</span>' +
      '<span class="dr-when">' + esc(when) + '</span></div>' +
      '<div class="dr-bits">' + bits.join('') + '</div></button>';
  }
  function b(cls, html) { return '<span class="dr-b ' + cls + '">' + html + '</span>'; }

  // ── one member's day ─────────────────────────────────────────────────────
  window._drOpen = function (id) { DR.member = id; DR.entries = null; _load(); };
  window._drBack = function () { DR.member = null; DR.entries = null; _load(); };

  function _paintMember() {
    var d = DR.data, m = (d.members || [])[0] || {}, es = DR.entries || [];
    var h = '<div class="dr-wrap">' +
      '<button class="backbtn" onclick="_drBack()" style="margin-bottom:10px">‹ Daily report</button>' +
      '<div style="font-weight:700;font-size:var(--fs-title)">' + esc(m.name || '') + '</div>' +
      '<div style="font-size:var(--fs-caption);color:var(--fk-text-muted);margin-bottom:10px">' +
        esc(dayLabel(DR.day)) + ' · ' + esc(DR.day) + '</div>' +
      '<div class="dr-tiles">' +
        _tile('Reached', m.contacted || 0, (m.calls || 0) + ' calls · ' + (m.whatsapp || 0) + ' WhatsApp') +
        _tile('Wrote', m.notes || 0, 'note' + ((m.notes || 0) === 1 ? '' : 's')) +
        _tile('Status moved', m.status_changes || 0,
              (m.won || 0) + ' won · ' + (m.lost || 0) + ' lost') +
        _tile('Given today', m.given_today || 0, (m.open_leads || 0) + ' open now') +
      '</div>';

    if (!es.length) {
      h += '<div class="dr-msg">Nothing recorded on this day.</div>';
    } else {
      h += '<div class="dr-sec">Everything they did · ' + es.length + '</div><div class="card">' +
        es.map(_entry).join('') + '</div>';
    }
    $('app-body').innerHTML = h + '</div>';
  }
  function _entry(e) {
    var k = KIND[e.kind] || { i: '•', c: 'var(--fk-bg-subtle)', t: 'var(--fk-text-muted)', lbl: e.kind };
    /* A note's text IS the point of this screen — it is what the rep wrote and
       what the director could never see. A call with no note still matters, so
       the kind is shown either way. */
    var said = e.body ? '<div class="dr-txt">' + esc(e.body) + '</div>' : '';
    var tail = [k.lbl];
    if (e.outcome) tail.push(esc(e.outcome));
    if (e.project) tail.push(esc(e.project));
    return '<div class="dr-ent">' +
      '<span class="dr-t">' + esc(clock(e.at)) + '</span>' +
      '<span class="dr-ic" style="background:' + k.c + ';color:' + k.t + '">' + k.i + '</span>' +
      '<span class="dr-body">' +
        '<span class="dr-lead">' + esc(e.lead || '—') + '</span>' +
        '<div class="dr-kind">' + tail.join(' · ') + '</div>' + said +
      '</span></div>';
  }
})();
