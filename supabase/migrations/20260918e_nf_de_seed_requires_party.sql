-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · e · fix _nf_seed_company
--
-- Found post-apply, running verify-nf-rules.js: it creates a brand-new test
-- company via _nf_seed_company (the same function every real company is
-- seeded through), and every via-account (10100/10200/10300) came back
-- is_head=false — the seed JSON gen-seed.js builds now sets is_head
-- correctly (fixed in the same commit), but _nf_seed_company's INSERT into
-- nf_accounts never carried requires_party at all, so every freshly seeded
-- company's 21100/21200/21300 (Token Money and siblings) would silently
-- have NO party enforcement — inconsistent with Awami/ZZTEST-NF-DEMO,
-- whose requires_party was set by 20260918a's one-time UPDATE. This closes
-- that gap for every company seeded from here on.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._nf_seed_company(p_company_id uuid, p_seed jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
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
    INSERT INTO public.nf_accounts (company_id, code, name, qb_type, parent_code, description, is_head, via, via_label, sort, active, requires_party)
    VALUES (p_company_id, x->>'code', x->>'name', x->>'qb_type', x->>'parent_code', x->>'description',
            (x->>'is_head')::boolean, x->>'via', x->>'via_label', o, true,
            (x->>'code') IN ('21100', '21200', '21300'));
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
$function$;

COMMIT;
