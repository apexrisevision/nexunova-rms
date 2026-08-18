-- ═══════════════════════════════════════════════════════════════════════════
-- Contacting someone takes the lead out of "new"
--
-- Reported by the reps: they open a lead, call the person, send a WhatsApp — and
-- the lead still wears the "new" tag. On the director's side the same lead still
-- reads as not contacted.
--
-- They are right, and it is not about opening. Opening is recorded correctly:
-- mark_lead_seen writes lead_views, 336 rows and counting. The gap is that
-- log_lead_interaction and add_lead_activity insert the activity and touch
-- last_activity_at, and then never move leads.status. Only an explicit stage
-- change (submit_lead_disposition, move_deal_stage) does. So "new" could only
-- ever be cleared by hand, and 59 of the 62 leads currently sitting in "new"
-- already have real activity on them.
--
-- The fix is the narrowest one that matches what everybody already means by the
-- word:
--
--   · a CONTACT channel — call, whatsapp, sms, visit, meeting — moves a lead
--     from 'new' to 'contacted', once.
--   · a NOTE does not. Writing a note to yourself is not contacting anybody, and
--     a rep who jots "number is off" has not reached that person.
--   · nothing else moves. A lead already at contacted / visit / negotiation /
--     won / lost is left exactly where it is — this can only ever go new →
--     contacted, never sideways and never backwards.
--   · the move is written into lead_activities as a `stage` entry, so it shows up
--     in the Team report like any other status change and nobody has to guess why
--     the tag disappeared.
--
-- Existing rows are NOT touched here. Backfilling 59 live leads is a separate,
-- deliberate decision and is left to its own statement.
-- ═══════════════════════════════════════════════════════════════════════════

-- one definition of "this counts as reaching someone", used by both writers
CREATE OR REPLACE FUNCTION public._lead_contact_channel(p_kind text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_kind IN ('call','whatsapp','sms','visit','meeting')
$function$;

COMMENT ON FUNCTION public._lead_contact_channel(text) IS
  'True for the kinds that mean a human was actually reached. A note is not one of them.';

-- ── the two writers ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_lead_interaction(
  p_session_token text, p_lead_id uuid, p_channel text,
  p_outcome text DEFAULT NULL, p_note text DEFAULT NULL,
  p_next_step text DEFAULT NULL, p_next_step_date timestamptz DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_prev text; v_moved boolean := false;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_channel NOT IN ('call','whatsapp','sms','visit','meeting','note') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_channel'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_lead_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  -- the status BEFORE the write; RETURNING would hand back the one after it,
  -- and a lead already at contacted would then claim it had just moved
  SELECT status INTO v_prev FROM public.leads WHERE id = p_lead_id FOR UPDATE;

  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body, outcome, next_step)
  VALUES (p_lead_id, v_ses.sales_user_id, p_channel,
          NULLIF(TRIM(COALESCE(p_note,'')),''), NULLIF(TRIM(COALESCE(p_outcome,'')),''), NULLIF(TRIM(COALESCE(p_next_step,'')),''));

  UPDATE public.leads
     SET last_activity_at = now(),
         next_follow_up_at = COALESCE(p_next_step_date, next_follow_up_at),
         -- reaching someone is what "contacted" means; only new ever moves
         status = CASE WHEN status = 'new' AND public._lead_contact_channel(p_channel)
                       THEN 'contacted' ELSE status END,
         updated_at = now()
   WHERE id = p_lead_id;

  v_moved := (v_prev = 'new' AND public._lead_contact_channel(p_channel));

  -- say so in the history, so the tag never changes silently
  IF v_moved THEN
    INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
    SELECT p_lead_id, v_ses.sales_user_id, 'stage', 'Moved to contacted'
     WHERE NOT EXISTS (SELECT 1 FROM public.lead_activities a
                        WHERE a.lead_id = p_lead_id AND a.kind = 'stage'
                          AND a.body = 'Moved to contacted');
  END IF;

  RETURN jsonb_build_object('success',true,'moved_to_contacted', v_moved);
END $function$;

CREATE OR REPLACE FUNCTION public.add_lead_activity(
  p_session_token text, p_lead_id uuid, p_kind text,
  p_body text DEFAULT NULL, p_follow_up_at timestamptz DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_prev text; v_moved boolean := false;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_kind NOT IN ('note','call','whatsapp','visit','meeting') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_kind'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_lead_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT status INTO v_prev FROM public.leads WHERE id = p_lead_id FOR UPDATE;

  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
  VALUES (p_lead_id, v_ses.sales_user_id, p_kind, NULLIF(TRIM(COALESCE(p_body,'')),''));

  UPDATE public.leads
     SET last_activity_at = now(),
         next_follow_up_at = COALESCE(p_follow_up_at, next_follow_up_at),
         status = CASE WHEN status = 'new' AND public._lead_contact_channel(p_kind)
                       THEN 'contacted' ELSE status END,
         updated_at = now()
   WHERE id = p_lead_id;

  v_moved := (v_prev = 'new' AND public._lead_contact_channel(p_kind));

  IF v_moved THEN
    INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body)
    SELECT p_lead_id, v_ses.sales_user_id, 'stage', 'Moved to contacted'
     WHERE NOT EXISTS (SELECT 1 FROM public.lead_activities a
                        WHERE a.lead_id = p_lead_id AND a.kind = 'stage'
                          AND a.body = 'Moved to contacted');
  END IF;

  RETURN jsonb_build_object('success',true,'moved_to_contacted', v_moved);
END $function$;
