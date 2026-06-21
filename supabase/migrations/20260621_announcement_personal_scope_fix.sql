-- Fix: personal/system messages (welcome, followup — sales_user_id set) must stay
-- PERSONAL, not leak company-wide. 2026-06-21. Regression from the targeting
-- rewrite: those rows have target_type='all' (column default) + sales_user_id set,
-- so the new 'all' broadcast branch showed them to everyone. Broadcast/targeting
-- branches now apply ONLY to rows with sales_user_id IS NULL (real broadcasts).
CREATE OR REPLACE FUNCTION public._ann_recipients(p_id uuid)
RETURNS TABLE(sales_user_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE a public.sales_announcements;
BEGIN
  SELECT * INTO a FROM public.sales_announcements WHERE id=p_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF a.sales_user_id IS NOT NULL THEN   -- personal/system note → exactly that user
    RETURN QUERY SELECT su.id FROM public.sales_users su WHERE su.id=a.sales_user_id AND su.status='active';
    RETURN;
  END IF;
  RETURN QUERY
  SELECT su.id FROM public.sales_users su
  WHERE su.status='active'
    AND su.id IS DISTINCT FROM a.author_sales_user_id
    AND (
      (a.target_type='all'  AND su.company_id = a.company_id)
      OR (a.target_type='role' AND su.company_id = a.company_id AND su.role = a.target_value)
      OR (a.target_type='user' AND su.id = NULLIF(a.target_value,'')::uuid)
      OR (a.target_type='team' AND su.id IN (
            WITH RECURSIVE sub AS (
              SELECT id FROM public.sales_users WHERE id = NULLIF(a.target_value,'')::uuid
              UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id
            ) SELECT id FROM sub))
    );
END
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_announcements(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_group uuid; v_role text; v_uid uuid;
        v_rows jsonb; v_unread int; v_unread_ann int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_uid := v_ses.sales_user_id;
  SELECT dealer_group_id INTO v_group FROM public.companies WHERE id=v_ses.company_id;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_uid;

  WITH vis AS (
    SELECT a.* FROM public.sales_announcements a
    WHERE a.is_active
      AND NOT (a.kind='followup' AND a.created_at < now() - interval '3 days')
      AND NOT (a.kind='system'   AND a.created_at < now() - interval '30 days')
      AND (
        a.author_sales_user_id = v_uid
        OR a.sales_user_id = v_uid
        OR (a.sales_user_id IS NULL AND (
             (a.target_type='all'  AND (a.company_id=v_ses.company_id OR (v_group IS NOT NULL AND a.group_id=v_group)))
             OR (a.target_type='role' AND a.company_id=v_ses.company_id AND v_role = a.target_value)
             OR (a.target_type='user' AND a.target_value = v_uid::text)
             OR (a.target_type='team' AND v_uid IN (
                   WITH RECURSIVE sub AS (
                     SELECT id FROM public.sales_users WHERE id=NULLIF(a.target_value,'')::uuid
                     UNION SELECT s.id FROM public.sales_users s JOIN sub ON s.parent_sales_user_id=sub.id
                   ) SELECT id FROM sub))
        ))
      )
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'title', a.title, 'body', a.body, 'kind', a.kind,
    'priority', a.priority, 'is_important', a.is_important, 'attachments', a.attachments,
    'created_at', a.created_at,
    'author_name', COALESCE(au.full_name, 'Your company'),
    'is_author', (a.author_sales_user_id = v_uid),
    'requires_ack', a.requires_ack,
    'seen', (r.seen_at IS NOT NULL), 'seen_at', r.seen_at,
    'acknowledged', (r.acknowledged_at IS NOT NULL), 'acknowledged_at', r.acknowledged_at
  ) ORDER BY a.created_at DESC), '[]'::jsonb),
  count(*) FILTER (WHERE a.author_sales_user_id IS DISTINCT FROM v_uid AND r.seen_at IS NULL),
  count(*) FILTER (WHERE a.kind='announcement' AND a.author_sales_user_id IS DISTINCT FROM v_uid AND r.seen_at IS NULL)
    INTO v_rows, v_unread, v_unread_ann
  FROM vis a
  LEFT JOIN public.announcement_receipts r ON r.announcement_id=a.id AND r.sales_user_id=v_uid
  LEFT JOIN public.sales_users au ON au.id=a.author_sales_user_id;

  RETURN jsonb_build_object('success',true,'announcements',v_rows,
    'unread',COALESCE(v_unread,0),'unread_announcements',COALESCE(v_unread_ann,0));
END
$function$;
