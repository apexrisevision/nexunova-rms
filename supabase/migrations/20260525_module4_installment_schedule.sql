-- ================================================================
-- NEXUNOVA RMS — MODULE 4 INSTALLMENT SCHEDULE ENHANCEMENT
-- 2026-05-25 — APPLIED via MCP + verified with a full project→unit→sale→
-- installment chain: a 40-day-overdue installment moved severely_overdue →
-- on_track after defer (status overdue→pending). Rolled back, 0 residue.
--
--   (a) defer_installment(installment, company, new_due_date, reason)
--       — push due date forward, recompute status, append audit note.
--   (b) get_schedule_analytics(company) — on-track / delayed / severely-
--       overdue buckets on open installments.
-- Schedule restructure already exists (edit_installment_schedule);
-- schedule PDF via _salPrintSchedule. Configurable partial-payment
-- allocation rules + original-vs-modified snapshot = noted future work.
-- Canonical bodies applied via apply_migration 'module4_installment_schedule'.
-- ================================================================

CREATE OR REPLACE FUNCTION public.defer_installment(p_installment_id uuid, p_company_id uuid, p_new_due_date date, p_reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_row installments%ROWTYPE; v_new_status text;
BEGIN
  SELECT * INTO v_row FROM installments WHERE id = p_installment_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'installment_not_found'); END IF;
  IF v_row.status = 'paid' OR (v_row.amount_due - COALESCE(v_row.amount_paid,0)) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'installment_already_paid');
  END IF;
  IF p_new_due_date IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'new_due_date_required'); END IF;

  v_new_status := CASE
    WHEN COALESCE(v_row.amount_paid,0) > 0 THEN 'partial'
    WHEN p_new_due_date < CURRENT_DATE THEN 'overdue'
    ELSE 'pending' END;

  UPDATE installments SET
    due_date = p_new_due_date,
    status   = v_new_status,
    notes    = COALESCE(notes || ' | ', '') || 'Deferred from ' || COALESCE(v_row.due_date::text,'?')
               || ' to ' || p_new_due_date::text || COALESCE(': ' || p_reason, ''),
    updated_at = NOW()
  WHERE id = p_installment_id AND company_id = p_company_id;

  RETURN jsonb_build_object('success', true, 'id', p_installment_id, 'new_due_date', p_new_due_date, 'status', v_new_status);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $function$;
GRANT EXECUTE ON FUNCTION public.defer_installment(uuid, uuid, date, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_schedule_analytics(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_res jsonb;
BEGIN
  SELECT jsonb_build_object(
    'on_track',         jsonb_build_object('count', COUNT(*) FILTER (WHERE od < 0),             'amount', COALESCE(SUM(out) FILTER (WHERE od < 0),0)),
    'delayed',          jsonb_build_object('count', COUNT(*) FILTER (WHERE od BETWEEN 0 AND 30), 'amount', COALESCE(SUM(out) FILTER (WHERE od BETWEEN 0 AND 30),0)),
    'severely_overdue', jsonb_build_object('count', COUNT(*) FILTER (WHERE od > 30),            'amount', COALESCE(SUM(out) FILTER (WHERE od > 30),0)),
    'total_open',        COUNT(*),
    'total_outstanding', COALESCE(SUM(out),0)
  ) INTO v_res
  FROM (
    SELECT (CURRENT_DATE - due_date) AS od, (amount_due - COALESCE(amount_paid,0)) AS out
    FROM installments
    WHERE company_id = p_company_id AND status <> 'paid' AND (amount_due - COALESCE(amount_paid,0)) > 0
  ) x;
  RETURN jsonb_build_object('success', true) || COALESCE(v_res, '{}'::jsonb);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $function$;
GRANT EXECUTE ON FUNCTION public.get_schedule_analytics(uuid) TO anon, authenticated;
