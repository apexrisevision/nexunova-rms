-- ============================================================================
-- NEXUNOVA RMS — SALES-ACCESS ONBOARDING REDESIGN
-- 2026-06-15.  Replaces the per-person magic-link invite with ONE self-signup
-- link per company + admin approval. ONE flow only — the old path is REMOVED.
-- ----------------------------------------------------------------------------
-- New flow: admin shares  sales-portal.html?signup=<companies.sales_signup_token>
--   -> sales_register() creates a 'pending' sales_user (is_active=false, no slot)
--   -> admin Pending list: admin_approve_sales_user(id, project) enforces
--      check_plan_limit('sales_users') + sets status='active', is_active=true
--   -> existing PIN sales_login (company code + phone + PIN).
--
-- DESIGN: is_active stays the single "approved & may act" flag, kept in sync
-- with status. So check_plan_limit('sales_users') and sales_login are UNCHANGED
-- (they gate on is_active=true) — a 'pending' row is auto-uncounted and cannot
-- log in. `status` is just the lifecycle label the admin sees.
--
-- REMOVED (no dead code): create_sales_user, sales_magic_login, and the
-- sales_users.temp_token / temp_token_expires_at columns. The buyer portal's
-- portal_magic_login is a DIFFERENT function and is NOT touched.
-- ============================================================================

-- ── 1. Company-level rotatable signup token (the ONE link) ──────────────────
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS sales_signup_token text;
UPDATE public.companies
   SET sales_signup_token = encode(extensions.gen_random_bytes(16),'hex')
 WHERE sales_signup_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS companies_sales_signup_token_key
  ON public.companies(sales_signup_token);

-- ── 2. sales_users lifecycle status (is_active kept in sync) ────────────────
ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sales_users_status_check') THEN
    ALTER TABLE public.sales_users ADD CONSTRAINT sales_users_status_check
      CHECK (status IN ('pending','active','rejected','inactive'));
  END IF;
END $$;
UPDATE public.sales_users SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END;

-- ── 3. REMOVE the old magic-link path (no orphan code) ──────────────────────
DROP FUNCTION IF EXISTS public.sales_magic_login(text);
DROP FUNCTION IF EXISTS public.create_sales_user(uuid,uuid,text,text);
DROP INDEX  IF EXISTS public.sales_users_temp_token_idx;
ALTER TABLE public.sales_users DROP COLUMN IF EXISTS temp_token;
ALTER TABLE public.sales_users DROP COLUMN IF EXISTS temp_token_expires_at;

-- ── 4. sales_register (PUBLIC) — token-gated, dedup by phone, no slot used ───
CREATE OR REPLACE FUNCTION public.sales_register(p_signup_token text, p_name text, p_phone text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE v_co public.companies; v_pending int; v_phone text;
BEGIN
  IF TRIM(COALESCE(p_signup_token,''))='' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_link'); END IF;
  SELECT * INTO v_co FROM public.companies WHERE sales_signup_token=p_signup_token AND status='active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','invalid_link',
      'message','This signup link is invalid or has been disabled. Ask your office for the current link.'); END IF;
  IF TRIM(COALESCE(p_name,''))='' OR TRIM(COALESCE(p_phone,''))='' THEN
    RETURN jsonb_build_object('success',false,'error','name_phone_required','message','Please enter your name and phone.'); END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_pin','message','Choose a PIN of 4 to 6 digits.'); END IF;

  v_phone := lower(trim(p_phone));
  IF EXISTS (SELECT 1 FROM public.sales_users WHERE company_id=v_co.id AND lower(phone)=v_phone) THEN
    RETURN jsonb_build_object('success',false,'error','phone_already_registered',
      'message','This phone is already registered. If you are waiting for approval please wait; if already approved, just sign in.'); END IF;

  SELECT count(*) INTO v_pending FROM public.sales_users WHERE company_id=v_co.id AND status='pending';
  IF v_pending >= 100 THEN
    RETURN jsonb_build_object('success',false,'error','too_many_pending',
      'message','Registrations are temporarily full. Please contact your office.'); END IF;

  INSERT INTO public.sales_users (company_id, project_id, full_name, phone, pin_hash, status, is_active)
  VALUES (v_co.id, NULL, TRIM(p_name), TRIM(p_phone), crypt(p_pin, gen_salt('bf',8)), 'pending', false);

  RETURN jsonb_build_object('success',true,'status','pending','company_name',v_co.company_name);
