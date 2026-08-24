-- ═══════════════════════════════════════════════════════════════════════════
-- A lead a member types in belongs to the company, not to the phone it landed on
--
-- The director's own words: "I ran the ads on a sales person's number. WhatsApp
-- leads don't reach the CRM by themselves, so the member has to type them in.
-- Those leads are not his — the company paid for the ads, so everyone has a
-- right to them. He enters it, I pull it, and I hand it out."
--
-- Almost all of that already worked. What did not:
--
--   · create_lead gives the new lead to whoever typed it, unless the typist is
--     a 'lead_entry' operator — only THAT role's entries were routed up to the
--     director. A sale_rep's lead stayed with the sale_rep, so it never reached
--     the director's pool, and assign_lead then refused it outright with
--     "already with a team member — pull it back first". Two steps for what
--     should be none.
--
--   · Nothing on the pool row said who typed it in. The one fact the director
--     needs when deciding where a lead should go was recorded on every lead
--     since the beginning (leads.created_by_sales_user_id) and never read.
--
-- So: a per-company switch routes a member's manual entry to the director's
-- pool, the pool row carries the name of whoever entered it, and the directors
-- are told the moment it arrives — the same push WhatsApp leads already send,
-- because a lead that has just messaged you is measured in minutes.
--
-- The member is not punished for being honest: he keeps a record of every lead
-- he entered (get_my_entered_leads, which existed and returned too little to be
-- worth a screen), and the director's assign sheet offers him first.
--
-- OFF by default. Every company keeps today's behaviour until it is switched on
-- one at a time; ZZTEST and Awami Market are switched on at the end of this file.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.lead_intake_settings (
  company_id                uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  member_leads_to_director  boolean NOT NULL DEFAULT false,  -- manual entry lands in the director's pool
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_intake_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_intake_settings FROM anon, authenticated;

COMMENT ON TABLE public.lead_intake_settings IS
  'Per-company switch: a member''s manual lead entry goes to the director''s pool instead of staying with the member. OFF by default.';


-- ── create_lead: route a member's manual entry to the director ──────────────
-- Unchanged from the live definition except for the ELSIF branch below the
-- lead_entry one, the two new locals, and the push after the INSERT.
CREATE OR REPLACE FUNCTION public.create_lead(p_session_token text, p_payload jsonb, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_id uuid; v_name text; v_role text; v_cfg public.lead_role_config; v_src text;
        v_phone text; v_norm text; v_dup record; v_can_force boolean; v_owner uuid; v_proj uuid;
        v_pooled uuid; v_by text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT * INTO v_cfg FROM public.lead_role_config WHERE role=v_role;
  IF v_cfg.role IS NULL OR NOT v_cfg.can_have_leads THEN
    RETURN jsonb_build_object('success',false,'error','role_no_leads','message','Your role does not handle leads.'); END IF;
  IF v_cfg.create_sources IS NULL OR jsonb_array_length(v_cfg.create_sources)=0 THEN
    RETURN jsonb_build_object('success',false,'error','cannot_create','message','Your role receives leads from your manager — you can’t create them.'); END IF;
  v_name := NULLIF(TRIM(COALESCE(p_payload->>'name','')),'');
  IF v_name IS NULL THEN RETURN jsonb_build_object('success',false,'error','name_required','message','Lead name is required.'); END IF;
  v_src := NULLIF(TRIM(COALESCE(p_payload->>'source','')),'');
  IF v_src IS NULL OR NOT (v_src IN (SELECT jsonb_array_elements_text(v_cfg.create_sources))) THEN
    v_src := COALESCE(v_cfg.create_sources->>0,'manual'); END IF;
  v_phone := NULLIF(TRIM(COALESCE(p_payload->>'phone','')),'');
  v_norm := public._norm_phone(v_phone);

  v_proj := NULLIF(p_payload->>'project_id','')::uuid;
  IF v_proj IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.projects pr JOIN public.companies c ON c.id=pr.company_id
        WHERE pr.id=v_proj
          AND ( pr.company_id=v_ses.company_id
                OR (c.dealer_group_id IS NOT NULL
                    AND c.dealer_group_id=(SELECT dealer_group_id FROM public.companies WHERE id=v_ses.company_id))) ) THEN
    v_proj := NULL;
  END IF;

  IF v_norm IS NOT NULL THEN
    SELECT l.id, l.status, ow.full_name AS owner_name,
           (l.owner_sales_user_id IN (
              WITH RECURSIVE sub AS (
                SELECT id FROM public.sales_users WHERE id=v_ses.sales_user_id
                UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id
              ) SELECT id FROM sub)) AS visible
      INTO v_dup
    FROM public.leads l LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
    WHERE l.company_id=v_ses.company_id AND l.status NOT IN ('won','lost')
      AND public._norm_phone(l.phone)=v_norm
    ORDER BY l.created_at ASC LIMIT 1;
    IF v_dup.id IS NOT NULL THEN
      IF v_dup.visible THEN
        RETURN jsonb_build_object('success',false,'error','duplicate_owned',
          'message','This client already exists in your pipeline.',
          'lead_id',v_dup.id,'owner_name',v_dup.owner_name,'status',v_dup.status);
      ELSE
        v_can_force := v_role IN ('marketing_manager','director');
        IF NOT (p_force AND v_can_force) THEN
          RETURN jsonb_build_object('success',false,'error','duplicate_elsewhere',
            'message','A lead with this phone already exists in the organization.','can_force', v_can_force);
        END IF;
      END IF;
    END IF;
  END IF;

  v_owner := v_ses.sales_user_id;
  IF v_role='lead_entry' THEN
    v_owner := public._lead_entry_owner(v_ses.sales_user_id, v_ses.company_id);
    IF v_owner IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','no_director','message','No director is set up to receive leads yet. Ask your admin.'); END IF;
  ELSIF v_role NOT IN ('director','admin','cfo')
        AND COALESCE((SELECT s.member_leads_to_director FROM public.lead_intake_settings s
                       WHERE s.company_id = v_ses.company_id), false) THEN
    -- The company paid for the ads, so the lead is the company's. It goes to the
    -- director's pool; he hands it back to this member or on to another.
    -- If no director exists the lead stays with the member — losing it would be
    -- a worse answer than leaving it where it was typed.
    v_pooled := public._lead_entry_owner(v_ses.sales_user_id, v_ses.company_id);
    IF v_pooled IS NOT NULL THEN v_owner := v_pooled; END IF;
  END IF;

  INSERT INTO public.leads (company_id, project_id, owner_sales_user_id, created_by_sales_user_id, name, phone, email,
    source, interest, unit_type_id, unit_id, budget, status, notes)
  VALUES (v_ses.company_id, COALESCE(v_proj, v_ses.project_id),
    v_owner, v_ses.sales_user_id, v_name, v_phone,
    NULLIF(TRIM(COALESCE(p_payload->>'email','')),''), v_src,
    NULLIF(TRIM(COALESCE(p_payload->>'interest','')),''),
    NULLIF(p_payload->>'unit_type_id','')::uuid, NULLIF(p_payload->>'unit_id','')::uuid,
    NULLIF(regexp_replace(COALESCE(p_payload->>'budget',''),'[^0-9.]','','g'),'')::numeric,
    COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'status','')),''),'new'),
    NULLIF(TRIM(COALESCE(p_payload->>'notes','')),'')
  ) RETURNING id INTO v_id;

  -- A pooled lead is one nobody is working yet, and a WhatsApp lead is measured
  -- in minutes. Tell the directors now, the same way an inbound WhatsApp lead does.
  IF v_pooled IS NOT NULL AND v_owner <> v_ses.sales_user_id THEN
    SELECT full_name INTO v_by FROM public.sales_users WHERE id=v_ses.sales_user_id;
    PERFORM public._crm_notify_directors(v_ses.company_id, 'New lead to assign',
      v_name||' · '||public._lead_source_label(v_src)||' · entered by '||COALESCE(v_by,'a member'),
      'https://rms.nexunova.com/sales-portal.html?lead='||v_id::text,
      'push:pooled:'||v_id::text);
  END IF;

  RETURN jsonb_build_object('success',true,'id',v_id,'pooled',(v_owner <> v_ses.sales_user_id));
