# RPC Authorization Triage — ungated mutating SECURITY DEFINER RPCs

**Date:** 2026-06-01 · **Scope:** Supabase `itqxljtfbrppntgyfush`, schema `public`. Read-only triage (Step 1). No function/migration changed.

**Population:** the 93 SECURITY DEFINER functions that mutate (INSERT/UPDATE/DELETE) AND did **not** match the admin/role regex (`_rms_is_admin | is_super_admin | owner_user_id | role in/=`). These are the RPCs the role-authz work has NOT yet covered (origination, 7 doer-RPCs, 14 write-RPCs already gated were excluded by the role-regex and are not here).

**Method / caveats:**
- `mutating ops` and `company-in-WHERE` derived by regex over `prosrc` (proxy), not a full hand-read of all 93 bodies. `update:set` artifacts are the generic UPDATE token.
- **`tenant guard?`** = does the body reference `company_id = p_company_id` in a predicate. ⚠️ **This is NOT real cross-tenant protection** — `p_company_id` is a caller-supplied parameter. With **anon EXECUTE already revoked**, the realistic attacker is an *authenticated user of company B* who passes company A's `company_id` + a known row id. Only **caller-resolve** (`_rms_caller`/`auth.uid` → compare to `p_company_id`) actually stops that, and it is **absent in ~82 of 93**.
- `frontend call site` from grep of `js/` + `*.html`; "NONE" = no call site found (internal/cron/trigger/dead).
- Exposure vocabulary (per task): **OPEN** = no caller-resolve AND no tenant predicate; **company-scoped only** = tenant predicate present but caller-supplied (no caller/role verify); **internal/no frontend**; **auth/session-tied** = resolves caller or a session token.

