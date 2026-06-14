-- ============================================================================
-- NEXUNOVA RMS — BUYER PORTAL — pgcrypto search_path fix
-- 2026-06-14
-- ----------------------------------------------------------------------------
-- BUG: clicking "Mera Hisaab — Portal Link" failed with
--   "function gen_random_bytes(integer) does not exist".
-- CAUSE: pgcrypto is installed in the `extensions` schema (Supabase default).
--   admin_invite_portal_client (and portal_set_password) were pinned to
--   `SET search_path = public` only — so unqualified gen_random_bytes /
--   gen_salt / crypt couldn't be resolved when invoked by the anon/auth role
--   from PostgREST. (portal_login / portal_magic_login already include
--   `extensions` in their search_path, which is why direct token tests passed.)
--
-- FIX (robust): schema-qualify every pgcrypto call as extensions.* AND add
--   `extensions` to the search_path. Qualifying makes it immune to any future
--   search_path change; we keep pgcrypto because bcrypt password hashing
--   (crypt/gen_salt) requires it — replacing the token with md5(random()) would
--   not remove the pgcrypto dependency, so enabling it properly is correct.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── admin_invite_portal_client: extensions-qualified pgcrypto ──────────────
CREATE OR REPLACE FUNCTION public.admin_invite_portal_client(p_client_id uuid, p_email text, p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE
  v_me  public.app_users; v_cl public.clients; v_co public.companies;
  v_pw  text; v_tok text; v_pc_id uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;

  SELECT * INTO v_cl FROM public.clients WHERE id=p_client_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','client_not_found'); END IF;
  SELECT * INTO v_co FROM public.companies WHERE id=p_company_id;

  v_pw  := UPPER(SUBSTRING(encode(extensions.gen_random_bytes(6),'hex') FROM 1 FOR 8));
  v_tok := encode(extensions.gen_random_bytes(32),'hex');

  INSERT INTO public.portal_clients
    (company_id,client_id,email,password_hash,temp_token,temp_token_expires_at,is_active)
  VALUES
    (p_company_id,p_client_id,LOWER(TRIM(p_email)),
     extensions.crypt(v_pw, extensions.gen_salt('bf',8)),v_tok,now()+INTERVAL '30 days',true)
  ON CONFLICT (company_id,email) DO UPDATE SET
    password_hash=extensions.crypt(v_pw, extensions.gen_salt('bf',8)),
    temp_token=v_tok, temp_token_expires_at=now()+INTERVAL '30 days',
    client_id=p_client_id, is_active=true, updated_at=now()
  RETURNING id INTO v_pc_id;

  BEGIN
    PERFORM public.enqueue_message(p_company_id, jsonb_build_object(
      'channel','email','to_address',LOWER(TRIM(p_email)),
      'subject','Your Buyer Portal Access — '||COALESCE(v_co.company_name,'Nexunova RMS'),
      'body','Dear '||v_cl.full_name||E',\n\nBuyer portal access created.\n'
             ||'Company Code: '||COALESCE(v_co.company_code,'')||E'\n'
             ||'Email: '||LOWER(TRIM(p_email))||E'\nTemporary Password: '||v_pw
             ||E'\n\nThank you,\n'||COALESCE(v_co.company_name,'Nexunova RMS'),
      'category','portal_invite'));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('success',true,'pc_id',v_pc_id,
    'temp_password',v_pw,'temp_token',v_tok,'email',LOWER(TRIM(p_email)));
END;
$function$;

-- ── portal_set_password: same latent bug (crypt/gen_salt) — qualify it too ──
CREATE OR REPLACE FUNCTION public.portal_set_password(p_company_code text, p_email text, p_temp_token text, p_new_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $function$
DECLARE
  v_co public.companies;
  v_pc public.portal_clients;
BEGIN
  SELECT * INTO v_co FROM public.companies WHERE company_code=UPPER(TRIM(p_company_code));
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Invalid company'); END IF;

  SELECT * INTO v_pc FROM public.portal_clients
  WHERE company_id=v_co.id AND email=LOWER(TRIM(p_email))
    AND temp_token=p_temp_token AND temp_token_expires_at>now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','Invalid or expired link. Ask your admin to re-send the invite.');
  END IF;

  IF LENGTH(TRIM(p_new_password))<8 THEN
    RETURN jsonb_build_object('success',false,'error','Password must be at least 8 characters');
  END IF;

  UPDATE public.portal_clients SET
    password_hash=extensions.crypt(p_new_password, extensions.gen_salt('bf',8)),
    temp_token=NULL, temp_token_expires_at=NULL, is_active=true, updated_at=now()
  WHERE id=v_pc.id;

  RETURN jsonb_build_object('success',true);
END;
$function$;
