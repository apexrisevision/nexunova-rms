// ══════════════════════════════════════════════════════════════════════════
// NEXUNOVA RMS — REPORT PAGE FACTORY (NXReport)  ·  Phase 3B · 2026-06-12
// ──────────────────────────────────────────────────────────────────────────
// ONE config-driven engine renders all consolidated reports (#2–#8) with the
// identical "Report Document" anatomy — so each report is a CONFIG, never a
// bespoke page. Recovery Position (#1) predates this and stays bespoke, but is
// visually indistinguishable (same letterhead/print standard via NXPrint).
//
// Anatomy (every report):
//   screen : nx-page-header (name + filters + Export Excel·PDF·Print) → summary
//            strip (totals) → nx-table (.num right-aligned, grouped subtotals)
//            → totals row.
//   print  : NXPrint.reportFrame (letterhead, serif title, ruled repeating
//            thead, totals, per-page footer) — the Recovery Position standard.
//   excel  : header block + columns + totals row, real numbers (not strings).
//
// The screen render, Excel and Print all read the SAME transform output
// (window._nxrLast) → screen totals == Excel totals == print totals, always.
//
// CONFIG CONTRACT — see foundation/KIT.md "Reports" and js/pages/reports.js.
//   { id, title, group, description, orientation,
//     filters:[ {kind:'daterange'|'project'|'status'|'clientPicker'|'unitPicker', …} ],
//     fetch:async(f)=>data,                         // f = current filter state
//     transform:(data,f)=>({ columns, rows, totals, summary, groups }) }
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  function esc(s) { return (typeof global.esc === 'function') ? global.esc(s == null ? '' : s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function money(v) { return (typeof global.fM === 'function') ? global.fM(Number(v || 0)) : Number(v || 0).toLocaleString('en-US'); }
  function today() { return (typeof global.td === 'function') ? global.td() : new Date().toISOString().slice(0, 10); }
  function monthStart() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'; }
  function fD(s) { return (typeof global.fD === 'function') ? global.fD(s) : (s || ''); }

  // cell formatter by column descriptor
  function fmtCell(val, col) {
    if (val == null || val === '') return col.blank || '';
    if (col.fmt === 'money') return money(val);
    if (col.fmt === 'date') return fD(val);
    if (col.fmt === 'pct') return Number(val).toFixed(1) + '%';
    if (typeof col.fmt === 'function') return col.fmt(val);
    return esc(val);
  }

  // ── module state ─────────────────────────────────────────────────────────
  let CFG = null;          // active config
  let FILT = {};           // active filter state
  let GEN = 0;             // render generation guard

  // ── public: render(config) ────────────────────────────────────────────────
  function render(config) {
    CFG = config;
    FILT = _defaultFilters(config);
    const pg = document.getElementById('pg-reports');
    if (!pg) return;
    pg.innerHTML = `<div class="nx" style="padding:var(--fk-sp-6);display:flex;flex-direction:column;gap:var(--fk-sp-4)">
      ${_headerHTML(config)}
      <div id="nxr-summary"></div>
      <div id="nxr-body"><div class="nx-card"><div class="nx-empty"><div class="nx-empty-msg">Loading…</div></div></div></div>
    </div>`;
    run();
  }

  function _defaultFilters(config) {
    const f = { from: monthStart(), to: today(), project: '', status: '', clientId: '', unitId: '' };
    (config.filters || []).forEach(fl => {
      if (fl.kind === 'daterange') {
        if (fl.allTime) { f.from = ''; f.to = ''; }
        else if (fl.openStart) { f.from = ''; f.to = today(); }   // all history → as-of today (ledgers: ties to RP)
      }
      if (fl.kind === 'status' && fl.default != null) f.status = fl.default;
    });
    return f;
  }

  // ── header: title + filter controls + export buttons ──────────────────────
  function _headerHTML(config) {
    const actions =
      NX.button('Excel', { variant: 'secondary', size: 'sm', onclick: 'NXReport.excel()' }) +
      NX.button('PDF',   { variant: 'secondary', size: 'sm', onclick: 'NXReport.print()' }) +
      NX.button('Print', { variant: 'primary',   size: 'sm', onclick: 'NXReport.print()' });
    const back = `<a class="nx-btn nx-btn--ghost nx-btn--sm" onclick="closeRptViewer()">‹ All reports</a>`;
    return `<div class="nx-page-header">
      <div>
        <h1 class="nx-page-title">${esc(config.title)}</h1>
        <div class="nx-kpi-label" style="margin-top:4px">${esc(config.description || '')}</div>
      </div>
      <div class="nx-page-actions">${back}${actions}</div>
    </div>
    <div class="nx-card nx-card--compact" id="nxr-filters" style="display:flex;flex-wrap:wrap;gap:var(--fk-sp-3);align-items:center">
      ${(config.filters || []).map(_filterControl).join('')}
    </div>`;
  }

  function _filterControl(fl) {
    const lbl = t => `<span class="nx-kpi-label">${esc(t)}</span>`;
    if (fl.kind === 'daterange') {
      return lbl('From') + `<input type="date" class="nx-input" style="width:auto" id="nxr-from" value="${FILT.from}" onchange="NXReport._set('from',this.value)">` +
        lbl('To') + `<input type="date" class="nx-input" style="width:auto" id="nxr-to" value="${FILT.to}" onchange="NXReport._set('to',this.value)">` +
        `<a class="nx-btn nx-btn--ghost nx-btn--sm" onclick="NXReport._preset('month')">This month</a>` +
        `<a class="nx-btn nx-btn--ghost nx-btn--sm" onclick="NXReport._preset('lastmonth')">Last month</a>` +
        `<a class="nx-btn nx-btn--ghost nx-btn--sm" onclick="NXReport._preset('year')">This year</a>` +
        `<a class="nx-btn nx-btn--ghost nx-btn--sm" onclick="NXReport._preset('all')">All time</a>`;
    }
    if (fl.kind === 'project') {
      const projs = (typeof gprojects === 'function' ? gprojects() : []).slice()
        .sort((a, b) => String(a.name || a.projectName || '').localeCompare(String(b.name || b.projectName || '')));
      const opts = '<option value="">All projects</option>' + projs.map(p => `<option value="${esc(p.id)}">${esc(p.name || p.projectName || 'Project')}</option>`).join('');
      return lbl('Project') + `<select class="nx-select" style="width:auto" onchange="NXReport._set('project',this.value)">${opts}</select>`;
    }
    if (fl.kind === 'status') {
      const opts = (fl.options || []).map(o => `<option value="${esc(o.v)}"${o.v === FILT.status ? ' selected' : ''}>${esc(o.l)}</option>`).join('');
      return lbl(fl.label || 'Status') + `<select class="nx-select" style="width:auto" onchange="NXReport._set('status',this.value)">${opts}</select>`;
    }
    if (fl.kind === 'clientPicker') {
      const cs = (global._clientsCache || []).slice().sort((a, b) => String(a.fullName || a.client_name || '').localeCompare(String(b.fullName || b.client_name || '')));
      const opts = '<option value="">— Select client —</option>' + cs.map(c => `<option value="${esc(c.id)}">${esc((c.client_code ? c.client_code + ' · ' : '') + (c.fullName || c.client_name || ''))}</option>`).join('');
      return lbl('Client') + `<select class="nx-select" style="min-width:260px" onchange="NXReport._set('clientId',this.value)">${opts}</select>`;
    }
    if (fl.kind === 'unitPicker') {
      const us = (global._unitsCache || []).slice().sort((a, b) => String(a.unitNo || a.unit_no || '').localeCompare(String(b.unitNo || b.unit_no || '')));
      const opts = '<option value="">— Select unit —</option>' + us.map(u => `<option value="${esc(u.id)}">${esc((u.unitNo || u.unit_no || '') + (u.floorLabel ? ' · ' + u.floorLabel : ''))}</option>`).join('');
      return lbl('Unit') + `<select class="nx-select" style="min-width:240px" onchange="NXReport._set('unitId',this.value)">${opts}</select>`;
    }
    return '';
  }

  // filter mutators (called from controls)
  function _set(key, val) { FILT[key] = val; run(); }
  function _preset(p) {
    const t = today();
    if (p === 'month') { const d = new Date(); d.setDate(1); FILT.from = d.toISOString().slice(0, 10); FILT.to = t; }
    else if (p === 'lastmonth') { const d = new Date(); d.setDate(1); const e = new Date(d); e.setDate(0); d.setMonth(d.getMonth() - 1); FILT.from = d.toISOString().slice(0, 10); FILT.to = e.toISOString().slice(0, 10); }
    else if (p === 'year') { FILT.from = new Date().getFullYear() + '-01-01'; FILT.to = t; }
    else { FILT.from = ''; FILT.to = ''; }
    const fi = document.getElementById('nxr-from'), ti = document.getElementById('nxr-to');
    if (fi) fi.value = FILT.from; if (ti) ti.value = FILT.to;
    run();
  }

  // ── run: fetch → transform → render ───────────────────────────────────────
  async function run() {
    const gid = ++GEN;
    const body = document.getElementById('nxr-body');
    const summ = document.getElementById('nxr-summary');
    if (!body) return;
    // single-entity reports need a selection first
    const needsClient = (CFG.filters || []).some(f => f.kind === 'clientPicker');
    const needsUnit = (CFG.filters || []).some(f => f.kind === 'unitPicker');
    if ((needsClient && !FILT.clientId) || (needsUnit && !FILT.unitId)) {
      if (summ) summ.innerHTML = '';
      body.innerHTML = `<div class="nx-card">${NX.empty({ icon: 'inbox', message: needsClient ? 'Select a client to view the ledger.' : 'Select a unit to view the statement.' })}</div>`;
      return;
    }
    body.innerHTML = `<div class="nx-card"><div class="nx-empty"><div class="nx-empty-msg">Loading…</div></div></div>`;
    let out;
    try {
      const data = await CFG.fetch(FILT);
      out = CFG.transform(data, FILT) || {};
    } catch (e) {
      console.error('[NXReport]', CFG.id, e);
      if (GEN !== gid) return;
      body.innerHTML = `<div class="nx-card">${NX.banner('Could not load this report. ' + esc(e.message || ''), 'danger')}</div>`;
      return;
    }
    if (GEN !== gid) return;
    out.config = CFG; out.filters = Object.assign({}, FILT);
    global._nxrLast = out;                       // screen == excel == print source
    if (summ) summ.innerHTML = _summaryHTML(out);
    body.innerHTML = `<div class="nx-card nx-card--flush">${_tableHTML(out)}</div>` + _appendixHTML(out);
  }

  // Extra summary blocks (e.g. Collections mode-wise / officer-wise) rendered as
  // their own nx-cards under the main table; included in print + Excel too.
  function _appendixHTML(out) {
    if (!out.appendix || !out.appendix.length) return '';
    return out.appendix.map(ap => {
      const cols = ap.columns || [];
      const head = '<thead><tr>' + cols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('') + '</tr></thead>';
      const rows = (ap.rows || []).map(r => '<tr>' + cols.map(c => `<td class="${c.num ? 'num' : ''}">${fmtCell(r[c.key], c)}</td>`).join('') + '</tr>').join('');
      const foot = ap.totals ? `<tfoot>${_totalsRow(cols, ap.totals, ap.totalsLabel || 'TOTAL')}</tfoot>` : '';
      const note = ap.note ? `<div class="nx-kpi-label" style="text-transform:none;margin-top:var(--fk-sp-2)">${esc(ap.note)}</div>` : '';
      return `<div class="nx-card" style="max-width:560px">
        <div class="nx-kpi-label" style="margin-bottom:var(--fk-sp-3)">${esc(ap.title)}</div>
        <table class="nx-table">${head}<tbody>${rows}</tbody>${foot}</table>${note}</div>`;
    }).join('');
  }

  // ── summary strip ─────────────────────────────────────────────────────────
  function _summaryHTML(out) {
    const all = out.summary || [];
    if (!all.length) return '';
    const period = all.filter(b => !b.cumulative), cum = all.filter(b => b.cumulative);
    let html = '';
    if (period.length) html += `<div style="display:grid;grid-template-columns:repeat(${Math.min(period.length, 6)},1fr);gap:var(--fk-sp-3)">` +
      period.map(b => `<div class="nx-kpi"><div class="nx-kpi-label">${esc(b.label)}</div><div class="nx-kpi-value num">${b.money ? money(b.value) : esc(b.value)}</div></div>`).join('') + `</div>`;
    // Cumulative (not period-filtered) — rendered visually distinct so the two are never confused.
    if (cum.length) html += `<div style="display:flex;gap:var(--fk-sp-3);margin-top:var(--fk-sp-2)">` +
      cum.map(b => `<div class="nx-kpi" style="border-style:dashed;background:var(--fk-bg-subtle)">
        <div class="nx-kpi-label" style="color:var(--fk-text-muted)">${esc(b.label)} · not period-filtered</div>
        <div class="nx-kpi-value num" style="color:var(--fk-text-muted)">${b.money ? money(b.value) : esc(b.value)}</div></div>`).join('') + `</div>`;
    return html;
  }

  // ── on-screen document table (supports grouped sub-totals) ─────────────────
  function _tableHTML(out) {
    const cols = out.columns || [];
    const head = '<thead><tr>' + cols.map(c => `<th class="${c.num ? 'num' : ''}"${c.w ? ` style="width:${c.w}"` : ''}>${esc(c.label)}</th>`).join('') + '</tr></thead>';
    const rowHTML = r => '<tr' + (r._click ? ` style="cursor:pointer" onclick="${r._click}"` : '') + '>' +
      cols.map(c => `<td class="${c.num ? 'num' : ''}">${fmtCell(r[c.key], c)}</td>`).join('') + '</tr>';
    let bodyRows = '';
    if (out.groups && out.groups.length) {
      out.groups.forEach(g => {
        bodyRows += `<tr><td colspan="${cols.length}" style="background:var(--fk-bg-subtle);font-weight:var(--fk-fw-semibold)">${esc(g.label)}</td></tr>`;
        bodyRows += (g.rows || []).map(rowHTML).join('');
        if (g.subtotal) bodyRows += _totalsRow(cols, g.subtotal, 'Subtotal');
      });
    } else {
      const rows = out.rows || [];
      bodyRows = rows.length ? rows.map(rowHTML).join('')
        : `<tr><td colspan="${cols.length}">${NX.empty({ icon: 'inbox', message: 'No records for the selected filters.' })}</td></tr>`;
    }
    const foot = out.totals ? `<tfoot>${_totalsRow(cols, out.totals, out.totalsLabel || 'TOTAL')}</tfoot>` : '';
    return `<table class="nx-table nx-table--flush">${head}<tbody>${bodyRows}</tbody>${foot}</table>`;
  }
  function _totalsRow(cols, totals, label) {
    let labelled = false;
    return '<tr style="font-weight:var(--fk-fw-semibold);border-top:2px solid var(--fk-border)">' + cols.map((c, i) => {
      if (totals[c.key] != null) return `<td class="${c.num ? 'num' : ''}">${fmtCell(totals[c.key], c)}</td>`;
      if (!labelled && i === 0) { labelled = true; return `<td>${esc(label)}</td>`; }
      return '<td></td>';
    }).join('') + '</tr>';
  }

  // ── print (NXPrint.reportFrame — the Recovery Position standard) ───────────
  function print() {
    const out = global._nxrLast; if (!out) { if (global.toast) toast('Run the report first', 'warn'); return; }
    const cols = out.columns || [];
    const thead = '<thead><tr>' + cols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('') + '</tr></thead>';
    const prow = r => '<tr>' + cols.map(c => `<td class="${c.num ? 'num' : ''}">${fmtCell(r[c.key], c)}</td>`).join('') + '</tr>';
    let pbody = '';
    if (out.groups && out.groups.length) {
      out.groups.forEach(g => {
        pbody += `<tr><td colspan="${cols.length}" style="background:#eee;font-weight:700">${esc(g.label)}</td></tr>` + (g.rows || []).map(prow).join('');
        if (g.subtotal) pbody += _printTotals(cols, g.subtotal, 'Subtotal');
      });
    } else pbody = (out.rows || []).map(prow).join('');
    const tfoot = out.totals ? _printTotals(cols, out.totals, out.totalsLabel || 'TOTAL') : '';
    const summary = (out.summary || []).length
      ? '<div style="margin:0 0 8px">' + out.summary.map(b => `<span style="display:inline-block;margin-right:18px;font-size:11px"><b>${esc(b.label)}:</b> ${b.money ? money(b.value) : esc(b.value)}</span>`).join('') + '</div>'
      : '';
    let apHTML = '';
    (out.appendix || []).forEach(ap => {
      const acols = ap.columns || [];
      const ah = '<thead><tr>' + acols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('') + '</tr></thead>';
      const ar = (ap.rows || []).map(r => '<tr>' + acols.map(c => `<td class="${c.num ? 'num' : ''}">${fmtCell(r[c.key], c)}</td>`).join('') + '</tr>').join('');
      const af = ap.totals ? _printTotals(acols, ap.totals, ap.totalsLabel || 'TOTAL') : '';
      apHTML += `<div style="margin-top:10px;font-weight:700;font-size:12px">${esc(ap.title)}</div>` +
        '<table style="max-width:520px">' + ah + '<tbody>' + ar + '</tbody>' + (af ? '<tfoot>' + af + '</tfoot>' : '') + '</table>';
    });
    const bodyHTML = summary + '<table>' + thead + '<tbody>' + pbody + '</tbody>' +
      (tfoot ? '<tfoot>' + tfoot + '</tfoot>' : '') + '</table>' + apHTML;
    const f = out.filters || {};
    NXPrint.emit(NXPrint.reportFrame({
      title: CFG.title,
      company: (global.S && global.S.coName) || 'Nexunova',
      project: _projName(f.project),
      period: (f.from || f.to) ? (fD(f.from) + ' — ' + fD(f.to)) : 'All time',
      orientation: CFG.orientation || 'portrait',
      bodyHTML: bodyHTML
    }), CFG.title);
  }
  function _printTotals(cols, totals, label) {
    let labelled = false;
    return '<tr style="font-weight:700;background:#f1f1f1">' + cols.map((c, i) => {
      if (totals[c.key] != null) return `<td class="${c.num ? 'num' : ''}">${fmtCell(totals[c.key], c)}</td>`;
      if (!labelled && i === 0) { labelled = true; return `<td>${esc(label)}</td>`; }
      return '<td></td>';
    }).join('') + '</tr>';
  }
  function _projName(id) {
    if (!id) return 'All Projects';
    const p = (typeof gproject === 'function' ? gproject(id) : null);
    return (p && (p.name || p.projectName)) || 'Project';
  }

  // ── Excel (real numbers, totals row) ──────────────────────────────────────
  function excel() {
    const out = global._nxrLast; if (!out) { if (global.toast) toast('Run the report first', 'warn'); return; }
    if (!global.XLSX) { if (global.toast) toast('Excel engine not loaded', 'err'); return; }
    const cols = out.columns || [];
    const f = out.filters || {};
    const aoa = [];
    aoa.push([CFG.title]);
    aoa.push(['Company', (global.S && global.S.coName) || 'Nexunova', '', 'Project', _projName(f.project)]);
    aoa.push(['Period', (f.from || f.to) ? (fD(f.from) + ' — ' + fD(f.to)) : 'All time', '', 'Generated', today()]);
    aoa.push([]);
    aoa.push(cols.map(c => c.label));
    const cell = (r, c) => {
      const v = r[c.key];
      if (c.num && v != null && v !== '') { const n = Number(v); return isNaN(n) ? v : n; }   // real number
      if (c.fmt === 'date') return fD(v);
      return v == null ? '' : v;
    };
    const pushRows = rows => (rows || []).forEach(r => aoa.push(cols.map(c => cell(r, c))));
    if (out.groups && out.groups.length) {
      out.groups.forEach(g => { aoa.push([g.label]); pushRows(g.rows); if (g.subtotal) aoa.push(cols.map(c => g.subtotal[c.key] != null ? Number(g.subtotal[c.key]) : '')); });
    } else pushRows(out.rows);
    if (out.totals) aoa.push(cols.map((c, i) => out.totals[c.key] != null ? Number(out.totals[c.key]) : (i === 0 ? (out.totalsLabel || 'TOTAL') : '')));
    (out.appendix || []).forEach(ap => {
      aoa.push([]); aoa.push([ap.title]);
      const acols = ap.columns || [];
      aoa.push(acols.map(c => c.label));
      (ap.rows || []).forEach(r => aoa.push(acols.map(c => { const v = r[c.key]; return (c.num && v != null && v !== '') ? Number(v) : (v == null ? '' : v); })));
      if (ap.totals) aoa.push(acols.map((c, i) => ap.totals[c.key] != null ? Number(ap.totals[c.key]) : (i === 0 ? (ap.totalsLabel || 'TOTAL') : '')));
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, 'Nexunova_' + CFG.id + '_' + today() + '.xlsx');
  }

  global.NXReport = { render, run, print, excel, _set, _preset, get config() { return CFG; }, get filters() { return FILT; } };
})(window);
