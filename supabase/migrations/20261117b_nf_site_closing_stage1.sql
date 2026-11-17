-- ══ NexuFinance — Site Closing, Stage 1: role, tables, site-day functions, withdrawals ══
-- Spec: docs/SITE_CLOSING_SPEC.md. Matching (Stage 2), screens (3), combined closing (4) later.
--
-- What changes for EXISTING things, deliberately small:
--   * nf_members.role may also be 'site'.
--   * nf_is_member() ignores 'site' members. It is used ONLY by the table SELECT policies, so a
--     site user cannot read vouchers, legs, days, PDCs, parties or accounts directly. Nobody holds
--     the 'site' role today, so no existing user sees any difference.
-- Everything else is new.

-- ── 1. the role ──────────────────────────────────────────────────────────
ALTER TABLE public.nf_members DROP CONSTRAINT nf_members_role_check;
ALTER TABLE public.nf_members ADD CONSTRAINT nf_members_role_check
  CHECK (role = ANY (ARRAY['accountant'::text, 'director'::text, 'viewer'::text, 'site'::text]));

CREATE OR REPLACE FUNCTION public.nf_is_member(p_company_id uuid, p_director_only boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.nf_members m
     WHERE m.company_id = p_company_id
       AND m.user_id = auth.uid()
       AND m.active
       -- a site accountant reads his own site days through the site functions
       -- only; he never reads the HO books, the bank or the reports (20261117b)
       AND m.role <> 'site'
       AND (NOT p_director_only OR m.role = 'director'));
$function$;

-- ── 2. tables ────────────────────────────────────────────────────────────
CREATE TABLE public.nf_combined_closings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id),
  business_date     date NOT NULL,
  ho_cash           numeric(14,2),
  site_cash_book    numeric(14,2),
  site_cash_counted numeric(14,2),
  bank              numeric(14,2),
  snapshot          jsonb,
  status            text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  closed_by         uuid,
  closed_at         timestamptz,
  reopen_reason     text,
  excel_exported_at timestamptz,
  iif_batch_id      uuid REFERENCES public.nf_iif_batches(id),
  version           integer NOT NULL DEFAULT 1,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, business_date)
);

CREATE TABLE public.nf_site_days (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id),
  business_date       date NOT NULL,
  status              text NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','SUBMITTED','RETURNED','MERGED')),
  is_first_day        boolean NOT NULL DEFAULT false,
  -- typed by HO on the first day; NULL on later days until frozen at merge
  opening_cash        numeric(14,2) CHECK (opening_cash IS NULL OR opening_cash >= 0),
  counted_cash        numeric(14,2) CHECK (counted_cash IS NULL OR counted_cash >= 0),
  denominations       jsonb,
  book_closing        numeric(14,2),
  variance            numeric(14,2),
  variance_reason     text,
  submitted_by        uuid,
  submitted_at        timestamptz,
  returned_reason     text,
  returned_by         uuid,
  returned_at         timestamptz,
  reopen_reason       text,
  merged_by           uuid,
  merged_at           timestamptz,
  combined_closing_id uuid REFERENCES public.nf_combined_closings(id),
  version             integer NOT NULL DEFAULT 1,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, business_date),
  CHECK (NOT is_first_day OR opening_cash IS NOT NULL)
);
CREATE UNIQUE INDEX nf_site_days_one_first ON public.nf_site_days (company_id) WHERE is_first_day;

CREATE TABLE public.nf_site_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id),
  site_day_id        uuid NOT NULL REFERENCES public.nf_site_days(id),
  line_no            integer NOT NULL,
  side               text NOT NULL CHECK (side IN ('IN','OUT')),
  doc_no             text,
  party_name         text,
  unit_codes         text,
  token_no           integer CHECK (token_no IS NULL OR token_no > 0),
  head_code          text NOT NULL,
  via                text NOT NULL CHECK (via IN ('SITE_CASH','BANK')),
  amount             numeric(14,2) NOT NULL CHECK (amount > 0),
  bank_ref           text,
  remarks            text,
  attachment_url     text,
  match_status       text NOT NULL DEFAULT 'NEW'
                       CHECK (match_status IN ('NEW','DUPLICATE','POSSIBLE','CONFLICT','ACCEPTED','REJECTED','LINKED')),
  matched_voucher_id uuid REFERENCES public.nf_vouchers(id),
  match_reason       text,
  posted_voucher_id  uuid REFERENCES public.nf_vouchers(id),
  version            integer NOT NULL DEFAULT 1,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_day_id, line_no)
);
-- a printed receipt / voucher number is never used twice on the same side
CREATE UNIQUE INDEX nf_site_lines_doc_unique ON public.nf_site_lines (company_id, side, upper(btrim(doc_no)))
  WHERE NULLIF(btrim(doc_no), '') IS NOT NULL;
