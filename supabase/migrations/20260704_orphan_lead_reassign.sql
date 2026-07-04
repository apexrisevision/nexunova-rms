-- ════════════════════════════════════════════════════════════════════════
-- NEXUNOVA RMS — CRM: ORPHAN-LEAD REASSIGN ON MEMBER DEACTIVATE / DELETE
-- 2026-07-04
-- ------------------------------------------------------------------------
-- Bug (audit): leads.owner_sales_user_id was ON DELETE SET NULL, so deleting
-- a member silently dropped their leads out of every subtree view = data loss.
-- Fixes:
--   • DEACTIVATE  → auto-reassign the member's OPEN leads to their team head
--     (parent_sales_user_id); if none, to the company "unassigned pool"
--     (owner NULL). Closed/won/lost leads keep history in place.
--   • DELETE      → BLOCKED while the member still owns ANY lead; admin must
--     reassign first (explicit target picker). FK hardened to RESTRICT so a
--     raw delete can never orphan again.
--   • Backfill    → existing owner-NULL leads already ARE the pool (reported).
--   • Every move writes a lead_assignments trail row + an 'assigned' activity
--     ("Reassigned from X to Y — member deactivated").
-- Admin-side RPCs are _rms_caller/_rms_is_admin gated (app_user side).
-- ════════════════════════════════════════════════════════════════════════

-- 0) Harden the FK: no more silent SET NULL orphans on member delete --------
DO $$
DECLARE v_con text;
BEGIN
  SELECT conname INTO v_con FROM pg_constraint
   WHERE conrelid='public.leads'::regclass AND contype='f'
     AND conkey = (SELECT array_agg(attnum) FROM pg_attribute
                   WHERE attrelid='public.leads'::regclass AND attname='owner_sales_user_id');
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.leads DROP CONSTRAINT %I', v_con);
  END IF;
  ALTER TABLE public.leads
    ADD CONSTRAINT leads_owner_sales_user_id_fkey
    FOREIGN KEY (owner_sales_user_id) REFERENCES public.sales_users(id) ON DELETE RESTRICT;
END $$;

