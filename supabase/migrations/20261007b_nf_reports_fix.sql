-- ─────────────────────────────────────────────────────────────────────────
-- NexuFinance reports: three wrong reports fixed, two new ones (2026-10-07)
--
-- READ-ONLY. No voucher, leg, party or reservation is written. Every
-- function here only SELECTs. All of them are company-scoped and keep
-- nf_require_role(company, ['accountant','director','viewer']).
--
-- Fix 1  nf_get_token_register  (same name and signature, new body)
--        Was: unit read only from leg memos shaped "unit GF-129" (the
--        QuickBooks imports), so every new voucher whose units are in the
--        narration was missed: 39 units, net -1,30,000, against a real
--        21100 of 7,15,55,000. It now reads every POSTED 21100 leg and finds
--        its units in this order: the leg memo; a voucher the memo names
--        (e.g. "BRV-0013 buyer confirmed"); the voucher narration; the
--        placeholder party's name ("Buyer pending - LG 56/99"). Unit lists,
--        ranges, carried prefixes and suffixes are all read (LG-20/21/22/23,
--        LG 20-23, Units GF 51, 52, 53, 54, LG 01-A). A unit that is not in
--        the RMS unit list is never invented: it is shown under
--        "Not in unit list". A leg is split across its units by its own
--        "N each" when that adds up, otherwise equally with the remainder on
--        the first unit. Each unit is compared with its active reservation's
--        received token. The 21150 "Not Allocated" money is a separate block.
-- Fix 2  nf_director_summary  tokens.refunded / buyers / unit_bookings were
--        wrong (refunded summed every 21100 debit, including JVs that only
--        move money). Adds tokens.not_allocated and tokens.total_held.
--        p_as_of NULL now means today in Asia/Karachi (it returned zeros).
-- Fix 3  nf_other_balances  adds 21150; p_as_of NULL = today.
-- New A  nf_get_receipt_register  receipt / token numbers: used, twice,
--        missing, and token receipts with no number.
-- New B  nf_get_group_balances  group companies and directors: opening,
--        given, received, closing, who owes whom.
--
-- Helpers (_nf_*) are internal: EXECUTE revoked from PUBLIC, anon and
-- authenticated. The two new report RPCs are granted to authenticated only.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── text readers ─────────────────────────────────────────────────────────

