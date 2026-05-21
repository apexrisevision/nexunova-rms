-- =====================================================================
-- 007 — spec-name alias views (security_invoker so RLS applies)
-- =====================================================================
CREATE OR REPLACE VIEW public.platform_organizations
WITH (security_invoker = true)
AS
SELECT
  c.id, c.slug, c.company_name AS name, c.logo_url, c.brand_color,
  c.country, c.timezone, c.currency, c.company_type AS industry,
  c.industry_tags, c.team_size_range, c.signup_source,
  c.owner_user_id, c.status, c.suspended_at, c.suspension_reason,
  c.onboarding_complete, c.business_email AS contact_email,
  c.business_phone AS contact_phone, c.address, c.city,
  c.created_at, c.updated_at, c.deleted_at,
  c.company_code, c.company_name
FROM public.companies c
WHERE c.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.platform_users
WITH (security_invoker = true)
AS
SELECT
  au.id, au.auth_user_id, au.email, au.full_name, au.phone,
  au.avatar_url, au.email_verified_at, au.phone_verified_at,
  au.last_login_at, au.preferences, au.status, au.is_super_admin,
  au.created_at, au.updated_at,
  au.username, au.company_id AS primary_organization_id,
  au.role AS primary_organization_role, au.auth_provider
FROM public.app_users au;

CREATE OR REPLACE VIEW public.platform_subscriptions
WITH (security_invoker = true)
AS
SELECT
  s.id, s.company_id AS organization_id, s.product, s.tier, s.status,
  s.billing_cycle, s.current_period_start, s.current_period_end,
  s.trial_started_at, s.trial_ends_at, s.cancelled_at,
  s.payment_method, s.external_subscription_id,
  s.amount AS amount_pkr, s.currency, s.discount_percent,
  s.legacy_plan_name, s.plan_id AS legacy_plan_id,
  s.metadata, s.created_at, s.updated_at
FROM public.subscriptions s;

CREATE OR REPLACE VIEW public.platform_invoices
WITH (security_invoker = true)
AS
SELECT
  i.id, i.company_id AS organization_id, i.product, i.invoice_number,
  i.amount, i.tax_amount, i.currency, i.status, i.line_items,
  i.pdf_storage_path, i.sent_at, i.voided_at,
  i.created_at, i.updated_at,
  i.due_date AS due_at, i.subscription_id,
  i.issue_date, i.period_start, i.period_end, i.paid_date,
  i.plan_id AS legacy_plan_id, i.plan_name AS legacy_plan_name
FROM public.invoices i;

CREATE OR REPLACE VIEW public.platform_audit_log
WITH (security_invoker = true)
AS
SELECT
  al.id,
  al.company_id     AS organization_id,
  al.changed_by     AS user_id,
  al.changed_by_name AS user_name,
  al.changed_by_role AS user_role,
  al.table_name     AS entity_type,
  al.record_id      AS entity_id,
  al.action,
  al.old_data       AS before_data,
  al.new_data       AS after_data,
  al.changed_fields,
  al.ip_address,
  al.user_agent,
  al.session_id,
  al.request_id,
  al.module,
  al.reason,
  al.is_sensitive,
  al.changed_at     AS created_at
FROM public.audit_logs al;
