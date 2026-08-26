-- ============================================================================
-- 2026-08-26 — The public key stops being able to run the plumbing
-- ============================================================================
-- 284 SECURITY DEFINER functions were executable by `anon` — the publishable
-- key, which sits in the sales portal's own HTML and can be read by anybody who
-- views the page. SECURITY DEFINER means they run with the owner's rights, so
-- row-level security does not stand in their way.
--
-- Two were confirmed rather than suspected. _platform_bank_details returned all
-- four company bank and wallet accounts, account numbers included, to a call
-- made with nothing but that public key. _rms_insert_simple_payment — which
-- creates a payment — was equally open; it was NOT called, only inspected.
--
-- This closes the safest and worst-offending group first: the internal helpers
-- and the cron jobs. Nothing outside the database calls either.
--
--   · The helpers are prefixed with _ by convention and are called only from
--     inside other functions. A SECURITY DEFINER function runs as its owner, so
--     the inner call is checked against postgres, never against the caller —
--     taking EXECUTE from anon and authenticated changes nothing for them.
--
--   · The cron jobs run under pg_cron as postgres, for the same reason.
--
-- Checked before touching anything: no page, no portal module and no Edge
-- Function calls any of these by name. The webhooks that DO call functions
-- (create_lead_from_fb and friends) use the service-role key and are untouched.
--
-- REVOKE FROM PUBLIC IS THE PART THAT MATTERS. Revoking from anon and
-- authenticated alone leaves the grant PUBLIC carries, and the door stays open
-- while looking shut — the same false lock found in NexuAttend in May.
--
-- Verified after applying: the bank-details call that worked now answers
-- "permission denied"; the portal's own gate passed 38/38 and all 74 admin
-- pages still load clean.
-- ============================================================================

DO $$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prosecdef
       AND (p.proname LIKE '\_%' OR p.proname LIKE 'cron\_%')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || r.sig || ' FROM PUBLIC, anon, authenticated';
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'closed % internal and cron functions to the public key', v_n;
END $$;
