-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · o · the real fix behind 20260918n's
-- grant revoke — an internal membership/role check inside the function
--
-- Owner, after approving 20260918n: "Revoking a grant is not the same as
-- fixing the function." Correct — 20260918n's REVOKE on nf_ledger_position,
-- nf_other_balances, nf_list_parties, nf_resolve_party and nf_account_path
-- only closed the door from the outside; none of the five ever checked who
-- was calling. The day a future report (a General Ledger needs
-- nf_ledger_position) re-grants `authenticated`, any signed-in user of any
-- tenant on this platform could call it against any company_id — the grant
-- would be the ONLY defence again, exactly the fragile state this project's
-- every other RPC avoids by calling nf_require_role first.
--
-- Fixed here, all five, same pattern nf_post_voucher/nf_save_line/every
-- other write RPC already uses: PERFORM public.nf_require_role(p_company_id,
-- ARRAY['accountant','director','viewer']) before touching any data.
--
-- Four of the five were LANGUAGE sql, which cannot call nf_require_role at
-- all (no PERFORM, no procedural statements) — that is WHY they had no
-- check to begin with, not an oversight in isolation. Converted to
-- LANGUAGE plpgsql to make the check possible; the query logic itself is
-- unchanged, just wrapped in BEGIN/RETURN. nf_ledger_position was already
-- plpgsql and only needed the PERFORM line added.
--
-- Consequence for two scripts that called nf_account_path / nf_ledger_position
-- directly via the Supabase Management API's raw-SQL endpoint (superuser
-- context, no JWT, auth.uid() reads NULL there): they would now get
-- NF:NOT_SIGNED_IN. scripts/nf/verify-nf-qb-accounts.js is fixed in this
-- same commit (inlines the same recursive CTE instead of calling the now-
-- guarded function). scripts/nf/verify-nf-de-migration.js also calls both —
-- that script is the pre-apply rehearsal for a migration already applied
-- 2026-09-18 and is not part of the routine verification loop; left as a
-- known, disclosed break rather than spending time restoring a script
-- whose job is already done, but not silently — flagged here and in the
-- handoff.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_account_path(p_company_id uuid, p_code text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE v_path text;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  WITH RECURSIVE up AS (
    SELECT code, name, parent_code, 0 AS depth FROM public.nf_accounts
     WHERE company_id = p_company_id AND code = p_code
    UNION ALL
    SELECT a.code, a.name, a.parent_code, up.depth + 1
      FROM public.nf_accounts a JOIN up ON a.code = up.parent_code
     WHERE a.company_id = p_company_id AND up.depth < 20
  )
  SELECT string_agg(name, ':' ORDER BY depth DESC) INTO v_path FROM up;
  RETURN v_path;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_resolve_party(p_company_id uuid, p_text text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  SELECT COALESCE(
    (SELECT id FROM public.nf_parties WHERE company_id = p_company_id
      AND normalized_name = lower(regexp_replace(btrim(p_text), '\s+', ' ', 'g'))),
    (SELECT party_id FROM public.nf_party_aliases WHERE company_id = p_company_id
      AND normalized_alias = lower(regexp_replace(btrim(p_text), '\s+', ' ', 'g'))))
    INTO v_id;
  RETURN v_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_list_parties(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'kind', p.kind, 'is_active', p.is_active,
           'aliases', COALESCE((SELECT jsonb_agg(a.alias ORDER BY a.alias) FROM public.nf_party_aliases a
                                  WHERE a.party_id = p.id), '[]'::jsonb))
         ORDER BY p.name), '[]'::jsonb)
    INTO v_out
    FROM public.nf_parties p
   WHERE p.company_id = p_company_id;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_other_balances(p_company_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  WITH bal AS (
    SELECT a.code, a.name, a.parent_code,
           COALESCE(sum(l.debit - l.credit), 0) AS net_debit
      FROM public.nf_accounts a
      LEFT JOIN public.nf_voucher_legs l ON l.company_id = a.company_id AND l.account_code = a.code
      LEFT JOIN public.nf_vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' AND v.voucher_date <= p_as_of
     WHERE a.company_id = p_company_id AND a.code IN ('12610','12620','22100','22200','22300','22400','21100')
     GROUP BY a.code, a.name, a.parent_code
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY grp, code), '[]'::jsonb) INTO v_out FROM (
    SELECT 1 AS grp, code, jsonb_build_object('code', code, 'label', 'Owed to ' || name || ' (payable)', 'amount', -net_debit) AS row
      FROM bal WHERE parent_code = '22000' AND net_debit <> 0
    UNION ALL
    SELECT 2, code, jsonb_build_object('code', code, 'label', 'Due from ' || name || ' — given by Awami, to be recovered', 'amount', net_debit)
      FROM bal WHERE parent_code = '12600' AND net_debit <> 0
    UNION ALL
    SELECT 3, code, jsonb_build_object('code', code, 'label', 'Customer token money held — refundable if a deal is cancelled', 'amount', -net_debit)
      FROM bal WHERE code = '21100' AND net_debit <> 0
  ) x;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.nf_ledger_position(p_company_id uuid, p_before_date date,
  OUT cash numeric, OUT petty numeric, OUT bank numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE g public.nf_days;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  SELECT * INTO g FROM public.nf_days WHERE company_id = p_company_id AND is_first_day;
  IF NOT FOUND THEN
    cash := 0; petty := 0; bank := 0; RETURN;
  END IF;

  SELECT g.typed_open_cash  + COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.via = 'Cash'),  0),
         g.typed_open_petty + COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.via = 'Petty'), 0),
         g.typed_open_bank  + COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.via = 'Bank'),  0)
    INTO cash, petty, bank
    FROM public.nf_voucher_legs l
    JOIN public.nf_vouchers v ON v.id = l.voucher_id
    JOIN public.nf_accounts a ON a.company_id = l.company_id AND a.code = l.account_code
   WHERE l.company_id = p_company_id AND v.status = 'POSTED' AND a.via IS NOT NULL
     AND v.voucher_date >= g.business_date AND v.voucher_date < p_before_date;
END
$function$;

COMMIT;