END; $function$;


-- ── list_my_leads: say who typed the lead in ───────────────────────────────
-- Unchanged except the eb join and the two new keys on every row. The director
-- decides where a lead goes; he cannot decide well without knowing who found it.
CREATE OR REPLACE FUNCTION public.list_my_leads(p_session_token text, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_uid uuid; v_rows jsonb; v_counts jsonb;
        v_role text; v_companywide boolean; v_unchecked int; v_today date := public._fu_today();
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;
  v_companywide := v_role IN ('director','admin','cfo');

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION
    SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  ),
  myleads AS (
    SELECT l.*, (lv.lead_id IS NOT NULL) AS checked, public._su_label(l.owner_sales_user_id) AS owner_name, ow.role AS owner_role,
           u.unit_no, p.project_name, d.stage AS deal_stage,                      -- PHASE2
           ov.seen_at AS owner_opened_at,                                         -- did the OWNER open it
           eb.full_name AS entered_by_name                                        -- who typed it in
    FROM (SELECT * FROM public.leads WHERE deleted_at IS NULL) l
    LEFT JOIN public.units u ON u.id=l.unit_id
    LEFT JOIN public.projects p ON p.id=l.project_id
    LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
    LEFT JOIN public.sales_users eb ON eb.id=l.created_by_sales_user_id
    LEFT JOIN public.deals d ON d.lead_id=l.id                                    -- PHASE2
    LEFT JOIN public.lead_views lv ON lv.lead_id=l.id AND lv.sales_user_id=v_uid
    -- the caller's read-state above; the OWNER's below. They answer different
    -- questions and a director needs the second one.
    LEFT JOIN public.lead_views ov ON ov.lead_id=l.id AND ov.sales_user_id=l.owner_sales_user_id
    WHERE ( (v_companywide AND l.company_id=v_ses.company_id)
            OR ((NOT v_companywide) AND l.owner_sales_user_id IN (SELECT id FROM sub)) )
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'phone', m.phone, 'email', m.email,
      'source', m.source, 'interest', m.interest, 'budget', m.budget,
      'fb_page_id', m.fb_page_id, 'fb_page_name', m.fb_page_name,
      'status', m.status, 'notes', m.notes,
      'unit_no', m.unit_no, 'project_name', m.project_name, 'project_id', m.project_id,
      'owner_name', m.owner_name, 'owner_sales_user_id', m.owner_sales_user_id, 'owner_role', m.owner_role,
      'is_mine', (m.owner_sales_user_id=v_uid), 'created_by_me', (m.created_by_sales_user_id = v_uid),
      'created_by_sales_user_id', m.created_by_sales_user_id,
      'entered_by_name', m.entered_by_name,
      'checked', m.checked,
      'owner_opened', (m.owner_opened_at IS NOT NULL),
      'owner_opened_at', m.owner_opened_at,
      'next_follow_up_at', m.next_follow_up_at,
      'is_locked', (m.followup_locked_at IS NOT NULL),                            -- PHASE2
      'is_overdue', (m.next_follow_up_at IS NOT NULL                              -- PHASE2
                     AND (m.next_follow_up_at AT TIME ZONE 'Asia/Karachi')::date < v_today
                     AND COALESCE(m.deal_stage, m.status) NOT IN ('won','lost')),
      'last_activity_at', m.last_activity_at, 'created_at', m.created_at
    ) ORDER BY m.last_activity_at DESC) FILTER (WHERE (p_status IS NULL OR m.status=p_status)), '[]'::jsonb),
    count(*) FILTER (WHERE NOT m.checked AND m.status NOT IN ('won','lost') AND m.owner_sales_user_id = v_uid)
    INTO v_rows, v_unchecked
  FROM myleads m;

  WITH RECURSIVE sub AS (
    SELECT id FROM public.sales_users WHERE id=v_uid
    UNION
    SELECT su.id FROM public.sales_users su JOIN sub ON su.parent_sales_user_id=sub.id
  )
  SELECT jsonb_object_agg(status, n) INTO v_counts FROM (
    SELECT l.status, count(*) n FROM (SELECT * FROM public.leads WHERE deleted_at IS NULL) l
    WHERE ( (v_companywide AND l.company_id=v_ses.company_id)
            OR ((NOT v_companywide) AND l.owner_sales_user_id IN (SELECT id FROM sub)) )
    GROUP BY l.status
  ) t;

  RETURN jsonb_build_object('success',true,'leads',v_rows,'counts',COALESCE(v_counts,'{}'::jsonb),
    'unchecked',COALESCE(v_unchecked,0),
    'block', public._fu_block_state(v_uid));                                      -- PHASE2
