-- ══ Recovery Position (Grand Summary), for the accounts desk ════════════════
--
-- The same desktop report the office argues from, called the same way, with two
-- columns left off at Rashid's word: Paid % and Risk. Everything else the
-- report carries is carried here — the five KPI figures of the rollforward and
-- the per-sale table.
--
-- Unlike the recovery officer's cut, Closing IS included. That was left out
-- there because an officer is measured on the month; an accounts desk reading a
-- position statement needs the balance the statement closes on.
--
-- Scope is the assignment, never the group: KBH's clerk sees KBH.

CREATE OR REPLACE FUNCTION public.portal_accounts_position(p_session_token text, p_date date DEFAULT NULL::date)
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
  v_projs jsonb := '[]'::jsonb;
  v_names text[] := '{}';
  t_open numeric := 0; t_open_dp numeric := 0; t_open_arr numeric := 0;
  t_due  numeric := 0; t_recv numeric := 0;
  t_rdp  numeric := 0; t_rold numeric := 0; t_rcur numeric := 0;
  t_close numeric := 0; t_close_dp numeric := 0; t_close_old numeric := 0; t_close_cur numeric := 0;
  t_net  numeric := 0; t_count integer := 0;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;

  SELECT * INTO v_su FROM public.sales_users WHERE id = v_ses.sales_user_id;
  IF v_su.role IS DISTINCT FROM 'accounts' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_accounts',
      'message', 'This screen belongs to the accounts desk.');
  END IF;
  IF v_su.app_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_linked',
      'message', 'Your portal login is not joined to your RMS accounts user yet. Please ask the office.');
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
      j jsonb := public.get_recovery_position(r.company_id, r.project_id, v_m1, v_day);
      tt jsonb := j->'totals';
      n  numeric := COALESCE((tt->>'due')::numeric,0);
    BEGIN
      v_names := v_names || r.project_name;
      t_open      := t_open      + COALESCE((tt->>'opening')::numeric,0);
      t_open_dp   := t_open_dp   + COALESCE((tt->>'opening_dp')::numeric,0);
      t_open_arr  := t_open_arr  + COALESCE((tt->>'opening_arrears')::numeric,0);
      t_due       := t_due       + n;
      t_recv      := t_recv      + COALESCE((tt->>'received_total')::numeric,0);
      t_rdp       := t_rdp       + COALESCE((tt->>'r_dp')::numeric,0);
      t_rold      := t_rold      + COALESCE((tt->>'r_old')::numeric,0);
      t_rcur      := t_rcur      + COALESCE((tt->>'r_cur')::numeric,0);
      t_close     := t_close     + COALESCE((tt->>'closing')::numeric,0);
      t_close_dp  := t_close_dp  + COALESCE((tt->>'closing_dp')::numeric,0);
      t_close_old := t_close_old + COALESCE((tt->>'closing_old')::numeric,0);
      t_close_cur := t_close_cur + COALESCE((tt->>'closing_current')::numeric,0);
      t_net       := t_net       + COALESCE((tt->>'net_price')::numeric,0);
      t_count     := t_count     + COALESCE((tt->>'row_count')::int,0);

      v_projs := v_projs || jsonb_build_array(jsonb_build_object(
        'project_name', r.project_name,
        'opening',   round(COALESCE((tt->>'opening')::numeric,0)),
        'due',       round(n),
        'received',  round(COALESCE((tt->>'received_total')::numeric,0)),
        'closing',   round(COALESCE((tt->>'closing')::numeric,0))));

      -- Paid % and Risk are deliberately not carried into the row.
      v_rows := v_rows || COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'client',    e->>'client_name',
                 'unit',      e->>'unit_no',
                 'project',   r.project_name,
                 'net_price', round(COALESCE((e->>'net_price')::numeric,0)),
                 'opening',   round(COALESCE((e->>'opening')::numeric,0)),
                 'due',       round(COALESCE((e->>'due_period')::numeric,0)),
                 'received',  round(COALESCE((e->>'received_total')::numeric,0)),
                 'closing',   round(COALESCE((e->>'closing')::numeric,0))))
          FROM jsonb_array_elements(j->'rows') e), '[]'::jsonb);
    END;
  END LOOP;

  IF t_count = 0 AND array_length(v_names,1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_project',
      'message', 'No project is assigned to your RMS accounts user yet. Please ask the office.');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'as_of', v_day, 'from', v_m1,
    'scope', array_to_string(v_names, ', '),
    'totals', jsonb_build_object(
      'opening', round(t_open), 'opening_dp', round(t_open_dp), 'opening_arrears', round(t_open_arr),
      'due', round(t_due), 'received', round(t_recv),
      'r_dp', round(t_rdp), 'r_old', round(t_rold), 'r_cur', round(t_rcur),
      'closing', round(t_close), 'closing_dp', round(t_close_dp),
      'closing_old', round(t_close_old), 'closing_current', round(t_close_cur),
      'net_price', round(t_net), 'row_count', t_count,
      -- Received ÷ (Opening + Due), the report's own definition.
      'recovery_pct', CASE WHEN (t_open + t_due) > 0
                           THEN round((t_recv / (t_open + t_due) * 100)::numeric, 1) ELSE 0 END),
    'projects', v_projs,
    'rows', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'closing')::numeric DESC)
                        FROM jsonb_array_elements(v_rows) x), '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.portal_accounts_position(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_accounts_position(text, date) TO anon;
