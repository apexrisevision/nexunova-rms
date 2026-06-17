-- ════════════════════════════════════════════════════════════════
-- Prevent duplicate agents when a directly-created sub-agent later
-- self-signs-up. CNIC-only dedup misses the skeleton agents we created
-- in bulk (they have no CNIC). So:
--   1) find_agent_matches_for_signup() — surfaces likely existing agents
--      (match on CNIC, phone, or normalized name) for the admin to review.
--   2) admin_approve_sales_user() gains p_link_agent_id — admin can LINK
--      the signup to an existing agent (enriching its blank CNIC/KYC/phone)
--      instead of creating a duplicate.
-- ════════════════════════════════════════════════════════════════

-- helper: normalized name key
CREATE OR REPLACE FUNCTION public._agent_name_key(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(trim(coalesce(p,'')), '\s+', ' ', 'g'))
$$;

-- ── 1. candidate matches for a pending signup ──────────────────────
CREATE OR REPLACE FUNCTION public.find_agent_matches_for_signup(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_su public.sales_users;
  v_rows jsonb;
BEGIN
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'agent_code', a.agent_code, 'full_name', a.full_name,
           'cnic', a.cnic, 'phone', a.phone, 'status', a.status,
           'match_on', m.match_on
         ) ORDER BY m.rank, a.full_name), '[]'::jsonb)
    INTO v_rows
  FROM public.agents a
  JOIN LATERAL (
    SELECT CASE
             WHEN NULLIF(TRIM(COALESCE(v_su.cnic,'')),'') IS NOT NULL AND a.cnic = v_su.cnic THEN 'CNIC'
             WHEN NULLIF(TRIM(COALESCE(v_su.phone,'')),'') IS NOT NULL AND v_su.phone <> '0000000000'
                  AND a.phone = v_su.phone THEN 'phone'
             WHEN public._agent_name_key(a.full_name) = public._agent_name_key(v_su.full_name) THEN 'name'
             ELSE NULL
           END AS match_on,
           CASE
             WHEN NULLIF(TRIM(COALESCE(v_su.cnic,'')),'') IS NOT NULL AND a.cnic = v_su.cnic THEN 1
             WHEN NULLIF(TRIM(COALESCE(v_su.phone,'')),'') IS NOT NULL AND v_su.phone <> '0000000000'
                  AND a.phone = v_su.phone THEN 2
             ELSE 3
           END AS rank
  ) m ON m.match_on IS NOT NULL
  WHERE a.company_id = v_me.company_id;

  RETURN jsonb_build_object('success', true, 'matches', v_rows);
END; $function$;

