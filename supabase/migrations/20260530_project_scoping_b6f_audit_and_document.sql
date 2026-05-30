-- ════════════════════════════════════════════════════════════
-- PROJECT-SCOPING — BATCH 6 GROUP 6F: audit & document (NO behavior changes)
-- 2026-05-30.
-- ════════════════════════════════════════════════════════════
-- Pure COMMENT ON FUNCTION pass to mark the report and buyer-portal
-- RPCs as INTENTIONALLY caller-blind / permissive, so a future agent
-- (or future-me) doesn't "fix" them by adding a v_pids/cfg gate.
-- This is exactly the get_sales_register mistake from Batch 6B
-- (silently retrofitted, then reverted in commit 0ddb6a3) — these
-- comments are the structural fix to prevent recurrence.
--
-- Per-project report isolation is a SEPARATE deliberate future task,
-- not a Batch-6 side effect. See [[report_rpcs_anon_scoped]] memory.
--
-- This migration contains zero CREATE OR REPLACE statements. Zero
-- behavior changes. Only catalog COMMENT additions.
--
-- ───────────────────────────────────────────────────────────────────
-- PROTECTED-10 REPORT RPCs — caller-blind / company-scoped only.
-- ───────────────────────────────────────────────────────────────────

COMMENT ON FUNCTION public.get_collection_report(p_company_id uuid, p_from_date date, p_to_date date, p_project_id uuid, p_status text) IS
$$INTENTIONALLY CALLER-BLIND — DO NOT ADD A v_pids / cfg / _rms_caller GATE.
Member of the protected-10 report-viewer set (reports/hub.html + reports/viewer.html).
The viewer inherits the user's Supabase session via localStorage (same-origin),
but the RPC stays caller-blind by design so anon report viewers + the same-
session report viewers ALL see complete company-scoped data. Adding a per-
project filter here re-introduces consent semantics that were deliberately
removed in 20260529_remove_admin_consent.sql.
Per-project report isolation is a separate deliberate future task — never
a Batch-6 side effect. See memory: report_rpcs_anon_scoped.$$;

COMMENT ON FUNCTION public.get_sales_register(p_company_id uuid, p_from_date date, p_to_date date, p_project_id uuid, p_status text) IS
$$INTENTIONALLY CALLER-BLIND — DO NOT ADD A v_pids / cfg / _rms_caller GATE.
Member of the protected-10 report-viewer set. WAS INADVERTENTLY GATED in
Batch 6B and reverted in commit 0ddb6a3 (canonical body restored from
20260529_remove_admin_consent.sql). Naming convention is NOT a reliable
signal (this one isn't called *_for_report) — the protection lives in
the report_rpcs_anon_scoped memory, not in the name. See [[report_rpcs_anon_scoped]].$$;

COMMENT ON FUNCTION public.get_outstanding_report(p_company_id uuid, p_from_date date, p_to_date date, p_project_id uuid, p_status text) IS
$$INTENTIONALLY CALLER-BLIND — DO NOT ADD A v_pids / cfg / _rms_caller GATE.
Member of the protected-10 report-viewer set. See [[report_rpcs_anon_scoped]].$$;

COMMENT ON FUNCTION public.get_unit_inventory(p_company_id uuid, p_from_date date, p_to_date date, p_project_id uuid, p_status text) IS
$$INTENTIONALLY CALLER-BLIND — DO NOT ADD A v_pids / cfg / _rms_caller GATE.
Member of the protected-10 report-viewer set. See [[report_rpcs_anon_scoped]].$$;

COMMENT ON FUNCTION public.get_aging_report(p_company_id uuid, p_project_id uuid) IS
$$INTENTIONALLY CALLER-BLIND — DO NOT ADD A v_pids / cfg / _rms_caller GATE.
Member of the protected-10 report-viewer set. The p_project_id parameter
is a CALLER-CHOSEN filter (caller asks for one project's data), NOT an
isolation gate — anon viewers can pass any project_id and get its data
exactly as designed. See [[report_rpcs_anon_scoped]].$$;

COMMENT ON FUNCTION public.get_project_summary(p_company_id uuid, p_project_id uuid) IS
$$INTENTIONALLY CALLER-BLIND — DO NOT ADD A v_pids / cfg / _rms_caller GATE.
Member of the protected-10 report-viewer set. See [[report_rpcs_anon_scoped]].$$;

COMMENT ON FUNCTION public.get_tax_wht_report(p_company_id uuid, p_project_id uuid) IS
$$INTENTIONALLY CALLER-BLIND — DO NOT ADD A v_pids / cfg / _rms_caller GATE.
Member of the protected-10 report-viewer set. See [[report_rpcs_anon_scoped]].$$;

COMMENT ON FUNCTION public.get_post_possession_dues_report(p_company_id uuid, p_project_id uuid) IS
$$INTENTIONALLY CALLER-BLIND — DO NOT ADD A v_pids / cfg / _rms_caller GATE.
Member of the protected-10 report-viewer set. See [[report_rpcs_anon_scoped]].$$;

COMMENT ON FUNCTION public.get_legal_portfolio(p_company_id uuid, p_project_id uuid) IS
$$INTENTIONALLY CALLER-BLIND — DO NOT ADD A v_pids / cfg / _rms_caller GATE.
Member of the protected-10 report-viewer set. See [[report_rpcs_anon_scoped]].$$;

COMMENT ON FUNCTION public.get_executive_kpis(p_company_id uuid, p_project_id uuid) IS
$$INTENTIONALLY CALLER-BLIND — DO NOT ADD A v_pids / cfg / _rms_caller GATE.
Member of the protected-10 report-viewer set (surfaced through reports/hub.html
+ reports/viewer.html). Added to the protected set during Batch 6E triage on
2026-05-30 — the original 9-list was incomplete; this is the 10th. Same
caller-blind class as the other 9. See [[report_rpcs_anon_scoped]].$$;

-- ───────────────────────────────────────────────────────────────────
-- BUYER-PORTAL RPCs — token-keyed / anon-friendly by design.
-- ───────────────────────────────────────────────────────────────────

COMMENT ON FUNCTION public.get_portal_client_data(p_session_token text) IS
$$INTENTIONALLY ANON / TOKEN-KEYED — DO NOT ADD A v_pids / cfg / _rms_caller GATE.
The buyer-facing portal runs with NO logged-in app session. Access control
here is via p_session_token (portal_sessions row + expires_at check), not
via auth.uid() — adding _rms_caller would break the portal for genuine
anon callers. The session token is the gate. See [[report_rpcs_anon_scoped]]
and [[admin_and_demo_access]].$$;

COMMENT ON FUNCTION public.get_buyer_sale_summary(p_company_id uuid, p_client_id uuid, p_unit_id uuid) IS
$$INTENTIONALLY ANON-FRIENDLY — DO NOT ADD A v_pids / cfg / _rms_caller GATE.
Used by the buyer portal flow. Access control is via the upstream portal
session check (caller must already have produced a valid session token);
adding _rms_caller would break the portal. See [[report_rpcs_anon_scoped]].$$;

COMMENT ON FUNCTION public.get_buyer_payment_schedule(p_company_id uuid, p_client_id uuid, p_unit_id uuid) IS
$$INTENTIONALLY ANON-FRIENDLY — DO NOT ADD A v_pids / cfg / _rms_caller GATE.
Same buyer-portal class as get_buyer_sale_summary. The portal session is
the gate. See [[report_rpcs_anon_scoped]].$$;