END $function$;


-- ── get_my_entered_leads: the member's own record of what he handed in ─────
-- It returned name, phone, source and a date — not enough to be worth a screen,
-- and the screen is the whole point: a member who cannot see that his entry was
-- counted, and who ended up with it, stops entering.
CREATE OR REPLACE FUNCTION public.get_my_entered_leads(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_rows jsonb; v_today int; v_pooled int; v_back int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  SELECT count(*) FILTER (WHERE (l.created_at AT TIME ZONE 'Asia/Karachi')::date
                                = (now() AT TIME ZONE 'Asia/Karachi')::date),
         count(*) FILTER (WHERE ow.role IN ('director','admin','cfo')),
         count(*) FILTER (WHERE l.owner_sales_user_id = v_ses.sales_user_id)
    INTO v_today, v_pooled, v_back
    FROM public.leads l
    LEFT JOIN public.sales_users ow ON ow.id = l.owner_sales_user_id
   WHERE l.created_by_sales_user_id = v_ses.sales_user_id AND l.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',id,'name',name,'phone',phone,'source',source,
           'project_name',project_name,'created_at',created_at,
           'status',status,'owner_name',owner_name,
           'with_me',with_me,'waiting',waiting)
         ORDER BY created_at DESC),'[]'::jsonb)
    INTO v_rows FROM (
      SELECT l.id,l.name,l.phone,l.source,l.created_at,l.status, p.project_name,
             ow.full_name AS owner_name,
             (l.owner_sales_user_id = v_ses.sales_user_id)  AS with_me,
             (ow.role IN ('director','admin','cfo'))        AS waiting
      FROM public.leads l
      LEFT JOIN public.projects p ON p.id=l.project_id
      LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
      WHERE l.created_by_sales_user_id=v_ses.sales_user_id AND l.deleted_at IS NULL
      ORDER BY l.created_at DESC LIMIT 200) t;

  RETURN jsonb_build_object('success',true,'rows',v_rows,'today',COALESCE(v_today,0),
    'waiting',COALESCE(v_pooled,0),'with_me',COALESCE(v_back,0));