CREATE INDEX nf_site_lines_day ON public.nf_site_lines (site_day_id);

ALTER TABLE public.nf_site_days         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nf_site_lines        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nf_combined_closings ENABLE ROW LEVEL SECURITY;
-- a new table arrives with full anon/authenticated grants: take them all back
REVOKE ALL ON public.nf_site_days, public.nf_site_lines, public.nf_combined_closings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nf_site_days, public.nf_site_lines, public.nf_combined_closings TO authenticated;

-- the policy helper (nf_role itself is not executable by signed-in users;
-- like nf_is_member, this only answers "may I read this company's site book")
CREATE OR REPLACE FUNCTION public.nf_site_reader(p_company_id uuid, p_with_site boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.nf_members m
     WHERE m.company_id = p_company_id AND m.user_id = auth.uid() AND m.active
       AND (m.role IN ('accountant','director','viewer') OR (p_with_site AND m.role = 'site')));
$function$;
REVOKE ALL ON FUNCTION public.nf_site_reader(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_site_reader(uuid, boolean) TO authenticated;

CREATE POLICY nf_site_days_read ON public.nf_site_days FOR SELECT TO authenticated
  USING (public.nf_site_reader(company_id, true));
CREATE POLICY nf_site_lines_read ON public.nf_site_lines FOR SELECT TO authenticated
  USING (public.nf_site_reader(company_id, true));
CREATE POLICY nf_combined_closings_read ON public.nf_combined_closings FOR SELECT TO authenticated
  USING (public.nf_site_reader(company_id, false));

CREATE TRIGGER nf_audit_row AFTER INSERT OR DELETE OR UPDATE ON public.nf_site_days
  FOR EACH ROW EXECUTE FUNCTION public.nf_audit_row();
CREATE TRIGGER nf_audit_row AFTER INSERT OR DELETE OR UPDATE ON public.nf_site_lines
  FOR EACH ROW EXECUTE FUNCTION public.nf_audit_row();
CREATE TRIGGER nf_audit_row AFTER INSERT OR DELETE OR UPDATE ON public.nf_combined_closings
  FOR EACH ROW EXECUTE FUNCTION public.nf_audit_row();

-- ── 3. the site cash book ────────────────────────────────────────────────
-- book closing of the site box at the end of p_date: the first day's typed
-- opening plus every counted site-cash line up to and including that date
CREATE OR REPLACE FUNCTION public._nf_site_book(p_company_id uuid, p_date date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((SELECT opening_cash FROM public.nf_site_days
                    WHERE company_id = p_company_id AND is_first_day AND business_date <= p_date), 0)
       + COALESCE((SELECT sum(CASE l.side WHEN 'IN' THEN l.amount ELSE -l.amount END)
                     FROM public.nf_site_lines l JOIN public.nf_site_days d ON d.id = l.site_day_id
                    WHERE d.company_id = p_company_id AND d.business_date <= p_date
                      AND l.via = 'SITE_CASH' AND l.match_status <> 'REJECTED'), 0);
$function$;

-- refuses any state where the site box would end a day below zero, on the
-- given date or any later site day (a change to one day moves every later
-- day's opening)
CREATE OR REPLACE FUNCTION public._nf_site_assert_not_negative(p_company_id uuid, p_from date)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;
BEGIN
  FOR r IN SELECT business_date FROM public.nf_site_days
            WHERE company_id = p_company_id AND business_date >= p_from ORDER BY business_date LOOP
    IF public._nf_site_book(p_company_id, r.business_date) < 0 THEN
      RAISE EXCEPTION 'NF:SITE_CASH_NEGATIVE'
        USING DETAIL = json_build_object('date', r.business_date,
                                         'would_be', public._nf_site_book(p_company_id, r.business_date))::text,
              HINT   = 'The site cash box cannot pay out more than it holds.';
    END IF;
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_day_json(p_site_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days; v_in numeric; v_out numeric; v_book numeric;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(amount) FILTER (WHERE side = 'IN'  AND via = 'SITE_CASH' AND match_status <> 'REJECTED'), 0),
         COALESCE(sum(amount) FILTER (WHERE side = 'OUT' AND via = 'SITE_CASH' AND match_status <> 'REJECTED'), 0)
    INTO v_in, v_out FROM public.nf_site_lines WHERE site_day_id = d.id;
  v_book := public._nf_site_book(d.company_id, d.business_date);
  RETURN to_jsonb(d) || jsonb_build_object(
    'opening', v_book - v_in + v_out,
    'cash_in', v_in, 'cash_out', v_out,
    'book_now', v_book,
    'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.side, l.line_no)
                         FROM public.nf_site_lines l WHERE l.site_day_id = d.id), '[]'::jsonb));
END
$function$;

-- ── 4. reading ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nf_site_get_day(p_company_id uuid, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['site','accountant','director','viewer']);
  SELECT id INTO v_id FROM public.nf_site_days WHERE company_id = p_company_id AND business_date = p_business_date;
  IF v_id IS NULL THEN
    -- no day yet: say what its opening would be, so the screen can show it
    RETURN jsonb_build_object('exists', false, 'business_date', p_business_date,
      'has_first_day', EXISTS (SELECT 1 FROM public.nf_site_days WHERE company_id = p_company_id AND is_first_day),
      'opening', public._nf_site_book(p_company_id, p_business_date));
  END IF;
  RETURN jsonb_build_object('exists', true) || public.nf_site_day_json(v_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_list_days(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['site','accountant','director','viewer']);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', d.id, 'business_date', d.business_date, 'status', d.status, 'version', d.version,
            'counted_cash', d.counted_cash, 'book_closing', d.book_closing, 'variance', d.variance,
            'returned_reason', d.returned_reason, 'submitted_at', d.submitted_at,
            'lines', (SELECT count(*) FROM public.nf_site_lines l WHERE l.site_day_id = d.id),
            'open_issues', (SELECT count(*) FROM public.nf_site_lines l WHERE l.site_day_id = d.id
                              AND l.match_status IN ('CONFLICT','POSSIBLE')))
          ORDER BY d.business_date DESC)
     FROM public.nf_site_days d
    WHERE d.company_id = p_company_id
      AND (p_from IS NULL OR d.business_date >= p_from) AND (p_to IS NULL OR d.business_date <= p_to)), '[]'::jsonb);
