-- =====================================================================
-- 012 — Seed platform_subscription_features (tier × product → limits)
--                + platform_email_templates (12 transactional templates)
--                + backfill platform_subscription_usage for existing orgs
-- =====================================================================

-- ----- TRIAL -----
INSERT INTO public.platform_subscription_features (tier, product, feature_key, feature_value, display_label, display_order) VALUES
  ('trial','crm','max_users','3'::jsonb,'3 users',10),
  ('trial','crm','max_contacts','100'::jsonb,'100 contacts',20),
  ('trial','crm','max_deals','50'::jsonb,'50 deals',30),
  ('trial','crm','max_pipelines','1'::jsonb,'1 pipeline',40),
  ('trial','crm','max_emails_per_day','50'::jsonb,'50 emails/day',50),
  ('trial','crm','max_storage_mb','100'::jsonb,'100 MB storage',60),
  ('trial','crm','custom_fields','false'::jsonb,'No custom fields',70),
  ('trial','crm','workflow_automation','false'::jsonb,'No automation',80),
  ('trial','crm','api_access','false'::jsonb,'No API',90),
  ('trial','crm','watermark_exports','true'::jsonb,'TRIAL watermark',100),
  ('trial','rms','max_users','1'::jsonb,'1 user',10),
  ('trial','rms','max_projects','1'::jsonb,'1 project',20),
  ('trial','rms','max_units','10'::jsonb,'10 units',30),
  ('trial','rms','max_clients','10'::jsonb,'10 clients',40),
  ('trial','rms','max_agents','2'::jsonb,'2 agents',50);

-- ----- STARTER -----
INSERT INTO public.platform_subscription_features (tier, product, feature_key, feature_value, display_label, display_order) VALUES
  ('starter','crm','max_users','5'::jsonb,'5 users',10),
  ('starter','crm','max_contacts','2500'::jsonb,'2,500 contacts',20),
  ('starter','crm','max_deals','500'::jsonb,'500 active deals',30),
  ('starter','crm','max_pipelines','1'::jsonb,'1 pipeline',40),
  ('starter','crm','max_storage_mb','5120'::jsonb,'5 GB storage',50),
  ('starter','crm','max_emails_per_month','1000'::jsonb,'1,000 emails/month',60),
  ('starter','crm','custom_fields','{"limit":5}'::jsonb,'5 custom fields',70),
  ('starter','crm','workflow_automation','false'::jsonb,'No automation',80),
  ('starter','crm','api_access','false'::jsonb,'No API',90),
  ('starter','crm','reports_builtin','5'::jsonb,'5 built-in reports',100),
  ('starter','crm','mobile_web','true'::jsonb,'Mobile web',110),
  ('starter','rms','max_users','5'::jsonb,'5 users',10),
  ('starter','rms','max_projects','1'::jsonb,'1 project',20),
  ('starter','rms','max_units','500'::jsonb,'500 units',30),
  ('starter','rms','max_clients','500'::jsonb,'500 clients',40),
  ('starter','rms','max_agents','10'::jsonb,'10 agents',50);

-- ----- PROFESSIONAL -----
INSERT INTO public.platform_subscription_features (tier, product, feature_key, feature_value, display_label, display_order) VALUES
  ('professional','crm','max_users','25'::jsonb,'25 users',10),
  ('professional','crm','max_contacts','25000'::jsonb,'25,000 contacts',20),
  ('professional','crm','max_deals','null'::jsonb,'Unlimited deals',30),
  ('professional','crm','max_pipelines','null'::jsonb,'Unlimited pipelines',40),
  ('professional','crm','max_storage_mb','51200'::jsonb,'50 GB storage',50),
  ('professional','crm','max_emails_per_month','10000'::jsonb,'10,000 emails/month',60),
  ('professional','crm','custom_fields','{"limit":25}'::jsonb,'25 custom fields',70),
  ('professional','crm','workflow_automation','{"limit":10}'::jsonb,'10 workflows',80),
  ('professional','crm','api_access','"read_only"'::jsonb,'API read-only',90),
  ('professional','crm','reports_custom','true'::jsonb,'Custom reports',100),
  ('professional','crm','bulk_operations','true'::jsonb,'Bulk ops',110),
  ('professional','crm','teams_territories','true'::jsonb,'Teams + territory',120),
  ('professional','crm','audit_log_access','true'::jsonb,'Audit log',130),
  ('professional','crm','support_sla_hours','24'::jsonb,'24h email support',140),
  ('professional','rms','max_users','25'::jsonb,'25 users',10),
  ('professional','rms','max_projects','5'::jsonb,'5 projects',20),
  ('professional','rms','max_units','5000'::jsonb,'5,000 units',30),
  ('professional','rms','max_clients','5000'::jsonb,'5,000 clients',40),
  ('professional','rms','max_agents','50'::jsonb,'50 agents',50);

