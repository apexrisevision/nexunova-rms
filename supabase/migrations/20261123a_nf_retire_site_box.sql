-- ══ NexuFinance: retire the site cash box — back to one Daily Closing, one login (20261123a) ══
-- APPLIED 23-Nov-2026 as 20261123071949, on the owner's yes. Owner, 23-Nov-2026: "sharose banaye ga excel mai hee closing aur ham phir khud osay nexufinance pe
-- update karaingay, is liye ham ne jo 2 closing concept banaya hai remove it … pehle jaisay kar do".
-- Owner's terms (23-Nov):
--   * Sharose's 75 vouchers (05-20 Nov) STAY, with their created_by and audit as they are.
--   * Head Office Cash <-> Petty Cash transfer stays; nf_save_withdrawal (bank -> petty) and the petty -> bank
--     deposit stay.
--   * DC-011 (20-Nov, OPEN) was started by Sharose: it is put in Head Office's name so the owner can close it.
--   * Sharose's NexuFinance access ends (nf_members.active = false). His auth user and RMS login are not touched.
--   * the Site Closing module's tables go only if they hold 0 rows (checked here; the migration stops if not).
-- What goes: nf_site_days, nf_site_lines, nf_combined_closings, the 31 site functions, the site-match trigger on
-- nf_vouchers, the bill-photo bucket's policies (and the bucket when it is empty and storage allows), and the 'site'
-- role. What stays: Petty Cash (10200) and its balance, every voucher, the token sync, the duplicate guard, the
-- day's Excel, the WhatsApp brief, the bank deposit, real dates. With only the director left as a member the
-- two-login rules (own cash box, own-entry edits, head-office-only day actions) never limit anyone.
-- Rollback: 20261123a_nf_retire_site_box_rollback.sql (generated from the live definitions on 23-Nov).

DO $chk$
DECLARE n bigint;
BEGIN
  SELECT (SELECT count(*) FROM public.nf_site_days) + (SELECT count(*) FROM public.nf_site_lines)
       + (SELECT count(*) FROM public.nf_combined_closings) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'site tables are not empty (% rows) — nothing dropped', n; END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'nf-site-bills') THEN
    RAISE EXCEPTION 'the nf-site-bills bucket holds files — nothing dropped';
  END IF;
  IF EXISTS (SELECT 1 FROM public.nf_members WHERE role = 'site') THEN
    RAISE EXCEPTION 'a member still has the site role — nothing dropped';
  END IF;
END $chk$;

-- ── 1. DC-011 into Head Office's name ───────────────────────────────────────
-- created_by is immutable through nf_days_guard; it is lifted for this one row and put straight back.
-- The audit trigger stays on and records the change.
ALTER TABLE public.nf_days DISABLE TRIGGER nf_days_guard;
UPDATE public.nf_days
   SET created_by = '315f2852-852f-4653-9253-a5a27a7828c8', updated_by = '315f2852-852f-4653-9253-a5a27a7828c8', updated_at = now(), version = version + 1
 WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND closing_no = 'DC-011' AND status = 'OPEN' AND created_by = '671bc3d9-f794-4e75-ab18-8fab2feb1466';
ALTER TABLE public.nf_days ENABLE TRIGGER nf_days_guard;

-- ── 2. Sharose's NexuFinance access ends ────────────────────────────────────
UPDATE public.nf_members
   SET active = false, cash_via = 'Cash', updated_at = now(), updated_by = '315f2852-852f-4653-9253-a5a27a7828c8'
 WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND user_id = '671bc3d9-f794-4e75-ab18-8fab2feb1466';

-- ── 2b. the cash boxes take back their own names (set to Head Office Cash / Site Cash on 18-Nov) ──
UPDATE public.nf_accounts SET via_label = CASE via WHEN 'Cash' THEN 'Cash in hand' ELSE 'Petty cash' END
 WHERE company_id = '96d210e7-e63b-4ef0-b1d0-74e622eac7ce' AND via IN ('Cash', 'Petty');

-- ── 3. the Site Closing module ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS nf_vouchers_site_match_guard ON public.nf_vouchers;
DROP POLICY IF EXISTS nf_site_bills_insert ON storage.objects;
DROP POLICY IF EXISTS nf_site_bills_read ON storage.objects;
DO $b$ BEGIN
  DELETE FROM storage.buckets WHERE id = 'nf-site-bills';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'nf-site-bills bucket kept (empty, private): %', SQLERRM;
