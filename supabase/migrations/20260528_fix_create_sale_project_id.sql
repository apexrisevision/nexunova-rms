-- ================================================================
-- NEXUNOVA RMS — FIX: create_sale_with_schedule sets project_id
-- 2026-05-28
-- LATENT BUG (master context §7 hardening TODO): the RPC never set
-- sales.project_id, so every new sale got project_id=NULL -> recovery/
-- manager site-isolation (§3) broke for that sale. Surgical fix: derive
-- project_id from the unit (or explicit p_sale.project_id) and stamp it
-- on both sales AND installments. Body otherwise verbatim from the live
-- DB dump (2026-05-28) — nothing else changed.
-- ================================================================

CREATE OR REPLACE FUNCTION public.create_sale_with_schedule(p_sale jsonb, p_installments jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id        UUID;
  v_unit_id           UUID;
  v_client_id         UUID;
  v_agent_id          UUID;
  v_project_id        UUID;
  v_price_per_sqft    NUMERIC;
  v_area_sqft         NUMERIC;
  v_discount          NUMERIC;
  v_down_payment      NUMERIC;
  v_installment_count INTEGER;
  v_notes             TEXT;
  v_sale_date         DATE;
  v_created_by        UUID;
  v_net_amount        NUMERIC;
  v_scheduled_sum     NUMERIC;
  v_sale_id           UUID;
  v_sale_number       TEXT;
  v_inst              JSONB;
  v_sold_status_id    UUID;
  v_commission_rate   NUMERIC;
  v_commission_amt    NUMERIC;
BEGIN
  v_company_id        := (p_sale->>'company_id')::UUID;
  v_unit_id           := (p_sale->>'unit_id')::UUID;
  v_client_id         := (p_sale->>'client_id')::UUID;
  v_agent_id          := NULLIF(TRIM(COALESCE(p_sale->>'agent_id','')), '')::UUID;
  v_price_per_sqft    := (p_sale->>'price_per_sqft')::NUMERIC;
  v_area_sqft         := (p_sale->>'area_sqft')::NUMERIC;
  v_discount          := COALESCE((p_sale->>'discount')::NUMERIC, 0);
  v_down_payment      := COALESCE((p_sale->>'down_payment')::NUMERIC, 0);
  v_installment_count := COALESCE((p_sale->>'installment_count')::INTEGER, 0);
  v_notes             := NULLIF(TRIM(COALESCE(p_sale->>'notes','')), '');
  v_sale_date         := COALESCE(NULLIF(p_sale->>'sale_date','')::DATE, CURRENT_DATE);
  v_created_by        := NULLIF(TRIM(COALESCE(p_sale->>'created_by','')), '')::UUID;
  v_commission_rate   := NULLIF(TRIM(COALESCE(p_sale->>'commission_rate','')), '')::NUMERIC;

  -- FIX: resolve project_id (explicit override, else from the unit)
  v_project_id := COALESCE(
    NULLIF(TRIM(COALESCE(p_sale->>'project_id','')), '')::UUID,
    (SELECT project_id FROM public.units WHERE id = v_unit_id AND company_id = v_company_id)
  );

  v_net_amount := (v_price_per_sqft * v_area_sqft) - v_discount;

  -- Validate: full schedule (booking + installments) must equal net amount
  SELECT COALESCE(SUM((inst->>'amount_due')::NUMERIC), 0)
  INTO v_scheduled_sum
  FROM jsonb_array_elements(p_installments) AS inst;

  IF ABS(v_scheduled_sum - v_net_amount) > 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'schedule_mismatch',
      'detail',  'Scheduled ' || v_scheduled_sum || ' ≠ net ' || v_net_amount
    );
  END IF;

  INSERT INTO public.sales (
    company_id, unit_id, client_id, agent_id, project_id,
    price_per_sqft, area_sqft, discount, down_payment,
    installment_count, notes, status, sale_date, created_by,
    commission_rate
  ) VALUES (
    v_company_id, v_unit_id, v_client_id, v_agent_id, v_project_id,
    v_price_per_sqft, v_area_sqft, v_discount, v_down_payment,
    v_installment_count, v_notes, 'active', v_sale_date, v_created_by,
    v_commission_rate
  )
  RETURNING id, sale_number INTO v_sale_id, v_sale_number;

  -- Insert all installment rows (including booking/down_payment type rows)
  FOR v_inst IN SELECT * FROM jsonb_array_elements(p_installments)
  LOOP
    INSERT INTO public.installments (
      company_id, sale_id, project_id, installment_number,
      due_date, amount_due, installment_type, notes
    ) VALUES (
      v_company_id,
      v_sale_id,
      v_project_id,
      (v_inst->>'installment_number')::INTEGER,
      NULLIF(v_inst->>'due_date', '')::DATE,
      (v_inst->>'amount_due')::NUMERIC,
      COALESCE(NULLIF(v_inst->>'installment_type',''), 'installment'),
      NULLIF(v_inst->>'notes', '')
    );
  END LOOP;

  -- Mark unit as Sold
  SELECT id INTO v_sold_status_id
  FROM public.category_unit_statuses
  WHERE (company_id = v_company_id OR company_id IS NULL)
    AND (LOWER(status_code) = 'sold' OR LOWER(status_name) ILIKE '%sold%')
    AND is_active = true
  ORDER BY CASE WHEN company_id = v_company_id THEN 0 ELSE 1 END, sort_order
  LIMIT 1;

  IF v_sold_status_id IS NOT NULL THEN
    UPDATE public.units
    SET status_id = v_sold_status_id, updated_at = NOW()
    WHERE id = v_unit_id AND company_id = v_company_id;
  END IF;

  -- Update agent running totals using per-sale commission_rate
  IF v_agent_id IS NOT NULL THEN
    IF v_commission_rate IS NULL THEN
      SELECT commission_percent INTO v_commission_rate
      FROM public.agents
      WHERE id = v_agent_id AND company_id = v_company_id;
    END IF;

    v_commission_amt := COALESCE(v_net_amount * COALESCE(v_commission_rate, 0) / 100, 0);

    UPDATE public.agents
    SET
      total_sales_count       = COALESCE(total_sales_count, 0) + 1,
      total_sales_amount      = COALESCE(total_sales_amount, 0) + v_net_amount,
      total_commission_earned = COALESCE(total_commission_earned, 0) + v_commission_amt,
      updated_at = NOW()
    WHERE id = v_agent_id AND company_id = v_company_id;
  END IF;

  RETURN jsonb_build_object(
    'success',     true,
    'sale_id',     v_sale_id,
    'sale_number', v_sale_number
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
