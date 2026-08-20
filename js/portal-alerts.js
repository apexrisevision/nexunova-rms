/* ══ Alerts — the lead asking for the person who is holding it ═══════════════
   Everyone gets this screen: a rep, a manager, a director. It is their own
   inbox, never anybody else's — get_my_alerts reads the session's own user id
   and nothing else, so there is no scope to widen or leak.

   What lands here, and who raises it:
     · assigned      — assign_leads_bulk, the moment leads change hands
     · not_opened    — cron_lead_alerts, given over N hours ago, still unopened
     · no_contact    — opened over N hours ago, nobody rung
     · stale         — nothing recorded for N days
     · followup_due  — a date they set themselves, arrived or passed

   One alert per kind per day, counting the leads rather than repeating itself:
   a member sitting on 31 unopened leads is told once, not 31 times. That is not
   a saving, it is the difference between an alert and a wall of noise nobody
   reads.

   Tapping an alert opens the lead when it names one, and their Leads list when
   it stands for several — the list already shows all of them.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var AL = { data: null, loading: false };

  /* Four tones from the validated status palette, plus one neutral. Each alert
     also carries its own sentence, so colour is never the only thing saying
     what kind it is. */
  var KIND = {
    assigned:     { t: 4, i: 'inbox',  lb: 'New leads' },
    not_opened:   { t: 1, i: 'eyeOff', lb: 'Not opened' },
    no_contact:   { t: 2, i: 'phone',  lb: 'No contact' },
    stale:        { t: 2, i: 'clock',  lb: 'Gone quiet' },
    followup_due: { t: 1, i: 'clock',  lb: 'Follow-up' }
  };

  var SVG = {
    inbox:  '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>',
    phone:  '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    clock:  '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
  };
  function ic(n) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + (SVG[n] || SVG.clock) + '</svg>';
  }

  (function () {
    var st = document.createElement('style');
    st.textContent =
      ":root{--al-1:#C81E1E;--al-2:#EDA100;--al-4:#15803D}" +
      "html[data-theme='dark']{--al-1:#DC4A4A;--al-2:#C98500;--al-4:#1BAF7A}" +
      ".al-wrap{padding:12px 12px 90px}" +
      ".al-msg{padding:34px 24px;text-align:center;color:var(--fk-text-muted)}" +
      ".al-hd{display:flex;align-items:center;gap:10px;margin:2px 2px 12px}" +
      ".al-hd b{font-size:var(--fs-body);font-weight:700}" +
      ".al-hd span{font-size:var(--fs-caption);color:var(--fk-text-muted)}" +
      ".al-clear{margin-left:auto;height:28px;padding:0 11px;border:1px solid var(--fk-border);" +
        "border-radius:8px;background:var(--fk-bg-card);font:inherit;font-size:12px;font-weight:600;" +
        "color:var(--fk-primary);cursor:pointer}" +
      ".al-clear:hover{border-color:var(--fk-primary)}" +
      ".al-clear[disabled]{opacity:.5;cursor:default}" +
      ".al-a{display:flex;gap:11px;align-items:flex-start;width:100%;text-align:left;padding:11px 13px;" +
        "border:1px solid var(--fk-border);border-radius:12px;background:var(--fk-bg-card);" +
        "margin-bottom:8px;cursor:pointer;font:inherit;transition:.16s;position:relative}" +
      ".al-a:hover{border-color:var(--fk-text-muted)}" +
      ".al-a.seen{opacity:.62}" +
      ".al-a.done{opacity:.5}" +
      ".al-a.done .al-t{text-decoration:line-through;text-decoration-thickness:1px}" +
      ".al-done{flex:none;align-self:center;font-size:var(--fk-fs-label);font-weight:600;" +
        "color:var(--al-4);background:color-mix(in srgb,var(--al-4) 13%,var(--fk-bg-card));" +
        "border-radius:var(--fk-radius-pill);padding:2px 9px;white-space:nowrap}" +
      ".al-left{color:var(--t);font-weight:600}" +
      ".al-ic{flex:none;width:32px;height:32px;border-radius:9px;display:flex;align-items:center;" +
        "justify-content:center;background:color-mix(in srgb,var(--t) 14%,var(--fk-bg-card));color:var(--t)}" +
      ".al-ic svg{width:17px;height:17px}" +
      ".al-b{flex:1;min-width:0}" +
      ".al-t{font-size:var(--fs-body);font-weight:600;color:var(--fk-text)}" +
      ".al-x{font-size:var(--fs-caption);color:var(--fk-text-muted);margin-top:2px;line-height:1.45}" +
      ".al-w{flex:none;font-size:var(--fk-fs-label);color:var(--fk-text-muted);white-space:nowrap;padding-top:3px}" +
      ".al-dot{position:absolute;left:5px;top:50%;width:5px;height:5px;margin-top:-2.5px;" +
        "border-radius:50%;background:var(--t)}" +
      ".al-off{border:1px dashed var(--fk-border);border-radius:12px;padding:18px;text-align:center;" +
        "color:var(--fk-text-muted);font-size:var(--fs-secondary);line-height:1.55}";
    document.head.appendChild(st);
  })();

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.esc ? window.esc(s) : String(s == null ? '' : s); }
  function ago(ts) {
    if (!ts) return '';
    var ms = Date.now() - new Date(ts);
    if (ms < 0) return 'now';
    var m = Math.floor(ms / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    var d = Math.floor(h / 24);
    return d + 'd';
  }

  // ── entry ────────────────────────────────────────────────────────────────
  window.renderAlerts = async function () {
    var host = $('app-body'); if (!host) return;
    host.innerHTML = '<div class="al-wrap"><div class="al-msg">Loading…</div></div>';
    var r;
    try { r = await sb.rpc('get_my_alerts', { p_session_token: TOKEN, p_limit: 60 }); }
    catch (e) {
      host.innerHTML = '<div class="al-wrap"><div class="al-msg">Could not reach the server.</div></div>'; return;
    }
    var d = r.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) {
      host.innerHTML = '<div class="al-wrap"><div class="al-msg">Could not load your alerts.</div></div>'; return;
    }
    AL.data = d;
    _paint();
    /* Reading the screen IS seeing them. Marking happens after the paint so the
       unread dots are visible for the moment the person actually looks at them,
       then the badge clears — rather than clearing before they can see which
       ones were new. */
    if (d.unseen) {
      setTimeout(async function () {
        try { await sb.rpc('mark_alerts_seen', { p_session_token: TOKEN, p_id: null }); } catch (e) {}
        window.AlertBell && window.AlertBell.refresh();
      }, 1200);
    }
  };

  function _paint() {
    var d = AL.data, as = d.alerts || [];
    var h = '<div class="al-wrap">';

    if (!d.enabled) {
      h += '<div class="al-off">Alerts are not switched on for your company yet.<br>' +
           'Your manager can turn them on when you are ready.</div></div>';
      $('app-body').innerHTML = h;
      return;
    }

    h += '<div class="al-hd"><b>Alerts</b>' +
         '<span>' + (d.unseen ? d.unseen + ' need you'
            : (as.filter(function (x) { return x.done; }).length ? 'all dealt with' : 'nothing new')) + '</span>' +
         (as.length ? '<button class="al-clear" id="al-clear">Mark all read</button>' : '') +
         '</div>';

    if (!as.length) {
      h += '<div class="al-msg">Nothing needs you right now.<br>' +
           '<span style="font-size:var(--fs-caption)">You will be told when a lead is handed to you, ' +
           'when one has been sitting unopened, and when a follow-up you set comes due.</span></div>';
    } else {
      h += as.map(_one).join('');
    }
    $('app-body').innerHTML = h + '</div>';
    _wire();
  }

  /* An alert is a snapshot; the person reads it as a live status. IQRA rang two
     clients and the row raised at 00:40 went on telling her all day that she had
     not opened them — an instruction she had already followed and could not make
     go away. The server now recounts, so a finished alert can say it is finished,
     and a half-finished one can say what is left. */
  function _one(a) {
    var k = KIND[a.kind] || { t: 2, i: 'clock', lb: a.kind };
    var done = !!a.done;
    var left = (!done && typeof a.live === 'number' && a.live > 0 && a.live < a.n)
      ? '<span class="al-left"> · ' + a.live + ' left</span>' : '';
    return '<button class="al-a' + (a.seen ? ' seen' : '') + (done ? ' done' : '') + '" ' +
      'style="--t:var(--al-' + k.t + ')" ' +
      'data-a="' + esc(a.id) + '" data-lead="' + esc(a.lead_id || '') + '">' +
      (a.seen || done ? '' : '<span class="al-dot"></span>') +
      '<span class="al-ic">' + ic(k.i) + '</span>' +
      '<span class="al-b"><span class="al-t">' + esc(a.title) + '</span>' +
        (a.body ? '<div class="al-x">' + esc(a.body) + left + '</div>' : '') + '</span>' +
      (done ? '<span class="al-done">Done</span>'
            : '<span class="al-w">' + esc(ago(a.at)) + '</span>') + '</button>';
  }

  function _wire() {
    var host = $('app-body');
    host.querySelectorAll('[data-a]').forEach(function (b) {
      b.onclick = function () {
        var lead = b.dataset.lead;
        // an alert that names one lead opens it; one that stands for several
        // opens the list, which already shows every one of them
        if (lead && typeof gotoLead === 'function') gotoLead(lead);
        else if (typeof setTab === 'function') setTab('leads');
      };
    });
    var c = $('al-clear');
    if (c) c.onclick = async function () {
      c.disabled = true;
      try { await sb.rpc('mark_alerts_seen', { p_session_token: TOKEN, p_id: null }); } catch (e) {}
      window.AlertBell && window.AlertBell.refresh();
      window.renderAlerts();
    };
  }

  /* ── the badge ───────────────────────────────────────────────────────────
     A count nobody can see is not an alert. This keeps the sidebar badge in
     step without polling hard: once at load, and again whenever the app comes
     back to the front. */
  var BELL = { n: 0, timer: null };
  window.AlertBell = {
    refresh: async function () {
      // TOKEN is declared with let, so it is NOT a property of window —
      // `window.TOKEN` is undefined even when the session is live.
      if (typeof TOKEN === 'undefined' || !TOKEN) return;
      try {
        var r = await sb.rpc('get_my_alerts', { p_session_token: TOKEN, p_limit: 1 });
        if (!r.data || !r.data.success) return;
        BELL.n = Number(r.data.unseen) || 0;
        /* The sidebar's own badge convention is a .show class, not an inline
           display — every other badge in this file uses it and _syncGroupBadges
           counts on it. Follow it rather than inventing a second one. */
        var el = $('nav-badge-alerts');
        if (el) {
          if (BELL.n > 0) { el.textContent = BELL.n > 99 ? '99+' : String(BELL.n); el.classList.add('show', 'bdg-danger'); }
          else el.classList.remove('show', 'bdg-danger');
        }
        if (typeof _syncGroupBadges === 'function') _syncGroupBadges();
      } catch (e) {}
    },
    count: function () { return BELL.n; }
  };

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) window.AlertBell.refresh();
  });
})();
