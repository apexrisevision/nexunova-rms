-- Unit amount-shift feature: reallocate a PARTIAL received amount from one unit's
-- account to another (DR source ledger, CR destination). Distinct from Change
-- Unit / Transfer (which move the whole sale). Admin/owner only, direct.
--
-- Payments-based was NOT possible (payments has CHECK amount > 0, so no negative
-- payment for the source's debit) → dedicated table. Every "received" surface was
-- updated to consult it (applied live via apply_migration; recorded in Supabase
-- migration history):
--   * get_client_ledger            — UNIONs shift rows as DR(from)/CR(to)
--   * get_units_cache_bundle       — injects signed pseudo-payments (+to, −from)
--   * get_payments_for_unit        — same, for the Account Statement
--   * get_unit_payment_summary     — returns net_shift; frontend subtracts it
-- Deferred: get_recovery_position (overdue/FIFO) does not yet reflect shifts.

CREATE TABLE IF NOT EXISTS public.unit_amount_shifts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  from_sale_id  uuid NOT NULL,
  to_sale_id    uuid NOT NULL,
  from_unit_id  uuid,
  to_unit_id    uuid,
  from_client_id uuid,
  to_client_id  uuid,
  amount        numeric NOT NULL CHECK (amount > 0),
  shift_date    date NOT NULL DEFAULT CURRENT_DATE,
  narration     text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uas_company ON public.unit_amount_shifts(company_id);
CREATE INDEX IF NOT EXISTS idx_uas_from ON public.unit_amount_shifts(from_sale_id);
CREATE INDEX IF NOT EXISTS idx_uas_to ON public.unit_amount_shifts(to_sale_id);
ALTER TABLE public.unit_amount_shifts ENABLE ROW LEVEL SECURITY;  -- deny-all floor; access via RPCs

CREATE OR REPLACE FUNCTION public.shift_unit_amount(
  p_company_id uuid, p_from_sale_id uuid, p_to_sale_id uuid,
  p_amount numeric, p_shift_date date DEFAULT CURRENT_DATE, p_narration text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_from RECORD; v_to RECORD; v_avail numeric; v_narr text; v_id uuid;
BEGIN
  IF v_me.id IS NULL OR v_me.company_id IS DISTINCT FROM p_company_id OR NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero.');
  END IF;
  IF p_from_sale_id = p_to_sale_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source and destination must be different units.');
  END IF;
  SELECT s.id, s.unit_id, s.client_id, s.net_amount, u.unit_no, c.full_name
    INTO v_from FROM sales s JOIN units u ON u.id=s.unit_id LEFT JOIN clients c ON c.id=s.client_id
    WHERE s.id=p_from_sale_id AND s.company_id=p_company_id AND s.status='active';
  IF v_from IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Source sale not found or not active.'); END IF;
  SELECT s.id, s.unit_id, s.client_id, s.net_amount, u.unit_no, c.full_name
    INTO v_to FROM sales s JOIN units u ON u.id=s.unit_id LEFT JOIN clients c ON c.id=s.client_id
    WHERE s.id=p_to_sale_id AND s.company_id=p_company_id AND s.status='active';
  IF v_to IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Destination sale not found or not active.'); END IF;

  v_avail := COALESCE((SELECT SUM(amount) FROM payments WHERE sale_id=p_from_sale_id AND company_id=p_company_id AND status<>'cancelled'),0)
           - COALESCE((SELECT SUM(amount) FROM unit_amount_shifts WHERE from_sale_id=p_from_sale_id),0)
           + COALESCE((SELECT SUM(amount) FROM unit_amount_shifts WHERE to_sale_id=p_from_sale_id),0);
  IF p_amount > v_avail + 0.01 THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Source unit %s has only PKR %s available to shift.', v_from.unit_no, to_char(v_avail,'FM999,999,999')));
  END IF;

  v_narr := COALESCE(NULLIF(btrim(p_narration),''),
                     format('Amount shifted to %s from %s', v_to.unit_no, v_from.unit_no));
  INSERT INTO unit_amount_shifts(company_id, from_sale_id, to_sale_id, from_unit_id, to_unit_id,
    from_client_id, to_client_id, amount, shift_date, narration, created_by)
  VALUES (p_company_id, p_from_sale_id, p_to_sale_id, v_from.unit_id, v_to.unit_id,
    v_from.client_id, v_to.client_id, p_amount, COALESCE(p_shift_date, CURRENT_DATE), v_narr, v_me.id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'amount', p_amount, 'narration', v_narr,
    'from_unit', v_from.unit_no, 'to_unit', v_to.unit_no,
    'from_client', v_from.full_name, 'to_client', v_to.full_name);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