END
$function$;

-- the heads a site accountant may pick: the same list HO picks from (no cash or bank accounts)
CREATE OR REPLACE FUNCTION public.nf_site_list_heads(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['site','accountant','director','viewer']);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'requires_party', a.requires_party) ORDER BY a.code)
                     FROM public.nf_accounts a
                    WHERE a.company_id = p_company_id AND a.is_head AND a.active AND a.via IS NULL), '[]'::jsonb);
END
$function$;

-- the company's units, from RMS, for the unit picker
CREATE OR REPLACE FUNCTION public.nf_site_list_units(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['site','accountant','director','viewer']);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('unit', u.unit_no, 'floor', u.floor_label)
                                    ORDER BY u.floor_no, u.unit_no)
                     FROM public.units u JOIN public.projects p ON p.id = u.project_id
                    WHERE p.company_id = p_company_id), '[]'::jsonb);
END
$function$;

-- ── 5. writing ───────────────────────────────────────────────────────────
-- HO starts the site box once, with the cash it held that morning
CREATE OR REPLACE FUNCTION public.nf_site_start_first_day(p_company_id uuid, p_business_date date, p_opening_cash numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  IF p_business_date IS NULL THEN RAISE EXCEPTION 'NF:DATE_REQUIRED'; END IF;
  IF p_business_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'NF:SITE_FUTURE_DATE'; END IF;
  PERFORM public.nf_check_amount(p_opening_cash, 'opening_cash', true);
  IF p_opening_cash < 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('nf_site:' || p_company_id::text));
  IF EXISTS (SELECT 1 FROM public.nf_site_days WHERE company_id = p_company_id) THEN
    RAISE EXCEPTION 'NF:SITE_ALREADY_STARTED';
  END IF;
  INSERT INTO public.nf_site_days (company_id, business_date, is_first_day, opening_cash, created_by, updated_by)
  VALUES (p_company_id, p_business_date, true, p_opening_cash, auth.uid(), auth.uid())
  RETURNING id INTO v_id;
  RETURN public.nf_site_day_json(v_id);
