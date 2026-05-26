-- ================================================================
-- NEXUNOVA RMS — 10 NEW RPCs FOR LOCKDOWN PREP
-- Created: 2026-05-22
--
-- Replaces direct .from() calls in top 5 pages (clients, sales,
-- payments, units, dashboard) so anon-key REST access to tables
-- can be revoked.
--
-- All RPCs:
--   - SECURITY DEFINER (owner=postgres, bypasses RLS)
--   - First arg: p_company_id uuid (caller must supply own company)
--   - Return jsonb {success: bool, error?: text, data?: ...}
-- ================================================================

-- ----------------------------------------------------------------
-- 1. edit_sale — partial-update sales row with allowlisted columns
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_sale(
  p_sale_id uuid,
  p_company_id uuid,
  p_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'sale_date','notes','client_id','agent_id',
    'price_per_sqft','area_sqft','discount','down_payment','installment_count',
    'co_buyer_name','co_buyer_cnic','co_buyer_share_pct',
    'nominee_name','nominee_cnic','nominee_relation',
    'wht_amount','cvt_amount','discount_approved_by','discount_notes',
    'discount_amount','discount_percentage','payment_plan_type',
    'status','cancellation_reason','cancellation_date','cancelled_by',
    'delivery_breach','breach_months','breach_reason_type','breach_reason_detail',
    'breach_approved_by','breach_approval_ref','breach_approved_at'
  ];
  v_setters text := '';
  v_key text;
  v_sql text;
  v_row record;
BEGIN
  IF p_sale_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_data)
  LOOP
    IF v_key = ANY(v_allowed) THEN
      v_setters := v_setters ||
        format('%I = NULLIF($1->>%L, %L)::%s, ',
          v_key, v_key, '',
          CASE v_key
            WHEN 'sale_date' THEN 'date'
            WHEN 'cancellation_date' THEN 'date'
            WHEN 'breach_approved_at' THEN 'date'
            WHEN 'client_id' THEN 'uuid'
            WHEN 'agent_id' THEN 'uuid'
            WHEN 'price_per_sqft' THEN 'numeric'
            WHEN 'area_sqft' THEN 'numeric'
            WHEN 'discount' THEN 'numeric'
            WHEN 'down_payment' THEN 'numeric'
            WHEN 'installment_count' THEN 'integer'
            WHEN 'co_buyer_share_pct' THEN 'numeric'
            WHEN 'wht_amount' THEN 'numeric'
            WHEN 'cvt_amount' THEN 'numeric'
            WHEN 'discount_amount' THEN 'numeric'
            WHEN 'discount_percentage' THEN 'numeric'
            WHEN 'delivery_breach' THEN 'boolean'
            WHEN 'breach_months' THEN 'integer'
            ELSE 'text'
          END);
    END IF;
  END LOOP;

  IF v_setters = '' THEN
    RETURN jsonb_build_object('success', true, 'updated', 0);
  END IF;

  v_setters := v_setters || 'updated_at = now()';

  v_sql := format('UPDATE sales SET %s WHERE id = %L AND company_id = %L',
                  v_setters, p_sale_id, p_company_id);

  EXECUTE v_sql USING p_data;

  RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_sale(uuid,uuid,jsonb) TO anon, authenticated;