-- ----- ENTERPRISE -----
INSERT INTO public.platform_subscription_features (tier, product, feature_key, feature_value, display_label, display_order) VALUES
  ('enterprise','crm','max_users','null'::jsonb,'Unlimited users',10),
  ('enterprise','crm','max_contacts','null'::jsonb,'Unlimited contacts',20),
  ('enterprise','crm','max_deals','null'::jsonb,'Unlimited deals',30),
  ('enterprise','crm','max_pipelines','null'::jsonb,'Unlimited pipelines',40),
  ('enterprise','crm','max_storage_mb','512000'::jsonb,'500 GB storage',50),
  ('enterprise','crm','max_emails_per_month','100000'::jsonb,'100k emails/month',60),
  ('enterprise','crm','custom_fields','null'::jsonb,'Unlimited custom',70),
  ('enterprise','crm','workflow_automation','null'::jsonb,'Unlimited workflows',80),
  ('enterprise','crm','api_access','"read_write"'::jsonb,'API read/write',90),
  ('enterprise','crm','sso_sml','true'::jsonb,'SSO + SAML',100),
  ('enterprise','crm','permissions_field_level','true'::jsonb,'Field-level perms',110),
  ('enterprise','crm','approval_workflows','true'::jsonb,'Approval workflows',120),
  ('enterprise','crm','sandbox','true'::jsonb,'Sandbox workspace',130),
  ('enterprise','crm','sla_uptime','"99.9"'::jsonb,'99.9% uptime SLA',140),
  ('enterprise','crm','dedicated_csm','true'::jsonb,'Dedicated CSM',150),
  ('enterprise','rms','max_users','null'::jsonb,'Unlimited users',10),
  ('enterprise','rms','max_projects','null'::jsonb,'Unlimited projects',20),
  ('enterprise','rms','max_units','null'::jsonb,'Unlimited units',30),
  ('enterprise','rms','max_clients','null'::jsonb,'Unlimited clients',40),
  ('enterprise','rms','max_agents','null'::jsonb,'Unlimited agents',50);

