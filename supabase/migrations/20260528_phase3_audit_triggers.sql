-- ================================================================
-- NEXUNOVA RMS — PHASE 3 AUDIT TRAIL: MISSING TRIGGER COVERAGE
-- Migration: 20260528_phase3_audit_triggers.sql  |  2026-05-28
-- ================================================================
-- Adds _trg_audit AFTER INSERT OR UPDATE OR DELETE triggers to 5
-- tables that were missing from the original Phase-3 coverage.
-- All use the existing audit_trigger_function() — no new logic.
--
-- Priority (HIGH):
--   app_users              — user creation, role changes, pw resets
--   blacklisted_clients    — blacklist add/remove must be immutable
--   approval_request_comments — maker/checker comments tamper-evident
-- Priority (MEDIUM):
--   escalations            — escalation lifecycle
--   legal_cases            — legal case mutations
-- ================================================================

CREATE TRIGGER _trg_audit
AFTER INSERT OR UPDATE OR DELETE ON public.app_users
FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER _trg_audit
AFTER INSERT OR UPDATE OR DELETE ON public.blacklisted_clients
FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER _trg_audit
AFTER INSERT OR UPDATE OR DELETE ON public.approval_request_comments
FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER _trg_audit
AFTER INSERT OR UPDATE OR DELETE ON public.escalations
FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER _trg_audit
AFTER INSERT OR UPDATE OR DELETE ON public.legal_cases
FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