END $b$;
DROP POLICY IF EXISTS nf_site_days_read ON public.nf_site_days;
DROP POLICY IF EXISTS nf_site_lines_read ON public.nf_site_lines;
DROP POLICY IF EXISTS nf_combined_closings_read ON public.nf_combined_closings;
DROP FUNCTION IF EXISTS public._nf_ho_open_day(p_company_id uuid);
DROP FUNCTION IF EXISTS public._nf_ho_voucher_edit(p_voucher_id uuid, p_via text, p_head text, p_party text, p_real_date date);
DROP FUNCTION IF EXISTS public._nf_site_accept_one(l nf_site_lines, p_head_code text, p_party_name text);
DROP FUNCTION IF EXISTS public._nf_site_assert_not_negative(p_company_id uuid, p_from date);
DROP FUNCTION IF EXISTS public._nf_site_book(p_company_id uuid, p_date date);
DROP FUNCTION IF EXISTS public._nf_site_cheque(p text);
DROP FUNCTION IF EXISTS public._nf_site_day_for(p_company_id uuid, p_business_date date);
DROP FUNCTION IF EXISTS public._nf_site_line_for_ho(p_line_id uuid, p_version integer);
DROP FUNCTION IF EXISTS public._nf_site_match(p_site_day_id uuid);
DROP FUNCTION IF EXISTS public.nf_site_accept(p_line_id uuid, p_version integer, p_head_code text, p_party_name text);
DROP FUNCTION IF EXISTS public.nf_site_accept_new(p_site_day_id uuid, p_version integer);
DROP FUNCTION IF EXISTS public.nf_site_bill_company(p_name text);
DROP FUNCTION IF EXISTS public.nf_site_bill_writer(p_company_id uuid);
DROP FUNCTION IF EXISTS public.nf_site_day_json(p_site_day_id uuid);
DROP FUNCTION IF EXISTS public.nf_site_delete_line(p_line_id uuid, p_version integer);
DROP FUNCTION IF EXISTS public.nf_site_get_day(p_company_id uuid, p_business_date date);
DROP FUNCTION IF EXISTS public.nf_site_link(p_line_id uuid, p_version integer, p_voucher_id uuid, p_reason text);
DROP FUNCTION IF EXISTS public.nf_site_list_days(p_company_id uuid, p_from date, p_to date);
DROP FUNCTION IF EXISTS public.nf_site_list_heads(p_company_id uuid);
DROP FUNCTION IF EXISTS public.nf_site_list_units(p_company_id uuid);
DROP FUNCTION IF EXISTS public.nf_site_mark_duplicate(p_line_id uuid, p_version integer, p_voucher_id uuid);
DROP FUNCTION IF EXISTS public.nf_site_match(p_site_day_id uuid);
DROP FUNCTION IF EXISTS public.nf_site_reader(p_company_id uuid, p_with_site boolean);
DROP FUNCTION IF EXISTS public.nf_site_reject(p_line_id uuid, p_version integer, p_reason text);
DROP FUNCTION IF EXISTS public.nf_site_reopen(p_site_day_id uuid, p_reason text, p_version integer);
DROP FUNCTION IF EXISTS public.nf_site_return(p_site_day_id uuid, p_reason text, p_version integer);
DROP FUNCTION IF EXISTS public.nf_site_review(p_site_day_id uuid);
DROP FUNCTION IF EXISTS public.nf_site_save_line(p_company_id uuid, p_business_date date, p_line_id uuid, p_side text, p_doc_no text, p_party_name text, p_unit_codes text, p_token_no integer, p_head_code text, p_via text, p_amount numeric, p_bank_ref text, p_remarks text, p_attachment_url text, p_version integer);
DROP FUNCTION IF EXISTS public.nf_site_start_first_day(p_company_id uuid, p_business_date date, p_opening_cash numeric);
DROP FUNCTION IF EXISTS public.nf_site_submit(p_site_day_id uuid, p_counted_cash numeric, p_denominations jsonb, p_variance_reason text, p_version integer);
DROP FUNCTION IF EXISTS public.nf_vouchers_site_match_guard();
DROP TABLE public.nf_site_lines;
DROP TABLE public.nf_site_days;
DROP TABLE public.nf_combined_closings;

-- ── 4. no 'site' role any more ──────────────────────────────────────────────
ALTER TABLE public.nf_members DROP CONSTRAINT nf_members_role_check;
ALTER TABLE public.nf_members ADD CONSTRAINT nf_members_role_check CHECK (role IN ('accountant', 'director', 'viewer'));
