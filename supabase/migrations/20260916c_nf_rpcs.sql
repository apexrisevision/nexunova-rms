-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance v1 · c · the functions the screen calls
--
-- Every function here is SECURITY DEFINER and does three things only: check
-- who is asking, shape the arguments, and translate a database refusal into a
-- code the screen can show. The rules themselves are in 20260916b — if a
-- function here forgot one, the trigger would still refuse (SR-12).
--
-- No parameter has a DEFAULT (R8: no silent defaults). Amounts are refused,
-- not rounded, when they carry more than two decimals.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── internal helpers ───────────────────────────────────────────────────────
CREATE FUNCTION public.nf_require_role(p_company_id uuid, p_allowed text[])
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NF:NOT_SIGNED_IN'; END IF;
  v_role := public.nf_role(p_company_id);
  IF v_role IS NULL OR NOT (v_role = ANY (p_allowed)) THEN
    RAISE EXCEPTION 'NF:NOT_ALLOWED' USING DETAIL = COALESCE(v_role, 'not a member');
  END IF;
  RETURN v_role;
END
$$;

CREATE FUNCTION public.nf_day_company(p_day_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE v uuid;
BEGIN
  SELECT company_id INTO v FROM public.nf_days WHERE id = p_day_id;
  IF v IS NULL THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  RETURN v;
END
$$;

-- NULL is allowed through only where the caller says so; blank is never a zero.
CREATE FUNCTION public.nf_check_amount(p numeric, p_field text, p_nullable boolean)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path TO public, pg_temp
AS $$
BEGIN
  IF p IS NULL THEN
    IF p_nullable THEN RETURN; END IF;
    RAISE EXCEPTION 'NF:AMOUNT_REQUIRED' USING DETAIL = p_field;
  END IF;
  IF p <> round(p, 2) THEN RAISE EXCEPTION 'NF:AMOUNT_SCALE' USING DETAIL = p_field; END IF;
  IF p >= 1000000000000 THEN RAISE EXCEPTION 'NF:AMOUNT_TOO_LARGE' USING DETAIL = p_field; END IF;
END
$$;

CREATE FUNCTION public.nf_check_version(p_expected integer, p_actual integer)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path TO public, pg_temp
AS $$
BEGIN
  IF p_expected IS NULL THEN RAISE EXCEPTION 'NF:VERSION_REQUIRED'; END IF;
  IF p_expected <> p_actual THEN
    RAISE EXCEPTION 'NF:VERSION_CONFLICT' USING DETAIL = json_build_object('expected', p_expected, 'actual', p_actual)::text;
  END IF;
END
$$;

-- Which report category a head falls into: first rule by priority wins,
-- exactly as the reference's catIn / catOut if-chains do.
CREATE FUNCTION public.nf_category(p_company_id uuid, p_side text, p_head text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
  SELECT c.label FROM public.nf_report_categories c
   WHERE c.company_id = p_company_id AND c.side = p_side
     AND (   (c.match_kind = 'exact'  AND p_head = c.pattern)
          OR (c.match_kind = 'prefix' AND left(p_head, length(c.pattern)) = c.pattern)
          OR  c.match_kind = 'fallback')
   ORDER BY c.priority LIMIT 1;
$$;

CREATE FUNCTION public.nf_position(p_day_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  r record;
  v_company uuid := public.nf_day_company(p_day_id);
  v_rows jsonb;
BEGIN
  SELECT * INTO r FROM public.nf_position_row(p_day_id);
  SELECT jsonb_agg(x.j ORDER BY x.o) INTO v_rows FROM (
    SELECT CASE a.via WHEN 'Cash' THEN 1 WHEN 'Petty' THEN 2 ELSE 3 END AS o,
           jsonb_build_object(
             'via', a.via, 'code', a.code, 'label', a.via_label,
             'opening',   CASE a.via WHEN 'Cash' THEN r.open_cash  WHEN 'Petty' THEN r.open_petty  ELSE r.open_bank  END,
             'received',  CASE a.via WHEN 'Cash' THEN r.in_cash    WHEN 'Petty' THEN r.in_petty    ELSE r.in_bank    END,
             'paid',      CASE a.via WHEN 'Cash' THEN r.out_cash   WHEN 'Petty' THEN r.out_petty   ELSE r.out_bank   END,
             'transfers', CASE a.via WHEN 'Cash' THEN r.trf_cash   WHEN 'Petty' THEN r.trf_petty   ELSE r.trf_bank   END,
             'closing',   CASE a.via WHEN 'Cash' THEN r.close_cash WHEN 'Petty' THEN r.close_petty ELSE r.close_bank END) AS j
      FROM public.nf_accounts a WHERE a.company_id = v_company AND a.via IS NOT NULL) x;
  RETURN jsonb_build_object(
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'total', jsonb_build_object(
      'opening',   r.open_cash + r.open_petty + r.open_bank,
      'received',  r.in_cash + r.in_petty + r.in_bank,
      'paid',      r.out_cash + r.out_petty + r.out_bank,
      'transfers', r.trf_cash + r.trf_petty + r.trf_bank,
      'closing',   r.close_cash + r.close_petty + r.close_bank),
    'net', (r.in_cash + r.in_petty + r.in_bank) - (r.out_cash + r.out_petty + r.out_bank),
    'receipts', r.n_in,
    'payments', r.n_out);
END
$$;

-- PDCs still pending at the end of a given day.
CREATE FUNCTION public.nf_pdcs_as_of(p_day_id uuid)
RETURNS SETOF public.nf_pdcs LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
  SELECT p.* FROM public.nf_pdcs p
    JOIN public.nf_days d  ON d.id = p_day_id
    JOIN public.nf_days e  ON e.id = p.entered_day_id
    LEFT JOIN public.nf_days rd ON rd.id = p.resolved_day_id
   WHERE p.company_id = d.company_id
     AND e.business_date <= d.business_date
     AND (p.resolved_day_id IS NULL OR rd.business_date > d.business_date)
   ORDER BY p.created_at, p.id;
$$;

CREATE FUNCTION public.nf_day_json(p_day_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  d public.nf_days;
  v_checks jsonb;
BEGIN
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  v_checks := public.nf_checks(p_day_id);
  RETURN jsonb_build_object(
    'day', jsonb_build_object(
      'id', d.id, 'company_id', d.company_id, 'business_date', d.business_date, 'closing_no', d.closing_no,
      'status', d.status, 'is_first_day', d.is_first_day,
      'typed_open_cash', d.typed_open_cash, 'typed_open_petty', d.typed_open_petty, 'typed_open_bank', d.typed_open_bank,
      'transfer_to_bank', d.transfer_to_bank, 'transfer_to_petty', d.transfer_to_petty,
      'denominations', d.denominations, 'counted_cash', d.counted_cash, 'remarks', d.remarks,
      'prepared_by_name', d.prepared_by_name,
      'submitted_at', d.submitted_at, 'closed_at', d.closed_at,
      'closed_by_name', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = d.company_id AND m.user_id = d.closed_by),
      'variance', d.variance, 'variance_reason', d.variance_reason,
      'last_return_reason', d.last_return_reason, 'reopen_count', d.reopen_count,
      'is_latest', NOT EXISTS (SELECT 1 FROM public.nf_days x WHERE x.company_id = d.company_id AND x.business_date > d.business_date),
      'version', d.version),
    'position', public.nf_position(p_day_id),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'side', l.side, 'voucher_no', l.voucher_no, 'description', l.description,
               'head_code', l.head_code, 'head_name', a.name, 'floor_code', l.floor_code, 'via', l.via,
               'amount', l.amount, 'sort', l.sort, 'version', l.version) ORDER BY l.sort)
        FROM public.nf_lines l JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.head_code
       WHERE l.day_id = p_day_id), '[]'::jsonb),
    'pdcs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'direction', p.direction, 'cheque_no', p.cheque_no, 'party', p.party, 'bank', p.bank,
               'due_date', p.due_date, 'amount', p.amount, 'entered_here', p.entered_day_id = p_day_id,
               'version', p.version))
        FROM public.nf_pdcs_as_of(p_day_id) p), '[]'::jsonb),
    'checks', v_checks,
    'balanced', jsonb_array_length(v_checks) = 0);
