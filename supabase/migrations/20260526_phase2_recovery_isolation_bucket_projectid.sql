-- =====================================================================
-- Phase 2 — Recovery Queue fixes (applied to itqxljtfbrppntgyfush
-- on 2026-05-26 as migration phase2_recovery_isolation_bucket_projectid):
--
--  (1) MULTI-SITE ISOLATION — get_units_cache_bundle + get_contact_logs_cache
--      now filter by the caller's user_project_assignments for non-admins.
--      These RPCs feed the app-wide caches (units/sales/payments + contact
--      logs); previously they were company-scoped only, so a recovery
--      officer/manager assigned to one site saw every site's data in the
--      Recovery Queue (breached the "A wala B ka data na dekhe" rule).
--      Admin / owner / super-admin (and any no-session caller) bypass.
--
--  (2) STORAGE BUCKET — recovery-documents (mirrors rms-files: public read,
--      authenticated insert). The Log-a-Call wizard uploads attachments
--      here; the bucket didn't exist, so files silently failed to persist.
--
--  (3) project_id TAGGING — create_contact_log / create_payment_promise /
--      create_follow_up_reminder now derive project_id (and client_id/sale_id
--      on the contact log) from the unit's active sale, so the operational
--      recovery tables are tagged for §3 project-scoped queries.
-- =====================================================================

-- ── (2) Storage bucket: recovery-documents (same RLS as rms-files) ────
INSERT INTO storage.buckets (id, name, public)
VALUES ('recovery-documents', 'recovery-documents', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "recovery_docs_authenticated_insert" ON storage.objects;
CREATE POLICY "recovery_docs_authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'recovery-documents');

DROP POLICY IF EXISTS "recovery_docs_public_read" ON storage.objects;
CREATE POLICY "recovery_docs_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'recovery-documents');

-- ── (1) Units cache bundle — project-scoped for non-admin/owner ───────
CREATE OR REPLACE FUNCTION public.get_units_cache_bundle(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me   public.app_users := public._rms_caller();
  v_all  boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids uuid[];
BEGIN
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
        'total_amount', s.total_amount, 'status', s.status))
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
END $fn$;

-- ── (1) Contact-logs cache — project-scoped for non-admin/owner ───────
CREATE OR REPLACE FUNCTION public.get_contact_logs_cache(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me   public.app_users := public._rms_caller();
  v_all  boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids uuid[];
BEGIN
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
END $fn$;

-- ── (3) create_contact_log — derive project_id/client_id/sale_id ──────
CREATE OR REPLACE FUNCTION public.create_contact_log(p_company_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid; v_row jsonb;
  v_unit    uuid := NULLIF(p_data->>'unit_id','')::uuid;
  v_project uuid; v_client uuid; v_sale uuid;
  v_enriched jsonb;
BEGIN
  IF v_unit IS NOT NULL THEN
    SELECT u.project_id INTO v_project
      FROM public.units u WHERE u.id = v_unit AND u.company_id = p_company_id;
    SELECT s.id, s.client_id INTO v_sale, v_client
      FROM public.sales s
      WHERE s.unit_id = v_unit AND s.company_id = p_company_id AND s.status <> 'cancelled'
      ORDER BY s.sale_date DESC NULLS LAST LIMIT 1;
  END IF;

  v_enriched := p_data
    || jsonb_build_object('company_id', p_company_id)
    || jsonb_strip_nulls(jsonb_build_object(
         'project_id', COALESCE(NULLIF(p_data->>'project_id','')::uuid, v_project),
         'client_id',  COALESCE(NULLIF(p_data->>'client_id','')::uuid,  v_client),
         'sale_id',    COALESCE(NULLIF(p_data->>'sale_id','')::uuid,     v_sale)));

  INSERT INTO public.contact_logs
  SELECT * FROM jsonb_populate_record(NULL::public.contact_logs, v_enriched)
  RETURNING id INTO v_id;

  SELECT to_jsonb(cl) INTO v_row FROM public.contact_logs cl WHERE cl.id = v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id, 'row', v_row);
END $fn$;

-- ── (3) create_payment_promise — derive project_id ───────────────────
CREATE OR REPLACE FUNCTION public.create_payment_promise(p_company_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_sale    uuid := NULLIF(p_data->>'sale_id','')::uuid;
  v_project uuid;
  v_enriched jsonb;
BEGIN
  IF v_sale IS NOT NULL THEN
    SELECT COALESCE(s.project_id, u.project_id) INTO v_project
      FROM public.sales s LEFT JOIN public.units u ON u.id = s.unit_id
      WHERE s.id = v_sale AND s.company_id = p_company_id;
  END IF;

  v_enriched := p_data
    || jsonb_build_object('company_id', p_company_id)
    || jsonb_strip_nulls(jsonb_build_object(
         'project_id', COALESCE(NULLIF(p_data->>'project_id','')::uuid, v_project)));

  INSERT INTO public.payment_promises
  SELECT * FROM jsonb_populate_record(NULL::public.payment_promises, v_enriched)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $fn$;

-- ── (3) create_follow_up_reminder — derive project_id ────────────────
CREATE OR REPLACE FUNCTION public.create_follow_up_reminder(p_company_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_unit    uuid := NULLIF(p_data->>'unit_id','')::uuid;
  v_sale    uuid := NULLIF(p_data->>'sale_id','')::uuid;
  v_project uuid := NULLIF(p_data->>'project_id','')::uuid;
BEGIN
  IF v_project IS NULL AND v_unit IS NOT NULL THEN
    SELECT u.project_id INTO v_project
      FROM public.units u WHERE u.id = v_unit AND u.company_id = p_company_id;
  END IF;
  IF v_project IS NULL AND v_sale IS NOT NULL THEN
    SELECT COALESCE(s.project_id, u.project_id) INTO v_project
      FROM public.sales s LEFT JOIN public.units u ON u.id = s.unit_id
      WHERE s.id = v_sale AND s.company_id = p_company_id;
  END IF;

  INSERT INTO public.follow_up_reminders (
    company_id, contact_log_id, unit_id, client_id, sale_id, project_id,
    remind_at, channels, message, status, created_by
  ) VALUES (
    p_company_id,
    NULLIF(p_data->>'contact_log_id','')::uuid,
    v_unit,
    NULLIF(p_data->>'client_id','')::uuid,
    v_sale,
    v_project,
    (p_data->>'remind_at')::timestamptz,
    CASE WHEN p_data->'channels' IS NULL THEN '{}'::text[]
         ELSE ARRAY(SELECT jsonb_array_elements_text(p_data->'channels')) END,
    NULLIF(p_data->>'message',''),
    COALESCE(p_data->>'status', 'pending'),
    NULLIF(p_data->>'created_by','')
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END $fn$;