-- ----------------------------------------------------------------
-- 2. edit_installment_schedule — bulk DELETE/INSERT/UPDATE
--    p_schedule: jsonb array of rows. Each row:
--      { id?, installment_number, installment_type, due_date,
--        amount_due, notes, _deleted?, _new? }
--    _deleted=true with id → DELETE
--    _new=true → INSERT (no id)
--    else with id → UPDATE
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_installment_schedule(
  p_sale_id uuid,
  p_company_id uuid,
  p_schedule jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_deleted int := 0;
  v_inserted int := 0;
  v_updated int := 0;
  v_errors text[] := ARRAY[]::text[];
BEGIN
  IF p_sale_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;

  IF jsonb_typeof(p_schedule) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule_must_be_array');
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_schedule)
  LOOP
    BEGIN
      IF (v_row->>'_deleted')::boolean = true AND (v_row->>'id') IS NOT NULL THEN
        DELETE FROM installments
        WHERE id = (v_row->>'id')::uuid
          AND company_id = p_company_id
          AND sale_id = p_sale_id;
        v_deleted := v_deleted + 1;

      ELSIF (v_row->>'_new')::boolean = true THEN
        INSERT INTO installments(
          company_id, sale_id, installment_number, installment_type,
          due_date, amount_due, amount_paid, notes, status
        ) VALUES (
          p_company_id, p_sale_id,
          (v_row->>'installment_number')::int,
          COALESCE(v_row->>'installment_type', 'installment'),
          (v_row->>'due_date')::date,
          (v_row->>'amount_due')::numeric,
          COALESCE((v_row->>'amount_paid')::numeric, 0),
          v_row->>'notes',
          COALESCE(v_row->>'status', 'pending')
        );
        v_inserted := v_inserted + 1;

      ELSIF (v_row->>'id') IS NOT NULL THEN
        UPDATE installments SET
          installment_type = COALESCE(v_row->>'installment_type', installment_type),
          due_date         = COALESCE((v_row->>'due_date')::date, due_date),
          amount_due       = COALESCE((v_row->>'amount_due')::numeric, amount_due),
          notes            = v_row->>'notes',
          updated_at       = now()
        WHERE id = (v_row->>'id')::uuid
          AND company_id = p_company_id
          AND sale_id = p_sale_id;
        v_updated := v_updated + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', array_length(v_errors,1) IS NULL,
    'deleted', v_deleted,
    'inserted', v_inserted,
    'updated', v_updated,
    'errors', to_jsonb(v_errors)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_installment_schedule(uuid,uuid,jsonb) TO anon, authenticated;


