-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 2, STEP 8: sales cross-project guard
-- 2026-05-30.  Completes Track C (the server-side belt-and-suspenders).
-- ════════════════════════════════════════════════════════════
-- 1) list_agents now returns project_id so the agent picker in sales.js can
--    filter to the unit's project (UX).
-- 2) create_sale_with_schedule REJECTS the sale if the chosen client or agent
--    does not belong to the sale's project (real guard — hand-crafted RPC calls
--    can't bypass it). Also scopes the "sold" status lookup to v_project_id
--    so the unit is marked with its own project's SOLD status post-Track A.

-- ── list_agents: include project_id in the SELECT ──
CREATE OR REPLACE FUNCTION public.list_agents(p_company_id uuid, p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_sort text DEFAULT 'name'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_agg(row_data ORDER BY
    CASE WHEN p_sort = 'sales'      THEN a.total_sales_count        END DESC,
    CASE WHEN p_sort = 'commission' THEN a.total_commission_earned   END DESC,
    CASE WHEN p_sort = 'name'       THEN lower(a.full_name)          END ASC
  )
  INTO v_result
  FROM (
    SELECT
      a.id, a.project_id, a.agent_code, a.full_name, a.phone, a.email, a.cnic,
      a.address, a.commission_percent, a.status, a.join_date,
      a.profile_photo_url, a.bank_name, a.bank_account_no,
      a.bank_account_title, a.notes, a.rating,
      a.total_sales_count, a.total_sales_amount,
      a.total_commission_earned, a.total_commission_paid,
      a.total_commission_pending,
      a.created_at, a.updated_at
    FROM public.agents a
    WHERE a.company_id = p_company_id
      AND (p_status IS NULL OR a.status = p_status)
      AND (
        p_search IS NULL OR p_search = '' OR
        lower(a.full_name) LIKE '%' || lower(p_search) || '%' OR
        a.phone            LIKE '%' || p_search || '%' OR
        lower(COALESCE(a.email, '')) LIKE '%' || lower(p_search) || '%' OR
        lower(COALESCE(a.cnic,  '')) LIKE '%' || lower(p_search) || '%' OR
        a.agent_code       LIKE '%' || upper(p_search) || '%'
      )
  ) a(id, project_id, agent_code, full_name, phone, email, cnic, address, commission_percent,
      status, join_date, profile_photo_url, bank_name, bank_account_no,
      bank_account_title, notes, rating, total_sales_count, total_sales_amount,
      total_commission_earned, total_commission_paid, total_commission_pending,
      created_at, updated_at),
  LATERAL (SELECT row_to_json(a)::jsonb AS row_data) r;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- ── create_sale_with_schedule: cross-project guard + project-scoped SOLD lookup ──
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

  v_project_id := COALESCE(
    NULLIF(TRIM(COALESCE(p_sale->>'project_id','')), '')::UUID,
    (SELECT project_id FROM public.units WHERE id = v_unit_id AND company_id = v_company_id)
  );

  -- ── Cross-project guard (the real protection; UI filtering is UX-only) ──
  IF NOT EXISTS (SELECT 1 FROM public.clients
                 WHERE id = v_client_id AND company_id = v_company_id AND project_id = v_project_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'cross_project_client',
      'message', 'The selected client does not belong to this sale''s project.');
  END IF;
  IF v_agent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.agents
                   WHERE id = v_agent_id AND company_id = v_company_id AND project_id = v_project_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'cross_project_agent',
        'message', 'The selected agent does not belong to this sale''s project.');
    END IF;
  END IF;

  v_net_amount := (v_price_per_sqft * v_area_sqft) - v_discount;

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

  FOR v_inst IN SELECT * FROM jsonb_array_elements(p_installments)
  LOOP
    INSERT INTO public.installments (
      company_id, sale_id, project_id, installment_number,
      due_date, amount_due, installment_type, notes
    ) VALUES (
      v_company_id, v_sale_id, v_project_id,
      (v_inst->>'installment_number')::INTEGER,
      NULLIF(v_inst->>'due_date', '')::DATE,
      (v_inst->>'amount_due')::NUMERIC,
      COALESCE(NULLIF(v_inst->>'installment_type',''), 'installment'),
      NULLIF(v_inst->>'notes', '')
    );
  END LOOP;

  -- Mark the unit as SOLD using its OWN project's SOLD status (post-Track A: every project has its own catalog)
  SELECT id INTO v_sold_status_id
  FROM public.category_unit_statuses
  WHERE company_id = v_company_id AND project_id = v_project_id
    AND (LOWER(status_code) = 'sold' OR LOWER(status_name) ILIKE '%sold%')
    AND is_active = true
  ORDER BY sort_order
  LIMIT 1;

  IF v_sold_status_id IS NOT NULL THEN
    UPDATE public.units
    SET status_id = v_sold_status_id, updated_at = NOW()
    WHERE id = v_unit_id AND company_id = v_company_id;
  END IF;

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
