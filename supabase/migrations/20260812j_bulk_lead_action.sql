-- 2026-08-12 — one round-trip for the standard bulk actions the selection bar
-- offers (mark checked / set follow-up / mark lost). Doing these one lead at a
-- time from the phone meant N requests; this does the loop server-side and
-- still honours _lead_can_act per lead, so nobody can touch someone else's lead.
CREATE OR REPLACE FUNCTION public.bulk_lead_action(
  p_session_token text,
  p_lead_ids uuid[],
  p_action text,                                   -- 'seen' | 'followup' | 'lost'
  p_when timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_lead uuid; v_n int := 0; v_skipped int := 0;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_action NOT IN ('seen','followup','lost') THEN RETURN jsonb_build_object('success',false,'error','invalid_action'); END IF;
  IF p_action='followup' AND p_when IS NULL THEN RETURN jsonb_build_object('success',false,'error','date_required'); END IF;
  IF p_action='lost' AND NULLIF(TRIM(COALESCE(p_reason,'')),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','reason_required','message','Add a reason before marking leads lost.'); END IF;
  IF p_lead_ids IS NULL OR array_length(p_lead_ids,1) IS NULL THEN
    RETURN jsonb_build_object('success',true,'done',0); END IF;

  FOREACH v_lead IN ARRAY p_lead_ids LOOP
    IF NOT public._lead_can_act(p_session_token, v_lead) THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    IF p_action='seen' THEN
      INSERT INTO public.lead_views(lead_id, sales_user_id, seen_at)
      VALUES (v_lead, v_ses.sales_user_id, now())
      ON CONFLICT (lead_id, sales_user_id) DO NOTHING;

    ELSIF p_action='followup' THEN
      UPDATE public.leads SET next_follow_up_at=p_when, updated_at=now() WHERE id=v_lead;

    ELSE  -- lost: the deal is authoritative for the stage, mirror trigger updates the lead
      UPDATE public.deals SET stage='lost', lost_reason=TRIM(p_reason), last_activity_at=now(), updated_at=now()
       WHERE lead_id=v_lead AND stage NOT IN ('won','lost');
      UPDATE public.leads SET lost_reason=TRIM(p_reason), last_activity_at=now(), updated_at=now() WHERE id=v_lead;
      INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
      VALUES (v_lead, v_ses.sales_user_id, 'stage', 'Marked lost — '||TRIM(p_reason));
    END IF;

    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('success',true,'done',v_n,'skipped',v_skipped);
END; $function$;

REVOKE ALL ON FUNCTION public.bulk_lead_action(text, uuid[], text, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_lead_action(text, uuid[], text, timestamptz, text) TO anon, authenticated;
