// ══ AGENT LEDGER ═════════════════════════════════════════════

function rLedgerAgent() {
  _ldgInjectPrintCss();
  const pg = document.getElementById('pg-ledger-agent');
  if (!pg) return;
  const ctx = window._ldgCtx || {};
  pg.innerHTML = `<div class="ani">
    ${_ldgNavBar('Agent Ledger')}
    ${_ldgFilterRow('ldgag', '_ldgagRun')}
    <div id="ldgag-body">${_ldgEmpty()}</div>
  </div>`;
}

async function _ldgagRun() {
  const ctx  = window._ldgCtx || {};
  const from = document.getElementById('ldgag-from')?.value || '';
  const to   = document.getElementById('ldgag-to')?.value   || '';
  const body = document.getElementById('ldgag-body');
  if (!body) return;
  if (!ctx.id) { body.innerHTML = _ldgErr('No agent selected — go back to Ledgers and choose an agent.'); return; }
  if (!_ldgValidateDates(from, to, body)) return;

  body.innerHTML = _ldgLoading();

  try {
    const { data: d, error } = await supabase.rpc('get_agent_ledger', {
      p_agent_id:   ctx.id,
      p_company_id: S.cid,
      p_from_date:  from || null,
      p_to_date:    to   || null,
    });
    if (error) throw error;
    if (!d || d.success === false) throw new Error(d?.error || 'RPC returned no data');
    body.innerHTML = _ldgagRender(d, ctx, from, to);
  } catch (e) {
    console.error('[AgentLedger]', e);
    body.innerHTML = _ldgErr(e.message || String(e));
  }
}

function _ldgagRender(d, ctx, fromDate, toDate) {
  const rows  = d.rows || [];
  const ob    = +(d.opening_balance) || 0;
  const info  = d.agent_info || {};

  const entityName = info.agent_name || ctx.name || '—';
  const entityCode = info.agent_code || ctx.sub  || '—';
  const project    = info.projects   || '—';

  // Normalize agent rows: earned→debit, paid→credit
  const normRows = rows.map(r => ({
    voucher_no:  r.voucher_no || '',
    entry_date:  r.row_date   || '',
    description: r.description || '',
    chq_no:      r.chq_no || '',
    debit:  +(r.earned || 0),
    credit: +(r.paid   || 0),
  }));

  const hdr   = _ldgCrystalHdr({ entityName, entityCode, project, fromDate, toDate });
  const table = _ldgCrystalTable(normRows, ob, fromDate, {
    debitLabel:  'Commission Earned',
    creditLabel: 'Commission Paid',
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