-- Is this word a unit prefix (GF, LG, FF, 5F, CB …)? Two capitals/digits with
-- at least one letter, and not a voucher prefix (JV).
CREATE OR REPLACE FUNCTION public._nf_is_unit_pfx(p_tok text, p_skip text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(p_tok ~ '^[A-Z0-9]{2}$' AND p_tok ~ '[A-Z]'
                  AND NOT (p_tok = ANY (COALESCE(p_skip, '{}'::text[]))), false);
$function$;

-- One run of units starting the search at word p_from.
-- Returns keys 'PFX|NUMBER|SUFFIX', e.g. 'GF|51|', 'LG|1|A'.
CREATE OR REPLACE FUNCTION public._nf_unit_run(p_t text[], p_from int, p_skip text[])
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n int := COALESCE(array_length(p_t, 1), 0);
  i int := p_from; j int; k int; hi int;
  pfx text; num int; nx text;
  res text[] := '{}';
BEGIN
  -- find the first prefix followed by a number
  WHILE i <= n LOOP
    IF public._nf_is_unit_pfx(p_t[i], p_skip) THEN
      j := i + 1;
      IF j <= n AND p_t[j] = '-' THEN j := j + 1; END IF;
      IF j <= n AND p_t[j] ~ '^[0-9]{1,4}[A-Z]?$' THEN EXIT; END IF;
    END IF;
    i := i + 1;
  END LOOP;
  IF i > n THEN RETURN res; END IF;

  pfx := p_t[i];
  num := substring(p_t[j] FROM '^([0-9]+)')::int;
  res := res || (pfx || '|' || num || '|' || COALESCE(substring(p_t[j] FROM '([A-Z])$'), ''));
  i := j + 1;

  LOOP
    EXIT WHEN i > n;
    -- a range: GF 51-54
    IF p_t[i] = '-' AND i + 1 <= n AND p_t[i + 1] ~ '^[0-9]{1,4}$'
       AND p_t[i + 1]::int > num AND p_t[i + 1]::int - num <= 60 THEN
      hi := p_t[i + 1]::int;
      FOR k IN num + 1 .. hi LOOP res := res || (pfx || '|' || k || '|'); END LOOP;
      num := hi; i := i + 2; CONTINUE;
    END IF;
    -- a suffix: LG 01-A
    IF p_t[i] = '-' AND i + 1 <= n AND p_t[i + 1] ~ '^[A-Z]$' THEN
      res[cardinality(res)] := pfx || '|' || num || '|' || p_t[i + 1];
      i := i + 2; CONTINUE;
    END IF;
    -- a list: LG-20/21, GF 51, 52 and 53, LG 67 and LG 110
    IF p_t[i] IN ('/', ',', '&', '+') OR lower(p_t[i]) = 'and' THEN
      EXIT WHEN i + 1 > n;
      nx := p_t[i + 1];
      IF nx ~ '^[0-9]{1,4}[A-Z]?$' THEN
        num := substring(nx FROM '^([0-9]+)')::int;
        res := res || (pfx || '|' || num || '|' || COALESCE(substring(nx FROM '([A-Z])$'), ''));
        i := i + 2; CONTINUE;
      END IF;
      IF public._nf_is_unit_pfx(nx, p_skip) THEN
        j := i + 2;
        IF j <= n AND p_t[j] = '-' THEN j := j + 1; END IF;
        IF j <= n AND p_t[j] ~ '^[0-9]{1,4}[A-Z]?$' THEN
          pfx := nx;
          num := substring(p_t[j] FROM '^([0-9]+)')::int;
          res := res || (pfx || '|' || num || '|' || COALESCE(substring(p_t[j] FROM '([A-Z])$'), ''));
          i := j + 1; CONTINUE;
        END IF;
      END IF;
    END IF;
    EXIT;
  END LOOP;
  RETURN res;
END
$function$;

-- The units a piece of text names. When the text says "Unit"/"Units", the
-- run after that word wins, so "Unit FF 270 … check: #144 also on GF 248"
-- gives FF-270 only. Duplicates removed, order kept.
CREATE OR REPLACE FUNCTION public._nf_unit_keys(p_text text, p_skip text[])
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t text[]; n int; kw int := 0; i int; res text[] := '{}';
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN RETURN '{}'; END IF;
  -- an amount written with commas and no spaces (1,00,000) is ONE word, so
  -- "LG-56/99, 1,00,000 each" never reads 1 and 00 as units
  SELECT array_agg(x.m[1] ORDER BY x.o) INTO t
    FROM regexp_matches(p_text, '([0-9]+(?:,[0-9]+)+|[A-Za-z0-9]+|[^A-Za-z0-9[:space:]])', 'g') WITH ORDINALITY AS x(m, o);
  n := COALESCE(array_length(t, 1), 0);
  FOR i IN 1 .. n LOOP
    IF lower(t[i]) IN ('unit', 'units') THEN kw := i; EXIT; END IF;
  END LOOP;
  IF kw > 0 THEN res := public._nf_unit_run(t, kw, p_skip); END IF;
  IF cardinality(res) = 0 THEN res := public._nf_unit_run(t, 1, p_skip); END IF;
  RETURN ARRAY(SELECT k FROM unnest(res) WITH ORDINALITY AS u(k, o)
                GROUP BY k ORDER BY min(o));
END
$function$;

-- Receipt / token numbers in a text: "Token #126", "Receipt #158",
-- "Token 101", "Token #138 + #139", "Tokens #106 and #126". Order kept.
CREATE OR REPLACE FUNCTION public._nf_receipt_nos(p_text text)
 RETURNS int[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH m AS (
    SELECT x.m, x.o
      FROM regexp_matches(COALESCE(p_text, ''),
             '(?:[Tt]okens?|[Rr]eceipts?)\s*#?\s*([0-9]{2,5})((?:\s*(?:,|and|\+|&)\s*#\s*[0-9]{2,5})*)', 'g')
           WITH ORDINALITY AS x(m, o)
  ), nums AS (
    SELECT m[1]::int AS nn, o * 100 AS ord FROM m
    UNION ALL
    SELECT y.mm[1]::int, m.o * 100 + y.o2
      FROM m, regexp_matches(COALESCE(m.m[2], ''), '([0-9]{2,5})', 'g') WITH ORDINALITY AS y(mm, o2)
  )
  SELECT COALESCE(array_agg(nn ORDER BY f), '{}'::int[])
    FROM (SELECT nn, min(ord) AS f FROM nums GROUP BY nn) z;
$function$;

-- Voucher numbers a text names, as written: "BRV-0013", and the carried
-- prefix in "(BRV-0011, 0016, 0019, 0020)". Only this company's voucher
-- prefixes count.
CREATE OR REPLACE FUNCTION public._nf_voucher_refs(p_text text, p_prefixes text[])
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r text[]; res text[] := '{}'; d text;
BEGIN
  FOR r IN SELECT x.m FROM regexp_matches(COALESCE(p_text, ''),
             '\m([A-Z]{2,4})-([0-9]{3,6})((?:\s*(?:,|and|&)\s*[0-9]{3,6}\M)*)', 'g') AS x(m)
  LOOP
    CONTINUE WHEN NOT (r[1] = ANY (COALESCE(p_prefixes, '{}'::text[])));
    res := res || (r[1] || '-' || r[2]);
    FOR d IN SELECT y.mm[1] FROM regexp_matches(COALESCE(r[3], ''), '([0-9]{3,6})', 'g') AS y(mm) LOOP
      res := res || (r[1] || '-' || d);
    END LOOP;
  END LOOP;
  RETURN res;
END
$function$;

-- A placeholder party is not a buyer.
CREATE OR REPLACE FUNCTION public._nf_is_placeholder_party(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(p_name ~* '^\s*(buyer pending|unknown buyer)', false);
$function$;

-- RMS unit_no → the same key the readers produce: 'LG-01-A' → 'LG|1|A'.
CREATE OR REPLACE FUNCTION public._nf_unit_no_key(p_unit_no text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT m[1] || '|' || m[2]::int || '|' || m[3]
    FROM regexp_matches(upper(btrim(p_unit_no)), '^([A-Z0-9]{2})[ -]?([0-9]+)-?([A-Z]?)$') AS x(m);
$function$;

-- ── every 21100 leg, allocated to its units ──────────────────────────────
-- One row per (leg, unit); a leg naming no unit gives one row with ukey NULL.
-- amount is signed: + received (credit), − returned or moved out (debit).
CREATE OR REPLACE FUNCTION public._nf_token_alloc(p_company_id uuid, p_to date)
 RETURNS TABLE (leg_id uuid, voucher_id uuid, voucher_no text, system_no text, voucher_date date,
                vsort bigint, line_no int, party_id uuid, party text, placeholder boolean,
                ukey text, amount numeric, nos int[], src text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pfx text[];
  r record;
  keys text[]; refs text[]; k text; n int; i int;
  amt numeric; each_amt numeric; base numeric; share numeric;
  how text; leg_nos int[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT substring(v.voucher_no FROM '^([A-Z]+)-')), '{}')
    INTO v_pfx
    FROM public.nf_vouchers v
   WHERE v.company_id = p_company_id AND v.voucher_no ~ '^[A-Z]+-';

  FOR r IN
    SELECT l.id, l.voucher_id AS vid, COALESCE(NULLIF(btrim(v.manual_no), ''), v.voucher_no) AS vno, v.voucher_no AS sysno,
           v.voucher_date AS vdate, row_number() OVER (ORDER BY v.voucher_date, v.sort, v.created_at, v.id) AS vs,
           l.line_no AS ln, l.party_id AS pid, pt.name AS pname, v.narration, l.memo,
           COALESCE(l.credit, 0) - COALESCE(l.debit, 0) AS amt
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
     WHERE l.company_id = p_company_id AND l.account_code = '21100'
       AND v.status = 'POSTED' AND (p_to IS NULL OR v.voucher_date <= p_to)
     ORDER BY v.voucher_date, v.sort, v.created_at, v.id, l.line_no
  LOOP
    amt := r.amt;
    how := 'memo';
    keys := public._nf_unit_keys(r.memo, v_pfx);
    IF cardinality(keys) = 0 THEN
      refs := public._nf_voucher_refs(r.memo, v_pfx);
      IF cardinality(refs) > 0 THEN
        how := 'voucher named in memo';
        SELECT COALESCE(array_agg(DISTINCT kk), '{}') INTO keys
          FROM public.nf_vouchers v2,
               LATERAL unnest(public._nf_unit_keys(v2.narration, v_pfx)) AS kk
         WHERE v2.company_id = p_company_id AND v2.status = 'POSTED'
           AND (v2.manual_no = ANY (refs) OR v2.voucher_no = ANY (refs));
      END IF;
    END IF;
    IF cardinality(keys) = 0 THEN
      how := 'narration';
      keys := public._nf_unit_keys(r.narration, v_pfx);
    END IF;
    IF cardinality(keys) = 0 AND public._nf_is_placeholder_party(r.pname) THEN
      how := 'party name';
      keys := public._nf_unit_keys(r.pname, v_pfx);
    END IF;

    -- the memo's numbers; else the narration's, but only when it names ONE
    -- ("Token #138 and #139 … Token #140 …" belongs to several legs)
    leg_nos := public._nf_receipt_nos(r.memo);
    IF cardinality(leg_nos) = 0 AND cardinality(public._nf_receipt_nos(r.narration)) = 1 THEN
      leg_nos := public._nf_receipt_nos(r.narration);
    END IF;

    n := cardinality(keys);
    IF n = 0 THEN
      leg_id := r.id; voucher_id := r.vid; voucher_no := r.vno; system_no := r.sysno; voucher_date := r.vdate; vsort := r.vs;
      line_no := r.ln; party_id := r.pid; party := r.pname;
      placeholder := public._nf_is_placeholder_party(r.pname);
      ukey := NULL; amount := amt; nos := leg_nos; src := 'no unit named';
      RETURN NEXT;
      CONTINUE;
    END IF;

    each_amt := NULLIF(replace(substring(COALESCE(r.memo, '') FROM '([0-9][0-9,]*)\s*each'), ',', ''), '')::numeric;
    IF each_amt IS NULL OR each_amt * n <> abs(amt) THEN each_amt := NULL; END IF;
    base := floor(abs(amt) / n);

    i := 0;
    FOREACH k IN ARRAY keys LOOP
      i := i + 1;
      IF n = 1 THEN share := abs(amt);
      ELSIF each_amt IS NOT NULL THEN share := each_amt;
      ELSIF i = 1 THEN share := abs(amt) - base * (n - 1);
      ELSE share := base;
      END IF;
      leg_id := r.id; voucher_id := r.vid; voucher_no := r.vno; system_no := r.sysno; voucher_date := r.vdate; vsort := r.vs;
      line_no := r.ln; party_id := r.pid; party := r.pname;
      placeholder := public._nf_is_placeholder_party(r.pname);
      ukey := k; amount := sign(amt) * share; nos := leg_nos;
      src := how || CASE WHEN n = 1 THEN '' WHEN each_amt IS NOT NULL THEN ', each' ELSE ', split equally' END;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END
$function$;

-- ── 21150: open items per party ──────────────────────────────────────────
-- A leg whose MEMO names other legs (their voucher number, or their token
-- number) and exactly cancels them, for the same party, clears them. The
-- named legs may sit before or after it (a JV can sort before the receipt
-- it allocates on the same day). What is left per party adds up to that
-- party's balance.
CREATE OR REPLACE FUNCTION public._nf_unallocated_open(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pfx text[];
  ids uuid[]; vids uuid[]; pids text[]; amts numeric[]; vnos text[]; nosx text[]; cleared boolean[];
  rec record; a int; b int; n int;
  refs text[]; anos int[]; s numeric; pick int[];
  v_out jsonb;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT substring(v.voucher_no FROM '^([A-Z]+)-')), '{}') INTO v_pfx
    FROM public.nf_vouchers v WHERE v.company_id = p_company_id AND v.voucher_no ~ '^[A-Z]+-';

  SELECT array_agg(l.id ORDER BY v.voucher_date, v.sort, v.created_at, v.id, l.line_no),
         array_agg(v.id ORDER BY v.voucher_date, v.sort, v.created_at, v.id, l.line_no),
         array_agg(COALESCE(l.party_id::text, '') ORDER BY v.voucher_date, v.sort, v.created_at, v.id, l.line_no),
         array_agg(COALESCE(l.credit, 0) - COALESCE(l.debit, 0) ORDER BY v.voucher_date, v.sort, v.created_at, v.id, l.line_no),
         array_agg(COALESCE(NULLIF(btrim(v.manual_no), ''), '') || '~' || v.voucher_no ORDER BY v.voucher_date, v.sort, v.created_at, v.id, l.line_no),
         array_agg(',' || array_to_string(CASE WHEN cardinality(public._nf_receipt_nos(l.memo)) > 0
                                               THEN public._nf_receipt_nos(l.memo)
                                               ELSE public._nf_receipt_nos(v.narration) END, ',') || ','
                   ORDER BY v.voucher_date, v.sort, v.created_at, v.id, l.line_no)
    INTO ids, vids, pids, amts, vnos, nosx
    FROM public.nf_voucher_legs l
    JOIN public.nf_vouchers v ON v.id = l.voucher_id
   WHERE l.company_id = p_company_id AND l.account_code = '21150' AND v.status = 'POSTED'
     AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to);

  n := COALESCE(array_length(ids, 1), 0);
  cleared := array_fill(false, ARRAY[GREATEST(n, 1)]);

  FOR a IN 1 .. n LOOP
    CONTINUE WHEN cleared[a];
    SELECT memo INTO rec FROM public.nf_voucher_legs WHERE id = ids[a];
    refs := public._nf_voucher_refs(rec.memo, v_pfx);
    anos := public._nf_receipt_nos(rec.memo);
    CONTINUE WHEN cardinality(refs) = 0 AND cardinality(anos) = 0;
    pick := '{}'; s := 0;
    FOR b IN 1 .. n LOOP
      CONTINUE WHEN b = a OR cleared[b] OR pids[b] <> pids[a] OR sign(amts[b]) = sign(amts[a]) OR vids[b] = vids[a];
      IF (split_part(vnos[b], '~', 1) <> '' AND split_part(vnos[b], '~', 1) = ANY (refs))
         OR split_part(vnos[b], '~', 2) = ANY (refs)
         OR EXISTS (SELECT 1 FROM unnest(anos) q WHERE nosx[b] LIKE '%,' || q || ',%') THEN
        pick := pick || b; s := s + amts[b];
      END IF;
    END LOOP;
    IF cardinality(pick) > 0 AND s + amts[a] = 0 THEN
      cleared[a] := true;
      FOREACH b IN ARRAY pick LOOP cleared[b] := true; END LOOP;
    END IF;
  END LOOP;

  WITH legs AS (
    SELECT o, ids[o] AS id, cleared[o] AS done FROM generate_series(1, n) AS o
  ), items AS (
    SELECT l.party_id, pt.name AS party, v.voucher_date, COALESCE(NULLIF(btrim(v.manual_no), ''), v.voucher_no) AS vno,
           v.voucher_no AS sys_no, v.narration, l.memo,
           COALESCE(l.credit, 0) - COALESCE(l.debit, 0) AS amt, x.o
      FROM legs x
      JOIN public.nf_voucher_legs l ON l.id = x.id
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
     WHERE NOT x.done
  ), parties AS (
    SELECT party_id, COALESCE(max(party), '(no party)') AS party, sum(amt) AS amount, max(voucher_date) AS last_date,
           jsonb_agg(jsonb_build_object('date', voucher_date, 'voucher_no', vno, 'system_no', sys_no,
                       'narration', narration, 'memo', memo, 'amount', amt) ORDER BY o) AS items
      FROM items GROUP BY party_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('party', party, 'amount', amount, 'last_date', last_date,
                                               'placeholder', public._nf_is_placeholder_party(party), 'items', items)
                            ORDER BY amount DESC, party), '[]'::jsonb)
    INTO v_out FROM parties WHERE amount <> 0;
  RETURN v_out;
END
$function$;

-- ── Fix 1: the Unit-wise Token Ledger body ───────────────────────────────
CREATE OR REPLACE FUNCTION public._nf_token_ledger_body(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH a AS (
    SELECT * FROM public._nf_token_alloc(p_company_id, p_to)
     WHERE p_from IS NULL OR voucher_date >= p_from
  ),
  ul AS (   -- the company's RMS units, keyed the same way
    SELECT DISTINCT ON (k) k, u.id AS unit_id, u.unit_no,
           COALESCE(NULLIF(u.floor_label, ''), 'Floor ' || COALESCE(u.floor_no::text, '-')) AS floor,
           COALESCE(f.sort_order, u.floor_no, 999) AS fsort
      FROM public.units u
      JOIN public.projects p ON p.id = u.project_id AND p.company_id = p_company_id
      LEFT JOIN public.floors f ON f.id = u.floor_id
      CROSS JOIN LATERAL (SELECT public._nf_unit_no_key(u.unit_no) AS k) kk
     WHERE kk.k IS NOT NULL
     ORDER BY k, u.created_at
  ),
  res AS (  -- the received token on each unit's active reservation (as _token_report_body counts it)
    SELECT ul.k, sum(r.token_amount) AS token
      FROM ul JOIN public.reservations r ON r.unit_id = ul.unit_id
     WHERE r.status = 'active' AND r.token_received AND COALESCE(r.token_amount, 0) > 0
     GROUP BY ul.k
  ),
  pv AS (   -- per unit per voucher, netted (a JV that only renames the buyer nets to 0)
    SELECT ukey, voucher_id, min(voucher_no) AS vno, min(system_no) AS sno, min(voucher_date) AS d, min(vsort) AS vs,
           sum(amount) AS amt,
           string_agg(DISTINCT party, ', ') AS parties, min(src) AS src
      FROM a WHERE ukey IS NOT NULL GROUP BY ukey, voucher_id
  ),
  buyer AS (
    SELECT DISTINCT ON (ukey) ukey, party
      FROM a WHERE ukey IS NOT NULL AND amount > 0 AND NOT placeholder AND party IS NOT NULL
     ORDER BY ukey, vsort DESC, line_no DESC
  ),
  nos AS (
    SELECT ukey, string_agg('#' || nn, ', ' ORDER BY nn) AS nos
      FROM (SELECT DISTINCT ukey, unnest(nos) AS nn FROM a WHERE ukey IS NOT NULL AND amount > 0) z
     GROUP BY ukey
  ),
  per AS (
    SELECT ukey,
           min(d) AS first_date, max(d) AS last_date,
           COALESCE(sum(amt) FILTER (WHERE amt > 0), 0) AS received,
           COALESCE(-sum(amt) FILTER (WHERE amt < 0), 0) AS returned,
           sum(amt) AS net,
           jsonb_agg(jsonb_build_object('date', d, 'voucher_no', vno, 'system_no', sno, 'party', parties, 'amount', amt, 'how', src)
                     ORDER BY vs) FILTER (WHERE amt <> 0) AS lines
      FROM pv GROUP BY ukey
  ),
  rows_ AS (
    SELECT COALESCE(per.ukey, res.k) AS ukey, ul.unit_no, ul.floor, ul.fsort,
           per.first_date, per.last_date,
           COALESCE(per.received, 0) AS received, COALESCE(per.returned, 0) AS returned,
           COALESCE(per.net, 0) AS net,
           COALESCE(res.token, 0) AS res_token,
           buyer.party AS buyer, nos.nos, COALESCE(per.lines, '[]'::jsonb) AS lines
      FROM per
      FULL JOIN res ON res.k = per.ukey
      LEFT JOIN ul ON ul.k = COALESCE(per.ukey, res.k)
      LEFT JOIN buyer ON buyer.ukey = per.ukey
      LEFT JOIN nos ON nos.ukey = per.ukey
  ),
  gl AS (
    SELECT COALESCE(sum(COALESCE(l.credit, 0) - COALESCE(l.debit, 0)) FILTER (WHERE l.account_code = '21100'), 0) AS t21100,
           COALESCE(sum(COALESCE(l.credit, 0) - COALESCE(l.debit, 0)) FILTER (WHERE l.account_code = '21150'), 0) AS t21150
      FROM public.nf_voucher_legs l JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id AND l.account_code IN ('21100', '21150') AND v.status = 'POSTED'
       AND (p_from IS NULL OR v.voucher_date >= p_from) AND (p_to IS NULL OR v.voucher_date <= p_to)
  ),
  nounit AS (
    SELECT COALESCE(sum(amount), 0) AS net,
           COALESCE(jsonb_agg(jsonb_build_object('date', voucher_date, 'voucher_no', voucher_no, 'system_no', system_no, 'party', party, 'amount', amount)
                     ORDER BY vsort, line_no), '[]'::jsonb) AS lines
      FROM a WHERE ukey IS NULL
  ),
  unal AS (SELECT public._nf_unallocated_open(p_company_id, p_from, p_to) AS parties)
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'compare_reservations', p_from IS NULL,
    'units', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'unit_code', unit_no, 'floor', floor, 'buyer', buyer, 'tokens', nos,
               'first_date', first_date, 'last_date', last_date,
               'received', received, 'returned', returned, 'net', net,
               'reservation_token', CASE WHEN p_from IS NULL THEN res_token END,
               'difference', CASE WHEN p_from IS NULL THEN net - res_token END,
               'note', CASE
                 WHEN p_from IS NOT NULL OR net = res_token THEN NULL
                 WHEN res_token = 0 AND net <> 0 THEN 'No received token on an active reservation for this unit'
                 WHEN net = 0 THEN 'Reservation shows a received token, the books show none'
                 WHEN abs(net - res_token) <= 10 AND lines::text LIKE '%split equally%'
                   THEN 'Rupee rounding: a receipt shared by several units was split equally here, differently on the reservations'
                 ELSE 'Books and reservation differ' END,
               'lines', lines)
               ORDER BY fsort, COALESCE(NULLIF(substring(unit_no FROM '([0-9]+)'), '')::int, 0), unit_no)
             FROM rows_ WHERE unit_no IS NOT NULL AND (net <> 0 OR res_token <> 0 OR received <> 0)), '[]'::jsonb),
    'not_in_unit_list', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'unit_code', split_part(ukey, '|', 1) || '-' || split_part(ukey, '|', 2)
                            || CASE WHEN split_part(ukey, '|', 3) <> '' THEN '-' || split_part(ukey, '|', 3) ELSE '' END,
               'buyer', buyer, 'tokens', nos, 'first_date', first_date, 'last_date', last_date,
               'received', received, 'returned', returned, 'net', net, 'lines', lines)
               ORDER BY ukey)
             FROM rows_ WHERE unit_no IS NULL), '[]'::jsonb),
    'no_unit', (SELECT jsonb_build_object('net', net, 'lines', lines) FROM nounit),
    'not_allocated', (SELECT parties FROM unal),
    'totals', jsonb_build_object(
       'units', (SELECT count(*) FROM rows_ WHERE unit_no IS NOT NULL AND net <> 0),
       'units_net', (SELECT COALESCE(sum(net), 0) FROM rows_ WHERE unit_no IS NOT NULL),
       'not_in_unit_list_net', (SELECT COALESCE(sum(net), 0) FROM rows_ WHERE unit_no IS NULL),
       'no_unit_net', (SELECT net FROM nounit),
       'unit_net_total', (SELECT COALESCE(sum(amount), 0) FROM a),
       'not_allocated_total', (SELECT COALESCE(sum((x->>'amount')::numeric), 0) FROM unal, jsonb_array_elements(unal.parties) x),
       'gl_21100', (SELECT t21100 FROM gl),
       'gl_21150', (SELECT t21150 FROM gl),
       'received', (SELECT COALESCE(sum(received), 0) FROM rows_),
       'returned', (SELECT COALESCE(sum(returned), 0) FROM rows_),
       'reservations', CASE WHEN p_from IS NULL THEN (SELECT COALESCE(sum(res_token), 0) FROM rows_) END,
       'units_off', CASE WHEN p_from IS NULL THEN (SELECT count(*) FROM rows_ WHERE unit_no IS NOT NULL AND net <> res_token) END));
