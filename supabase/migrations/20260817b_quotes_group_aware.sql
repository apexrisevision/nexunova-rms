-- Phase 5 — quotes read across the dealer group, exactly as reserve_unit and the
-- map already do.
--
-- Found the moment KBH went live and a real Awami rep was driven through the
-- portal: Muhammad Saeed could SEE the KBH floor, could open a KBH flat, and could
-- have HELD it — reserve_unit spans the group — but "Make a plan" came back
-- not_found. save_unit_quote was written before 20260816b widened the map's reads
-- and still scoped the unit lookup to the session's own company.
--
-- So the whole intended audience for the KBH map — all 17 umbrella Awami reps —
-- could hold a flat but not quote one. This is the same inconsistency 20260816b
-- fixed, in the one place it was missed.
--
-- The rule is COPIED, not reinvented: _map_scope_companies(p_session_token), the
-- single definition of "which companies may this session reach", so read and write
-- cannot drift apart again.
--
-- Which company OWNS the quote: the UNIT's, not the session's — the same choice
-- reserve_unit makes for a reservation (VALUES (v_unit.company_id, …)). A quote on
-- a KBH flat is a KBH quote and carries a KBH quote number, whichever dealer's rep
-- wrote it; sales_user_id already records who that was.
--
-- Strictly a widening. For a rep quoting their own company's inventory the unit's
-- company and the session's company are the same row, so nothing changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.save_unit_quote(
  p_session_token text, p_unit_id uuid, p_client_name text, p_client_phone text,
  p_discount numeric, p_down_payment numeric, p_monthly numeric,
  p_start_date date, p_end_date date, p_lead_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ses public.sales_sessions; v_u public.units; v_no text; v_cos uuid[];
        v_list numeric; v_net numeric; v_months int; v_sched jsonb := '[]'::jsonb;
        v_d date; v_i int; v_left numeric; v_amt numeric; v_id uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF NULLIF(TRIM(COALESCE(p_client_name,'')),'') IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','client_required','message','Who is this quote for?'); END IF;

  v_cos := public._map_scope_companies(p_session_token);
  SELECT * INTO v_u FROM public.units WHERE id=p_unit_id AND company_id = ANY(v_cos);
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  v_list := COALESCE(v_u.base_price, 0);
  v_net  := GREATEST(v_list - COALESCE(p_discount,0), 0);
  IF COALESCE(p_discount,0) > v_list AND v_list > 0 THEN
    RETURN jsonb_build_object('success',false,'error','discount_too_big',
      'message','The discount is larger than the price.'); END IF;

  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN
    IF p_end_date < p_start_date THEN
      RETURN jsonb_build_object('success',false,'error','bad_dates','message','The end date is before the start date.'); END IF;
    v_months := GREATEST((extract(year FROM age(p_end_date, p_start_date)) * 12
                        + extract(month FROM age(p_end_date, p_start_date)))::int, 1);
  ELSE v_months := 0; END IF;

  IF v_months > 0 AND COALESCE(p_monthly,0) > 0 THEN
    v_left := v_net - COALESCE(p_down_payment,0);
    FOR v_i IN 1..v_months LOOP
      v_d := (p_start_date + (v_i - 1) * interval '1 month')::date;
      v_amt := CASE WHEN v_i = v_months THEN v_left ELSE LEAST(p_monthly, v_left) END;
      EXIT WHEN v_amt <= 0 AND v_i < v_months;
      v_sched := v_sched || jsonb_build_object('n', v_i, 'due', v_d, 'amount', round(v_amt, 0));
      v_left := v_left - v_amt;
    END LOOP;
  END IF;

  -- numbered against the company that owns the inventory
  v_no := public._quote_next_no(v_u.company_id);

  INSERT INTO public.unit_map_quotes (
    company_id, project_id, unit_id, sales_user_id, lead_id, quote_no,
    client_name, client_phone, list_price, discount, net_price, rate_pending,
    down_payment, monthly_amount, start_date, end_date, months, schedule, valid_until)
  VALUES (
    v_u.company_id, v_u.project_id, p_unit_id, v_ses.sales_user_id, p_lead_id, v_no,
    TRIM(p_client_name), NULLIF(TRIM(COALESCE(p_client_phone,'')),''),
    v_list, COALESCE(p_discount,0), v_net, (v_list = 0),
    COALESCE(p_down_payment,0), COALESCE(p_monthly,0), p_start_date, p_end_date,
    v_months, v_sched, (public._fu_today() + 14))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'id',v_id,'quote_no',v_no,
    'net_price',v_net,'rate_pending',(v_list = 0),'months',v_months,'schedule',v_sched);
END $$;

COMMENT ON FUNCTION public.save_unit_quote(text,uuid,text,text,numeric,numeric,numeric,date,date,uuid) IS
  'Save a price offer against a unit. Reaches across the dealer group through '
  '_map_scope_companies, the same rule reserve_unit uses, so a rep who may hold a '
  'flat may also quote it. The quote belongs to the company that owns the unit.';

-- and the read-back, or the rep could not print what they just saved
CREATE OR REPLACE FUNCTION public.get_unit_quote(p_session_token text, p_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ses public.sales_sessions; v_q public.unit_map_quotes; v_u public.units; v_cos uuid[];
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_cos := public._map_scope_companies(p_session_token);
  SELECT * INTO v_q FROM public.unit_map_quotes WHERE id=p_quote_id AND company_id = ANY(v_cos);
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  SELECT * INTO v_u FROM public.units WHERE id=v_q.unit_id;

  RETURN jsonb_build_object('success',true,
    'quote', to_jsonb(v_q),
    'unit', jsonb_build_object('unit_no',v_u.unit_no,'floor_label',v_u.floor_label,
      'area',v_u.area,'type',(SELECT t.type_name FROM public.category_unit_types t WHERE t.id=v_u.unit_type_id)),
    'project', (SELECT p.project_name FROM public.projects p WHERE p.id=v_q.project_id),
    'by', (SELECT su.full_name FROM public.sales_users su WHERE su.id=v_q.sales_user_id));
END $$;

COMMIT;
