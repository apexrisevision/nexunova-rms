-- ═══════════════════════════════════════════════════════════════════════════
-- A manager can hand on the leads he holds
-- ───────────────────────────────────────────────────────────────────────────
-- Sixteen leads were handed to Abubakkar, the Khushal Bagh marketing_manager,
-- and he could not pass a single one to his team. Both assign paths open with
-- the same guard:
--
--     IF the lead's owner is not a director/admin/cfo
--       -> "This lead is already with a team member. Pull it back first."
--
-- It was written when the only person who assigned anything was a director, and
-- it says something true for a director: a lead sitting with a rep who is
-- working it should not be pulled out from under them by somebody upstream.
-- But it tests only WHO HOLDS the lead, never WHO IS ASKING — and a middle
-- manager holds his own leads. Every lead he owned failed it, so he could never
-- give one away. The role was configured, the team was under him, the target
-- list was right; this one line was the whole of it.
--
-- The rule it should have been is already in the file, three lines further
-- down, and has been all along:
--
--     IF NOT v_companywide AND v_owner <> caller
--       -> "Only the current holder can hand this lead down."
--
-- So the guard gains the one condition it was missing: the owner is somebody
-- OTHER than the caller. A director still cannot take a lead off a rep — owner
-- is not the caller, owner is a worker, blocked exactly as before. And anybody
-- holding a lead can hand it down, which is what holding it is for.
--
-- Nothing else changes, and nothing widens: the target must still be a direct
-- report (`v_tparent = caller`), lead-entry staff are still refused, and the
-- follow-up block still stops a hand-over to somebody behind on their overdue
-- ones. A sale_rep gains nothing by this — they have no direct reports to hand
-- anything to.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.assign_lead(p_session_token text, p_lead_id uuid, p_to_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_owner uuid; v_company uuid;
        v_role text; v_tname text; v_tparent uuid; v_companywide boolean; v_lname text; v_trole text;
        v_block jsonb;                                                    -- PHASE2
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  SELECT owner_sales_user_id, company_id, name INTO v_owner, v_company, v_lname FROM public.leads WHERE id=p_lead_id;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  -- Somebody ELSE is working it. Handing on your own is not the same act.
  IF v_owner IS DISTINCT FROM v_ses.sales_user_id
     AND EXISTS (SELECT 1 FROM public.sales_users su2
                  WHERE su2.id = v_owner AND su2.role NOT IN ('director','admin','cfo')) THEN
    RETURN jsonb_build_object('success',false,'error','already_assigned',
      'message','This lead is already with a team member. Pull it back first, then hand it over.');
  END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  v_companywide := v_role IN ('director','admin','cfo');
  IF v_companywide AND v_company <> v_ses.company_id THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF NOT v_companywide AND v_owner <> v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_owner','message','Only the current holder can hand this lead down.'); END IF;

  SELECT full_name, parent_sales_user_id, role INTO v_tname, v_tparent, v_trole
    FROM public.sales_users WHERE id=p_to_id AND company_id=v_company AND status='active';
  IF v_tname IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target'); END IF;
  IF v_trole = 'lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_target',
      'message','Lead-entry staff cannot work leads. Pick a sales member.'); END IF;
  IF v_tparent IS DISTINCT FROM v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_your_team','message','You can only assign leads to your own team.'); END IF;

  v_block := public._fu_block_state(p_to_id);                             -- PHASE2
  IF COALESCE((v_block->>'blocked')::boolean, false) THEN                 -- PHASE2
    RETURN jsonb_build_object('success',false,'error','assign_blocked','block',v_block,
      'message', v_tname||' has '||(v_block->>'overdue')||' overdue follow-ups. '
                 ||'They must clear these before taking new leads.');
  END IF;

  UPDATE public.leads
     SET owner_sales_user_id=p_to_id, assigned_by_sales_user_id=v_ses.sales_user_id,
         assigned_at=now(), last_activity_at=now(), updated_at=now()
   WHERE id=p_lead_id;
  INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id) VALUES (p_lead_id, v_ses.sales_user_id, p_to_id);
  INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body) VALUES (p_lead_id, v_ses.sales_user_id, 'assigned', 'Assigned to '||COALESCE(v_tname,'team member'));

  PERFORM public._crm_send_push(v_company, p_to_id, 'New lead assigned',
    COALESCE(v_lname,'A new lead')||' was assigned to you.',
    'https://rms.nexunova.com/sales-portal.html?lead='||p_lead_id,
    'push:assigned:'||p_lead_id||':'||p_to_id);

  RETURN jsonb_build_object('success',true,'to_name',v_tname);
END; $function$;

