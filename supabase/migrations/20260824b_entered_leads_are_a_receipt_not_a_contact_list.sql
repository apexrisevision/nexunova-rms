-- ═══════════════════════════════════════════════════════════════════════════
-- "Leads I entered" is a receipt, not a contact list
--
-- The director asked the right question: once a member hands a lead over, can
-- he still see it? The rest of the system already answered correctly —
-- list_my_leads and get_lead both scope to leads the member OWNS, so the moment
-- a lead goes to the director's pool it leaves his list and his lead detail
-- returns not_found. No call button, no WhatsApp button, no activity log.
--
-- The hole was in get_my_entered_leads, added yesterday so an honest member can
-- see his entries were counted. It returned the client's PHONE on every lead he
-- had ever entered, for ever, no matter who held it now. That turned a credit
-- record back into a working contact list — exactly what the rule is against:
-- the ad ran on his number, but the company paid for it, so the client is the
-- company's.
--
-- Now the phone comes back masked unless the lead is currently his. He keeps
-- what he needs to defend his work — the name, the date, the source, the status,
-- and who is holding it — and loses what would let him work it behind the
-- company's back.
--
-- Being honest about what this does and does not do: the WhatsApp message
-- arrived on his own phone, so masking here does not make the number a secret.
-- What it does is stop the CRM from handing the client back to him, and stop a
-- leaver from walking out with a tidy list of every lead he ever touched.
-- ═══════════════════════════════════════════════════════════════════════════

-- Keep enough to recognise a number you already know, never enough to dial one
-- you don't: the leading group and the last two digits.
CREATE OR REPLACE FUNCTION public._mask_phone(p_phone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_phone IS NULL OR length(regexp_replace(p_phone, '\D', '', 'g')) < 6 THEN NULL
    ELSE left(regexp_replace(p_phone, '\D', '', 'g'), 4) || ' ••••• '
         || right(regexp_replace(p_phone, '\D', '', 'g'), 2)
  END;
$function$;

COMMENT ON FUNCTION public._mask_phone(text) IS
  'Recognisable, not dialable. Used where someone may see THAT a lead exists but has no right to work it.';


CREATE OR REPLACE FUNCTION public.get_my_entered_leads(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_rows jsonb; v_today int; v_pooled int; v_back int; v_month int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  SELECT count(*) FILTER (WHERE (l.created_at AT TIME ZONE 'Asia/Karachi')::date
                                = (now() AT TIME ZONE 'Asia/Karachi')::date),
         count(*) FILTER (WHERE (l.created_at AT TIME ZONE 'Asia/Karachi')::date
                                >= date_trunc('month', (now() AT TIME ZONE 'Asia/Karachi'))::date),
         count(*) FILTER (WHERE ow.role IN ('director','admin','cfo')),
         count(*) FILTER (WHERE l.owner_sales_user_id = v_ses.sales_user_id)
    INTO v_today, v_month, v_pooled, v_back
    FROM public.leads l
    LEFT JOIN public.sales_users ow ON ow.id = l.owner_sales_user_id
   WHERE l.created_by_sales_user_id = v_ses.sales_user_id AND l.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',id,'name',name,'phone',phone,'masked',masked,'source',source,
           'project_name',project_name,'created_at',created_at,
           'status',status,'owner_name',owner_name,
           'with_me',with_me,'waiting',waiting)
         ORDER BY created_at DESC),'[]'::jsonb)
    INTO v_rows FROM (
      SELECT l.id, l.name, l.source, l.created_at, l.status, p.project_name,
             ow.full_name AS owner_name,
             (l.owner_sales_user_id = v_ses.sales_user_id)  AS with_me,
             (ow.role IN ('director','admin','cfo'))        AS waiting,
             -- the number itself only while the lead is his to work
             CASE WHEN l.owner_sales_user_id = v_ses.sales_user_id
                  THEN l.phone ELSE public._mask_phone(l.phone) END AS phone,
             (l.owner_sales_user_id IS DISTINCT FROM v_ses.sales_user_id) AS masked
      FROM public.leads l
      LEFT JOIN public.projects p ON p.id=l.project_id
      LEFT JOIN public.sales_users ow ON ow.id=l.owner_sales_user_id
      WHERE l.created_by_sales_user_id=v_ses.sales_user_id AND l.deleted_at IS NULL
      ORDER BY l.created_at DESC LIMIT 200) t;

  RETURN jsonb_build_object('success',true,'rows',v_rows,'today',COALESCE(v_today,0),
    'month',COALESCE(v_month,0),
    'waiting',COALESCE(v_pooled,0),'with_me',COALESCE(v_back,0));
END; $function$;

REVOKE ALL ON FUNCTION public.get_my_entered_leads(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_entered_leads(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public._mask_phone(text) FROM PUBLIC;
