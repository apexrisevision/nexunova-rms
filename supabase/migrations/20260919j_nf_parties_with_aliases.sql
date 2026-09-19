-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19j · Party aliases in
-- nf_list_all_parties (search-first party field, part 2)
--
-- NOT YET APPLIED — awaiting explicit go-ahead. Changes an existing
-- function's output shape (nf-party-statement.js already calls it),
-- one of the standing always-ask conditions.
--
-- The owner's own design requirement for the party field that follows
-- this: search matches existing parties AND their aliases, "add new"
-- only offered after a search has visibly returned nothing — otherwise
-- the party master splits into "Abdullah"/"Abdullah LG-03"/"abdullah"
-- within a week and every party-wise report silently fractures that
-- customer's balance. Client-side substring search against name is
-- already possible from nf_list_all_parties as it stands; matching
-- aliases too needs the aliases themselves, which it never returned.
-- 18 real parties for Awami today, 0 aliases currently — small enough
-- that returning every alias per party and filtering client-side is
-- the right shape, no separate search RPC needed.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nf_list_all_parties(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director','viewer']);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'kind', p.kind,
           'aliases', COALESCE((SELECT jsonb_agg(pa.alias ORDER BY pa.alias)
                                   FROM public.nf_party_aliases pa
                                  WHERE pa.company_id = p_company_id AND pa.party_id = p.id), '[]'::jsonb))
           ORDER BY p.name), '[]'::jsonb)
    INTO v_out
    FROM public.nf_parties p
   WHERE p.company_id = p_company_id AND p.is_active;
  RETURN v_out;
END
$function$;

COMMIT;
