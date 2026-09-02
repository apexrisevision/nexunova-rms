-- ═══════════════════════════════════════════════════════════════════════════
-- FMH: the receipt-book numbers move out of Notes into manual_number
-- ───────────────────────────────────────────────────────────────────────────
-- The FMH import had nowhere to put the physical receipt-book number, so it was
-- written into the payment's Notes — sometimes alone ("BRV#1095"), sometimes
-- tacked onto the end of a real note ("Adjustment against: … — ARV#960").
-- payments.manual_number now exists (see 20260902a), so the number moves to its
-- own column and Notes keeps only the words. Notes that carry no number
-- (Booking, Installment, Final, the lump/land-adjustment and BALANCING remarks)
-- are left untouched.
--
-- Numbers are copied VERBATIM — prefix, punctuation and all (BRV#T-507,
-- BVR#984, CRV31074, Token.No:41/61). Nothing is normalised or guessed: the
-- book number is whatever the officer wrote on the slip, and two of these are
-- clearly typos that only FMH can settle.
--
-- Applied 2026-09-02 to company 71d33e07 (FMH): 219 of 1300 payments moved.
-- Reversible — the original Notes of every FMH payment is snapshotted first in
-- rms_backup.fmh_payment_notes_20260902 (a non-public schema, so PostgREST does
-- not expose it). To undo:
--   UPDATE public.payments p SET notes = b.notes_before, manual_number = b.manual_before
--   FROM rms_backup.fmh_payment_notes_20260902 b WHERE b.id = p.id;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS rms_backup;
REVOKE ALL ON SCHEMA rms_backup FROM PUBLIC, anon, authenticated;

DROP TABLE IF EXISTS rms_backup.fmh_payment_notes_20260902;
CREATE TABLE rms_backup.fmh_payment_notes_20260902 AS
SELECT id, payment_code, voucher_code, notes AS notes_before, manual_number AS manual_before, now() AS snapshot_at
FROM public.payments
WHERE company_id = '71d33e07-e55c-49af-8f5b-fdd7fd6e8612';

UPDATE public.payments p SET
  manual_number = CASE
    -- token tacked onto the end of a real note, after an em dash
    WHEN notes ~ '—\s*(BRV|CRV|ARV|BVR|ARC)#[A-Za-z0-9/-]+$'
      THEN substring(notes from '((?:BRV|CRV|ARV|BVR|ARC)#[A-Za-z0-9/-]+)$')
    -- token first, then a parenthetical remark
    WHEN notes ~ '^((BRV|CRV|ARV|BVR|ARC)#[A-Za-z0-9/-]+|TOKEN\.NO#[0-9/]+)\('
      THEN substring(notes from '^((?:BRV|CRV|ARV|BVR|ARC)#[A-Za-z0-9/-]+|TOKEN\.NO#[0-9/]+)\(')
    -- the whole note IS the number
    ELSE notes
  END,
  notes = CASE
    WHEN notes ~ '—\s*(BRV|CRV|ARV|BVR|ARC)#[A-Za-z0-9/-]+$'
      THEN nullif(btrim(regexp_replace(notes, '\s*—\s*(BRV|CRV|ARV|BVR|ARC)#[A-Za-z0-9/-]+$', '')), '')
    WHEN notes ~ '^((BRV|CRV|ARV|BVR|ARC)#[A-Za-z0-9/-]+|TOKEN\.NO#[0-9/]+)\('
      THEN nullif(btrim(regexp_replace(notes, '^((BRV|CRV|ARV|BVR|ARC)#[A-Za-z0-9/-]+|TOKEN\.NO#[0-9/]+)\((.*)\)$', '\3')), '')
    ELSE NULL
  END,
  updated_at = now()
WHERE p.company_id = '71d33e07-e55c-49af-8f5b-fdd7fd6e8612'
  AND p.manual_number IS NULL
  AND p.notes IS NOT NULL
  AND (
        notes ~  '—\s*(BRV|CRV|ARV|BVR|ARC)#[A-Za-z0-9/-]+$'
     OR notes ~  '^((BRV|CRV|ARV|BVR|ARC)#[A-Za-z0-9/-]+|TOKEN\.NO#[0-9/]+)\('
     OR notes ~  '^(BRV|CRV|ARV|BVR|ARC)#[A-Za-z0-9/-]+$'
     OR notes ~* '^CRV\(TOKEN\.NO\)#[0-9/]+$'
     OR notes ~* '^TOKEN\s*\.?\s*NO[#:-][A-Za-z0-9/]+$'
     OR notes ~* '^TOKEN Receipt No#[0-9]+$'
     OR notes ~  '^[RT]-[0-9]+$'
     OR notes ~  '^CRV[0-9]+$'
  );
