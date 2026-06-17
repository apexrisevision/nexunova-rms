-- ============================================================================
-- NEXUNOVA RMS — _edit_installment_schedule_core: also update installment_number
-- on existing rows. 2026-06-17. Lets the Sale Detail "Edit Schedule" editor
-- renumber by due-date after an insert so the schedule order stays correct.
-- (Backend already supported per-row update / insert (_new) / delete (_deleted);
--  the only gap was that UPDATE skipped installment_number.)
-- ============================================================================
CREATE OR REPLACE FUNCTION public._edit_installment_schedule_core(p_sale_id uuid, p_company_id uuid, p_schedule jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_row jsonb; v_deleted int := 0; v_inserted int := 0; v_updated int := 0;
  v_errors text[] := ARRAY[]::text[];
BEGIN
  IF p_sale_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params'); END IF;
  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;
  IF jsonb_typeof(p_schedule) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule_must_be_array'); END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_schedule) LOOP
    BEGIN
      IF (v_row->>'_deleted')::boolean = true AND (v_row->>'id') IS NOT NULL THEN
        DELETE FROM installments WHERE id = (v_row->>'id')::uuid AND company_id = p_company_id AND sale_id = p_sale_id;
        v_deleted := v_deleted + 1;
      ELSIF (v_row->>'_new')::boolean = true THEN
        INSERT INTO installments(company_id, sale_id, installment_number, installment_type,
          due_date, amount_due, amount_paid, notes, status)
        VALUES (p_company_id, p_sale_id, (v_row->>'installment_number')::int,
          COALESCE(v_row->>'installment_type', 'installment'), (v_row->>'due_date')::date,
          (v_row->>'amount_due')::numeric, COALESCE((v_row->>'amount_paid')::numeric, 0),
          v_row->>'notes', COALESCE(v_row->>'status', 'pending'));
        v_inserted := v_inserted + 1;
      ELSIF (v_row->>'id') IS NOT NULL THEN
        UPDATE installments SET
          installment_number = COALESCE((v_row->>'installment_number')::int, installment_number),
          installment_type = COALESCE(v_row->>'installment_type', installment_type),
          due_date         = COALESCE((v_row->>'due_date')::date, due_date),
          amount_due       = COALESCE((v_row->>'amount_due')::numeric, amount_due),
          notes            = v_row->>'notes', updated_at = now()
        WHERE id = (v_row->>'id')::uuid AND company_id = p_company_id AND sale_id = p_sale_id;
        v_updated := v_updated + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN v_errors := array_append(v_errors, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('success', array_length(v_errors,1) IS NULL,
    'deleted', v_deleted, 'inserted', v_inserted, 'updated', v_updated, 'errors', to_jsonb(v_errors));
END; $function$;
