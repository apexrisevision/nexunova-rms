-- BATCH H2 #4 (2026-06-03): switch email-OTP generation from non-crypto pg random() to crypto gen_random_bytes.
-- Affects send_signup_otp + send_admin_reset_otp. Range preserved (100000-999999, 6 digits) so the RPC contract,
-- email body, and the already-bcrypt email_otps.otp_hash are unchanged. Verify RPCs (crypt-compare) need no change.
-- Idempotent: only rewrites functions still containing the old random() line.
DO $$
DECLARE r record;
  v_old text := 'lpad((floor(random() * 900000) + 100000)::INT::TEXT, 6, ''0'')';
  v_rep text := 'lpad((100000 + (((( ''x''||encode(extensions.gen_random_bytes(4),''hex'') )::bit(32)::bigint) & 4294967295) % 900000))::text, 6, ''0'')';
BEGIN
  FOR r IN
    SELECT p.oid, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('send_signup_otp','send_admin_reset_otp')
      AND position(v_old in pg_get_functiondef(p.oid)) > 0
  LOOP
    EXECUTE replace(r.def, v_old, v_rep);
  END LOOP;
END $$;
