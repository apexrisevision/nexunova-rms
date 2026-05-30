-- ════════════════════════════════════════════════════════════
-- list_payments_filtered: close SQL-injection on v_columns
-- 2026-05-31. Launch blocker. P0-equivalent (full read primitive).
-- ════════════════════════════════════════════════════════════
-- The function used `EXECUTE format('SELECT %s FROM ...', v_columns)`
-- where v_columns came directly from p_filters->>'columns'. `%s` is
-- a raw-string substitution; combined with SECURITY DEFINER, this
-- gave any authenticated tenant user a full read primitive across
-- the entire database — bypassing RLS, the anon revoke, T1-T6 tenant
-- gates, and the super-admin guard.
--
-- Empirically reproduced (FMH recovery officer, non-super-admin):
--   p_filters = { columns: 'amount, (SELECT company_name FROM
--     public.companies WHERE id != ''<CO1>'' LIMIT 1) AS leaked, ...' }
-- returned:
--   { amount: 100000,
--     leaked_other_tenant_name: 'Nexunova',
--     leaked_super_admin_count: 1,
--     leaked_admin_email: 'rashad_as@yahoo.com' }
-- i.e. cross-tenant, platform-level, and auth.users data all leaked.
--
-- This is the pre-existing flag from the Batch 6C commit body —
-- deferred at the time, now closed.
--
-- Fix: strict whitelist. v_columns is constrained to literal '*' or
-- 'amount' (the two values the JS code actually uses, per grep of
-- reports.js:348/349/756/1110). Anything else → '*' (degraded
-- projection, never broken, never injectable). The rest of the body
-- — T6 tenant guard, parameterized USING $1..$11 filters — is kept
-- verbatim.

CREATE OR REPLACE FUNCTION public.list_payments_filtered(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_columns text := COALESCE(p_filters->>'columns', '*');
  v_method text := NULLIF(p_filters->>'payment_method','');
  v_date_from date := NULLIF(p_filters->>'date_from','')::date;
  v_date_to date := NULLIF(p_filters->>'date_to','')::date;
  v_deposit_confirmed text := p_filters->>'deposit_confirmed';
  v_cheque_from date := NULLIF(p_filters->>'cheque_from','')::date;
  v_cheque_to date := NULLIF(p_filters->>'cheque_to','')::date;
  v_tax_gt numeric := COALESCE((p_filters->>'tax_gt')::numeric, NULL);
  v_limit int := COALESCE((p_filters->>'limit')::int, 5000);
  v_result jsonb;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.id IS NULL) OR (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids   uuid[];
BEGIN
  -- ═══ Strict columns whitelist (closes SQL-injection surface) ═══
  -- The %s substitution below is no longer caller-controlled — only
  -- two literal values can ever reach it. Anything else (default,
  -- typo, hostile) → '*' fallback. Cannot inject.
  v_columns := CASE
    WHEN v_columns IS NULL OR v_columns = '*'  THEN '*'
    WHEN v_columns = 'amount'                  THEN 'amount'
    ELSE '*'
  END;

  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(p)), ''[]''::jsonb) FROM (
       SELECT %s FROM public.payments pmt
       WHERE pmt.company_id = $1
         AND ($10::boolean OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = pmt.sale_id AND s.project_id = ANY($11)))
         AND ($2::text IS NULL OR pmt.payment_method = $2)
         AND ($3::date IS NULL OR pmt.payment_date >= $3)
         AND ($4::date IS NULL OR pmt.payment_date <= $4)
         AND ($5::text IS NULL OR ($5 = ''true'' AND pmt.deposit_confirmed) OR ($5 = ''false'' AND NOT pmt.deposit_confirmed))
         AND ($6::date IS NULL OR pmt.cheque_date >= $6)
         AND ($7::date IS NULL OR pmt.cheque_date <= $7)
         AND ($8::numeric IS NULL OR pmt.tax_amount > $8)
       LIMIT $9
     ) p',
    v_columns
  ) USING p_company_id, v_method, v_date_from, v_date_to, v_deposit_confirmed,
            v_cheque_from, v_cheque_to, v_tax_gt, v_limit, v_all, v_pids
  INTO v_result;
  RETURN v_result;
END $function$;