-- ── 2. approve with optional explicit link to an existing agent ─────
-- drop the previous 3-arg signature so only the 4-arg version exists
DROP FUNCTION IF EXISTS public.admin_approve_sales_user(uuid, uuid, numeric);
CREATE OR REPLACE FUNCTION public.admin_approve_sales_user(
  p_id uuid, p_project_id uuid,
  p_commission_percent numeric DEFAULT NULL,
  p_link_agent_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me public.app_users; v_su public.sales_users; v_limit jsonb; v_agent uuid; v_code text;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_su.status <> 'pending' THEN
    RETURN jsonb_build_object('success',false,'error','not_pending','message','This registration is already '||v_su.status||'.'); END IF;
  IF p_project_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','project_required',
      'message','Pick the project this sales agent works in — it becomes their reserve scope and agent home project.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id=p_project_id AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','invalid_project'); END IF;
  IF p_commission_percent IS NOT NULL AND (p_commission_percent < 0 OR p_commission_percent > 100) THEN
    RETURN jsonb_build_object('success',false,'error','invalid_commission','message','Commission must be between 0 and 100.'); END IF;

  v_limit := public.check_plan_limit(v_me.company_id, 'sales_users');
  IF NOT (v_limit->>'can_add')::boolean THEN
    RETURN jsonb_build_object('success',false,'error','plan_limit',
      'message','Sales-access limit reached for your plan ('||(v_limit->>'current_count')||'/'||(v_limit->>'max_allowed')||'). Deactivate an active sales person, or upgrade your plan, before approving more.',
      'limit', v_limit);
  END IF;

  -- A) explicit admin link to an existing agent (no duplicate created) --
  IF p_link_agent_id IS NOT NULL THEN
    SELECT id INTO v_agent FROM public.agents WHERE id=p_link_agent_id AND company_id=v_me.company_id;
    IF v_agent IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_link_agent'); END IF;
    -- enrich the (often skeleton) agent: fill only blanks
    UPDATE public.agents SET
      cnic               = COALESCE(NULLIF(TRIM(cnic),''),               NULLIF(TRIM(COALESCE(v_su.cnic,'')),'')),
      phone              = CASE WHEN COALESCE(NULLIF(TRIM(phone),''),'0000000000')='0000000000'
                                THEN COALESCE(NULLIF(TRIM(COALESCE(v_su.phone,'')),''), phone) ELSE phone END,
      father_name        = COALESCE(NULLIF(TRIM(father_name),''),        v_su.father_name),
      email              = COALESCE(NULLIF(TRIM(email),''),              v_su.email),
      address            = COALESCE(NULLIF(TRIM(address),''),            v_su.address),
      bank_name          = COALESCE(NULLIF(TRIM(bank_name),''),          v_su.bank_name),
      bank_account_no    = COALESCE(NULLIF(TRIM(bank_account_no),''),    v_su.bank_account_no),
      bank_account_title = COALESCE(NULLIF(TRIM(bank_account_title),''), v_su.bank_account_title),
      profile_photo_url  = COALESCE(NULLIF(TRIM(profile_photo_url),''),  v_su.profile_photo_url),
      cnic_front_url     = COALESCE(NULLIF(TRIM(cnic_front_url),''),     v_su.cnic_front_url),
      cnic_back_url      = COALESCE(NULLIF(TRIM(cnic_back_url),''),      v_su.cnic_back_url),
      commission_percent = COALESCE(commission_percent, p_commission_percent),
      status             = 'active',
      updated_at         = now()
    WHERE id = v_agent;
    SELECT agent_code INTO v_code FROM public.agents WHERE id=v_agent;

  ELSE
    -- B) "Save as new" — always create a brand-new agent on a new ID.
    -- (Matching is now surfaced in the UI; the admin explicitly chooses Merge
    --  vs Save-new, so we no longer silently auto-link by CNIC here.)
    v_code := public.generate_agent_code(v_me.company_id, p_project_id);
    INSERT INTO public.agents (
      company_id, project_id, created_by, agent_code, full_name, father_name, phone, cnic,
      email, address, bank_name, bank_account_no, bank_account_title,
      commission_percent, join_date, status,
      profile_photo_url, cnic_front_url, cnic_back_url
    ) VALUES (
      v_me.company_id, p_project_id, v_me.id, v_code, v_su.full_name, v_su.father_name, v_su.phone,
      NULLIF(TRIM(COALESCE(v_su.cnic,'')),''),
      v_su.email, v_su.address, v_su.bank_name, v_su.bank_account_no, v_su.bank_account_title,
      p_commission_percent, CURRENT_DATE, 'active',
      v_su.profile_photo_url, v_su.cnic_front_url, v_su.cnic_back_url
    ) RETURNING id INTO v_agent;
  END IF;

  UPDATE public.sales_users
     SET status='active', is_active=true, project_id=p_project_id,
         agent_id=v_agent, kyc_status='verified', updated_at=now()
   WHERE id=p_id;

  RETURN jsonb_build_object('success',true,'agent_id',v_agent,'agent_code',v_code,
                            'linked', (p_link_agent_id IS NOT NULL));
END; $function$;
