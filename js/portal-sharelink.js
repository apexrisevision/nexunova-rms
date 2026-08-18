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

  var SL = { links: [], projects: [], fresh: {} };   // fresh = tokens minted this session

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
      ".sl-note{margin-top:9px;font-size:var(--fs-caption);color:var(--fk-text-muted);line-height:1.5}";
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
  function _copy(text, okMsg) {
    var done = function () { try { toast(okMsg, 'ok'); } catch (e) {} };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { _copyFallback(text, done); });
    } else { _copyFallback(text, done); }
  }
  function _copyFallback(text, done) {
    var t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
    document.body.appendChild(t);
    t.select(); t.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(t);
    if (ok) done(); else try { toast('Copy the link from the box above', 'warn'); } catch (e) {}
  }
})();
