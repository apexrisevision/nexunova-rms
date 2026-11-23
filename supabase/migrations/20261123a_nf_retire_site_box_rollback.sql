-- ══ ROLLBACK of 20261123a_nf_retire_site_box — puts the site cash box back as it was on 23-Nov-2026 ══
-- Generated from the live definitions (scripts/nf/gen-20261123a-retire-site-box.js). Run only on the owner's word.

ALTER TABLE public.nf_members DROP CONSTRAINT nf_members_role_check;
ALTER TABLE public.nf_members ADD CONSTRAINT nf_members_role_check CHECK (role IN ('accountant', 'director', 'viewer', 'site'));

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

ALTER TABLE public.nf_site_lines
  ADD COLUMN IF NOT EXISTS proposal     jsonb,
  ADD COLUMN IF NOT EXISTS ho_head_code text,
  ADD COLUMN IF NOT EXISTS matched_at   timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by  uuid,
  ADD COLUMN IF NOT EXISTS resolved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS resolution   text;

DROP INDEX IF EXISTS public.nf_site_lines_doc_unique;
CREATE INDEX IF NOT EXISTS nf_site_lines_doc ON public.nf_site_lines (company_id, side, upper(btrim(doc_no)))
  WHERE NULLIF(btrim(doc_no), '') IS NOT NULL;

-- HO's side of a match is read through nf_site_review only
REVOKE SELECT ON public.nf_site_lines FROM authenticated;
GRANT SELECT (id, company_id, site_day_id, line_no, side, doc_no, party_name, unit_codes, token_no, head_code,
              via, amount, bank_ref, remarks, attachment_url, match_status, version,
              created_by, created_at, updated_by, updated_at, resolved_at)
  ON public.nf_site_lines TO authenticated;

