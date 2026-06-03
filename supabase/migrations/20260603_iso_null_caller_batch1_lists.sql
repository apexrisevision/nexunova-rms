-- 20260603_iso_null_caller_batch1_lists.sql
-- HIGH fix (#3) — batch 1 of N. Close the (v_me.id IS NULL) -> full-company-data
-- leak in the 8 list_* reader RPCs. A null caller (authenticated JWT with no
-- app_users row for auth.uid(), or sessionless) now receives that RPC's own
-- empty envelope instead of all company data. v_all drops the IS NULL term; the
-- admin branch is already company-gated (v_me.company_id = p_company_id) in all 8
-- so blocker-1 (cross-tenant admin read) holds. Bodies otherwise verbatim.
-- Legit-anon RPCs (verify_login + buyer-portal) are NOT touched.
--
-- Empty envelope per RPC: list_clients/list_units -> {total:0,rows:[],limit,offset};
-- the other six -> '[]'::jsonb (their natural empty shape).
--
-- Verified live (2-tenant replica): no-app_user JWT -> all empty; ALPHA admin vs
-- BETA company_id -> all empty; ALPHA admin vs own -> data returns; anon
-- verify_login still executes.

CREATE OR REPLACE FUNCTION public.list_clients(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_search TEXT := NULLIF(p_filters->>'search', '');
  v_status TEXT := NULLIF(p_filters->>'status', '');
  v_category TEXT := NULLIF(p_filters->>'category', '');
  v_limit INTEGER := COALESCE((p_filters->>'limit')::INTEGER, 20);
  v_offset INTEGER := COALESCE((p_filters->>'offset')::INTEGER, 0);
  v_total INTEGER; v_rows JSONB;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb, 'limit', v_limit, 'offset', v_offset);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT COUNT(*) INTO v_total FROM public.clients c
  WHERE c.company_id = p_company_id
    AND (v_all OR c.project_id = ANY(v_pids))
    AND (v_status IS NULL OR c.status = v_status)
    AND (v_category IS NULL OR c.client_category = v_category)
    AND (v_search IS NULL OR
         c.full_name ILIKE '%' || v_search || '%' OR
         c.cnic ILIKE '%' || v_search || '%' OR
         c.phone_primary ILIKE '%' || v_search || '%' OR
         c.email ILIKE '%' || v_search || '%' OR
         c.client_code ILIKE '%' || v_search || '%');
  SELECT jsonb_agg(to_jsonb(c) ORDER BY c.full_name) INTO v_rows FROM (
    SELECT c.* FROM public.clients c
    WHERE c.company_id = p_company_id
      AND (v_all OR c.project_id = ANY(v_pids))
      AND (v_status IS NULL OR c.status = v_status)
      AND (v_category IS NULL OR c.client_category = v_category)
      AND (v_search IS NULL OR
           c.full_name ILIKE '%' || v_search || '%' OR
           c.cnic ILIKE '%' || v_search || '%' OR
           c.phone_primary ILIKE '%' || v_search || '%' OR
           c.email ILIKE '%' || v_search || '%' OR
           c.client_code ILIKE '%' || v_search || '%')
    ORDER BY c.full_name LIMIT v_limit OFFSET v_offset
  ) c;
  RETURN jsonb_build_object('total', v_total, 'rows', COALESCE(v_rows, '[]'::JSONB),
    'limit', v_limit, 'offset', v_offset);
END; $function$;

CREATE OR REPLACE FUNCTION public.list_units(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_project_id  UUID   := NULLIF(p_filters->>'project_id',  '')::UUID;
  v_status_id   UUID   := NULLIF(p_filters->>'status_id',   '')::UUID;
  v_type_id     UUID   := NULLIF(p_filters->>'type_id',     '')::UUID;
  v_search      TEXT   := NULLIF(p_filters->>'search',      '');
  v_limit       INTEGER := COALESCE((p_filters->>'limit')::INTEGER,  20);
  v_offset      INTEGER := COALESCE((p_filters->>'offset')::INTEGER,  0);
  v_total       INTEGER;
  v_rows        JSONB;
  v_me          public.app_users := public._rms_caller();
  v_all         boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids        uuid[];
BEGIN
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb, 'limit', v_limit, 'offset', v_offset);
  END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT COUNT(*) INTO v_total FROM public.units u
  WHERE u.company_id = p_company_id
    AND (v_all OR u.project_id = ANY(v_pids))
    AND (v_project_id IS NULL OR u.project_id   = v_project_id)
    AND (v_status_id  IS NULL OR u.status_id    = v_status_id)
    AND (v_type_id    IS NULL OR u.unit_type_id = v_type_id)
    AND (v_search     IS NULL OR u.unit_no ILIKE '%' || v_search || '%'
                              OR u.unit_code ILIKE '%' || v_search || '%');
  SELECT jsonb_agg(to_jsonb(u) ORDER BY u.unit_no) INTO v_rows FROM (
    SELECT u.* FROM public.units u
    WHERE u.company_id = p_company_id
      AND (v_all OR u.project_id = ANY(v_pids))
      AND (v_project_id IS NULL OR u.project_id   = v_project_id)
      AND (v_status_id  IS NULL OR u.status_id    = v_status_id)
      AND (v_type_id    IS NULL OR u.unit_type_id = v_type_id)
      AND (v_search     IS NULL OR u.unit_no ILIKE '%' || v_search || '%'
                                OR u.unit_code ILIKE '%' || v_search || '%')
    ORDER BY u.unit_no LIMIT v_limit OFFSET v_offset
  ) u;
  RETURN jsonb_build_object('total', v_total, 'rows', COALESCE(v_rows, '[]'::JSONB),
    'limit', v_limit, 'offset', v_offset);
END; $function$;

CREATE OR REPLACE FUNCTION public.list_sales(p_company_id uuid, p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids   uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT jsonb_agg(row_to_json(q)) INTO v_result
  FROM (
    SELECT
      s.id, s.sale_number, s.sale_date, s.status,
      s.price_per_sqft, s.area_sqft,
      s.total_amount, s.discount, s.net_amount,
      s.down_payment, s.remaining_amount, s.installment_count,
      u.id AS unit_id, u.unit_no, u.unit_code,
      pr.project_name,
      c.id AS client_id, c.full_name AS client_name,
      ag.id AS agent_id, ag.full_name AS agent_name,
      COUNT(i.id) FILTER (WHERE i.status = 'paid') AS installments_paid,
      COUNT(i.id)                                   AS installments_total,
      COALESCE(SUM(i.amount_paid), 0)               AS total_collected,
      COALESCE(SUM(i.outstanding), s.net_amount)    AS total_outstanding
    FROM      public.sales        s
    LEFT JOIN public.units        u   ON u.id  = s.unit_id
    LEFT JOIN public.projects     pr  ON pr.id = u.project_id
    LEFT JOIN public.clients      c   ON c.id  = s.client_id
    LEFT JOIN public.agents       ag  ON ag.id = s.agent_id
    LEFT JOIN public.installments i   ON i.sale_id = s.id
    WHERE s.company_id = p_company_id
      AND (v_all OR s.project_id = ANY(v_pids))
      AND (p_status IS NULL OR s.status = p_status)
      AND (p_search IS NULL OR p_search = '' OR
           u.unit_no     ILIKE '%' || p_search || '%' OR
           c.full_name   ILIKE '%' || p_search || '%' OR
           s.sale_number ILIKE '%' || p_search || '%')
    GROUP BY s.id, u.id, pr.id, c.id, ag.id
    ORDER BY s.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) q;
  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_sales_filtered(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status text := NULLIF(p_filters->>'status','');
  v_status_in text := NULLIF(p_filters->>'status_in','');
  v_ids_in text := NULLIF(p_filters->>'ids_in','');
  v_discount_gt numeric := COALESCE((p_filters->>'discount_gt')::numeric, NULL);
  v_limit int := COALESCE((p_filters->>'limit')::int, 5000);
  v_result jsonb;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids   uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_result
  FROM (
    SELECT * FROM public.sales
    WHERE company_id = p_company_id
      AND (v_all OR project_id = ANY(v_pids))
      AND (v_status IS NULL OR status = v_status)
      AND (v_status_in IS NULL OR status = ANY(string_to_array(v_status_in, ',')))
      AND (v_ids_in IS NULL OR id::text = ANY(string_to_array(v_ids_in, ',')))
      AND (v_discount_gt IS NULL OR discount > v_discount_gt)
    LIMIT v_limit
  ) s;
  RETURN v_result;
END $function$;

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
  v_all    boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids   uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN '[]'::jsonb; END IF;
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

CREATE OR REPLACE FUNCTION public.list_installments_filtered(p_company_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status_in text := NULLIF(p_filters->>'status_in','');
  v_limit int := COALESCE((p_filters->>'limit')::int, 5000);
  v_result jsonb;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids   uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(i)), '[]'::jsonb) INTO v_result
  FROM (
    SELECT i.* FROM public.installments i
    WHERE i.company_id = p_company_id
      AND (v_all OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = i.sale_id AND s.project_id = ANY(v_pids)))
      AND (v_status_in IS NULL OR i.status = ANY(string_to_array(v_status_in, ',')))
    LIMIT v_limit
  ) i;
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.list_installments_for_search(p_company_id uuid, p_filter text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := CURRENT_DATE;
  v_30    date := CURRENT_DATE + INTERVAL '30 days';
  v_result jsonb;
  v_me    public.app_users := public._rms_caller();
  v_all   boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids  uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id, 'installment_number', i.installment_number, 'due_date', i.due_date,
    'amount_due', i.amount_due, 'outstanding', i.outstanding, 'status', i.status,
    'notes', i.notes, 'sale_id', i.sale_id
  )), '[]'::jsonb) INTO v_result
  FROM (
    SELECT i.* FROM public.installments i
    WHERE i.company_id = p_company_id AND i.status <> 'paid'
      AND (v_all OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = i.sale_id AND s.project_id = ANY(v_pids)))
      AND (p_filter IS NULL
        OR (p_filter = 'overdue' AND i.due_date < v_today)
        OR (p_filter = 'upcoming' AND i.due_date >= v_today AND i.due_date <= v_30)
      )
    ORDER BY i.due_date
    LIMIT 150
  ) i;
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.list_agents(p_company_id uuid, p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_sort text DEFAULT 'name'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_me public.app_users := public._rms_caller();
  v_all boolean := (v_me.company_id = p_company_id AND public._rms_is_admin(v_me));
  v_pids uuid[];
BEGIN
  IF v_me.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;
  SELECT jsonb_agg(row_data ORDER BY
    CASE WHEN p_sort = 'sales' THEN a.total_sales_count END DESC,
    CASE WHEN p_sort = 'commission' THEN a.total_commission_earned END DESC,
    CASE WHEN p_sort = 'name' THEN lower(a.full_name) END ASC)
  INTO v_result
  FROM (
    SELECT a.id, a.project_id, a.agent_code, a.full_name, a.phone, a.email, a.cnic,
      a.address, a.commission_percent, a.status, a.join_date,
      a.profile_photo_url, a.bank_name, a.bank_account_no,
      a.bank_account_title, a.notes, a.rating,
      a.total_sales_count, a.total_sales_amount,
      a.total_commission_earned, a.total_commission_paid,
      a.total_commission_pending, a.created_at, a.updated_at
    FROM public.agents a
    WHERE a.company_id = p_company_id
      AND (v_all OR a.project_id = ANY(v_pids))
      AND (p_status IS NULL OR a.status = p_status)
      AND (p_search IS NULL OR p_search = '' OR
        lower(a.full_name) LIKE '%' || lower(p_search) || '%' OR
        a.phone LIKE '%' || p_search || '%' OR
        lower(COALESCE(a.email, '')) LIKE '%' || lower(p_search) || '%' OR
        lower(COALESCE(a.cnic, '')) LIKE '%' || lower(p_search) || '%' OR
        a.agent_code LIKE '%' || upper(p_search) || '%')
  ) a(id, project_id, agent_code, full_name, phone, email, cnic, address, commission_percent,
      status, join_date, profile_photo_url, bank_name, bank_account_no,
      bank_account_title, notes, rating, total_sales_count, total_sales_amount,
      total_commission_earned, total_commission_paid, total_commission_pending,
      created_at, updated_at),
  LATERAL (SELECT row_to_json(a)::jsonb AS row_data) r;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;
