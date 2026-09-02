// ══ CLIENT LEDGER ════════════════════════════════════════════

function rLedgerClient() {
  _ldgInjectPrintCss();
  const pg = document.getElementById('pg-ledger-client');
  if (!pg) return;
  const ctx = window._ldgCtx || {};
  pg.innerHTML = `<div class="ani">
    ${_ldgNavBar('Client Ledger')}
    ${_ldgFilterRow('ldgcl', '_ldgclRun')}
    <div id="ldgcl-body">${_ldgEmpty()}</div>
  </div>`;
}

async function _ldgclRun() {
  const ctx  = window._ldgCtx || {};
  const from = document.getElementById('ldgcl-from')?.value || '';
  const to   = document.getElementById('ldgcl-to')?.value   || '';
  const body = document.getElementById('ldgcl-body');
  if (!body) return;
  if (!ctx.id) { body.innerHTML = _ldgErr('No client selected — go back to Ledgers and choose a client.'); return; }
  if (!_ldgValidateDates(from, to, body)) return;

  body.innerHTML = _ldgLoading();

  try {
    const { data: d, error } = await supabase.rpc('get_client_ledger', {
      p_client_id:  ctx.id,
      p_company_id: S.cid,
      p_from_date:  from || null,
      p_to_date:    to   || null,
    });
    if (error) throw error;
    if (!d || d.success === false) throw new Error(d?.error || 'RPC returned no data');
    body.innerHTML = _ldgclRender(d, ctx, from, to);
  } catch (e) {
    console.error('[ClientLedger]', e);
    body.innerHTML = _ldgErr(e.message || String(e));
  }
}

function _ldgclRender(d, ctx, fromDate, toDate) {
  const rows  = d.rows || [];
  const ob    = +(d.opening_balance) || 0;
  const info  = d.client_info || {};

  const entityName = info.client_name || ctx.name || '—';
  const entityCode = info.client_code || ctx.sub  || '—';
  const project    = info.projects    || '—';

  const hdr   = _ldgCrystalHdr({ entityName, entityCode, project, fromDate, toDate });
  // Manual # column on: a client asking about a payment quotes the number on
  // the receipt-book slip he was handed, not our PRV-/PAY- code.
  const table = _ldgCrystalTable(rows, ob, fromDate, { manualCol: true });

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