END
$$;

-- Maps a constraint the tables refused on into the code the screen shows.
CREATE FUNCTION public.nf_translate(p_constraint text, p_sqlstate text, p_message text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO public, pg_temp
AS $$
  SELECT CASE
    WHEN p_constraint = 'nf_lines_voucher_unique'      THEN 'NF:DUPLICATE_VOUCHER'
    WHEN p_constraint = 'nf_lines_voucher_prefix'      THEN 'NF:VOUCHER_PREFIX'
    WHEN p_constraint = 'nf_lines_voucher_matches_via' THEN 'NF:VOUCHER_VIA_MISMATCH'
    WHEN p_constraint = 'nf_lines_head_fk'             THEN 'NF:HEAD_NOT_POSTABLE'
    WHEN p_constraint = 'nf_lines_floor_fk'            THEN 'NF:FLOOR_UNKNOWN'
    WHEN p_constraint = 'nf_lines_via_check'           THEN 'NF:VIA_UNKNOWN'
    WHEN p_constraint = 'nf_days_one_per_date'         THEN 'NF:DAY_EXISTS'
    WHEN p_constraint = 'nf_days_closing_no_key'       THEN 'NF:CLOSING_NO_EXISTS'
    WHEN p_constraint IN ('nf_days_one_unclosed','nf_days_one_first_day') THEN 'NF:PREVIOUS_DAY_NOT_CLOSED'
    ELSE 'NF:REFUSED' END;
$$;

-- ── reading ────────────────────────────────────────────────────────────────
CREATE FUNCTION public.nf_get_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NF:NOT_SIGNED_IN'; END IF;
  RETURN jsonb_build_object(
    'user_id', auth.uid(),
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'company_id', m.company_id,
               'company_name', COALESCE(c.display_name, c.company_name),
               'role', m.role, 'display_name', m.display_name,
               'settings', jsonb_build_object(
                  'large_payment_threshold', s.large_payment_threshold, 'pdc_due_days', s.pdc_due_days,
                  'company_line', s.company_line, 'report_title', s.report_title, 'mark', s.mark))
             ORDER BY c.company_name)
        FROM public.nf_members m
        JOIN public.companies c ON c.id = m.company_id
        LEFT JOIN public.nf_settings s ON s.company_id = m.company_id
       WHERE m.user_id = auth.uid() AND m.active), '[]'::jsonb));
