-- ══ NexuFinance: the day report's lines carry their head and token units (20261119g) ══
-- Applied 19-Nov-2026 (20261119104929) on the owner's yes.
--
-- Brief of 19-Nov (the one-page WhatsApp report): money in / out is summarised BY HEAD, and token money shows its
-- units in short ("Token money · GF-250/251, SF-208"). nf_day_report's received / paid rows gain 'head' (the
-- account's plain name), 'token' and 'units'. As the site box sees Head Office's lines: head "Head Office".
-- Nothing else changes.

CREATE OR REPLACE FUNCTION public.nf_day_report(p_company_id uuid, p_date date, p_view text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_view text := lower(COALESCE(NULLIF(btrim(p_view), ''), 'combined'));
  v_shown text[];
  v record; m record; h record; x record; o record;
  v_rec jsonb := '[]'; v_pay jsonb := '[]'; v_trf jsonb := '[]';
  v_box jsonb := '{}';
  v_for text; v_desc text; v_toks int[]; v_units text[]; v_chq text; v_by text;
  v_title text;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  IF p_date IS NULL THEN RAISE EXCEPTION 'NF:DATE_REQUIRED'; END IF;
  IF public.nf_member_cash_box(p_company_id) = 'Petty' THEN v_view := 'site'; END IF;   -- the site login: always Site
  IF v_view NOT IN ('site', 'ho', 'combined') THEN RAISE EXCEPTION 'NF:VIEW_UNKNOWN' USING DETAIL = v_view; END IF;
  v_shown := CASE v_view WHEN 'site' THEN ARRAY['Petty'] WHEN 'ho' THEN ARRAY['Cash', 'Bank'] ELSE ARRAY['Cash', 'Petty', 'Bank'] END;

  -- each shown box: its name and its balance before the date
  FOR x IN SELECT a.via, a.code, CASE a.via WHEN 'Bank' THEN 'BOP (bank)' ELSE COALESCE(a.via_label, a.name) END AS label,
                  COALESCE((SELECT sum(g.debit - g.credit) FROM public.nf_voucher_legs g JOIN public.nf_vouchers vv ON vv.id = g.voucher_id
                             WHERE g.company_id = p_company_id AND g.account_code = a.code AND vv.status = 'POSTED'
                               AND COALESCE(vv.real_date, vv.voucher_date) < p_date), 0) AS opening
             FROM public.nf_accounts a WHERE a.company_id = p_company_id AND a.via = ANY (v_shown) LOOP
    v_box := v_box || jsonb_build_object(x.via, jsonb_build_object('via', x.via, 'label', x.label, 'opening', x.opening,
                                                                   'received', 0, 'paid', 0, 'transfers', 0));
  END LOOP;

  FOR v IN SELECT vv.id, COALESCE(vv.manual_no, vv.voucher_no) AS no, vv.narration, mm.display_name AS by_name, mm.cash_via AS by_box
             FROM public.nf_vouchers vv LEFT JOIN public.nf_members mm ON mm.company_id = vv.company_id AND mm.user_id = vv.created_by
            WHERE vv.company_id = p_company_id AND vv.status = 'POSTED' AND COALESCE(vv.real_date, vv.voucher_date) = p_date
            ORDER BY vv.created_at, vv.sort LOOP
    v_by := CASE WHEN v.by_box = 'Petty' THEN v.by_name WHEN v.by_name IS NULL THEN 'Imported' ELSE 'Head Office' END;
    SELECT g.line_no, g.debit, g.credit, a.via, a.via_label INTO m
      FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
     WHERE g.voucher_id = v.id AND a.via IS NOT NULL ORDER BY g.line_no LIMIT 1;
    CONTINUE WHEN m.via IS NULL;                                     -- a JV moves no cash and no bank
    SELECT g.account_code, a.name, p.name AS party INTO h
      FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
      LEFT JOIN public.nf_parties p ON p.id = g.party_id
     WHERE g.voucher_id = v.id AND a.via IS NULL ORDER BY g.line_no LIMIT 1;

    IF h.account_code IS NULL THEN                                   -- a transfer: shown once, from → to
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                                 WHERE g.voucher_id = v.id AND a.via = ANY (v_shown));
      v_chq := (regexp_match(COALESCE(v.narration, ''), 'chq\s*#?\s*([0-9]{4,})', 'i'))[1];
      SELECT
        (SELECT CASE a.via WHEN 'Bank' THEN CASE WHEN v_view = 'site' THEN 'Head Office (BOP)' ELSE 'BOP (bank)' END ELSE COALESCE(a.via_label, a.name) END
           FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
          WHERE g.voucher_id = v.id AND g.credit > 0 ORDER BY g.line_no LIMIT 1) AS fr,
        (SELECT CASE a.via WHEN 'Bank' THEN CASE WHEN v_view = 'site' THEN 'Head Office (BOP)' ELSE 'BOP (bank)' END ELSE COALESCE(a.via_label, a.name) END
           FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
          WHERE g.voucher_id = v.id AND g.debit > 0 ORDER BY g.line_no LIMIT 1) AS too,
        (SELECT sum(g.debit) FROM public.nf_voucher_legs g WHERE g.voucher_id = v.id) AS amt
        INTO o;
      v_trf := v_trf || jsonb_build_object('no', v.no, 'by', v_by, 'from', o.fr, 'to', o.too, 'amount', o.amt,
                                           'cheque', CASE WHEN v_chq IS NOT NULL THEN right(v_chq, 4) END);
      FOR x IN SELECT a.via, g.debit - g.credit AS net FROM public.nf_voucher_legs g JOIN public.nf_accounts a ON a.company_id = g.company_id AND a.code = g.account_code
                WHERE g.voucher_id = v.id AND a.via = ANY (v_shown) LOOP
        v_box := jsonb_set(v_box, ARRAY[x.via, 'transfers'], to_jsonb((v_box->x.via->>'transfers')::numeric + x.net));
      END LOOP;
      CONTINUE;
    END IF;

    CONTINUE WHEN NOT (m.via = ANY (v_shown) OR (v_view = 'site' AND m.via = 'Bank' AND v.by_box = 'Petty'));
    IF h.account_code = '21100' THEN                                 -- a token: its number and unit(s)
      v_toks := public._nf_receipt_nos(v.narration);
      v_units := public._nf_units_in(v.narration);
      v_for := 'Token' || CASE WHEN cardinality(v_toks) > 0 THEN ' #' || array_to_string(v_toks, ', #') ELSE '' END
               || CASE WHEN cardinality(v_units) > 0 THEN ' · ' || array_to_string(v_units, ', ') ELSE '' END;
    ELSIF h.party IS NOT NULL AND (h.party = h.name OR position(h.party IN h.name) > 0) THEN
      v_for := split_part(COALESCE(v.narration, h.name), ' — ', 1);  -- the head IS the party (an advance): say what for
    ELSIF h.party IS NULL THEN
      -- no party: the head and a short description from the narration — its first part, without the trailing
      -- "(site cash, Sharose, 16-Nov)" / "(cash, 03-Nov)" and without "BOP chq #…" (owner, 19-Nov)
      v_desc := btrim(regexp_replace(regexp_replace(split_part(COALESCE(v.narration, ''), ' — ', 1),
                  '\s*\([^()]*\)\s*$', ''), ',?\s*(BOP\s+)?chq\.?\s*#?\s*[0-9]+.*$', '', 'i'));
      v_for := h.name || CASE WHEN v_desc <> '' AND lower(v_desc) <> lower(h.name) THEN ' · ' || v_desc ELSE '' END;
    ELSE
      v_for := h.name;
    END IF;
    IF m.debit > 0 THEN
      v_rec := v_rec || jsonb_build_object('no', v.no, 'by', v_by, 'party', h.party, 'for', v_for, 'head', h.name, 'token', h.account_code = '21100', 'units', CASE WHEN h.account_code = '21100' THEN to_jsonb(public._nf_units_in(v.narration)) ELSE '[]'::jsonb END, 'amount', m.debit, 'bank', m.via = 'Bank');
      IF m.via = ANY (v_shown) THEN v_box := jsonb_set(v_box, ARRAY[m.via, 'received'], to_jsonb((v_box->m.via->>'received')::numeric + m.debit)); END IF;
    ELSE
      v_pay := v_pay || jsonb_build_object('no', v.no, 'by', v_by, 'party', h.party, 'for', v_for, 'head', h.name, 'token', h.account_code = '21100', 'units', CASE WHEN h.account_code = '21100' THEN to_jsonb(public._nf_units_in(v.narration)) ELSE '[]'::jsonb END, 'amount', m.credit, 'bank', m.via = 'Bank');
      IF m.via = ANY (v_shown) THEN v_box := jsonb_set(v_box, ARRAY[m.via, 'paid'], to_jsonb((v_box->m.via->>'paid')::numeric + m.credit)); END IF;
    END IF;
  END LOOP;

  -- the site box: a line Head Office entered on Site Cash shows as amount only, a transfer as from / to Head Office (20261119e)
  IF public.nf_member_cash_box(p_company_id) = 'Petty' THEN
    v_rec := COALESCE((SELECT jsonb_agg(CASE WHEN e->>'by' = 'Head Office' THEN jsonb_build_object('no', '–', 'by', 'Head Office', 'party', NULL,
               'for', 'Received by Head Office into Site Cash', 'head', 'Head Office', 'token', false, 'units', '[]'::jsonb, 'amount', e->'amount', 'bank', e->'bank') ELSE e END) FROM jsonb_array_elements(v_rec) e), '[]');
    v_pay := COALESCE((SELECT jsonb_agg(CASE WHEN e->>'by' = 'Head Office' THEN jsonb_build_object('no', '–', 'by', 'Head Office', 'party', NULL,
               'for', 'Paid by Head Office from Site Cash', 'head', 'Head Office', 'token', false, 'units', '[]'::jsonb, 'amount', e->'amount', 'bank', e->'bank') ELSE e END) FROM jsonb_array_elements(v_pay) e), '[]');
    v_trf := COALESCE((SELECT jsonb_agg(CASE WHEN e->>'by' = 'Head Office' THEN jsonb_build_object('no', '–', 'by', 'Head Office',
               'from', CASE WHEN e->>'to' = 'Site Cash' THEN 'Head Office' ELSE 'Site Cash' END,
               'to', CASE WHEN e->>'to' = 'Site Cash' THEN 'Site Cash' ELSE 'Head Office' END, 'amount', e->'amount', 'cheque', NULL) ELSE e END)
               FROM jsonb_array_elements(v_trf) e), '[]');
  END IF;
  SELECT initcap(lower(split_part(COALESCE(s.book_title, COALESCE(c.display_name, c.company_name)), ' — ', 1))) INTO v_title
    FROM public.companies c LEFT JOIN public.nf_settings s ON s.company_id = c.id WHERE c.id = p_company_id;
  RETURN jsonb_build_object(
    'title', v_title || ' — Daily Closing', 'date', p_date, 'view', v_view,
    'view_name', CASE v_view WHEN 'site' THEN 'Site' WHEN 'ho' THEN 'Head Office' ELSE 'Combined' END,
    'boxes', (SELECT jsonb_agg(b || jsonb_build_object('closing', (b->>'opening')::numeric + (b->>'received')::numeric
                                                       - (b->>'paid')::numeric + (b->>'transfers')::numeric)
                               ORDER BY array_position(ARRAY['Cash', 'Petty', 'Bank'], b->>'via'))
                FROM jsonb_each(v_box) e(k, b)),
    'received', v_rec, 'paid', v_pay, 'transfers', v_trf,
    'prepared_by', public.nf_actor_name(p_company_id),
    'generated_at', now());
END $function$;