-- 1) Internal helper: reassign a set of leads to a target (NULL = pool) -----
CREATE OR REPLACE FUNCTION public._crm_reassign_leads(p_lead_ids uuid[], p_to uuid, p_body text)
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  IF p_lead_ids IS NULL OR array_length(p_lead_ids,1) IS NULL THEN RETURN 0; END IF;

  -- accountability trail: from = the lead's current owner, to = target
  INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id)
  SELECT id, owner_sales_user_id, p_to FROM public.leads WHERE id = ANY(p_lead_ids);

  -- visible activity-timeline entry
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
  SELECT id, p_to, 'assigned', p_body FROM public.leads WHERE id = ANY(p_lead_ids);

  -- move ownership (system reassignment → assigned_by NULL)
  UPDATE public.leads
     SET owner_sales_user_id       = p_to,
         assigned_by_sales_user_id = NULL,
         assigned_at               = now(),
         last_activity_at          = now(),
         updated_at                = now()
   WHERE id = ANY(p_lead_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $function$;

-- 2) deactivate_sales_user — now auto-reassigns OPEN leads ------------------
CREATE OR REPLACE FUNCTION public.deactivate_sales_user(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_su public.sales_users;
        v_parent uuid; v_pname text; v_ids uuid[]; v_body text; v_n int := 0;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  v_parent := v_su.parent_sales_user_id;
  IF v_parent IS NOT NULL THEN
    SELECT full_name INTO v_pname FROM public.sales_users WHERE id=v_parent AND company_id=v_me.company_id AND status='active';
    IF v_pname IS NULL THEN v_parent := NULL; END IF;   -- parent gone/inactive → fall back to pool
  END IF;

  -- reassign OPEN (active pipeline) leads only; closed/won/lost keep history
  SELECT array_agg(id) INTO v_ids FROM public.leads
   WHERE owner_sales_user_id=p_id AND company_id=v_me.company_id
     AND status NOT IN ('won','lost');

  IF v_ids IS NOT NULL THEN
    v_body := 'Reassigned from '||COALESCE(v_su.full_name,'member')||' to '
              ||COALESCE(v_pname,'unassigned pool')||' — member deactivated';
    v_n := public._crm_reassign_leads(v_ids, v_parent, v_body);
  END IF;

  UPDATE public.sales_users SET is_active=false, status='inactive', updated_at=now()
   WHERE id=p_id AND company_id=v_me.company_id;
  DELETE FROM public.sales_sessions WHERE sales_user_id=p_id;

  RETURN jsonb_build_object('success',true,
    'reassigned', v_n,
    'target', CASE WHEN v_parent IS NULL THEN 'pool' ELSE 'parent' END,
    'target_name', COALESCE(v_pname,'Unassigned pool'));
END; $function$;
GRANT EXECUTE ON FUNCTION public.deactivate_sales_user(uuid) TO anon, authenticated;

-- 3) delete_sales_user — BLOCK while the member still owns any lead ---------
CREATE OR REPLACE FUNCTION public.delete_sales_user(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_su public.sales_users; v_r record; v_avail uuid; v_leads int;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT count(*) INTO v_leads FROM public.leads WHERE owner_sales_user_id=p_id AND company_id=v_me.company_id;
  IF v_leads > 0 THEN
    RETURN jsonb_build_object('success',false,'error','has_leads','lead_count',v_leads,
      'message','This member still owns '||v_leads||' lead(s). Reassign them first, then delete.');
  END IF;

  -- release ACTIVE reservations (free the units; no orphans)
  FOR v_r IN SELECT * FROM public.reservations WHERE reserved_by=p_id AND company_id=v_me.company_id AND status='active' LOOP
    UPDATE public.reservations SET status='cancelled', cancelled_by=v_me.id, cancelled_at=now(), updated_at=now() WHERE id=v_r.id;
    SELECT id INTO v_avail FROM public.category_unit_statuses
      WHERE company_id=v_r.company_id AND project_id=v_r.project_id AND is_available AND is_active ORDER BY sort_order LIMIT 1;
    IF v_avail IS NOT NULL THEN
      UPDATE public.units SET status_id=v_avail, updated_at=now() WHERE id=v_r.unit_id AND company_id=v_r.company_id;
    END IF;
  END LOOP;

  DELETE FROM public.sales_sessions WHERE sales_user_id=p_id;
  DELETE FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id;
  RETURN jsonb_build_object('success',true);
END; $function$;
GRANT EXECUTE ON FUNCTION public.delete_sales_user(uuid) TO anon, authenticated;

-- 4) admin_reassign_member_leads — move a member's leads to a target/pool ---
--    p_to NULL = unassigned pool. p_scope 'open' (default) | 'all'.
CREATE OR REPLACE FUNCTION public.admin_reassign_member_leads(p_from uuid, p_to uuid DEFAULT NULL, p_scope text DEFAULT 'open')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_fname text; v_tname text; v_ids uuid[]; v_body text; v_n int;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF p_scope NOT IN ('open','all') THEN RETURN jsonb_build_object('success',false,'error','bad_scope'); END IF;

  SELECT full_name INTO v_fname FROM public.sales_users WHERE id=p_from AND company_id=v_me.company_id;
  IF v_fname IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  IF p_to IS NOT NULL THEN
    IF p_to = p_from THEN RETURN jsonb_build_object('success',false,'error','same_target','message','Pick a different member.'); END IF;
    SELECT full_name INTO v_tname FROM public.sales_users WHERE id=p_to AND company_id=v_me.company_id AND status='active';
    IF v_tname IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target','message','Choose an active member to receive the leads.'); END IF;
  END IF;

  SELECT array_agg(id) INTO v_ids FROM public.leads
   WHERE owner_sales_user_id=p_from AND company_id=v_me.company_id
     AND (p_scope='all' OR status NOT IN ('won','lost'));

  IF v_ids IS NULL THEN RETURN jsonb_build_object('success',true,'reassigned',0); END IF;

  v_body := 'Reassigned from '||v_fname||' to '||COALESCE(v_tname,'unassigned pool')||' by admin';
  v_n := public._crm_reassign_leads(v_ids, p_to, v_body);
  RETURN jsonb_build_object('success',true,'reassigned',v_n,'target_name',COALESCE(v_tname,'Unassigned pool'));
END; $function$;
GRANT EXECUTE ON FUNCTION public.admin_reassign_member_leads(uuid, uuid, text) TO anon, authenticated;

