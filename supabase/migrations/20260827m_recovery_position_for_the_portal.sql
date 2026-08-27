-- ══ Recovery Position, trimmed to the month ═════════════════════════════════
--
-- The desktop report already decides what due, received and closing mean, and
-- the office argues from it. Rebuilding that arithmetic here would eventually
-- disagree with it, so this calls get_recovery_position and takes five columns
-- out of the answer: serial, client, unit, this month's due, this month's
-- received — and the remainder of the two.
--
-- Deliberately NOT carried across: closing. That is the whole book since 2023
-- (PKR 19.5 crore on KBH alone) and an officer is not answerable for it this
-- month. Remaining here means what is left of THIS month's due, nothing wider.
--
-- Rows with no due and no receipt in the period are dropped. Their due,
-- received and remaining are all zero, so every total below is unchanged by
-- their absence and still ties to the desktop report.

CREATE OR REPLACE FUNCTION public.portal_recovery_position(p_session_token text, p_date date DEFAULT NULL::date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ses   public.sales_sessions;
  v_su    public.sales_users;
  v_day   date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_m1    date;
  r       record;
  v_rows  jsonb := '[]'::jsonb;
  v_due   numeric := 0;
  v_recv  numeric := 0;
  v_projs jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;

  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  IF v_su.role IS DISTINCT FROM 'recovery_officer' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_recovery',
      'message', 'This screen belongs to the recovery officers.');
  END IF;
  IF v_su.app_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_linked',
      'message', 'Your portal login is not joined to your RMS recovery account yet. Please ask the office.');
  END IF;

  v_m1 := date_trunc('month', v_day)::date;

  FOR r IN
    SELECT upa.company_id, upa.project_id, p.project_name
      FROM public.user_project_assignments upa
      JOIN public.projects p ON p.id = upa.project_id
     WHERE upa.user_id = v_su.app_user_id AND upa.is_active
     ORDER BY p.project_name
  LOOP
    DECLARE
      j        jsonb := public.get_recovery_position(r.company_id, r.project_id, v_m1, v_day);
      p_due    numeric := COALESCE((j->'totals'->>'due')::numeric, 0);
      p_recv   numeric := COALESCE((j->'totals'->>'received_total')::numeric, 0);
    BEGIN
      v_due  := v_due  + p_due;
      v_recv := v_recv + p_recv;
      v_projs := v_projs || jsonb_build_array(jsonb_build_object(
        'project_name', r.project_name,
        'due',       round(p_due),
        'received',  round(p_recv),
        'remaining', round(GREATEST(p_due - p_recv, 0))));

      v_rows := v_rows || COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'client',    e->>'client_name',
                 'unit',      e->>'unit_no',
                 'phone',     e->>'phone',
                 'project',   r.project_name,
                 'due',       round(COALESCE((e->>'due_period')::numeric, 0)),
                 'received',  round(COALESCE((e->>'received_total')::numeric, 0)),
                 'remaining', round(GREATEST(COALESCE((e->>'due_period')::numeric, 0)
                                           - COALESCE((e->>'received_total')::numeric, 0), 0))))
          FROM jsonb_array_elements(j->'rows') e
         WHERE COALESCE((e->>'due_period')::numeric, 0) > 0
            OR COALESCE((e->>'received_total')::numeric, 0) > 0), '[]'::jsonb);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success',   true,
    'as_of',     v_day,
    'from',      v_m1,
    'officer',   v_su.full_name,
    'projects',  v_projs,
    'due',       round(v_due),
    'received',  round(v_recv),
    'remaining', round(GREATEST(v_due - v_recv, 0)),
    -- Biggest remainder first: the order an officer works the list in.
    'rows', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'remaining')::numeric DESC,
                                       (x->>'due')::numeric DESC)
                        FROM jsonb_array_elements(v_rows) x), '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.portal_recovery_position(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_recovery_position(text, date) TO anon;
