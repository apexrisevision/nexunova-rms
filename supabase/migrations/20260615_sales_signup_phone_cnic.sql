-- ============================================================================
-- NEXUNOVA RMS — SALES SIGNUP: phone standard + CNIC + status-aware dedup msg
-- 2026-06-15.  Additive.
-- ----------------------------------------------------------------------------
-- * One canonical mobile format (PK): +92XXXXXXXXXX / 0092… / 03XXXXXXXXX all
--   normalise to 03XXXXXXXXX, so the same number cannot register twice in two
--   formats (tightens the one-mobile-per-company rule). Applied at register AND
--   login (login normalises the typed number before matching).
-- * sales_users.cnic captured at signup (format 35201-1234567-1) so the admin
--   can verify identity before approving; shown in the Pending list.
-- * Status-aware dedup message: pending -> "your request is pending"; active ->
--   "already registered, sign in"; inactive -> "contact your office".
-- sales_register gains p_cnic (old 4-arg version dropped — single clean flow).
-- ============================================================================

ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS cnic text;

-- ── Canonical PK mobile: digits-only, strip +92/0092/leading 0, expect 3XXXXXXXXX
CREATE OR REPLACE FUNCTION public._normalize_pk_mobile(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN core ~ '^3[0-9]{9}$' THEN '0'||core ELSE NULL END
  FROM (SELECT regexp_replace(regexp_replace(COALESCE(p,''),'[^0-9]','','g'),'^(0092|92|0)','') AS core) x;
$$;

DROP FUNCTION IF EXISTS public.sales_register(text,text,text,text);

CREATE OR REPLACE FUNCTION public.sales_register(
  p_signup_token text, p_name text, p_phone text, p_pin text, p_cnic text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE v_co public.companies; v_pending int; v_norm text; v_existing text; v_cnic text;
BEGIN
  IF TRIM(COALESCE(p_signup_token,''))='' THEN RETURN jsonb_build_object('success',false,'error','invalid_link'); END IF;
  SELECT * INTO v_co FROM public.companies WHERE sales_signup_token=p_signup_token AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','invalid_link',
    'message','This signup link is invalid or has been disabled. Ask your office for the current link.'); END IF;
  IF TRIM(COALESCE(p_name,''))='' THEN RETURN jsonb_build_object('success',false,'error','name_required','message','Please enter your name.'); END IF;

  v_norm := public._normalize_pk_mobile(p_phone);
  IF v_norm IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_phone',
    'message','Enter a valid mobile number, e.g. 03219694246 or +923219694246.'); END IF;

  v_cnic := TRIM(COALESCE(p_cnic,''));
  IF v_cnic !~ '^[0-9]{5}-[0-9]{7}-[0-9]$' THEN RETURN jsonb_build_object('success',false,'error','invalid_cnic',
    'message','Enter your CNIC in the format 35201-1234567-1.'); END IF;

  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN RETURN jsonb_build_object('success',false,'error','invalid_pin',
    'message','Choose a PIN of 4 to 6 digits.'); END IF;

  -- one mobile = one sales person (any status), compared on the canonical form
  SELECT status INTO v_existing FROM public.sales_users
   WHERE company_id=v_co.id AND public._normalize_pk_mobile(phone)=v_norm LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'error','phone_already_registered','existing_status',v_existing,
      'message', CASE v_existing
        WHEN 'pending'  THEN 'Your request is already pending your office''s approval. Please wait — you will be able to sign in once approved.'
        WHEN 'active'   THEN 'This mobile number is already registered and active. Please sign in with your PIN.'
        WHEN 'inactive' THEN 'This mobile number was deactivated by your office. Please contact them to be reactivated.'
        ELSE 'This mobile number is already registered.' END);
  END IF;

  SELECT count(*) INTO v_pending FROM public.sales_users WHERE company_id=v_co.id AND status='pending';
  IF v_pending >= 100 THEN RETURN jsonb_build_object('success',false,'error','too_many_pending',
    'message','Registrations are temporarily full. Please contact your office.'); END IF;

  INSERT INTO public.sales_users (company_id, project_id, full_name, phone, cnic, pin_hash, status, is_active)
  VALUES (v_co.id, NULL, TRIM(p_name), v_norm, v_cnic, crypt(p_pin, gen_salt('bf',8)), 'pending', false);

  RETURN jsonb_build_object('success',true,'status','pending','company_name',v_co.company_name);
END; $$;

-- ── sales_login: match on the canonical mobile (so +92… and 03… both work) ──
CREATE OR REPLACE FUNCTION public.sales_login(p_company_code text, p_phone text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE v_co public.companies; v_su public.sales_users; v_tok text;
BEGIN
  SELECT * INTO v_co FROM public.companies WHERE LOWER(company_code)=LOWER(TRIM(p_company_code)) AND status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Invalid company code'); END IF;
  SELECT * INTO v_su FROM public.sales_users
   WHERE company_id=v_co.id AND public._normalize_pk_mobile(phone)=public._normalize_pk_mobile(p_phone) AND is_active=true;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Invalid phone or PIN'); END IF;
  IF v_su.pin_hash IS NULL OR v_su.pin_hash <> crypt(p_pin, v_su.pin_hash) THEN
    RETURN jsonb_build_object('success',false,'error','Invalid phone or PIN'); END IF;
  v_tok := encode(gen_random_bytes(32),'hex');
  DELETE FROM public.sales_sessions WHERE sales_user_id=v_su.id;
  INSERT INTO public.sales_sessions (company_id, sales_user_id, project_id, session_token, expires_at)
  VALUES (v_co.id, v_su.id, v_su.project_id, v_tok, now()+interval '8 hours');
  UPDATE public.sales_users SET last_login_at=now() WHERE id=v_su.id;
  RETURN jsonb_build_object('success',true,'session_token',v_tok,'sales_user_id',v_su.id,
    'company_id',v_co.id,'company_name',v_co.company_name,'sales_user_name',v_su.full_name,'project_id',v_su.project_id);
END; $$;

-- ── list_sales_users_admin: include cnic so the admin can verify on approval ─
CREATE OR REPLACE FUNCTION public.list_sales_users_admin(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_me public.app_users; v_rows jsonb; v_co public.companies;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', su.id, 'full_name', su.full_name, 'phone', su.phone, 'cnic', su.cnic,
    'project_id', su.project_id, 'project_name', p.project_name,
    'status', su.status, 'is_active', su.is_active, 'last_login_at', su.last_login_at, 'created_at', su.created_at,
    'active_reservations', (SELECT count(*) FROM public.reservations r WHERE r.reserved_by=su.id AND r.status='active')
  ) ORDER BY (su.status='pending') DESC, su.created_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.sales_users su LEFT JOIN public.projects p ON p.id=su.project_id WHERE su.company_id=p_company_id;
  SELECT * INTO v_co FROM public.companies WHERE id=p_company_id;
  RETURN jsonb_build_object('success',true,'sales_users',v_rows,
    'limit', public.check_plan_limit(p_company_id,'sales_users'),
    'signup_token', v_co.sales_signup_token, 'company_code', v_co.company_code);
END; $$;

REVOKE ALL ON FUNCTION public.sales_register(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_register(text,text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_login(text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_sales_users_admin(uuid) TO anon, authenticated;
