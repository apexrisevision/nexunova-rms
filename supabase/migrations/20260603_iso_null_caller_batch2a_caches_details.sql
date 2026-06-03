-- 20260603_iso_null_caller_batch2a_caches_details.sql
-- HIGH fix (#3) batch 2A: the 2 still-open cache RPCs + unit/sale detail readers.
-- Early empty-return when v_me.id IS NULL; v_all drops the IS NULL term. Admin
-- branch already gated in all 8 (direct company-gate; or early wrong_tenant guard
-- for get_unit_history/get_unit_payment_summary; or WHERE company match for the
-- no-company-param get_unit_with_details). Bodies otherwise verbatim.
--
-- Verified live (2-tenant replica): no-app_user JWT -> all empty; ALPHA admin vs
-- BETA ids -> empty + wrong_tenant guard fires on history/payment_summary;
-- ALPHA admin vs own -> data returns.
--
-- NOTE (out of scope, flagged only): get_sale_detail / get_unit_history /
-- get_unit_ledger lack SET search_path — left untouched here.

CREATE OR REPLACE FUNCTION public.get_units_cache_bundle(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me   public.app_users := public._rms_caller();
  v_all  boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('units','[]'::jsonb,'sales','[]'::jsonb,'payments','[]'::jsonb,'agents','[]'::jsonb);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  RETURN jsonb_build_object(
    'units', COALESCE((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.unit_no)
      FROM public.units u
      WHERE u.company_id = p_company_id
        AND (v_all OR u.project_id = ANY(v_pids))), '[]'::jsonb),
    'sales', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'unit_id', s.unit_id, 'client_id', s.client_id, 'agent_id', s.agent_id,
        'sale_number', s.sale_number, 'sale_date', s.sale_date, 'net_amount', s.net_amount,
        'total_amount', s.total_amount, 'status', s.status, 'sale_type_id', s.sale_type_id))
      FROM public.sales s
      WHERE s.company_id = p_company_id AND s.status <> 'cancelled'
        AND (v_all OR EXISTS (SELECT 1 FROM public.units u2
              WHERE u2.id = s.unit_id AND u2.project_id = ANY(v_pids)))), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'sale_id', p.sale_id, 'amount', p.amount, 'payment_date', p.payment_date)
        ORDER BY p.payment_date DESC)
      FROM public.payments p
      WHERE p.company_id = p_company_id
        AND (v_all OR EXISTS (SELECT 1 FROM public.sales s2
              JOIN public.units u2 ON u2.id = s2.unit_id
              WHERE s2.id = p.sale_id AND u2.project_id = ANY(v_pids)))), '[]'::jsonb),
    'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'full_name', a.full_name))
      FROM public.agents a WHERE a.company_id = p_company_id), '[]'::jsonb)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.get_contact_logs_cache(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_me   public.app_users := public._rms_caller();
  v_all  boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(cl) ORDER BY cl.contact_date DESC, cl.created_at DESC)
    FROM (
      SELECT * FROM public.contact_logs cl
      WHERE cl.company_id = p_company_id
        AND (v_all
             OR cl.project_id = ANY(v_pids)
             OR EXISTS (SELECT 1 FROM public.units u2
                         WHERE u2.id = cl.unit_id AND u2.project_id = ANY(v_pids)))
      ORDER BY contact_date DESC, created_at DESC
      LIMIT 2000
    ) cl
  ), '[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.get_unit_with_details(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := public._rms_is_admin(v_me);
  v_pids   uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('error', 'Unit not found'); END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE user_id = v_me.id AND is_active;
  END IF;
  SELECT jsonb_build_object(
    'unit',    to_jsonb(u),
    'project', to_jsonb(p),
    'type',    to_jsonb(t),
    'status',  to_jsonb(s)
  )
  INTO v_result
  FROM public.units u
  LEFT JOIN public.projects               p ON p.id = u.project_id
  LEFT JOIN public.category_unit_types    t ON t.id = u.unit_type_id
  LEFT JOIN public.category_unit_statuses s ON s.id = u.status_id
  WHERE u.id = p_id
    AND (COALESCE(v_me.is_super_admin, false) OR u.company_id = v_me.company_id)
    AND (v_all OR u.project_id = ANY(v_pids));
  RETURN COALESCE(v_result, jsonb_build_object('error', 'Unit not found'));
