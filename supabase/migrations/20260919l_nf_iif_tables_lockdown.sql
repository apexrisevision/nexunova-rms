-- ═══════════════════════════════════════════════════════════════════════════
-- NexuFinance double-entry foundation · 2026-09-19l · Lock the IIF export-
-- state tables away from the public key (blueprint conformance pass, Part I)
--
-- NOT YET APPLIED — awaiting explicit go-ahead (re-grants are always-ask).
--
-- Found checking Part I ("nothing reachable by the public key") against the
-- live catalog rather than against memory: 20260919h locked its two RPCs
-- (REVOKE from PUBLIC/anon, GRANT to authenticated) but never touched the
-- two TABLES it created. Supabase's default for a new table in public is
-- RLS OFF plus SELECT/INSERT/UPDATE/DELETE/TRUNCATE granted to anon and
-- authenticated, and PostgREST exposes that directly. Proven, not assumed:
-- with `SET ROLE anon` alone, a SELECT on both tables succeeded, and an
-- INSERT into nf_iif_batches + nf_iif_batch_vouchers marking real voucher
-- JV-0018 as exported succeeded (inside a transaction that was rolled back).
-- Since 20260919k, an nf_iif_batch_vouchers row also LOCKS that voucher from
-- edit/delete — so the public key could lock, or unlock, any real voucher.
--
-- Fix: row security ON with no policies (the only intended access path is
-- the two SECURITY DEFINER RPCs, which are unaffected), and every direct
-- privilege revoked from PUBLIC, anon and authenticated. Also tidies the
-- nf_lines VIEW, which carried the same default full grants — harmless in
-- practice because it is security_invoker and the underlying tables deny
-- anon (checked: anon SELECT fails with "permission denied for table
-- nf_voucher_legs"), but a full-privilege grant on the ledger view is not
-- something to leave lying around: reduced to authenticated SELECT only,
-- matching every other nf_ table.
--
-- Standing check added in the same commit (verify-nf-rules.js SEC-TABLE-RLS,
-- SEC-TABLE-ANON, SEC-TABLE-AUTH-WRITE, each with a planted-mutant
-- self-test), per Part M — never a one-time sweep.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.nf_iif_batches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nf_iif_batch_vouchers  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nf_iif_batches        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nf_iif_batch_vouchers FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.nf_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.nf_lines TO authenticated;

COMMIT;
