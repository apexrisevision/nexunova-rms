-- ============================================================================
-- NEXUNOVA RMS — list_payments_filtered: add deterministic date-wise ordering.
-- 2026-06-16. The function had NO ORDER BY, so Receipt Vouchers (and Report
-- "Receipts" which shares this RPC) came back in heap order — appearing
-- "randomly" sorted. Worse, the LIMIT could drop the most recent vouchers since
-- there was no order to pick them by.
-- Now: newest first — payment_date DESC, created_at DESC, id DESC. Ordered in
-- the inner subquery (so LIMIT keeps the newest) and in jsonb_agg (so the
-- emitted array order is guaranteed). The 'amount'-only column branch keeps no
-- agg order (used for summation, order irrelevant). Logic otherwise unchanged.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_payments_filtered(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
  v_all    boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids   uuid[];
  v_agg_order text;
BEGIN
  IF v_me.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_columns := CASE
    WHEN v_columns IS NULL OR v_columns = '*'  THEN '*'
    WHEN v_columns = 'amount'                  THEN 'amount'
    ELSE '*'
  END;
  -- only the full-row projection exposes the date columns to the outer agg
  v_agg_order := CASE WHEN v_columns = '*'
    THEN 'ORDER BY p.payment_date DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id DESC'
    ELSE '' END;

  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(p) %s), ''[]''::jsonb) FROM (
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
       ORDER BY pmt.payment_date DESC NULLS LAST, pmt.created_at DESC NULLS LAST, pmt.id DESC
       LIMIT $9
     ) p',
    v_agg_order, v_columns
  ) USING p_company_id, v_method, v_date_from, v_date_to, v_deposit_confirmed,
            v_cheque_from, v_cheque_to, v_tax_gt, v_limit, v_all, v_pids
  INTO v_result;
  RETURN v_result;
END $function$;
