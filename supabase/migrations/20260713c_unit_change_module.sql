-- ═══════════════════════════════════════════════════════════════════════════
-- CHANGE UNIT — a client swaps his unit for a different one.
--
-- Third member of the ops family, and distinct from both siblings:
--   Cancel   — the sale dies, the unit goes back to stock.
--   Transfer — the unit goes to a DIFFERENT buyer; a new sale is opened.
--   Change   — the SAME buyer keeps his booking; only the unit under it changes.
--
-- Design: NO new sale is created. The existing sale is repointed to the new unit and re-priced.
-- Every payment, receipt and PRV voucher therefore stays attached exactly where it was — nothing
-- is re-parented and already-printed receipts stay valid. Verified by chaining three changes on
-- one ZZTEST sale: the same PKR 300,000 receipt survived all three hops.
--
-- Owner decisions (2026-07-13):
--   pricing  — the new unit's area/rate prefill the form, and stay editable
--   schedule — money received carries forward; only the balance is scheduled afresh
--   credit   — if he has already paid MORE than the new unit costs, the excess is recorded as a
--              credit on the change record. RMS issues no refund (that is QuickBooks' job).
--   fee      — optional change fee / documentation / other charges
--   agent    — nothing is ever reversed; a record-only ledger line is written instead
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.unit_changes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id             uuid REFERENCES public.projects(id),
  change_voucher_no      text NOT NULL,
  change_date            date NOT NULL DEFAULT CURRENT_DATE,

  sale_id                uuid NOT NULL REFERENCES public.sales(id),
  client_id              uuid NOT NULL REFERENCES public.clients(id),
  agent_id               uuid REFERENCES public.agents(id),

  old_unit_id            uuid NOT NULL REFERENCES public.units(id),
  new_unit_id            uuid NOT NULL REFERENCES public.units(id),

  old_area_sqft          numeric,
  old_price_per_sqft     numeric,
  old_discount           numeric DEFAULT 0,
  old_net_amount         numeric,

  new_area_sqft          numeric,
  new_price_per_sqft     numeric,
  new_discount           numeric DEFAULT 0,
  new_net_amount         numeric,

  amount_received        numeric DEFAULT 0,   -- carried forward from the old unit
  price_difference       numeric DEFAULT 0,   -- new_net - old_net (+ = costlier unit)
  balance_payable        numeric DEFAULT 0,   -- new_net - received (0 when in credit)
  credit_balance         numeric DEFAULT 0,   -- received - new_net when he overpaid

  change_fee             numeric DEFAULT 0,
  documentation_charges  numeric DEFAULT 0,
  other_charges          numeric DEFAULT 0,
  other_charges_desc     text,
  total_charges          numeric DEFAULT 0,
  charges_paid_by        text DEFAULT 'client',
  charges_payment_method text,
  charges_reference      text,

  reason                 text,
  notes                  text,
  status                 text NOT NULL DEFAULT 'completed',
  created_by             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_changes_voucher_unique UNIQUE (company_id, change_voucher_no),
  CONSTRAINT unit_changes_units_differ CHECK (old_unit_id <> new_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_unit_changes_company   ON public.unit_changes(company_id);
CREATE INDEX IF NOT EXISTS idx_unit_changes_old_unit  ON public.unit_changes(old_unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_changes_new_unit  ON public.unit_changes(new_unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_changes_sale      ON public.unit_changes(sale_id);

-- RLS deny-all floor: reachable ONLY through the SECURITY DEFINER RPCs below.
ALTER TABLE public.unit_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_anon ON public.unit_changes;
CREATE POLICY deny_all_anon ON public.unit_changes FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- record-only agent ledger line for a unit change (nothing is reversed — owner rule)
ALTER TABLE public.agent_transactions DROP CONSTRAINT agent_transactions_transaction_type_check;
ALTER TABLE public.agent_transactions ADD CONSTRAINT agent_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'commission_paid','clawback','adjustment_debit','adjustment_credit','write_off',
    'commission_accrued','unit_cancelled','unit_transferred','unit_changed'
  ]));


-- ── the swap itself ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._execute_unit_change_core(
  p_company_id uuid, p_change_date date, p_project_id uuid,
  p_sale_id uuid, p_client_id uuid, p_old_unit_id uuid, p_new_unit_id uuid,
  p_price_per_sqft numeric, p_area_sqft numeric, p_discount numeric DEFAULT 0,
  p_installments jsonb DEFAULT '[]'::jsonb,
  p_change_fee numeric DEFAULT 0, p_documentation_charges numeric DEFAULT 0,
  p_other_charges numeric DEFAULT 0, p_other_charges_desc text DEFAULT NULL,
  p_charges_paid_by text DEFAULT 'client', p_charges_payment_method text DEFAULT NULL,
  p_charges_reference text DEFAULT NULL,
  p_reason text DEFAULT NULL, p_notes text DEFAULT NULL, p_created_by text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_sale            public.sales;
  v_avail_status_id uuid;
  v_sold_status_id  uuid;
  v_seq             int;
  v_voucher_no      text;
  v_change_id       uuid;
  v_received        numeric;
  v_new_net         numeric;
  v_old_net         numeric;
  v_carried         numeric;
  v_balance         numeric;
  v_credit          numeric;
  v_sched_sum       numeric;
  v_inst            jsonb;
  v_inst_count      int;
  v_old_inst_count  int;
  v_total_charges   numeric;
  v_old_label       text;
  v_new_label       text;
BEGIN
  SELECT * INTO v_sale FROM public.sales
   WHERE id = p_sale_id AND company_id = p_company_id;
  IF v_sale.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','sale_not_found');
  END IF;
  IF NOT COALESCE(v_sale.is_active,false) THEN
    RETURN jsonb_build_object('success',false,'error','sale_not_active',
      'message','This sale is already closed (cancelled or transferred) — it cannot be changed.');
  END IF;
  IF v_sale.unit_id IS DISTINCT FROM p_old_unit_id THEN
    RETURN jsonb_build_object('success',false,'error','unit_mismatch',
      'message','That sale is not on the unit you selected.');
  END IF;
  IF p_new_unit_id = p_old_unit_id THEN
    RETURN jsonb_build_object('success',false,'error','same_unit',
      'message','The new unit must be different from the current one.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.units
                  WHERE id = p_new_unit_id AND company_id = p_company_id AND project_id = p_project_id) THEN
    RETURN jsonb_build_object('success',false,'error','new_unit_cross_project',
      'message','The new unit does not belong to this sale''s project.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.sales
              WHERE unit_id = p_new_unit_id AND company_id = p_company_id AND is_active = true) THEN
    RETURN jsonb_build_object('success',false,'error','new_unit_sold',
      'message','That unit is already booked. Pick an available unit.');
  END IF;

  SELECT id INTO v_avail_status_id FROM public.category_unit_statuses
   WHERE company_id=p_company_id AND project_id=p_project_id AND is_available=true AND is_active=true
   ORDER BY sort_order LIMIT 1;
  SELECT id INTO v_sold_status_id FROM public.category_unit_statuses
   WHERE company_id=p_company_id AND project_id=p_project_id AND is_active=true
     AND (LOWER(status_code)='sold' OR LOWER(status_name) ILIKE '%sold%')
   ORDER BY sort_order LIMIT 1;
  -- Fail loudly rather than half-apply: without both statuses the two units would end up lying
  -- about themselves (old still Sold, or new still Available) while the caller is told it worked.
  IF v_avail_status_id IS NULL OR v_sold_status_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','missing_unit_status',
      'message','This project needs both an "Available" and a "Sold" unit status before a unit can be changed. Add them in Categories → Unit Statuses.');
  END IF;

  -- Everything that is not cancelled is money. Same rule get_unit_history uses.
  SELECT COALESCE(SUM(amount),0) INTO v_received
    FROM public.payments
   WHERE sale_id = p_sale_id AND company_id = p_company_id
     AND COALESCE(status,'') <> 'cancelled';

  v_old_net := COALESCE(v_sale.net_amount, 0);
  v_new_net := (COALESCE(p_price_per_sqft,0) * COALESCE(p_area_sqft,0)) - COALESCE(p_discount,0);
  IF v_new_net <= 0 THEN
    RETURN jsonb_build_object('success',false,'error','bad_price','message','The new unit''s price must be greater than zero.');
  END IF;

  v_carried := LEAST(v_received, v_new_net);
  v_balance := GREATEST(v_new_net - v_received, 0);
  v_credit  := GREATEST(v_received - v_new_net, 0);

  SELECT COALESCE(SUM((inst->>'amount_due')::numeric),0) INTO v_sched_sum
    FROM jsonb_array_elements(COALESCE(p_installments,'[]'::jsonb)) AS inst;
  IF ABS(v_sched_sum - v_balance) > 1 THEN
    RETURN jsonb_build_object('success',false,'error','schedule_mismatch',
      'message','The new schedule adds up to ' || v_sched_sum || ' but the balance payable is ' || v_balance || '.');
  END IF;

  SELECT COALESCE(MAX(
    CASE WHEN change_voucher_no ~ ('^UCH-' || EXTRACT(YEAR FROM NOW())::TEXT || '-[0-9]+$')
         THEN SUBSTRING(change_voucher_no FROM 10)::INT ELSE 0 END
  ),0) + 1 INTO v_seq
  FROM public.unit_changes WHERE company_id = p_company_id;
  v_voucher_no := 'UCH-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' || LPAD(v_seq::TEXT, 4, '0');

  SELECT COALESCE(NULLIF(unit_no,''), unit_code, 'unit') INTO v_old_label
    FROM public.units WHERE id = p_old_unit_id;
  SELECT COALESCE(NULLIF(unit_no,''), unit_code, 'unit') INTO v_new_label
    FROM public.units WHERE id = p_new_unit_id;

  -- The old unit's schedule dies with the allotment. DELETED, not voided in place: installments
  -- has UNIQUE(sale_id, installment_number) and the new schedule reuses those numbers, so parking
  -- the old rows collides (23505). Nothing is lost — the money lives in payments (which stay on
  -- this same sale; 0 of 2907 payments reference an installment, and payment_promises.installment_id
  -- is ON DELETE SET NULL), the allotment lives in unit_changes and both units' history, and the
  -- audit trigger on installments captures the deleted rows.
  DELETE FROM public.installments
   WHERE sale_id = p_sale_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_old_inst_count = ROW_COUNT;

  v_inst_count := jsonb_array_length(COALESCE(p_installments,'[]'::jsonb));

  -- Repoint + re-price the SAME sale. net_amount / remaining_amount are GENERATED, so setting
  -- down_payment = carried makes remaining_amount fall out as exactly the balance payable.
  UPDATE public.sales SET
    unit_id          = p_new_unit_id,
    price_per_sqft   = p_price_per_sqft,
    area_sqft        = p_area_sqft,
    discount         = COALESCE(p_discount,0),
    down_payment     = v_carried,
    installment_count= v_inst_count,
    notes            = COALESCE(notes,'') ||
                       CASE WHEN COALESCE(notes,'')='' THEN '' ELSE E'\n' END ||
                       '[Unit changed ' || v_old_label || ' → ' || v_new_label ||
                       ' on ' || p_change_date::text || ' — voucher ' || v_voucher_no || ']',
    updated_at       = NOW()
  WHERE id = p_sale_id AND company_id = p_company_id;

  -- money already received, carried onto the new unit
  IF v_carried > 0 THEN
    INSERT INTO public.installments (
      company_id, sale_id, project_id, installment_number, installment_type,
      due_date, amount_due, amount_paid, status, notes
    ) VALUES (
      p_company_id, p_sale_id, p_project_id, 0, 'down_payment',
      p_change_date, v_carried, v_carried, 'paid',
      'Carried forward from unit ' || v_old_label || ' (' || v_voucher_no || ')'
    );
  END IF;

  -- fresh schedule for the balance
  IF v_inst_count > 0 THEN
    FOR v_inst IN SELECT * FROM jsonb_array_elements(p_installments) LOOP
      INSERT INTO public.installments (
        company_id, sale_id, project_id, installment_number, installment_type,
        due_date, amount_due, amount_paid, status, notes
      ) VALUES (
        p_company_id, p_sale_id, p_project_id,
        COALESCE((v_inst->>'installment_number')::int, 1),
        COALESCE(NULLIF(v_inst->>'installment_type',''), 'installment'),
        NULLIF(v_inst->>'due_date','')::date,
        COALESCE((v_inst->>'amount_due')::numeric, 0),
        0, 'pending',
        NULLIF(v_inst->>'notes','')
      );
    END LOOP;
  END IF;

  UPDATE public.units SET status_id = v_avail_status_id, last_event_at = NOW(), updated_at = NOW()
   WHERE id = p_old_unit_id AND company_id = p_company_id;
  UPDATE public.units SET status_id = v_sold_status_id,  last_event_at = NOW(), updated_at = NOW()
   WHERE id = p_new_unit_id AND company_id = p_company_id;

  v_total_charges := COALESCE(p_change_fee,0) + COALESCE(p_documentation_charges,0) + COALESCE(p_other_charges,0);

  INSERT INTO public.unit_changes (
    company_id, project_id, change_voucher_no, change_date,
    sale_id, client_id, agent_id, old_unit_id, new_unit_id,
    old_area_sqft, old_price_per_sqft, old_discount, old_net_amount,
    new_area_sqft, new_price_per_sqft, new_discount, new_net_amount,
    amount_received, price_difference, balance_payable, credit_balance,
    change_fee, documentation_charges, other_charges, other_charges_desc,
    total_charges, charges_paid_by, charges_payment_method, charges_reference,
    reason, notes, created_by
  ) VALUES (
    p_company_id, p_project_id, v_voucher_no, p_change_date,
    p_sale_id, p_client_id, v_sale.agent_id, p_old_unit_id, p_new_unit_id,
    v_sale.area_sqft, v_sale.price_per_sqft, COALESCE(v_sale.discount,0), v_old_net,
    p_area_sqft, p_price_per_sqft, COALESCE(p_discount,0), v_new_net,
    v_received, v_new_net - v_old_net, v_balance, v_credit,
    COALESCE(p_change_fee,0), COALESCE(p_documentation_charges,0),
    COALESCE(p_other_charges,0), p_other_charges_desc,
    v_total_charges, COALESCE(p_charges_paid_by,'client'), p_charges_payment_method, p_charges_reference,
    p_reason, p_notes, p_created_by
  ) RETURNING id INTO v_change_id;

  -- Agent: nothing reversed (owner rule). Record-only marker so his ledger shows the swap.
  IF v_sale.agent_id IS NOT NULL THEN
    INSERT INTO public.agent_transactions (
      company_id, project_id, agent_id, transaction_type, amount,
      related_sale_id, reference, notes, created_by
    ) VALUES (
      p_company_id, p_project_id, v_sale.agent_id, 'unit_changed', 0,
      p_sale_id, v_voucher_no,
      'Unit changed ' || v_old_label || ' → ' || v_new_label || ' on ' || p_change_date::text
        || '. Commission NOT reversed — record only.'
        || CASE WHEN NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN '' ELSE ' Reason: ' || p_reason END,
      p_created_by
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'change_id', v_change_id, 'voucher_no', v_voucher_no,
    'old_unit', v_old_label, 'new_unit', v_new_label,
    'old_net', v_old_net, 'new_net', v_new_net,
    'amount_received', v_received, 'carried_forward', v_carried,
    'balance_payable', v_balance, 'credit_balance', v_credit,
    'old_installments_removed', v_old_inst_count,
    'installments_created', v_inst_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END;
$function$;


-- ── public entry point: same gate shape as cancellation / transfer ─────────
CREATE OR REPLACE FUNCTION public.execute_unit_change(
  p_company_id uuid, p_change_date date, p_project_id uuid,
  p_sale_id uuid, p_client_id uuid, p_old_unit_id uuid, p_new_unit_id uuid,
  p_price_per_sqft numeric, p_area_sqft numeric, p_discount numeric DEFAULT 0,
  p_installments jsonb DEFAULT '[]'::jsonb,
  p_change_fee numeric DEFAULT 0, p_documentation_charges numeric DEFAULT 0,
  p_other_charges numeric DEFAULT 0, p_other_charges_desc text DEFAULT NULL,
  p_charges_paid_by text DEFAULT 'client', p_charges_payment_method text DEFAULT NULL,
  p_charges_reference text DEFAULT NULL,
  p_reason text DEFAULT NULL, p_notes text DEFAULT NULL, p_created_by text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE v_level text; v_ar jsonb; v_me public.app_users := public._rms_caller();
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','auth_required'); END IF;
  IF NOT COALESCE(v_me.is_super_admin,false) AND v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success',false,'error','wrong_tenant'); END IF;

  IF NOT public._rms_is_admin(v_me) THEN
    IF v_me.role = 'manager' THEN
      RETURN jsonb_build_object('success',false,'error','forbidden','message','Managers have read-only access.'); END IF;
    IF p_project_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id=v_me.id AND company_id=p_company_id AND project_id=p_project_id AND is_active=true
    ) THEN
      RETURN jsonb_build_object('success',false,'error','project_not_assigned','message','You are not assigned to this project.'); END IF;
  END IF;

  IF public._rms_is_admin(v_me) THEN
    RETURN public._execute_unit_change_core(
      p_company_id, p_change_date, p_project_id, p_sale_id, p_client_id, p_old_unit_id, p_new_unit_id,
      p_price_per_sqft, p_area_sqft, p_discount, p_installments,
      p_change_fee, p_documentation_charges, p_other_charges, p_other_charges_desc,
      p_charges_paid_by, p_charges_payment_method, p_charges_reference,
      p_reason, p_notes, COALESCE(p_created_by, v_me.id::text));
  END IF;

  v_level := public._rms_restriction_level(p_company_id, 'unit_change');
  IF v_level = 'hard' THEN
    RETURN jsonb_build_object('success', false, 'error', 'action_hard_blocked', 'action', 'unit_change');
  ELSIF v_level = 'soft' THEN
    v_ar := public.create_approval_request(jsonb_build_object(
      'request_type','unit_change','entity_table','units','entity_id',p_old_unit_id,
      'project_id',p_project_id,'title','Change unit','description',p_reason,
      'amount',0,
      'comment',COALESCE(NULLIF(TRIM(p_reason),''), NULLIF(TRIM(p_notes),'')),
      'payload',jsonb_build_object(
        'change_date',p_change_date,'project_id',p_project_id,'sale_id',p_sale_id,'client_id',p_client_id,
        'old_unit_id',p_old_unit_id,'new_unit_id',p_new_unit_id,
        'price_per_sqft',p_price_per_sqft,'area_sqft',p_area_sqft,'discount',p_discount,
        'installments',p_installments,
        'change_fee',p_change_fee,'documentation_charges',p_documentation_charges,
        'other_charges',p_other_charges,'other_charges_desc',p_other_charges_desc,
        'charges_paid_by',p_charges_paid_by,'charges_payment_method',p_charges_payment_method,
        'charges_reference',p_charges_reference,
        'reason',p_reason,'notes',p_notes,'created_by',COALESCE(p_created_by, v_me.id::text))
    ));
    IF NOT COALESCE((v_ar->>'success')::boolean, false) THEN RETURN v_ar; END IF;
    RETURN jsonb_build_object('success', true, 'status', 'pending_approval', 'request_id', v_ar->>'id');
  ELSIF v_level = 'warning' THEN
    INSERT INTO public.audit_logs (company_id, table_name, record_id, action, is_sensitive, module, reason)
    VALUES (p_company_id, 'units', p_old_unit_id::text, 'restriction_warning', true, 'restrictions', 'unit_change');
  END IF;

  RETURN public._execute_unit_change_core(
    p_company_id, p_change_date, p_project_id, p_sale_id, p_client_id, p_old_unit_id, p_new_unit_id,
    p_price_per_sqft, p_area_sqft, p_discount, p_installments,
    p_change_fee, p_documentation_charges, p_other_charges, p_other_charges_desc,
    p_charges_paid_by, p_charges_payment_method, p_charges_reference,
    p_reason, p_notes, COALESCE(p_created_by, v_me.id::text));
END;
$function$;


-- ── helpers the form needs ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_available_units_for_change(p_company_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', u.id, 'unit_no', u.unit_no, 'unit_code', u.unit_code,
    'floor_label', u.floor_label, 'floor_no', u.floor_no, 'block', u.block,
    'area', u.area, 'base_price', u.base_price,
    'rate_per_sqft', CASE WHEN COALESCE(u.area,0) > 0 THEN ROUND(COALESCE(u.base_price,0) / u.area, 2) ELSE 0 END,
    'status_name', cus.status_name
  ) ORDER BY COALESCE(u.floor_no, 9999), u.unit_no), '[]'::jsonb)
  FROM public.units u
  JOIN public.category_unit_statuses cus ON cus.id = u.status_id AND cus.is_available = true
  CROSS JOIN (SELECT public._rms_caller() AS me) c
  WHERE u.company_id = p_company_id
    AND u.project_id = p_project_id
    AND (c.me).id IS NOT NULL
    AND ((c.me).company_id = p_company_id OR COALESCE((c.me).is_super_admin,false))
    AND NOT EXISTS (SELECT 1 FROM public.sales s
                     WHERE s.unit_id = u.id AND s.company_id = p_company_id AND s.is_active = true);