END
$$;

CREATE FUNCTION public.nf_list_heads(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name) ORDER BY a.code)
                     FROM public.nf_accounts a
                    WHERE a.company_id = p_company_id AND a.is_head AND a.active), '[]'::jsonb);
END
$$;

CREATE FUNCTION public.nf_list_floors(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  RETURN COALESCE((SELECT jsonb_agg(f.code ORDER BY f.sort) FROM public.nf_floors f
                    WHERE f.company_id = p_company_id), '[]'::jsonb);
END
$$;

CREATE FUNCTION public.nf_list_vias(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('via', a.via, 'code', a.code, 'label', a.via_label)
                            ORDER BY CASE a.via WHEN 'Cash' THEN 1 WHEN 'Petty' THEN 2 ELSE 3 END)
                     FROM public.nf_accounts a WHERE a.company_id = p_company_id AND a.via IS NOT NULL), '[]'::jsonb);
END
$$;

CREATE FUNCTION public.nf_list_days(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'id', d.id, 'business_date', d.business_date, 'closing_no', d.closing_no,
                            'status', d.status, 'close_total', d.close_cash + d.close_petty + d.close_bank,
                            'variance', d.variance) ORDER BY d.business_date DESC)
                     FROM public.nf_days d
                    WHERE d.company_id = p_company_id
                      AND (p_from IS NULL OR d.business_date >= p_from)
                      AND (p_to   IS NULL OR d.business_date <= p_to)), '[]'::jsonb);
END
$$;

-- p_date NULL = the latest day.
CREATE FUNCTION public.nf_get_day(p_company_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_latest public.nf_days;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  SELECT id INTO v_id FROM public.nf_days
   WHERE company_id = p_company_id AND (p_date IS NULL OR business_date = p_date)
   ORDER BY business_date DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN public.nf_day_json(v_id); END IF;

  SELECT * INTO v_latest FROM public.nf_days WHERE company_id = p_company_id ORDER BY business_date DESC LIMIT 1;
  RETURN jsonb_build_object(
    'day', NULL,
    'latest', CASE WHEN v_latest.id IS NULL THEN NULL
                   ELSE jsonb_build_object('business_date', v_latest.business_date, 'status', v_latest.status,
                                           'closing_no', v_latest.closing_no) END);
END
$$;

CREATE FUNCTION public.nf_list_audit(p_day_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
BEGIN
  PERFORM public.nf_require_role(public.nf_day_company(p_day_id), ARRAY['director']);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'at', a.at, 'actor_name', a.actor_name, 'entity', a.entity, 'action', a.action,
                            'before', a.before, 'after', a.after, 'reason', a.reason) ORDER BY a.id)
                     FROM public.nf_audit a WHERE a.day_id = p_day_id), '[]'::jsonb);
END
$$;

