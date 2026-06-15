// ══════════════════════════════════════════════════════════════════════════════
// SUBAH KI LIST — Smart Recovery Queue (live, officer-scoped, urgency-ranked)
// Reads get_recovery_queue (computed-on-read; reconciles to get_recovery_position).
// Two tiers on the call list (A time-critical · B collectible) + a collapsed
// "Escalate / Legal" section (C). Quick actions reuse the now-fixed flows so every
// logged contact attributes to the officer and flows into Team Performance.
// ══════════════════════════════════════════════════════════════════════════════

let _sklData    = null;   // full RPC payload
let _sklProject = '';     // active project_name filter ('' = all)
let _sklEscOpen = false;  // Escalate section expanded
let _sklRows    = {};     // sale_id → row (so action handlers avoid onclick injection)

// ── Entry point ────────────────────────────────────────────────────────────────
async function rQueue() {
  const pg = document.getElementById('pg-queue');
  if (!pg) return;
  pg.innerHTML = `<div class="ani">
    ${NX.pageHeader('Morning List',
       NX.button('Refresh', { variant:'ghost', size:'sm', icon:'refresh-cw', onclick:'_sklLoad()' }),
       { icon:'sunrise', tone:'primary', sub:'Who to call today — and why' })}
    <div id="skl-body"><div style="padding:48px;text-align:center;color:var(--fk-text-muted);font-size:13px">Loading your queue…</div></div>
  </div>`;
  await _sklLoad();
}

// ── Data ─────────────────────────────────────────────────────────────────────
async function _sklLoad() {
  const body = document.getElementById('skl-body');
  try {
    const { data, error } = await supabase.rpc('get_recovery_queue', {
      p_company_id: S.cid,
      p_officer_id: null,            // NULL = caller (server forces non-admins to self)
      p_project_id: null,            // all assigned projects; UI filters by name client-side
      p_date:       null,
      p_limit:      200
    });
    if (error) throw error;
    _sklData = data || {};
    // Feed the Inbox/queue badge: "things to act on today" = Tier A.
    window._tierACount = (_sklData.counts && _sklData.counts.tier_a) || 0;
    if (typeof buildSB === 'function') { try { buildSB(); } catch(e){} }
    _sklRender();
  } catch (e) {
    if (body) body.innerHTML =
      NX.banner('Could not load the recovery queue — ' + esc(e.message || 'please try again'), 'danger') +
      '<div style="margin-top:12px">' + NX.button('Retry', { variant:'primary', icon:'refresh-cw', onclick:'_sklLoad()' }) + '</div>';
  }
}

// ── Render ─────────────────────────────────────────────────────────────────────
function _sklRender() {
  const body = document.getElementById('skl-body');
  if (!body || !_sklData) return;

  // Honest empty #1 — no assigned project (the BLOCKER-1 message, reused).
  if (_sklData.no_projects) {
    body.innerHTML = NX.card(NX.empty({
      icon:'user', tone:'warning',
      message:'You are not assigned to any project yet. Ask your admin to assign you to a project to see your recovery queue.'
    }));
    return;
  }

  const all = Array.isArray(_sklData.queue) ? _sklData.queue : [];
  _sklRows = {};
  all.forEach(r => { if (r.sale_id) _sklRows[r.sale_id] = r; });

  // Project list (for the tab filter) — derived from the queue itself.
  const projNames = [...new Set(all.map(r => r.project_name).filter(Boolean))].sort();
  const filtered  = _sklProject ? all.filter(r => r.project_name === _sklProject) : all;

  const callList = filtered.filter(r => r.tier === 'A' || r.tier === 'B');
  const escList  = filtered.filter(r => r.tier === 'C');
  const tierA    = callList.filter(r => r.tier === 'A').length;
  const sumOver  = callList.reduce((a, r) => a + Number(r.overdue_amt || 0), 0);

  // Honest empty #2 — assigned, but nothing due today.
  if (!all.length) {
    body.innerHTML = NX.card(NX.empty({
      icon:'check-circle', tone:'success',
      message:'All clear — no overdue accounts in your projects today.'
    }));
    return;
  }

  let html = '';

  // Project tabs (only when the officer works more than one project).
  if (projNames.length > 1) {
    const tabs = [{ k:'', label:'All projects', count: all.length }].concat(
      projNames.map(p => ({ k:p, label:p, count: all.filter(r => r.project_name === p).length })));
    html += '<div style="margin-bottom:14px">' +
      NX.tabs({ tabs, active:_sklProject, onSelect:"_sklSetProject('%k')", fill:false }) + '</div>';
  }

  // KPI strip with ⓘ formula tips.
  const kpi = (o, tip) =>
    '<div style="position:relative">' + NX.kpi(o) +
    '<span style="position:absolute;top:10px;right:10px">' + NX.infoTip(tip) + '</span></div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-bottom:18px">' +
    kpi({ label:'To call today', value: callList.length, icon:'phone', tone:'' },
        'Tier A (time-critical) + Tier B (collectible overdue). The morning call list.') +
    kpi({ label:'Time-critical',  value: tierA, icon:'siren', tone:'danger' },
        'Tier A: broken promise, promise due today, PDC clearing today, or 90-day cutoff approaching.') +
    kpi({ label:'To escalate',    value: escList.length, icon:'flag', tone:'danger' },
        'Tier C: past the 90-day cutoff (3+ broken promises, active legal case, or low paid %). Legal / field — not the call list.') +
    kpi({ label:'Overdue (call list)', value: fMF(sumOver), icon:'hand-coins', tone:'warning' },
        'Σ overdue amount across the call list (Tier A + B). Overdue = unpaid installments past due date — reconciles to the Recovery Position report.') +
    '</div>';

  // The call list (A then B — already priority-ordered by the RPC).
  if (!callList.length) {
    html += NX.card(NX.empty({ icon:'check-circle', tone:'success',
      message: escList.length ? 'No accounts to call today — only escalations remain (see below).'
                              : 'No accounts to call today in this project.' }));
  } else {
    html += '<div style="display:flex;flex-direction:column;gap:10px">' +
      callList.map(_sklRowCard).join('') + '</div>';
  }

  // Escalate / Legal — Tier C, collapsed.
  if (escList.length) {
    const escSum = escList.reduce((a, r) => a + Number(r.overdue_amt || 0), 0);
    html += '<div style="margin-top:22px">' +
      '<button class="nx-btn nx-btn--secondary" type="button" onclick="_sklToggleEsc()" style="width:100%;justify-content:space-between">' +
        '<span style="display:inline-flex;align-items:center;gap:8px">' + NX.icon('flag', 15) +
          escList.length + ' account' + (escList.length === 1 ? '' : 's') + ' past the 90-day cutoff · ' + fMF(escSum) + '</span>' +
        '<span>' + (_sklEscOpen ? 'Hide' : 'Review for legal / field') + '</span>' +
      '</button>' +
      (_sklEscOpen
        ? '<div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">' + escList.map(_sklRowCard).join('') + '</div>'
        : '') +
    '</div>';
  }

  body.innerHTML = html;
}

