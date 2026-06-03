-- FIX (2026-06-03): restore anon EXECUTE on the pre-auth SIGNUP RPCs.
-- Symptom: browser signup step 1 failed with "Could not send code." Root cause: the anon role lacked
-- EXECUTE on these signup RPCs (a prior de-anon/PATH_B lockdown revoked it), so the anon frontend's
-- supabase.rpc() got `42501 permission denied` -> data=null -> signup.js:572 "Could not send code".
-- NOT caused by the crypto-OTP change (CREATE OR REPLACE preserves grants; the RPC + send-otp-email + Resend
-- are healthy — verified {sent:true} + pg_net 200). These are pre-signup utility RPCs intended for anon
-- (see 20260528_auth_otp.sql). check_company_email enables email-existence enumeration — accepted (needed for
-- the "email already registered" UX). No tenant data is exposed (check_* return booleans; OTP RPCs are
-- rate-limited 3/hour/email + bcrypt + attempt-capped). signup_new_company already has anon EXECUTE.
GRANT EXECUTE ON FUNCTION public.send_signup_otp(text, text)   TO anon;
GRANT EXECUTE ON FUNCTION public.verify_signup_otp(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.check_company_email(text)     TO anon;
GRANT EXECUTE ON FUNCTION public.check_company_available(text) TO anon;