END
$function$;

-- the day a line is saved on: found, or made (never before the first day, never in the future)
CREATE OR REPLACE FUNCTION public._nf_site_day_for(p_company_id uuid, p_business_date date)
 RETURNS public.nf_site_days
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days; v_first date;
BEGIN
  IF p_business_date IS NULL THEN RAISE EXCEPTION 'NF:DATE_REQUIRED'; END IF;
  IF p_business_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'NF:SITE_FUTURE_DATE'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('nf_site:' || p_company_id::text));
  SELECT * INTO d FROM public.nf_site_days
   WHERE company_id = p_company_id AND business_date = p_business_date FOR UPDATE;
  IF FOUND THEN RETURN d; END IF;
  SELECT business_date INTO v_first FROM public.nf_site_days WHERE company_id = p_company_id AND is_first_day;
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'NF:SITE_FIRST_DAY_REQUIRED' USING HINT = 'Head office has to set the opening cash of the site box first.';
  END IF;
  IF p_business_date < v_first THEN
    RAISE EXCEPTION 'NF:SITE_BEFORE_FIRST_DAY' USING DETAIL = json_build_object('first_day', v_first)::text;
  END IF;
  INSERT INTO public.nf_site_days (company_id, business_date, created_by, updated_by)
  VALUES (p_company_id, p_business_date, auth.uid(), auth.uid())
  RETURNING * INTO d;
  RETURN d;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_save_line(
  p_company_id uuid, p_business_date date, p_line_id uuid, p_side text, p_doc_no text,
  p_party_name text, p_unit_codes text, p_token_no integer, p_head_code text, p_via text,
  p_amount numeric, p_bank_ref text, p_remarks text, p_attachment_url text, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d public.nf_site_days;
  l public.nf_site_lines;
  v_head public.nf_accounts;
  v_id uuid;
BEGIN
  -- only the site accountant: the site record stays exactly as he entered it.
  -- HO returns the day with a reason, or corrects head/party on the HO
  -- voucher when it accepts the line (Stage 2).
  PERFORM public.nf_require_role(p_company_id, ARRAY['site']);
  IF p_side IS NULL OR p_side NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'NF:SIDE_REQUIRED'; END IF;
  IF p_via  IS NULL OR p_via  NOT IN ('SITE_CASH','BANK') THEN RAISE EXCEPTION 'NF:VIA_UNKNOWN' USING DETAIL = COALESCE(p_via, '(none)'); END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  SELECT * INTO v_head FROM public.nf_accounts
   WHERE company_id = p_company_id AND code = btrim(COALESCE(p_head_code, '')) AND is_head AND active AND via IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:HEAD_REQUIRED' USING DETAIL = COALESCE(p_head_code, '(none)'); END IF;
  IF v_head.code = '21100' AND p_token_no IS NULL THEN
    RAISE EXCEPTION 'NF:SITE_TOKEN_NO_REQUIRED' USING HINT = 'Token money needs the token number.';
  END IF;

  IF p_line_id IS NOT NULL THEN
    SELECT * INTO l FROM public.nf_site_lines WHERE id = p_line_id AND company_id = p_company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
    PERFORM public.nf_check_version(p_version, l.version);
    IF l.posted_voucher_id IS NOT NULL THEN RAISE EXCEPTION 'NF:SITE_LINE_POSTED'; END IF;
    SELECT * INTO d FROM public.nf_site_days WHERE id = l.site_day_id FOR UPDATE;
    IF d.business_date <> p_business_date THEN RAISE EXCEPTION 'NF:SITE_LINE_OTHER_DAY'; END IF;
  ELSE
    d := public._nf_site_day_for(p_company_id, p_business_date);
  END IF;
  IF d.status NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'NF:SITE_DAY_LOCKED' USING DETAIL = d.status; END IF;

  BEGIN
    IF p_line_id IS NULL THEN
      INSERT INTO public.nf_site_lines (company_id, site_day_id, line_no, side, doc_no, party_name, unit_codes,
                                        token_no, head_code, via, amount, bank_ref, remarks, attachment_url,
                                        created_by, updated_by)
      VALUES (p_company_id, d.id,
              (SELECT COALESCE(max(line_no), 0) + 1 FROM public.nf_site_lines WHERE site_day_id = d.id),
              p_side, NULLIF(btrim(p_doc_no), ''), NULLIF(btrim(p_party_name), ''), NULLIF(btrim(p_unit_codes), ''),
              p_token_no, v_head.code, p_via, p_amount, NULLIF(btrim(p_bank_ref), ''), NULLIF(btrim(p_remarks), ''),
              NULLIF(btrim(p_attachment_url), ''), auth.uid(), auth.uid())
      RETURNING id INTO v_id;
    ELSE
      -- a changed line is a new claim: whatever matching said about it is void
      UPDATE public.nf_site_lines
         SET side = p_side, doc_no = NULLIF(btrim(p_doc_no), ''), party_name = NULLIF(btrim(p_party_name), ''),
             unit_codes = NULLIF(btrim(p_unit_codes), ''), token_no = p_token_no, head_code = v_head.code,
             via = p_via, amount = p_amount, bank_ref = NULLIF(btrim(p_bank_ref), ''),
             remarks = NULLIF(btrim(p_remarks), ''), attachment_url = NULLIF(btrim(p_attachment_url), ''),
             match_status = 'NEW', matched_voucher_id = NULL, match_reason = NULL,
             version = version + 1, updated_by = auth.uid(), updated_at = now()
       WHERE id = l.id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'NF:DUPLICATE_DOC_NO' USING DETAIL = json_build_object('doc_no', btrim(p_doc_no), 'side', p_side)::text;
  END;

  -- the day's version moves with its lines, so a screen that has not seen a
  -- line cannot submit the day
  UPDATE public.nf_site_days SET version = version + 1, updated_by = auth.uid(), updated_at = now() WHERE id = d.id;
  PERFORM public._nf_site_assert_not_negative(p_company_id, d.business_date);
  RETURN public.nf_site_day_json(d.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_delete_line(p_line_id uuid, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.nf_site_lines; d public.nf_site_days;
BEGIN
  SELECT * INTO l FROM public.nf_site_lines WHERE id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(l.company_id, ARRAY['site']);
  SELECT * INTO d FROM public.nf_site_days WHERE id = l.site_day_id FOR UPDATE;
  SELECT * INTO l FROM public.nf_site_lines WHERE id = p_line_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, l.version);
  IF d.status NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'NF:SITE_DAY_LOCKED' USING DETAIL = d.status; END IF;
  IF l.posted_voucher_id IS NOT NULL THEN RAISE EXCEPTION 'NF:SITE_LINE_POSTED'; END IF;
  DELETE FROM public.nf_site_lines WHERE id = l.id;
  UPDATE public.nf_site_days SET version = version + 1, updated_by = auth.uid(), updated_at = now() WHERE id = d.id;
  PERFORM public._nf_site_assert_not_negative(l.company_id, d.business_date);
  RETURN public.nf_site_day_json(d.id);
END
$function$;

-- the site accountant counts the box and hands the day to HO
CREATE OR REPLACE FUNCTION public.nf_site_submit(p_site_day_id uuid, p_counted_cash numeric, p_denominations jsonb,
                                                 p_variance_reason text, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days; v_prev public.nf_site_days; v_counted numeric; v_book numeric;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(d.company_id, ARRAY['site']);
  PERFORM pg_advisory_xact_lock(hashtext('nf_site:' || d.company_id::text));
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  IF d.status NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'NF:SITE_DAY_LOCKED' USING DETAIL = d.status; END IF;

  SELECT * INTO v_prev FROM public.nf_site_days
   WHERE company_id = d.company_id AND business_date < d.business_date ORDER BY business_date DESC LIMIT 1;
  IF FOUND AND v_prev.status NOT IN ('SUBMITTED','MERGED') THEN
    RAISE EXCEPTION 'NF:SITE_PREVIOUS_DAY_OPEN' USING DETAIL = json_build_object('date', v_prev.business_date, 'status', v_prev.status)::text;
  END IF;

  IF p_denominations IS NOT NULL THEN
    v_counted := public.nf_count_total(p_denominations);
    IF p_counted_cash IS NOT NULL AND p_counted_cash <> v_counted THEN
      RAISE EXCEPTION 'NF:BAD_COUNT' USING DETAIL = json_build_object('typed', p_counted_cash, 'notes_add_up_to', v_counted)::text;
    END IF;
  ELSE
    v_counted := p_counted_cash;
  END IF;
  IF v_counted IS NULL THEN RAISE EXCEPTION 'NF:SITE_COUNT_REQUIRED' USING HINT = 'Count the cash in the box before submitting.'; END IF;
  PERFORM public.nf_check_amount(v_counted, 'counted_cash', true);

  v_book := public._nf_site_book(d.company_id, d.business_date);
  IF v_counted <> v_book AND NULLIF(btrim(p_variance_reason), '') IS NULL THEN
    RAISE EXCEPTION 'NF:VARIANCE_REASON_REQUIRED'
      USING DETAIL = json_build_object('book', v_book, 'counted', v_counted, 'variance', v_counted - v_book)::text;
  END IF;

  UPDATE public.nf_site_days
     SET status = 'SUBMITTED', counted_cash = v_counted, denominations = p_denominations,
         book_closing = v_book, variance = v_counted - v_book,
         variance_reason = CASE WHEN v_counted <> v_book THEN btrim(p_variance_reason) END,
         submitted_by = auth.uid(), submitted_at = now(),
         version = version + 1, updated_by = auth.uid(), updated_at = now()
   WHERE id = d.id;
  RETURN public.nf_site_day_json(d.id);
END
$function$;

-- HO sends a submitted day back, with the reason the site accountant will read
CREATE OR REPLACE FUNCTION public.nf_site_return(p_site_day_id uuid, p_reason text, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(d.company_id, ARRAY['accountant','director']);
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'NF:REASON_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('nf_site:' || d.company_id::text));
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  IF d.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'NF:SITE_NOT_SUBMITTED' USING DETAIL = d.status; END IF;
  IF EXISTS (SELECT 1 FROM public.nf_site_days WHERE company_id = d.company_id
              AND business_date > d.business_date AND status = 'MERGED') THEN
    RAISE EXCEPTION 'NF:SITE_LATER_DAY_MERGED';
  END IF;
  UPDATE public.nf_site_days
     SET status = 'RETURNED', returned_reason = btrim(p_reason), returned_by = auth.uid(), returned_at = now(),
         version = version + 1, updated_by = auth.uid(), updated_at = now()
   WHERE id = d.id;
  -- a later submitted day opens from this one's closing, which may now change
  UPDATE public.nf_site_days
     SET status = 'RETURNED', returned_reason = 'Returned with ' || to_char(d.business_date, 'DD-Mon') || ': ' || btrim(p_reason),
         returned_by = auth.uid(), returned_at = now(),
         version = version + 1, updated_by = auth.uid(), updated_at = now()
   WHERE company_id = d.company_id AND business_date > d.business_date AND status = 'SUBMITTED';
  RETURN public.nf_site_day_json(d.id);
END
$function$;

-- SUBMITTED -> DRAFT (withdrawn before review, by the site accountant only);
-- MERGED -> RETURNED (director only, with a reason, while its combined closing is not CLOSED)
CREATE OR REPLACE FUNCTION public.nf_site_reopen(p_site_day_id uuid, p_reason text, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days; v_cc text;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(d.company_id, ARRAY['site','director']);
  PERFORM pg_advisory_xact_lock(hashtext('nf_site:' || d.company_id::text));
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);

  IF d.status = 'SUBMITTED' THEN
    -- withdrawing his own submission is the site accountant's act; HO returns instead
    PERFORM public.nf_require_role(d.company_id, ARRAY['site']);
    IF EXISTS (SELECT 1 FROM public.nf_site_days WHERE company_id = d.company_id
                AND business_date > d.business_date AND status IN ('SUBMITTED','MERGED')) THEN
      RAISE EXCEPTION 'NF:SITE_LATER_DAY_SUBMITTED' USING HINT = 'Reopen the latest submitted day first.';
    END IF;
    UPDATE public.nf_site_days
       SET status = 'DRAFT', reopen_reason = NULLIF(btrim(p_reason), ''),
           version = version + 1, updated_by = auth.uid(), updated_at = now()
     WHERE id = d.id;
  ELSIF d.status = 'MERGED' THEN
    PERFORM public.nf_require_role(d.company_id, ARRAY['director']);
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'NF:REASON_REQUIRED'; END IF;
    SELECT status INTO v_cc FROM public.nf_combined_closings WHERE id = d.combined_closing_id;
    IF v_cc = 'CLOSED' THEN RAISE EXCEPTION 'NF:SITE_COMBINED_CLOSED'; END IF;
    IF EXISTS (SELECT 1 FROM public.nf_site_days WHERE company_id = d.company_id
                AND business_date > d.business_date AND status = 'MERGED') THEN
      RAISE EXCEPTION 'NF:SITE_LATER_DAY_MERGED';
    END IF;
    UPDATE public.nf_site_days
       SET status = 'RETURNED', reopen_reason = btrim(p_reason), returned_reason = btrim(p_reason),
           merged_by = NULL, merged_at = NULL,
           version = version + 1, updated_by = auth.uid(), updated_at = now()
     WHERE id = d.id;
  ELSE
    RAISE EXCEPTION 'NF:SITE_NOTHING_TO_REOPEN' USING DETAIL = d.status;
  END IF;
  RETURN public.nf_site_day_json(d.id);
END
$function$;

-- ── 6. the real business date on a voucher ──────────────────────────────
-- HO's vouchers all sit on one long-running day, so voucher_date is that
-- day's date, not when the money moved. Every voucher made by the new paths
-- carries the real date here; older vouchers stay NULL and are read from
-- their narration (matching, combined closing).
ALTER TABLE public.nf_vouchers ADD COLUMN IF NOT EXISTS real_date date;
CREATE INDEX IF NOT EXISTS nf_vouchers_real_date ON public.nf_vouchers (company_id, real_date) WHERE real_date IS NOT NULL;

-- ── 7. withdrawals: Bank -> Cash, Bank -> site cash box ─────────────────
-- The day-line path for the shape BPV-0041/BPV-0046 had to be posted
-- without. Goes through nf_post_voucher, so the day lock, the date rule,
-- the balance check, the never-negative check and the audit all apply.
CREATE OR REPLACE FUNCTION public.nf_save_withdrawal(p_day_id uuid, p_voucher_no text, p_from text, p_to text,
                                                     p_amount numeric, p_cheque_no text, p_description text,
                                                     p_real_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid := public.nf_day_company(p_day_id);
  v_manual  text := upper(btrim(COALESCE(p_voucher_no, '')));
  v_cheque  text := regexp_replace(COALESCE(p_cheque_no, ''), '[^0-9]', '', 'g');
  v_bank text; v_to text; v_floor text; v_bdate date; v_sort integer; v_system text; v_id uuid;
  v_narr text; v_used public.nf_vouchers;
BEGIN
  PERFORM public.nf_require_role(v_company, ARRAY['accountant','director']);
  IF p_from IS DISTINCT FROM 'Bank' THEN RAISE EXCEPTION 'NF:WITHDRAWAL_FROM_BANK_ONLY' USING DETAIL = COALESCE(p_from, '(none)'); END IF;
  IF p_to IS NULL OR p_to NOT IN ('Cash','Petty') THEN RAISE EXCEPTION 'NF:WITHDRAWAL_TO_CASH_OR_PETTY' USING DETAIL = COALESCE(p_to, '(none)'); END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  IF length(v_cheque) < 4 THEN RAISE EXCEPTION 'NF:CHEQUE_REQUIRED'; END IF;
  -- the day the cheque was really cashed, not the open day's date
  IF p_real_date IS NULL THEN RAISE EXCEPTION 'NF:REAL_DATE_REQUIRED'; END IF;
  IF p_real_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'NF:REAL_DATE_FUTURE'; END IF;
  IF v_manual = '' OR v_manual ~ '^BPV-?$' THEN v_manual := NULL; END IF;

  SELECT code INTO v_bank FROM public.nf_accounts WHERE company_id = v_company AND via = 'Bank';
  SELECT code INTO v_to   FROM public.nf_accounts WHERE company_id = v_company AND via = p_to;
  IF v_bank IS NULL OR v_to IS NULL THEN RAISE EXCEPTION 'NF:VIA_NOT_CONFIGURED'; END IF;

  -- a cheque is cashed once: refuse a second withdrawal on the same cheque
  SELECT v.* INTO v_used FROM public.nf_vouchers v
   WHERE v.company_id = v_company
     AND regexp_replace(COALESCE(v.narration, ''), '[^0-9#]', '', 'g') ~ ('#' || v_cheque || '($|[^0-9])')
     AND EXISTS (SELECT 1 FROM public.nf_voucher_legs a WHERE a.voucher_id = v.id AND a.account_code = v_bank AND a.credit > 0)
     AND EXISTS (SELECT 1 FROM public.nf_voucher_legs b JOIN public.nf_accounts x
                   ON x.company_id = b.company_id AND x.code = b.account_code
                  WHERE b.voucher_id = v.id AND b.debit > 0 AND x.via IN ('Cash','Petty'))
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'NF:DUPLICATE_CHEQUE'
      USING DETAIL = json_build_object('cheque', v_cheque, 'voucher', COALESCE(v_used.manual_no, v_used.voucher_no))::text;
  END IF;

  IF v_manual IS NOT NULL AND EXISTS (SELECT 1 FROM public.nf_vouchers x
       WHERE x.company_id = v_company AND x.manual_no = v_manual AND upper(split_part(x.voucher_no, '-', 1)) = 'BPV') THEN
    RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
  END IF;

  v_narr := COALESCE(NULLIF(btrim(p_description), ''),
                     CASE p_to WHEN 'Cash' THEN 'Cash withdrawn from bank into cash in hand'
                               ELSE 'Cash withdrawn from bank into the site cash box' END);
  IF position(v_cheque IN regexp_replace(v_narr, '[^0-9]', '', 'g')) = 0 THEN
    v_narr := v_narr || ' — BOP chq #' || v_cheque;
  END IF;

  SELECT business_date INTO v_bdate FROM public.nf_days WHERE id = p_day_id;
  SELECT code INTO v_floor FROM public.nf_floors WHERE company_id = v_company ORDER BY sort LIMIT 1;
  SELECT COALESCE(max(sort), 0) + 1 INTO v_sort FROM public.nf_vouchers WHERE day_id = p_day_id;
  v_system := public.nf__next_voucher_no(v_company, 'BPV');
  v_id := public.nf_post_voucher(v_company, p_day_id, v_system, v_bdate, v_narr, v_sort,
    jsonb_build_array(
      jsonb_build_object('account_code', v_to,   'floor_code', v_floor, 'debit',  p_amount),
      jsonb_build_object('account_code', v_bank, 'floor_code', v_floor, 'credit', p_amount)));
  BEGIN
    UPDATE public.nf_vouchers SET manual_no = v_manual, real_date = p_real_date WHERE id = v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'NF:DUPLICATE_VOUCHER' USING DETAIL = json_build_object('voucher', v_manual)::text;
  END;
  RETURN public.nf_day_json(p_day_id);
END
$function$;

-- ── 8. grants: every function to signed-in users only (each checks its role inside) ──
REVOKE ALL ON FUNCTION public._nf_site_book(uuid, date)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._nf_site_assert_not_negative(uuid, date)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._nf_site_day_for(uuid, date)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nf_site_day_json(uuid)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nf_site_get_day(uuid, date)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_site_list_days(uuid, date, date)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_site_list_heads(uuid)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_site_list_units(uuid)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_site_start_first_day(uuid, date, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_site_save_line(uuid, date, uuid, text, text, text, text, integer, text, text, numeric, text, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_site_delete_line(uuid, integer)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_site_submit(uuid, numeric, jsonb, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_site_return(uuid, text, integer)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_site_reopen(uuid, text, integer)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_save_withdrawal(uuid, text, text, text, numeric, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_site_get_day(uuid, date)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_list_days(uuid, date, date)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_list_heads(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_list_units(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_start_first_day(uuid, date, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_save_line(uuid, date, uuid, text, text, text, text, integer, text, text, numeric, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_delete_line(uuid, integer)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_submit(uuid, numeric, jsonb, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_return(uuid, text, integer)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_reopen(uuid, text, integer)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_save_withdrawal(uuid, text, text, text, numeric, text, text, date) TO authenticated;