-- 5) admin_reassign_leads — bulk-reassign specific leads (pool triage) ------
CREATE OR REPLACE FUNCTION public.admin_reassign_leads(p_lead_ids uuid[], p_to uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_tname text; v_ids uuid[]; v_body text; v_n int;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF p_to IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_target','message','Choose a member to receive the leads.'); END IF;

  SELECT full_name INTO v_tname FROM public.sales_users WHERE id=p_to AND company_id=v_me.company_id AND status='active';
  IF v_tname IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target','message','Choose an active member.'); END IF;

  -- only leads that belong to this company (guards cross-tenant ids)
  SELECT array_agg(id) INTO v_ids FROM public.leads
   WHERE id = ANY(p_lead_ids) AND company_id=v_me.company_id;
  IF v_ids IS NULL THEN RETURN jsonb_build_object('success',true,'reassigned',0); END IF;

  v_body := 'Reassigned to '||v_tname||' by admin';
  v_n := public._crm_reassign_leads(v_ids, p_to, v_body);
  RETURN jsonb_build_object('success',true,'reassigned',v_n,'target_name',v_tname);
END; $function$;
GRANT EXECUTE ON FUNCTION public.admin_reassign_leads(uuid[], uuid) TO anon, authenticated;

-- 6) list_unassigned_leads — the company "unassigned pool" (admin) ----------
CREATE OR REPLACE FUNCTION public.list_unassigned_leads(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_rows jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'name', l.name, 'phone', l.phone, 'status', l.status, 'source', l.source,
    'project_name', p.project_name, 'last_activity_at', l.last_activity_at, 'created_at', l.created_at
  ) ORDER BY l.last_activity_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.leads l
  LEFT JOIN public.projects p ON p.id=l.project_id
  WHERE l.company_id=p_company_id AND l.owner_sales_user_id IS NULL;

  RETURN jsonb_build_object('success',true,'leads',v_rows);
END; $function$;
GRANT EXECUTE ON FUNCTION public.list_unassigned_leads(uuid) TO anon, authenticated;

-- 7) list_sales_users_admin — add open_leads + total_leads counts -----------
CREATE OR REPLACE FUNCTION public.list_sales_users_admin(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_rows jsonb; v_co public.companies; v_umb jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', su.id, 'full_name', su.full_name, 'father_name', su.father_name, 'phone', su.phone, 'cnic', su.cnic,
    'email', su.email, 'email_verified', su.email_verified, 'email_verified_at', su.email_verified_at, 'address', su.address,
    'bank_name', su.bank_name, 'bank_account_no', su.bank_account_no, 'bank_account_title', su.bank_account_title,
    'profile_photo_url', su.profile_photo_url, 'cnic_front_url', su.cnic_front_url, 'cnic_back_url', su.cnic_back_url,
    'kyc_status', su.kyc_status,
    'role', su.role, 'parent_sales_user_id', su.parent_sales_user_id,
    'parent_name', (SELECT pp.full_name FROM public.sales_users pp WHERE pp.id=su.parent_sales_user_id),
    'project_id', su.project_id, 'project_name', p.project_name,
    'status', su.status, 'is_active', su.is_active,
    'agent_id', su.agent_id, 'agent_code', ag.agent_code,
    'last_login_at', su.last_login_at, 'created_at', su.created_at,
    'active_reservations', (SELECT count(*) FROM public.reservations r WHERE r.reserved_by=su.id AND r.status='active'),
    'open_leads',  (SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=su.id AND l.status NOT IN ('won','lost')),
    'total_leads', (SELECT count(*) FROM public.leads l WHERE l.owner_sales_user_id=su.id)
  ) ORDER BY (su.status='pending') DESC, su.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.sales_users su
  LEFT JOIN public.projects p ON p.id=su.project_id
  LEFT JOIN public.agents   ag ON ag.id=su.agent_id
  WHERE su.company_id=p_company_id;
  SELECT * INTO v_co FROM public.companies WHERE id=p_company_id;

  SELECT CASE WHEN g.id IS NOT NULL THEN jsonb_build_object(
      'group_id', g.id, 'group_name', g.name, 'signup_token', g.signup_token,
      'home_company_id', g.home_company_id, 'is_home', (g.home_company_id=p_company_id),
      'home_company_name', (SELECT company_name FROM public.companies WHERE id=g.home_company_id),
      'members', (SELECT string_agg(company_name, ', ' ORDER BY created_at) FROM public.companies WHERE dealer_group_id=g.id)
    ) ELSE NULL END INTO v_umb
  FROM public.companies c LEFT JOIN public.company_groups g ON g.id=c.dealer_group_id
  WHERE c.id=p_company_id;

  RETURN jsonb_build_object('success',true,'sales_users',v_rows,
    'limit', public.check_plan_limit(p_company_id,'sales_users'),
    'signup_token', v_co.sales_signup_token, 'company_code', v_co.company_code,
    'umbrella', v_umb);
END; $function$;

-- 8) Backfill note: existing owner-NULL leads ARE already the pool ----------
DO $$
DECLARE v_orphans int;
BEGIN
  SELECT count(*) INTO v_orphans FROM public.leads WHERE owner_sales_user_id IS NULL;
  RAISE NOTICE 'orphan-lead backfill: % existing owner-NULL lead(s) are now the unassigned pool (no move needed).', v_orphans;
END $$;
