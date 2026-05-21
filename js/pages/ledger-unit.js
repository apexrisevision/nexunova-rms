// ══ UNIT LEDGER ══════════════════════════════════════════════

function rLedgerUnit() {
  _ldgInjectPrintCss();
  const pg = document.getElementById('pg-ledger-unit');
  if (!pg) return;
  const ctx = window._ldgCtx || {};
  pg.innerHTML = `<div class="ani">
    ${_ldgNavBar('Unit Ledger')}
    ${_ldgFilterRow('ldgul', '_ldgulRun')}
    <div id="ldgul-body">${_ldgEmpty()}</div>
  </div>`;
}

async function _ldgulRun() {
  const ctx  = window._ldgCtx || {};
  const from = document.getElementById('ldgul-from')?.value || '';
  const to   = document.getElementById('ldgul-to')?.value   || '';
  const body = document.getElementById('ldgul-body');
  if (!body) return;
  if (!ctx.id) { body.innerHTML = _ldgErr('No unit selected — go back to Ledgers and choose a unit.'); return; }
  if (!_ldgValidateDates(from, to, body)) return;

  body.innerHTML = _ldgLoading();

  try {
    const { data: d, error } = await supabase.rpc('get_unit_ledger', {
      p_unit_id:    ctx.id,
      p_company_id: S.cid,
      p_from_date:  from || null,
      p_to_date:    to   || null,
    });
    if (error) throw error;
    if (!d || d.success === false) throw new Error(d?.error || 'RPC returned no data');
    body.innerHTML = _ldgulRender(d, ctx, from, to);
  } catch (e) {
    console.error('[UnitLedger]', e);
    body.innerHTML = _ldgErr(e.message || String(e));
  }
}

function _ldgulRender(d, ctx, fromDate, toDate) {
  const rows = d.rows || [];
  const ob   = +(d.opening_balance) || 0;
  const info = d.unit_info || {};

  const entityName = info.unit_no     || ctx.name || '—';
  const entityCode = info.unit_code   || ctx.sub  || '—';
  const project    = info.project_name || '—';

  // Extra client info strip (screen only)
  const clientBand = info.client_name ? `
  <div class="no-print" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;
       padding:8px 14px;margin-bottom:10px;font-size:12px;color:#374151;font-family:'Inter',sans-serif;
       display:flex;flex-wrap:wrap;gap:16px">
    ${info.client_name  ? `<span>Client: <strong>${esc(info.client_name)}</strong></span>` : ''}
    ${info.sale_number  ? `<span>Sale: <strong>${esc(info.sale_number)}</strong></span>` : ''}
    ${info.sale_status  ? `<span>Status: <strong>${esc(info.sale_status)}</strong></span>` : ''}
  </div>` : '';

  const hdr   = _ldgCrystalHdr({ entityName, entityCode, project, fromDate, toDate });
  const table = _ldgCrystalTable(rows, ob, fromDate);

  return `
  ${clientBand}
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