$function$;

-- Same name and signature as before, so the screen and its grants stay.
CREATE OR REPLACE FUNCTION public.nf_get_token_register(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  RETURN public._nf_token_ledger_body(p_company_id, p_from, p_to);
END
$function$;

-- ── Fix 2: director summary ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nf_director_summary(p_company_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
  v_as_of date := COALESCE(p_as_of, (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_m_from date := date_trunc('month', COALESCE(p_as_of, (now() AT TIME ZONE 'Asia/Karachi')::date))::date;
  v_ledger jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  v_ledger := public._nf_token_ledger_body(p_company_id, NULL, v_as_of);

  WITH posted AS (
    SELECT l.voucher_id, l.account_code, l.party_id, l.debit, l.credit, v.voucher_date
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id
       AND v.status = 'POSTED'
       AND v.voucher_date <= v_as_of
  ),
  -- a voucher that only moves money between our own cash/bank accounts is a
  -- transfer, not money coming in or going out
  moneybox AS (
    SELECT code FROM public.nf_accounts
     WHERE company_id = p_company_id AND via IS NOT NULL
  ),
  transfers AS (
    SELECT voucher_id FROM posted
     GROUP BY voucher_id
    HAVING bool_and(account_code IN (SELECT code FROM moneybox))
  ),
  cost AS (
    SELECT a.parent_code, a.code, a.name, sum(p.debit - p.credit) AS amount
      FROM posted p JOIN public.nf_accounts a
        ON a.company_id = p_company_id AND a.code = p.account_code
     WHERE left(a.code, 1) = '5'
     GROUP BY a.parent_code, a.code, a.name
    HAVING sum(p.debit - p.credit) <> 0
  ),
  -- token money per voucher across 21100 + 21150: a voucher that takes money
  -- OUT of both is a refund; one that only moves it between buyers, units or
  -- the two accounts nets to 0 and is not
  tokvouch AS (
    SELECT voucher_id, sum(credit - debit) AS net
      FROM posted WHERE account_code IN ('21100', '21150')
     GROUP BY voucher_id
  ),
  tokparty AS (
    SELECT p.party_id
      FROM posted p JOIN public.nf_parties pt ON pt.company_id = p_company_id AND pt.id = p.party_id
     WHERE p.account_code = '21100' AND NOT public._nf_is_placeholder_party(pt.name)
     GROUP BY p.party_id
    HAVING sum(p.credit - p.debit) <> 0
  )
  SELECT jsonb_build_object(
    'as_of', v_as_of,

    'spent_on_project', COALESCE((SELECT sum(amount) FROM cost), 0),
    'spent_breakdown', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('code', code, 'label', name, 'amount', amount)
                        ORDER BY amount DESC) FROM cost), '[]'::jsonb),
    'office_expenses', COALESCE((
       SELECT sum(p.debit - p.credit) FROM posted p
        JOIN public.nf_accounts a ON a.company_id = p_company_id AND a.code = p.account_code
        WHERE left(a.code, 1) IN ('6','7','8')), 0),

    'money_with_us', COALESCE((
       SELECT sum(p.debit - p.credit) FROM posted p
        WHERE p.account_code IN (SELECT code FROM moneybox)), 0),
    'owed_to_group', COALESCE((
       SELECT sum(p.credit - p.debit) FROM posted p
        JOIN public.nf_accounts a ON a.company_id = p_company_id AND a.code = p.account_code
        WHERE a.parent_code = '22000'), 0),
    'due_from_directors', COALESCE((
       SELECT sum(p.debit - p.credit) FROM posted p
        JOIN public.nf_accounts a ON a.company_id = p_company_id AND a.code = p.account_code
        WHERE a.parent_code = '12600'), 0),

    'tokens', jsonb_build_object(
       'held', COALESCE((SELECT sum(p.credit - p.debit) FROM posted p
                          WHERE p.account_code = '21100'), 0),
       'not_allocated', COALESCE((SELECT sum(p.credit - p.debit) FROM posted p
                          WHERE p.account_code = '21150'), 0),
       'total_held', COALESCE((SELECT sum(p.credit - p.debit) FROM posted p
                          WHERE p.account_code IN ('21100', '21150')), 0),
       'buyers', (SELECT count(*) FROM tokparty),
       'unit_bookings', (SELECT count(*) FROM jsonb_array_elements(v_ledger->'units') u
                          WHERE (u->>'net')::numeric > 0),
       'refunded', COALESCE((SELECT sum(-net) FROM tokvouch WHERE net < 0), 0)),

    'month', jsonb_build_object(
       'from', v_m_from, 'to', v_as_of,
       'received', COALESCE((SELECT sum(p.debit) FROM posted p
                              WHERE p.account_code IN (SELECT code FROM moneybox)
                                AND p.voucher_date >= v_m_from
                                AND p.voucher_id NOT IN (SELECT voucher_id FROM transfers)), 0),
       'paid', COALESCE((SELECT sum(p.credit) FROM posted p
                          WHERE p.account_code IN (SELECT code FROM moneybox)
                            AND p.voucher_date >= v_m_from
                            AND p.voucher_id NOT IN (SELECT voucher_id FROM transfers)), 0))
  ) INTO v_out;

  RETURN v_out;
END
$function$;

-- ── Fix 3: other balances, with 21150 ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nf_other_balances(p_company_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
  v_as_of date := COALESCE(p_as_of, (now() AT TIME ZONE 'Asia/Karachi')::date);
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  WITH posted AS (
    SELECT l.account_code, l.debit, l.credit
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id
       AND v.status = 'POSTED'
       AND v.voucher_date <= v_as_of
  ), bal AS (
    SELECT a.code, a.name, a.parent_code,
           COALESCE(sum(p.debit - p.credit), 0) AS net_debit
      FROM public.nf_accounts a
      LEFT JOIN posted p ON p.account_code = a.code
     WHERE a.company_id = p_company_id
       AND a.code IN ('12610','12620','22100','22200','22300','22400','21100','21150')
     GROUP BY a.code, a.name, a.parent_code
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY grp, code), '[]'::jsonb) INTO v_out
  FROM (
    SELECT 1 AS grp, code,
           jsonb_build_object('code', code,
             'label', 'Owed to ' || name || ' (payable)',
             'amount', -net_debit) AS row
      FROM bal WHERE parent_code = '22000' AND net_debit <> 0
    UNION ALL
    SELECT 2, code,
           jsonb_build_object('code', code,
             'label', 'Due from ' || name || ' — given by Awami, to be recovered',
             'amount', net_debit)
      FROM bal WHERE parent_code = '12600' AND net_debit <> 0
    UNION ALL
    SELECT 3, code,
           jsonb_build_object('code', code,
             'label', 'Customer token money held — refundable if a deal is cancelled',
             'amount', -net_debit)
      FROM bal WHERE code = '21100' AND net_debit <> 0
    UNION ALL
    SELECT 4, code,
           jsonb_build_object('code', code,
             'label', 'Token money received, not yet allocated to a unit or buyer',
             'amount', -net_debit)
      FROM bal WHERE code = '21150' AND net_debit <> 0
  ) x;
  RETURN v_out;
END
$function$;

-- ── New A: Receipt / Token Number Register ───────────────────────────────
CREATE OR REPLACE FUNCTION public.nf_get_receipt_register(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pfx text[];
  v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  SELECT COALESCE(array_agg(DISTINCT substring(v.voucher_no FROM '^([A-Z]+)-')), '{}') INTO v_pfx
    FROM public.nf_vouchers v WHERE v.company_id = p_company_id AND v.voucher_no ~ '^[A-Z]+-';

  WITH legs AS (
    SELECT l.id, l.voucher_id, v.voucher_no, NULLIF(btrim(v.manual_no), '') AS manual_no,
           v.voucher_date, v.narration, l.memo, l.line_no, l.account_code,
           COALESCE(l.credit, 0) - COALESCE(l.debit, 0) AS amt, pt.name AS party,
           row_number() OVER (ORDER BY v.voucher_date, v.sort, v.created_at, v.id, l.line_no) AS ord
      FROM public.nf_voucher_legs l
      JOIN public.nf_vouchers v ON v.id = l.voucher_id
      LEFT JOIN public.nf_parties pt ON pt.company_id = l.company_id AND pt.id = l.party_id
     WHERE l.company_id = p_company_id AND l.account_code IN ('21100', '21150') AND v.status = 'POSTED'
       AND (p_to IS NULL OR v.voucher_date <= p_to)
  ),
  vouch AS (
    SELECT voucher_id, min(voucher_no) AS voucher_no, min(manual_no) AS manual_no, min(voucher_date) AS d,
           min(narration) AS narration, sum(amt) AS net, min(ord) AS ord
      FROM legs GROUP BY voucher_id
  ),
  -- money that came INTO token money from outside: a token receipt
  rcpt AS (
    SELECT vo.*, COALESCE(vo.manual_no, vo.voucher_no) AS vno,
           COALESCE(
             (public._nf_receipt_nos(vo.narration))[1],
             (SELECT (public._nf_receipt_nos(l.memo))[1] FROM legs l
               WHERE l.voucher_id = vo.voucher_id AND cardinality(public._nf_receipt_nos(l.memo)) > 0
               ORDER BY l.line_no LIMIT 1)) AS own_no,
           ARRAY(SELECT k FROM unnest(
                   CASE WHEN cardinality(public._nf_unit_keys(vo.narration, v_pfx)) > 0
                        THEN public._nf_unit_keys(vo.narration, v_pfx)
                        ELSE ARRAY(SELECT DISTINCT a.ukey FROM public._nf_token_alloc(p_company_id, p_to) a
                                    WHERE a.voucher_id = vo.voucher_id AND a.ukey IS NOT NULL) END) k
                 ORDER BY k) AS ukeys,
           (SELECT string_agg(DISTINCT l.party, ', ') FROM legs l
             WHERE l.voucher_id = vo.voucher_id AND l.amt > 0 AND NOT public._nf_is_placeholder_party(l.party)) AS own_buyer
      FROM vouch vo
     WHERE vo.net > 0
  ),
  -- later vouchers that only move token money (net 0) and name a number
  moves AS (
    SELECT l.*, (public._nf_receipt_nos(l.memo))[1] AS no1,
           public._nf_receipt_nos(l.memo) AS allnos,
           public._nf_voucher_refs(l.memo, v_pfx) AS refs,
           ARRAY(SELECT k FROM unnest(public._nf_unit_keys(l.memo, v_pfx)) k ORDER BY k) AS ukeys
      FROM legs l JOIN vouch vo ON vo.voucher_id = l.voucher_id
     WHERE vo.net <= 0 AND l.amt > 0
  ),
  by_ref AS (   -- "Receipt #146 — LG-56/99 (BRV-0013)"
    SELECT DISTINCT ON (r.voucher_id) r.voucher_id, m.no1, m.party, COALESCE(m.manual_no, m.voucher_no) AS via
      FROM rcpt r JOIN moves m ON m.no1 IS NOT NULL
       AND (r.manual_no = ANY (m.refs) OR r.voucher_no = ANY (m.refs))
     ORDER BY r.voucher_id, m.ord DESC
  ),
  by_units AS ( -- "Receipt #151 Ishtiaq — GF-51/52/53/54": the same units, no number yet
    SELECT DISTINCT ON (r.voucher_id) r.voucher_id, m.no1, m.party, COALESCE(m.manual_no, m.voucher_no) AS via
      FROM rcpt r JOIN moves m ON m.no1 IS NOT NULL AND cardinality(m.refs) = 0
       AND cardinality(m.ukeys) > 0 AND m.ukeys = r.ukeys AND m.voucher_date >= r.d
     WHERE r.own_no IS NULL AND NOT EXISTS (SELECT 1 FROM by_ref b WHERE b.voucher_id = r.voucher_id)
     ORDER BY r.voucher_id, m.ord
  ),
  numbered AS (
    SELECT r.*,
           COALESCE(br.no1, r.own_no, bu.no1) AS no,
           COALESCE(br.via, CASE WHEN r.own_no IS NULL THEN bu.via END) AS via,
           NULLIF(concat_ws(', ', r.own_buyer,
                    CASE WHEN br.no1 IS NOT NULL AND NOT public._nf_is_placeholder_party(br.party) THEN br.party END,
                    CASE WHEN br.no1 IS NULL AND r.own_no IS NULL AND NOT public._nf_is_placeholder_party(bu.party) THEN bu.party END), '') AS buyer_raw
      FROM rcpt r
      LEFT JOIN by_ref br ON br.voucher_id = r.voucher_id
      LEFT JOIN by_units bu ON bu.voucher_id = r.voucher_id
  ),
  inrange AS (
    SELECT * FROM numbered WHERE p_from IS NULL OR d >= p_from
  ),
  -- names given later for a number ("Token #140 buyer confirmed: Abdul Qahar")
  later_names AS (
    SELECT DISTINCT q AS no, m.party
      FROM moves m, unnest(m.allnos) q
     WHERE NOT public._nf_is_placeholder_party(m.party) AND m.party IS NOT NULL
  ),
  buyers AS (
    SELECT no, string_agg(DISTINCT b, ', ' ORDER BY b) AS buyers, count(DISTINCT b) AS nb
      FROM (
        SELECT i.no, btrim(x) AS b FROM inrange i, unnest(string_to_array(i.buyer_raw, ',')) x WHERE i.no IS NOT NULL
        UNION
        SELECT ln.no, ln.party FROM later_names ln WHERE ln.no IN (SELECT no FROM inrange WHERE no IS NOT NULL)
      ) z WHERE b IS NOT NULL AND b <> ''
     GROUP BY no
  ),
  -- buyers per voucher, for the duplicate test: the same number on two
  -- vouchers that belong to different buyers
  vbuy AS (
    SELECT i.no, i.voucher_id, btrim(x) AS b
      FROM inrange i, unnest(string_to_array(COALESCE(i.buyer_raw, ''), ',')) x
     WHERE i.no IS NOT NULL AND btrim(x) <> ''
  ),
  dup AS (
    SELECT no FROM inrange WHERE no IS NOT NULL GROUP BY no
    HAVING count(DISTINCT voucher_id) > 1
       AND (SELECT count(DISTINCT b) FROM vbuy WHERE vbuy.no = inrange.no) > 1
  ),
  ul AS (
    SELECT DISTINCT ON (k) k, u.unit_no
      FROM public.units u JOIN public.projects p ON p.id = u.project_id AND p.company_id = p_company_id
      CROSS JOIN LATERAL (SELECT public._nf_unit_no_key(u.unit_no) AS k) kk
     WHERE kk.k IS NOT NULL ORDER BY k, u.created_at
  ),
  per_no AS (
    SELECT i.no, min(i.d) AS first_date, max(i.d) AS last_date,
           jsonb_agg(jsonb_build_object('voucher_no', i.vno, 'system_no', i.voucher_no, 'date', i.d,
                                        'amount', i.net, 'via', i.via) ORDER BY i.ord) AS vouchers,
           sum(i.net) AS amount,
           (SELECT string_agg(DISTINCT COALESCE(ul.unit_no,
                      split_part(uk.key, '|', 1) || '-' || split_part(uk.key, '|', 2)
                      || CASE WHEN split_part(uk.key, '|', 3) <> '' THEN '-' || split_part(uk.key, '|', 3) ELSE '' END), ', ')
              FROM inrange i2 CROSS JOIN LATERAL unnest(i2.ukeys) AS uk(key) LEFT JOIN ul ON ul.k = uk.key
             WHERE i2.no = i.no) AS units
      FROM inrange i WHERE i.no IS NOT NULL GROUP BY i.no
  ),
  span AS (SELECT min(no) AS lo, max(no) AS hi FROM per_no)
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'numbers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'no', p.no, 'first_date', p.first_date, 'last_date', p.last_date,
                 'vouchers', p.vouchers, 'buyer', b.buyers, 'units', p.units, 'amount', p.amount,
                 'duplicate', p.no IN (SELECT no FROM dup)) ORDER BY p.no)
               FROM per_no p LEFT JOIN buyers b ON b.no = p.no), '[]'::jsonb),
    'duplicates', COALESCE((SELECT jsonb_agg(no ORDER BY no) FROM dup), '[]'::jsonb),
    'gaps', COALESCE((SELECT jsonb_agg(g ORDER BY g) FROM span, generate_series(span.lo, span.hi) g
                      WHERE g NOT IN (SELECT no FROM per_no)), '[]'::jsonb),
    'lowest', (SELECT lo FROM span), 'highest', (SELECT hi FROM span),
    'no_number', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'voucher_no', i.vno, 'system_no', i.voucher_no, 'date', i.d, 'amount', i.net,
                   'buyer', i.own_buyer, 'narration', i.narration) ORDER BY i.ord)
                 FROM inrange i WHERE i.no IS NULL), '[]'::jsonb),
    'totals', jsonb_build_object(
       'receipts', (SELECT count(*) FROM inrange),
       'numbers', (SELECT count(*) FROM per_no),
       'amount', (SELECT COALESCE(sum(net), 0) FROM inrange),
       'no_number_amount', (SELECT COALESCE(sum(net), 0) FROM inrange WHERE no IS NULL)))
    INTO v_out;
  RETURN v_out;