-- ----- 12 transactional email templates (global) -----
-- Bodies kept terse for migration; STEP 15 polishes layouts.
INSERT INTO public.platform_email_templates (organization_id, template_key, subject, body_html, body_text, variables, category) VALUES
  (NULL, 'welcome',
    'Welcome to Nexunova, {{full_name}}',
    '<p>Hi {{full_name}},</p><p>Welcome to Nexunova! Your workspace <b>{{company_name}}</b> is ready. Your 7-day free trial ends on {{trial_ends_at}}.</p><p><a href="{{app_url}}">Open your workspace</a></p>',
    'Welcome to Nexunova! Trial ends {{trial_ends_at}}. {{app_url}}',
    '["full_name","company_name","trial_ends_at","app_url"]'::jsonb, 'transactional'),
  (NULL, 'verify_email_otp',
    'Your Nexunova verification code: {{otp}}',
    '<p>Hi {{full_name}},</p><h2>{{otp}}</h2><p>Expires in 10 minutes.</p>',
    'Your Nexunova code: {{otp}} (expires 10 min)',
    '["full_name","otp"]'::jsonb, 'transactional'),
  (NULL, 'team_invitation',
    '{{inviter_name}} invited you to {{company_name}}',
    '<p>{{inviter_name}} invited you to <b>{{company_name}}</b> as <b>{{role}}</b>.</p><p><a href="{{accept_url}}">Accept</a></p><p>Expires {{expires_at}}.</p>',
    '{{inviter_name}} invited you to {{company_name}} as {{role}}. {{accept_url}}',
    '["inviter_name","company_name","role","accept_url","expires_at"]'::jsonb, 'transactional'),
  (NULL, 'password_reset',
    'Reset your Nexunova password',
    '<p>Hi {{full_name}},</p><p><a href="{{reset_url}}">Reset password</a> — expires in 1 hour.</p>',
    'Reset: {{reset_url}}',
    '["full_name","reset_url"]'::jsonb, 'transactional'),
  (NULL, 'trial_day3_tip',
    'Quick tip: get more out of your Nexunova trial',
    '<p>Hi {{full_name}},</p><p>Day 3 of your trial. <a href="{{import_url}}">Import your contacts</a>.</p>',
    'Day 3 tip: import contacts {{import_url}}',
    '["full_name","import_url"]'::jsonb, 'transactional'),
  (NULL, 'trial_day5_nudge',
    '2 days left in your Nexunova trial',
    '<p>Trial ends in 2 days ({{trial_ends_at}}). <a href="{{upgrade_url}}">Upgrade</a>.</p>',
    '2 days left. Upgrade: {{upgrade_url}}',
    '["full_name","trial_ends_at","upgrade_url"]'::jsonb, 'transactional'),
  (NULL, 'trial_day6_final',
    'Your Nexunova trial ends tomorrow',
    '<p>Trial ends tomorrow. <a href="{{upgrade_url}}">Upgrade</a>.</p>',
    'Trial ends tomorrow. {{upgrade_url}}',
    '["full_name","trial_ends_at","upgrade_url"]'::jsonb, 'transactional'),
  (NULL, 'trial_expired',
    'Your Nexunova trial has ended',
    '<p>Workspace is now read-only. Upgrade within 30 days. <a href="{{upgrade_url}}">Upgrade</a>.</p>',
    'Trial ended. {{upgrade_url}}',
    '["full_name","upgrade_url"]'::jsonb, 'transactional'),
  (NULL, 'workspace_deletion_warning',
    'Final warning: workspace data deletes in 7 days',
    '<p>Data deletes in 7 days ({{deletion_date}}). <a href="{{upgrade_url}}">Upgrade</a>.</p>',
    'Data deletes {{deletion_date}}. {{upgrade_url}}',
    '["full_name","deletion_date","upgrade_url"]'::jsonb, 'transactional'),
  (NULL, 'invoice_issued',
    'Invoice {{invoice_number}} from Nexunova',
    '<p>Invoice {{invoice_number}}: {{amount}} {{currency}}, due {{due_date}}. <a href="{{invoice_url}}">View</a></p>',
    'Invoice {{invoice_number}} {{amount}} {{currency}} due {{due_date}}',
    '["full_name","company_name","invoice_number","amount","currency","due_date","invoice_url"]'::jsonb, 'transactional'),
  (NULL, 'payment_receipt',
    'Payment received: {{invoice_number}}',
    '<p>Received {{amount}} {{currency}} for {{invoice_number}}. Thanks!</p>',
    'Payment received {{amount}} {{currency}} for {{invoice_number}}',
    '["full_name","invoice_number","amount","currency"]'::jsonb, 'transactional'),
  (NULL, 'payment_failed',
    'Payment failed',
    '<p>Update payment to avoid interruption. <a href="{{billing_url}}">Update</a></p>',
    'Payment failed: {{billing_url}}',
    '["full_name","company_name","billing_url"]'::jsonb, 'transactional');

-- ----- Initialize usage rows for existing org/subscription -----
DO $$
DECLARE s record;
BEGIN
  FOR s IN SELECT id, company_id, product, tier, current_period_start, current_period_end FROM public.subscriptions LOOP
    INSERT INTO public.platform_subscription_usage
           (organization_id, product, metric, current_value, limit_value, period_start, period_end)
    SELECT s.company_id, s.product,
           regexp_replace(psf.feature_key, '^max_', ''),
           0,
           CASE WHEN jsonb_typeof(psf.feature_value) = 'number' THEN psf.feature_value::text::numeric
                WHEN psf.feature_value ? 'limit' THEN (psf.feature_value->>'limit')::numeric ELSE NULL END,
           s.current_period_start, s.current_period_end
    FROM public.platform_subscription_features psf
    WHERE psf.tier = s.tier AND psf.product = s.product AND psf.feature_key LIKE 'max_%'
    ON CONFLICT (organization_id, product, metric) DO UPDATE SET limit_value = EXCLUDED.limit_value;
  END LOOP;
END $$;

UPDATE public.platform_subscription_usage psu
SET current_value = COALESCE(actual.cnt, 0)
FROM (
  SELECT 'users' AS metric, company_id, COUNT(*)::numeric AS cnt FROM public.app_users WHERE status='active' GROUP BY company_id
  UNION ALL SELECT 'projects', company_id, COUNT(*)::numeric FROM public.projects WHERE status='active' GROUP BY company_id
  UNION ALL SELECT 'units', company_id, COUNT(*)::numeric FROM public.units GROUP BY company_id
  UNION ALL SELECT 'clients', company_id, COUNT(*)::numeric FROM public.clients WHERE status='active' GROUP BY company_id
  UNION ALL SELECT 'agents', company_id, COUNT(*)::numeric FROM public.agents WHERE status='active' GROUP BY company_id
) actual
WHERE psu.organization_id = actual.company_id AND psu.product = 'rms' AND psu.metric = actual.metric;
