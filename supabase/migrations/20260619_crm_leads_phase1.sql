-- ════════════════════════════════════════════════════════════════════════
-- CRM Phase 1 — LEADS (top-of-funnel) for the independent self-module.
-- Lives in the RMS DB (thin link = shared units/agents/sales). Every lead is
-- owner-stamped to the sales_user who created it (free ownership now → role
-- team-rollups become a filter later). Session-gated like the other portal RPCs.
-- Pipeline stages: new → contacted → visit → negotiation → won | lost
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.leads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  owner_sales_user_id  uuid REFERENCES public.sales_users(id) ON DELETE SET NULL,
  name                 text NOT NULL,
  phone                text,
  email                text,
  source               text NOT NULL DEFAULT 'other',
  interest             text,                       -- free text: what they want
  unit_type_id         uuid REFERENCES public.category_unit_types(id) ON DELETE SET NULL,
  unit_id              uuid REFERENCES public.units(id) ON DELETE SET NULL,
  budget               numeric,
  status               text NOT NULL DEFAULT 'new',
  notes                text,
  converted_sale_id    uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  last_activity_at     timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_status_check CHECK (status IN ('new','contacted','visit','negotiation','won','lost'))
);
CREATE INDEX IF NOT EXISTS idx_leads_owner   ON public.leads(owner_sales_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_company ON public.leads(company_id);
CREATE INDEX IF NOT EXISTS idx_leads_status  ON public.leads(status);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;  -- access only via SECURITY DEFINER RPCs below

-- create_lead — portal session creates a lead owned by that sales_user --------
CREATE OR REPLACE FUNCTION public.create_lead(p_session_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_id uuid; v_name text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_name := NULLIF(TRIM(COALESCE(p_payload->>'name','')),'');
  IF v_name IS NULL THEN RETURN jsonb_build_object('success',false,'error','name_required','message','Lead name is required.'); END IF;

  INSERT INTO public.leads (company_id, project_id, owner_sales_user_id, name, phone, email,
    source, interest, unit_type_id, unit_id, budget, status, notes)
  VALUES (
    v_ses.company_id,
    COALESCE(NULLIF(p_payload->>'project_id','')::uuid, v_ses.project_id),
    v_ses.sales_user_id,
    v_name,
    NULLIF(TRIM(COALESCE(p_payload->>'phone','')),''),
    NULLIF(TRIM(COALESCE(p_payload->>'email','')),''),
    COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'source','')),''),'other'),
    NULLIF(TRIM(COALESCE(p_payload->>'interest','')),''),
    NULLIF(p_payload->>'unit_type_id','')::uuid,
    NULLIF(p_payload->>'unit_id','')::uuid,
    NULLIF(p_payload->>'budget','')::numeric,
    COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'status','')),''),'new'),
    NULLIF(TRIM(COALESCE(p_payload->>'notes','')),'')
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'id',v_id);
END; $function$;

-- list_my_leads — leads owned by this session user (+ pipeline tallies) -------
CREATE OR REPLACE FUNCTION public.list_my_leads(p_session_token text, p_status text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_rows jsonb; v_counts jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'name', l.name, 'phone', l.phone, 'email', l.email,
    'source', l.source, 'interest', l.interest, 'budget', l.budget,
    'status', l.status, 'notes', l.notes,
    'unit_no', u.unit_no, 'project_name', p.project_name,
    'last_activity_at', l.last_activity_at, 'created_at', l.created_at
  ) ORDER BY l.last_activity_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.leads l
  LEFT JOIN public.units u ON u.id=l.unit_id
  LEFT JOIN public.projects p ON p.id=l.project_id
  WHERE l.owner_sales_user_id=v_ses.sales_user_id
    AND (p_status IS NULL OR l.status=p_status);

  SELECT jsonb_object_agg(status, n) INTO v_counts FROM (
    SELECT status, count(*) n FROM public.leads
    WHERE owner_sales_user_id=v_ses.sales_user_id GROUP BY status
  ) t;

  RETURN jsonb_build_object('success',true,'leads',v_rows,'counts',COALESCE(v_counts,'{}'::jsonb));
END; $function$;

-- update_lead_stage — move a lead through the pipeline (owner-scoped) ---------
CREATE OR REPLACE FUNCTION public.update_lead_stage(p_session_token text, p_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF p_status NOT IN ('new','contacted','visit','negotiation','won','lost') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_status'); END IF;
  UPDATE public.leads SET status=p_status, last_activity_at=now(), updated_at=now()
   WHERE id=p_id AND owner_sales_user_id=v_ses.sales_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  RETURN jsonb_build_object('success',true,'status',p_status);
END; $function$;

-- update_lead — edit core fields (owner-scoped) ------------------------------
CREATE OR REPLACE FUNCTION public.update_lead(p_session_token text, p_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_n int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  UPDATE public.leads SET
    name     = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'name','')),''), name),
    phone    = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'phone','')),''), phone),
    email    = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'email','')),''), email),
    source   = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'source','')),''), source),
    interest = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'interest','')),''), interest),
    budget   = COALESCE(NULLIF(p_payload->>'budget','')::numeric, budget),
    notes    = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'notes','')),''), notes),
    updated_at = now()
  WHERE id=p_id AND owner_sales_user_id=v_ses.sales_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n=0 THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  RETURN jsonb_build_object('success',true);
END; $function$;
