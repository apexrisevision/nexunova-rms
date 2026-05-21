// ══ PROJECT LEDGER ═══════════════════════════════════════════

function rLedgerProject() {
  _ldgInjectPrintCss();
  const pg = document.getElementById('pg-ledger-project');
  if (!pg) return;
  const ctx = window._ldgCtx || {};
  pg.innerHTML = `<div class="ani">
    ${_ldgNavBar('Project Ledger')}
    ${_ldgFilterRow('ldgpj', '_ldgpjRun')}
    <div id="ldgpj-body">${_ldgEmpty()}</div>
  </div>`;
}

async function _ldgpjRun() {
  const ctx  = window._ldgCtx || {};
  const from = document.getElementById('ldgpj-from')?.value || '';
  const to   = document.getElementById('ldgpj-to')?.value   || '';
  const body = document.getElementById('ldgpj-body');
  if (!body) return;
  if (!ctx.id) { body.innerHTML = _ldgErr('No project selected — go back to Ledgers and choose a project.'); return; }
  if (!_ldgValidateDates(from, to, body)) return;

  body.innerHTML = _ldgLoading();

  try {
    const { data: d, error } = await supabase.rpc('get_project_ledger', {
      p_project_id: ctx.id,
      p_company_id: S.cid,
      p_from_date:  from || null,
      p_to_date:    to   || null,
    });
    if (error) throw error;
    if (!d || d.success === false) throw new Error(d?.error || 'RPC returned no data');
    body.innerHTML = _ldgpjRender(d, ctx, from, to);
  } catch (e) {
    console.error('[ProjectLedger]', e);
    body.innerHTML = _ldgErr(e.message || String(e));
  }
}

function _ldgpjRender(d, ctx, fromDate, toDate) {
  const rows = d.rows || [];
  const ob   = +(d.opening_balance) || 0;
  const info = d.project_info || {};

  const entityName = info.project_name || ctx.name || '—';
  const entityCode = `Units: ${info.total_units || 0}  |  Sold: ${info.total_sold || 0}`;

  const hdr   = _ldgCrystalHdr({ entityName, entityCode, project: entityName, fromDate, toDate });
  const table = _ldgCrystalTable(rows, ob, fromDate, {
    debitLabel:  'Demand',
    creditLabel: 'Collection',
  });

  return `
  ${_ldgPrintBtn()}
  <div class="ldg-rpt-wrap" style="background:#fff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.07)">
    ${hdr}
    ${table}
    <div class="ldg-page-footer" style="padding:6px 12px">Page 1 of 1</div>
  </div>
  <div class="no-print" style="margin-top:8px;text-align:right;font-size:11px;color:var(--t3);font-family:'Inter',sans-serif">
    ${rows.length} transaction(s) in period
  </div>`;
}