-- functions, exactly as they were live
CREATE OR REPLACE FUNCTION public._nf_ho_open_day(p_company_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM public.nf_days WHERE company_id = p_company_id AND status = 'OPEN'
   ORDER BY business_date DESC LIMIT 1;
  IF v IS NULL THEN RAISE EXCEPTION 'NF:NO_OPEN_DAY' USING HINT = 'Open a day at head office first.'; END IF;
  RETURN v;
END
$function$;

CREATE OR REPLACE FUNCTION public._nf_ho_voucher_edit(p_voucher_id uuid, p_via text, p_head text, p_party text, p_real_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v public.nf_vouchers; h public.nf_voucher_legs; w public.nf_voucher_legs; a public.nf_accounts; v_party text;
BEGIN
  SELECT * INTO v FROM public.nf_vouchers WHERE id = p_voucher_id;
  SELECT * INTO h FROM public.nf_voucher_legs WHERE voucher_id = v.id AND line_no = 1;
  SELECT * INTO w FROM public.nf_voucher_legs WHERE voucher_id = v.id AND line_no = 2;
  SELECT * INTO a FROM public.nf_accounts WHERE company_id = v.company_id AND code = w.account_code;
  IF v.day_id IS NULL OR a.via IS NULL
     OR (SELECT count(*) FROM public.nf_voucher_legs WHERE voucher_id = v.id) <> 2 THEN
    RAISE EXCEPTION 'NF:HO_VOUCHER_NOT_A_DAY_LINE' USING DETAIL = COALESCE(v.manual_no, v.voucher_no);
  END IF;
  SELECT name INTO v_party FROM public.nf_parties WHERE id = h.party_id;
  PERFORM public.nf_save_line(v.day_id, h.id, CASE WHEN h.credit > 0 THEN 'IN' ELSE 'OUT' END,
    v.manual_no, v.narration, COALESCE(NULLIF(btrim(p_head), ''), h.account_code), h.floor_code,
    COALESCE(p_via, a.via), h.debit + h.credit, v.version, COALESCE(NULLIF(btrim(p_party), ''), v_party));
  IF p_real_date IS NOT NULL THEN
    UPDATE public.nf_vouchers SET real_date = p_real_date WHERE id = v.id AND real_date IS NULL;
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public._nf_site_accept_one(l nf_site_lines, p_head_code text, p_party_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d public.nf_site_days; v_day uuid; v_act text := COALESCE(l.proposal->>'action', '');
  v_type text; v_manual text; v_n int; v_narr text; v_head text; v_party text; v_floor text; v_vid uuid;
  v_units text; v_req boolean; v_pfx text[] := ARRAY['CRV','CPV','BRV','BPV','JV','XFR'];
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = l.site_day_id;

  IF l.match_status = 'NEW' AND v_act = 'post' THEN
    v_day  := public._nf_ho_open_day(l.company_id);
    v_type := CASE l.side WHEN 'IN' THEN 'CRV' ELSE 'CPV' END;
    -- the paper number; a voucher of several lines gets /1, /2; none: SITE-YYYYMMDD-n
    IF NULLIF(btrim(l.doc_no), '') IS NOT NULL THEN
      SELECT count(*) INTO v_n FROM public.nf_site_lines
       WHERE site_day_id = l.site_day_id AND side = l.side AND upper(btrim(doc_no)) = upper(btrim(l.doc_no));
      v_manual := upper(btrim(l.doc_no)) || CASE WHEN v_n > 1 THEN '/' || (SELECT count(*) FROM public.nf_site_lines
                     WHERE site_day_id = l.site_day_id AND side = l.side AND upper(btrim(doc_no)) = upper(btrim(l.doc_no))
                       AND line_no <= l.line_no) ELSE '' END;
    ELSE
      SELECT count(*) + 1 INTO v_n FROM public.nf_vouchers
       WHERE company_id = l.company_id AND manual_no LIKE 'SITE-' || to_char(d.business_date, 'YYYYMMDD') || '-%';
      v_manual := 'SITE-' || to_char(d.business_date, 'YYYYMMDD') || '-' || v_n;
    END IF;
    v_head := COALESCE(NULLIF(btrim(p_head_code), ''), l.head_code);
    SELECT requires_party INTO v_req FROM public.nf_accounts WHERE company_id = l.company_id AND code = v_head;
    v_party := COALESCE(NULLIF(btrim(p_party_name), ''), CASE WHEN v_req THEN l.party_name END);
    -- "FF-120,121,196" -> "FF 120, FF 121 and FF 196", the form the token ledger reads
    SELECT string_agg(f || ' ' || n, ', ') INTO v_units FROM (
      SELECT COALESCE(NULLIF(upper(substring(p FROM '^([A-Za-z0-9]{1,3}?F|LG|GF|CB)[- ]')), ''),
                      first_value(NULLIF(upper(substring(p FROM '^([A-Za-z0-9]{1,3}?F|LG|GF|CB)[- ]')), '')) OVER (ORDER BY o)) AS f,
             substring(p FROM '([0-9]+[A-Za-z]?)$') AS n, o
        FROM regexp_split_to_table(COALESCE(l.unit_codes, ''), '\s*,\s*') WITH ORDINALITY AS t(p, o)
       WHERE btrim(p) <> '') u;
    -- "and" before the last one: the form the token ledger parses
    v_units := regexp_replace(v_units, ', ([^,]+)$', ' and \1');
    v_floor := COALESCE((SELECT code FROM public.nf_floors WHERE company_id = l.company_id
                           AND code = upper(substring(COALESCE(l.unit_codes, '') FROM '^([A-Za-z0-9]{1,3}?F|LG|GF|CB)'))),
                        (SELECT code FROM public.nf_floors WHERE company_id = l.company_id ORDER BY (code = 'P-W') DESC, sort LIMIT 1));
    v_narr := CASE WHEN v_head = '21100' AND l.side = 'IN'
                     THEN format('Token #%s — %s%s (site receipt%s, %s)', l.token_no, COALESCE(l.party_name, 'name not given'),
                                 CASE WHEN v_units IS NOT NULL THEN ', Unit' || CASE WHEN position(',' IN v_units) > 0 THEN 's ' ELSE ' ' END || v_units ELSE '' END,
                                 COALESCE(' ' || l.doc_no, ''), to_char(d.business_date, 'DD-Mon'))
                   WHEN v_head = '21100'
                     THEN format('Token #%s returned — %s%s (site voucher%s, %s)', l.token_no, COALESCE(l.party_name, 'name not given'),
                                 CASE WHEN v_units IS NOT NULL THEN ', Unit ' || v_units ELSE '' END,
                                 COALESCE(' ' || l.doc_no, ''), to_char(d.business_date, 'DD-Mon'))
                   ELSE concat_ws(' — ', NULLIF(l.party_name, ''), NULLIF(l.remarks, '')) ||
                        format(' (site cash%s, %s)', COALESCE(', ' || l.doc_no, ''), to_char(d.business_date, 'DD-Mon')) END;
    PERFORM public.nf_save_line(v_day, NULL, l.side, v_manual, ltrim(v_narr, ' '), v_head, v_floor, 'Petty', l.amount, NULL, v_party);
    SELECT id INTO v_vid FROM public.nf_vouchers
     WHERE company_id = l.company_id AND manual_no = upper(v_manual) AND split_part(voucher_no, '-', 1) = v_type;
    UPDATE public.nf_vouchers SET real_date = d.business_date WHERE id = v_vid;
    UPDATE public.nf_site_lines
       SET match_status = 'ACCEPTED', posted_voucher_id = v_vid, resolved_by = auth.uid(), resolved_at = now(),
           resolution = 'Posted from the site cash box' || CASE WHEN v_head <> l.head_code THEN ' under HO head ' || v_head ELSE '' END
     WHERE id = l.id;

  ELSIF l.match_status = 'DUPLICATE' AND v_act IN ('reroute','transfer','link','pass_through') THEN
    IF v_act = 'reroute' THEN
      -- HO's voucher moves from HO cash to the site box: the guarded edit path
      PERFORM public._nf_ho_voucher_edit(l.matched_voucher_id, 'Petty', p_head_code, p_party_name, d.business_date);
    ELSIF v_act = 'transfer' THEN
      PERFORM public.nf_save_transfer(public._nf_ho_open_day(l.company_id), l.proposal->>'from', l.proposal->>'to',
        (l.proposal->>'amount')::numeric, d.business_date,
        format('Site cash: %s on cheque %s went %s the site box (HO voucher %s)', public.nf_fmt(l.amount),
               COALESCE(l.bank_ref, '-'), CASE l.proposal->>'to' WHEN 'Petty' THEN 'into' ELSE 'out of' END,
               (SELECT COALESCE(manual_no, voucher_no) FROM public.nf_vouchers WHERE id = l.matched_voucher_id)));
    ELSIF NULLIF(btrim(p_head_code), '') IS NOT NULL OR NULLIF(btrim(p_party_name), '') IS NOT NULL THEN
      PERFORM public._nf_ho_voucher_edit(l.matched_voucher_id, NULL, p_head_code, p_party_name, NULL);
    END IF;
    UPDATE public.nf_site_lines
       SET match_status = 'LINKED', resolved_by = auth.uid(), resolved_at = now(),
           resolution = CASE v_act WHEN 'reroute' THEN 'HO voucher moved to the site cash box'
                                   WHEN 'transfer' THEN 'Cash moved between HO cash and the site box'
                                   WHEN 'pass_through' THEN 'Same money as the HO bank payment; nothing posted'
                                   ELSE 'Same as the HO voucher; nothing posted' END
     WHERE id = l.id;

  ELSIF l.match_status = 'LINKED' THEN
    -- a bank line matched automatically: HO confirms it
    UPDATE public.nf_site_lines SET resolved_by = auth.uid(), resolved_at = now(),
           resolution = 'Confirmed: HO''s bank entry' WHERE id = l.id;
  ELSE
    RAISE EXCEPTION 'NF:SITE_LINE_NOT_ACCEPTABLE'
      USING DETAIL = l.match_status, HINT = 'A possible or conflicting line is settled with Mark duplicate, Link or Reject.';
  END IF;
END
$function$;

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

CREATE OR REPLACE FUNCTION public._nf_site_cheque(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN COALESCE(p, '') ~* '^\s*(chq\.?|cheque)?\s*(no\.?)?\s*#?\s*[0-9]{4,}\s*$'
              THEN regexp_replace(p, '[^0-9]', '', 'g') END;
$function$;

CREATE OR REPLACE FUNCTION public._nf_site_day_for(p_company_id uuid, p_business_date date)
 RETURNS nf_site_days
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

CREATE OR REPLACE FUNCTION public._nf_site_line_for_ho(p_line_id uuid, p_version integer)
 RETURNS nf_site_lines
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.nf_site_lines; d public.nf_site_days;
BEGIN
  SELECT * INTO l FROM public.nf_site_lines WHERE id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(l.company_id, ARRAY['accountant','director']);
  SELECT * INTO d FROM public.nf_site_days WHERE id = l.site_day_id FOR UPDATE;
  SELECT * INTO l FROM public.nf_site_lines WHERE id = p_line_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, l.version);
  IF d.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'NF:SITE_NOT_SUBMITTED' USING DETAIL = d.status; END IF;
  IF l.resolved_by IS NOT NULL OR l.posted_voucher_id IS NOT NULL THEN RAISE EXCEPTION 'NF:SITE_LINE_RESOLVED'; END IF;
  RETURN l;
END
$function$;

CREATE OR REPLACE FUNCTION public._nf_site_match(p_site_day_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d public.nf_site_days;
  l record; best record;
  c_cash text; c_petty text; c_bank text;
  v_kind text; v_chq text; v_ref text; v_status text; v_reason text; v_prop jsonb; v_hohead text;
  v_ties int; v_amt_fmt text;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  SELECT code INTO c_cash  FROM public.nf_accounts WHERE company_id = d.company_id AND via = 'Cash';
  SELECT code INTO c_petty FROM public.nf_accounts WHERE company_id = d.company_id AND via = 'Petty';
  SELECT code INTO c_bank  FROM public.nf_accounts WHERE company_id = d.company_id AND via = 'Bank';

  -- HO's day vouchers around this date, each read once
  DROP TABLE IF EXISTS _hv;
  CREATE TEMP TABLE _hv ON COMMIT DROP AS
  WITH v0 AS (
    SELECT v.id, v.manual_no, v.voucher_no, v.narration,
           public._nf_voucher_real_date(v.narration, v.real_date, v.created_at) AS rd
      FROM public.nf_vouchers v
     WHERE v.company_id = d.company_id AND v.status = 'POSTED' AND v.source = 'DAY'
       AND NOT EXISTS (SELECT 1 FROM public.nf_site_lines s WHERE s.posted_voucher_id = v.id))
  SELECT v0.*,
         COALESCE(sum(g.debit), 0) AS amt,
         COALESCE(sum(g.debit)  FILTER (WHERE g.account_code = c_cash),  0) AS cash_dr,
         COALESCE(sum(g.credit) FILTER (WHERE g.account_code = c_cash),  0) AS cash_cr,
         COALESCE(sum(g.debit)  FILTER (WHERE g.account_code = c_petty), 0) AS petty_dr,
         COALESCE(sum(g.credit) FILTER (WHERE g.account_code = c_petty), 0) AS petty_cr,
         COALESCE(sum(g.debit)  FILTER (WHERE g.account_code = c_bank),  0) AS bank_dr,
         COALESCE(sum(g.credit) FILTER (WHERE g.account_code = c_bank),  0) AS bank_cr,
         (array_agg(g.account_code ORDER BY g.line_no) FILTER (WHERE a.via IS NULL))[1] AS head,
         count(*) FILTER (WHERE a.via IS NULL) AS nonvia,
         bool_or(g.account_code = '21100') AS has_token,
         public._nf_cheques(v0.narration) AS cheques,
         public._nf_receipt_nos(v0.narration) AS tokens,
         public._nf_letters(v0.narration) AS letters,
         upper(regexp_replace(COALESCE(v0.narration, ''), '[^A-Za-z0-9]', '', 'g')) AS alnum,
         public._nf_words(v0.narration) AS words
    FROM v0
    JOIN public.nf_voucher_legs g ON g.voucher_id = v0.id
    JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
   WHERE v0.rd BETWEEN d.business_date - 3 AND d.business_date + 3
   GROUP BY v0.id, v0.manual_no, v0.voucher_no, v0.narration, v0.rd;
  ALTER TABLE _hv ADD COLUMN kind text;
  UPDATE _hv SET kind = CASE WHEN nonvia = 0 THEN 'XFER'
                             WHEN cash_dr + petty_dr + bank_dr > 0 THEN 'IN'
                             WHEN cash_cr + petty_cr + bank_cr > 0 THEN 'OUT'
                             ELSE 'OTHER' END
   WHERE true;   -- 20261118c: PostgREST's safe-update guard refuses an UPDATE with no WHERE, even inside a function

  -- the cheques the site drew into its own box that day: an HO payment that names one
  -- was paid out of the site's cash
  DROP TABLE IF EXISTS _drawn;
  CREATE TEMP TABLE _drawn ON COMMIT DROP AS
  SELECT public._nf_site_cheque(bank_ref) AS chq FROM public.nf_site_lines
   WHERE site_day_id = d.id AND via = 'SITE_CASH' AND side = 'IN' AND head_code = c_bank
     AND public._nf_site_cheque(bank_ref) IS NOT NULL;

  DROP TABLE IF EXISTS _res;
  CREATE TEMP TABLE _res (line_id uuid, status text, voucher_id uuid, reason text, proposal jsonb, ho_head text,
                          nature_of uuid) ON COMMIT DROP;

  FOR l IN SELECT * FROM public.nf_site_lines
            WHERE site_day_id = d.id AND resolved_by IS NULL AND posted_voucher_id IS NULL
            ORDER BY line_no LOOP
    v_kind := CASE WHEN l.via = 'SITE_CASH' AND l.head_code = c_bank THEN CASE l.side WHEN 'IN' THEN 'WDL' ELSE 'DEP' END
                   WHEN l.via = 'SITE_CASH' THEN 'CASH_' || l.side
                   ELSE 'BANK_' || l.side END;
    v_chq := public._nf_site_cheque(l.bank_ref);
    v_ref := CASE WHEN length(regexp_replace(COALESCE(l.bank_ref, ''), '[^A-Za-z0-9]', '', 'g')) >= 6
                  THEN upper(regexp_replace(l.bank_ref, '[^A-Za-z0-9]', '', 'g')) END;
    v_amt_fmt := public.nf_fmt(l.amount);
    v_status := NULL; v_reason := NULL; v_prop := NULL; v_hohead := NULL; best := NULL;

    -- ── rule 1: a strong key ──
    SELECT h.*,
           (h.amt = l.amount AND CASE v_kind
              WHEN 'WDL'      THEN h.kind = 'XFER' AND h.bank_cr > 0 AND h.cash_dr + h.petty_dr > 0
              WHEN 'DEP'      THEN h.kind = 'XFER' AND h.bank_dr > 0 AND h.cash_cr + h.petty_cr > 0
              WHEN 'CASH_IN'  THEN h.kind = 'IN'  AND h.bank_dr = 0
              WHEN 'CASH_OUT' THEN h.kind = 'OUT' AND h.bank_cr = 0
              WHEN 'BANK_IN'  THEN h.kind = 'IN'  AND h.bank_dr > 0
              WHEN 'BANK_OUT' THEN h.kind = 'OUT' AND h.bank_cr > 0 END) AS agrees,
           (CASE WHEN public._nf_cheque_hit(v_chq, h.cheques) THEN 'cheque ' || v_chq
                 WHEN v_ref IS NOT NULL AND position(v_ref IN h.alnum) > 0 THEN 'ref ' || l.bank_ref
                 WHEN l.token_no IS NOT NULL AND l.head_code = '21100' AND h.has_token AND l.token_no = ANY (h.tokens)
                      THEN 'token #' || l.token_no
                 ELSE 'voucher no ' || l.doc_no END) AS key,
           0 AS score, false AS by_party, false AS by_funding, false AS by_words, true AS fits
      INTO best
      FROM _hv h
     WHERE abs(h.rd - d.business_date) <= 3
       AND (public._nf_cheque_hit(v_chq, h.cheques)
            OR (v_ref IS NOT NULL AND position(v_ref IN h.alnum) > 0)
            OR (l.token_no IS NOT NULL AND l.head_code = '21100' AND h.has_token AND l.token_no = ANY (h.tokens))
            OR (NULLIF(btrim(l.doc_no), '') IS NOT NULL AND upper(btrim(l.doc_no)) = upper(btrim(COALESCE(h.manual_no, '')))))
     ORDER BY (h.amt = l.amount AND CASE v_kind
              WHEN 'WDL'      THEN h.kind = 'XFER' AND h.bank_cr > 0 AND h.cash_dr + h.petty_dr > 0
              WHEN 'DEP'      THEN h.kind = 'XFER' AND h.bank_dr > 0 AND h.cash_cr + h.petty_cr > 0
              WHEN 'CASH_IN'  THEN h.kind = 'IN'  AND h.bank_dr = 0
              WHEN 'CASH_OUT' THEN h.kind = 'OUT' AND h.bank_cr = 0
              WHEN 'BANK_IN'  THEN h.kind = 'IN'  AND h.bank_dr > 0
              WHEN 'BANK_OUT' THEN h.kind = 'OUT' AND h.bank_cr > 0 END) DESC,
              (h.amt = l.amount) DESC, abs(h.rd - d.business_date), h.voucher_no
     LIMIT 1;

    IF best.id IS NOT NULL AND NOT best.agrees THEN
      IF best.amt = l.amount THEN
        -- same money, different story: kept as a candidate for the pass-through pairing below
        v_status := 'CONFLICT';
        v_reason := format('%s is on HO voucher %s for the same %s, but HO booked it as %s',
                      best.key, COALESCE(best.manual_no, best.voucher_no), v_amt_fmt,
                      CASE WHEN best.kind = 'OUT' AND best.bank_cr > 0 THEN 'a payment from the bank (' || best.head || ')'
                           WHEN best.kind = 'OUT' THEN 'a cash payment (' || best.head || ')'
                           WHEN best.kind = 'IN'  THEN 'a receipt (' || best.head || ')'
                           ELSE 'a transfer' END);
        INSERT INTO _res VALUES (l.id, v_status, best.id, v_reason, jsonb_build_object('action', 'none'), best.head, best.id);
      ELSE
        INSERT INTO _res VALUES (l.id, 'CONFLICT', best.id,
          format('%s is on HO voucher %s, but the amounts differ (site %s, HO %s)', best.key,
                 COALESCE(best.manual_no, best.voucher_no), v_amt_fmt, public.nf_fmt(best.amt)),
          jsonb_build_object('action', 'none'), best.head, NULL);
      END IF;
      CONTINUE;
    END IF;

    -- ── rule 2: same amount, near date, some evidence ──
    IF best.id IS NULL THEN
      SELECT h.*, true AS agrees, 'soft' AS key,
             (public._nf_letters(l.party_name) <> '' AND length(public._nf_letters(l.party_name)) >= 4
                AND position(public._nf_letters(l.party_name) IN h.letters) > 0)::int
           + (l.head_code = h.head)::int
           + ((SELECT count(*) FROM unnest(public._nf_words(COALESCE(l.remarks, '') || ' ' || COALESCE(l.party_name, ''))) w
                WHERE w = ANY (h.words)) >= 2)::int
           + (EXISTS (SELECT 1 FROM _drawn x WHERE public._nf_cheque_hit(x.chq, h.cheques)) AND h.kind <> 'XFER')::int AS score,
             (public._nf_letters(l.party_name) <> '' AND length(public._nf_letters(l.party_name)) >= 4
                AND position(public._nf_letters(l.party_name) IN h.letters) > 0) AS by_party,
             (EXISTS (SELECT 1 FROM _drawn x WHERE public._nf_cheque_hit(x.chq, h.cheques)) AND h.kind <> 'XFER') AS by_funding,
             ((SELECT count(*) FROM unnest(public._nf_words(COALESCE(l.remarks, '') || ' ' || COALESCE(l.party_name, ''))) w
                WHERE w = ANY (h.words)) >= 2) AS by_words,
             CASE v_kind
               WHEN 'WDL'      THEN h.kind = 'XFER' AND h.bank_cr > 0 AND h.cash_dr + h.petty_dr > 0
               WHEN 'DEP'      THEN h.kind = 'XFER' AND h.bank_dr > 0 AND h.cash_cr + h.petty_cr > 0
               WHEN 'CASH_IN'  THEN h.kind = 'IN'  AND h.bank_dr = 0
               WHEN 'CASH_OUT' THEN h.kind = 'OUT' AND h.bank_cr = 0
               WHEN 'BANK_IN'  THEN h.kind = 'IN'  AND h.bank_dr > 0
               WHEN 'BANK_OUT' THEN h.kind = 'OUT' AND h.bank_cr > 0 END AS fits
        INTO best
        FROM _hv h
       WHERE h.amt = l.amount AND abs(h.rd - d.business_date) <= 2
         AND ((public._nf_letters(l.party_name) <> '' AND length(public._nf_letters(l.party_name)) >= 4
                 AND position(public._nf_letters(l.party_name) IN h.letters) > 0)
              OR l.head_code = h.head
              OR (SELECT count(*) FROM unnest(public._nf_words(COALESCE(l.remarks, '') || ' ' || COALESCE(l.party_name, ''))) w
                    WHERE w = ANY (h.words)) >= 2
              OR (EXISTS (SELECT 1 FROM _drawn x WHERE public._nf_cheque_hit(x.chq, h.cheques)) AND h.kind <> 'XFER'))
       ORDER BY score DESC, fits DESC, abs(h.rd - d.business_date), h.voucher_no
       LIMIT 1;
      IF best.id IS NOT NULL THEN
        SELECT count(*) INTO v_ties FROM _hv h
         WHERE h.amt = l.amount AND abs(h.rd - d.business_date) <= 2 AND h.id <> best.id
           AND ((public._nf_letters(l.party_name) <> '' AND length(public._nf_letters(l.party_name)) >= 4
                   AND position(public._nf_letters(l.party_name) IN h.letters) > 0)::int
              + (l.head_code = h.head)::int
              + ((SELECT count(*) FROM unnest(public._nf_words(COALESCE(l.remarks, '') || ' ' || COALESCE(l.party_name, ''))) w
                   WHERE w = ANY (h.words)) >= 2)::int
              + (EXISTS (SELECT 1 FROM _drawn x WHERE public._nf_cheque_hit(x.chq, h.cheques)) AND h.kind <> 'XFER')::int) >= best.score;
        IF v_ties > 0 THEN
          INSERT INTO _res VALUES (l.id, 'POSSIBLE', best.id,
            format('%s HO vouchers fit this line equally (same %s, near date) — pick the right one', v_ties + 1, v_amt_fmt),
            jsonb_build_object('action', 'none'), best.head, NULL);
          CONTINUE;
        END IF;
        IF NOT best.fits THEN
          INSERT INTO _res VALUES (l.id, 'CONFLICT', best.id,
            format('Looks like HO voucher %s (same %s, %s), but HO booked it as %s',
                   COALESCE(best.manual_no, best.voucher_no), v_amt_fmt, to_char(best.rd, 'DD-Mon'),
                   CASE WHEN best.kind = 'OUT' AND best.bank_cr > 0 THEN 'a payment from the bank (' || best.head || ')'
                        WHEN best.kind = 'OUT' THEN 'a cash payment (' || best.head || ')'
                        WHEN best.kind = 'IN'  THEN 'a receipt (' || best.head || ')'
                        ELSE 'a transfer' END),
            jsonb_build_object('action', 'none'), best.head, best.id);
          CONTINUE;
        END IF;
      END IF;
    END IF;

    -- ── nothing at HO ──
    IF best.id IS NULL THEN
      IF v_kind IN ('CASH_IN','CASH_OUT') THEN
        INSERT INTO _res VALUES (l.id, 'NEW', NULL, 'Not found at HO — Accept posts it from the site cash box',
                                 jsonb_build_object('action', 'post'), NULL, NULL);
      ELSIF v_chq IS NOT NULL AND EXISTS (SELECT 1 FROM public.nf_pdcs p WHERE p.company_id = d.company_id
                                            AND public._nf_cheque_hit(v_chq, ARRAY[regexp_replace(p.cheque_no, '[^0-9]', '', 'g')])) THEN
        INSERT INTO _res VALUES (l.id, 'POSSIBLE', NULL, format('Cheque %s is on HO''s post-dated cheque list, not yet in the books', v_chq),
                                 jsonb_build_object('action', 'none'), NULL, NULL);
      ELSE
        INSERT INTO _res VALUES (l.id, 'CONFLICT', NULL,
          CASE v_kind WHEN 'WDL' THEN 'Withdrawal missing at HO — HO must post it, then re-run the match'
                      WHEN 'DEP' THEN 'Deposit missing at HO — HO must post it, then re-run the match'
                      ELSE 'Bank line missing at HO — HO must post it, then re-run the match' END,
          jsonb_build_object('action', 'none'), NULL, NULL);
      END IF;
      CONTINUE;
    END IF;

    -- ── a fit: what Accept would do ──
    v_hohead := best.head;
    IF v_kind IN ('BANK_IN','BANK_OUT') THEN
      v_status := 'LINKED';
      v_reason := format('Same as HO voucher %s (%s)', COALESCE(best.manual_no, best.voucher_no),
                         CASE WHEN best.key = 'soft' THEN 'same amount and date' ELSE best.key END);
      v_prop := jsonb_build_object('action', 'link');
    ELSIF v_kind IN ('WDL','DEP') THEN
      v_status := 'DUPLICATE';
      IF (v_kind = 'WDL' AND best.cash_dr > 0) OR (v_kind = 'DEP' AND best.cash_cr > 0) THEN
        v_reason := format('Same as HO voucher %s (%s), but HO booked it %s HO cash; the money %s the site box. Accept moves %s %s',
                      COALESCE(best.manual_no, best.voucher_no), CASE WHEN best.key = 'soft' THEN 'same amount and date' ELSE best.key END,
                      CASE v_kind WHEN 'WDL' THEN 'into' ELSE 'out of' END,
                      CASE v_kind WHEN 'WDL' THEN 'went to' ELSE 'came from' END,
                      v_amt_fmt, CASE v_kind WHEN 'WDL' THEN 'from HO cash to the site box' ELSE 'from the site box to HO cash' END);
        v_prop := jsonb_build_object('action', 'transfer', 'amount', l.amount,
                                     'from', CASE v_kind WHEN 'WDL' THEN 'Cash' ELSE 'Petty' END,
                                     'to',   CASE v_kind WHEN 'WDL' THEN 'Petty' ELSE 'Cash' END);
      ELSE
        v_reason := format('Same as HO voucher %s, already booked to the site box', COALESCE(best.manual_no, best.voucher_no));
        v_prop := jsonb_build_object('action', 'link');
      END IF;
      v_hohead := NULL;
    ELSIF (best.cash_dr + best.cash_cr) > 0 THEN
      -- HO booked it from HO cash; the site took or paid it through its own box
      IF best.key <> 'soft' OR (best.rd = d.business_date AND (best.by_party OR best.by_funding OR best.by_words)) THEN
        v_status := 'DUPLICATE';
        v_reason := format('Source mismatch: HO voucher %s books this %s from HO cash, the site %s it through the site box. Accept moves HO''s voucher to the site box',
                      COALESCE(best.manual_no, best.voucher_no), v_amt_fmt, CASE l.side WHEN 'IN' THEN 'took' ELSE 'paid' END);
      ELSE
        v_status := 'POSSIBLE';
        v_reason := format('May be HO voucher %s (same %s, %s) — confirm with Mark duplicate, or Link',
                      COALESCE(best.manual_no, best.voucher_no), v_amt_fmt, to_char(best.rd, 'DD-Mon'));
      END IF;
      v_prop := jsonb_build_object('action', 'reroute', 'from', 'Cash', 'to', 'Petty');
    ELSE
      -- already booked to the site box
      v_status := CASE WHEN best.key <> 'soft' OR best.rd = d.business_date THEN 'DUPLICATE' ELSE 'POSSIBLE' END;
      v_reason := format('Same as HO voucher %s, already booked to the site box', COALESCE(best.manual_no, best.voucher_no));
      v_prop := jsonb_build_object('action', 'link');
    END IF;
    IF v_hohead IS NOT NULL AND v_hohead <> l.head_code THEN
      v_reason := v_reason || format(' · HO head kept: %s (site wrote %s)', v_hohead, l.head_code);
    END IF;
    INSERT INTO _res VALUES (l.id, v_status, best.id, v_reason, v_prop || jsonb_build_object('voucher_id', best.id), v_hohead, NULL);
  END LOOP;

  -- ── pass-through: cash drawn on a cheque and paid out the same day, which HO booked as
  --    ONE bank payment. Both site lines are that one voucher; nothing is posted or moved.
  UPDATE _res r SET status = 'DUPLICATE',
         reason = format('Pass-through: the site drew %s on the cheque and paid it out the same day; HO booked one bank payment, voucher %s. Nothing to post',
                         public.nf_fmt(sl.amount), COALESCE(h.manual_no, h.voucher_no)),
         proposal = jsonb_build_object('action', 'pass_through', 'voucher_id', r.voucher_id)
    FROM public.nf_site_lines sl, _hv h
   WHERE sl.id = r.line_id AND h.id = r.voucher_id AND r.nature_of IS NOT NULL AND h.kind = 'OUT' AND h.bank_cr > 0
     AND EXISTS (
       SELECT 1 FROM _res r2 JOIN public.nf_site_lines s2 ON s2.id = r2.line_id
        WHERE r2.line_id <> r.line_id AND r2.nature_of = r.voucher_id AND s2.amount = sl.amount
          AND ((s2.head_code = c_bank AND s2.side = 'IN' AND sl.head_code <> c_bank AND sl.side = 'OUT')
            OR (sl.head_code = c_bank AND sl.side = 'IN' AND s2.head_code <> c_bank AND s2.side = 'OUT')));

  -- ── one HO voucher, two site lines (not a pass-through pair): neither is sure ──
  UPDATE _res r SET status = 'POSSIBLE',
         reason = r.reason || ' · another site line of this day also points at this HO voucher'
   WHERE r.status IN ('DUPLICATE','LINKED') AND COALESCE(r.proposal->>'action', '') <> 'pass_through'
     AND (SELECT count(*) FROM _res r2 WHERE r2.voucher_id = r.voucher_id
            AND r2.status IN ('DUPLICATE','LINKED') AND COALESCE(r2.proposal->>'action', '') <> 'pass_through') > 1;

  -- ── an HO voucher already settled against a site line of another day ──
  UPDATE _res r SET status = 'CONFLICT',
         reason = format('HO voucher %s is already settled against a site line of %s — is this the same money twice?',
                         COALESCE(v.manual_no, v.voucher_no), to_char(od.business_date, 'DD-Mon')),
         proposal = jsonb_build_object('action', 'none')
    FROM public.nf_site_lines o JOIN public.nf_site_days od ON od.id = o.site_day_id, public.nf_vouchers v
   WHERE o.matched_voucher_id = r.voucher_id AND o.resolved_by IS NOT NULL AND o.site_day_id <> d.id
     AND v.id = r.voucher_id AND r.status IN ('DUPLICATE','LINKED','POSSIBLE');

  UPDATE public.nf_site_lines sl
     SET match_status = r.status, matched_voucher_id = r.voucher_id, match_reason = r.reason,
         proposal = r.proposal, ho_head_code = r.ho_head, matched_at = now()
    FROM _res r WHERE sl.id = r.line_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_accept(p_line_id uuid, p_version integer, p_head_code text, p_party_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.nf_site_lines;
BEGIN
  PERFORM public.nf_require_role((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id), ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id));  -- not the site cash box (20261119e)
  l := public._nf_site_line_for_ho(p_line_id, p_version);
  PERFORM public._nf_site_accept_one(l, p_head_code, p_party_name);
  UPDATE public.nf_site_lines SET version = version + 1, updated_at = now() WHERE id = l.id;
  RETURN public.nf_site_review(l.site_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_accept_new(p_site_day_id uuid, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days; l public.nf_site_lines;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(d.company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(d.company_id);  -- not the site cash box (20261119e)
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, d.version);
  IF d.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'NF:SITE_NOT_SUBMITTED' USING DETAIL = d.status; END IF;
  FOR l IN SELECT * FROM public.nf_site_lines
            WHERE site_day_id = d.id AND match_status = 'NEW' AND resolved_by IS NULL AND posted_voucher_id IS NULL
            ORDER BY (side = 'IN') DESC, line_no FOR UPDATE LOOP
    PERFORM public._nf_site_accept_one(l, NULL, NULL);
    UPDATE public.nf_site_lines SET version = version + 1, updated_at = now() WHERE id = l.id;
  END LOOP;
  UPDATE public.nf_site_days SET version = version + 1, updated_at = now() WHERE id = d.id;
  RETURN public.nf_site_review(d.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_bill_company(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN split_part(COALESCE(p_name, ''), '/', 1)::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_bill_writer(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.nf_members m
                  WHERE m.company_id = p_company_id AND m.user_id = auth.uid() AND m.active AND m.role = 'site');
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_day_json(p_site_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days; v_in numeric; v_out numeric; v_book numeric; v_site boolean;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_site := public.nf_role(d.company_id) IS NOT DISTINCT FROM 'site';
  SELECT COALESCE(sum(amount) FILTER (WHERE side = 'IN'  AND via = 'SITE_CASH' AND match_status <> 'REJECTED'), 0),
         COALESCE(sum(amount) FILTER (WHERE side = 'OUT' AND via = 'SITE_CASH' AND match_status <> 'REJECTED'), 0)
    INTO v_in, v_out FROM public.nf_site_lines WHERE site_day_id = d.id;
  v_book := public._nf_site_book(d.company_id, d.business_date);
  RETURN to_jsonb(d) || jsonb_build_object(
    'opening', v_book - v_in + v_out,
    'cash_in', v_in, 'cash_out', v_out,
    'book_now', v_book,
    'lines', COALESCE((SELECT jsonb_agg(CASE WHEN v_site
                                             THEN to_jsonb(l) - 'matched_voucher_id' - 'match_reason' - 'proposal'
                                                  - 'ho_head_code' - 'posted_voucher_id' - 'resolution' - 'resolved_by'
                                             ELSE to_jsonb(l) END ORDER BY l.side, l.line_no)
                         FROM public.nf_site_lines l WHERE l.site_day_id = d.id), '[]'::jsonb));
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
  PERFORM public.nf_assert_head_office(l.company_id);  -- not the site cash box (20261119e)
  SELECT * INTO d FROM public.nf_site_days WHERE id = l.site_day_id FOR UPDATE;
  SELECT * INTO l FROM public.nf_site_lines WHERE id = p_line_id FOR UPDATE;
  PERFORM public.nf_check_version(p_version, l.version);
  IF d.status NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'NF:SITE_DAY_LOCKED' USING DETAIL = d.status; END IF;
  IF l.posted_voucher_id IS NOT NULL THEN RAISE EXCEPTION 'NF:SITE_LINE_POSTED'; END IF;
  IF l.resolved_by IS NOT NULL THEN RAISE EXCEPTION 'NF:SITE_LINE_RESOLVED'; END IF;
  DELETE FROM public.nf_site_lines WHERE id = l.id;
  UPDATE public.nf_site_days SET version = version + 1, updated_by = auth.uid(), updated_at = now() WHERE id = d.id;
  PERFORM public._nf_site_assert_not_negative(l.company_id, d.business_date);
  RETURN public.nf_site_day_json(d.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_get_day(p_company_id uuid, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['site','accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box (20261119e)
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

CREATE OR REPLACE FUNCTION public.nf_site_link(p_line_id uuid, p_version integer, p_voucher_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.nf_site_lines; v public.nf_vouchers;
BEGIN
  PERFORM public.nf_require_role((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id), ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id));  -- not the site cash box (20261119e)
  l := public._nf_site_line_for_ho(p_line_id, p_version);
  SELECT * INTO v FROM public.nf_vouchers WHERE id = p_voucher_id AND company_id = l.company_id AND status = 'POSTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VOUCHER_NOT_FOUND'; END IF;
  UPDATE public.nf_site_lines
     SET match_status = 'LINKED', matched_voucher_id = v.id, resolved_by = auth.uid(), resolved_at = now(),
         resolution = COALESCE(NULLIF(btrim(p_reason), ''), 'Linked by HO to ' || COALESCE(v.manual_no, v.voucher_no)),
         version = version + 1, updated_at = now()
   WHERE id = l.id;
  RETURN public.nf_site_review(l.site_day_id);
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
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box (20261119e)
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

CREATE OR REPLACE FUNCTION public.nf_site_list_heads(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['site','accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box (20261119e)
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'requires_party', a.requires_party) ORDER BY a.code)
                     FROM public.nf_accounts a
                    WHERE a.company_id = p_company_id AND a.is_head AND a.active AND a.via IS NULL), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_list_units(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['site','accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box (20261119e)
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('unit', u.unit_no, 'floor', u.floor_label)
                                    ORDER BY u.floor_no, u.unit_no)
                     FROM public.units u JOIN public.projects p ON p.id = u.project_id
                    WHERE p.company_id = p_company_id), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_mark_duplicate(p_line_id uuid, p_version integer, p_voucher_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.nf_site_lines; v public.nf_vouchers; c_cash text; c_petty text; c_bank text;
        cash_leg boolean; bank_leg boolean; v_amt numeric; v_prop jsonb; v_head text;
BEGIN
  PERFORM public.nf_require_role((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id), ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id));  -- not the site cash box (20261119e)
  l := public._nf_site_line_for_ho(p_line_id, p_version);
  SELECT * INTO v FROM public.nf_vouchers WHERE id = p_voucher_id AND company_id = l.company_id AND status = 'POSTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VOUCHER_NOT_FOUND'; END IF;
  SELECT code INTO c_cash  FROM public.nf_accounts WHERE company_id = l.company_id AND via = 'Cash';
  SELECT code INTO c_petty FROM public.nf_accounts WHERE company_id = l.company_id AND via = 'Petty';
  SELECT code INTO c_bank  FROM public.nf_accounts WHERE company_id = l.company_id AND via = 'Bank';
  SELECT COALESCE(sum(debit), 0), bool_or(account_code = c_cash), bool_or(account_code = c_bank)
    INTO v_amt, cash_leg, bank_leg FROM public.nf_voucher_legs WHERE voucher_id = v.id;
  IF v_amt <> l.amount THEN
    RAISE EXCEPTION 'NF:LINK_AMOUNT_DIFFERS' USING DETAIL = json_build_object('site', l.amount, 'ho', v_amt)::text;
  END IF;
  SELECT account_code INTO v_head FROM public.nf_voucher_legs g JOIN public.nf_accounts a
    ON a.company_id = g.company_id AND a.code = g.account_code WHERE g.voucher_id = v.id AND a.via IS NULL LIMIT 1;
  v_prop := CASE
    WHEN l.via = 'SITE_CASH' AND l.head_code = c_bank AND cash_leg
      THEN jsonb_build_object('action', 'transfer', 'amount', l.amount,
             'from', CASE l.side WHEN 'IN' THEN 'Cash' ELSE 'Petty' END, 'to', CASE l.side WHEN 'IN' THEN 'Petty' ELSE 'Cash' END)
    WHEN l.via = 'SITE_CASH' AND l.head_code <> c_bank AND cash_leg AND v_head IS NOT NULL
      THEN jsonb_build_object('action', 'reroute', 'from', 'Cash', 'to', 'Petty')
    ELSE jsonb_build_object('action', 'link') END || jsonb_build_object('voucher_id', v.id);
  UPDATE public.nf_site_lines
     SET match_status = 'DUPLICATE', matched_voucher_id = v.id, proposal = v_prop, ho_head_code = v_head,
         match_reason = 'Marked duplicate of HO voucher ' || COALESCE(v.manual_no, v.voucher_no) || ' by HO',
         matched_at = now(), version = version + 1, updated_at = now()
   WHERE id = l.id;
  RETURN public.nf_site_review(l.site_day_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_match(p_site_day_id uuid)
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
  PERFORM public.nf_assert_head_office(d.company_id);  -- not the site cash box (20261119e)
  IF d.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'NF:SITE_NOT_SUBMITTED' USING DETAIL = d.status; END IF;
  PERFORM public._nf_site_match(d.id);
  RETURN public.nf_site_review(d.id);
END
$function$;

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

CREATE OR REPLACE FUNCTION public.nf_site_reject(p_line_id uuid, p_version integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l public.nf_site_lines; d date;
BEGIN
  PERFORM public.nf_require_role((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id), ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office((SELECT company_id FROM public.nf_site_lines WHERE id = p_line_id));  -- not the site cash box (20261119e)
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'NF:REASON_REQUIRED'; END IF;
  l := public._nf_site_line_for_ho(p_line_id, p_version);
  UPDATE public.nf_site_lines
     SET match_status = 'REJECTED', resolved_by = auth.uid(), resolved_at = now(), resolution = btrim(p_reason),
         version = version + 1, updated_at = now()
   WHERE id = l.id;
  SELECT business_date INTO d FROM public.nf_site_days WHERE id = l.site_day_id;
  PERFORM public._nf_site_assert_not_negative(l.company_id, d);
  RETURN public.nf_site_review(l.site_day_id);
END
$function$;

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
  PERFORM public.nf_assert_head_office(d.company_id);  -- not the site cash box (20261119e)
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
  PERFORM public.nf_assert_head_office(d.company_id);  -- not the site cash box (20261119e)
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

CREATE OR REPLACE FUNCTION public.nf_site_review(p_site_day_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.nf_site_days;
BEGIN
  SELECT * INTO d FROM public.nf_site_days WHERE id = p_site_day_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:DAY_NOT_FOUND'; END IF;
  PERFORM public.nf_require_role(d.company_id, ARRAY['accountant','director','viewer']);
  PERFORM public.nf_assert_head_office(d.company_id);  -- not the site cash box login (20261118i)
  RETURN public.nf_site_day_json(d.id) || jsonb_build_object(
    'review', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'line_id', l.id, 'line_no', l.line_no, 'side', l.side, 'doc_no', l.doc_no, 'party', l.party_name,
        'units', l.unit_codes, 'token_no', l.token_no, 'head', l.head_code, 'via', l.via, 'amount', l.amount,
        'bank_ref', l.bank_ref, 'remarks', l.remarks, 'version', l.version,
        'status', l.match_status, 'reason', l.match_reason, 'proposal', l.proposal, 'ho_head', l.ho_head_code,
        'resolution', l.resolution, 'resolved_at', l.resolved_at,
        'ho', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object(
                 'id', v.id, 'voucher_no', v.voucher_no, 'manual_no', v.manual_no, 'narration', v.narration,
                 'real_date', public._nf_voucher_real_date(v.narration, v.real_date, v.created_at),
                 'legs', (SELECT jsonb_agg(jsonb_build_object('account', g.account_code, 'debit', g.debit, 'credit', g.credit)
                                           ORDER BY g.line_no) FROM public.nf_voucher_legs g WHERE g.voucher_id = v.id)) END,
        'posted', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id', p.id, 'voucher_no', p.voucher_no, 'manual_no', p.manual_no) END)
      ORDER BY l.side, l.line_no)
      FROM public.nf_site_lines l
      LEFT JOIN public.nf_vouchers v ON v.id = l.matched_voucher_id
      LEFT JOIN public.nf_vouchers p ON p.id = l.posted_voucher_id
     WHERE l.site_day_id = d.id), '[]'::jsonb));
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_save_line(p_company_id uuid, p_business_date date, p_line_id uuid, p_side text, p_doc_no text, p_party_name text, p_unit_codes text, p_token_no integer, p_head_code text, p_via text, p_amount numeric, p_bank_ref text, p_remarks text, p_attachment_url text, p_version integer)
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
  v_doc text := NULLIF(upper(btrim(p_doc_no)), '');
  v_other date;
BEGIN
  -- only the site accountant: the site record stays exactly as he entered it.
  -- HO returns the day with a reason, or corrects head/party on the HO
  -- voucher when it accepts the line.
  PERFORM public.nf_require_role(p_company_id, ARRAY['site']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box (20261119e)
  IF p_side IS NULL OR p_side NOT IN ('IN','OUT') THEN RAISE EXCEPTION 'NF:SIDE_REQUIRED'; END IF;
  IF p_via  IS NULL OR p_via  NOT IN ('SITE_CASH','BANK') THEN RAISE EXCEPTION 'NF:VIA_UNKNOWN' USING DETAIL = COALESCE(p_via, '(none)'); END IF;
  PERFORM public.nf_check_amount(p_amount, 'amount', false);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'NF:AMOUNT_NOT_POSITIVE'; END IF;
  IF NULLIF(btrim(p_head_code), '') IS NULL THEN
    RAISE EXCEPTION 'NF:SITE_HEAD_REQUIRED' USING HINT = 'Choose what this money was for.';
  END IF;
  -- a head HO uses; or, for a site-cash line only, the bank itself: "Bank to Cash"
  -- (IN, a withdrawal into the box) or "Cash to Bank" (OUT, a deposit)
  SELECT * INTO v_head FROM public.nf_accounts
   WHERE company_id = p_company_id AND code = btrim(COALESCE(p_head_code, '')) AND active
     AND ((is_head AND via IS NULL) OR (via = 'Bank' AND p_via = 'SITE_CASH'));
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:HEAD_REQUIRED' USING DETAIL = COALESCE(p_head_code, '(none)'); END IF;
  IF v_head.code = '21100' AND p_token_no IS NULL THEN
    RAISE EXCEPTION 'NF:SITE_TOKEN_NO_REQUIRED' USING HINT = 'Token money needs the token number.';
  END IF;
  -- every line carries its paper number and a name (owner, 19-Nov). A paper number may still
  -- repeat on lines of the SAME day (one voucher, two heads -> n/1, n/2 when posted).
  IF NULLIF(btrim(p_doc_no), '') IS NULL THEN
    RAISE EXCEPTION 'NF:SITE_DOC_NO_REQUIRED' USING HINT = 'Write the receipt or voucher number from the book.';
  END IF;
  IF NULLIF(btrim(p_party_name), '') IS NULL THEN
    RAISE EXCEPTION 'NF:SITE_PARTY_REQUIRED' USING HINT = 'Write who the money came from or went to.';
  END IF;

  IF p_line_id IS NOT NULL THEN
    SELECT * INTO l FROM public.nf_site_lines WHERE id = p_line_id AND company_id = p_company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NF:LINE_NOT_FOUND'; END IF;
    PERFORM public.nf_check_version(p_version, l.version);
    IF l.posted_voucher_id IS NOT NULL THEN RAISE EXCEPTION 'NF:SITE_LINE_POSTED'; END IF;
    IF l.resolved_by IS NOT NULL THEN RAISE EXCEPTION 'NF:SITE_LINE_RESOLVED'; END IF;
    SELECT * INTO d FROM public.nf_site_days WHERE id = l.site_day_id FOR UPDATE;
    IF d.business_date <> p_business_date THEN RAISE EXCEPTION 'NF:SITE_LINE_OTHER_DAY'; END IF;
  ELSE
    d := public._nf_site_day_for(p_company_id, p_business_date);
  END IF;
  IF d.status NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'NF:SITE_DAY_LOCKED' USING DETAIL = d.status; END IF;

  -- a paper receipt / voucher number belongs to one day: several lines of that
  -- day may carry it (one voucher, two heads), another day may not
  IF v_doc IS NOT NULL THEN
    SELECT sd.business_date INTO v_other
      FROM public.nf_site_lines x JOIN public.nf_site_days sd ON sd.id = x.site_day_id
     WHERE x.company_id = p_company_id AND x.side = p_side AND upper(btrim(x.doc_no)) = v_doc
       AND x.site_day_id <> d.id
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'NF:DUPLICATE_DOC_NO'
        USING DETAIL = json_build_object('doc_no', btrim(p_doc_no), 'side', p_side, 'used_on', v_other)::text;
    END IF;
  END IF;

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
           match_status = 'NEW', matched_voucher_id = NULL, match_reason = NULL, proposal = NULL,
           ho_head_code = NULL, matched_at = NULL,
           version = version + 1, updated_by = auth.uid(), updated_at = now()
     WHERE id = l.id;
  END IF;

  -- the day's version moves with its lines, so a screen that has not seen a
  -- line cannot submit the day
  UPDATE public.nf_site_days SET version = version + 1, updated_by = auth.uid(), updated_at = now() WHERE id = d.id;
  PERFORM public._nf_site_assert_not_negative(p_company_id, d.business_date);
  RETURN public.nf_site_day_json(d.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_site_start_first_day(p_company_id uuid, p_business_date date, p_opening_cash numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(p_company_id);  -- not the site cash box (20261119e)
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

CREATE OR REPLACE FUNCTION public.nf_site_submit(p_site_day_id uuid, p_counted_cash numeric, p_denominations jsonb, p_variance_reason text, p_version integer)
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
  PERFORM public.nf_assert_head_office(d.company_id);  -- not the site cash box (20261119e)
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
  PERFORM public._nf_site_match(d.id);
  RETURN public.nf_site_day_json(d.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_vouchers_site_match_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.nf_purging(OLD.company_id) THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM public.nf_site_lines
              WHERE (matched_voucher_id = OLD.id AND resolved_by IS NOT NULL) OR posted_voucher_id = OLD.id) THEN
    RAISE EXCEPTION 'NF:VOUCHER_SETTLED_BY_SITE'
      USING DETAIL = COALESCE(OLD.manual_no, OLD.voucher_no),
            HINT   = 'A site line HO has already decided rests on this voucher.';
  END IF;
  UPDATE public.nf_site_lines
     SET match_status = 'NEW', matched_voucher_id = NULL, proposal = NULL, ho_head_code = NULL,
         match_reason = 'The HO voucher it matched was deleted — run the match again', matched_at = now()
   WHERE matched_voucher_id = OLD.id AND resolved_by IS NULL;
  RETURN OLD;
END
$function$;

REVOKE ALL ON FUNCTION public._nf_ho_open_day(p_company_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._nf_ho_open_day(p_company_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public._nf_ho_voucher_edit(p_voucher_id uuid, p_via text, p_head text, p_party text, p_real_date date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._nf_ho_voucher_edit(p_voucher_id uuid, p_via text, p_head text, p_party text, p_real_date date) TO service_role;
REVOKE ALL ON FUNCTION public._nf_site_accept_one(l nf_site_lines, p_head_code text, p_party_name text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._nf_site_accept_one(l nf_site_lines, p_head_code text, p_party_name text) TO service_role;
REVOKE ALL ON FUNCTION public._nf_site_assert_not_negative(p_company_id uuid, p_from date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._nf_site_assert_not_negative(p_company_id uuid, p_from date) TO service_role;
REVOKE ALL ON FUNCTION public._nf_site_book(p_company_id uuid, p_date date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._nf_site_book(p_company_id uuid, p_date date) TO service_role;
REVOKE ALL ON FUNCTION public._nf_site_cheque(p text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._nf_site_cheque(p text) TO service_role;
REVOKE ALL ON FUNCTION public._nf_site_day_for(p_company_id uuid, p_business_date date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._nf_site_day_for(p_company_id uuid, p_business_date date) TO service_role;
REVOKE ALL ON FUNCTION public._nf_site_line_for_ho(p_line_id uuid, p_version integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._nf_site_line_for_ho(p_line_id uuid, p_version integer) TO service_role;
REVOKE ALL ON FUNCTION public._nf_site_match(p_site_day_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._nf_site_match(p_site_day_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_accept(p_line_id uuid, p_version integer, p_head_code text, p_party_name text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_accept(p_line_id uuid, p_version integer, p_head_code text, p_party_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_accept(p_line_id uuid, p_version integer, p_head_code text, p_party_name text) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_accept_new(p_site_day_id uuid, p_version integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_accept_new(p_site_day_id uuid, p_version integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_accept_new(p_site_day_id uuid, p_version integer) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_bill_company(p_name text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_bill_company(p_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_bill_company(p_name text) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_bill_writer(p_company_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_bill_writer(p_company_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_bill_writer(p_company_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_day_json(p_site_day_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_day_json(p_site_day_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_delete_line(p_line_id uuid, p_version integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_delete_line(p_line_id uuid, p_version integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_delete_line(p_line_id uuid, p_version integer) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_get_day(p_company_id uuid, p_business_date date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_get_day(p_company_id uuid, p_business_date date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_get_day(p_company_id uuid, p_business_date date) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_link(p_line_id uuid, p_version integer, p_voucher_id uuid, p_reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_link(p_line_id uuid, p_version integer, p_voucher_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_link(p_line_id uuid, p_version integer, p_voucher_id uuid, p_reason text) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_list_days(p_company_id uuid, p_from date, p_to date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_list_days(p_company_id uuid, p_from date, p_to date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_list_days(p_company_id uuid, p_from date, p_to date) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_list_heads(p_company_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_list_heads(p_company_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_list_heads(p_company_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_list_units(p_company_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_list_units(p_company_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_list_units(p_company_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_mark_duplicate(p_line_id uuid, p_version integer, p_voucher_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_mark_duplicate(p_line_id uuid, p_version integer, p_voucher_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_mark_duplicate(p_line_id uuid, p_version integer, p_voucher_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_match(p_site_day_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_match(p_site_day_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_match(p_site_day_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_reader(p_company_id uuid, p_with_site boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_reader(p_company_id uuid, p_with_site boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_reader(p_company_id uuid, p_with_site boolean) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_reject(p_line_id uuid, p_version integer, p_reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_reject(p_line_id uuid, p_version integer, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_reject(p_line_id uuid, p_version integer, p_reason text) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_reopen(p_site_day_id uuid, p_reason text, p_version integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_reopen(p_site_day_id uuid, p_reason text, p_version integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_reopen(p_site_day_id uuid, p_reason text, p_version integer) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_return(p_site_day_id uuid, p_reason text, p_version integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_return(p_site_day_id uuid, p_reason text, p_version integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_return(p_site_day_id uuid, p_reason text, p_version integer) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_review(p_site_day_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_review(p_site_day_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_review(p_site_day_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_save_line(p_company_id uuid, p_business_date date, p_line_id uuid, p_side text, p_doc_no text, p_party_name text, p_unit_codes text, p_token_no integer, p_head_code text, p_via text, p_amount numeric, p_bank_ref text, p_remarks text, p_attachment_url text, p_version integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_save_line(p_company_id uuid, p_business_date date, p_line_id uuid, p_side text, p_doc_no text, p_party_name text, p_unit_codes text, p_token_no integer, p_head_code text, p_via text, p_amount numeric, p_bank_ref text, p_remarks text, p_attachment_url text, p_version integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_save_line(p_company_id uuid, p_business_date date, p_line_id uuid, p_side text, p_doc_no text, p_party_name text, p_unit_codes text, p_token_no integer, p_head_code text, p_via text, p_amount numeric, p_bank_ref text, p_remarks text, p_attachment_url text, p_version integer) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_start_first_day(p_company_id uuid, p_business_date date, p_opening_cash numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_start_first_day(p_company_id uuid, p_business_date date, p_opening_cash numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_start_first_day(p_company_id uuid, p_business_date date, p_opening_cash numeric) TO service_role;
REVOKE ALL ON FUNCTION public.nf_site_submit(p_site_day_id uuid, p_counted_cash numeric, p_denominations jsonb, p_variance_reason text, p_version integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_submit(p_site_day_id uuid, p_counted_cash numeric, p_denominations jsonb, p_variance_reason text, p_version integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_site_submit(p_site_day_id uuid, p_counted_cash numeric, p_denominations jsonb, p_variance_reason text, p_version integer) TO service_role;
REVOKE ALL ON FUNCTION public.nf_vouchers_site_match_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nf_vouchers_site_match_guard() TO service_role;

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

CREATE TRIGGER nf_vouchers_site_match_guard BEFORE DELETE ON public.nf_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.nf_vouchers_site_match_guard();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('nf-site-bills', 'nf-site-bills', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS nf_site_bills_insert ON storage.objects;
CREATE POLICY nf_site_bills_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nf-site-bills' AND public.nf_site_bill_writer(public.nf_site_bill_company(name)));
DROP POLICY IF EXISTS nf_site_bills_read ON storage.objects;
CREATE POLICY nf_site_bills_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'nf-site-bills' AND public.nf_site_reader(public.nf_site_bill_company(name), true));

UPDATE public.nf_accounts SET via_label = CASE via WHEN 'Cash' THEN 'Head Office Cash' ELSE 'Site Cash' END
 WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND via IN ('Cash', 'Petty');

UPDATE public.nf_members SET active = true, cash_via = 'Petty', updated_at = now(), updated_by = '315f2852-852f-4653-9253-a5a27a7828c8'
 WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND user_id = '671bc3d9-f794-4e75-ab18-8fab2feb1466';

ALTER TABLE public.nf_days DISABLE TRIGGER nf_days_guard;
UPDATE public.nf_days SET created_by = '671bc3d9-f794-4e75-ab18-8fab2feb1466', updated_at = now(), version = version + 1
 WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND closing_no = 'DC-011' AND created_by = '315f2852-852f-4653-9253-a5a27a7828c8' AND status = 'OPEN';
ALTER TABLE public.nf_days ENABLE TRIGGER nf_days_guard;