CREATE OR REPLACE FUNCTION public.assign_leads_bulk(p_session_token text, p_lead_ids uuid[], p_to_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_tname text; v_tparent uuid;
        v_company uuid; v_count int := 0; v_lead uuid; v_companywide boolean; v_trole text; v_skipped int := 0;
        v_block jsonb;                                                    -- PHASE2
        v_from text; v_last uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_company := v_ses.company_id;

  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  v_companywide := v_role IN ('director','admin','cfo');

  SELECT full_name, parent_sales_user_id, role INTO v_tname, v_tparent, v_trole
    FROM public.sales_users WHERE id=p_to_id AND company_id=v_company AND status='active';
  IF v_tname IS NULL THEN RETURN jsonb_build_object('success',false,'error','invalid_target'); END IF;
  IF v_trole = 'lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','invalid_target',
      'message','Lead-entry staff cannot work leads. Pick a sales member.'); END IF;
  IF v_tparent IS DISTINCT FROM v_ses.sales_user_id THEN
    RETURN jsonb_build_object('success',false,'error','not_your_team','message','You can only assign leads to your own team.'); END IF;

  v_block := public._fu_block_state(p_to_id);                             -- PHASE2
  IF COALESCE((v_block->>'blocked')::boolean, false) THEN                 -- PHASE2
    RETURN jsonb_build_object('success',false,'error','assign_blocked','block',v_block,
      'message', v_tname||' has '||(v_block->>'overdue')||' overdue follow-ups. '
                 ||'They must clear these before taking new leads.');
  END IF;

  FOREACH v_lead IN ARRAY p_lead_ids LOOP
    -- Somebody ELSE is working it. Handing on your own is not the same act.
    IF EXISTS (SELECT 1 FROM public.leads l
               JOIN public.sales_users ow ON ow.id = l.owner_sales_user_id
              WHERE l.id=v_lead
                AND l.owner_sales_user_id IS DISTINCT FROM v_ses.sales_user_id
                AND ow.role NOT IN ('director','admin','cfo')) THEN
      v_skipped := v_skipped + 1;
    ELSIF EXISTS (SELECT 1 FROM public.leads WHERE id=v_lead
               AND ((v_companywide AND company_id=v_company) OR owner_sales_user_id=v_ses.sales_user_id)) THEN
      UPDATE public.leads
         SET owner_sales_user_id=p_to_id, assigned_by_sales_user_id=v_ses.sales_user_id,
             assigned_at=now(), last_activity_at=now(), updated_at=now()
       WHERE id=v_lead;
      INSERT INTO public.lead_assignments (lead_id, from_sales_user_id, to_sales_user_id) VALUES (v_lead, v_ses.sales_user_id, p_to_id);
      INSERT INTO public.lead_activities (lead_id, sales_user_id, kind, body) VALUES (v_lead, v_ses.sales_user_id, 'assigned', 'Assigned to '||COALESCE(v_tname,'team member'));
      v_count := v_count + 1;
      v_last := v_lead;
    END IF;
  END LOOP;

  /* Handing work over without telling anybody is how 211 leads reached six
     people in silence. One alert per batch, not one per lead — forty-five
     notifications in a row is not information, it is noise. */
  IF v_count > 0 THEN
    SELECT full_name INTO v_from FROM public.sales_users WHERE id = v_ses.sales_user_id;
    PERFORM public._alert_raise(v_company, p_to_id,
      CASE WHEN v_count = 1 THEN v_last END, 'assigned',
      CASE WHEN v_count = 1 THEN 'A new lead is yours'
           ELSE v_count || ' new leads are yours' END,
      COALESCE(v_from, 'Your manager') || ' just assigned ' ||
      CASE WHEN v_count = 1 THEN 'a lead' ELSE v_count || ' leads' END || ' to you.',
      v_count,
      'assigned:' || p_to_id || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  END IF;

  RETURN jsonb_build_object('success',true,'assigned',v_count,'skipped',v_skipped,
    'message', CASE WHEN v_skipped>0 THEN v_skipped||' already with a team member — pull them back first.' ELSE NULL END,
    'to_name',v_tname,'to_id',p_to_id);
END $function$;

-- NO GRANT CHANGES HERE, deliberately. The two do not have the same access
-- today — assign_lead is granted to authenticated and NOT to anon, while
-- assign_leads_bulk carries anon and a PUBLIC execute besides — and a bug fix
-- is the wrong place to move either of them. CREATE OR REPLACE keeps a
-- function's existing privileges; that was checked against the catalogue after
-- this ran rather than assumed, because recreating a SECURITY DEFINER function
-- has widened privileges here before.
--
-- Worth a look separately, not here: assign_leads_bulk has `=X/postgres`, an
-- EXECUTE granted to PUBLIC. It also has an explicit anon grant, so PUBLIC is
-- almost certainly redundant, but proving that belongs in its own pass.
