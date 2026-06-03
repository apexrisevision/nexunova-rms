-- ════════════════════════════════════════════════════════════════════════
-- 2026-06-03  Fix remaining "companies has no code/name column" time-bombs.
--
-- Same class as the forgot-password fix: companies' real columns are
-- company_code / company_name. These three RPCs referenced a bare `name`
-- (either a non-existent column or a non-existent rowtype field) → 42703 /
-- "record has no field name" at RUNTIME (deploys clean, throws when the path
-- executes). Each fix is the single column/field reference; bodies otherwise
-- preserved verbatim.
--
--   portal_login                : v_co.name → v_co.company_name (rowtype field)
--   admin_invite_portal_client  : v_co.name → v_co.company_name (×2: subject + body)
--   cron_weekly_digest_all      : SELECT id, name → SELECT id, company_name AS name
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.portal_login(p_company_code text, p_email text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_co  public.companies;
  v_pc  public.portal_clients;
  v_cl  public.clients;
  v_tok text;
BEGIN
  SELECT * INTO v_co FROM public.companies
  WHERE company_code = UPPER(TRIM(p_company_code)) AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','Invalid company code');
  END IF;

  SELECT * INTO v_pc FROM public.portal_clients
  WHERE company_id=v_co.id AND email=LOWER(TRIM(p_email)) AND is_active=true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','Invalid email or password');
  END IF;

  IF v_pc.password_hash IS NULL OR v_pc.password_hash <> crypt(p_password, v_pc.password_hash) THEN
    RETURN jsonb_build_object('success',false,'error','Invalid email or password');
  END IF;

  SELECT * INTO v_cl FROM public.clients WHERE id=v_pc.client_id;
  v_tok := encode(gen_random_bytes(32),'hex');

  DELETE FROM public.portal_sessions WHERE portal_client_id=v_pc.id;
  INSERT INTO public.portal_sessions
    (company_id,client_id,portal_client_id,session_token,expires_at)
  VALUES (v_co.id,v_pc.client_id,v_pc.id,v_tok,now()+INTERVAL '8 hours');

  UPDATE public.portal_clients SET last_login_at=now() WHERE id=v_pc.id;

  RETURN jsonb_build_object(
    'success',true,'session_token',v_tok,
    'client_id',v_cl.id,'company_id',v_co.id,'company_name',v_co.company_name,
    'client_name',v_cl.full_name,'client_code',v_cl.client_code,'cnic',v_cl.cnic
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.admin_invite_portal_client(p_client_id uuid, p_email text, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me    public.app_users;
  v_cl    public.clients;
  v_co    public.companies;
  v_pw    text;
  v_tok   text;
  v_pc_id uuid;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;

  SELECT * INTO v_cl FROM public.clients WHERE id=p_client_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','client_not_found'); END IF;
  SELECT * INTO v_co FROM public.companies WHERE id=p_company_id;

  v_pw  := UPPER(SUBSTRING(encode(gen_random_bytes(6),'hex') FROM 1 FOR 8));
  v_tok := encode(gen_random_bytes(32),'hex');

  INSERT INTO public.portal_clients
    (company_id,client_id,email,password_hash,temp_token,temp_token_expires_at,is_active)
  VALUES
    (p_company_id,p_client_id,LOWER(TRIM(p_email)),
     crypt(v_pw,gen_salt('bf',8)),v_tok,now()+INTERVAL '72 hours',true)
  ON CONFLICT (company_id,email) DO UPDATE SET
    password_hash=crypt(v_pw,gen_salt('bf',8)),
    temp_token=v_tok, temp_token_expires_at=now()+INTERVAL '72 hours',
    client_id=p_client_id, is_active=true, updated_at=now()
  RETURNING id INTO v_pc_id;

  BEGIN
    PERFORM public.enqueue_message(p_company_id, jsonb_build_object(
      'channel','email','to_address',LOWER(TRIM(p_email)),
      'subject','Your Buyer Portal Access — '||COALESCE(v_co.company_name,'Nexunova RMS'),
      'body','Dear '||v_cl.full_name||E',\n\nBuyer portal access created.\n'
             ||'Company Code: '||COALESCE(v_co.company_code,'')||E'\n'
             ||'Email: '||LOWER(TRIM(p_email))||E'\nTemporary Password: '||v_pw
             ||E'\n\nThis password expires in 72 hours.\n\nThank you,\n'||COALESCE(v_co.company_name,'Nexunova RMS'),
      'category','portal_invite'));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('success',true,'pc_id',v_pc_id,'temp_password',v_pw,'email',LOWER(TRIM(p_email)));
END;
$function$;


CREATE OR REPLACE FUNCTION public.cron_weekly_digest_all()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec          record;
  admin_rec    record;
  rows         jsonb;
  msg          text;
  row_item     jsonb;
  i            int;
  v_companies  int := 0;
BEGIN
  FOR rec IN SELECT id, company_name AS name FROM public.companies WHERE status = 'active' LOOP

    -- Top 10 worst-health clients for this company
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'score')::int ASC), '[]'::jsonb) INTO rows
    FROM (
      SELECT jsonb_build_object(
        'client_name',    c.full_name,
        'score',          chs.score,
        'category',       chs.category,
        'total_exposure', chs.total_exposure
      ) AS r
      FROM public.client_health_scores chs
      JOIN public.clients c ON c.id = chs.client_id AND c.company_id = rec.id
      WHERE chs.company_id = rec.id AND c.status = 'active'
      ORDER BY chs.score ASC LIMIT 10
    ) q;

    IF jsonb_array_length(rows) = 0 THEN CONTINUE; END IF;

    -- Format WhatsApp message
    msg := '📊 *Weekly Recovery Digest*' || E'\n';
    msg := msg || rec.name || ' — Top at-risk accounts this week:' || E'\n\n';
    FOR i IN 0..LEAST(jsonb_array_length(rows)-1, 9) LOOP
      row_item := rows->i;
      msg := msg
        || (i+1)::text || '. *' || COALESCE(row_item->>'client_name','—') || '*'
        || ' — Score: ' || COALESCE(row_item->>'score','?')
        || ' | Overdue: PKR '
        || to_char(COALESCE((row_item->>'total_exposure')::numeric,0), 'FM9,99,99,999')
        || ' (' || COALESCE(row_item->>'category','—') || ')' || E'\n';
    END LOOP;
    msg := msg || E'\nOpen Recovery Radar in RMS for details and next actions.';

    -- Find company admin/owner
    SELECT id, phone, email INTO admin_rec
    FROM public.app_users
    WHERE company_id = rec.id
      AND role IN ('admin','owner')
      AND (status IS NULL OR status = 'active')
    ORDER BY (role = 'owner') DESC LIMIT 1;

    IF NOT FOUND THEN CONTINUE; END IF;

    -- Enqueue WhatsApp via Module 7 dispatch
    IF admin_rec.phone IS NOT NULL AND trim(admin_rec.phone) <> '' THEN
      PERFORM public.enqueue_message(
        rec.id,
        jsonb_build_object(
          'channel',    'whatsapp',
          'to_address', admin_rec.phone,
          'body',       msg,
          'category',   'weekly_digest'
        )
      );
    END IF;

    v_companies := v_companies + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'companies_sent', v_companies, 'run_at', now());
END;
$function$;