$function$;

-- The form must show the SAME "received" figure the RPC computes, or its schedule never adds up
-- and every change is refused with schedule_mismatch. list_payments_for_sale (which Transfer uses
-- for its read-only ledger) filters status='received' only and silently drops 'cleared' receipts,
-- so it cannot be used for this.
CREATE OR REPLACE FUNCTION public.get_sale_received(p_sale_id uuid, p_company_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.company_id = p_company_id AND public._rms_is_admin(me)) FROM public._rms_caller() me), false) AS v_all,
      COALESCE((SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT jsonb_build_object(
    'sale_id',     s.id,
    'sale_number', s.sale_number,
    'net_amount',  COALESCE(s.net_amount, 0),
    'received',    COALESCE((
        SELECT SUM(p.amount) FROM public.payments p
         WHERE p.sale_id = s.id AND p.company_id = p_company_id
           AND COALESCE(p.status,'') <> 'cancelled'), 0)
  )
  FROM public.sales s CROSS JOIN cfg
  WHERE s.id = p_sale_id AND s.company_id = p_company_id
    AND (cfg.v_all OR s.project_id = ANY(cfg.v_pids));
$function$;

CREATE OR REPLACE FUNCTION public.get_unit_change_by_id(p_id uuid, p_company_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT to_jsonb(t) || jsonb_build_object(
    'old_unit_no', ou.unit_no, 'new_unit_no', nu.unit_no, 'client_name', cl.full_name)
  FROM public.unit_changes t
  LEFT JOIN public.units ou ON ou.id = t.old_unit_id
  LEFT JOIN public.units nu ON nu.id = t.new_unit_id
  LEFT JOIN public.clients cl ON cl.id = t.client_id
  CROSS JOIN (SELECT public._rms_caller() AS me) c
  WHERE t.id = p_id AND t.company_id = p_company_id
    AND (c.me).id IS NOT NULL
    AND ((c.me).company_id = p_company_id OR COALESCE((c.me).is_super_admin,false));
$function$;

CREATE OR REPLACE FUNCTION public.list_unit_changes_for_fnav(p_company_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id, 'unit_id', t.new_unit_id, 'change_date', t.change_date
  ) ORDER BY t.change_date ASC), '[]'::jsonb)
  FROM public.unit_changes t
  CROSS JOIN (SELECT public._rms_caller() AS me) c
  WHERE t.company_id = p_company_id
    AND (c.me).id IS NOT NULL
    AND ((c.me).company_id = p_company_id OR COALESCE((c.me).is_super_admin,false));
$function$;

REVOKE ALL ON FUNCTION public._execute_unit_change_core(uuid,date,uuid,uuid,uuid,uuid,uuid,numeric,numeric,numeric,jsonb,numeric,numeric,numeric,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_unit_change(uuid,date,uuid,uuid,uuid,uuid,uuid,numeric,numeric,numeric,jsonb,numeric,numeric,numeric,text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_available_units_for_change(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sale_received(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unit_change_by_id(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_unit_changes_for_fnav(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- NOTE: two existing functions were also replaced in this batch, applied directly to the DB:
--
--   approve_request  — gained a WHEN 'unit_change' branch that replays the payload through
--                      _execute_unit_change_core, so a non-admin's change can be approved like a
--                      cancellation or a transfer.
--
--   get_unit_history — gained a unit_changes branch matched on BOTH old_unit_id and new_unit_id.
--                      This matters: the sale is repointed to the new unit, so without it the OLD
--                      unit's timeline would go silent about a client who was once allotted it.
--                      The old unit now reads "Allotted to <client>, then CHANGED to unit <new>"
--                      and the new one "Client <client> CHANGED into this unit from <old>".
--
-- Their full bodies live in the database; this file does not restate them to avoid two sources of
-- truth drifting apart. Dump with pg_get_functiondef before editing either.
-- ═══════════════════════════════════════════════════════════════════════════