| proname | args | mutating ops (I/U/D + table) | caller-resolve? | tenant guard? | UPA? | frontend call site + role | exposure note |
|---|---|---|---|---|---|---|---|
| _delete_legal_case_core | p_id, p_company_id | D:legal_cases | no | yes(param) | no | NONE (wrapper-only; authenticated REVOKED) | internal/no frontend |
| _edit_installment_schedule_core | p_sale_id, p_company_id, p_schedule | I/U/D:installments | no | yes(param) | no | NONE (wrapper-only; REVOKED) | internal/no frontend |
| _execute_unit_cancellation_core | (44 args) | I:agent_transactions/blacklisted_clients/unit_cancellations; U:agents/clients/installments/sales/units | no | yes(param) | no | NONE (wrapper-only; REVOKED) | internal/no frontend |
| _execute_unit_transfer_v2_core | (24 args) | I:sales/installments/unit_transfers/agent_transactions/sale_sequences; U:sales/units | no | yes(param) | no | NONE (wrapper-only; REVOKED) | internal/no frontend |
| _increment_usage | p_organization_id, p_product, p_metric, p_delta | I/U:platform_subscription_usage | no | no | no | NONE — authenticated=X | internal helper, but authenticated-callable |
| _trg_init_subscription_usage | (trigger) | I/U:platform_subscription_usage | no | no | no | NONE (trigger) | internal/trigger |
| add_ip_whitelist_entry | p_company_id, p_ip_range, p_label, p_created_by | I:company_ip_whitelists | no | yes(param) | no | admin.js:748 (admin Settings) | company-scoped only |
| add_price_revision | p_company_id, p_project_id, p_unit_type_id, p_new_price, p_effective_date, p_reason, p_revised_by | I:project_price_revisions; U:units(base_price) | no | yes(param) | no | projects.js:1667 (admin Projects) | company-scoped only |
| add_sale_amendment | p_company_id, p_sale_id, p_amendment_type, p_description, p_reason, p_amended_by | I:sale_amendments | no | yes(param) | no | sales.js:2795 (admin Sales) | company-scoped only |
| archive_old_audit_logs | p_days_old | D:audit_logs; I:audit_log_archive | no | no | no | NONE — authenticated=X | OPEN — any authed user, no gate (no company scope at all; bulk audit purge) |
| assign_clients_to_campaign | p_campaign_id, p_company_id, p_client_ids, p_assigned_by | I:campaign_clients | no | yes(param) | no | campaigns.js:415 (admin/recovery) | company-scoped only |
| calculate_client_health_score | p_client_id, p_company_id | I/U:client_health_scores/history | no | no | no | clients.js:1100, health-center.js:152 | OPEN — any authed user, no gate |
| cancel_approval_request | p_request_id | I:approval_request_comments; U:approval_requests | yes | no | no | NONE (comment ref only in approvals.js:8) | auth/caller-tied (requester-only logic — verify by-eye) |
| cancel_payment_link | p_payment_link_id, p_cancelled_by, p_reason | I:payment_link_status_history; U:payment_links | no | no | no | payment-links.js:279 (finance) | OPEN — any authed user, no gate |
| change_password | p_new_password | I:password_history; U:app_users/auth | yes | no | no | auth.js:517 | auth/caller-tied (self only) |
| check_reset_rate_limit | p_email | I:password_reset_requests | no | no | no | NONE (server-side, auth flow) | internal/auth flow |
| create_additional_receivable | p_company_id, p_data | I:additional_receivables | no | no | no | receivables.js:187 (finance) | OPEN — any authed user, no gate (company_id only inserted, not in a guard) |
| create_agent_commission_payment | p_company_id, p_data | I:agent_commission_payments | no | no | no | NONE (only *_full used) | OPEN — any authed user, no gate · likely DEAD |
| create_agent_commission_payment_full | p_company_id, p_data | I:agent_commission_payments | no | yes(param) | no | agents.js:1727 (admin/finance) | company-scoped only |
| create_agent_transaction | p_company_id, p_data | I:agent_transactions | no | yes(param) | no | agenttransactions.js:184 (admin/finance) | company-scoped only |
| create_app_user | p_company_id, p_full_name, p_role, p_password, p_email, p_phone, p_module_permissions | I:app_users | no | yes(param) | no | onboarding.js:662, users.js:516 (admin/owner) | company-scoped only — ⚠️ privilege: creates users incl. role; no admin gate (relies on UI). HIGH |
| create_blacklist_entry | p_company_id, p_data | I:blacklisted_clients | no | no | no | blacklist.js:176 (admin/recovery) | OPEN — any authed user, no gate |
| create_campaign | p_company_id, p_data | I:recovery_campaigns | no | no | no | campaigns.js:313 (admin/recovery) | OPEN — any authed user, no gate |
| create_demand_notice | p_sale_id, p_company_id, p_channel, p_overdue_amount, p_due_date | I:demand_notices | yes | yes(param) | no | reports/demand-notice.html:247 (portal/report viewer) | auth/session-tied (anon report context) |
| create_noc_request | p_company_id, p_data | I:noc | no | no | no | noc.js:507 (admin/recovery) | OPEN — any authed user, no gate |
| create_payment_link | p_company_id, p_client_id, p_sale_id, p_installment_ids[], p_amount, … | I:payment_links/payment_link_status_history/contact_logs | yes | yes(param) | no | payment-links.js:704 (finance/recovery) | auth/caller-tied (sent_by_user_id) — verify |
| create_session | p_data | I:user_sessions | yes | no | no | auth.js:437 | auth/caller-tied (login flow) |
| delete_additional_receivable | p_id, p_company_id | D:additional_receivables | no | yes(param) | no | receivables.js:252 (finance) | company-scoped only |
| delete_agent | p_id, p_company_id | D/U:agents | no | yes(param) | no | agents.js:1266 (admin) | company-scoped only |
| delete_agent_commission_payment | p_id, p_company_id | D:agent_commission_payments | no | yes(param) | no | agents.js:1787 (admin/finance) | company-scoped only |
| delete_agent_transaction | p_id, p_company_id | D:agent_transactions | no | yes(param) | no | agenttransactions.js:206 (admin/finance) | company-scoped only |
| delete_bank | p_id, p_company_id | D:banks | no | yes(param) | no | banks.js:135 (admin) | company-scoped only |
| delete_campaign | p_id, p_company_id | D:recovery_campaigns | no | yes(param) | no | campaigns.js:467 (admin/recovery) | company-scoped only |
| delete_client_simple | p_id, p_company_id | D:clients | no | yes(param) | no | NONE | company-scoped only · likely cascade/dead |
| delete_commission_structure | p_id, p_company_id | D:commission_structures | no | yes(param) | no | agents.js:1666 (admin/finance) | company-scoped only |
| delete_floor | p_id, p_company_id | D:floors | no | yes(param) | no | store/db.js:546 (admin/categories) | company-scoped only |
| delete_message_template | p_id, p_company_id | D:message_templates | no | yes(param) | no | comms-center.js:273 (admin) | company-scoped only |
| delete_noc | p_id, p_company_id | D:noc | no | yes(param) | no | noc.js:667 (admin/recovery) | company-scoped only |
| delete_payment | p_payment_id, p_company_id, p_deleted_by | D:payments; U:installments | no | yes(param) | no | NONE (cancel_payment used instead) | company-scoped only · DEAD but DESTRUCTIVE — hard-deletes payments. HIGH |
| delete_payment_method | p_id, p_company_id | D:company_payment_methods | no | yes(param) | no | payment-methods.js:256 (admin/finance) | company-scoped only |
| delete_pdc_cheque | p_id, p_company_id | D:pdc_cheques | no | yes(param) | no | payments.js:1855 (finance) | company-scoped only |
| delete_project | p_id, p_company_id | D:projects | no | yes(param) | no | store/db.js:396 (admin) | company-scoped only |
| delete_project_bank_account | p_id, p_company_id | D:project_bank_accounts | no | yes(param) | no | store/db.js:469 (admin) | company-scoped only |
| delete_project_expense | p_id, p_company_id | D:project_expenses | no | yes(param) | no | store/db.js:505 (admin) | company-scoped only |
| delete_project_milestone | p_id, p_company_id | D:project_milestones | no | yes(param) | no | store/db.js:433 (admin) | company-scoped only |
| delete_sa_announcement | p_id | D:sa_announcements | no | no | no | super-admin.js:700 (platform super-admin) | OPEN — any authed user, no gate (platform table, no company scope; relies on super-admin UI only) |
| delete_sale_amendment | p_id, p_company_id | D:sale_amendments | no | yes(param) | no | sales.js:2815 (admin) | company-scoped only |
| delete_sale_document | p_id, p_company_id | D:sale_documents | no | yes(param) | no | sales.js:2863 (admin) | company-scoped only |
| delete_sale_type | p_id, p_company_id | D:category_sale_types | no | yes(param) | no | store/db.js:678 (admin/categories) | company-scoped only · ⚠️ **PUBLIC EXECUTE** (`=X` in proacl → anon-callable) |
| delete_unit | p_id, p_company_id | D:units | no | yes(param) | no | store/db.js:196, cascade-delete.js:15, units.js:1179/1202 (admin) | company-scoped only |
| delete_unit_simple | p_id, p_company_id | D:units | no | yes(param) | no | NONE | company-scoped only · likely cascade/dead |
| delete_unit_status | p_id, p_company_id | D:category_unit_statuses | no | yes(param) | no | store/db.js:634 (admin/categories) | company-scoped only |
| delete_unit_type | p_id, p_company_id | D:category_unit_types | no | yes(param) | no | store/db.js:589 (admin/categories) | company-scoped only |
| enqueue_message | p_company_id, p_data | I:message_log | yes | yes(param) | no | NONE (server-side dispatch) | internal/no frontend |
| generate_payment_link_ref | p_company_id | I/U:voucher_sequences | no | no | no | NONE (internal helper) | internal/no frontend |
| generate_recovery_radar | p_company_id, p_target_date, p_top_n, p_generated_by | I:recovery_radar_logs | no | yes(param) | no | radar.js:365 (admin/recovery) + cron | company-scoped only |
| generate_voucher_no | p_company_id, p_prefix | I/U:voucher_sequences | no | no | no | NONE (internal helper) | internal/no frontend |
| get_setup_progress | (none) | I:company_setup_progress | yes | no | no | onboarding.js:117 | auth/caller-tied (caller's own company) |
| log_auth_event | p_company_id, p_data | I:auth_events | no | no | no | auth.js:711/723 — **anon=X** | auth flow (anon by design) |
| log_message_sent | p_company_id, p_data | I:message_log | no | no | no | legalcases.js:442 (admin/recovery) | OPEN — any authed user, no gate |
| log_radar_action | p_radar_log_id, p_client_id, p_action_taken, p_action_by, p_company_id | I:radar_action_logs | no | no | no | radar.js:301/312/323 (admin/recovery) | OPEN — any authed user, no gate |
| mark_pdc_bounced | p_cheque_id, p_company_id, p_bounce_date, p_bounce_reason | U:pdc_cheques/payments; I:escalations | no | yes(param) | no | pdc.js:491, payments.js:1915 (finance) | company-scoped only |
| mark_promise_broken | p_promise_id, p_broken_reason, p_updated_by | U:payment_promises; I:escalations | no | no | no | promises.js:633 (recovery) | OPEN — any authed user, no gate |
| portal_login | p_company_code, p_email, p_password | I/D:portal_sessions; U:portal_clients | yes | no | no | buyer-portal (anon=X) | auth flow (anon portal login) |
| postpone_promise | p_promise_id, p_new_date, p_postpone_reason, p_updated_by | I/U:payment_promises | no | no | no | promises.js:683 (recovery) | OPEN — any authed user, no gate |
| reject_payment_link | p_payment_link_id, p_rejected_by, p_rejection_reason | U:payment_links; I:payment_link_status_history | yes | no | no | payment-links.js:1050 (finance) | auth/caller-tied — verify |
| remove_client_from_campaign | p_campaign_id, p_client_id, p_company_id | D:campaign_clients | no | yes(param) | no | campaigns.js:436 (admin/recovery) | company-scoped only |
| remove_ip_whitelist_entry | p_company_id, p_id | D:company_ip_whitelists | no | yes(param) | no | admin.js:761 (admin Settings) | company-scoped only |
| save_company_targets | p_company_id, p_monthly, p_annual | I/U:company_targets | no | no | no | admin.js:113 (admin) | OPEN — any authed user, no gate |
| save_security_settings | p_company_id, p_data | I/U:company_security_settings | no | yes(param) | no | admin.js:719/731 (admin Settings) | company-scoped only — ⚠️ security config; relies on UI only |
| seed_default_categories | p_company_id, p_project_id | I:category_unit_types/statuses | no | no | no | NONE (server-side seed) | internal/no frontend |
| seed_default_templates | p_company_id | I:message_templates | no | yes(param) | no | comms-center.js:143 (admin) | company-scoped only |
| send_payment_link_reminder | p_payment_link_id, p_sent_by | U:payment_links; I:payment_link_reminders | no | no | no | payment-links.js:262 (finance) | OPEN — any authed user, no gate |
| send_signup_otp | p_email, p_ip | I/U:email_otps | no | no | no | signup.js:564 (anon signup) | auth flow (anon by design) |
| set_company_feature_flag | p_company_id, p_feature_key, p_is_enabled, p_note, p_set_by | I/U:company_feature_flags | no | no | no | super-admin.js:910 (platform super-admin) | OPEN — any authed user, no gate — ⚠️ feature flags; relies on super-admin UI only. HIGH |
| signup_new_company | (11 args) | I:companies/app_users/subscriptions | no | no | no | signup.js:394 (anon signup) | auth flow (anon by design — provisions new tenant) |
| snapshot_installment_schedule | p_company_id, p_sale_id | I:installment_snapshots | no | yes(param) | no | payments.js:2369 (finance) | company-scoped only |
| submit_buyer_complaint | p_session_token, p_subject, p_message | I:buyer_complaints | yes | no | no | buyer-portal (**PUBLIC `=X` + anon=X**) | auth/session-tied (portal session token) |
| update_radar_outcome | p_radar_log_id, p_client_id, p_payment_amount, p_payment_date | I/U:radar_action_logs | no | no | no | radar.js:334 (admin/recovery) | OPEN — any authed user, no gate |
| upload_payment_screenshot | p_payment_link_id, p_screenshot_url, … | U:payment_links; I:payment_link_status_history | no | no | no | payment-links.js:855 (buyer/finance) | OPEN — any authed user, no gate (buyer-facing link upload) |
| upload_sale_document | p_company_id, p_sale_id, p_document_type, p_document_name, p_document_url, p_uploaded_by | I:sale_documents | no | yes(param) | no | sales.js:2844 (admin) | company-scoped only |
| upsert_bank | p_company_id, p_data, p_id | I/U:banks | no | yes(param) | no | banks.js:120 (admin) | company-scoped only |
| upsert_client | p_company_id, p_data, p_id | I/U:clients | no | yes(param) | no | NONE (create_client/update_client used) | company-scoped only · likely DEAD (note: create_client/update_client are the gated paths) |
| upsert_commission_structure | p_company_id, p_data | I/U:commission_structures | no | yes(param) | no | agents.js:1637 (admin/finance) | company-scoped only |
| upsert_legal_case | p_company_id, p_data, p_id | I/U:legal_cases | no | yes(param) | no | legalcases.js:343 (admin/recovery) | company-scoped only |
| upsert_message_template | p_company_id, p_data | I/U:message_templates | no | yes(param) | no | comms-center.js:257 (admin) | company-scoped only |
| upsert_payment_method | p_company_id, p_data, p_id | I/U:company_payment_methods | no | yes(param) | no | payment-methods.js:215 (admin/finance) | company-scoped only |
| upsert_possession | p_company_id, p_data, p_id | I/U:possessions | no | yes(param) | no | possession.js:220 (admin) | company-scoped only |
| upsert_project_bank_account | p_company_id, p_data, p_id | I/U:project_bank_accounts | no | yes(param) | no | store/db.js:458 (admin) | company-scoped only |
| upsert_project_expense | p_company_id, p_data, p_id | I/U:project_expenses | no | yes(param) | no | store/db.js:494 (admin) | company-scoped only |
| upsert_project_milestone | p_company_id, p_data, p_id | I/U:project_milestones | no | yes(param) | no | store/db.js:422 (admin) | company-scoped only |
| upsert_sa_announcement | p_data | I/U:sa_announcements | no | no | no | super-admin.js:674/689 (platform super-admin) | OPEN — any authed user, no gate (platform table; super-admin UI only) |
| verify_payment_link | p_payment_link_id, p_verified_by, p_verified_by_user_id, … | U:payment_links; I:payment_link_status_history | yes | no | no | payment-links.js:994 (finance) | auth/caller-tied (verified_by_user_id) — verify |

## Summary
- **Total rows triaged:** 93 mutating SECURITY DEFINER RPCs with no admin/role check.
- **Truly OPEN (no caller-resolve AND no tenant predicate):** ~28 by heuristic; of these the frontend-reachable *business* writes needing a gate are ~17 (e.g. create_additional_receivable, create_blacklist_entry, create_campaign, create_noc_request, cancel_payment_link, log_message_sent, log_radar_action, mark_promise_broken, postpone_promise, save_company_targets, send_payment_link_reminder, update_radar_outcome, calculate_client_health_score, set_company_feature_flag, upsert/delete_sa_announcement, archive_old_audit_logs) — the rest of the 28 are internal helpers/triggers or intentional anon auth/signup/portal flows.
- **Company-scoped-but-unrole-gated (tenant predicate present, but `p_company_id` is caller-supplied — cross-tenant-spoofable by any authed user, no role check):** ~49 (most `delete_*`, `upsert_*`, `add_*`, `create_app_user`, `create_agent_*`, `mark_pdc_bounced`, etc.).
- **Internal / no frontend (helpers, triggers, the 4 `_core` already revoked, dead RPCs):** ~12 (incl. dead-but-destructive `delete_payment`, `create_agent_commission_payment`, `upsert_client`, `delete_client_simple`, `delete_unit_simple`).
- **⚠️ Flags for Step 2 priority:** `create_app_user` (creates users+role, no admin gate), `delete_payment` (hard-delete, dead but callable), `set_company_feature_flag` / `save_security_settings` / `upsert_sa_announcement` / `delete_sa_announcement` (privileged config relying on super-admin/admin UI only), and **PUBLIC-executable** `delete_sale_type` + `submit_buyer_complaint` (`=X` in proacl). Real fix everywhere = add `_rms_caller` + verify `v_me.company_id = p_company_id` (+ role where appropriate); company-in-WHERE alone is not sufficient. **Conservative: no "all clear" until each row is bucketed and fixed+verified.**
