-- ════════════════════════════════════════════════════════════════════════════
-- set_fb_recipient — let a DIRECTOR (or admin) choose which director receives a
-- connected Page's leads, without handing them the whole page config.
--
-- Why not just add 'director' to save_fb_page's role gate: that would also grant
-- page_id / page_access_token / app_secret / page_name / project_id writes, which
-- 20260623_fb_operator_handoff.sql deliberately kept away from directors — AND
-- the FB page modal's payload carries no recipient_sales_user_id, so any later
-- "Save" from that modal would silently reset the recipient to the oldest active
-- director. This function touches ONE column and cannot do either.
--
-- The operator restriction is unchanged: lead_entry still cannot choose a
-- recipient (rejected here, and save_fb_page's v_is_le branch still skips the
-- column entirely).
--
-- trg_fb_lock_recipient is satisfied the sanctioned way — set_config with
-- is_local => true, the same flag save_fb_page raises, scoped to this statement.
-- The trigger is neither dropped nor disabled.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_fb_recipient(
  p_session_token text,
  p_page_id text,
  p_recipient_sales_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_co uuid; v_conn public.fb_connections;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  -- operators never choose who receives leads (20260623 handoff)
  IF public._sales_role_of(p_session_token)='lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('director','admin') THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_co := v_ses.company_id;

  -- the page must be connected to the caller's OWN company
  SELECT * INTO v_conn FROM public.fb_connections
   WHERE page_id = NULLIF(TRIM(COALESCE(p_page_id,'')),'') AND company_id = v_co
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','not_found',
      'message','That Facebook Page is not connected to your company.'); END IF;

  IF p_recipient_sales_user_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','recipient_required',
      'message','Pick who should receive this page''s leads.'); END IF;

  -- same rule save_fb_page enforces: an ACTIVE director/admin of this company.
  -- (create_lead_from_fb mints a session for this user and routes the lead
  --  through create_lead, whose lead_role_config gate rejects roles that cannot
  --  hold leads — so a wrong role here would silently stop ingestion.)
  IF NOT EXISTS (SELECT 1 FROM public.sales_users
                  WHERE id = p_recipient_sales_user_id
                    AND company_id = v_co
                    AND role IN ('director','admin')
                    AND status = 'active') THEN
    RETURN jsonb_build_object('success',false,'error','bad_recipient',
      'message','Leads can only go to an active director in your company.'); END IF;

  IF v_conn.recipient_sales_user_id IS NOT DISTINCT FROM p_recipient_sales_user_id THEN
    RETURN jsonb_build_object('success',true,'unchanged',true,'id',v_conn.id);
  END IF;

  PERFORM set_config('app.fb_recip_ok','1', true);   -- authorized path, this statement only
  UPDATE public.fb_connections
     SET recipient_sales_user_id = p_recipient_sales_user_id,
         updated_at = now()
   WHERE id = v_conn.id AND company_id = v_co;

  RETURN jsonb_build_object('success',true,'id',v_conn.id,
    'recipient_sales_user_id', p_recipient_sales_user_id);
END; $function$;

GRANT EXECUTE ON FUNCTION public.set_fb_recipient(text,text,uuid) TO anon, authenticated;
