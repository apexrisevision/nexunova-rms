-- ═══════════════════════════════════════════════════════════════════════════
-- ONE UNIT, ONE SALE.
--
-- Rashid needs to mark units that are sold but whose sale has not been
-- entered in RMS yet, so that nobody sells them a second time. The status
-- half of that shipped as "Sold - Entry Pending". This is the half that was
-- missing, and checking it turned up something older and worse.
--
-- _create_sale_with_schedule_core checked three things: that the client
-- belongs to the project, that the agent does, and that the schedule adds up
-- to the net. It never once looked at the UNIT. Measured on the live tenant
-- inside a rolled-back transaction: a unit held as "Sold - Entry Pending"
-- accepted SAL-2026-0003, and then accepted SAL-2026-0004 on top of it. Two
-- active sales, two clients, two schedules, two commissions, one flat.
--
-- It has never actually happened — 0 units on any tenant carry more than one
-- active sale — because the New Sale screen filters its picker to available
-- units. But a filter in a browser is not a rule, and the reservation-to-sale
-- path deliberately bypasses that filter, which is exactly where a unit that
-- is already spoken for can still be reached.
--
-- Two things change, in the one function both sale paths run through
-- (RMS create_sale_with_schedule, and the portal's approve_sale_submission):
--
--   1. A unit with an active sale is refused, with the sale number that
--      already stands so the answer is useful rather than merely a no. The
--      unit row is locked first, so two people saving at the same instant
--      cannot both pass. A CANCELLED sale does not count: that unit is
--      genuinely back for sale, which is the whole cancel-and-resell flow.
--
--   2. The status a sale stamps can no longer be a desk tag. The old lookup
--      was "any status whose name contains sold, lowest sort_order wins" —
--      and "Sold - Entry Pending" contains it. Today Sold sorts first and
--      wins; ONE DRAG in Categories and a real sale would have stamped a
--      permanent hold onto the unit. Now a status with a NATURE is excluded
--      outright, because a nature means "this is a way of holding a unit",
--      and after that an exact SOLD code beats a name that merely mentions
--      the word.
--
-- The index is the same rule said where nothing can route around it. It is
-- created as a partial unique index on active sales only, and it was checked
-- against live data first: zero violations, so it cannot fail on creation.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── the rule, where no code path can miss it ──────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS sales_one_active_per_unit
  ON public.sales (unit_id) WHERE status = 'active';

COMMENT ON INDEX public.sales_one_active_per_unit IS
  'A unit may carry only one active sale. Cancelled sales are excluded, so cancel-and-resell still works.';

-- ── and where it can answer a person, rather than raise ───────────────────
CREATE OR REPLACE FUNCTION public._create_sale_with_schedule_core(p_sale jsonb, p_installments jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID; v_unit_id UUID; v_client_id UUID; v_agent_id UUID; v_project_id UUID;
  v_price_per_sqft NUMERIC; v_area_sqft NUMERIC; v_discount NUMERIC; v_down_payment NUMERIC;
  v_installment_count INTEGER; v_notes TEXT; v_sale_date DATE; v_created_by UUID;
  v_net_amount NUMERIC; v_scheduled_sum NUMERIC; v_sale_id UUID; v_sale_number TEXT;
  v_inst JSONB; v_sold_status_id UUID; v_commission_rate NUMERIC; v_commission_amt NUMERIC;
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
    (SELECT project_id FROM public.units WHERE id = v_unit_id AND company_id = v_company_id));

  /* ── ONE UNIT, ONE SALE ────────────────────────────────────────────────
     Nothing checked this. Measured before it was written, on the live
     tenant inside a rolled-back transaction: the same unit took SAL-2026-
     0003 and then SAL-2026-0004, two clients, two schedules, two
     commissions, and the register showed both. The New Sale screen filters
     its picker to available units, so it had never happened by accident —
     but a filter in a browser is not a rule, and the reservation-to-sale
     path deliberately bypasses that filter, which is the one place a unit
     that is already sold can still be reached.

     The unit is locked for the length of the transaction, so two people
     pressing Save at the same moment cannot both pass this test.

     A cancelled sale does not count: a unit whose sale was cancelled is
     genuinely for sale again, and that is the whole cancel-and-resell flow. */
  PERFORM 1 FROM public.units WHERE id = v_unit_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.sales s
              WHERE s.unit_id = v_unit_id AND s.status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_sold',
      'message', 'This unit already has an active sale. Cancel that sale first if it is being replaced.',
      'sale_number', (SELECT s2.sale_number FROM public.sales s2
                       WHERE s2.unit_id = v_unit_id AND s2.status = 'active'
                       ORDER BY s2.sale_date LIMIT 1));
  END IF;

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
  SELECT COALESCE(SUM((inst->>'amount_due')::NUMERIC), 0) INTO v_scheduled_sum
  FROM jsonb_array_elements(p_installments) AS inst;
  IF ABS(v_scheduled_sum - v_net_amount) > 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule_mismatch',
      'detail', 'Scheduled ' || v_scheduled_sum || ' != net ' || v_net_amount);
  END IF;

  INSERT INTO public.sales (
    company_id, unit_id, client_id, agent_id, project_id,
    price_per_sqft, area_sqft, discount, down_payment,
    installment_count, notes, status, sale_date, created_by, commission_rate
  ) VALUES (
    v_company_id, v_unit_id, v_client_id, v_agent_id, v_project_id,
    v_price_per_sqft, v_area_sqft, v_discount, v_down_payment,
    v_installment_count, v_notes, 'active', v_sale_date, v_created_by, v_commission_rate
  ) RETURNING id, sale_number INTO v_sale_id, v_sale_number;

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
      NULLIF(v_inst->>'notes', ''));
  END LOOP;

  /* ── WHICH STATUS DOES A SALE STAMP? ───────────────────────────────────
     It used to be "anything whose name contains sold, lowest sort_order
     first". "Sold - Entry Pending" contains the word too, and it is a
     PERMANENT DESK HOLD, not the outcome of a sale. Today Sold sorts above
     it and wins; one drag in Categories and a real sale would have stamped
     the hold onto the unit instead. Proven in a rolled-back transaction
     before this was written.

     Two rules now, and the first is the important one: a status that
     carries a NATURE is a way of HOLDING a unit, so it can never be what a
     sale leaves behind. After that, the exact code wins over a name that
     merely mentions the word. */
  SELECT id INTO v_sold_status_id
  FROM public.category_unit_statuses
  WHERE company_id = v_company_id AND project_id = v_project_id
    AND (LOWER(status_code) = 'sold' OR LOWER(status_name) ILIKE '%sold%')
    AND is_active = true
    AND nature IS NULL
  ORDER BY (LOWER(status_code) = 'sold') DESC, sort_order
  LIMIT 1;
  IF v_sold_status_id IS NOT NULL THEN
    UPDATE public.units SET status_id = v_sold_status_id, updated_at = NOW()
    WHERE id = v_unit_id AND company_id = v_company_id;
  END IF;

  IF v_agent_id IS NOT NULL THEN
    IF v_commission_rate IS NULL THEN
      SELECT commission_percent INTO v_commission_rate
      FROM public.agents WHERE id = v_agent_id AND company_id = v_company_id;
    END IF;
    v_commission_amt := COALESCE(v_net_amount * COALESCE(v_commission_rate, 0) / 100, 0);
    UPDATE public.agents SET
      total_sales_count       = COALESCE(total_sales_count, 0) + 1,
      total_sales_amount      = COALESCE(total_sales_amount, 0) + v_net_amount,
      total_commission_earned = COALESCE(total_commission_earned, 0) + v_commission_amt,
      updated_at = NOW()
    WHERE id = v_agent_id AND company_id = v_company_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'sale_number', v_sale_number);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

COMMIT;