-- ----------------------------------------------------------------
-- 3. add_sale_amendment
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_sale_amendment(
  p_company_id uuid,
  p_sale_id uuid,
  p_amendment_type text,
  p_description text,
  p_reason text DEFAULT NULL,
  p_amended_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_sale_id IS NULL OR p_description IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;

  INSERT INTO sale_amendments(company_id, sale_id, amendment_type, description, reason, amended_by, amended_at)
  VALUES (p_company_id, p_sale_id, COALESCE(p_amendment_type,'other'), p_description, p_reason, p_amended_by, now())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_sale_amendment(uuid,uuid,text,text,text,text) TO anon, authenticated;


-- ----------------------------------------------------------------
-- 4. delete_sale_amendment
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_sale_amendment(
  p_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  DELETE FROM sale_amendments WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', v_count > 0, 'deleted', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_sale_amendment(uuid,uuid) TO anon, authenticated;


-- ----------------------------------------------------------------
-- 5. upload_sale_document — records doc metadata. The file upload
--    itself still goes through supabase.storage (bucket rms-documents)
--    which is separate from RLS on this table. This RPC just inserts
--    the row pointing at the uploaded URL.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upload_sale_document(
  p_company_id uuid,
  p_sale_id uuid,
  p_document_type text,
  p_document_name text,
  p_document_url text,
  p_uploaded_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_sale_id IS NULL
     OR p_document_name IS NULL OR p_document_url IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;

  INSERT INTO sale_documents(company_id, sale_id, document_type, document_name, document_url, uploaded_by, uploaded_at)
  VALUES (p_company_id, p_sale_id, COALESCE(p_document_type,'other'), p_document_name, p_document_url, p_uploaded_by, now())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upload_sale_document(uuid,uuid,text,text,text,text) TO anon, authenticated;


-- ----------------------------------------------------------------
-- 6. delete_sale_document
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_sale_document(
  p_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  DELETE FROM sale_documents WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', v_count > 0, 'deleted', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_sale_document(uuid,uuid) TO anon, authenticated;


-- ----------------------------------------------------------------
-- 7. create_pdc_cheque
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_pdc_cheque(
  p_company_id uuid,
  p_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_sale_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  IF p_data->>'cheque_no' IS NULL OR (p_data->>'amount')::numeric IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'cheque_no_and_amount_required');
  END IF;

  v_sale_id := NULLIF(p_data->>'sale_id','')::uuid;
  IF v_sale_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sales WHERE id = v_sale_id AND company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_in_company');
  END IF;

  INSERT INTO pdc_cheques(
    company_id, sale_id, client_id, cheque_no, bank_name, amount,
    cheque_date, received_date, status, notes, created_by
  ) VALUES (
    p_company_id,
    v_sale_id,
    NULLIF(p_data->>'client_id','')::uuid,
    p_data->>'cheque_no',
    p_data->>'bank_name',
    (p_data->>'amount')::numeric,
    NULLIF(p_data->>'cheque_date','')::date,
    NULLIF(p_data->>'received_date','')::date,
    COALESCE(p_data->>'status', 'pending'),
    p_data->>'notes',
    p_data->>'created_by'
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pdc_cheque(uuid,jsonb) TO anon, authenticated;


-- ----------------------------------------------------------------
-- 8. update_pdc_cheque — partial update with column allowlist
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_pdc_cheque(
  p_id uuid,
  p_company_id uuid,
  p_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'cheque_no','bank_name','amount','cheque_date','received_date',
    'status','notes','bounce_reason','bounce_date','penalty_amount',
    'penalty_collected','penalty_date','penalty_notes','deposit_date',
    'clearance_date','sale_id','client_id'
  ];
  v_setters text := '';
  v_key text;
  v_sql text;
BEGIN
  IF p_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pdc_cheques WHERE id = p_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'pdc_not_found');
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_data)
  LOOP
    IF v_key = ANY(v_allowed) THEN
      v_setters := v_setters ||
        format('%I = NULLIF($1->>%L, %L)::%s, ',
          v_key, v_key, '',
          CASE v_key
            WHEN 'amount' THEN 'numeric'
            WHEN 'penalty_amount' THEN 'numeric'
            WHEN 'cheque_date' THEN 'date'
            WHEN 'received_date' THEN 'date'
            WHEN 'bounce_date' THEN 'date'
            WHEN 'penalty_date' THEN 'date'
            WHEN 'deposit_date' THEN 'date'
            WHEN 'clearance_date' THEN 'date'
            WHEN 'sale_id' THEN 'uuid'
            WHEN 'client_id' THEN 'uuid'
            WHEN 'penalty_collected' THEN 'boolean'
            ELSE 'text'
          END);
    END IF;
  END LOOP;

  IF v_setters = '' THEN
    RETURN jsonb_build_object('success', true, 'updated', 0);
  END IF;

  v_setters := v_setters || 'updated_at = now()';

  v_sql := format('UPDATE pdc_cheques SET %s WHERE id = %L AND company_id = %L',
                  v_setters, p_id, p_company_id);

  EXECUTE v_sql USING p_data;

  RETURN jsonb_build_object('success', true, 'id', p_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_pdc_cheque(uuid,uuid,jsonb) TO anon, authenticated;


-- ----------------------------------------------------------------
-- 9. delete_pdc_cheque
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_pdc_cheque(
  p_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  DELETE FROM pdc_cheques WHERE id = p_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', v_count > 0, 'deleted', v_count);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_pdc_cheque(uuid,uuid) TO anon, authenticated;


-- ----------------------------------------------------------------
-- 10. get_dashboard_kpis — returns all dashboard data in one call:
--     - this_month_collection (sum)
--     - prev_month_collection (sum)
--     - recent_payments (last ~6 with unit_id resolved)
--     - trend_6m (6-month payment totals)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start date := date_trunc('month', now())::date;
  v_prev_month_start date := (date_trunc('month', now()) - interval '1 month')::date;
  v_six_mo_ago date := (date_trunc('month', now()) - interval '5 months')::date;
  v_this_month numeric;
  v_prev_month numeric;
  v_recent jsonb;
  v_trend jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_company_id');
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_this_month
  FROM payments
  WHERE company_id = p_company_id AND payment_date >= v_month_start;

  SELECT COALESCE(SUM(amount),0) INTO v_prev_month
  FROM payments
  WHERE company_id = p_company_id
    AND payment_date >= v_prev_month_start
    AND payment_date < v_month_start;

  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT p.id, p.sale_id, p.payment_date, p.amount, p.payment_method,
           s.unit_id AS "unitId"
    FROM payments p
    LEFT JOIN sales s ON s.id = p.sale_id
    WHERE p.company_id = p_company_id
      AND p.payment_date >= v_month_start
    ORDER BY p.payment_date DESC, p.created_at DESC
    LIMIT 6
  ) r;

  WITH month_buckets AS (
    SELECT generate_series(
      v_six_mo_ago,
      v_month_start,
      interval '1 month'
    )::date AS m_start
  ),
  totals AS (
    SELECT date_trunc('month', payment_date)::date AS m, SUM(amount) AS total
    FROM payments
    WHERE company_id = p_company_id
      AND payment_date >= v_six_mo_ago
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
    'month', to_char(mb.m_start, 'Mon'),
    'month_start', mb.m_start,
    'total', COALESCE(t.total, 0)
  ) ORDER BY mb.m_start)
  INTO v_trend
  FROM month_buckets mb
  LEFT JOIN totals t ON t.m = mb.m_start;

  RETURN jsonb_build_object(
    'success', true,
    'this_month_collection', v_this_month,
    'prev_month_collection', v_prev_month,
    'recent_payments', v_recent,
    'trend_6m', v_trend
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis(uuid) TO anon, authenticated;


-- ----------------------------------------------------------------
-- BONUS: list_sales_for_fnav — used by form-nav (sales.js lines 612, 1859, 2213)
-- A lightweight RPC for the form navigator (browse Prev/Next sales).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_sales_for_fnav(
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'sale_date', sale_date)
                            ORDER BY sale_date ASC), '[]'::jsonb)
  FROM (
    SELECT id, sale_date FROM sales
    WHERE company_id = p_company_id AND is_active = true
    ORDER BY sale_date ASC LIMIT 2000
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.list_sales_for_fnav(uuid) TO anon, authenticated;


-- ----------------------------------------------------------------
-- BONUS: get_sale_for_edit — used by sales.js line 1941 (load edit form)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sale_for_edit(
  p_sale_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale jsonb;
  v_installments jsonb;
BEGIN
  SELECT to_jsonb(s) INTO v_sale FROM (
    SELECT id, sale_number, unit_id, client_id, agent_id, sale_date,
           price_per_sqft, area_sqft, total_amount, discount, net_amount,
           down_payment, remaining_amount, notes, co_buyer_name, co_buyer_cnic,
           co_buyer_share_pct, nominee_name, nominee_cnic, nominee_relation,
           wht_amount, cvt_amount, discount_approved_by, discount_notes, status
    FROM sales WHERE id = p_sale_id AND company_id = p_company_id
  ) s;

  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sale_not_found');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(i) ORDER BY i.installment_number), '[]'::jsonb)
  INTO v_installments
  FROM (
    SELECT id, installment_number, installment_type, due_date,
           amount_due, amount_paid, notes, status
    FROM installments
    WHERE sale_id = p_sale_id AND company_id = p_company_id
    ORDER BY installment_number
  ) i;

  RETURN jsonb_build_object('success', true, 'sale', v_sale, 'installments', v_installments);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sale_for_edit(uuid,uuid) TO anon, authenticated;


-- ----------------------------------------------------------------
-- BONUS: get_sale_quick_edit — used by sales.js line 3124 (quick edit modal)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sale_quick_edit(
  p_sale_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(to_jsonb(s), jsonb_build_object('error','sale_not_found'))
  FROM (
    SELECT id, client_id, agent_id, sale_date, notes,
           co_buyer_name, co_buyer_cnic, co_buyer_share_pct,
           nominee_name, nominee_cnic, nominee_relation,
           wht_amount, cvt_amount
    FROM sales WHERE id = p_sale_id AND company_id = p_company_id
  ) s;
$$;

GRANT EXECUTE ON FUNCTION public.get_sale_quick_edit(uuid,uuid) TO anon, authenticated;


-- ----------------------------------------------------------------
-- BONUS: get_sale_documents_amendments — used by sales.js lines 1542-1543
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sale_documents_amendments(
  p_sale_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'documents', COALESCE((
      SELECT jsonb_agg(row_to_json(d) ORDER BY d.uploaded_at DESC)
      FROM (
        SELECT id, sale_id, document_type, document_name, document_url,
               uploaded_by, uploaded_at
        FROM sale_documents
        WHERE sale_id = p_sale_id AND company_id = p_company_id
      ) d
    ), '[]'::jsonb),
    'amendments', COALESCE((
      SELECT jsonb_agg(row_to_json(a) ORDER BY a.amended_at DESC)
      FROM (
        SELECT id, sale_id, amendment_type, description, reason,
               amended_by, amended_at
        FROM sale_amendments
        WHERE sale_id = p_sale_id AND company_id = p_company_id
      ) a
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_sale_documents_amendments(uuid,uuid) TO anon, authenticated;


-- ----------------------------------------------------------------
-- BONUS: get_installment_for_edit — used by sales.js line 3227 (open inst edit modal)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_installment_for_edit(
  p_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(to_jsonb(i), jsonb_build_object('error','installment_not_found'))
  FROM (
    SELECT id, installment_number, installment_type, due_date,
           amount_due, notes, status
    FROM installments
    WHERE id = p_id AND company_id = p_company_id
  ) i;
$$;

GRANT EXECUTE ON FUNCTION public.get_installment_for_edit(uuid,uuid) TO anon, authenticated;


-- ----------------------------------------------------------------
-- BONUS: get_unit_sales_count — used by units.js line 1154 (pre-delete check)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_unit_sales_count(
  p_unit_id uuid,
  p_company_id uuid
)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int FROM sales
  WHERE unit_id = p_unit_id AND company_id = p_company_id AND status = 'active';
$$;

GRANT EXECUTE ON FUNCTION public.get_unit_sales_count(uuid,uuid) TO anon, authenticated;


-- ----------------------------------------------------------------
-- BONUS: get_unit_sale_payments — used by units.js lines 2075-2078
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_unit_sale_payments(
  p_unit_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_payments jsonb;
BEGIN
  SELECT id INTO v_sale_id FROM sales
  WHERE unit_id = p_unit_id AND company_id = p_company_id AND status = 'active'
  LIMIT 1;

  IF v_sale_id IS NULL THEN
    RETURN jsonb_build_object('sale_id', NULL, 'payments', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(p) ORDER BY p.payment_date DESC), '[]'::jsonb)
  INTO v_payments
  FROM (
    SELECT id, payment_date, amount, payment_method, reference_no, notes
    FROM payments
    WHERE sale_id = v_sale_id AND company_id = p_company_id
    ORDER BY payment_date DESC
  ) p;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'payments', v_payments);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unit_sale_payments(uuid,uuid) TO anon, authenticated;


-- ----------------------------------------------------------------
-- BONUS: get_clients_plan_status — used by clients.js lines 182, 184, 1261, 1263
-- Returns: { current_count, max_allowed, can_add }
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_clients_plan_status(
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max int;
  v_count int;
BEGIN
  SELECT sp.max_clients INTO v_max
  FROM subscriptions s
  JOIN subscription_plans sp ON sp.id = s.plan_id
  WHERE s.company_id = p_company_id AND s.status IN ('active','trialing')
  ORDER BY s.created_at DESC NULLS LAST LIMIT 1;

  SELECT COUNT(*)::int INTO v_count FROM clients WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'current_count', v_count,
    'max_allowed', COALESCE(v_max, 0),
    'can_add', v_count < COALESCE(v_max, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_clients_plan_status(uuid) TO anon, authenticated;


-- ----------------------------------------------------------------
-- BONUS: get_units_plan_status — used by units.js lines 218, 220, 1008, 1010, 2443
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_units_plan_status(
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max int;
  v_count int;
BEGIN
  SELECT sp.max_units INTO v_max
  FROM subscriptions s
  JOIN subscription_plans sp ON sp.id = s.plan_id
  WHERE s.company_id = p_company_id AND s.status IN ('active','trialing')
  ORDER BY s.created_at DESC NULLS LAST LIMIT 1;

  SELECT COUNT(*)::int INTO v_count FROM units WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'current_count', v_count,
    'max_allowed', COALESCE(v_max, 0),
    'can_add', v_count < COALESCE(v_max, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_units_plan_status(uuid) TO anon, authenticated;


-- ----------------------------------------------------------------
-- BONUS: get_client_health_score — used by clients.js line 17
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_client_health_score(
  p_client_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(to_jsonb(h), 'null'::jsonb)
  FROM (
    SELECT * FROM client_health_scores
    WHERE client_id = p_client_id AND company_id = p_company_id
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  ) h;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_health_score(uuid,uuid) TO anon, authenticated;
