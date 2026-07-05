-- CRM overhaul P5: Deal WRITE path. Stage moves write deals.stage (deal-native);
-- lead.status stays mirrored via the P3 deal->lead trigger. Dual-write fully intact.
-- reserve/mark-sold attach deal_id. No schema change (uses P3/P4 objects).
-- Applied via MCP 2026-07-06; verified on ZZTEST round-trip
-- (create -> new/contacted/visit/negotiation -> reserve+link -> won -> mark-sold,
--  deal.stage & lead.status mirror-consistent at every step; deal_id attached on
--  reservation + sale_submission; won correctly blocked until a booking exists).

-- 1) move_deal_stage: deal-native stage write. Takes the LEAD id (frontend keeps passing
--    lead ids; same arg shape as update_lead_stage) -> resolves the deal -> writes deals.stage.
--    Same validation as update_lead_stage (role/terminal/link/transition), logs a 'stage' activity.
CREATE OR REPLACE FUNCTION public.move_deal_stage(p_session_token text, p_id uuid, p_status text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_ses public.sales_sessions; v_cur text; v_link uuid; v_deal_id uuid; v_resv uuid; v_sale uuid;
        v_rank jsonb := '{"new":1,"contacted":2,"visit":3,"negotiation":4,"won":5}'::jsonb; v_rf int; v_rt int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_status NOT IN ('new','contacted','visit','negotiation','won','lost') THEN
    RETURN jsonb_build_object('success',false,'error','invalid_status'); END IF;
  SELECT d.id, d.stage, d.reservation_id, d.sale_id INTO v_deal_id, v_cur, v_resv, v_sale
    FROM public.deals d WHERE d.lead_id=p_id;
  IF v_deal_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  SELECT converted_reservation_id INTO v_link FROM public.leads WHERE id=p_id;
  IF v_cur = p_status THEN RETURN jsonb_build_object('success',true,'status',p_status,'noop',true); END IF;
  IF v_cur IN ('won','lost') THEN
    RETURN jsonb_build_object('success',false,'error','terminal_locked',
      'message','This deal is already '||initcap(v_cur)||'. Reopen it before changing the stage.'); END IF;
  IF p_status='won' AND v_resv IS NULL AND v_sale IS NULL AND v_link IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','link_required',
      'message','Link a reservation or sale before marking this deal Won.'); END IF;
  IF p_status <> 'lost' THEN
    v_rf := (v_rank->>v_cur)::int; v_rt := (v_rank->>p_status)::int;
    IF v_rt < v_rf - 1 THEN
      RETURN jsonb_build_object('success',false,'error','bad_transition',
        'message','Can''t jump back from '||initcap(v_cur)||' to '||initcap(p_status)||'. Move one step at a time.'); END IF;
  END IF;
  UPDATE public.deals SET stage=p_status, last_activity_at=now(), updated_at=now() WHERE id=v_deal_id;  -- trigger mirrors -> leads.status
  UPDATE public.leads SET last_activity_at=now() WHERE id=p_id;                                          -- keep sort/mirror clock fresh
  INSERT INTO public.lead_activities (lead_id, deal_id, sales_user_id, kind, body)
  VALUES (p_id, v_deal_id, v_ses.sales_user_id, 'stage', 'Moved to '||p_status);
  RETURN jsonb_build_object('success',true,'status',p_status);
END $fn$;
REVOKE ALL ON FUNCTION public.move_deal_stage(text,uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.move_deal_stage(text,uuid,text) TO anon, authenticated;

-- 2) link_lead_reservation: also attach reservations.deal_id (opportunity <-> booking link)
CREATE OR REPLACE FUNCTION public.link_lead_reservation(p_session_token text, p_lead_id uuid, p_reservation_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF NOT public._lead_can_act(p_session_token, p_lead_id) THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  UPDATE public.leads SET converted_reservation_id=p_reservation_id, updated_at=now() WHERE id=p_lead_id;   -- trigger sets deal.reservation_id
  UPDATE public.reservations SET deal_id=(SELECT id FROM public.deals WHERE lead_id=p_lead_id), updated_at=now()
    WHERE id=p_reservation_id AND deal_id IS NULL;                                                          -- attach deal_id to the reservation
  RETURN jsonb_build_object('success',true);
END $fn$;

-- 3) attach sale_submissions.deal_id on mark-sold, via a BEFORE INSERT trigger (submit_sale untouched)
CREATE OR REPLACE FUNCTION public._submission_attach_deal() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.deal_id IS NULL AND NEW.reservation_id IS NOT NULL THEN
    SELECT deal_id INTO NEW.deal_id FROM public.reservations WHERE id=NEW.reservation_id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;   -- never block a sale submission
END $fn$;
REVOKE ALL ON FUNCTION public._submission_attach_deal() FROM anon, authenticated, public;
DROP TRIGGER IF EXISTS trg_submission_attach_deal ON public.sale_submissions;
CREATE TRIGGER trg_submission_attach_deal BEFORE INSERT ON public.sale_submissions
  FOR EACH ROW EXECUTE FUNCTION public._submission_attach_deal();