// ── One client row (warm hover card) ─────────────────────────────────────────────
function _sklRowCard(r) {
  const tier = r.tier;
  const leadIcon = tier === 'A' ? 'siren' : (tier === 'C' ? 'flag' : 'phone');
  const leadTone = tier === 'B' ? '' : 'danger';

  const reasons = Array.isArray(r.reasons) ? r.reasons : [];
  const chips = reasons.map(rs => {
    const tone = (rs.tone && rs.tone !== 'muted') ? rs.tone : '';
    return NX.badge(rs.label, tone);
  }).join(' ');

  // Meta line — last contact + last promise, honestly stated.
  const meta = [];
  if (r.days_since_contact != null) meta.push('Last contact ' + r.days_since_contact + 'd ago');
  else meta.push('No contact logged');
  if (r.last_promise && r.last_promise.amount != null) {
    const lp = r.last_promise;
    meta.push('Last promise PKR ' + fM(lp.amount) + ' (' + esc(lp.status || '—') + ' ' + fD(lp.date) + ')');
  }
  if (r.last_payment_date) meta.push('Last paid ' + fD(r.last_payment_date));

  const sub = esc([r.unit_no ? 'Unit ' + r.unit_no : '', r.project_name].filter(Boolean).join(' · '));
  const prop = r.propensity ? (' · likelihood ' + (r.propensity.score) + '/100') : '';

  const inner =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">' +
      '<div style="display:flex;gap:12px;min-width:0">' +
        NX.ichip(leadIcon, leadTone, {}) +
        '<div style="min-width:0">' +
          '<div style="font-size:14px;font-weight:600;color:var(--fk-text)">' + esc(r.client_name || '—') + '</div>' +
          '<div style="font-size:12px;color:var(--fk-text-muted);margin-top:2px">' + sub + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="text-align:right;flex:none">' +
        '<div class="num" style="font-size:14px;font-weight:600;color:var(--fk-danger)">' + fMF(r.overdue_amt) + '</div>' +
        '<div class="num" style="font-size:11px;color:var(--fk-text-muted);margin-top:2px">' + (r.oldest_overdue_days || 0) + 'd overdue · ' + (r.paid_pct || 0) + '% paid' + prop + '</div>' +
      '</div>' +
    '</div>' +
    (chips ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">' + chips + '</div>' : '') +
    '<div style="font-size:12px;color:var(--fk-text-muted);margin-top:8px">' + esc(meta.join(' · ')) + '</div>' +
    '<div style="display:flex;gap:8px;margin-top:10px">' +
      NX.button('Call',     { variant:'secondary', size:'sm', icon:'phone',          onclick:"_sklAct('call','"  + r.sale_id + "')" }) +
      NX.button('WhatsApp', { variant:'secondary', size:'sm', icon:'message-circle', onclick:"_sklAct('wa','"    + r.sale_id + "')" }) +
      NX.button('Log',      { variant:'secondary', size:'sm', icon:'file-text',      onclick:"_sklAct('log','"   + r.sale_id + "')" }) +
    '</div>';

  return NX.card(inner, { hover:true, class: tier === 'A' ? 'skl-row-a' : (tier === 'C' ? 'skl-row-c' : '') });
}

// ── Interactions ─────────────────────────────────────────────────────────────
function _sklSetProject(k) { _sklProject = k || ''; _sklRender(); }
function _sklToggleEsc()   { _sklEscOpen = !_sklEscOpen; _sklRender(); }

function _sklAct(kind, saleId) {
  const r = _sklRows[saleId];
  if (!r) return;
  if (kind === 'call') {
    const ph = String(r.phone || '').replace(/[^\d+]/g, '');
    if (!ph) { if (typeof toast === 'function') toast('No phone number on file', 'err'); return; }
    window.location.href = 'tel:' + ph;
  } else if (kind === 'wa') {
    if (!r.phone) { if (typeof toast === 'function') toast('No phone number on file', 'err'); return; }
    const msg = 'Assalam-o-Alaikum ' + (r.client_name || '') + ', this is a reminder regarding your outstanding balance of PKR '
      + fM(r.overdue_amt) + '. Kindly arrange payment at your earliest. JazakAllah.';
    if (typeof openWhatsApp === 'function') openWhatsApp(r.phone, msg);
  } else if (kind === 'log') {
    if (typeof openConModal === 'function') openConModal(r.unit_id || null);
    else nav('contacts');
  }
}
