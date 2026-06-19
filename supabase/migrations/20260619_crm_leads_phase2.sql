-- ════════════════════════════════════════════════════════════════════════
-- CRM Phase 2 — Lead DETAIL + ACTIVITY TIMELINE (+ follow-up date)
-- A lead now has a running activity log (notes, calls, WhatsApp, visits,
-- meetings, and auto stage-change entries) and a next_follow_up_at reminder.
-- All session-gated + owner-scoped like Phase 1.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS next_follow_up_at timestamptz;

CREATE TABLE IF NOT EXISTS public.lead_activities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id        uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  sales_user_id  uuid REFERENCES public.sales_users(id) ON DELETE SET NULL,
  kind           text NOT NULL DEFAULT 'note',
  body           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_activities_kind_check CHECK (kind IN ('note','call','whatsapp','visit','meeting','stage'))
);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON public.lead_activities(lead_id, created_at DESC);
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

-- get_lead — full lead + its activity timeline (owner-scoped) -----------------
CREATE OR REPLACE FUNCTION public.get_lead(p_session_token text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_lead jsonb; v_acts jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  SELECT jsonb_build_object(
    'id', l.id, 'name', l.name, 'phone', l.phone, 'email', l.email,
    'source', l.source, 'interest', l.interest, 'budget', l.budget,
    'status', l.status, 'notes', l.notes,
    'unit_no', u.unit_no, 'project_name', p.project_name,
    'next_follow_up_at', l.next_follow_up_at,
    'last_activity_at', l.last_activity_at, 'created_at', l.created_at
  ) INTO v_lead
  FROM public.leads l
  LEFT JOIN public.units u ON u.id=l.unit_id
  LEFT JOIN public.projects p ON p.id=l.project_id
  WHERE l.id=p_id AND l.owner_sales_user_id=v_ses.sales_user_id;

  IF v_lead IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'body', a.body, 'created_at', a.created_at
  ) ORDER BY a.created_at DESC), '[]'::jsonb) INTO v_acts
  FROM public.lead_activities a WHERE a.lead_id=p_id;

  RETURN jsonb_build_object('success',true,'lead',v_lead,'activities',v_acts);
END; $function$;

-- add_lead_activity — log a note/call/whatsapp/visit/meeting (+ optional follow-up)
CREATE OR REPLACE FUNCTION public.add_lead_activity(p_session_token text, p_lead_id uuid, p_kind text, p_body text DEFAULT NULL, p_follow_up_at timestamptz DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_own uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF p_kind NOT IN ('note','call','whatsapp','visit','meeting') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_kind'); END IF;
  SELECT owner_sales_user_id INTO v_own FROM public.leads WHERE id=p_lead_id;
  IF v_own IS NULL OR v_own <> v_ses.sales_user_id THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
  VALUES (p_lead_id, v_ses.sales_user_id, p_kind, NULLIF(TRIM(COALESCE(p_body,'')),''));

  UPDATE public.leads
     SET last_activity_at=now(),
         next_follow_up_at = COALESCE(p_follow_up_at, next_follow_up_at),
         updated_at=now()
   WHERE id=p_lead_id;

  RETURN jsonb_build_object('success',true);
END; $function$;

-- set_lead_followup — set/clear the next follow-up reminder (owner-scoped) ----
CREATE OR REPLACE FUNCTION public.set_lead_followup(p_session_token text, p_id uuid, p_when timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_n int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  UPDATE public.leads SET next_follow_up_at=p_when, updated_at=now()
   WHERE id=p_id AND owner_sales_user_id=v_ses.sales_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n=0 THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  RETURN jsonb_build_object('success',true);
END; $function$;

-- update_lead_stage — now also writes a 'stage' timeline entry ----------------
CREATE OR REPLACE FUNCTION public.update_lead_stage(p_session_token text, p_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_n int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF p_status NOT IN ('new','contacted','visit','negotiation','won','lost') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_status'); END IF;
  UPDATE public.leads SET status=p_status, last_activity_at=now(), updated_at=now()
   WHERE id=p_id AND owner_sales_user_id=v_ses.sales_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n=0 THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
  VALUES (p_id, v_ses.sales_user_id, 'stage', 'Moved to '||p_status);
  RETURN jsonb_build_object('success',true,'status',p_status);
END; $function$;