END; $function$;

CREATE OR REPLACE FUNCTION public.get_unit_ledger(p_unit_id uuid, p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_rows jsonb; v_opening_balance numeric := 0;
  v_ob_debit numeric := 0; v_ob_credit numeric := 0;
  v_period_net numeric := 0; v_unit_info jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[]; v_unit_visible boolean;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'unit_info', '{}'::jsonb, 'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.units u WHERE u.id = p_unit_id AND u.company_id = p_company_id AND (v_all OR u.project_id = ANY(v_pids))) INTO v_unit_visible;
  IF NOT v_unit_visible THEN
    RETURN jsonb_build_object('success', true, 'unit_info', '{}'::jsonb, 'opening_balance', 0, 'rows', '[]'::jsonb, 'closing_balance', 0);
  END IF;
  SELECT jsonb_build_object('unit_no', u.unit_no, 'unit_code', u.unit_code, 'sale_number', s.sale_number, 'client_name', c.full_name, 'project_name', pj.project_name, 'sale_status', s.status)
  INTO v_unit_info FROM units u
  LEFT JOIN sales s ON s.unit_id = u.id AND s.company_id = p_company_id AND s.status NOT IN ('cancelled')
  LEFT JOIN clients c ON c.id = s.client_id
  LEFT JOIN projects pj ON pj.id = COALESCE(s.project_id, u.project_id)
  WHERE u.id = p_unit_id AND u.company_id = p_company_id ORDER BY s.created_at DESC LIMIT 1;
  IF p_from_date IS NOT NULL THEN
    SELECT COALESCE(SUM(i.amount_due), 0) INTO v_ob_debit FROM installments i JOIN sales s ON s.id = i.sale_id
    WHERE i.company_id = p_company_id AND s.unit_id = p_unit_id AND s.status NOT IN ('cancelled') AND i.due_date < p_from_date;
    SELECT COALESCE(SUM(p.amount), 0) INTO v_ob_credit FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND s.unit_id = p_unit_id AND s.status NOT IN ('cancelled') AND p.status != 'cancelled' AND p.payment_date < p_from_date;
    v_opening_balance := v_ob_debit - v_ob_credit;
  END IF;
  SELECT jsonb_agg(to_jsonb(r)) INTO v_rows FROM (
    SELECT CASE i.installment_type WHEN 'down_payment' THEN 'DP-0' ELSE 'INS-' || LPAD(i.installment_number::text, 2, '0') END AS voucher_no,
      'DR' AS row_type, 1 AS row_order, i.due_date AS entry_date, i.created_at AS created_at,
      CASE i.installment_type WHEN 'down_payment' THEN 'Installment Due — Down Payment / Booking'
        ELSE 'Installment Due — ' || i.installment_number::text ||
          CASE WHEN i.installment_number % 100 BETWEEN 11 AND 13 THEN 'th' WHEN i.installment_number % 10 = 1 THEN 'st' WHEN i.installment_number % 10 = 2 THEN 'nd' WHEN i.installment_number % 10 = 3 THEN 'rd' ELSE 'th' END || ' Installment'
      END AS description, i.amount_due AS debit, NULL::numeric AS credit, NULL::text AS chq_no, s.sale_number AS sale_number
    FROM installments i JOIN sales s ON s.id = i.sale_id
    WHERE i.company_id = p_company_id AND s.unit_id = p_unit_id AND s.status NOT IN ('cancelled')
      AND (p_from_date IS NULL OR i.due_date >= p_from_date) AND (p_to_date IS NULL OR i.due_date <= p_to_date)
    UNION ALL
    SELECT COALESCE(p.voucher_code, p.payment_code) AS voucher_no, 'CR' AS row_type, 2 AS row_order,
      p.payment_date AS entry_date, p.created_at AS created_at,
      'Payment Received — ' || INITCAP(REPLACE(p.payment_method, '_', ' ')) ||
        CASE WHEN p.voucher_code IS NOT NULL THEN ' [' || p.voucher_code || ']' WHEN p.payment_code IS NOT NULL THEN ' [' || p.payment_code || ']' ELSE '' END AS description,
      NULL::numeric AS debit, p.amount AS credit,
      CASE WHEN LOWER(p.payment_method) IN ('pdc','cheque') THEN p.reference_no ELSE NULL END AS chq_no, s.sale_number AS sale_number
    FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id AND s.unit_id = p_unit_id AND s.status NOT IN ('cancelled') AND p.status != 'cancelled'
      AND (p_from_date IS NULL OR p.payment_date >= p_from_date) AND (p_to_date IS NULL OR p.payment_date <= p_to_date)
    ORDER BY entry_date NULLS LAST, created_at, row_order
  ) r;
  SELECT COALESCE(SUM(COALESCE((r->>'debit')::numeric, 0) - COALESCE((r->>'credit')::numeric, 0)), 0) INTO v_period_net
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r;
  RETURN jsonb_build_object('success', true, 'unit_info', COALESCE(v_unit_info, '{}'::jsonb), 'opening_balance', v_opening_balance, 'rows', COALESCE(v_rows, '[]'::jsonb), 'closing_balance', v_opening_balance + v_period_net);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_unit_history(p_unit_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_snapshot jsonb;
  v_events   jsonb;
  v_me       public.app_users := public._rms_caller();
  v_all      boolean;
  v_pids     uuid[];
  v_proj     uuid;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'snapshot', '{}'::jsonb, 'events', '[]'::jsonb);
  END IF;
  IF v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  v_all := public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT project_id INTO v_proj FROM public.units
  WHERE id = p_unit_id AND company_id = p_company_id;
  IF v_proj IS NULL OR (NOT v_all AND NOT (v_proj = ANY(v_pids))) THEN
    RETURN jsonb_build_object('success', true, 'snapshot', '{}'::jsonb, 'events', '[]'::jsonb);
  END IF;
  SELECT jsonb_build_object(
    'owner_name',  c.full_name,
    'sale_price',  s.net_amount,
    'sale_number', s.sale_number,
    'sale_date',   TO_CHAR(s.sale_date, 'YYYY-MM-DD'),
    'collected',   COALESCE((
      SELECT SUM(p.amount) FROM payments p
      WHERE p.sale_id = s.id AND p.company_id = p_company_id AND p.status <> 'cancelled'), 0),
    'outstanding', GREATEST(0, COALESCE(s.net_amount, 0) - COALESCE((
      SELECT SUM(p.amount) FROM payments p
      WHERE p.sale_id = s.id AND p.company_id = p_company_id AND p.status <> 'cancelled'), 0))
  ) INTO v_snapshot
  FROM units u
  LEFT JOIN sales s ON s.unit_id = u.id AND s.company_id = p_company_id AND s.is_active = true
  LEFT JOIN clients c ON c.id = s.client_id AND c.company_id = p_company_id
  WHERE u.id = p_unit_id AND u.company_id = p_company_id;
  SELECT jsonb_agg(ev ORDER BY
    (ev->>'priority')::int  NULLS LAST,
    (ev->>'event_date')     NULLS LAST,
    (ev->>'sort_key')       NULLS LAST
  )
  INTO v_events FROM (
    SELECT jsonb_build_object(
      'event_type','unit_created',
      'event_date',TO_CHAR(u.created_at AT TIME ZONE 'Asia/Karachi','YYYY-MM-DD'),
      'description','Unit added to system','amount',NULL,'extra',NULL,'priority','0','sort_key','1') AS ev
    FROM units u WHERE u.id = p_unit_id AND u.company_id = p_company_id
    UNION ALL
    SELECT jsonb_build_object(
      'event_type', CASE WHEN s.status = 'cancelled' THEN 'booking_cancelled' ELSE 'booking' END,
      'event_date', COALESCE(TO_CHAR(s.sale_date,'YYYY-MM-DD'),TO_CHAR(s.created_at AT TIME ZONE 'Asia/Karachi','YYYY-MM-DD')),
      'description', CASE WHEN s.status = 'cancelled' THEN 'Sale booked (later cancelled)' ELSE 'Sale booked' END
                     || ' · ' || COALESCE(c.full_name,'Unknown') || ' · ' || COALESCE(s.sale_number,''),
      'amount', s.net_amount,
      'extra', jsonb_build_object('sale_number',s.sale_number,'client_name',c.full_name,'sale_status',s.status),
      'priority','1','sort_key','2')
    FROM sales s LEFT JOIN clients c ON c.id = s.client_id AND c.company_id = p_company_id
    WHERE s.unit_id = p_unit_id AND s.company_id = p_company_id
    UNION ALL
    SELECT jsonb_build_object(
      'event_type','installment','event_date',TO_CHAR(i.due_date,'YYYY-MM-DD'),
      'description', CASE WHEN i.installment_type='down_payment' THEN 'Down payment due'
                          ELSE 'Installment #' || i.installment_number || ' due' END,
      'amount', i.amount_due,
      'extra', jsonb_build_object('status',i.status,'amount_paid',i.amount_paid,
        'installment_no',i.installment_number,'type',i.installment_type),
      'priority','1','sort_key','3-' || LPAD(COALESCE(i.installment_number,0)::text,5,'0'))
    FROM installments i JOIN sales s ON s.id = i.sale_id AND s.company_id = p_company_id
    WHERE s.unit_id = p_unit_id AND i.company_id = p_company_id
    UNION ALL
    SELECT jsonb_build_object(
      'event_type','payment','event_date',TO_CHAR(p.payment_date,'YYYY-MM-DD'),
      'description','Payment received · ' || COALESCE(p.voucher_code,p.payment_code,'')
                    || CASE WHEN p.payment_method IS NOT NULL THEN ' · ' || p.payment_method ELSE '' END,
      'amount', p.amount,
      'extra', jsonb_build_object('voucher_code',COALESCE(p.voucher_code,p.payment_code),
        'method',p.payment_method,'status',p.status,'reference',p.reference_no),
      'priority','1','sort_key','4')
    FROM payments p JOIN sales s ON s.id = p.sale_id AND s.company_id = p_company_id
    WHERE s.unit_id = p_unit_id AND p.company_id = p_company_id AND p.status <> 'cancelled'
    UNION ALL
    SELECT jsonb_build_object(
      'event_type','pdc','event_date',TO_CHAR(pc.cheque_date,'YYYY-MM-DD'),
      'description','PDC Cheque · ' || COALESCE(pc.cheque_no,'')
                    || CASE WHEN pc.bank_name IS NOT NULL THEN ' · ' || pc.bank_name ELSE '' END,
      'amount', pc.amount,
      'extra', jsonb_build_object('cheque_no',pc.cheque_no,'bank',pc.bank_name,'status',pc.status),
      'priority','1','sort_key','5')
    FROM pdc_cheques pc JOIN sales s ON s.id = pc.sale_id AND s.company_id = p_company_id
    WHERE s.unit_id = p_unit_id AND pc.company_id = p_company_id
    UNION ALL
    SELECT jsonb_build_object(
      'event_type','cancellation','event_date',TO_CHAR(uc.cancellation_date,'YYYY-MM-DD'),
      'description','Sale cancelled'
                    || CASE WHEN uc.reason_category IS NOT NULL THEN ' · ' || uc.reason_category ELSE '' END
                    || CASE WHEN uc.cancellation_voucher_no IS NOT NULL THEN ' · ' || uc.cancellation_voucher_no ELSE '' END,
      'amount', uc.net_refund_amount,
      'extra', jsonb_build_object('voucher_no',uc.cancellation_voucher_no,'reason',uc.reason_category,
        'detail',uc.detailed_reason,'status',uc.status),
      'priority','1','sort_key','6')
    FROM unit_cancellations uc WHERE uc.unit_id = p_unit_id AND uc.company_id = p_company_id
    UNION ALL
    SELECT jsonb_build_object(
      'event_type','transfer','event_date',TO_CHAR(ut.transfer_date,'YYYY-MM-DD'),
      'description','Ownership transferred'
                    || CASE WHEN cold.full_name IS NOT NULL THEN ' from ' || cold.full_name ELSE '' END
                    || CASE WHEN cnew.full_name IS NOT NULL THEN ' to '   || cnew.full_name ELSE '' END
                    || CASE WHEN ut.transfer_voucher_no IS NOT NULL THEN ' · ' || ut.transfer_voucher_no ELSE '' END,
      'amount', ut.total_transfer_charges,
      'extra', jsonb_build_object('from_client',cold.full_name,'to_client',cnew.full_name,
        'voucher_no',ut.transfer_voucher_no,'fee',ut.transfer_fee),
      'priority','1','sort_key','7')
    FROM unit_transfers ut
    LEFT JOIN clients cold ON cold.id = ut.old_client_id AND cold.company_id = p_company_id
    LEFT JOIN clients cnew ON cnew.id = ut.new_client_id AND cnew.company_id = p_company_id
    WHERE ut.unit_id = p_unit_id AND ut.company_id = p_company_id
  ) sub;
  RETURN jsonb_build_object('success', true, 'snapshot', COALESCE(v_snapshot,'{}'::jsonb),
    'events', COALESCE(v_events,'[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_unit_payment_summary(p_unit_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sale RECORD; v_sale_j JSONB; v_insts JSONB;
  v_me public.app_users := public._rms_caller();
  v_all boolean;
  v_pids uuid[];
  v_unit_visible boolean;
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_active_sale');
  END IF;
  IF v_me.company_id IS DISTINCT FROM p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'wrong_tenant');
  END IF;
  v_all := public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.units u
    WHERE u.id = p_unit_id AND u.company_id = p_company_id
      AND (v_all OR u.project_id = ANY(v_pids))
  ) INTO v_unit_visible;

  IF NOT v_unit_visible THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_active_sale');
  END IF;

  SELECT s.id, s.sale_number, s.sale_date, s.price_per_sqft, s.area_sqft,
         s.discount, s.net_amount, s.down_payment, s.remaining_amount,
         s.installment_count, s.status AS sale_status,
         u.unit_no, u.unit_code, u.floor_label, u.area, u.area_unit, u.block,
         p.project_name, c.full_name AS client_name, c.phone_primary AS client_phone,
         a.full_name AS agent_name, a.commission_percent,
         ct.type_name AS unit_type
  INTO v_sale
  FROM public.sales s
  JOIN public.units u ON u.id = s.unit_id
  JOIN public.projects p ON p.id = u.project_id
  JOIN public.clients c ON c.id = s.client_id
  LEFT JOIN public.agents a ON a.id = s.agent_id
  LEFT JOIN public.category_unit_types ct ON ct.id = u.unit_type_id
  WHERE s.unit_id = p_unit_id AND s.company_id = p_company_id AND s.status = 'active'
  LIMIT 1;

  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_active_sale');
  END IF;

  v_sale_j := jsonb_build_object(
    'sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'sale_date', v_sale.sale_date,
    'price_per_sqft', v_sale.price_per_sqft, 'area_sqft', v_sale.area_sqft,
    'discount', v_sale.discount, 'net_amount', v_sale.net_amount,
    'down_payment', v_sale.down_payment, 'installment_count', v_sale.installment_count,
    'unit_no', v_sale.unit_no, 'unit_code', v_sale.unit_code,
    'floor_label', v_sale.floor_label, 'block', v_sale.block,
    'area', v_sale.area, 'area_unit', v_sale.area_unit,
    'project_name', v_sale.project_name, 'unit_type', v_sale.unit_type,
    'client_name', v_sale.client_name, 'client_phone', v_sale.client_phone,
    'agent_name', v_sale.agent_name, 'commission_percent', v_sale.commission_percent
  );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'installment_id', i.id, 'installment_number', i.installment_number,
      'installment_type', i.installment_type, 'due_date', i.due_date,
      'amount_due', i.amount_due, 'amount_paid', i.amount_paid,
      'outstanding', GREATEST(i.amount_due - i.amount_paid, 0),
      'status', i.status, 'notes', i.notes
    ) ORDER BY i.installment_number
  ), '[]'::jsonb)
  INTO v_insts FROM public.installments i
  WHERE i.sale_id = v_sale.id AND i.company_id = p_company_id;

  IF v_insts = '[]'::jsonb AND v_sale.down_payment > 0 THEN
    v_insts := jsonb_build_array(jsonb_build_object(
      'installment_id', NULL, 'installment_number', 0,
      'installment_type', 'down_payment', 'due_date', v_sale.sale_date,
      'amount_due', v_sale.down_payment, 'amount_paid', 0,
      'outstanding', v_sale.down_payment, 'status', 'pending',
      'notes', 'Down Payment / Booking'
    ));
  END IF;

  RETURN jsonb_build_object('success', true, 'sale', v_sale_j, 'installments', v_insts);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sale_detail(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_sale  JSONB;
  v_instl JSONB;
  v_me    public.app_users := public._rms_caller();
  v_all   boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids  uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_build_object(
    'id', s.id, 'sale_number', s.sale_number, 'sale_date', s.sale_date,
    'status', s.status, 'price_per_sqft', s.price_per_sqft,
    'area_sqft', s.area_sqft, 'total_amount', s.total_amount,
    'discount', s.discount, 'net_amount', s.net_amount,
    'down_payment', s.down_payment, 'remaining_amount', s.remaining_amount,
    'installment_count', s.installment_count, 'notes', s.notes,
    'unit_id', u.id, 'unit_no', u.unit_no, 'unit_code', u.unit_code,
    'floor_label', u.floor_label, 'unit_type', ut.type_name,
    'project_name', pr.project_name,
    'client_id', c.id, 'client_name', c.full_name,
    'agent_id', ag.id, 'agent_name', ag.full_name,
    'created_at', s.created_at,
    'co_buyer_name', s.co_buyer_name, 'co_buyer_cnic', s.co_buyer_cnic,
    'co_buyer_share_pct', s.co_buyer_share_pct,
    'nominee_name', s.nominee_name, 'nominee_cnic', s.nominee_cnic,
    'nominee_relation', s.nominee_relation,
    'wht_amount', s.wht_amount, 'cvt_amount', s.cvt_amount,
    'discount_approved_by', s.discount_approved_by,
    'discount_notes', s.discount_notes,
    'cancellation_reason', s.cancellation_reason,
    'cancellation_date', s.cancellation_date,
    'cancelled_by', s.cancelled_by,
    'commission_rate', s.commission_rate,
    'delivery_breach', s.delivery_breach,
    'breach_months', s.breach_months,
    'breach_reason_type', s.breach_reason_type,
    'breach_reason_detail', s.breach_reason_detail,
    'breach_approved_by', s.breach_approved_by,
    'breach_approval_ref', s.breach_approval_ref,
    'breach_approved_at', s.breach_approved_at
  ) INTO v_sale
  FROM public.sales s
  LEFT JOIN public.units                u   ON u.id  = s.unit_id
  LEFT JOIN public.category_unit_types  ut  ON ut.id = u.unit_type_id
  LEFT JOIN public.projects             pr  ON pr.id = u.project_id
  LEFT JOIN public.clients              c   ON c.id  = s.client_id
  LEFT JOIN public.agents               ag  ON ag.id = s.agent_id
  WHERE s.id = p_sale_id AND s.company_id = p_company_id
    AND (v_all OR s.project_id = ANY(v_pids));

  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', i.id, 'installment_number', i.installment_number,
      'due_date', i.due_date, 'amount_due', i.amount_due,
      'amount_paid', i.amount_paid,
      'balance', GREATEST(i.amount_due - i.amount_paid, 0),
      'installment_type', i.installment_type,
      'status', i.status, 'paid_at', i.paid_at, 'notes', i.notes
    ) ORDER BY i.installment_number
  ) INTO v_instl
  FROM public.installments i
  WHERE i.sale_id = p_sale_id AND i.company_id = p_company_id;

  RETURN jsonb_build_object(
    'success', true, 'sale', v_sale,
    'installments', COALESCE(v_instl, '[]'::JSONB)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sale_for_edit(p_sale_id uuid, p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sale         jsonb;
  v_installments jsonb;
  v_me           public.app_users := public._rms_caller();
  v_all          boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids         uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT to_jsonb(s) INTO v_sale FROM (
    SELECT id, sale_number, unit_id, client_id, agent_id, sale_date,
           price_per_sqft, area_sqft, total_amount, discount, net_amount,
           down_payment, remaining_amount, notes, co_buyer_name, co_buyer_cnic,
           co_buyer_share_pct, nominee_name, nominee_cnic, nominee_relation,
           wht_amount, cvt_amount, discount_approved_by, discount_notes, status
    FROM sales WHERE id = p_sale_id AND company_id = p_company_id
      AND (v_all OR project_id = ANY(v_pids))
  ) s;
  IF v_sale IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'sale_not_found'); END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(i) ORDER BY i.installment_number), '[]'::jsonb)
  INTO v_installments FROM (
    SELECT id, installment_number, installment_type, due_date,
           amount_due, amount_paid, notes, status
    FROM installments WHERE sale_id = p_sale_id AND company_id = p_company_id
    ORDER BY installment_number
  ) i;
  RETURN jsonb_build_object('success', true, 'sale', v_sale, 'installments', v_installments);
END;
$function$;
