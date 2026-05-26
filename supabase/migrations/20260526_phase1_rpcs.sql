-- ============================================================================
-- Migration: 20260526_phase1_rpcs
-- STATUS: APPLIED 2026-05-26 via Supabase MCP (migration: phase1_rpcs_20260526). Verified (30/30).
--
-- SECURITY DEFINER RPC layer for the 10 Phase-1 tables (see NEXUNOVA_RMS_MASTER_CONTEXT.md).
-- Conventions (match existing codebase):
--   RETURNS jsonb · SECURITY DEFINER · SET search_path TO 'public'
--   { success: bool, ... } envelope · EXCEPTION WHEN OTHERS -> error envelope
--   caller resolved from auth.uid() -> app_users.auth_user_id (NEVER app_users.id)
-- Every RPC: resolves the caller, enforces company_id isolation, and checks role
--   before mutating. Admin = is_super_admin OR role IN ('owner','admin')
--   OR companies.owner_user_id = caller.id.
-- 28 RPCs across 8 feature areas + 2 internal helpers.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- Internal helpers
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._rms_caller()
RETURNS public.app_users
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT * FROM public.app_users
  WHERE auth_user_id = auth.uid() AND status = 'active'
  LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public._rms_is_admin(p_user public.app_users)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(p_user.is_super_admin, false)
      OR p_user.role IN ('owner','admin')
      OR EXISTS (SELECT 1 FROM public.companies c
                 WHERE c.id = p_user.company_id AND c.owner_user_id = p_user.id);
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. user_project_assignments
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.assign_user_to_project(
  p_user_id uuid, p_project_id uuid, p_access_level text DEFAULT 'view', p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_id uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin only.'); END IF;
  IF COALESCE(p_access_level,'view') NOT IN ('view','edit','manage') THEN
    RETURN jsonb_build_object('success',false,'error','bad_access_level'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE id=p_user_id AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','user_not_in_company'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id=p_project_id AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','project_not_in_company'); END IF;

  INSERT INTO public.user_project_assignments
    (company_id, user_id, project_id, access_level, is_active, assigned_by, assigned_at, revoked_at, notes)
  VALUES (v_me.company_id, p_user_id, p_project_id, p_access_level, true, v_me.id, now(), NULL, p_notes)
  ON CONFLICT (user_id, project_id) DO UPDATE SET
    access_level = EXCLUDED.access_level,
    is_active    = true,
    revoked_at   = NULL,
    assigned_by  = v_me.id,
    assigned_at  = now(),
    notes        = COALESCE(EXCLUDED.notes, public.user_project_assignments.notes)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'id',v_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.revoke_user_project(p_user_id uuid, p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_n int;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin only.'); END IF;

  UPDATE public.user_project_assignments
     SET is_active=false, revoked_at=now()
   WHERE company_id=v_me.company_id AND user_id=p_user_id AND project_id=p_project_id AND is_active;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success',true,'revoked',v_n);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.get_user_projects(p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_target uuid; v_target_admin boolean; v_rows jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  v_target := COALESCE(p_user_id, v_me.id);
  IF v_target <> v_me.id AND NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE id=v_target AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','user_not_in_company'); END IF;

  SELECT public._rms_is_admin(au) INTO v_target_admin FROM public.app_users au WHERE au.id=v_target;

  IF v_target_admin THEN
    -- Admin/owner sees every project in the company (isolation bypass within company).
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'project_id',p.id,'project_name',p.project_name,'project_code',p.project_code,
      'access_level','manage','is_active',true) ORDER BY p.project_name), '[]'::jsonb)
    INTO v_rows FROM public.projects p WHERE p.company_id=v_me.company_id;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'project_id',p.id,'project_name',p.project_name,'project_code',p.project_code,
      'access_level',upa.access_level,'is_active',upa.is_active) ORDER BY p.project_name), '[]'::jsonb)
    INTO v_rows
    FROM public.user_project_assignments upa
    JOIN public.projects p ON p.id=upa.project_id
    WHERE upa.company_id=v_me.company_id AND upa.user_id=v_target AND upa.is_active;
  END IF;

  RETURN jsonb_build_object('success',true,'is_admin',v_target_admin,'rows',v_rows);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.get_project_users(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_rows jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id=p_project_id AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','project_not_in_company'); END IF;
  IF NOT public._rms_is_admin(v_me)
     AND NOT EXISTS (SELECT 1 FROM public.user_project_assignments
                     WHERE user_id=v_me.id AND project_id=p_project_id AND is_active) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'assignment_id',upa.id,'user_id',u.id,'full_name',u.full_name,'role',u.role,
    'access_level',upa.access_level,'is_active',upa.is_active,'assigned_at',upa.assigned_at)
    ORDER BY u.full_name), '[]'::jsonb)
  INTO v_rows
  FROM public.user_project_assignments upa
  JOIN public.app_users u ON u.id=upa.user_id
  WHERE upa.company_id=v_me.company_id AND upa.project_id=p_project_id AND upa.is_active;

  RETURN jsonb_build_object('success',true,'rows',v_rows);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. approval_requests  (single-approver = Admin; both parties must comment)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_approval_request(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users; v_id uuid; v_approver uuid;
  v_comment text := NULLIF(TRIM(p_data->>'comment'), '');
  v_project uuid := NULLIF(p_data->>'project_id','')::uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NULLIF(TRIM(p_data->>'request_type'),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','request_type_required'); END IF;
  IF NULLIF(TRIM(p_data->>'title'),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','title_required'); END IF;
  -- Maker MUST justify with a comment.
  IF v_comment IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','comment_required',
      'message','A justification comment is required to submit a request.'); END IF;
  IF v_project IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id=v_project AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','project_not_in_company'); END IF;

  -- Resolve the single approver: company owner, else first active owner/admin.
  SELECT owner_user_id INTO v_approver FROM public.companies WHERE id=v_me.company_id;
  IF v_approver IS NULL THEN
    SELECT id INTO v_approver FROM public.app_users
     WHERE company_id=v_me.company_id AND role IN ('owner','admin') AND status='active'
     ORDER BY created_at LIMIT 1;
  END IF;

  INSERT INTO public.approval_requests
    (company_id, request_type, entity_table, entity_id, project_id, title, description,
     payload, amount, status, priority, requested_by, requested_at, current_approver_id)
  VALUES (
    v_me.company_id, p_data->>'request_type', NULLIF(p_data->>'entity_table',''),
    NULLIF(p_data->>'entity_id','')::uuid, v_project, p_data->>'title', NULLIF(p_data->>'description',''),
    COALESCE(p_data->'payload','{}'::jsonb), NULLIF(p_data->>'amount','')::numeric,
    'pending', COALESCE(NULLIF(p_data->>'priority',''),'normal'), v_me.id, now(), v_approver)
  RETURNING id INTO v_id;

  INSERT INTO public.approval_request_comments (company_id, request_id, author_id, action, comment)
  VALUES (v_me.company_id, v_id, v_me.id, 'comment', v_comment);

  RETURN jsonb_build_object('success',true,'id',v_id,'current_approver_id',v_approver);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.get_pending_approvals(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_admin boolean; v_rows jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  v_admin := public._rms_is_admin(v_me);

  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'requested_at'), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id',ar.id,'request_type',ar.request_type,'title',ar.title,'description',ar.description,
      'amount',ar.amount,'priority',ar.priority,'status',ar.status,'project_id',ar.project_id,
      'requested_by',ar.requested_by,'requested_by_name',u.full_name,'requested_at',ar.requested_at,
      'entity_table',ar.entity_table,'entity_id',ar.entity_id) AS r, ar.requested_at
    FROM public.approval_requests ar
    LEFT JOIN public.app_users u ON u.id=ar.requested_by
    WHERE ar.company_id=v_me.company_id AND ar.status='pending'
      AND (v_admin OR ar.requested_by = v_me.id)   -- admin sees the queue; others see only their own
    ORDER BY ar.requested_at
  ) q;

  RETURN jsonb_build_object('success',true,'is_admin',v_admin,'rows',v_rows);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.approve_request(p_request_id uuid, p_comment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_req public.approval_requests; v_comment text := NULLIF(TRIM(p_comment),'');
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Only the Admin can approve.'); END IF;
  IF v_comment IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','comment_required',
      'message','A comment is required to approve.'); END IF;

  SELECT * INTO v_req FROM public.approval_requests WHERE id=p_request_id;
  IF NOT FOUND OR v_req.company_id <> v_me.company_id THEN
    RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('success',false,'error','not_pending','message','Already '||v_req.status||'.'); END IF;

  UPDATE public.approval_requests
     SET status='approved', decided_by=v_me.id, decided_at=now(), decision_comment=v_comment
   WHERE id=p_request_id;
  INSERT INTO public.approval_request_comments (company_id, request_id, author_id, action, comment)
  VALUES (v_me.company_id, p_request_id, v_me.id, 'approved', v_comment);

  -- NOTE: applying the payload to the target entity is request_type-specific and is
  -- handled by the Phase-3 dispatcher; this RPC records the decision only.
  RETURN jsonb_build_object('success',true,'status','approved',
    'entity_table',v_req.entity_table,'entity_id',v_req.entity_id,'payload',v_req.payload);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.reject_request(p_request_id uuid, p_comment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_req public.approval_requests; v_comment text := NULLIF(TRIM(p_comment),'');
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Only the Admin can reject.'); END IF;
  IF v_comment IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','comment_required',
      'message','A comment is required to reject.'); END IF;

  SELECT * INTO v_req FROM public.approval_requests WHERE id=p_request_id;
  IF NOT FOUND OR v_req.company_id <> v_me.company_id THEN
    RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('success',false,'error','not_pending','message','Already '||v_req.status||'.'); END IF;

  UPDATE public.approval_requests
     SET status='rejected', decided_by=v_me.id, decided_at=now(), decision_comment=v_comment
   WHERE id=p_request_id;
  INSERT INTO public.approval_request_comments (company_id, request_id, author_id, action, comment)
  VALUES (v_me.company_id, p_request_id, v_me.id, 'rejected', v_comment);

  RETURN jsonb_build_object('success',true,'status','rejected');
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.get_approval_history(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users; v_admin boolean; v_rows jsonb; v_comments jsonb;
  v_req_id   uuid    := NULLIF(p_filters->>'request_id','')::uuid;
  v_status   text    := NULLIF(p_filters->>'status','');
  v_type     text    := NULLIF(p_filters->>'request_type','');
  v_entity_t text    := NULLIF(p_filters->>'entity_table','');
  v_entity_i uuid    := NULLIF(p_filters->>'entity_id','')::uuid;
  v_limit    int     := COALESCE((p_filters->>'limit')::int, 50);
  v_offset   int     := COALESCE((p_filters->>'offset')::int, 0);
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  v_admin := public._rms_is_admin(v_me);

  -- Single request detail (with full comment thread)
  IF v_req_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.approval_requests
                   WHERE id=v_req_id AND company_id=v_me.company_id
                     AND (v_admin OR requested_by=v_me.id)) THEN
      RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',c.id,'author_id',c.author_id,'author_name',u.full_name,'action',c.action,
      'comment',c.comment,'created_at',c.created_at) ORDER BY c.created_at), '[]'::jsonb)
    INTO v_comments
    FROM public.approval_request_comments c LEFT JOIN public.app_users u ON u.id=c.author_id
    WHERE c.request_id=v_req_id;
    RETURN (SELECT jsonb_build_object('success',true,
              'request', to_jsonb(ar), 'comments', v_comments)
            FROM public.approval_requests ar WHERE ar.id=v_req_id);
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'requested_at' DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id',ar.id,'request_type',ar.request_type,'title',ar.title,'amount',ar.amount,
      'status',ar.status,'priority',ar.priority,'project_id',ar.project_id,
      'requested_by_name',ru.full_name,'requested_at',ar.requested_at,
      'decided_by_name',du.full_name,'decided_at',ar.decided_at,'decision_comment',ar.decision_comment,
      'comment_count',(SELECT count(*) FROM public.approval_request_comments c WHERE c.request_id=ar.id)) AS r
    FROM public.approval_requests ar
    LEFT JOIN public.app_users ru ON ru.id=ar.requested_by
    LEFT JOIN public.app_users du ON du.id=ar.decided_by
    WHERE ar.company_id=v_me.company_id
      AND (v_admin OR ar.requested_by=v_me.id)
      AND (v_status   IS NULL OR ar.status=v_status)
      AND (v_type     IS NULL OR ar.request_type=v_type)
      AND (v_entity_t IS NULL OR ar.entity_table=v_entity_t)
      AND (v_entity_i IS NULL OR ar.entity_id=v_entity_i)
    ORDER BY ar.requested_at DESC
    LIMIT v_limit OFFSET v_offset
  ) q;

  RETURN jsonb_build_object('success',true,'is_admin',v_admin,'rows',v_rows);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. company_setup_progress  (6 steps, no-skip, draft-save)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_setup_progress()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_rows jsonb; v_complete boolean;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;

  -- Seed the 6 mandatory steps on first read.
  IF NOT EXISTS (SELECT 1 FROM public.company_setup_progress WHERE company_id=v_me.company_id) THEN
    INSERT INTO public.company_setup_progress (company_id, step_key, status, sort_order) VALUES
      (v_me.company_id,'company_profile','pending',1),
      (v_me.company_id,'branding','pending',2),
      (v_me.company_id,'projects','pending',3),
      (v_me.company_id,'users','pending',4),
      (v_me.company_id,'payment_methods','pending',5),
      (v_me.company_id,'categories','pending',6)
    ON CONFLICT (company_id, step_key) DO NOTHING;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'step_key',step_key,'status',status,'sort_order',sort_order,'data',data,
    'completed_at',completed_at,'completed_by',completed_by) ORDER BY sort_order), '[]'::jsonb)
  INTO v_rows FROM public.company_setup_progress WHERE company_id=v_me.company_id;

  SELECT onboarding_complete INTO v_complete FROM public.companies WHERE id=v_me.company_id;
  RETURN jsonb_build_object('success',true,'onboarding_complete',COALESCE(v_complete,false),'steps',v_rows);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.update_setup_step(
  p_step_key text, p_data jsonb DEFAULT '{}'::jsonb, p_status text DEFAULT 'in_progress')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_order int;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin only.'); END IF;
  IF p_step_key NOT IN ('company_profile','branding','projects','users','payment_methods','categories') THEN
    RETURN jsonb_build_object('success',false,'error','bad_step_key'); END IF;
  IF COALESCE(p_status,'in_progress') NOT IN ('pending','in_progress','completed') THEN
    RETURN jsonb_build_object('success',false,'error','bad_status'); END IF;

  v_order := CASE p_step_key
    WHEN 'company_profile' THEN 1 WHEN 'branding' THEN 2 WHEN 'projects' THEN 3
    WHEN 'users' THEN 4 WHEN 'payment_methods' THEN 5 ELSE 6 END;

  INSERT INTO public.company_setup_progress (company_id, step_key, status, data, sort_order,
    completed_by, completed_at)
  VALUES (v_me.company_id, p_step_key, p_status, COALESCE(p_data,'{}'::jsonb), v_order,
    CASE WHEN p_status='completed' THEN v_me.id END,
    CASE WHEN p_status='completed' THEN now() END)
  ON CONFLICT (company_id, step_key) DO UPDATE SET
    status       = EXCLUDED.status,
    data         = public.company_setup_progress.data || COALESCE(p_data,'{}'::jsonb),  -- merge draft
    completed_by = CASE WHEN EXCLUDED.status='completed' THEN v_me.id ELSE public.company_setup_progress.completed_by END,
    completed_at = CASE WHEN EXCLUDED.status='completed' THEN now() ELSE public.company_setup_progress.completed_at END,
    updated_at   = now();

  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.complete_setup_step(p_step_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_order int; v_unfinished int; v_remaining int;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin only.'); END IF;
  IF p_step_key NOT IN ('company_profile','branding','projects','users','payment_methods','categories') THEN
    RETURN jsonb_build_object('success',false,'error','bad_step_key'); END IF;

  v_order := CASE p_step_key
    WHEN 'company_profile' THEN 1 WHEN 'branding' THEN 2 WHEN 'projects' THEN 3
    WHEN 'users' THEN 4 WHEN 'payment_methods' THEN 5 ELSE 6 END;

  -- No-skip: every earlier step must already be completed.
  SELECT count(*) INTO v_unfinished FROM public.company_setup_progress
   WHERE company_id=v_me.company_id AND sort_order < v_order AND status <> 'completed';
  IF v_unfinished > 0 THEN
    RETURN jsonb_build_object('success',false,'error','previous_steps_incomplete',
      'message','Complete the earlier steps first.'); END IF;

  INSERT INTO public.company_setup_progress (company_id, step_key, status, sort_order, completed_by, completed_at)
  VALUES (v_me.company_id, p_step_key, 'completed', v_order, v_me.id, now())
  ON CONFLICT (company_id, step_key) DO UPDATE SET
    status='completed', completed_by=v_me.id, completed_at=now(), updated_at=now();

  -- When all 6 are done, flip the company-level flag.
  SELECT count(*) INTO v_remaining FROM public.company_setup_progress
   WHERE company_id=v_me.company_id AND status <> 'completed';
  IF v_remaining = 0 THEN
    UPDATE public.companies SET onboarding_complete=true, updated_at=now() WHERE id=v_me.company_id;
  END IF;

  RETURN jsonb_build_object('success',true,'onboarding_complete',(v_remaining=0));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. company_password_policies
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_password_policy()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_row public.company_password_policies;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;

  SELECT * INTO v_row FROM public.company_password_policies WHERE company_id=v_me.company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',true,'is_default',true,'policy',jsonb_build_object(
      'min_length',8,'require_uppercase',true,'require_lowercase',true,'require_number',true,
      'require_symbol',false,'expiry_days',90,'history_count',3,
      'force_change_on_first_login',true,'expiry_warning_days',7)); END IF;

  RETURN jsonb_build_object('success',true,'is_default',false,'policy',to_jsonb(v_row));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.update_password_policy(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin only.'); END IF;

  INSERT INTO public.company_password_policies (
    company_id, min_length, require_uppercase, require_lowercase, require_number, require_symbol,
    expiry_days, history_count, force_change_on_first_login, expiry_warning_days, updated_by, updated_at)
  VALUES (
    v_me.company_id,
    COALESCE((p_data->>'min_length')::int, 8),
    COALESCE((p_data->>'require_uppercase')::boolean, true),
    COALESCE((p_data->>'require_lowercase')::boolean, true),
    COALESCE((p_data->>'require_number')::boolean, true),
    COALESCE((p_data->>'require_symbol')::boolean, false),
    COALESCE((p_data->>'expiry_days')::int, 90),
    COALESCE((p_data->>'history_count')::int, 3),
    COALESCE((p_data->>'force_change_on_first_login')::boolean, true),
    COALESCE((p_data->>'expiry_warning_days')::int, 7),
    v_me.id, now())
  ON CONFLICT (company_id) DO UPDATE SET
    min_length                  = COALESCE((p_data->>'min_length')::int, public.company_password_policies.min_length),
    require_uppercase           = COALESCE((p_data->>'require_uppercase')::boolean, public.company_password_policies.require_uppercase),
    require_lowercase           = COALESCE((p_data->>'require_lowercase')::boolean, public.company_password_policies.require_lowercase),
    require_number              = COALESCE((p_data->>'require_number')::boolean, public.company_password_policies.require_number),
    require_symbol              = COALESCE((p_data->>'require_symbol')::boolean, public.company_password_policies.require_symbol),
    expiry_days                 = COALESCE((p_data->>'expiry_days')::int, public.company_password_policies.expiry_days),
    history_count               = COALESCE((p_data->>'history_count')::int, public.company_password_policies.history_count),
    force_change_on_first_login = COALESCE((p_data->>'force_change_on_first_login')::boolean, public.company_password_policies.force_change_on_first_login),
    expiry_warning_days         = COALESCE((p_data->>'expiry_warning_days')::int, public.company_password_policies.expiry_warning_days),
    updated_by                  = v_me.id,
    updated_at                  = now();

  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. user_sessions
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_session(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_id uuid; v_hash text := NULLIF(p_data->>'session_token_hash','');
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_hash IS NULL THEN RETURN jsonb_build_object('success',false,'error','token_hash_required'); END IF;

  INSERT INTO public.user_sessions (
    company_id, user_id, session_token_hash, device_label, device_type, user_agent,
    ip_address, location, session_version, is_current, last_seen_at, expires_at)
  VALUES (
    v_me.company_id, v_me.id, v_hash,
    NULLIF(p_data->>'device_label',''), NULLIF(p_data->>'device_type',''),
    LEFT(NULLIF(p_data->>'user_agent',''),500),
    NULLIF(p_data->>'ip_address','')::inet, NULLIF(p_data->>'location',''),
    v_me.session_version, true, now(), NULLIF(p_data->>'expires_at','')::timestamptz)
  ON CONFLICT (session_token_hash) DO UPDATE SET
    last_seen_at = now(), is_current = true, revoked_at = NULL
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'id',v_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.get_active_sessions(p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_target uuid; v_rows jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  v_target := COALESCE(p_user_id, v_me.id);
  IF v_target <> v_me.id AND NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',s.id,'user_id',s.user_id,'device_label',s.device_label,'device_type',s.device_type,
    'ip_address',s.ip_address,'location',s.location,'is_current',s.is_current,
    'last_seen_at',s.last_seen_at,'created_at',s.created_at,'expires_at',s.expires_at)
    ORDER BY s.last_seen_at DESC), '[]'::jsonb)  -- token hash deliberately NOT returned
  INTO v_rows
  FROM public.user_sessions s
  WHERE s.company_id=v_me.company_id AND s.user_id=v_target AND s.revoked_at IS NULL;

  RETURN jsonb_build_object('success',true,'rows',v_rows);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.revoke_session(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_sess public.user_sessions;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;

  SELECT * INTO v_sess FROM public.user_sessions WHERE id=p_session_id;
  IF NOT FOUND OR v_sess.company_id <> v_me.company_id THEN
    RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_sess.user_id <> v_me.id AND NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  UPDATE public.user_sessions
     SET revoked_at=now(), revoked_by=v_me.id, is_current=false
   WHERE id=p_session_id AND revoked_at IS NULL;
  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.revoke_all_sessions(p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_target uuid; v_n int;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  v_target := COALESCE(p_user_id, v_me.id);
  IF v_target <> v_me.id AND NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE id=v_target AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','user_not_in_company'); END IF;

  UPDATE public.user_sessions
     SET revoked_at=now(), revoked_by=v_me.id, is_current=false
   WHERE company_id=v_me.company_id AND user_id=v_target AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- Bump session_version to invalidate any token tied to the old version (global kill-switch).
  UPDATE public.app_users SET session_version = session_version + 1 WHERE id=v_target;

  RETURN jsonb_build_object('success',true,'revoked',v_n);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. recovery_officer_targets
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_officer_target(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users; v_id uuid;
  v_agent uuid := NULLIF(p_data->>'recovery_agent_id','')::uuid;
  v_project uuid := NULLIF(p_data->>'project_id','')::uuid;
  v_year smallint := (p_data->>'year')::smallint;
  v_month smallint := (p_data->>'month')::smallint;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin only.'); END IF;
  IF v_agent IS NULL OR v_year IS NULL OR v_month IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','missing_fields'); END IF;
  IF v_month < 1 OR v_month > 12 THEN
    RETURN jsonb_build_object('success',false,'error','bad_month'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recovery_agents WHERE id=v_agent AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','agent_not_in_company'); END IF;
  IF v_project IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id=v_project AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','project_not_in_company'); END IF;

  -- IS NOT DISTINCT FROM handles the nullable project_id (the UNIQUE index won't catch NULLs).
  UPDATE public.recovery_officer_targets SET
    target_amount   = COALESCE((p_data->>'target_amount')::numeric, target_amount),
    target_calls    = COALESCE((p_data->>'target_calls')::int, target_calls),
    target_promises = COALESCE((p_data->>'target_promises')::int, target_promises),
    notes           = COALESCE(NULLIF(p_data->>'notes',''), notes),
    set_by          = v_me.id,
    updated_at      = now()
  WHERE company_id=v_me.company_id AND recovery_agent_id=v_agent
    AND project_id IS NOT DISTINCT FROM v_project AND year=v_year AND month=v_month
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.recovery_officer_targets
      (company_id, recovery_agent_id, project_id, year, month,
       target_amount, target_calls, target_promises, notes, set_by)
    VALUES (v_me.company_id, v_agent, v_project, v_year, v_month,
       COALESCE((p_data->>'target_amount')::numeric,0),
       COALESCE((p_data->>'target_calls')::int,0),
       COALESCE((p_data->>'target_promises')::int,0),
       NULLIF(p_data->>'notes',''), v_me.id)
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('success',true,'id',v_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.get_officer_targets(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users; v_admin boolean; v_self_agent uuid; v_rows jsonb;
  v_agent   uuid     := NULLIF(p_filters->>'recovery_agent_id','')::uuid;
  v_project uuid     := NULLIF(p_filters->>'project_id','')::uuid;
  v_year    smallint := NULLIF(p_filters->>'year','')::smallint;
  v_month   smallint := NULLIF(p_filters->>'month','')::smallint;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  v_admin := public._rms_is_admin(v_me);
  -- A recovery officer may only see their own targets.
  IF NOT v_admin THEN
    SELECT id INTO v_self_agent FROM public.recovery_agents
     WHERE company_id=v_me.company_id AND user_id=v_me.id LIMIT 1;
    IF v_self_agent IS NULL THEN
      RETURN jsonb_build_object('success',true,'rows','[]'::jsonb); END IF;
    v_agent := v_self_agent;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',t.id,'recovery_agent_id',t.recovery_agent_id,'agent_name',a.full_name,
    'project_id',t.project_id,'year',t.year,'month',t.month,
    'target_amount',t.target_amount,'target_calls',t.target_calls,'target_promises',t.target_promises,
    'achieved_amount',t.achieved_amount,'achieved_calls',t.achieved_calls,'achieved_promises',t.achieved_promises,
    'amount_pct', CASE WHEN t.target_amount>0 THEN round(t.achieved_amount/t.target_amount*100,1) ELSE NULL END,
    'notes',t.notes) ORDER BY t.year DESC, t.month DESC, a.full_name), '[]'::jsonb)
  INTO v_rows
  FROM public.recovery_officer_targets t
  JOIN public.recovery_agents a ON a.id=t.recovery_agent_id
  WHERE t.company_id=v_me.company_id
    AND (v_agent   IS NULL OR t.recovery_agent_id=v_agent)
    AND (v_project IS NULL OR t.project_id=v_project)
    AND (v_year    IS NULL OR t.year=v_year)
    AND (v_month   IS NULL OR t.month=v_month);

  RETURN jsonb_build_object('success',true,'rows',v_rows);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.update_target_achieved(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_n int;
  v_agent uuid := NULLIF(p_data->>'recovery_agent_id','')::uuid;
  v_project uuid := NULLIF(p_data->>'project_id','')::uuid;
  v_year smallint := (p_data->>'year')::smallint;
  v_month smallint := (p_data->>'month')::smallint;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin only.'); END IF;
  IF v_agent IS NULL OR v_year IS NULL OR v_month IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','missing_fields'); END IF;

  UPDATE public.recovery_officer_targets SET
    achieved_amount   = COALESCE((p_data->>'achieved_amount')::numeric, achieved_amount),
    achieved_calls    = COALESCE((p_data->>'achieved_calls')::int, achieved_calls),
    achieved_promises = COALESCE((p_data->>'achieved_promises')::int, achieved_promises),
    updated_at        = now()
  WHERE company_id=v_me.company_id AND recovery_agent_id=v_agent
    AND project_id IS NOT DISTINCT FROM v_project AND year=v_year AND month=v_month;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('success',false,'error','target_not_found'); END IF;
  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. holidays
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.seed_pakistan_holidays(p_year integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_n int := 0;
  v_fixed CONSTANT jsonb := jsonb_build_array(
    jsonb_build_object('m',2,'d',5, 'name','Kashmir Solidarity Day'),
    jsonb_build_object('m',3,'d',23,'name','Pakistan Day'),
    jsonb_build_object('m',5,'d',1, 'name','Labour Day'),
    jsonb_build_object('m',8,'d',14,'name','Independence Day'),
    jsonb_build_object('m',11,'d',9,'name','Iqbal Day'),
    jsonb_build_object('m',12,'d',25,'name','Quaid-e-Azam Day / Christmas'));
  v_item jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin only.'); END IF;
  IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
    RETURN jsonb_build_object('success',false,'error','bad_year'); END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_fixed) LOOP
    INSERT INTO public.holidays (company_id, holiday_date, name, holiday_type, country,
      is_recurring, is_working_day, created_by)
    VALUES (v_me.company_id,
      make_date(p_year, (v_item->>'m')::int, (v_item->>'d')::int),
      v_item->>'name', 'national', 'Pakistan', true, false, v_me.id)
    ON CONFLICT (company_id, holiday_date, name) DO NOTHING;
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;

  -- NOTE: lunar/religious holidays (Eid-ul-Fitr, Eid-ul-Adha, Ashura, Eid Milad) shift yearly
  -- and must be added per-year via add_holiday().
  RETURN jsonb_build_object('success',true,'inserted',v_n,'year',p_year);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.get_holidays(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_rows jsonb;
  v_year smallint := NULLIF(p_filters->>'year','')::smallint;
  v_from date := NULLIF(p_filters->>'from','')::date;
  v_to   date := NULLIF(p_filters->>'to','')::date;
  v_type text := NULLIF(p_filters->>'type','');
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',h.id,'holiday_date',h.holiday_date,'name',h.name,'holiday_type',h.holiday_type,
    'is_recurring',h.is_recurring,'is_working_day',h.is_working_day,'is_global',(h.company_id IS NULL),
    'notes',h.notes) ORDER BY h.holiday_date), '[]'::jsonb)
  INTO v_rows FROM public.holidays h
  WHERE (h.company_id = v_me.company_id OR h.company_id IS NULL)   -- company + shared national defaults
    AND (v_year IS NULL OR EXTRACT(YEAR FROM h.holiday_date)=v_year)
    AND (v_from IS NULL OR h.holiday_date >= v_from)
    AND (v_to   IS NULL OR h.holiday_date <= v_to)
    AND (v_type IS NULL OR h.holiday_type = v_type);

  RETURN jsonb_build_object('success',true,'rows',v_rows);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.add_holiday(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_id uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin only.'); END IF;
  IF NULLIF(p_data->>'holiday_date','') IS NULL OR NULLIF(TRIM(p_data->>'name'),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','missing_fields'); END IF;

  INSERT INTO public.holidays (company_id, holiday_date, name, holiday_type, country,
    is_recurring, is_working_day, notes, created_by)
  VALUES (v_me.company_id, (p_data->>'holiday_date')::date, TRIM(p_data->>'name'),
    COALESCE(NULLIF(p_data->>'holiday_type',''),'company'),
    COALESCE(NULLIF(p_data->>'country',''),'Pakistan'),
    COALESCE((p_data->>'is_recurring')::boolean,false),
    COALESCE((p_data->>'is_working_day')::boolean,false),
    NULLIF(p_data->>'notes',''), v_me.id)
  ON CONFLICT (company_id, holiday_date, name) DO UPDATE SET
    holiday_type   = EXCLUDED.holiday_type,
    is_recurring   = EXCLUDED.is_recurring,
    is_working_day = EXCLUDED.is_working_day,
    notes          = EXCLUDED.notes,
    updated_at     = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'id',v_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.is_working_day(p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_dow int; v_weekend boolean; v_working boolean;
  v_holiday_name text; v_comp boolean := false;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF p_date IS NULL THEN RETURN jsonb_build_object('success',false,'error','date_required'); END IF;

  v_dow := EXTRACT(DOW FROM p_date)::int;        -- 0 = Sunday, 6 = Saturday
  v_weekend := v_dow IN (0,6);
  v_working := NOT v_weekend;

  -- A blocking holiday (is_working_day=false) makes it a non-working day;
  -- a compensatory holiday (is_working_day=true) forces it to be a working day.
  SELECT h.name, bool_or(h.is_working_day)
    INTO v_holiday_name, v_comp
  FROM public.holidays h
  WHERE (h.company_id=v_me.company_id OR h.company_id IS NULL) AND h.holiday_date=p_date
  GROUP BY h.name LIMIT 1;

  IF v_holiday_name IS NOT NULL THEN
    v_working := COALESCE(v_comp,false);   -- holiday present: working only if it's a compensatory day
  END IF;

  RETURN jsonb_build_object('success',true,'date',p_date,'is_working_day',v_working,
    'is_weekend',v_weekend,'holiday_name',v_holiday_name);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. cancellation_policy_tiers
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_cancellation_tiers(p_project_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_rows jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF p_project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id=p_project_id AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','project_not_in_company'); END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.project_id NULLS LAST, t.sort_order), '[]'::jsonb)
  INTO v_rows
  FROM public.cancellation_policy_tiers t
  WHERE t.company_id=v_me.company_id AND t.is_active
    AND (t.project_id = p_project_id OR t.project_id IS NULL);   -- project tiers + company defaults

  RETURN jsonb_build_object('success',true,'rows',v_rows);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.create_tier(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_id uuid; v_project uuid := NULLIF(p_data->>'project_id','')::uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden','message','Admin only.'); END IF;
  IF NULLIF(TRIM(p_data->>'tier_name'),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','tier_name_required'); END IF;
  IF v_project IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id=v_project AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','project_not_in_company'); END IF;

  INSERT INTO public.cancellation_policy_tiers (
    company_id, project_id, tier_name, min_days_since_booking, max_days_since_booking,
    min_paid_pct, max_paid_pct, forfeiture_pct, cancellation_charge_pct, cancellation_charge_flat,
    processing_fee, refund_pct, sort_order, is_active, effective_from, effective_to, notes, created_by)
  VALUES (
    v_me.company_id, v_project, TRIM(p_data->>'tier_name'),
    NULLIF(p_data->>'min_days_since_booking','')::int, NULLIF(p_data->>'max_days_since_booking','')::int,
    NULLIF(p_data->>'min_paid_pct','')::numeric, NULLIF(p_data->>'max_paid_pct','')::numeric,
    COALESCE((p_data->>'forfeiture_pct')::numeric,0), COALESCE((p_data->>'cancellation_charge_pct')::numeric,0),
    COALESCE((p_data->>'cancellation_charge_flat')::numeric,0), COALESCE((p_data->>'processing_fee')::numeric,0),
    NULLIF(p_data->>'refund_pct','')::numeric, COALESCE((p_data->>'sort_order')::int,0),
    COALESCE((p_data->>'is_active')::boolean,true),
    NULLIF(p_data->>'effective_from','')::date, NULLIF(p_data->>'effective_to','')::date,
    NULLIF(p_data->>'notes',''), v_me.id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'id',v_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

CREATE OR REPLACE FUNCTION public.get_applicable_tier(
  p_project_id uuid, p_days_since_booking integer DEFAULT NULL, p_paid_pct numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_me public.app_users; v_tier public.cancellation_policy_tiers;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF p_project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id=p_project_id AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','project_not_in_company'); END IF;

  SELECT * INTO v_tier
  FROM public.cancellation_policy_tiers t
  WHERE t.company_id=v_me.company_id AND t.is_active
    AND (t.project_id = p_project_id OR t.project_id IS NULL)
    AND (t.min_days_since_booking IS NULL OR (p_days_since_booking IS NOT NULL AND p_days_since_booking >= t.min_days_since_booking))
    AND (t.max_days_since_booking IS NULL OR (p_days_since_booking IS NOT NULL AND p_days_since_booking <= t.max_days_since_booking))
    AND (t.min_paid_pct IS NULL OR (p_paid_pct IS NOT NULL AND p_paid_pct >= t.min_paid_pct))
    AND (t.max_paid_pct IS NULL OR (p_paid_pct IS NOT NULL AND p_paid_pct <= t.max_paid_pct))
    AND (t.effective_from IS NULL OR t.effective_from <= CURRENT_DATE)
    AND (t.effective_to   IS NULL OR t.effective_to   >= CURRENT_DATE)
  ORDER BY (t.project_id IS NOT NULL) DESC,  -- prefer a project-specific tier over the company default
           t.sort_order ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',true,'found',false); END IF;
  RETURN jsonb_build_object('success',true,'found',true,'tier',to_jsonb(v_tier));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error','server_error','message',SQLERRM);
END; $fn$;

-- ============================================================================
-- END — 28 RPCs + 2 helpers. DRAFT, NOT APPLIED.
-- ============================================================================
