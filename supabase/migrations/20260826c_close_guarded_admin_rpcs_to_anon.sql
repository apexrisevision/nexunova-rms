-- ============================================================================
-- Close the anon hole on the remaining admin-only / dead SECURITY DEFINER RPCs.
-- ----------------------------------------------------------------------------
-- Third and final pass, after 20260826a (internal helpers + cron) and
-- 20260826b (the 14 functions with no caller guard at all).
--
-- Every function below carries its own caller check (auth.uid, _rms_caller,
-- p_session_token, no_session, is_admin), so this is defence in depth rather
-- than a proven leak. What it removes is the ability for anyone holding the
-- publishable key - which ships in the page source of sales-portal.html - to
-- reach an admin entry point at all.
--
-- How each function was cleared for revocation:
--   * every RPC name called from js/, reports/, scripts/, supabase/functions/
--     and every root *.html was mapped to its caller files;
--   * the anon-role pages are sales-portal.html + js/portal-*.js,
--     buyer-portal.html, availability.html, pay.html, signup.html, and the
--     pre-login files js/auth.js, js/otp.js, js/forgot-password.js,
--     js/pages/signup*.js - none of them call anything below;
--   * the admin app establishes a real Supabase Auth session at login
--     (js/auth.js "session bridge"), so it runs as `authenticated`, which keeps
--     its own explicit grant here;
--   * reports/*.html open from the admin app in the same origin and share that
--     session, so they are `authenticated` too;
--   * the p_session_token functions with no caller left (assign_lead,
--     update_lead_stage, get_team_activity, mark_sales_announcements_seen,
--     save_maps_key, disconnect_fb, list_deleted_leads, get_daily_report,
--     get_agent_conversion, get_portal_client_data, get_buyer_* ,
--     submit_buyer_complaint) were each superseded by a later portal rewrite -
--     confirmed with git log -S on the portal files.
--
-- PUBLIC must be revoked alongside anon: the grant these functions carry is
-- `=X/postgres`, i.e. PUBLIC, and anon inherits EXECUTE through it. Revoking
-- anon alone is a fake lock.
-- ============================================================================

REVOKE ALL ON FUNCTION public.admin_approve_sales_user(p_id uuid, p_project_id uuid, p_commission_percent numeric, p_link_agent_id uuid, p_role text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_approve_sales_user_grouped(p_id uuid, p_assignments jsonb, p_role text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_cancel_reservation(p_reservation_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_crm_notify() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_join_code(p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_portal_signup(p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_agreement_clauses(p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reassign_leads(p_lead_ids uuid[], p_to uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reassign_member_leads(p_from uuid, p_to uuid, p_scope text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reject_sales_user(p_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_crm_notify(p_whatsapp boolean, p_push boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_join_code(p_company_id uuid, p_code text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_portal_signup(p_company_id uuid, p_enabled boolean, p_scope text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_sale_submission(p_id uuid, p_overrides jsonb, p_client_id_to_link uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_lead(p_session_token text, p_lead_id uuid, p_to_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_sale_agent(p_company_id uuid, p_sale_ids uuid[], p_agent_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_payment(p_payment_id uuid, p_company_id uuid, p_cancelled_by uuid, p_reason text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.convert_reservation_prefill(p_reservation_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_app_user(p_company_id uuid, p_full_name text, p_role text, p_password text, p_email text, p_phone text, p_module_permissions jsonb, p_username text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_app_user(p_company_id uuid, p_full_name text, p_role text, p_password text, p_email text, p_phone text, p_module_permissions jsonb, p_username text, p_project_ids uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_pdc_bundle(p_company_id uuid, p_sale_id uuid, p_cheques jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_sales_announcement(p_company_id uuid, p_title text, p_body text, p_important boolean, p_attachments jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deactivate_agreement_clause(p_company_id uuid, p_clause_key uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deactivate_sales_user(p_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_legal_case(p_id uuid, p_company_id uuid, p_reason text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_map_shape(p_artwork_id uuid, p_slot_code text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_sales_announcement(p_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_sales_user(p_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.disconnect_fb(p_session_token text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_installment_schedule(p_sale_id uuid, p_company_id uuid, p_schedule jsonb, p_reason text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_payment(p_payment_id uuid, p_company_id uuid, p_data jsonb, p_reason text, p_edited_by uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_payment_meta(p_payment_id uuid, p_company_id uuid, p_payment_date date, p_payment_method text, p_reference_no text, p_bank_name text, p_bank_id uuid, p_notes text, p_updated_by uuid, p_reason text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_sale(p_sale_id uuid, p_company_id uuid, p_data jsonb, p_reason text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_unit_change(p_company_id uuid, p_change_date date, p_project_id uuid, p_sale_id uuid, p_client_id uuid, p_old_unit_id uuid, p_new_unit_id uuid, p_price_per_sqft numeric, p_area_sqft numeric, p_discount numeric, p_installments jsonb, p_change_fee numeric, p_documentation_charges numeric, p_other_charges numeric, p_other_charges_desc text, p_charges_paid_by text, p_charges_payment_method text, p_charges_reference text, p_reason text, p_notes text, p_created_by text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.find_agent_matches_for_signup(p_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_agent_agreement_record(p_company_id uuid, p_sales_user_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_agent_conversion(p_session_token text, p_days integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_agent_outstanding(p_company_id uuid, p_project_id uuid, p_agent_id uuid, p_as_of date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_agreement_compliance(p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_approval_settings(p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_buyer_complaints(p_session_token text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_buyer_nocs_for_portal(p_session_token text, p_unit_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_buyer_possession_for_portal(p_session_token text, p_unit_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_campaign_clients(p_id uuid, p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_campaign_officers(p_id uuid, p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_daily_call_report(p_company_id uuid, p_date date, p_officer text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_daily_report(p_session_token text, p_day date, p_member_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_escalation_timeline(p_escalation_id uuid, p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_map_editor_floors() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_map_editor_plan(p_plan_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_officer_target(p_data jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_overdue_clients_for_campaign(p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_portal_client_data(p_session_token text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_recovery_queue(p_company_id uuid, p_officer_id uuid, p_project_id uuid, p_date date, p_limit integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_reservations_admin(p_company_id uuid, p_project_id uuid, p_status text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_sale_received(p_sale_id uuid, p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_sale_submissions_admin(p_company_id uuid, p_project_id uuid, p_status text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_team_activity(p_session_token text, p_limit integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_umbrella_approval_context(p_sales_user_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_unit_change_by_id(p_id uuid, p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_available_units_for_change(p_company_id uuid, p_project_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_deleted_leads(p_session_token text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_sale_types(p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_sales_announcements_admin(p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_sales_users_admin(p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_unassigned_leads(p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_unit_changes_for_fnav(p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_reservation_converted(p_reservation_id uuid, p_sale_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_sales_announcements_seen(p_session_token text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.merge_agents(p_source uuid, p_target uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reactivate_sales_user(p_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_payment_simple(p_company_id uuid, p_sale_id uuid, p_amount numeric, p_payment_date date, p_payment_method text, p_reference_no text, p_bank_name text, p_notes text, p_created_by uuid, p_cheque_date date, p_bank_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_sale_submission(p_id uuid, p_reason text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_agreement_hold(p_company_id uuid, p_sales_user_id uuid, p_mode text, p_reason text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_escalation(p_id uuid, p_company_id uuid, p_resolution text, p_resolved_by text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rotate_sales_signup_token(p_company_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_approval_settings(p_company_id uuid, p_data jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_map_shape(p_artwork_id uuid, p_slot_code text, p_points jsonb, p_label_x numeric, p_label_y numeric, p_zone_group text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_maps_key(p_session_token text, p_key text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_company_logo(p_company_id uuid, p_url text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_officer_target_v2(p_data jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_sales_user_role(p_id uuid, p_role text, p_parent_sales_user_id uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shift_unit_amount(p_company_id uuid, p_from_sale_id uuid, p_to_sale_id uuid, p_amount numeric, p_shift_date date, p_narration text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_buyer_complaint(p_session_token text, p_subject text, p_message text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_app_user(p_user_id uuid, p_company_id uuid, p_full_name text, p_role text, p_email text, p_phone text, p_status text, p_password text, p_module_permissions jsonb, p_project_ids uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_client(p_id uuid, p_company_id uuid, p_data jsonb, p_reason text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_lead_stage(p_session_token text, p_id uuid, p_status text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_legal_case_costs(p_id uuid, p_company_id uuid, p_legal_costs jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_legal_case_documents(p_id uuid, p_company_id uuid, p_documents jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_sales_announcement(p_id uuid, p_title text, p_body text, p_important boolean, p_attachments jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_agreement_clause(p_company_id uuid, p_title text, p_body text, p_clause_key uuid, p_seq integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_sale_type(p_company_id uuid, p_data jsonb, p_id uuid) FROM PUBLIC, anon;