END; $function$;


-- ── the switch, read and written from the RMS admin (Online Portal) ────────
CREATE OR REPLACE FUNCTION public.admin_get_lead_intake(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users; v_on boolean;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  SELECT member_leads_to_director INTO v_on FROM public.lead_intake_settings WHERE company_id=p_company_id;
  RETURN jsonb_build_object('success',true,'member_leads_to_director',COALESCE(v_on,false));
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_set_lead_intake(p_company_id uuid, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me public.app_users;
BEGIN
  v_me := public._rms_caller();
  IF v_me.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','no_session'); END IF;
  IF NOT public._rms_is_admin(v_me) THEN RETURN jsonb_build_object('success',false,'error','admin_only'); END IF;
  IF v_me.company_id != p_company_id THEN RETURN jsonb_build_object('success',false,'error','unauthorized'); END IF;
  INSERT INTO public.lead_intake_settings (company_id, member_leads_to_director, updated_at)
  VALUES (p_company_id, COALESCE(p_enabled,false), now())
  ON CONFLICT (company_id) DO UPDATE
    SET member_leads_to_director = EXCLUDED.member_leads_to_director, updated_at = now();
  RETURN jsonb_build_object('success',true,'member_leads_to_director',COALESCE(p_enabled,false));
END; $function$;


-- ── grants ─────────────────────────────────────────────────────────────────
-- The portal is an anon client identified by its session token (see 20260818b);
-- the admin RPCs are called by a signed-in RMS user and are caller-gated.
REVOKE ALL ON FUNCTION public.create_lead(text, jsonb, boolean)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_my_leads(text, text)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_entered_leads(text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_lead_intake(uuid)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_lead_intake(uuid, boolean)   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lead(text, jsonb, boolean)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_leads(text, text)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_entered_leads(text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_lead_intake(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_lead_intake(uuid, boolean) TO authenticated;


-- ── on for the scratch tenant only ─────────────────────────────────────────
-- Awami Market asked for this and is switched on separately, AFTER the portal
-- screens ship. Turning it on here would take a rep's lead away from him while
-- the screen that explains where it went is still not deployed.
INSERT INTO public.lead_intake_settings (company_id, member_leads_to_director)
VALUES ('a2915ce7-c01c-463b-ba50-b144b2240337', true)    -- ZZTEST Internal
ON CONFLICT (company_id) DO UPDATE
  SET member_leads_to_director = true, updated_at = now();