-- ── starting a day ─────────────────────────────────────────────────────────
CREATE FUNCTION public.nf_start_first_day(p_company_id uuid, p_date date, p_closing_no text,
                                          p_open_cash numeric, p_open_petty numeric, p_open_bank numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['director']);
  IF p_date IS NULL THEN RAISE EXCEPTION 'NF:DATE_REQUIRED'; END IF;
  IF p_closing_no IS NULL OR btrim(p_closing_no) = '' THEN RAISE EXCEPTION 'NF:CLOSING_NO_REQUIRED'; END IF;
  PERFORM public.nf_check_amount(p_open_cash,  'open_cash',  false);
  PERFORM public.nf_check_amount(p_open_petty, 'open_petty', false);
  PERFORM public.nf_check_amount(p_open_bank,  'open_bank',  false);
  IF p_open_cash < 0 OR p_open_petty < 0 OR p_open_bank < 0 THEN RAISE EXCEPTION 'NF:NEGATIVE_POSITION'; END IF;
  BEGIN
    INSERT INTO public.nf_days (company_id, business_date, closing_no, status, is_first_day,
                                typed_open_cash, typed_open_petty, typed_open_bank, created_by)
    VALUES (p_company_id, p_date, upper(btrim(p_closing_no)), 'OPEN', true,
            p_open_cash, p_open_petty, p_open_bank, auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    DECLARE c text; BEGIN
      GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
      RAISE EXCEPTION '%', public.nf_translate(c, SQLSTATE, SQLERRM);
    END;
  END;
  RETURN public.nf_day_json(v_id);
END
$$;

CREATE FUNCTION public.nf_start_next_day(p_company_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_latest public.nf_days;
  v_m text[];
  v_no text;
  v_date date;
  v_id uuid;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  SELECT * INTO v_latest FROM public.nf_days WHERE company_id = p_company_id ORDER BY business_date DESC LIMIT 1;
  IF v_latest.id IS NULL THEN RAISE EXCEPTION 'NF:NO_FIRST_DAY'; END IF;
  IF v_latest.status <> 'CLOSED' THEN
    RAISE EXCEPTION 'NF:PREVIOUS_DAY_NOT_CLOSED' USING DETAIL = v_latest.business_date::text;
  END IF;

  -- The reference: the date moves on one day, the closing number by one,
  -- keeping its zero padding (DC-009 → DC-010).
  v_date := COALESCE(p_date, v_latest.business_date + 1);
  v_m := regexp_match(v_latest.closing_no, '^(.*?)([0-9]+)$');
  IF v_m IS NULL THEN RAISE EXCEPTION 'NF:CLOSING_NO_NOT_NUMBERED' USING DETAIL = v_latest.closing_no; END IF;
  v_no := v_m[1] || lpad((v_m[2]::numeric + 1)::text, length(v_m[2]), '0');

  BEGIN
    INSERT INTO public.nf_days (company_id, business_date, closing_no, status, is_first_day, created_by)
    VALUES (p_company_id, v_date, v_no, 'OPEN', false, auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    DECLARE c text; BEGIN
      GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
      RAISE EXCEPTION '%', public.nf_translate(c, SQLSTATE, SQLERRM);
    END;
  END;
  RETURN public.nf_day_json(v_id);
END
$$;

CREATE FUNCTION public.nf_set_first_day_opening(p_day_id uuid, p_open_cash numeric, p_open_petty numeric,
                                                p_open_bank numeric, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE d public.nf_days;
BEGIN
  PERFORM public.nf_require_role(public.nf_day_company(p_day_id), ARRAY['director']);
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  IF NOT d.is_first_day THEN RAISE EXCEPTION 'NF:OPENING_IS_COMPUTED'; END IF;
  PERFORM public.nf_check_version(p_version, d.version);
  PERFORM public.nf_check_amount(p_open_cash,  'open_cash',  false);
  PERFORM public.nf_check_amount(p_open_petty, 'open_petty', false);
  PERFORM public.nf_check_amount(p_open_bank,  'open_bank',  false);
  IF p_open_cash < 0 OR p_open_petty < 0 OR p_open_bank < 0 THEN RAISE EXCEPTION 'NF:NEGATIVE_POSITION'; END IF;
  UPDATE public.nf_days SET typed_open_cash = p_open_cash, typed_open_petty = p_open_petty,
                            typed_open_bank = p_open_bank
   WHERE id = p_day_id;
  RETURN public.nf_day_json(p_day_id);
END
$$;

-- ── lines ──────────────────────────────────────────────────────────────────
-- p_line_id NULL inserts; otherwise updates that line at p_version.
CREATE FUNCTION public.nf_save_line(p_day_id uuid, p_line_id uuid, p_side text, p_voucher_no text,
                                    p_description text, p_head text, p_floor text, p_via text,
                                    p_amount numeric, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  l public.nf_lines;
  v_sort integer;
  c text;
  v_used date;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  IF p_side IS NULL OR p_side NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'NF:SIDE_REQUIRED'; END IF;
  IF p_voucher_no IS NULL OR btrim(p_voucher_no) = '' THEN RAISE EXCEPTION 'NF:VOUCHER_REQUIRED'; END IF;
  IF p_head  IS NULL OR btrim(p_head)  = '' THEN RAISE EXCEPTION 'NF:HEAD_REQUIRED';  END IF;
  IF p_floor IS NULL OR btrim(p_floor) = '' THEN RAISE EXCEPTION 'NF:FLOOR_REQUIRED'; END IF;
  IF p_via   IS NULL OR btrim(p_via)   = '' THEN RAISE EXCEPTION 'NF:VIA_REQUIRED';   END IF;
  IF p_via NOT IN ('Cash','Petty','Bank') THEN RAISE EXCEPTION 'NF:VIA_UNKNOWN' USING DETAIL = p_via; END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;

  BEGIN
    IF p_line_id IS NULL THEN
      SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM public.nf_lines WHERE day_id = p_day_id;
      INSERT INTO public.nf_lines (company_id, day_id, side, voucher_no, description, head_code, floor_code,
                                   via, amount, sort, created_by)
      VALUES (v_company, p_day_id, p_side, upper(btrim(p_voucher_no)), NULLIF(btrim(p_description), ''),
              btrim(p_head), btrim(p_floor), p_via, p_amount, v_sort, auth.uid());
    ELSE
      SELECT * INTO l FROM public.nf_lines WHERE id = p_line_id AND day_id = p_day_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
      PERFORM public.nf_check_version(p_version, l.version);
      UPDATE public.nf_lines
         SET side = p_side, voucher_no = upper(btrim(p_voucher_no)), description = NULLIF(btrim(p_description), ''),
             head_code = btrim(p_head), floor_code = btrim(p_floor), via = p_via, amount = p_amount
       WHERE id = p_line_id;
    END IF;
  EXCEPTION
    WHEN unique_violation OR check_violation OR foreign_key_violation THEN
      GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
      IF c = 'nf_lines_voucher_unique' THEN
        SELECT d.business_date INTO v_used FROM public.nf_lines x JOIN public.nf_days d ON d.id = x.day_id
         WHERE x.company_id = v_company AND x.voucher_key = upper(btrim(p_voucher_no));
        RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER'
          USING DETAIL = json_build_object('voucher', upper(btrim(p_voucher_no)), 'used_on', v_used)::text;
      END IF;
      RAISE EXCEPTION '%', public.nf_translate(c, SQLSTATE, SQLERRM) USING DETAIL = COALESCE(c, SQLERRM);
  END;
  RETURN public.nf_day_json(p_day_id);
END
$$;

CREATE FUNCTION public.nf_delete_line(p_line_id uuid, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE l public.nf_lines;
BEGIN
  SELECT * INTO l FROM public.nf_lines WHERE id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(l.company_id, ARRAY['accountant','director']);
  PERFORM public.nf_check_version(p_version, l.version);
  DELETE FROM public.nf_lines WHERE id = p_line_id;
  RETURN public.nf_day_json(l.day_id);
END
$$;

-- ── the rest of the sheet ──────────────────────────────────────────────────
-- A transfer of 0 is the same as a blank field (the reference treats both as
-- "no transfer"); it is stored as NULL.
CREATE FUNCTION public.nf_set_transfers(p_day_id uuid, p_to_bank numeric, p_to_petty numeric, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE d public.nf_days;
BEGIN
  PERFORM public.nf_require_role(public.nf_day_company(p_day_id), ARRAY['accountant','director']);
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  PERFORM public.nf_check_amount(p_to_bank,  'transfer_to_bank',  true);
  PERFORM public.nf_check_amount(p_to_petty, 'transfer_to_petty', true);
  IF p_to_bank < 0 OR p_to_petty < 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  UPDATE public.nf_days SET transfer_to_bank = NULLIF(p_to_bank, 0), transfer_to_petty = NULLIF(p_to_petty, 0)
   WHERE id = p_day_id;
  RETURN public.nf_day_json(p_day_id);
END
$$;

-- p_denoms: only the fields somebody filled in, e.g. {"5000":50,"1000":60,"coins":12.5}.
-- NULL or {} clears the count back to "not counted".
CREATE FUNCTION public.nf_save_count(p_day_id uuid, p_denoms jsonb, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE d public.nf_days;
BEGIN
  PERFORM public.nf_require_role(public.nf_day_company(p_day_id), ARRAY['accountant','director']);
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  UPDATE public.nf_days SET denominations = NULLIF(p_denoms, '{}'::jsonb) WHERE id = p_day_id;
  RETURN public.nf_day_json(p_day_id);
END
$$;

CREATE FUNCTION public.nf_set_remarks(p_day_id uuid, p_remarks text, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE d public.nf_days;
BEGIN
  PERFORM public.nf_require_role(public.nf_day_company(p_day_id), ARRAY['accountant','director']);
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  UPDATE public.nf_days SET remarks = NULLIF(btrim(p_remarks), '') WHERE id = p_day_id;
  RETURN public.nf_day_json(p_day_id);
END
$$;

-- ── PDCs ───────────────────────────────────────────────────────────────────
CREATE FUNCTION public.nf_save_pdc(p_day_id uuid, p_pdc_id uuid, p_direction text, p_cheque_no text,
                                   p_party text, p_bank text, p_due_date date, p_amount numeric, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  p public.nf_pdcs;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  IF p_direction IS NULL OR p_direction NOT IN ('RECEIVED','ISSUED') THEN RAISE EXCEPTION 'NF:DIRECTION_REQUIRED'; END IF;
  IF p_cheque_no IS NULL OR btrim(p_cheque_no) = '' THEN RAISE EXCEPTION 'NF:CHEQUE_NO_REQUIRED'; END IF;
  IF p_due_date IS NULL THEN RAISE EXCEPTION 'NF:DUE_DATE_REQUIRED'; END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;

  IF p_pdc_id IS NULL THEN
    INSERT INTO public.nf_pdcs (company_id, direction, cheque_no, party, bank, due_date, amount,
                                entered_day_id, status, created_by)
    VALUES (v_company, p_direction, btrim(p_cheque_no), NULLIF(btrim(p_party), ''), NULLIF(btrim(p_bank), ''),
            p_due_date, p_amount, p_day_id, 'PENDING', auth.uid());
  ELSE
    SELECT * INTO p FROM public.nf_pdcs WHERE id = p_pdc_id AND company_id = v_company;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:PDC_NOT_FOUND'; END IF;
    PERFORM public.nf_check_version(p_version, p.version);
    UPDATE public.nf_pdcs
       SET direction = p_direction, cheque_no = btrim(p_cheque_no), party = NULLIF(btrim(p_party), ''),
           bank = NULLIF(btrim(p_bank), ''), due_date = p_due_date, amount = p_amount
     WHERE id = p_pdc_id;
  END IF;
  RETURN public.nf_day_json(p_day_id);
END
$$;

-- CLEARED / BOUNCED / CANCELLED record the day it happened on. PENDING undoes
-- a resolution made on the same, still open, day. Nothing is posted: a
-- cleared cheque's money is recorded by the accountant as a BRV or BPV.
CREATE FUNCTION public.nf_resolve_pdc(p_day_id uuid, p_pdc_id uuid, p_status text, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  p public.nf_pdcs;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  IF p_status IS NULL OR p_status NOT IN ('PENDING','CLEARED','BOUNCED','CANCELLED') THEN
    RAISE EXCEPTION 'NF:STATUS_REQUIRED';
  END IF;
  SELECT * INTO p FROM public.nf_pdcs WHERE id = p_pdc_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:PDC_NOT_FOUND'; END IF;
  PERFORM public.nf_check_version(p_version, p.version);
  UPDATE public.nf_pdcs
     SET status = p_status, resolved_day_id = CASE WHEN p_status = 'PENDING' THEN NULL ELSE p_day_id END
   WHERE id = p_pdc_id;
  RETURN public.nf_day_json(p_day_id);
END
$$;

CREATE FUNCTION public.nf_delete_pdc(p_pdc_id uuid, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE p public.nf_pdcs;
BEGIN
  SELECT * INTO p FROM public.nf_pdcs WHERE id = p_pdc_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:PDC_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(p.company_id, ARRAY['accountant','director']);
  PERFORM public.nf_check_version(p_version, p.version);
  DELETE FROM public.nf_pdcs WHERE id = p_pdc_id;
  RETURN public.nf_day_json(p.entered_day_id);
END
$$;

-- ── the day's state ────────────────────────────────────────────────────────
CREATE FUNCTION public.nf_submit_day(p_day_id uuid, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  d public.nf_days;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  UPDATE public.nf_days
     SET status = 'SUBMITTED', prepared_by = auth.uid(), prepared_by_name = public.nf_actor_name(v_company)
   WHERE id = p_day_id;
  RETURN public.nf_day_json(p_day_id);
END
$$;

-- An accountant or director closes a day whose checks all pass. A director
-- alone closes one whose count differs, and only with p_variance_reason.
CREATE FUNCTION public.nf_close_day(p_day_id uuid, p_version integer, p_variance_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  d public.nf_days;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  UPDATE public.nf_days
     SET status = 'CLOSED',
         variance_reason = NULLIF(btrim(p_variance_reason), ''),
         prepared_by = COALESCE(d.prepared_by, auth.uid()),
         prepared_by_name = COALESCE(d.prepared_by_name, public.nf_actor_name(v_company))
   WHERE id = p_day_id;
  RETURN public.nf_day_json(p_day_id);
END
$$;

CREATE FUNCTION public.nf_return_day(p_day_id uuid, p_reason text, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE d public.nf_days;
BEGIN
  PERFORM public.nf_require_role(public.nf_day_company(p_day_id), ARRAY['director']);
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  UPDATE public.nf_days SET status = 'OPEN', last_return_reason = NULLIF(btrim(p_reason), '') WHERE id = p_day_id;
  RETURN public.nf_day_json(p_day_id);
END
$$;

CREATE FUNCTION public.nf_reopen_day(p_day_id uuid, p_reason text, p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE d public.nf_days;
BEGIN
  PERFORM public.nf_require_role(public.nf_day_company(p_day_id), ARRAY['director']);
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  UPDATE public.nf_days SET status = 'OPEN', last_reopen_reason = NULLIF(btrim(p_reason), '') WHERE id = p_day_id;
  RETURN public.nf_day_json(p_day_id);
END
$$;

-- ── director report ────────────────────────────────────────────────────────
-- Aggregates only. No voucher number, no account code, no line id leaves this
-- function. The large-payments list carries each payment's description, as
-- the reference does (owner, 2026-09-16).
CREATE FUNCTION public.nf_get_report(p_day_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  d public.nf_days;
  s public.nf_settings;
  pos jsonb;
  v_checks jsonb;
  v_counted boolean;
  v_diff numeric;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director','viewer']);
  SELECT * INTO d FROM public.nf_days WHERE id = p_day_id;
  SELECT * INTO s FROM public.nf_settings WHERE company_id = v_company;
  IF s.company_id IS NULL THEN RAISE EXCEPTION 'NF:NOT_SEEDED'; END IF;
  pos := public.nf_position(p_day_id);
  v_checks := public.nf_checks(p_day_id);
  v_counted := d.denominations IS NOT NULL;
  v_diff := CASE WHEN v_counted THEN (SELECT (x->>'closing')::numeric FROM jsonb_array_elements(pos->'rows') x
                                      WHERE x->>'via' = 'Cash') - d.counted_cash END;

  RETURN jsonb_build_object(
    'business_date', d.business_date,
    'closing_no',    d.closing_no,
    'status',        d.status,
    'balanced',      jsonb_array_length(v_checks) = 0,
    'company_line',  s.company_line,
    'report_title',  s.report_title,
    'mark',          s.mark,
    'accounts', (SELECT jsonb_agg(jsonb_build_object('via', x->>'via', 'label', x->>'label',
                                                     'opening', (x->>'opening')::numeric,
                                                     'closing', (x->>'closing')::numeric) ORDER BY o)
                   FROM jsonb_array_elements(pos->'rows') WITH ORDINALITY AS t(x, o)),
    'total_close', (pos->'total'->>'closing')::numeric,
    'total_in',    (pos->'total'->>'received')::numeric,
    'total_out',   (pos->'total'->>'paid')::numeric,
    'in_categories',  public.nf_report_groups(p_day_id, 'IN'),
    'out_categories', public.nf_report_groups(p_day_id, 'OUT'),
    'large_threshold', s.large_payment_threshold,
    'large_payments', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'description', l.description,
                'category', public.nf_category(v_company, 'OUT', l.head_code),
                'by', CASE WHEN l.via = 'Bank' THEN 'bank' ELSE 'cash' END,
                'amount', l.amount) ORDER BY l.amount DESC, l.sort)
         FROM public.nf_lines l
        WHERE l.day_id = p_day_id AND l.side = 'OUT' AND l.amount >= s.large_payment_threshold), '[]'::jsonb),
    'counted', v_counted,
    'count_diff', v_diff,
    'variance_reason', d.variance_reason,
    'negatives', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', x->>'label', 'amount', (x->>'closing')::numeric))
                             FROM jsonb_array_elements(pos->'rows') x WHERE (x->>'closing')::numeric < 0), '[]'::jsonb),
    'transfer_to_bank', d.transfer_to_bank,
    'bank_label', (SELECT via_label FROM public.nf_accounts WHERE company_id = v_company AND via = 'Bank'),
    'other_issue_count', (SELECT count(*) FROM jsonb_array_elements(v_checks) c
                           WHERE c->>'key' NOT IN ('negative','not_counted','count_mismatch')),
    'pdc_due_days', s.pdc_due_days,
    'pdc_due', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('direction', p.direction, 'amount', p.amount, 'party', p.party,
                                           'due_date', p.due_date)
                        ORDER BY CASE p.direction WHEN 'RECEIVED' THEN 1 ELSE 2 END, p.created_at, p.id)
         FROM public.nf_pdcs_as_of(p_day_id) p
        WHERE p.due_date BETWEEN d.business_date AND d.business_date + s.pdc_due_days), '[]'::jsonb),
    'pdc_pending', jsonb_build_object(
       'received', (SELECT COALESCE(sum(amount), 0) FROM public.nf_pdcs_as_of(p_day_id) WHERE direction = 'RECEIVED'),
       'issued',   (SELECT COALESCE(sum(amount), 0) FROM public.nf_pdcs_as_of(p_day_id) WHERE direction = 'ISSUED')),
    'prepared_by_name', d.prepared_by_name);
END
$$;

-- Money in / out by category: largest first; a tie keeps the order the
-- categories first appeared on the sheet, as the reference's stable sort does.
CREATE FUNCTION public.nf_report_groups(p_day_id uuid, p_side text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('label', g.label, 'amount', g.amount, 'count', g.n)
                            ORDER BY g.amount DESC, g.first_sort), '[]'::jsonb)
    FROM (SELECT public.nf_category(l.company_id, p_side, l.head_code) AS label,
                 sum(l.amount) AS amount, count(*) AS n, min(l.sort) AS first_sort
            FROM public.nf_lines l
           WHERE l.day_id = p_day_id AND l.side = p_side
           GROUP BY 1) g;
$$;

-- ── membership ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.nf_set_member(p_company_id uuid, p_user_id uuid, p_role text, p_display_name text, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['director']);
  IF p_user_id IS NULL OR p_role IS NULL OR p_display_name IS NULL OR p_active IS NULL THEN
    RAISE EXCEPTION 'NF:MEMBER_FIELDS_REQUIRED';
  END IF;
  INSERT INTO public.nf_members (company_id, user_id, role, display_name, active)
  VALUES (p_company_id, p_user_id, p_role, btrim(p_display_name), p_active)
  ON CONFLICT (company_id, user_id) DO UPDATE
     SET role = EXCLUDED.role, display_name = EXCLUDED.display_name, active = EXCLUDED.active;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role,
                                                       'display_name', m.display_name, 'active', m.active)
                                    ORDER BY m.display_name)
                     FROM public.nf_members m WHERE m.company_id = p_company_id), '[]'::jsonb);
END
$$;

-- ── operator only: seeding a company, purging a test company ───────────────
-- p_seed = {settings:{…}, accounts:[…in parent-first order…], floors:[…], categories:[…]}
-- Generated by scripts/nf/gen-seed.js from the COA workbook and the reference.
CREATE FUNCTION public._nf_seed_company(p_company_id uuid, p_seed jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE x jsonb; o bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.nf_accounts WHERE company_id = p_company_id) THEN
    RAISE EXCEPTION 'NF:ALREADY_SEEDED';
  END IF;
  INSERT INTO public.nf_settings (company_id, large_payment_threshold, pdc_due_days, company_line, report_title, mark)
  VALUES (p_company_id, (p_seed->'settings'->>'large_payment_threshold')::numeric,
          (p_seed->'settings'->>'pdc_due_days')::integer, p_seed->'settings'->>'company_line',
          p_seed->'settings'->>'report_title', p_seed->'settings'->>'mark');
  FOR x, o IN SELECT * FROM jsonb_array_elements(p_seed->'accounts') WITH ORDINALITY LOOP
    INSERT INTO public.nf_accounts (company_id, code, name, qb_type, parent_code, description, is_head, via, via_label, sort, active)
    VALUES (p_company_id, x->>'code', x->>'name', x->>'qb_type', x->>'parent_code', x->>'description',
            (x->>'is_head')::boolean, x->>'via', x->>'via_label', o, true);
  END LOOP;
  FOR x, o IN SELECT * FROM jsonb_array_elements(p_seed->'floors') WITH ORDINALITY LOOP
    INSERT INTO public.nf_floors (company_id, code, qb_class, sort) VALUES (p_company_id, x->>'code', x->>'qb_class', o);
  END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(p_seed->'categories') LOOP
    INSERT INTO public.nf_report_categories (company_id, side, priority, match_kind, pattern, label)
    VALUES (p_company_id, x->>'side', (x->>'priority')::integer, x->>'match_kind', x->>'pattern', x->>'label');
  END LOOP;
  RETURN jsonb_build_object(
    'accounts',   (SELECT count(*) FROM public.nf_accounts WHERE company_id = p_company_id),
    'heads',      (SELECT count(*) FROM public.nf_accounts WHERE company_id = p_company_id AND is_head),
    'vias',       (SELECT count(*) FROM public.nf_accounts WHERE company_id = p_company_id AND via IS NOT NULL),
    'floors',     (SELECT count(*) FROM public.nf_floors WHERE company_id = p_company_id),
    'categories', (SELECT count(*) FROM public.nf_report_categories WHERE company_id = p_company_id));
END
$$;

-- Removes every nf_ row of a ZZTEST-NF-* company, and the company. Refuses any
-- other name. Returns what it removed so the harness can print it, and what
-- is left (all zeros) so the harness can assert it.
CREATE FUNCTION public._nf_test_purge(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp
AS $$
DECLARE
  v_name text;
  n jsonb := '{}'::jsonb;
  k integer;
BEGIN
  SELECT company_name INTO v_name FROM public.companies WHERE id = p_company_id;
  IF v_name IS NULL OR v_name NOT LIKE 'ZZTEST-NF-%' THEN
    RAISE EXCEPTION 'NF:PURGE_REFUSED' USING DETAIL = COALESCE(v_name, 'no such company');
  END IF;
  PERFORM set_config('nf.purge_company', p_company_id::text, true);

  DELETE FROM public.nf_audit             WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_audit', k);
  DELETE FROM public.nf_pdcs              WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_pdcs', k);
  DELETE FROM public.nf_lines             WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_lines', k);
  DELETE FROM public.nf_days              WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_days', k);
  DELETE FROM public.nf_report_categories WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_report_categories', k);
  DELETE FROM public.nf_floors            WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_floors', k);
  -- children before parents
  k := 0;
  LOOP
    DELETE FROM public.nf_accounts a WHERE a.company_id = p_company_id
       AND NOT EXISTS (SELECT 1 FROM public.nf_accounts c WHERE c.company_id = a.company_id AND c.parent_code = a.code);
    EXIT WHEN NOT FOUND;
  END LOOP;
  n := n || jsonb_build_object('nf_accounts_left', (SELECT count(*) FROM public.nf_accounts WHERE company_id = p_company_id));
  DELETE FROM public.nf_settings WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_settings', k);
  DELETE FROM public.nf_members  WHERE company_id = p_company_id; GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('nf_members', k);
  -- the purge's own deletions are not audited; make sure nothing slipped in
  DELETE FROM public.nf_audit    WHERE company_id = p_company_id;
  DELETE FROM public.companies   WHERE id = p_company_id;         GET DIAGNOSTICS k = ROW_COUNT; n := n || jsonb_build_object('companies', k);
  RETURN n;
END
$$;

-- ── grants ─────────────────────────────────────────────────────────────────
DO $grants$
DECLARE f regprocedure; v_name text;
BEGIN
  FOR f, v_name IN SELECT p.oid::regprocedure, p.proname FROM pg_proc p
                    WHERE p.pronamespace = 'public'::regnamespace
                      AND (p.proname LIKE 'nf\_%' OR p.proname LIKE '\_nf\_%')
                      AND p.proname <> 'nf_is_member' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    IF v_name IN ('nf_get_context','nf_list_heads','nf_list_floors','nf_list_vias','nf_list_days','nf_get_day',
                  'nf_list_audit','nf_start_first_day','nf_start_next_day','nf_set_first_day_opening',
                  'nf_save_line','nf_delete_line','nf_set_transfers','nf_save_count','nf_set_remarks',
                  'nf_save_pdc','nf_resolve_pdc','nf_delete_pdc','nf_submit_day','nf_close_day',
                  'nf_return_day','nf_reopen_day','nf_get_report','nf_set_member') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
    ELSIF v_name IN ('_nf_seed_company','_nf_test_purge') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END IF;
  END LOOP;
END
$grants$;

COMMIT;
