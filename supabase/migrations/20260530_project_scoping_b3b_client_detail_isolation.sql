-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 3, GROUP 3B: server-side isolation on client DETAIL RPCs
-- 2026-05-30.  ⚠️ REVIEW ONLY — DO NOT APPLY until approved.
-- ════════════════════════════════════════════════════════════
-- Same template as 3A, but for single-row reads: a non-admin asking for a
-- client outside their assigned projects gets no row (null/empty).
-- Anon (no session) stays PERMISSIVE.
--
-- NOTE: get_client_360 takes only p_id (no p_company_id). For it, v_pids is
-- derived from user_project_assignments by user_id alone (a user belongs to
-- one company anyway), and the client's project_id is taken from the row itself.

-- ── 1. get_client_by_id ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_client_by_id(p_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT to_jsonb(c) FROM public.clients c CROSS JOIN cfg
  WHERE c.id = p_id AND c.company_id = p_company_id
    AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids));
$function$;

-- ── 2. get_client_lite ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_client_lite(p_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT jsonb_build_object(
    'id', c.id, 'full_name', c.full_name, 'cnic', c.cnic,
    'phone_primary', c.phone_primary, 'client_code', c.client_code
  )
  FROM public.clients c CROSS JOIN cfg
  WHERE c.id = p_id AND c.company_id = p_company_id
    AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids));
$function$;

-- ── 3. get_client_detail_for_search ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_client_detail_for_search(p_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (me.id IS NULL) OR public._rms_is_admin(me) FROM public._rms_caller() me), true) AS v_all,
      COALESCE(
        (SELECT array_agg(upa.project_id) FROM public._rms_caller() me
         JOIN public.user_project_assignments upa
           ON upa.user_id = me.id AND upa.company_id = p_company_id AND upa.is_active),
        ARRAY[]::uuid[]) AS v_pids
  )
  SELECT jsonb_build_object(
    'full_name', c.full_name, 'cnic', c.cnic, 'phone_primary', c.phone_primary,
    'phone_secondary', c.phone_secondary, 'email', c.email, 'address', c.address,
    'city', c.city, 'father_name', c.father_name, 'next_of_kin_name', c.next_of_kin_name,
    'next_of_kin_relation', c.next_of_kin_relation, 'next_of_kin_phone', c.next_of_kin_phone,
    'overseas_local', c.overseas_local, 'occupation', c.occupation, 'client_category', c.client_category
  )
  FROM public.clients c CROSS JOIN cfg
  WHERE c.id = p_id AND c.company_id = p_company_id
    AND (cfg.v_all OR c.project_id = ANY(cfg.v_pids));
$function$;

-- ── 4. get_client_360 (no p_company_id; v_pids by user_id only) ──
CREATE OR REPLACE FUNCTION public.get_client_360(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_me     public.app_users := public._rms_caller();
  v_all    boolean := (v_me.id IS NULL) OR public._rms_is_admin(v_me);
  v_pids   uuid[];
BEGIN
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE user_id = v_me.id AND is_active;
  END IF;

  SELECT to_jsonb(c) INTO v_result
  FROM public.clients c
  WHERE c.id = p_id
    AND (v_all OR c.project_id = ANY(v_pids));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Client not found');
  END IF;
  RETURN jsonb_build_object('client', v_result);
END; $function$;

-- ── 5. get_client_documents (gate via parent client.project_id) ──
CREATE OR REPLACE FUNCTION public.get_client_documents(p_client_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me       public.app_users;
  v_all      boolean;
  v_pids     uuid[];
  v_proj     uuid;
  v_sales    jsonb;
  v_notices  jsonb;
  v_nocs     jsonb;
  v_receipts jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_session');
  END IF;
  IF v_me.company_id != p_company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  v_all := public._rms_is_admin(v_me);
  IF NOT v_all THEN
    SELECT COALESCE(array_agg(project_id), '{}'::uuid[]) INTO v_pids
    FROM public.user_project_assignments
    WHERE company_id = p_company_id AND user_id = v_me.id AND is_active;
  END IF;

  -- Project gate on the parent client
  SELECT project_id INTO v_proj
  FROM public.clients
  WHERE id = p_client_id AND company_id = p_company_id;
  IF v_proj IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF NOT v_all AND NOT (v_proj = ANY(v_pids)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'doc_type','agreement','label','Sale Agreement',
    'ref',s.sale_number,'date',s.sale_date,'sale_id',s.id,
    'unit_no',u.unit_no,'project',COALESCE(pr.project_name,'')
  ) ORDER BY s.sale_date DESC NULLS LAST), '[]'::jsonb)
  INTO v_sales
  FROM public.sales s
  LEFT JOIN public.units    u  ON u.id  = s.unit_id
  LEFT JOIN public.projects pr ON pr.id = COALESCE(s.project_id, u.project_id)
  WHERE s.client_id = p_client_id AND s.company_id = p_company_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'doc_type','demand_notice','label','Demand Notice',
    'ref',dn.notice_no,'date',dn.notice_date,'sale_id',dn.sale_id,
    'channel',dn.channel,'amount',dn.overdue_amount
  ) ORDER BY dn.created_at DESC), '[]'::jsonb)
  INTO v_notices
  FROM public.demand_notices dn
  WHERE dn.client_id = p_client_id AND dn.company_id = p_company_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'doc_type','noc','label','NOC — '||INITCAP(COALESCE(n.noc_type,'general')),
    'ref',COALESCE(n.noc_number,'NOC-'||LEFT(n.id::text,8)),
    'date',COALESCE(n.approved_at::date,n.requested_at::date),
    'noc_id',n.id,'noc_type',n.noc_type,'status',n.status,'unit_no',n.unit_no
  ) ORDER BY n.requested_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_nocs
  FROM public.noc n
  WHERE n.client_id = p_client_id AND n.company_id = p_company_id AND n.status='approved';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'doc_type','receipt','label','Payment Receipt',
    'ref',COALESCE(p.voucher_code,p.payment_code),'date',p.payment_date,
    'sale_id',p.sale_id,'amount',p.amount,'payment_id',p.id
  ) ORDER BY p.payment_date DESC NULLS LAST), '[]'::jsonb)
  INTO v_receipts
  FROM (
    SELECT p2.* FROM public.payments p2
    JOIN public.sales s2 ON s2.id=p2.sale_id AND s2.client_id=p_client_id
    WHERE p2.company_id=p_company_id AND p2.status IN ('received','cleared')
    ORDER BY p2.payment_date DESC NULLS LAST LIMIT 5
  ) p;

  RETURN jsonb_build_object('success',true,
    'sales',v_sales,'notices',v_notices,
    'nocs',COALESCE(v_nocs,'[]'::jsonb),'receipts',COALESCE(v_receipts,'[]'::jsonb));
END;
$function$;