END; $$;

-- ── 5. get_sales_signup_company (PUBLIC) — name only, validates the link ─────
CREATE OR REPLACE FUNCTION public.get_sales_signup_company(p_signup_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object('success',true,'company_name',company_name,'company_code',company_code)
    FROM public.companies WHERE sales_signup_token=p_signup_token AND status='active'),
    jsonb_build_object('success',false,'error','invalid_link'));
$$;

-- ── 6. admin_approve_sales_user — sets scope + enforces the plan limit ──────
CREATE OR REPLACE FUNCTION public.admin_approve_sales_user(p_id uuid, p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_su public.sales_users; v_limit jsonb;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_su.status <> 'pending' THEN
    RETURN jsonb_build_object('success',false,'error','not_pending','message','This registration is already '||v_su.status||'.'); END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.projects WHERE id=p_project_id AND company_id=v_me.company_id) THEN
    RETURN jsonb_build_object('success',false,'error','invalid_project'); END IF;

  v_limit := public.check_plan_limit(v_me.company_id, 'sales_users');
  IF NOT (v_limit->>'can_add')::boolean THEN
    RETURN jsonb_build_object('success',false,'error','plan_limit',
      'message','Sales-access limit reached for your plan ('||(v_limit->>'current_count')||'/'||(v_limit->>'max_allowed')||'). Deactivate an active sales person, or upgrade your plan, before approving more.',
      'limit', v_limit);
  END IF;

  UPDATE public.sales_users SET status='active', is_active=true, project_id=p_project_id, updated_at=now()
   WHERE id=p_id;
  RETURN jsonb_build_object('success',true);
END; $$;

-- ── 7. admin_reject_sales_user — deletes the pending row (frees phone) ──────
CREATE OR REPLACE FUNCTION public.admin_reject_sales_user(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_n int;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  DELETE FROM public.sales_users WHERE id=p_id AND company_id=v_me.company_id AND status='pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n=0 THEN RETURN jsonb_build_object('success',false,'error','not_found_or_not_pending'); END IF;
  RETURN jsonb_build_object('success',true);
END; $$;

-- ── 8. rotate_sales_signup_token — instantly kills the old link ─────────────
CREATE OR REPLACE FUNCTION public.rotate_sales_signup_token(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE v_me public.app_users; v_tok text;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  v_tok := encode(gen_random_bytes(16),'hex');
  UPDATE public.companies SET sales_signup_token=v_tok WHERE id=p_company_id;
  RETURN jsonb_build_object('success',true,'sales_signup_token',v_tok);
END; $$;

-- ── 9. list_sales_users_admin — + status, + signup token for the share link ─
CREATE OR REPLACE FUNCTION public.list_sales_users_admin(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_rows jsonb; v_co public.companies;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', su.id, 'full_name', su.full_name, 'phone', su.phone,
    'project_id', su.project_id, 'project_name', p.project_name,
    'status', su.status, 'is_active', su.is_active,
    'last_login_at', su.last_login_at, 'created_at', su.created_at,
    'active_reservations', (SELECT count(*) FROM public.reservations r WHERE r.reserved_by=su.id AND r.status='active')
  ) ORDER BY (su.status='pending') DESC, su.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.sales_users su LEFT JOIN public.projects p ON p.id=su.project_id
  WHERE su.company_id=p_company_id;
  SELECT * INTO v_co FROM public.companies WHERE id=p_company_id;
  RETURN jsonb_build_object('success',true,'sales_users',v_rows,
    'limit', public.check_plan_limit(p_company_id,'sales_users'),
    'signup_token', v_co.sales_signup_token, 'company_code', v_co.company_code);
END; $$;

-- ── 10. deactivate_sales_user — keep status in sync ('inactive') ────────────
CREATE OR REPLACE FUNCTION public.deactivate_sales_user(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  UPDATE public.sales_users SET is_active=false, status='inactive', updated_at=now()
   WHERE id=p_id AND company_id=v_me.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  DELETE FROM public.sales_sessions WHERE sales_user_id=p_id;
  RETURN jsonb_build_object('success',true);
END; $$;

-- ── 11. Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.sales_register(text,text,text,text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_sales_signup_company(text)             FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_register(text,text,text,text)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_signup_company(text)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_sales_user(uuid,uuid)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_sales_user(uuid)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_sales_signup_token(uuid)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_sales_users_admin(uuid)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_sales_user(uuid)             TO anon, authenticated;
