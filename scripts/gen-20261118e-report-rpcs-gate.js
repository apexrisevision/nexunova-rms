#!/usr/bin/env node
/* Writes supabase/migrations/20261118e_report_rpcs_reports_gate.sql: a helper that mirrors the
   screen's hasPermission('reports'), and a one-line gate at the top of list_sales_for_report and
   get_portfolio_summary — patched into their LIVE definitions (asserted). */
const fs = require('fs'), path = require('path');
const { q } = require('./_sbq');
(async () => {
  const fns = ['public.list_sales_for_report(uuid,jsonb)', 'public.get_portfolio_summary(uuid,uuid,date,text)'];
  const GATE = `BEGIN
  -- reports module gate (20261118e): same rule as the screen's hasPermission('reports')
  IF NOT public._rms_can_read_reports(p_company_id) THEN
    RAISE EXCEPTION 'You do not have access to reports.' USING ERRCODE = '42501';
  END IF;
`;
  let out = `-- ══ RMS reports: only logins with the Reports module may call the two report functions (20261118e) ══
-- NOT APPLIED until the owner says yes.
--
-- Found 18-Nov-2026 (docs/findings/F-staff-role-report-rpcs-not-gated.md): a Staff login with no
-- modules (Sharose, NexuFinance site user) got every Awami sale from list_sales_for_report and
-- the portfolio from get_portfolio_summary by calling the API directly. Neither function checked
-- who was asking — not even the company: any signed-in login of ANY company could pass another
-- company's id.
--
-- Now both start with _rms_can_read_reports(p_company_id), which mirrors the screen exactly
-- (js/helpers.js hasPermission('reports')):
--   * platform super admin, or the database's own service role  -> allowed
--   * the caller must be an ACTIVE RMS user of THAT company      -> else refused
--   * owner / admin                                              -> allowed
--   * staff                                                      -> only if Reports is ticked
--   * recovery (user) / accounts / manager -> the tick decides when Reports is set either way;
--     with no setting, their role default (which includes Reports) applies
-- Nothing else in the two functions changes. Only the Reports page calls them (js/pages/reports.js).

CREATE OR REPLACE FUNCTION public._rms_can_read_reports(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me    public.app_users := public._rms_caller();
  v_perms jsonb;
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role' THEN RETURN true; END IF;
  IF v_me.id IS NULL THEN RETURN false; END IF;
  IF COALESCE(v_me.is_super_admin, false) THEN RETURN true; END IF;
  IF v_me.company_id IS DISTINCT FROM p_company_id THEN RETURN false; END IF;
  IF public._rms_is_admin(v_me) THEN RETURN true; END IF;
  v_perms := COALESCE(v_me.module_permissions, '{}'::jsonb);
  IF v_me.role = 'staff' THEN
    RETURN COALESCE((v_perms->>'reports')::boolean, false);
  END IF;
  IF v_perms <> '{}'::jsonb AND v_perms ? 'reports' THEN
    RETURN COALESCE((v_perms->>'reports')::boolean, false);
  END IF;
  RETURN v_me.role IN ('recovery', 'user', 'accounts', 'manager');
END;
$function$;
REVOKE ALL ON FUNCTION public._rms_can_read_reports(uuid) FROM PUBLIC, anon, authenticated;
`;
  for (const sig of fns) {
    const def = (await q(`select pg_get_functiondef('${sig}'::regprocedure) d`))[0].d;
    const parts = def.split(/\nBEGIN\n/);
    if (parts.length !== 2) throw new Error('BEGIN not found exactly once in ' + sig);
    out += '\n' + (parts[0] + '\n' + GATE + parts[1]).trim() + ';\n';
  }
  const f = path.join(__dirname, '..', 'supabase', 'migrations', '20261118e_report_rpcs_reports_gate.sql');
  fs.writeFileSync(f, out);
  console.log('written', f);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
