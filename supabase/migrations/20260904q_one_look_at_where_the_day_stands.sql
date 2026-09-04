-- ═══════════════════════════════════════════════════════════════════════════
-- One look at where the day stands
-- ───────────────────────────────────────────────────────────────────────────
-- P9. §A12 S8: the dashboard tile. Today's status and figures, five counters,
-- and the last seven days — for the Accountant, the CFO and the Director.
--
-- ONE CALL, ONE ROUND TRIP, ONE PASS PER TABLE. A tile is the thing a person
-- looks at before they do anything else, so it must not be five queries that
-- become fifteen the moment "All projects" is picked. get_daily_closing_tile
-- resolves the visible project set ONCE into an array and every counter is a
-- single aggregate over that array — no loop, no per-project call, no N+1.
--
-- WHAT IT READS, AND ON WHICH INDEX (all four already exist; nothing is added
-- to a shared table for this):
--
--   receipts PENDING      cash_entries (project_id, rms_status)
--   UNAPPLIED receipts    cash_entries (project_id, rms_status)
--   NOT_EXPORTED          cash_entries (project_id, qb_status) → join cash_days
--   PDC due <= 7 days     pdc_cheques (project_id) + filter — SEVEN ROWS in the
--                         whole database, so a composite index would be a
--                         change to a table Khushal Bagh and FMH use in
--                         production, bought for nothing. Revisit if PDC ever
--                         becomes real volume (Phase 3).
--   last 7 days           cash_days (project_id, business_date DESC)
--
-- PHASE DISCIPLINE. The PDC counters and the export counter are wired to their
-- real queries but WILL READ ZERO on the pilot, and that is expected, not a
-- bug: Awami has no pdc_cheques rows, and no day has been closed with entries
-- on it yet. Nothing from Phase 2 or Phase 3 is built here — no export, no PDC
-- register, no Group Position (that is Phase 4 and is deliberately absent).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_daily_closing_tile(
  p_company_id uuid, p_project_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_me public.app_users := public._rms_caller();
  v_role text;
  v_pids uuid[];
  v_today date := public._dc_today();
  v_all boolean := (p_project_id IS NULL);
  v_day public.cash_days;
  v_t record;
  v_status text;
  v_close_cash numeric(18,2) := 0;
  v_close_bank numeric(18,2) := 0;
  v_open_n int := 0; v_closed_n int := 0; v_none_n int := 0;
  v_recent jsonb := '[]'::jsonb;
  v_pending int; v_unapplied int; v_notexp int; v_pdc_pending int; v_pdc_due int;
BEGIN
  v_role := public._dc_role(v_me);
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  -- ── which projects does this answer cover? ──────────────────────────────
  IF v_all THEN
    -- §A12 gives "All projects" to the CFO and the Director. A Cashier's row
    -- reads "own project" and an Accountant works one book at a time; both are
    -- told to pick one rather than being handed a company-wide total they were
    -- never given.
    IF v_role NOT IN ('CFO', 'DIRECTOR') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED',
        'message', 'Choose a project. The company-wide view is for the CFO and the Directors.');
    END IF;
    SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[]) INTO v_pids
      FROM public.projects p
     WHERE p.company_id = p_company_id
       AND public._dc_may_view(v_me, p_company_id, p.id);
  ELSE
    IF NOT public._dc_may_view(v_me, p_company_id, p_project_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
    END IF;
    v_pids := ARRAY[p_project_id];
  END IF;

  IF array_length(v_pids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', true, 'role', v_role, 'all_projects', v_all,
      'business_date', v_today, 'projects', 0, 'status', NULL,
      'counters', jsonb_build_object('receipts_pending', 0, 'unapplied', 0,
        'not_exported', 0, 'pdc_pending', 0, 'pdc_due_7', 0),
      'recent', '[]'::jsonb);
  END IF;

  -- ── today ───────────────────────────────────────────────────────────────
  IF v_all THEN
    -- One row per project would be Group Position, which is Phase 4. This is
    -- a count of where the projects stand plus the money, and nothing more.
    SELECT count(*) FILTER (WHERE d.status = 'OPEN'),
           count(*) FILTER (WHERE d.status = 'CLOSED'),
           COALESCE(sum(CASE WHEN d.status = 'CLOSED' THEN d.closing_cash ELSE NULL END), 0),
           COALESCE(sum(CASE WHEN d.status = 'CLOSED' THEN d.closing_bank ELSE NULL END), 0)
      INTO v_open_n, v_closed_n, v_close_cash, v_close_bank
      FROM public.cash_days d
     WHERE d.project_id = ANY (v_pids) AND d.business_date = v_today;
    v_none_n := array_length(v_pids, 1) - v_open_n - v_closed_n;

    -- An OPEN day has no stored closing figure, so the live one is computed
    -- the same way get_cash_day_summary does — one pass, not one call each.
    SELECT v_close_cash + COALESCE(sum(x.cash), 0),
           v_close_bank + COALESCE(sum(x.bank), 0)
      INTO v_close_cash, v_close_bank
      FROM (
        SELECT d.opening_cash
                 + COALESCE(sum(e.amount) FILTER (WHERE e.mode='CASH' AND e.direction='IN'), 0)
                 - COALESCE(sum(e.amount) FILTER (WHERE e.mode='CASH' AND e.direction='OUT'), 0) AS cash,
               d.opening_bank
                 + COALESCE(sum(e.amount) FILTER (WHERE e.mode='BANK' AND e.direction='IN'), 0)
                 - COALESCE(sum(e.amount) FILTER (WHERE e.mode='BANK' AND e.direction='OUT'), 0) AS bank
          FROM public.cash_days d
          LEFT JOIN public.cash_entries e ON e.cash_day_id = d.id
         WHERE d.project_id = ANY (v_pids) AND d.business_date = v_today
           AND d.status = 'OPEN'
         GROUP BY d.id, d.opening_cash, d.opening_bank
      ) x;

    v_status := CASE WHEN v_open_n > 0 THEN 'OPEN'
                     WHEN v_closed_n > 0 THEN 'CLOSED'
                     ELSE NULL END;
  ELSE
    SELECT * INTO v_day FROM public.cash_days
     WHERE project_id = p_project_id AND business_date = v_today;
    IF FOUND THEN
      SELECT * INTO v_t FROM public._dc_day_totals(v_day.id);
      v_status := v_day.status;
      v_close_cash := CASE WHEN v_day.status = 'CLOSED' THEN v_day.closing_cash
                           ELSE v_day.opening_cash + v_t.in_cash - v_t.out_cash END;
      v_close_bank := CASE WHEN v_day.status = 'CLOSED' THEN v_day.closing_bank
                           ELSE v_day.opening_bank + v_t.in_bank - v_t.out_bank END;
      IF v_day.status = 'OPEN' THEN v_open_n := 1; ELSE v_closed_n := 1; END IF;
    ELSE
      v_none_n := 1;
    END IF;
  END IF;

  -- ── the five counters (§A12) ────────────────────────────────────────────
  -- Two of them share one pass over cash_entries; the export counter needs the
  -- day's status so it joins; the two PDC counters share one pass.
  SELECT count(*) FILTER (WHERE e.rms_status = 'PENDING'),
         count(*) FILTER (WHERE e.rms_status = 'UNAPPLIED')
    INTO v_pending, v_unapplied
    FROM public.cash_entries e
   WHERE e.project_id = ANY (v_pids)
     AND e.rms_status IN ('PENDING', 'UNAPPLIED');

  -- "Not yet exported, on a day that is finished." An entry on an OPEN day is
  -- not late — the day is still being written.
  SELECT count(*) INTO v_notexp
    FROM public.cash_entries e
    JOIN public.cash_days d ON d.id = e.cash_day_id
   WHERE e.project_id = ANY (v_pids)
     AND e.qb_status = 'NOT_EXPORTED'
     AND d.status = 'CLOSED';

  SELECT count(*) FILTER (WHERE c.status = 'pending'),
         count(*) FILTER (WHERE c.status = 'pending'
                            AND c.cheque_date <= v_today + 7
                            AND c.cheque_date >= v_today)
    INTO v_pdc_pending, v_pdc_due
    FROM public.pdc_cheques c
   WHERE c.project_id = ANY (v_pids)
     AND c.company_id = p_company_id;

  -- ── the last seven days (§A12) ──────────────────────────────────────────
  -- Per project only. Across projects a date has several closing figures and
  -- several sheets, and one row per project per date is Group Position — which
  -- is Phase 4 and is not built here.
  IF NOT v_all THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY x.business_date DESC), '[]'::jsonb) INTO v_recent FROM (
      SELECT d.id AS cash_day_id, d.business_date, d.status,
             d.closing_cash, d.closing_bank, d.variance,
             (SELECT dd.id FROM public.day_documents dd
               WHERE dd.cash_day_id = d.id AND dd.kind = 'DIRECTOR_PDF'
               ORDER BY dd.version DESC LIMIT 1) AS pdf_document_id
        FROM public.cash_days d
       WHERE d.project_id = p_project_id
       ORDER BY d.business_date DESC
       LIMIT 7
    ) x;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'role', v_role,
    'all_projects', v_all,
    'projects', array_length(v_pids, 1),
    'business_date', v_today,
    'status', v_status,
    'open_projects', v_open_n, 'closed_projects', v_closed_n, 'not_opened_projects', v_none_n,
    'closing_cash', v_close_cash, 'closing_bank', v_close_bank,
    'counters', jsonb_build_object(
      'receipts_pending', COALESCE(v_pending, 0),
      'unapplied',        COALESCE(v_unapplied, 0),
      'not_exported',     COALESCE(v_notexp, 0),
      'pdc_pending',      COALESCE(v_pdc_pending, 0),
      'pdc_due_7',        COALESCE(v_pdc_due, 0)),
    'recent', v_recent);
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_daily_closing_tile(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_closing_tile(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_daily_closing_tile(uuid, uuid) IS
  '§A12 S8 dashboard tile: today''s status and figures, the five counters and the last seven days, in one round trip. p_project_id NULL means every project the caller may see, which §A12 gives to the CFO and the Director only. The PDC and export counters read zero on the pilot by design — nothing from Phase 2 or 3 is built.';

COMMIT;
