-- ══ NexuFinance — Site Closing: fix for Stage 2's match function (found in Stage 3) ══
-- NOT APPLIED. Waiting for the owner's go.
--
-- The bug: _nf_site_match fills a column of its own temp table with
--   UPDATE _hv SET kind = CASE … END;
-- which has no WHERE. Run through the app (PostgREST), the safe-update guard refuses any
-- UPDATE / DELETE without a WHERE — inside a function too — so for a real signed-in user
--   * the site accountant's "Send to head office" (nf_site_submit -> match) fails, and
--   * head office's "Re-run match" (nf_site_match) fails,
-- both with "UPDATE requires a WHERE clause". Every earlier test ran through the
-- management channel, which has no such guard, so none of them could see it; the Stage 3
-- browser test, which goes through the app's own door, did.
--
-- The fix is "WHERE true" on that one statement. The function is otherwise byte-for-byte
-- 20261118a's. No grant, table or other function changes. Nobody holds the site role yet,
-- so no real user has met the bug.

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

REVOKE ALL ON FUNCTION public._nf_site_match(uuid) FROM PUBLIC, anon, authenticated;