END
$function$;

-- ── New B: Group & Related-party Balances ────────────────────────────────
-- Every account under 22000 (group companies) and 12600 (directors), shown
-- even when nil. Dr = given by the company, Cr = received by the company.
CREATE OR REPLACE FUNCTION public.nf_get_group_balances(p_company_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  WITH acc AS (
    SELECT a.code, a.name, a.parent_code,
           CASE WHEN a.parent_code = '22000' THEN 'group' ELSE 'director' END AS kind
      FROM public.nf_accounts a
     WHERE a.company_id = p_company_id AND a.parent_code IN ('22000', '12600')
  ), mv AS (
    SELECT l.account_code,
           COALESCE(sum(COALESCE(l.debit, 0) - COALESCE(l.credit, 0)) FILTER (WHERE p_from IS NOT NULL AND v.voucher_date < p_from), 0) AS opening,
           COALESCE(sum(COALESCE(l.debit, 0)) FILTER (WHERE p_from IS NULL OR v.voucher_date >= p_from), 0) AS given,
           COALESCE(sum(COALESCE(l.credit, 0)) FILTER (WHERE p_from IS NULL OR v.voucher_date >= p_from), 0) AS received
      FROM public.nf_voucher_legs l JOIN public.nf_vouchers v ON v.id = l.voucher_id
     WHERE l.company_id = p_company_id AND v.status = 'POSTED'
       AND (p_to IS NULL OR v.voucher_date <= p_to)
       AND l.account_code IN (SELECT code FROM acc)
     GROUP BY l.account_code
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'accounts', COALESCE(jsonb_agg(jsonb_build_object(
        'code', a.code, 'name', a.name, 'kind', a.kind,
        'opening', COALESCE(m.opening, 0),
        'given', COALESCE(m.given, 0), 'received', COALESCE(m.received, 0),
        -- + = they owe the company, − = the company owes them
        'closing', COALESCE(m.opening, 0) + COALESCE(m.given, 0) - COALESCE(m.received, 0))
      ORDER BY CASE a.kind WHEN 'group' THEN 1 ELSE 2 END, a.code), '[]'::jsonb))
    INTO v_out
    FROM acc a LEFT JOIN mv m ON m.account_code = a.code;
  RETURN v_out;
END
$function$;

-- ── grants ───────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._nf_is_unit_pfx(text, text[])            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._nf_unit_run(text[], int, text[])        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._nf_unit_keys(text, text[])              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._nf_receipt_nos(text)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._nf_voucher_refs(text, text[])           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._nf_is_placeholder_party(text)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._nf_unit_no_key(text)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._nf_token_alloc(uuid, date)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._nf_unallocated_open(uuid, date, date)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._nf_token_ledger_body(uuid, date, date)  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.nf_get_receipt_register(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nf_get_group_balances(uuid, date, date)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_get_receipt_register(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nf_get_group_balances(uuid, date, date)   TO authenticated;
-- nf_get_token_register, nf_director_summary, nf_other_balances: same
-- signatures, CREATE OR REPLACE keeps their existing grants.

COMMIT;
