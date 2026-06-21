-- ════════════════════════════════════════════════════════════════════════════
-- ORG REPORTING-CYCLE GUARD. 2026-06-21 incident: the admin "Reports-to" picker
-- (set_sales_user_role) only blocked self-parent, not a deeper loop, so a
-- marketing_manager (Amar) and a lead_entry operator (Rashid) were set as each
-- other's parent → a 2-node cycle. _lead_entry_owner walks parents with a
-- guard-less `UNION ALL` recursive CTE → infinite recursion → temp files filled
-- the DB disk ("No space left on device") → create_lead threw → portal showed
-- "Could not add this lead." (The bad data edge was repaired separately.)
--
-- Two fixes here:
--  1) set_sales_user_role rejects any parent that reports (directly/indirectly)
--     to the member being edited (prevents NEW cycles at the source).
--  2) _lead_entry_owner walks parents with path + depth guards (a stray cycle
--     from any source can never run away again).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) parent setter — block reporting cycles (not just self-parent)
CREATE OR REPLACE FUNCTION public.set_sales_user_role(p_id uuid, p_role text, p_parent_sales_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_su public.sales_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF p_role NOT IN ('sale_rep','marketing_manager','admin','cfo','director','lead_entry') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_role'); END IF;
  IF p_role <> 'director' AND p_parent_sales_user_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','parent_required','message','Select who this member reports to — only a director can have no team head.'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF p_parent_sales_user_id IS NOT NULL THEN
    IF p_parent_sales_user_id = p_id THEN RETURN jsonb_build_object('success',false,'error','self_parent','message','A member cannot be their own team head.'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sales_users WHERE id=p_parent_sales_user_id AND company_id=v_me.company_id) THEN
      RETURN jsonb_build_object('success',false,'error','invalid_parent'); END IF;
    -- reporting-cycle guard: the chosen head must NOT sit under this member
    IF EXISTS (
      WITH RECURSIVE up AS (
        SELECT id, parent_sales_user_id, ARRAY[id] AS path
          FROM public.sales_users WHERE id=p_parent_sales_user_id
        UNION ALL
        SELECT s.id, s.parent_sales_user_id, up.path||s.id
          FROM public.sales_users s JOIN up ON s.id=up.parent_sales_user_id
          WHERE s.id <> ALL(up.path)
      ) SELECT 1 FROM up WHERE id=p_id
    ) THEN
      RETURN jsonb_build_object('success',false,'error','cycle','message','That team head reports (directly or indirectly) to this member — pick someone else.');
    END IF;
  END IF;
  UPDATE public.sales_users
     SET role=p_role,
         parent_sales_user_id = CASE WHEN p_role='director' THEN NULL ELSE p_parent_sales_user_id END,
         updated_at=now()
   WHERE id=p_id;
  RETURN jsonb_build_object('success',true,'role',p_role);
END
$function$;

-- 2) lead-entry owner resolution — cycle/depth-guarded parent walk
CREATE OR REPLACE FUNCTION public._lead_entry_owner(p_operator uuid, p_company uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v uuid;
BEGIN
  WITH RECURSIVE up AS (
    SELECT id, parent_sales_user_id, role, 0 AS lvl, ARRAY[id] AS path
      FROM public.sales_users WHERE id=p_operator
    UNION ALL
    SELECT s.id, s.parent_sales_user_id, s.role, up.lvl+1, up.path||s.id
      FROM public.sales_users s JOIN up ON s.id=up.parent_sales_user_id
      WHERE s.id <> ALL(up.path) AND up.lvl < 50
  )
  SELECT id INTO v FROM up WHERE role='director' ORDER BY lvl DESC LIMIT 1;
  IF v IS NULL THEN
    SELECT id INTO v FROM public.sales_users
     WHERE company_id=p_company AND role='director' AND status='active'
     ORDER BY created_at NULLS LAST, id LIMIT 1;
  END IF;
  RETURN v;
END
$function$;
