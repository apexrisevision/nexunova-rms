/* ══ Share link — the availability tower, published ══════════════════════════
   Director-only. One row per project: make a link, copy it, see how much it is
   being used, turn it off.

   The token is shown ONCE, at the moment it is created, and is never stored in
   readable form — availability_links keeps only its sha256. So this screen can
   never "show me the link again": it offers a new one instead, which retires the
   old. That is deliberate (20260817g), and the copy in the UI says so plainly
   rather than leaving a director hunting for a reveal button that cannot exist.

   Every call goes through the same three RPCs a human would use; nothing here
   touches availability_links directly.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SL = { links: [], projects: [], fresh: {}, editing: null };  // fresh = tokens minted this session

  (function () {
    var st = document.createElement('style');
    st.textContent =
      ".sl-wrap{padding:12px 12px 90px}" +
      ".sl-h{font-weight:700;margin:4px 2px 4px}" +
      ".sl-sub{font-size:var(--fs-caption);color:var(--fk-text-muted);margin:0 2px 14px;line-height:1.5}" +
      ".sl-load,.sl-msg{padding:24px;text-align:center;color:var(--fk-text-muted)}" +
      ".sl-card{border:1px solid var(--fk-border);border-radius:var(--fk-radius-md);background:var(--fk-bg-card);" +
        "padding:13px 15px;margin-bottom:10px}" +
      ".sl-top{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}" +
      ".sl-nm{font-weight:700}" +
      ".sl-co{font-size:var(--fs-caption);color:var(--fk-text-muted);margin-top:1px}" +
      ".sl-state{margin-left:auto;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;" +
        "border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}" +
      ".sl-on{background:rgba(2,132,199,.14);color:#0284C7}" +
      "html[data-theme=dark] .sl-on{background:rgba(56,189,248,.16);color:#38BDF8}" +
      ".sl-off{background:var(--fk-bg-subtle);color:var(--fk-text-muted)}" +
      ".sl-use{font-size:var(--fs-caption);color:var(--fk-text-muted);margin-top:8px}" +
      ".sl-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px}" +
      ".sl-url{margin-top:11px;border:1px solid var(--fk-border);border-radius:8px;background:var(--fk-bg-subtle);" +
        "padding:9px 11px;font-size:var(--fs-caption);word-break:break-all;font-family:inherit}" +
      ".sl-url b{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;" +
        "color:var(--fk-text-muted);margin-bottom:4px}" +
      ".sl-note{margin-top:9px;font-size:var(--fs-caption);color:var(--fk-text-muted);line-height:1.5}" +
      /* the directors' room, and what guards it */
      ".sl-rep{margin-top:12px;padding-top:11px;border-top:1px solid var(--fk-border)}" +
      ".sl-rep-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
      ".sl-rep-t{font-weight:600;font-size:var(--fs-caption)}" +
      ".sl-lock{display:inline-flex;align-items:center;height:21px;padding:0 9px;border-radius:999px;" +
        "font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}" +
      ".sl-lk-on{background:rgba(22,101,52,.13);color:#166534}" +
      "html[data-theme=dark] .sl-lk-on{background:rgba(134,239,172,.16);color:#86EFAC}" +
      ".sl-lk-off{background:var(--fk-bg-subtle);color:var(--fk-text-muted)}" +
      ".sl-form{margin-top:10px;display:grid;gap:8px;max-width:340px}" +
      ".sl-form label{font-size:11px;letter-spacing:.05em;text-transform:uppercase;" +
        "color:var(--fk-text-muted);display:block;margin-bottom:3px}" +
      ".sl-form input{width:100%;height:38px;padding:0 11px;border:1px solid var(--fk-border);" +
        "border-radius:8px;background:var(--fk-bg-card);color:inherit;font:inherit}" +
      ".sl-form input:focus{outline:2px solid var(--fk-primary);outline-offset:-1px}" +
      ".sl-see{display:flex;align-items:center;gap:7px;font-size:var(--fs-caption);" +
        "color:var(--fk-text-muted);cursor:pointer}" +
      ".sl-see input{width:auto;height:auto}" +
      ".sl-why{font-size:var(--fs-caption);color:var(--fk-text-muted);line-height:1.5;margin-top:2px}";
    document.head.appendChild(st);
  })();

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function urlFor(tok) { return location.origin + '/a/' + tok; }
  function when(s) {
    if (!s) return 'never';
    // the server's clock can be a second ahead of the phone's, which made a link
    // created moments ago read "made -1 days ago"
    var days = Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 86400000));
    return days === 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago';
  }

  window.renderShareLinks = async function () {
    var host = $('app-body'); if (!host) return;
    host.innerHTML = '<div class="sl-wrap"><div class="sl-load">Loading share links…</div></div>';
    var r;
    try { r = await sb.rpc('list_availability_links', { p_session_token: TOKEN }); }
    catch (e) { host.innerHTML = '<div class="sl-msg">Could not reach the server.</div>'; return; }
    var d = r.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) {
      host.innerHTML = '<div class="sl-wrap"><div class="sl-msg">' +
        (d && d.error === 'not_allowed' ? 'Share links are managed by a director.'
                                        : 'Could not load the share links.') + '</div></div>';
      return;
    }
    SL.links = d.links || [];
    SL.projects = d.projects || [];
    _paint();
  };

  function _live(projectId) {
    // the newest link for this project that is still on
    return SL.links.filter(function (l) { return l.project_id === projectId && !l.revoked; })[0] || null;
  }

  function _paint() {
    var rows = SL.projects.map(function (p) {
      var live = _live(p.id), tok = SL.fresh[p.id];
      var h = '<div class="sl-card"><div class="sl-top">' +
        '<div><div class="sl-nm">' + esc(p.name) + '</div>' +
        '<div class="sl-co">' + esc(p.company) + ' · ' + p.available + ' of ' + p.units + ' available</div></div>' +
        '<span class="sl-state ' + (live ? 'sl-on' : 'sl-off') + '">' + (live ? 'Link on' : 'No link') + '</span>' +
        '</div>';

      if (live) {
        h += '<div class="sl-use">Opened <b>' + live.views + '</b> time' + (live.views === 1 ? '' : 's') +
             ' · last ' + when(live.last_viewed_at) + ' · made ' + when(live.created_at) + '</div>';
      }

      // the token is only in hand right after it is minted
      if (tok) {
        h += '<div class="sl-url"><b>Copy this now</b>' + esc(urlFor(tok)) + '</div>' +
             '<div class="sl-note">This is the only time the link can be shown. ' +
             'If it is lost, make a new one — that turns this one off.</div>';
      }

      h += '<div class="sl-act">';
      if (live) {
        if (tok) h += '<button class="btn btn-primary" onclick="_slCopy(\'' + esc(p.id) + '\')">Copy link</button>';
        h += '<button class="btn btn-secondary" onclick="_slNew(\'' + esc(p.id) + '\')">New link</button>' +
             '<button class="btn btn-secondary" onclick="_slRevoke(\'' + esc(live.id) + '\',\'' + esc(p.name) + '\')">Turn off</button>';
      } else {
        h += '<button class="btn btn-primary" onclick="_slNew(\'' + esc(p.id) + '\')">Make a link</button>';
      }
      h += '</div>';

      if (live && !tok) {
        h += '<div class="sl-note">The link itself is not kept — only a fingerprint of it. ' +
             'If you no longer have it, make a new one.</div>';
      }

      h += _report(p);
      return h + '</div>';
    }).join('');

    $('app-body').innerHTML =
      '<div class="sl-wrap">' +
        '<div class="sl-h">Share availability</div>' +
        '<div class="sl-sub">A link anyone can open — no login. It shows units, floors, type, area and ' +
          'the price of what is still for sale. It never shows a buyer, a phone number or any dues, ' +
          'and nothing on it can be booked.</div>' +
        (rows || '<div class="sl-msg">No projects to share.</div>') +
      '</div>';
  }

  /* ── THE DIRECTORS' ROOM, AND THE PASSWORD THAT OPENS IT ─────────────────
     Behind the same link there is a room that reads the building back to the
     directors — who is holding what, what each floor is worth, what lapses
     this week. It has been password-protected since the day it was built, but
     nothing on any screen could set that password, so changing it meant asking
     me. Rashid's answer to that: "field bana do, mai khud set kar lunga."

     WITH NO PASSWORD THE ROOM IS SHUT, not open — get_availability_report
     refuses outright when the hash is null. So "Not set" is a closed door, and
     the wording here says so rather than implying a hole.

     Two boxes, not one. A director who mistypes a password he cannot see has
     locked his own board out of the room, and the only way back is through me
     — which is the thing being fixed. */
  function _report(p) {
    var open = SL.editing === p.id;
    var h = '<div class="sl-rep"><div class="sl-rep-h">' +
      '<span class="sl-rep-t">Directors\' report</span>' +
      '<span class="sl-lock ' + (p.report_locked ? 'sl-lk-on' : 'sl-lk-off') + '">' +
      (p.report_locked ? 'Password set' : 'Not set') + '</span></div>';

    h += '<div class="sl-why">' + (p.report_locked
      ? 'Anyone with the link can open the report by typing this password.' +
        (p.report_set_at ? ' Set ' + when(p.report_set_at) +
          (p.report_set_by ? ' by ' + esc(p.report_set_by) : '') + '.' : '')
      : 'Until a password is set the report stays shut — the link shows only the ' +
        'units, as it always has.') + '</div>';

    if (open) {
      h += '<div class="sl-form">' +
        '<div><label for="sl-p1-' + esc(p.id) + '">New password</label>' +
        '<input id="sl-p1-' + esc(p.id) + '" type="password" autocomplete="new-password" ' +
        'spellcheck="false" placeholder="at least 12 characters"></div>' +
        '<div><label for="sl-p2-' + esc(p.id) + '">Type it again</label>' +
        '<input id="sl-p2-' + esc(p.id) + '" type="password" autocomplete="new-password" ' +
        'spellcheck="false"></div>' +
        '<label class="sl-see"><input type="checkbox" ' +
        'onchange="_slSee(\'' + esc(p.id) + '\',this.checked)"> Show what I typed</label>' +
        '<div class="sl-act">' +
        '<button class="btn btn-primary" onclick="_slPassSave(\'' + esc(p.id) + '\')">Save password</button>' +
        '<button class="btn btn-secondary" onclick="_slPassCancel()">Cancel</button>' +
        '</div></div>';
    } else {
      h += '<div class="sl-act">' +
        '<button class="btn btn-secondary" onclick="_slPass(\'' + esc(p.id) + '\')">' +
        (p.report_locked ? 'Change password' : 'Set a password') + '</button>' +
        (p.report_locked ? '<button class="btn btn-secondary" onclick="_slPassOff(\'' +
          esc(p.id) + '\',\'' + esc(p.name) + '\')">Shut the report</button>' : '') +
        '</div>';
    }
    return h + '</div>';
  }

  window._slPass = function (projectId) {
    SL.editing = projectId;
    _paint();
    var f = $('sl-p1-' + projectId); if (f) f.focus();
  };
  window._slPassCancel = function () { SL.editing = null; _paint(); };

  /* on a phone, a password nobody can see is a password nobody types right */
  window._slSee = function (projectId, on) {
    ['sl-p1-', 'sl-p2-'].forEach(function (k) {
      var el = $(k + projectId); if (el) el.type = on ? 'text' : 'password';
    });
  };

  window._slPassSave = async function (projectId) {
    var a = $('sl-p1-' + projectId), b = $('sl-p2-' + projectId);
    if (!a || !b) return;
    var pw = a.value, again = b.value;
    /* said here as well as by the server, because being told "too short" after
       typing it twice is a worse way to learn the rule */
    if (pw.trim().length < 12) return toast('Use at least 12 characters', 'warn');
    if (pw !== again) return toast('The two do not match', 'warn');
    var r;
    try { r = await sb.rpc('set_availability_report_password', {
      p_session_token: TOKEN, p_project_id: projectId, p_password: pw }); }
    catch (e) { return toast('Could not save the password', 'err'); }
    var d = r.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) return toast(
      d && d.error === 'too_short' ? 'Use at least 12 characters'
      : d && d.error === 'not_allowed' ? 'Only a director can set this'
      : 'Could not save the password', 'err');
    SL.editing = null;
    toast('Password saved', 'ok');
    await renderShareLinks();
  };

  window._slPassOff = async function (projectId, name) {
    if (!confirm('Shut the directors\' report for ' + name + '?\n\n' +
                 'The link keeps working and still shows the units. The report itself ' +
                 'stops opening for everyone until a new password is set.')) return;
    var r;
    try { r = await sb.rpc('set_availability_report_password', {
      p_session_token: TOKEN, p_project_id: projectId, p_password: '' }); }
    catch (e) { return toast('Could not shut the report', 'err'); }
    var d = r.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) return toast('Could not shut the report', 'err');
    toast('The report is shut', 'ok');
    await renderShareLinks();
  };

  window._slNew = async function (projectId) {
    var p = SL.projects.filter(function (x) { return x.id === projectId; })[0];
    if (_live(projectId) && !confirm('Make a new link for ' + (p ? p.name : 'this project') +
        '?\n\nThe link you shared before will stop working.')) return;
    var r;
    try { r = await sb.rpc('create_availability_link', {
      p_session_token: TOKEN, p_project_id: projectId, p_label: p ? p.name : null }); }
    catch (e) { return toast('Could not make the link', 'err'); }
    var d = r.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) return toast(d && d.error === 'not_allowed'
      ? 'Only a director can make a share link' : 'Could not make the link', 'err');
    SL.fresh[projectId] = d.token;
    await renderShareLinks();
    _copy(urlFor(d.token), 'Link made and copied');
  };

  window._slCopy = function (projectId) {
    var tok = SL.fresh[projectId];
    if (!tok) return toast('Make a new link to copy it', 'warn');
    _copy(urlFor(tok), 'Link copied');
  };

  window._slRevoke = async function (linkId, name) {
    if (!confirm('Turn off the link for ' + name + '?\n\nAnyone who has it will see "no longer active".')) return;
    var r;
    try { r = await sb.rpc('revoke_availability_link', { p_session_token: TOKEN, p_token: linkId }); }
    catch (e) { return toast('Could not turn it off', 'err'); }
    var d = r.data;
    if (d && d.error === 'session_expired') return sessionGone();
    if (!d || !d.success) return toast('Could not turn it off', 'err');
    toast('Link turned off', 'ok');
    await renderShareLinks();
  };

  /* Clipboard, with the fallback that matters: the portal runs inside a webview
     on some phones where navigator.clipboard is undefined, and a director who
     taps Copy and gets nothing has lost the only chance to see the token. */
  // The implementation moved to js/portal-copy.js so the Reserve Desk could use
  // the same one. This screen's failure message is kept, because "copy it from
  // the box above" is only true here — the link is on screen.
  function _copy(text, okMsg) {
    _portalCopy(text, okMsg, 'Copy the link from the box above');
  }
})();
