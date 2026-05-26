# Nexunova RMS — Database Audit (read-only)

**Date:** 2026-05-26
**Schema audited:** `public`
**Method:** Supabase MCP, `execute_sql` against live project (no changes made)

## Scope summary

| Object | Count |
|---|---|
| Base tables | 86 |
| Views | 5 |
| Functions | 394 |
| Triggers | 59 |
| RLS policies | 103 |
| Foreign keys | 139 |

### Installed extensions (public/relevant)
`pgcrypto` 1.3 · `uuid-ossp` 1.1 · `pg_stat_statements` 1.11 · `plpgsql` 1.0 · `supabase_vault` 0.3.1
(All other Supabase-bundled extensions are *available but not installed*.)

### Security model at a glance
- **RMS business tables**: a single `deny_all_anon` policy (`USING false` / `CHECK false`) for roles `anon, authenticated`. Direct PostgREST access is fully blocked; **all access flows through `SECURITY DEFINER` RPCs** (388 of 394 functions are `SECURITY DEFINER`).
- **`platform_*` tables**: proper granular per-command policies using helper fns `is_org_admin()`, `is_org_member()`, `is_nexunova_staff()`, `current_app_user_id()`.
- **A few RMS tables** use `company_isolation`-style policies (two different mechanisms — see Observations).
- **RLS DISABLED** on 4 tables: `auth_events`, `company_feature_flags`, `sa_announcements`, `sa_support_tickets`.

---

# 1. Tables & Columns

> Format: `column_name type [NOT NULL] [DEFAULT …]`. Primary keys are listed in §2.

#### additional_receivables
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - sale_id uuid NOT NULL
  - unit_id uuid
  - client_id uuid
  - amount numeric NOT NULL DEFAULT 0
  - description text NOT NULL
  - due_date date
  - status text NOT NULL DEFAULT 'pending'::text
  - paid_amount numeric DEFAULT 0
  - paid_date date
  - notes text
  - created_by uuid
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### agent_commission_payments
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - agent_id uuid NOT NULL
  - sale_id uuid
  - amount numeric(15,2) NOT NULL
  - payment_date date NOT NULL DEFAULT CURRENT_DATE
  - payment_method text NOT NULL DEFAULT 'bank_transfer'::text
  - reference_no text
  - notes text
  - created_by text
  - created_at timestamptz NOT NULL DEFAULT now()

#### agent_transactions
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - agent_id uuid NOT NULL
  - transaction_type text NOT NULL
  - amount numeric NOT NULL
  - related_sale_id uuid
  - related_cancellation_id uuid
  - payment_method text
  - reference text
  - notes text
  - created_by text
  - created_at timestamptz DEFAULT now()
  - related_transfer_id uuid

#### agents
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - agent_code text NOT NULL
  - full_name text NOT NULL
  - cnic text
  - phone text NOT NULL
  - email text
  - address text
  - commission_percent numeric(5,2) DEFAULT NULL::numeric
  - status text NOT NULL DEFAULT 'active'::text
  - notes text
  - created_by uuid
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()
  - bank_name text
  - bank_account_no text
  - bank_account_title text
  - cnic_front_url text
  - cnic_back_url text
  - profile_photo_url text
  - join_date date
  - termination_date date
  - total_sales_count integer NOT NULL DEFAULT 0
  - total_sales_amount numeric NOT NULL DEFAULT 0
  - total_commission_earned numeric NOT NULL DEFAULT 0
  - total_commission_paid numeric NOT NULL DEFAULT 0
  - rating numeric
  - total_commission_pending numeric DEFAULT (total_commission_earned - total_commission_paid)
  - territory text
  - monthly_target numeric(15,2)
  - quarterly_target numeric(15,2)
  - contract_doc_url text
  - parent_agent_id uuid

#### app_users
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - full_name text NOT NULL
  - username text NOT NULL
  - email text NOT NULL
  - phone text
  - role text NOT NULL DEFAULT 'staff'::text
  - password_hash text
  - auth_provider text NOT NULL DEFAULT 'custom'::text
  - auth_user_id uuid
  - status text NOT NULL DEFAULT 'active'::text
  - email_verified boolean NOT NULL DEFAULT false
  - last_login_at timestamptz
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()
  - module_permissions jsonb NOT NULL DEFAULT '{}'::jsonb
  - is_super_admin boolean NOT NULL DEFAULT false
  - needs_password_reset boolean NOT NULL DEFAULT false
  - auth_migration_completed_at timestamptz
  - avatar_url text
  - email_verified_at timestamptz
  - phone_verified_at timestamptz
  - preferences jsonb NOT NULL DEFAULT '{}'::jsonb
  - failed_login_attempts integer NOT NULL DEFAULT 0
  - locked_until timestamptz
  - session_version integer NOT NULL DEFAULT 1

#### audit_log_archive
  - id bigint NOT NULL
  - company_id uuid
  - table_name text NOT NULL
  - record_id text
  - action text NOT NULL
  - old_data jsonb
  - new_data jsonb
  - changed_fields text[]
  - changed_by uuid
  - changed_by_name text
  - changed_by_role text
  - changed_at timestamptz NOT NULL
  - ip_address inet
  - user_agent text
  - session_id text
  - request_id text
  - module text
  - reason text
  - is_sensitive boolean NOT NULL DEFAULT false

#### audit_logs
  - id bigint NOT NULL DEFAULT nextval('audit_logs_id_seq'::regclass)
  - company_id uuid
  - table_name text NOT NULL
  - record_id text
  - action text NOT NULL
  - old_data jsonb
  - new_data jsonb
  - changed_fields text[]
  - changed_by uuid
  - changed_by_name text
  - changed_by_role text
  - changed_at timestamptz NOT NULL DEFAULT now()
  - ip_address inet
  - user_agent text
  - session_id text
  - request_id text
  - module text
  - reason text
  - is_sensitive boolean NOT NULL DEFAULT false

#### auth_events
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid
  - user_id uuid
  - username text
  - event_type text NOT NULL
  - ip_address text
  - user_agent text
  - details jsonb
  - created_at timestamptz DEFAULT now()

#### banks
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - bank_name text NOT NULL
  - account_title text NOT NULL
  - account_number text NOT NULL
  - iban text
  - branch text
  - is_active boolean NOT NULL DEFAULT true
  - sort_order integer DEFAULT 0
  - notes text
  - created_at timestamptz DEFAULT now()

#### blacklisted_clients
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - client_id uuid NOT NULL
  - reason text NOT NULL
  - blacklist_date date NOT NULL DEFAULT CURRENT_DATE
  - related_cancellation_id uuid
  - approved_by text
  - is_active boolean DEFAULT true
  - removed_date date
  - removed_by text
  - removal_reason text
  - created_at timestamptz DEFAULT now()
  - reason_type text DEFAULT 'other'::text

#### buyer_complaints
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - client_id uuid NOT NULL
  - subject text NOT NULL
  - message text NOT NULL
  - status text NOT NULL DEFAULT 'open'::text
  - response text
  - responded_by text
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()
  - responded_at timestamptz

#### campaign_clients
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - campaign_id uuid NOT NULL
  - client_id uuid NOT NULL
  - assigned_at timestamptz NOT NULL DEFAULT now()
  - assigned_by text
  - status text NOT NULL DEFAULT 'active'::text

#### category_payment_types
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid
  - type_code text NOT NULL
  - type_name text NOT NULL
  - description text
  - sort_order integer NOT NULL DEFAULT 0
  - is_active boolean NOT NULL DEFAULT true
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()

#### category_unit_statuses
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid
  - status_code text NOT NULL
  - status_name text NOT NULL
  - color_hex text NOT NULL DEFAULT '#6b7280'::text
  - sort_order integer NOT NULL DEFAULT 0
  - is_active boolean NOT NULL DEFAULT true
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()
  - is_available boolean NOT NULL DEFAULT false

#### category_unit_types
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid
  - type_code text NOT NULL
  - type_name text NOT NULL
  - description text
  - sort_order integer NOT NULL DEFAULT 0
  - is_active boolean NOT NULL DEFAULT true
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()

#### client_health_history
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - client_id uuid NOT NULL
  - score integer NOT NULL
  - category text
  - total_exposure numeric DEFAULT 0
  - score_breakdown jsonb
  - calculated_at timestamptz NOT NULL DEFAULT now()

#### client_health_scores
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - client_id uuid
  - score integer NOT NULL DEFAULT 50
  - category text NOT NULL DEFAULT 'AT RISK'::text
  - score_breakdown jsonb
  - total_exposure numeric DEFAULT 0
  - last_calculated timestamptz DEFAULT now()
  - created_at timestamptz DEFAULT now()

#### clients
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - client_code text NOT NULL
  - full_name text NOT NULL
  - cnic text
  - phone_primary text NOT NULL
  - phone_secondary text
  - email text
  - address text
  - city text
  - country text DEFAULT 'Pakistan'::text
  - occupation text
  - company_name text
  - reference_by text
  - notes text
  - metadata jsonb DEFAULT '{}'::jsonb
  - status text NOT NULL DEFAULT 'active'::text
  - created_by uuid
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()
  - father_name text
  - passport_no text
  - whatsapp text
  - client_category text
  - client_photo_url text
  - cnic_front_url text
  - cnic_back_url text
  - overseas_local text DEFAULT 'local'::text
  - next_of_kin_name text
  - next_of_kin_relation text
  - next_of_kin_phone text
  - lead_source text
  - bank_name text
  - bank_account_title text
  - bank_account_no text
  - bank_iban text
  - has_cancellation_history boolean DEFAULT false
  - is_defaulter boolean DEFAULT false
  - is_blacklisted boolean DEFAULT false
  - flag_notes text
  - recovery_status text DEFAULT 'current'::text
  - recovery_status_updated_at timestamptz
  - recovery_status_updated_by uuid
  - dnd_status boolean DEFAULT false
  - dnd_reason text
  - dnd_set_by uuid
  - dnd_set_date date
  - dnd_director_note text
  - dnd_review_date date
  - dnd_until date
  - total_contacts_count integer DEFAULT 0
  - last_contact_date date
  - escalation_level integer DEFAULT 1
  - comms_opt_out boolean NOT NULL DEFAULT false

#### commission_structures
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - project_id uuid
  - agent_id uuid
  - rate_percent numeric(5,2) NOT NULL DEFAULT 0
  - milestone_booking_pct numeric(5,2) NOT NULL DEFAULT 50
  - milestone_possession_pct numeric(5,2) NOT NULL DEFAULT 50
  - notes text
  - is_active boolean NOT NULL DEFAULT true
  - created_by text
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### companies
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_code text NOT NULL
  - company_name text NOT NULL
  - company_type text NOT NULL DEFAULT 'real_estate'::text
  - business_email text
  - business_phone text
  - country text NOT NULL DEFAULT 'Pakistan'::text
  - city text
  - address text
  - logo_url text
  - status text NOT NULL DEFAULT 'active'::text
  - onboarding_complete boolean NOT NULL DEFAULT false
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()
  - slug text
  - brand_color text NOT NULL DEFAULT '#6C63FF'::text
  - team_size_range text
  - industry_tags text[] NOT NULL DEFAULT '{}'::text[]
  - signup_source text
  - timezone text NOT NULL DEFAULT 'Asia/Karachi'::text
  - currency text NOT NULL DEFAULT 'PKR'::text
  - owner_user_id uuid
  - deleted_at timestamptz
  - suspended_at timestamptz
  - suspension_reason text

#### company_branding
  - company_id uuid NOT NULL
  - letterhead_subtitle text NOT NULL DEFAULT 'Recovery Management System'::text
  - address_full text
  - ntn_number text
  - registration_number text
  - doc_brand_color text NOT NULL DEFAULT '#1E2D47'::text
  - accent_color text NOT NULL DEFAULT '#C9A84C'::text
  - signature_name text
  - signature_title text NOT NULL DEFAULT 'Authorized Signatory'::text
  - footer_text text
  - updated_at timestamptz NOT NULL DEFAULT now()

#### company_feature_flags
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - feature_key text NOT NULL
  - is_enabled boolean NOT NULL DEFAULT true
  - override_note text
  - set_by text
  - set_at timestamptz DEFAULT now()

#### company_ip_whitelists
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - ip_range text NOT NULL
  - label text
  - is_active boolean NOT NULL DEFAULT true
  - created_by text
  - created_at timestamptz DEFAULT now()

#### company_payment_methods
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - method_type text NOT NULL
  - account_title text NOT NULL
  - account_number text NOT NULL
  - bank_name text
  - branch_code text
  - iban text
  - swift_code text
  - is_active boolean NOT NULL DEFAULT true
  - is_default boolean NOT NULL DEFAULT false
  - display_order integer NOT NULL DEFAULT 0
  - qr_code_url text
  - notes text
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()

#### company_security_settings
  - company_id uuid NOT NULL
  - session_timeout_min integer NOT NULL DEFAULT 120
  - lockout_threshold integer NOT NULL DEFAULT 5
  - lockout_duration_min integer NOT NULL DEFAULT 15
  - ip_whitelist_enabled boolean NOT NULL DEFAULT false
  - require_2fa_admin boolean NOT NULL DEFAULT true
  - updated_at timestamptz DEFAULT now()

#### company_targets
  - company_id uuid NOT NULL
  - monthly_target numeric NOT NULL DEFAULT 0
  - annual_target numeric NOT NULL DEFAULT 0
  - updated_at timestamptz NOT NULL DEFAULT now()

#### contact_logs
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - unit_id uuid
  - client_name text
  - contact_date date NOT NULL DEFAULT CURRENT_DATE
  - contact_time time
  - channel text NOT NULL DEFAULT 'Call'::text
  - direction text NOT NULL DEFAULT 'Outbound'::text
  - agent_id text
  - response_received text NOT NULL DEFAULT 'NoResponse'::text
  - remarks text
  - promise_to_pay boolean NOT NULL DEFAULT false
  - promise_amount numeric(15,2)
  - promise_date date
  - next_followup_date date
  - next_followup_channel text
  - internal_notes text
  - status_tag text DEFAULT 'Active'::text
  - escalation_flag text
  - created_by text
  - created_at timestamptz NOT NULL DEFAULT now()
  - client_id uuid
  - sale_id uuid
  - call_status text
  - response_type text
  - phone_used text
  - duration_minutes integer
  - next_action text
  - reminder_channels text[] DEFAULT '{}'::text[]
  - attachments jsonb DEFAULT '[]'::jsonb
  - recovery_agent_id uuid

#### escalations
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - client_id uuid NOT NULL
  - sale_id uuid
  - from_level integer NOT NULL DEFAULT 1
  - to_level integer NOT NULL
  - reason text NOT NULL
  - escalated_by uuid
  - escalated_to uuid
  - status text NOT NULL DEFAULT 'open'::text
  - resolution_note text
  - resolved_at timestamptz
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### field_visits
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - officer_id uuid
  - officer_name text
  - client_id uuid
  - client_name text
  - unit_id uuid
  - unit_no text
  - project_name text
  - visit_date date NOT NULL DEFAULT CURRENT_DATE
  - visit_time time
  - latitude numeric(10,7)
  - longitude numeric(10,7)
  - location_name text
  - outcome text NOT NULL DEFAULT 'other'::text
  - notes text
  - photo_url text
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### floors
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - name text NOT NULL
  - sort_order integer NOT NULL DEFAULT 0
  - is_active boolean NOT NULL DEFAULT true
  - created_at timestamptz NOT NULL DEFAULT now()

#### follow_up_reminders
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - contact_log_id uuid
  - unit_id uuid
  - client_id uuid
  - sale_id uuid
  - remind_at timestamptz NOT NULL
  - channels text[] DEFAULT '{}'::text[]
  - message text
  - status text NOT NULL DEFAULT 'pending'::text
  - sent_at timestamptz
  - created_by text
  - created_at timestamptz NOT NULL DEFAULT now()

#### installment_snapshots
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - sale_id uuid NOT NULL
  - snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
  - taken_at timestamptz NOT NULL DEFAULT now()
  - taken_by uuid

#### installments
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - sale_id uuid NOT NULL
  - installment_number integer NOT NULL
  - due_date date NOT NULL
  - amount_due numeric(14,2) NOT NULL
  - amount_paid numeric(14,2) NOT NULL DEFAULT 0
  - installment_type text NOT NULL DEFAULT 'installment'::text
  - status text NOT NULL DEFAULT 'pending'::text
  - paid_at timestamptz
  - notes text
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()
  - outstanding numeric DEFAULT GREATEST((amount_due - amount_paid), (0)::numeric)
  - related_payment_id uuid

#### invoices
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - subscription_id uuid
  - invoice_number text NOT NULL
  - plan_id uuid
  - plan_name text NOT NULL
  - billing_cycle text NOT NULL
  - amount numeric(15,2) NOT NULL
  - currency text DEFAULT 'PKR'::text
  - period_start date NOT NULL
  - period_end date NOT NULL
  - issue_date date DEFAULT CURRENT_DATE
  - due_date date NOT NULL
  - status text DEFAULT 'unpaid'::text
  - paid_date date
  - notes text
  - metadata jsonb DEFAULT '{}'::jsonb
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()
  - pdf_storage_path text
  - line_items jsonb NOT NULL DEFAULT '[]'::jsonb
  - tax_amount numeric(15,2) NOT NULL DEFAULT 0
  - sent_at timestamptz
  - voided_at timestamptz
  - product text

#### legal_cases
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - client_id uuid NOT NULL
  - sale_id uuid
  - unit_id uuid
  - case_number text
  - stage text NOT NULL DEFAULT 'pre_legal'::text
  - lawyer_name text
  - lawyer_contact text
  - filed_date date
  - next_hearing_date date
  - outcome text
  - claim_amount numeric DEFAULT 0
  - settled_amount numeric DEFAULT 0
  - documents jsonb DEFAULT '[]'::jsonb
  - notes text
  - created_by uuid
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()
  - case_type text DEFAULT 'court'::text
  - legal_costs jsonb NOT NULL DEFAULT '[]'::jsonb

#### message_log
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - client_id uuid
  - channel text NOT NULL DEFAULT 'whatsapp'::text
  - template_id uuid
  - category text
  - to_address text
  - body_rendered text
  - status text NOT NULL DEFAULT 'manual'::text
  - sent_by text
  - created_at timestamptz NOT NULL DEFAULT now()

#### message_templates
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - name text NOT NULL
  - channel text NOT NULL DEFAULT 'whatsapp'::text
  - category text NOT NULL DEFAULT 'custom'::text
  - subject text
  - body text NOT NULL
  - is_active boolean NOT NULL DEFAULT true
  - created_by text
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()

#### noc
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - unit_id uuid NOT NULL
  - sale_id uuid
  - client_id uuid
  - client_name text
  - client_phone text
  - project_name text
  - unit_no text
  - noc_type text NOT NULL
  - purpose text
  - payment_threshold numeric(5,2) DEFAULT 80
  - status text NOT NULL DEFAULT 'pending'::text
  - requested_by text
  - requested_at timestamptz DEFAULT now()
  - reviewed_by text
  - reviewed_at timestamptz
  - approved_by text
  - approved_at timestamptz
  - rejection_reason text
  - revoked_by text
  - revoked_at timestamptz
  - revocation_reason text
  - valid_from date
  - valid_until date
  - noc_number text
  - notes text
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### otp_tokens
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - phone text NOT NULL
  - otp text NOT NULL
  - expires_at timestamptz NOT NULL
  - used boolean NOT NULL DEFAULT false
  - created_at timestamptz NOT NULL DEFAULT now()
  - attempts integer NOT NULL DEFAULT 0

#### password_reset_requests
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - email text NOT NULL
  - requested_at timestamptz NOT NULL DEFAULT now()

#### payables
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - client_id uuid NOT NULL
  - amount numeric NOT NULL DEFAULT 0
  - reason text NOT NULL
  - related_transfer_id uuid
  - related_cancellation_id uuid
  - status text NOT NULL DEFAULT 'pending'::text
  - paid_amount numeric DEFAULT 0
  - expected_date date
  - paid_date date
  - payment_method text
  - bank_id uuid
  - reference text
  - notes text
  - created_by uuid
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### payment_link_reminders
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - payment_link_id uuid NOT NULL
  - reminder_number integer NOT NULL
  - sent_at timestamptz NOT NULL DEFAULT now()
  - sent_by text
  - message_text text
  - response_received boolean NOT NULL DEFAULT false

#### payment_link_status_history
  - id bigint NOT NULL DEFAULT nextval('payment_link_status_history_id_seq'::regclass)
  - payment_link_id uuid NOT NULL
  - from_status text
  - to_status text NOT NULL
  - changed_by text
  - changed_by_user_id uuid
  - changed_at timestamptz NOT NULL DEFAULT now()
  - notes text

#### payment_links
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - ref_code text NOT NULL
  - client_id uuid NOT NULL
  - sale_id uuid NOT NULL
  - installment_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]
  - requested_amount numeric NOT NULL
  - description text
  - whatsapp_phone text NOT NULL
  - payment_methods_offered jsonb NOT NULL DEFAULT '[]'::jsonb
  - message_text text NOT NULL
  - whatsapp_url text
  - sent_by text NOT NULL
  - sent_by_user_id uuid
  - sent_at timestamptz NOT NULL DEFAULT now()
  - expires_at timestamptz
  - status text NOT NULL DEFAULT 'sent'::text
  - screenshot_received_at timestamptz
  - screenshot_url text
  - screenshot_uploaded_by text
  - client_claimed_amount numeric
  - client_claimed_method text
  - client_claimed_ref text
  - client_claimed_date date
  - client_notes text
  - verified_by text
  - verified_by_user_id uuid
  - verified_at timestamptz
  - verification_notes text
  - rejection_reason text
  - payment_id uuid
  - prv_number text
  - whatsapp_confirmation_sent boolean NOT NULL DEFAULT false
  - whatsapp_confirmation_sent_at timestamptz
  - reminder_count integer NOT NULL DEFAULT 0
  - last_reminder_at timestamptz
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()

#### payment_methods
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - partner_id uuid NOT NULL
  - method_type text NOT NULL
  - method_name text NOT NULL
  - account_title text NOT NULL
  - account_number text
  - iban text
  - swift_code text
  - branch_name text
  - additional_info jsonb DEFAULT '{}'::jsonb
  - is_active boolean DEFAULT true
  - display_order integer DEFAULT 0
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### payment_partners
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - country_code text NOT NULL
  - country_name text NOT NULL
  - partner_name text NOT NULL
  - partner_role text NOT NULL
  - partner_email text
  - partner_phone text
  - partner_whatsapp text
  - partner_photo_url text
  - verification_info jsonb DEFAULT '{}'::jsonb
  - is_active boolean DEFAULT true
  - display_order integer DEFAULT 0
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### payment_promises
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - client_id uuid NOT NULL
  - sale_id uuid
  - installment_id uuid
  - promised_amount numeric NOT NULL
  - promise_date date NOT NULL
  - promise_made_on date NOT NULL DEFAULT CURRENT_DATE
  - promised_via text
  - promised_by_client text
  - logged_by text NOT NULL DEFAULT ''::text
  - status text NOT NULL DEFAULT 'pending'::text
  - actual_paid_amount numeric DEFAULT 0
  - actual_paid_date date
  - actual_paid_via text
  - related_payment_id uuid
  - notes text
  - reminder_sent_count integer DEFAULT 0
  - last_reminder_sent_at timestamptz
  - postponed_to_date date
  - postpone_reason text
  - broken_reason text
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### payment_proofs
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - invoice_id uuid
  - submitted_by uuid
  - payment_method_id uuid
  - payment_partner_id uuid
  - reference_number text NOT NULL
  - amount_paid numeric(15,2) NOT NULL
  - currency text DEFAULT 'PKR'::text
  - payment_date date NOT NULL
  - payer_name text
  - payer_account text
  - receipt_url text NOT NULL
  - receipt_filename text
  - receipt_size_kb integer
  - status text DEFAULT 'pending'::text
  - notes_from_user text
  - verified_by uuid
  - verified_at timestamptz
  - verification_notes text
  - rejection_reason text
  - metadata jsonb DEFAULT '{}'::jsonb
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### payments
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - payment_code text NOT NULL
  - sale_id uuid NOT NULL
  - installment_id uuid
  - client_id uuid NOT NULL
  - payment_type_id uuid
  - amount numeric(15,2) NOT NULL
  - payment_date date NOT NULL DEFAULT CURRENT_DATE
  - payment_method text NOT NULL DEFAULT 'cash'::text
  - reference_no text
  - bank_name text
  - notes text
  - receipt_url text
  - status text NOT NULL DEFAULT 'received'::text
  - created_by text
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()
  - proof_url text
  - payment_category text DEFAULT 'regular'::text
  - penalty_amount numeric(15,2) DEFAULT 0
  - tax_amount numeric(15,2) DEFAULT 0
  - tax_type text
  - deposit_confirmed boolean DEFAULT false
  - deposit_date date
  - cheque_date date
  - bank_id uuid
  - adjustment_note text
  - adjustment_type text
  - voucher_code text

#### pdc_cheques
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - sale_id uuid
  - client_id uuid
  - cheque_no text NOT NULL
  - bank_name text
  - amount numeric(15,2) NOT NULL
  - cheque_date date NOT NULL
  - received_date date
  - status text NOT NULL DEFAULT 'pending'::text
  - notes text
  - payment_id uuid
  - created_by text
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()
  - bounce_reason text
  - bounce_date date
  - penalty_amount numeric DEFAULT 0
  - penalty_collected boolean DEFAULT false
  - penalty_date date
  - penalty_notes text
  - deposit_date date
  - clearance_date date

#### platform_api_keys
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - organization_id uuid NOT NULL
  - name text NOT NULL
  - key_prefix text NOT NULL
  - key_hash text NOT NULL
  - scopes jsonb NOT NULL DEFAULT '[]'::jsonb
  - rate_limit_per_minute integer NOT NULL DEFAULT 60
  - last_used_at timestamptz
  - last_used_ip inet
  - expires_at timestamptz
  - revoked_at timestamptz
  - created_by uuid
  - created_at timestamptz NOT NULL DEFAULT now()

#### platform_email_log
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - organization_id uuid
  - to_email text NOT NULL
  - to_user_id uuid
  - from_email text NOT NULL DEFAULT 'noreply@nexunova.com'::text
  - reply_to text
  - subject text NOT NULL
  - template_key text
  - variables jsonb NOT NULL DEFAULT '{}'::jsonb
  - status text NOT NULL DEFAULT 'queued'::text
  - provider text NOT NULL DEFAULT 'resend'::text
  - provider_message_id text
  - sent_at timestamptz
  - delivered_at timestamptz
  - opened_at timestamptz
  - clicked_at timestamptz
  - bounced_at timestamptz
  - complained_at timestamptz
  - error_message text
  - category text NOT NULL DEFAULT 'transactional'::text
  - created_at timestamptz NOT NULL DEFAULT now()

#### platform_email_templates
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - organization_id uuid
  - template_key text NOT NULL
  - subject text NOT NULL
  - body_html text NOT NULL
  - body_text text
  - variables jsonb NOT NULL DEFAULT '[]'::jsonb
  - category text NOT NULL DEFAULT 'transactional'::text
  - active boolean NOT NULL DEFAULT true
  - created_by uuid
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()

#### platform_invitations
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - organization_id uuid NOT NULL
  - email text NOT NULL
  - role text NOT NULL
  - token text NOT NULL
  - invited_by uuid
  - invited_at timestamptz NOT NULL DEFAULT now()
  - expires_at timestamptz NOT NULL DEFAULT (now() + '7 days'::interval)
  - accepted_at timestamptz
  - accepted_user_id uuid
  - revoked_at timestamptz
  - resend_count integer NOT NULL DEFAULT 0
  - last_sent_at timestamptz
  - message text

#### platform_notifications
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - organization_id uuid NOT NULL
  - user_id uuid NOT NULL
  - type text NOT NULL
  - title text NOT NULL
  - body text
  - action_url text
  - action_label text
  - icon text
  - priority text NOT NULL DEFAULT 'normal'::text
  - read_at timestamptz
  - dismissed_at timestamptz
  - expires_at timestamptz
  - data jsonb NOT NULL DEFAULT '{}'::jsonb
  - created_at timestamptz NOT NULL DEFAULT now()

#### platform_organization_members
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - organization_id uuid NOT NULL
  - user_id uuid NOT NULL
  - auth_user_id uuid
  - role text NOT NULL
  - status text NOT NULL DEFAULT 'active'::text
  - invited_by uuid
  - invited_at timestamptz
  - joined_at timestamptz NOT NULL DEFAULT now()
  - last_active_at timestamptz
  - permissions jsonb NOT NULL DEFAULT '{}'::jsonb
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()

#### platform_settings
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - organization_id uuid NOT NULL
  - setting_key text NOT NULL
  - setting_value jsonb NOT NULL
  - category text NOT NULL DEFAULT 'general'::text
  - updated_by uuid
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()

#### platform_subscription_features
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - tier text NOT NULL
  - product text NOT NULL
  - feature_key text NOT NULL
  - feature_value jsonb NOT NULL
  - display_label text
  - display_order integer NOT NULL DEFAULT 0
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()

#### platform_subscription_usage
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - organization_id uuid NOT NULL
  - product text NOT NULL
  - metric text NOT NULL
  - current_value numeric NOT NULL DEFAULT 0
  - limit_value numeric
  - period_start timestamptz
  - period_end timestamptz
  - last_updated timestamptz NOT NULL DEFAULT now()
  - created_at timestamptz NOT NULL DEFAULT now()

#### platform_user_preferences
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - user_id uuid NOT NULL
  - organization_id uuid
  - preference_key text NOT NULL
  - preference_value jsonb NOT NULL
  - updated_at timestamptz NOT NULL DEFAULT now()
  - created_at timestamptz NOT NULL DEFAULT now()

#### platform_webhooks
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - organization_id uuid NOT NULL
  - name text NOT NULL
  - url text NOT NULL
  - events text[] NOT NULL
  - secret_hash text NOT NULL
  - active boolean NOT NULL DEFAULT true
  - last_delivery_at timestamptz
  - last_status_code integer
  - last_error_message text
  - consecutive_failures integer NOT NULL DEFAULT 0
  - created_by uuid
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()

#### possessions
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - unit_id uuid NOT NULL
  - sale_id uuid
  - status text NOT NULL DEFAULT 'pending'::text
  - possession_date date
  - handover_by text
  - received_by text
  - client_name text
  - client_phone text
  - checklist jsonb NOT NULL DEFAULT '[]'::jsonb
  - snagging_items jsonb NOT NULL DEFAULT '[]'::jsonb
  - notes text
  - created_by text
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()

#### project_bank_accounts
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - project_id uuid NOT NULL
  - bank_name text NOT NULL
  - account_title text NOT NULL
  - account_no text
  - iban text
  - branch text
  - is_primary boolean DEFAULT false
  - notes text
  - created_at timestamptz DEFAULT now()

#### project_expenses
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - project_id uuid NOT NULL
  - expense_category text NOT NULL
  - description text
  - amount numeric(15,2) NOT NULL DEFAULT 0
  - expense_date date
  - notes text
  - created_by text
  - created_at timestamptz DEFAULT now()

#### project_milestones
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - project_id uuid NOT NULL
  - phase_name text NOT NULL
  - description text
  - target_date date
  - completion_date date
  - progress_pct integer DEFAULT 0
  - status text DEFAULT 'upcoming'::text
  - sort_order integer DEFAULT 0
  - created_at timestamptz DEFAULT now()

#### project_price_revisions
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - project_id uuid NOT NULL
  - unit_type_id uuid
  - old_price numeric NOT NULL
  - new_price numeric NOT NULL
  - change_amount numeric DEFAULT (new_price - old_price)
  - change_percent numeric DEFAULT (((new_price - old_price) / NULLIF(old_price, (0)::numeric)) * (100)::numeric)
  - effective_date date NOT NULL
  - reason text NOT NULL
  - revised_by text NOT NULL
  - units_updated integer DEFAULT 0
  - created_at timestamptz DEFAULT now()

#### projects
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - project_code text NOT NULL
  - project_name text NOT NULL
  - description text
  - location text
  - city text
  - country text DEFAULT 'Pakistan'::text
  - total_area numeric(15,2)
  - area_unit text DEFAULT 'sqft'::text
  - total_units integer DEFAULT 0
  - start_date date
  - expected_completion_date date
  - status text NOT NULL DEFAULT 'active'::text
  - cover_image_url text
  - metadata jsonb NOT NULL DEFAULT '{}'::jsonb
  - created_by uuid
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()
  - builder_name text
  - builder_contact text
  - builder_email text
  - gps_lat double precision
  - gps_lng double precision
  - map_link text
  - construction_progress integer DEFAULT 0
  - amenities text[]
  - noc_number text
  - noc_authority text
  - noc_date date
  - noc_notes text
  - cover_images text[]
  - delivery_date date

#### promise_reminders_log
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - promise_id uuid NOT NULL
  - reminder_type text
  - channel text
  - sent_to text
  - sent_at timestamptz DEFAULT now()
  - delivery_status text DEFAULT 'sent'::text
  - response_received boolean DEFAULT false

#### radar_action_logs
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - radar_log_id uuid
  - client_id uuid
  - predicted_score integer
  - action_taken text
  - payment_received boolean DEFAULT false
  - payment_amount numeric
  - payment_date date
  - action_at timestamptz DEFAULT now()
  - action_by text

#### recovery_agents
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - user_id uuid
  - agent_code text NOT NULL
  - full_name text NOT NULL
  - phone text
  - daily_call_target integer DEFAULT 20
  - monthly_recovery_target numeric DEFAULT 0
  - is_active boolean DEFAULT true
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### recovery_campaigns
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - name text NOT NULL
  - description text
  - target_amount numeric NOT NULL DEFAULT 0
  - start_date date NOT NULL
  - end_date date NOT NULL
  - status text NOT NULL DEFAULT 'active'::text
  - outcome_summary text
  - created_by text
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()
  - closed_at timestamptz

#### recovery_radar_logs
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - generated_date date NOT NULL DEFAULT CURRENT_DATE
  - generated_at timestamptz DEFAULT now()
  - generated_by text
  - top_clients jsonb NOT NULL DEFAULT '[]'::jsonb
  - total_potential_recovery numeric DEFAULT 0
  - clients_analyzed integer DEFAULT 0
  - algorithm_version text DEFAULT 'v1.0'::text

#### reminder_logs
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - unit_id uuid
  - sale_id uuid
  - client_name text
  - phone text
  - reminder_type text NOT NULL DEFAULT 'whatsapp'::text
  - amount_due numeric DEFAULT 0
  - message text
  - sent_by text
  - notes text
  - sent_at timestamptz NOT NULL DEFAULT now()

#### sa_announcements
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - title text NOT NULL
  - body text
  - type text NOT NULL DEFAULT 'info'::text
  - is_active boolean NOT NULL DEFAULT true
  - target_all boolean NOT NULL DEFAULT true
  - company_ids jsonb DEFAULT '[]'::jsonb
  - starts_at timestamptz DEFAULT now()
  - ends_at timestamptz
  - created_by text
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### sa_support_tickets
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid
  - company_name text
  - submitted_by text
  - subject text NOT NULL
  - body text
  - category text DEFAULT 'general'::text
  - priority text DEFAULT 'normal'::text
  - status text NOT NULL DEFAULT 'open'::text
  - assigned_to text
  - resolution_note text
  - resolved_at timestamptz
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### sale_amendments
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - sale_id uuid NOT NULL
  - amendment_type text NOT NULL DEFAULT 'other'::text
  - description text
  - reason text
  - amended_by text
  - amended_at timestamptz DEFAULT now()

#### sale_documents
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - sale_id uuid NOT NULL
  - document_type text NOT NULL DEFAULT 'other'::text
  - document_name text NOT NULL
  - document_url text NOT NULL
  - uploaded_by text
  - uploaded_at timestamptz DEFAULT now()

#### sale_sequences
  - company_id uuid NOT NULL
  - year smallint NOT NULL
  - last_num integer NOT NULL DEFAULT 0

#### sales
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - sale_number text NOT NULL
  - unit_id uuid NOT NULL
  - client_id uuid NOT NULL
  - agent_id uuid
  - price_per_sqft numeric(14,2) NOT NULL DEFAULT 0
  - area_sqft numeric(14,2) NOT NULL DEFAULT 0
  - total_amount numeric(14,2) DEFAULT (price_per_sqft * area_sqft)
  - discount numeric(14,2) NOT NULL DEFAULT 0
  - net_amount numeric(14,2) DEFAULT ((price_per_sqft * area_sqft) - discount)
  - down_payment numeric(14,2) NOT NULL DEFAULT 0
  - remaining_amount numeric(14,2) DEFAULT (((price_per_sqft * area_sqft) - discount) - down_payment)
  - installment_count integer NOT NULL DEFAULT 0
  - notes text
  - status text NOT NULL DEFAULT 'active'::text
  - sale_date date NOT NULL DEFAULT CURRENT_DATE
  - created_by uuid
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()
  - co_buyer_name text
  - co_buyer_cnic text
  - co_buyer_share_pct numeric
  - nominee_name text
  - nominee_cnic text
  - nominee_relation text
  - wht_amount numeric NOT NULL DEFAULT 0
  - cvt_amount numeric NOT NULL DEFAULT 0
  - discount_approved_by text
  - discount_notes text
  - cancellation_reason text
  - cancellation_date date
  - cancelled_by text
  - payment_plan_type text DEFAULT 'installment'::text
  - discount_amount numeric DEFAULT 0
  - discount_percentage numeric DEFAULT 0
  - is_transfer boolean DEFAULT false
  - transferred_from_sale_id uuid
  - is_active boolean DEFAULT true
  - closed_at timestamptz
  - closure_reason text
  - project_id uuid
  - commission_rate numeric DEFAULT 0
  - cancellation_id uuid
  - delivery_breach boolean DEFAULT false
  - breach_months integer
  - breach_reason_type text
  - breach_reason_detail text
  - breach_approved_by text
  - breach_approval_ref text
  - breach_approved_at date
  - is_resale boolean DEFAULT false
  - resale_of_cancellation_id uuid

#### subscription_plans
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - plan_code text NOT NULL
  - plan_name text NOT NULL
  - description text
  - billing_cycle text NOT NULL DEFAULT 'monthly'::text
  - price numeric(12,2) NOT NULL DEFAULT 0
  - currency text NOT NULL DEFAULT 'PKR'::text
  - trial_days integer NOT NULL DEFAULT 0
  - max_users integer NOT NULL DEFAULT 5
  - max_projects integer NOT NULL DEFAULT 3
  - max_units integer NOT NULL DEFAULT 500
  - features jsonb NOT NULL DEFAULT '{}'::jsonb
  - is_active boolean NOT NULL DEFAULT true
  - sort_order integer NOT NULL DEFAULT 0
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()
  - max_clients integer NOT NULL DEFAULT 500
  - max_agents integer NOT NULL DEFAULT 2

#### subscriptions
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - plan_id uuid NOT NULL
  - status text NOT NULL DEFAULT 'trialing'::text
  - billing_cycle text NOT NULL DEFAULT 'monthly'::text
  - payment_method text
  - amount numeric(12,2)
  - currency text NOT NULL DEFAULT 'PKR'::text
  - trial_ends_at timestamptz
  - current_period_start timestamptz NOT NULL DEFAULT now()
  - current_period_end timestamptz
  - cancelled_at timestamptz
  - external_subscription_id text
  - metadata jsonb NOT NULL DEFAULT '{}'::jsonb
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()
  - product text
  - tier text
  - legacy_plan_name text
  - trial_started_at timestamptz
  - discount_percent numeric(5,2) NOT NULL DEFAULT 0

#### system_config
  - key text NOT NULL
  - value text NOT NULL
  - updated_at timestamptz DEFAULT now()

#### unit_cancellations
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - cancellation_voucher_no text NOT NULL
  - cancellation_date date NOT NULL DEFAULT CURRENT_DATE
  - effective_date date
  - unit_id uuid NOT NULL
  - project_id uuid NOT NULL
  - sale_id uuid NOT NULL
  - client_id uuid NOT NULL
  - cancellation_type text NOT NULL
  - reason_category text NOT NULL
  - detailed_reason text NOT NULL
  - overdue_installments_count integer DEFAULT 0
  - days_past_due integer DEFAULT 0
  - notices_sent_count integer DEFAULT 0
  - last_notice_date date
  - legal_action_initiated boolean DEFAULT false
  - total_paid numeric NOT NULL DEFAULT 0
  - booking_forfeiture numeric DEFAULT 0
  - cancellation_charges numeric DEFAULT 0
  - late_payment_penalty numeric DEFAULT 0
  - processing_fee numeric DEFAULT 0
  - other_deductions numeric DEFAULT 0
  - other_deductions_note text
  - total_deductions numeric DEFAULT 0
  - net_refund_amount numeric NOT NULL DEFAULT 0
  - refund_method text
  - refund_payment_mode text
  - refund_bank_id uuid
  - refund_reference text
  - refund_date date
  - refund_status text DEFAULT 'pending'::text
  - expected_refund_date date
  - refund_notes text
  - agent_id uuid
  - agent_commission_total numeric DEFAULT 0
  - agent_commission_paid numeric DEFAULT 0
  - agent_commission_pending numeric DEFAULT 0
  - commission_action text
  - commission_recovery_amount numeric DEFAULT 0
  - commission_recovery_method text
  - commission_notes text
  - client_flag text DEFAULT 'none'::text
  - blacklist_reason text
  - initiated_by text
  - notes text
  - status text DEFAULT 'completed'::text
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### unit_transfers
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - transfer_voucher_no text NOT NULL
  - transfer_date date NOT NULL DEFAULT CURRENT_DATE
  - unit_id uuid NOT NULL
  - project_id uuid NOT NULL
  - old_sale_id uuid NOT NULL
  - old_client_id uuid NOT NULL
  - old_total_paid numeric NOT NULL DEFAULT 0
  - old_outstanding numeric NOT NULL DEFAULT 0
  - old_sale_price numeric NOT NULL DEFAULT 0
  - settlement_type text
  - settlement_amount numeric DEFAULT 0
  - settlement_method text
  - settlement_bank_id uuid
  - settlement_reference text
  - settlement_note text
  - settlement_deduction numeric DEFAULT 0
  - settlement_net_amount numeric DEFAULT 0
  - settlement_status text DEFAULT 'pending'::text
  - new_sale_id uuid NOT NULL
  - new_client_id uuid NOT NULL
  - new_sale_price numeric NOT NULL DEFAULT 0
  - price_difference numeric DEFAULT 0
  - margin_beneficiary text
  - old_client_margin_pct numeric DEFAULT 0
  - margin_to_old_client numeric DEFAULT 0
  - margin_to_company numeric DEFAULT 0
  - transfer_fee numeric DEFAULT 0
  - documentation_charges numeric DEFAULT 0
  - other_charges numeric DEFAULT 0
  - other_charges_desc text
  - total_transfer_charges numeric DEFAULT 0
  - charges_paid_by text
  - charges_split_old_pct numeric DEFAULT 0
  - charges_split_new_pct numeric DEFAULT 0
  - charges_payment_method text
  - charges_reference text
  - notes text
  - created_by text
  - created_at timestamptz DEFAULT now()
  - updated_at timestamptz DEFAULT now()

#### units
  - id uuid NOT NULL DEFAULT gen_random_uuid()
  - company_id uuid NOT NULL
  - project_id uuid NOT NULL
  - unit_no text NOT NULL
  - unit_type_id uuid
  - status_id uuid
  - floor_no integer
  - floor_label text
  - area numeric(12,2)
  - area_unit text DEFAULT 'sqft'::text
  - bedrooms integer
  - bathrooms integer
  - base_price numeric(15,2) NOT NULL DEFAULT 0
  - features jsonb NOT NULL DEFAULT '{}'::jsonb
  - notes text
  - created_by uuid
  - created_at timestamptz NOT NULL DEFAULT now()
  - updated_at timestamptz NOT NULL DEFAULT now()
  - unit_code text
  - block text
  - parking_count integer NOT NULL DEFAULT 0
  - facing text
  - is_premium boolean NOT NULL DEFAULT false
  - maintenance_monthly numeric
  - possession_date date
  - handover_status text
  - transfer_history text
  - image_urls jsonb DEFAULT '[]'::jsonb
  - document_urls jsonb DEFAULT '[]'::jsonb
  - floor_id uuid
  - carpet_area numeric
  - is_corner boolean DEFAULT false
  - origin_type text NOT NULL DEFAULT 'fresh'::text
  - last_event_at timestamptz
  - last_cancellation_id uuid

#### voucher_sequences
  - company_id uuid NOT NULL
  - prefix text NOT NULL
  - year text NOT NULL
  - seq integer NOT NULL DEFAULT 0

---

# 2. Primary Keys

Almost every table uses a surrogate `id` (uuid) PK. Exceptions / composite & natural keys:

| Table | Primary key |
|---|---|
| audit_logs / audit_log_archive | `id` (bigint) |
| payment_link_status_history | `id` (bigint) |
| company_branding | `company_id` |
| company_security_settings | `company_id` |
| company_targets | `company_id` |
| sale_sequences | `company_id, year` (composite) |
| voucher_sequences | `company_id, prefix, year` (composite) |
| system_config | `key` (text) |

All other 78 tables: PK = `id` (uuid).

---

# 3. Foreign Keys (139)

> Format: `source_column → target_table.target_column (ON DELETE rule)`. ON UPDATE is `NO ACTION` for all.

**additional_receivables** — client_id → clients.id (SET NULL); company_id → companies.id (CASCADE); created_by → app_users.id (SET NULL); sale_id → sales.id (CASCADE); unit_id → units.id (SET NULL)
**agent_commission_payments** — agent_id → agents.id (CASCADE); company_id → companies.id (CASCADE); sale_id → sales.id (SET NULL)
**agent_transactions** — agent_id → agents.id (NO ACTION); related_cancellation_id → unit_cancellations.id (NO ACTION); related_sale_id → sales.id (NO ACTION); related_transfer_id → unit_transfers.id (SET NULL)
**agents** — company_id → companies.id (CASCADE); created_by → app_users.id (NO ACTION); parent_agent_id → agents.id (SET NULL)
**app_users** — company_id → companies.id (CASCADE)
**auth_events** — company_id → companies.id (CASCADE)
**blacklisted_clients** — client_id → clients.id (NO ACTION); related_cancellation_id → unit_cancellations.id (NO ACTION)
**buyer_complaints** — client_id → clients.id (CASCADE); company_id → companies.id (CASCADE)
**campaign_clients** — campaign_id → recovery_campaigns.id (CASCADE)
**category_payment_types** — company_id → companies.id (CASCADE)
**category_unit_statuses** — company_id → companies.id (CASCADE)
**category_unit_types** — company_id → companies.id (CASCADE)
**client_health_scores** — client_id → clients.id (CASCADE)
**clients** — company_id → companies.id (CASCADE); created_by → app_users.id (NO ACTION)
**commission_structures** — company_id → companies.id (CASCADE)
**companies** — owner_user_id → app_users.id (SET NULL)
**company_branding** — company_id → companies.id (CASCADE)
**company_feature_flags** — company_id → companies.id (CASCADE)
**company_ip_whitelists** — company_id → companies.id (CASCADE)
**company_payment_methods** — company_id → companies.id (CASCADE)
**company_security_settings** — company_id → companies.id (CASCADE)
**company_targets** — company_id → companies.id (CASCADE)
**contact_logs** — client_id → clients.id (CASCADE); company_id → companies.id (CASCADE); recovery_agent_id → recovery_agents.id (SET NULL); sale_id → sales.id (SET NULL); unit_id → units.id (SET NULL)
**escalations** — client_id → clients.id (CASCADE); company_id → companies.id (CASCADE); escalated_by → app_users.id (SET NULL); escalated_to → app_users.id (SET NULL); sale_id → sales.id (SET NULL)
**field_visits** — client_id → clients.id (SET NULL); company_id → companies.id (CASCADE)
**floors** — company_id → companies.id (CASCADE)
**follow_up_reminders** — client_id → clients.id (CASCADE); contact_log_id → contact_logs.id (CASCADE); sale_id → sales.id (SET NULL); unit_id → units.id (CASCADE)
**installment_snapshots** — company_id → companies.id (CASCADE); sale_id → sales.id (CASCADE); taken_by → app_users.id (NO ACTION)
**installments** — company_id → companies.id (CASCADE); related_payment_id → payments.id (SET NULL); sale_id → sales.id (CASCADE)
**invoices** — company_id → companies.id (CASCADE); plan_id → subscription_plans.id (NO ACTION); subscription_id → subscriptions.id (NO ACTION)
**legal_cases** — client_id → clients.id (RESTRICT); company_id → companies.id (CASCADE); created_by → app_users.id (SET NULL); sale_id → sales.id (SET NULL); unit_id → units.id (SET NULL)
**noc** — company_id → companies.id (CASCADE)
**payables** — bank_id → banks.id (SET NULL); client_id → clients.id (RESTRICT); company_id → companies.id (CASCADE); created_by → app_users.id (SET NULL); related_cancellation_id → unit_cancellations.id (SET NULL); related_transfer_id → unit_transfers.id (SET NULL)
**payment_link_reminders** — payment_link_id → payment_links.id (CASCADE)
**payment_link_status_history** — payment_link_id → payment_links.id (CASCADE)
**payment_links** — client_id → clients.id (CASCADE); company_id → companies.id (CASCADE); payment_id → payments.id (SET NULL); sale_id → sales.id (CASCADE)
**payment_methods** — partner_id → payment_partners.id (CASCADE)
**payment_promises** — client_id → clients.id (CASCADE); company_id → companies.id (CASCADE); installment_id → installments.id (SET NULL); related_payment_id → payments.id (SET NULL); sale_id → sales.id (SET NULL)
**payment_proofs** — company_id → companies.id (CASCADE); invoice_id → invoices.id (NO ACTION); payment_method_id → payment_methods.id (NO ACTION); payment_partner_id → payment_partners.id (NO ACTION); submitted_by → app_users.id (NO ACTION); verified_by → app_users.id (NO ACTION)
**payments** — bank_id → banks.id (NO ACTION); client_id → clients.id (NO ACTION); company_id → companies.id (CASCADE); payment_type_id → category_payment_types.id (NO ACTION)
**platform_api_keys** — created_by → app_users.id (SET NULL); organization_id → companies.id (CASCADE)
**platform_email_log** — organization_id → companies.id (CASCADE); to_user_id → app_users.id (SET NULL)
**platform_email_templates** — created_by → app_users.id (SET NULL); organization_id → companies.id (CASCADE)
**platform_invitations** — accepted_user_id → app_users.id (SET NULL); invited_by → app_users.id (SET NULL); organization_id → companies.id (CASCADE)
**platform_notifications** — organization_id → companies.id (CASCADE); user_id → app_users.id (CASCADE)
**platform_organization_members** — invited_by → app_users.id (SET NULL); organization_id → companies.id (CASCADE); user_id → app_users.id (CASCADE)
**platform_settings** — organization_id → companies.id (CASCADE); updated_by → app_users.id (SET NULL)
**platform_subscription_usage** — organization_id → companies.id (CASCADE)
**platform_user_preferences** — organization_id → companies.id (CASCADE); user_id → app_users.id (CASCADE)
**platform_webhooks** — created_by → app_users.id (SET NULL); organization_id → companies.id (CASCADE)
**project_bank_accounts** — project_id → projects.id (CASCADE)
**project_expenses** — project_id → projects.id (CASCADE)
**project_milestones** — project_id → projects.id (CASCADE)
**project_price_revisions** — project_id → projects.id (CASCADE); unit_type_id → category_unit_types.id (SET NULL)
**projects** — company_id → companies.id (CASCADE); created_by → app_users.id (NO ACTION)
**promise_reminders_log** — promise_id → payment_promises.id (CASCADE)
**radar_action_logs** — client_id → clients.id (CASCADE); radar_log_id → recovery_radar_logs.id (SET NULL)
**recovery_agents** — company_id → companies.id (CASCADE); user_id → app_users.id (SET NULL)
**sa_support_tickets** — company_id → companies.id (SET NULL)
**sale_amendments** — sale_id → sales.id (CASCADE)
**sale_documents** — sale_id → sales.id (CASCADE)
**sale_sequences** — company_id → companies.id (CASCADE)
**sales** — agent_id → agents.id (NO ACTION); cancellation_id → unit_cancellations.id (SET NULL); client_id → clients.id (NO ACTION); company_id → companies.id (CASCADE); created_by → app_users.id (NO ACTION); project_id → projects.id (RESTRICT); resale_of_cancellation_id → unit_cancellations.id (SET NULL); transferred_from_sale_id → sales.id (NO ACTION); unit_id → units.id (NO ACTION)
**subscriptions** — company_id → companies.id (CASCADE); plan_id → subscription_plans.id (NO ACTION)
**unit_cancellations** — agent_id → agents.id (NO ACTION); client_id → clients.id (NO ACTION); project_id → projects.id (NO ACTION); refund_bank_id → banks.id (NO ACTION); sale_id → sales.id (NO ACTION); unit_id → units.id (NO ACTION)
**unit_transfers** — new_client_id → clients.id (NO ACTION); new_sale_id → sales.id (NO ACTION); old_client_id → clients.id (NO ACTION); old_sale_id → sales.id (NO ACTION); project_id → projects.id (NO ACTION); settlement_bank_id → banks.id (NO ACTION); unit_id → units.id (NO ACTION)
**units** — company_id → companies.id (CASCADE); created_by → app_users.id (NO ACTION); floor_id → floors.id (SET NULL); last_cancellation_id → unit_cancellations.id (SET NULL); project_id → projects.id (CASCADE); status_id → category_unit_statuses.id (NO ACTION); unit_type_id → category_unit_types.id (NO ACTION)
**voucher_sequences** — company_id → companies.id (CASCADE)

---

# 4. Row-Level Security

## 4.1 RLS enabled status (per table)

**RLS DISABLED (4):** `auth_events`, `company_feature_flags`, `sa_announcements`, `sa_support_tickets`
**RLS ENABLED:** all other 82 base tables.

## 4.2 Policies (103)

### Pattern A — RMS tables: `deny_all_anon` (USING false / CHECK false, roles `anon, authenticated`)
These tables expose exactly one policy that denies all direct table access (access is via SECURITY DEFINER RPCs):

`additional_receivables, agent_commission_payments, agent_transactions, agents, app_users, audit_log_archive, audit_logs, banks, blacklisted_clients, category_payment_types, category_unit_statuses, category_unit_types, client_health_scores, clients, companies, company_payment_methods, contact_logs, escalations, floors, follow_up_reminders, installments, invoices, legal_cases, otp_tokens, password_reset_requests, payables, payment_link_reminders, payment_link_status_history, payment_links, payment_methods, payment_partners, payment_promises, payment_proofs, payments, pdc_cheques, possessions, project_bank_accounts, project_expenses, project_milestones, project_price_revisions, projects, promise_reminders_log, radar_action_logs, recovery_agents, recovery_radar_logs, reminder_logs, sale_amendments, sale_documents, sale_sequences, sales, subscription_plans, subscriptions, system_config, unit_cancellations, unit_transfers, units, voucher_sequences`

### Pattern B — Company-isolation policies (single `ALL` policy, role `public`)
- **buyer_complaints** `company_isolation` — USING `company_id = (SELECT company_id FROM app_users WHERE id = auth.uid())`
- **commission_structures** `cs_company_isolation` — USING + CHECK `company_id = (SELECT company_id FROM app_users WHERE id = auth.uid())`
- **company_branding** `cb_company_isolation` — USING `company_id = current_setting('app.current_company_id', true)::uuid`
- **company_ip_whitelists** `ipwl_company_isolation` — USING + CHECK via app_users/auth.uid()
- **company_security_settings** `css_company_isolation` — USING + CHECK via app_users/auth.uid()
- **company_targets** `ct_isolation` — USING `company_id = current_setting('app.current_company_id', true)::uuid`
- **field_visits** `fv_company_isolation` — USING + CHECK via app_users/auth.uid()
- **installment_snapshots** `instsnap_company_isolation` — USING via app_users/auth.uid()
- **noc** `noc_company_isolation` — USING + CHECK via app_users/auth.uid()

### Pattern C — Platform tables: granular per-command policies
Helper predicates: `is_org_admin(org)`, `is_org_member(org)`, `is_nexunova_staff()`, `current_app_user_id()`.

- **platform_api_keys**: `pak_select_admin` SELECT [is_org_admin OR is_nexunova_staff]; `pak_insert_admin` INSERT [is_org_admin]; `pak_update_admin` UPDATE [is_org_admin]; `pak_delete_admin` DELETE [is_org_admin]
- **platform_email_log**: `pel_select_admin` SELECT [is_nexunova_staff OR (org_admin) OR to_user_id = current_app_user_id()]; `pel_write_staff` INSERT [is_nexunova_staff]
- **platform_email_templates**: `pet_select` SELECT [org_id IS NULL OR is_org_member OR is_nexunova_staff]; `pet_insert_admin` / `pet_update_admin` / `pet_delete_admin` [(org_id IS NULL AND staff) OR is_org_admin]
- **platform_invitations**: `inv_select_admin` SELECT [is_org_admin OR staff]; `inv_select_by_token_anon` SELECT (role anon) [not revoked/accepted, not expired]; `inv_insert_admin` / `inv_update_admin` / `inv_delete_admin` [is_org_admin]
- **platform_notifications**: `pn_select_own` / `pn_update_own` / `pn_delete_own` [user_id = current_app_user_id() (+ staff on select/delete)]; `pn_insert_org_admin` INSERT [is_org_admin OR staff]
- **platform_organization_members**: `pom_select_same_org` SELECT [is_org_member OR staff]; `pom_insert_admin` / `pom_update_admin` / `pom_delete_admin` [is_org_admin OR staff]
- **platform_settings**: `ps_select_members` SELECT [is_org_member OR staff]; `ps_insert_admin` / `ps_update_admin` / `ps_delete_admin` [is_org_admin]
- **platform_subscription_features**: `psf_select_all_auth` SELECT (anon+auth) [true]; `psf_write_staff_only` ALL [is_nexunova_staff]
- **platform_subscription_usage**: `psu_select_members` SELECT [is_org_member OR staff]; `psu_write_staff_only` INSERT [staff]; `psu_update_staff_only` UPDATE [staff]
- **platform_user_preferences**: `pup_self_all` ALL [user_id = current_app_user_id()]
- **platform_webhooks**: `pwh_select_admin` SELECT [is_org_admin OR staff]; `pwh_insert_admin` / `pwh_update_admin` / `pwh_delete_admin` [is_org_admin]

---

# 5. Database Functions (394)

> Format: `name(args) -> returns` `[security, volatility, language]`. SECURITY DEFINER = DEFINER. 388/394 are DEFINER. Trigger functions are at the end of this section.

- `_bridge_app_user_to_auth(p_app_user_id uuid) -> uuid` [DEFINER, VOL, plpgsql]
- `_generate_noc_number(p_company_id uuid) -> text` [INVOKER, VOL, plpgsql]
- `_increment_usage(p_organization_id uuid, p_product text, p_metric text, p_delta numeric) -> void` [DEFINER, VOL, plpgsql]
- `_trg_app_users_auto_bridge() -> trigger` [DEFINER, VOL, plpgsql]
- `_trg_app_users_mirror_to_pom() -> trigger` [DEFINER, VOL, plpgsql]
- `_trg_count_rms_metric() -> trigger` [DEFINER, VOL, plpgsql]
- `_trg_count_units() -> trigger` [DEFINER, VOL, plpgsql]
- `_trg_health_recalc() -> trigger` [INVOKER, VOL, plpgsql]
- `_trg_init_subscription_usage() -> trigger` [DEFINER, VOL, plpgsql]
- `_trg_pom_sync_auth_user_id() -> trigger` [INVOKER, VOL, plpgsql]
- `add_ip_whitelist_entry(p_company_id uuid, p_ip_range text, p_label text, p_created_by text) -> jsonb` [DEFINER, VOL, plpgsql]
- `add_legal_cost(p_company_id uuid, p_case_id uuid, p_cost jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `add_legal_document(p_company_id uuid, p_case_id uuid, p_doc jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `add_price_revision(p_company_id uuid, p_project_id uuid, p_unit_type_id uuid, p_new_price numeric, p_effective_date date, p_reason text, p_revised_by text) -> jsonb` [DEFINER, VOL, plpgsql]
- `add_sale_amendment(p_company_id uuid, p_sale_id uuid, p_amendment_type text, p_description text, p_reason text, p_amended_by text) -> jsonb` [DEFINER, VOL, plpgsql]
- `agents_set_updated_at() -> trigger` [INVOKER, VOL, plpgsql]
- `archive_old_audit_logs(p_days_old integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `assign_clients_to_campaign(p_campaign_id uuid, p_company_id uuid, p_client_ids jsonb, p_assigned_by text) -> jsonb` [DEFINER, VOL, plpgsql]
- `audit_trigger_function() -> trigger` [DEFINER, VOL, plpgsql]
- `auto_break_overdue_promises(p_company_id uuid, p_grace_days integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `build_whatsapp_message(p_type text, p_client_name text, p_unit_number text, p_project_name text, p_amount numeric, p_due_date text, p_ref_code text, p_methods_json jsonb, p_company_name text, p_days_ago integer, p_prv_number text, p_payment_date text, p_rejection_reason text) -> text` [INVOKER, IMM, plpgsql]
- `bulk_create_units(p_company_id uuid, p_project_id uuid, p_units jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `calculate_client_health_score(p_client_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `calculate_customer_status(p_client_id uuid, p_company_id uuid) -> text` [DEFINER, VOL, plpgsql]
- `cancel_payment(p_payment_id uuid, p_company_id uuid, p_cancelled_by uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `cancel_payment_link(p_payment_link_id uuid, p_cancelled_by text, p_reason text) -> jsonb` [DEFINER, VOL, plpgsql]
- `cancel_promise(p_promise_id uuid, p_cancel_reason text, p_updated_by text) -> jsonb` [DEFINER, VOL, plpgsql]
- `check_client_blacklisted(p_client_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `check_client_duplicate(p_company_id uuid, p_cnic text, p_phone text) -> jsonb` [DEFINER, VOL, plpgsql]
- `check_company_available(p_company_code text) -> jsonb` [DEFINER, STA, sql]
- `check_email_available(p_email text) -> jsonb` [DEFINER, VOL, plpgsql]
- `check_email_exists(p_email text) -> boolean` [DEFINER, STA, sql]
- `check_noc_eligibility(p_unit_id uuid, p_company_id uuid, p_noc_type text, p_threshold numeric) -> jsonb` [DEFINER, VOL, plpgsql]
- `check_plan_limit(p_company_id uuid, p_resource_type text) -> jsonb` [DEFINER, VOL, plpgsql]
- `check_possession_eligibility(p_unit_id uuid, p_company_id uuid, p_threshold numeric) -> jsonb` [DEFINER, VOL, plpgsql]
- `check_project_plan_limit_trigger() -> trigger` [DEFINER, VOL, plpgsql]
- `check_reset_rate_limit(p_email text) -> jsonb` [DEFINER, VOL, plpgsql]
- `check_session_valid(p_user_id uuid, p_session_version integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `check_subscription_limit(p_organization_id uuid, p_product text, p_metric text) -> jsonb` [DEFINER, STA, plpgsql]
- `check_username_available(p_company_code text, p_username text) -> jsonb` [DEFINER, VOL, plpgsql]
- `check_username_available(p_username text) -> jsonb` [DEFINER, VOL, plpgsql]  ⚠️ overloaded
- `close_campaign(p_id uuid, p_company_id uuid, p_outcome_summary text) -> jsonb` [DEFINER, VOL, plpgsql]
- `confirm_payment_deposit(p_payment_id uuid, p_company_id uuid, p_deposit_date date) -> jsonb` [DEFINER, VOL, plpgsql]
- `confirm_user_email() -> jsonb` [DEFINER, VOL, plpgsql]
- `create_additional_receivable(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_agent(p_company_id uuid, p_created_by uuid, p_full_name text, p_phone text, p_email text, p_cnic text, p_address text, p_commission_percent numeric, p_bank_name text, p_bank_account_no text, p_bank_account_title text, p_join_date date, p_notes text, p_status text) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_agent_commission_payment(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_agent_commission_payment_full(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_agent_transaction(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_app_user(p_company_id uuid, p_full_name text, p_role text, p_password text, p_email text, p_phone text, p_module_permissions jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_blacklist_entry(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_campaign(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_client(p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_contact_log(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_escalation(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_follow_up_reminder(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_invoice_for_subscription(p_subscription_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_noc_request(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_payment_link(p_company_id uuid, p_client_id uuid, p_sale_id uuid, p_installment_ids uuid[], p_amount numeric, p_description text, p_sent_by text, p_sent_by_user_id uuid, p_expires_in_days integer, p_selected_method_ids uuid[]) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_payment_promise(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_pdc_cheque(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_reminder_log(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_sa_support_ticket(p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_sale_with_schedule(p_sale jsonb, p_installments jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `create_unit(p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `current_app_user_id() -> uuid` [DEFINER, STA, sql]
- `current_auth_user_id() -> uuid` [DEFINER, STA, sql]
- `current_user_org_ids() -> SETOF uuid` [DEFINER, STA, sql]
- `custom_access_token_hook(event jsonb) -> jsonb` [DEFINER, STA, plpgsql]
- `defer_installment(p_installment_id uuid, p_company_id uuid, p_new_due_date date, p_reason text) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_additional_receivable(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_agent(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_agent_commission_payment(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_agent_transaction(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_bank(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_campaign(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_client(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_client_simple(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_commission_structure(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_floor(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_legal_case(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_message_template(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_noc(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_payment(p_payment_id uuid, p_company_id uuid, p_deleted_by uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_payment_method(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_pdc_cheque(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_project(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_project_bank_account(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_project_expense(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_project_milestone(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_sa_announcement(p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_sale_amendment(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_sale_document(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_unit(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_unit_simple(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_unit_status(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `delete_unit_type(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `edit_installment_schedule(p_sale_id uuid, p_company_id uuid, p_schedule jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `edit_payment_meta(p_payment_id uuid, p_company_id uuid, p_payment_date date, p_payment_method text, p_reference_no text, p_bank_name text, p_bank_id uuid, p_notes text, p_updated_by uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `edit_sale(p_sale_id uuid, p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `execute_unit_cancellation(… 44 params …) -> jsonb` [DEFINER, VOL, plpgsql]
- `execute_unit_transfer(… 33 params …) -> jsonb` [DEFINER, VOL, plpgsql]
- `execute_unit_transfer_v2(… 25 params …) -> jsonb` [DEFINER, VOL, plpgsql]
- `fn_auto_flag_resale() -> trigger` [INVOKER, VOL, plpgsql]
- `fn_mark_unit_ex_cancelled() -> trigger` [DEFINER, VOL, plpgsql]
- `forecast_recovery(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `generate_agent_code(p_company_id uuid) -> text` [DEFINER, VOL, plpgsql]
- `generate_client_code(p_company_id uuid) -> text` [DEFINER, VOL, plpgsql]
- `generate_invoice_number(p_company_id uuid) -> text` [DEFINER, VOL, plpgsql]
- `generate_payment_link_ref(p_company_id uuid) -> text` [DEFINER, VOL, plpgsql]
- `generate_recovery_radar(p_company_id uuid, p_target_date date, p_top_n integer, p_generated_by text) -> jsonb` [DEFINER, VOL, plpgsql]
- `generate_unit_code(p_company_id uuid) -> text` [DEFINER, VOL, plpgsql]
- `generate_voucher_no(p_company_id uuid, p_prefix text) -> text` [DEFINER, VOL, plpgsql]
- `get_active_announcements() -> jsonb` [DEFINER, VOL, plpgsql]
- `get_active_payment_countries() -> jsonb` [DEFINER, VOL, plpgsql]
- `get_active_sale_for_unit(p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_active_sale_for_unit_full(p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_admin_audit_feed(p_company_id uuid, p_limit integer) -> jsonb` [DEFINER, STA, sql]
- `get_admin_stats() -> jsonb` [DEFINER, VOL, plpgsql]
- `get_agent_360(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_agent_detail_for_search(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_agent_extended(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_agent_full(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_agent_ledger(p_agent_id uuid, p_company_id uuid, p_from_date date, p_to_date date) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_agent_lite(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_agent_name(p_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_agent_performance(p_id uuid, p_company_id uuid, p_from_date date, p_to_date date) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_all_promises(p_company_id uuid, p_status text, p_days_back integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_all_proofs_admin(p_status text) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_audit_entry(p_company_id uuid, p_audit_id bigint) -> TABLE(...)` [DEFINER, VOL, plpgsql]
- `get_audit_logs(… 10 params …) -> TABLE(...)` [DEFINER, VOL, plpgsql]
- `get_audit_stats(p_company_id uuid, p_days integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_auth_events(p_company_id uuid, p_limit integer, p_offset integer, p_event_type text) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_buyer_complaints(p_client_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_buyer_nocs_for_portal(p_client_id uuid, p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_buyer_possession_for_portal(p_client_id uuid, p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_campaign_detail(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_cancellation_by_id(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_cancelled_units_ledger(p_company_id uuid, p_project_id uuid, p_date_from date, p_date_to date, p_refund_status text) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_client_360(p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_client_by_id(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_client_detail_for_search(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_client_health_history(p_client_id uuid, p_company_id uuid, p_limit integer) -> jsonb` [DEFINER, VOL, sql]
- `get_client_health_score(p_client_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, sql]
- `get_client_ledger(p_client_id uuid, p_company_id uuid, p_from_date date, p_to_date date) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_client_lite(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_client_promise_history(p_client_id uuid, p_limit integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_clients_all(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_clients_by_health_category(p_company_id uuid, p_category text) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_clients_plan_status(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_commissions_overview(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_companies_admin() -> jsonb` [DEFINER, VOL, plpgsql]
- `get_company(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_company_branding(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_company_detail_admin(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_company_profile(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_company_targets(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_contact_logs_cache(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_dashboard_kpis(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_effective_commission_rate(p_company_id uuid, p_agent_id uuid, p_project_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_escalation_analytics(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_escalations_legal_combined(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_executive_dashboard(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_feature_value(p_organization_id uuid, p_product text, p_feature_key text) -> jsonb` [DEFINER, STA, sql]
- `get_field_history(p_company_id uuid, p_table_name text, p_record_id text, p_field_name text) -> TABLE(...)` [DEFINER, VOL, plpgsql]
- `get_field_visit_analytics(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_field_visits(p_company_id uuid, p_officer_id uuid, p_date_from date, p_date_to date, p_outcome text, p_search text) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_health_dashboard_stats(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_installment_for_edit(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, sql]
- `get_ip_whitelist(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_latest_radar(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_legal_analytics(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_locked_users(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_message_log(p_company_id uuid, p_limit integer) -> jsonb` [DEFINER, VOL, sql]
- `get_noc_analytics(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_noc_by_id(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_noc_list(p_company_id uuid, p_status text, p_noc_type text, p_search text) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_officer_ledger(p_company_id uuid, p_officer_id uuid, p_project_id uuid, p_date_from date, p_date_to date, p_method text) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_payment_full(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_payment_link_detail(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_payment_link_stats(p_company_id uuid, p_days integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_payment_links(… 7 params …) -> TABLE(...)` [DEFINER, VOL, plpgsql]
- `get_payment_partners_admin() -> jsonb` [DEFINER, VOL, plpgsql]
- `get_payment_partners_by_country(p_country_code text) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_payments_for_unit(p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_pdc_analytics(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_pdc_register(p_company_id uuid, p_status text, p_project_id uuid, p_date_from date, p_date_to date) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_pending_proofs_admin() -> jsonb` [DEFINER, VOL, plpgsql]
- `get_pending_subscription(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_plan_limits_with_usage(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_plan_usage_admin(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_possession_analytics(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_possession_by_id(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_possession_by_unit(p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_post_possession_dues(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_price_revisions(p_company_id uuid, p_project_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_project_collection_ledger(p_project_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_project_ledger(p_project_id uuid, p_company_id uuid, p_from_date date, p_to_date date) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_promise_analytics(p_company_id uuid, p_days integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_promise_conversion_rate(p_company_id uuid, p_window_days integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_promise_stats(p_company_id uuid, p_days integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_radar_accuracy_stats(p_company_id uuid, p_days integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_radar_history(p_company_id uuid, p_days integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_receiving_ledger(p_company_id uuid, p_project_id uuid, p_date_from date, p_date_to date, p_method text) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_record_history(p_company_id uuid, p_table_name text, p_record_id text) -> TABLE(...)` [DEFINER, VOL, plpgsql]  ⚠️ overloaded
- `get_record_history(p_table_name text, p_record_id text, p_company_id uuid) -> TABLE(...)` [DEFINER, VOL, plpgsql]  ⚠️ overloaded
- `get_recovery_page_data(p_company_id uuid, p_filters jsonb) -> jsonb` [DEFINER, STA, plpgsql]
- `get_reminders_bundle(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_reminders_page_data(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_sa_health_dashboard() -> jsonb` [DEFINER, VOL, plpgsql]
- `get_sale_detail(p_sale_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_sale_documents_amendments(p_sale_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, sql]
- `get_sale_for_edit(p_sale_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_sale_for_lookup(p_sale_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_sale_quick_edit(p_sale_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, sql]
- `get_sale_unit_id(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_sales_unit_map(p_company_id uuid, p_sale_ids uuid[]) -> jsonb` [DEFINER, STA, sql]
- `get_schedule_analytics(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_schedule_comparison(p_company_id uuid, p_sale_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_security_settings(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_sensitive_changes(p_company_id uuid, p_days integer, p_limit integer) -> TABLE(...)` [DEFINER, VOL, plpgsql]
- `get_session_context() -> jsonb` [DEFINER, VOL, plpgsql]
- `get_subscription_with_plan(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_today_promises(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_transferred_units_ledger(p_company_id uuid, p_project_id uuid, p_date_from date, p_date_to date, p_settlement_status text) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_tutorial_counts(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_unit_cancellation_full(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_unit_history(p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_unit_ledger(p_unit_id uuid, p_company_id uuid, p_from_date date, p_to_date date) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_unit_ownership_chain(p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_unit_ownership_history(p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_unit_payment_summary(p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_unit_sale_payments(p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_unit_sales_count(p_unit_id uuid, p_company_id uuid) -> integer` [DEFINER, VOL, sql]
- `get_unit_sales_payments(p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_unit_transfer_full(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_unit_with_details(p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_units_all(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_units_by_project(p_project_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_units_cache_bundle(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `get_units_plan_status(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `get_user_activity(p_company_id uuid, p_user_id uuid, p_days integer, p_limit integer) -> TABLE(...)` [DEFINER, VOL, plpgsql]
- `has_org_role(p_org uuid, p_role text) -> boolean` [DEFINER, STA, sql]
- `is_nexunova_staff() -> boolean` [DEFINER, STA, sql]
- `is_org_admin(p_org uuid) -> boolean` [DEFINER, STA, sql]
- `is_org_member(p_org uuid) -> boolean` [DEFINER, STA, sql]
- `list_additional_receivables(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_agent_commission_payments(p_company_id uuid, p_agent_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_agent_commissions_with_agent(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_agent_transactions(p_company_id uuid, p_filters jsonb) -> jsonb` [DEFINER, STA, sql]
- `list_agents(p_company_id uuid, p_search text, p_status text, p_sort text) -> jsonb` [DEFINER, VOL, plpgsql]
- `list_agents_for_fnav(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_agents_for_reports(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_agents_for_search(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_agents_lookup(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_app_users(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `list_app_users_lookup(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_banks(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_banks_active(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_blacklisted_clients(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_broken_promises(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_campaigns(p_company_id uuid) -> jsonb` [DEFINER, VOL, sql]
- `list_cancellations_for_fnav(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_clients(p_company_id uuid, p_filters jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `list_clients_for_search(p_company_id uuid, p_filter text) -> jsonb` [DEFINER, STA, sql]
- `list_clients_lookup(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_commission_structures(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `list_companies() -> jsonb` [DEFINER, STA, sql]
- `list_company_feature_flags(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `list_contact_logs_by_unit(p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_escalations(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_floors(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_installments_filtered(p_company_id uuid, p_filters jsonb) -> jsonb` [DEFINER, STA, plpgsql]
- `list_installments_for_report(p_company_id uuid, p_filters jsonb) -> jsonb` [DEFINER, STA, plpgsql]
- `list_installments_for_search(p_company_id uuid, p_filter text) -> jsonb` [DEFINER, STA, plpgsql]
- `list_legal_cases(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_message_templates(p_company_id uuid, p_channel text) -> jsonb` [DEFINER, VOL, sql]
- `list_open_installments_for_sale(p_sale_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_payables(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_payment_methods(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_payment_methods_active(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_payment_promises_by_unit(p_unit_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_payments_by_sale_full(p_sale_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_payments_filtered(p_company_id uuid, p_filters jsonb) -> jsonb` [DEFINER, STA, plpgsql]
- `list_payments_for_sale(p_sale_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_payments_for_search(p_company_id uuid, p_filter text) -> jsonb` [DEFINER, STA, sql]
- `list_payments_with_sales_unit(p_company_id uuid, p_filters jsonb) -> jsonb` [DEFINER, STA, sql]
- `list_possessions(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_possessions_filtered(p_company_id uuid, p_filters jsonb) -> jsonb` [DEFINER, STA, sql]
- `list_project_bank_accounts(p_project_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_project_expenses(p_project_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_project_milestones(p_project_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_projects(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_reminder_logs(p_company_id uuid, p_limit integer) -> jsonb` [DEFINER, STA, sql]
- `list_sa_announcements() -> jsonb` [DEFINER, VOL, plpgsql]
- `list_sa_support_tickets(p_status text, p_priority text) -> jsonb` [DEFINER, VOL, plpgsql]
- `list_sales(p_company_id uuid, p_search text, p_status text, p_limit integer, p_offset integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `list_sales_by_agent(p_agent_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_sales_by_client(p_client_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_sales_by_client_all(p_client_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_sales_filtered(p_company_id uuid, p_filters jsonb) -> jsonb` [DEFINER, STA, plpgsql]
- `list_sales_for_fnav(p_company_id uuid) -> jsonb` [DEFINER, VOL, sql]
- `list_sales_for_report(p_company_id uuid, p_filters jsonb) -> jsonb` [DEFINER, STA, plpgsql]
- `list_sales_lookup(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_sold_unit_ids(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_sub_agents(p_parent_id uuid, p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_transfers_for_fnav(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_unit_cancellations_search(p_company_id uuid, p_type text, p_limit integer) -> jsonb` [DEFINER, STA, sql]
- `list_unit_statuses(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_unit_transfers_search(p_company_id uuid, p_limit integer) -> jsonb` [DEFINER, STA, sql]
- `list_unit_types(p_company_id uuid) -> jsonb` [DEFINER, STA, sql]
- `list_units(p_company_id uuid, p_filters jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `log_auth_event(p_company_id uuid, p_data jsonb) -> void` [DEFINER, VOL, plpgsql]
- `log_field_visit(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `log_message_sent(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `log_payment_promise(… 10 params …) -> jsonb` [DEFINER, VOL, plpgsql]
- `log_radar_action(p_radar_log_id uuid, p_client_id uuid, p_action_taken text, p_action_by text, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `mark_onboarding_complete(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `mark_pdc_bounced(p_cheque_id uuid, p_company_id uuid, p_bounce_date date, p_bounce_reason text) -> jsonb` [DEFINER, VOL, plpgsql]
- `mark_pdc_cleared(p_cheque_id uuid, p_company_id uuid, p_cleared_date date, p_deposit_ref text) -> jsonb` [DEFINER, VOL, plpgsql]
- `mark_pdc_deposited(p_cheque_id uuid, p_company_id uuid, p_deposit_date date) -> jsonb` [DEFINER, VOL, plpgsql]
- `mark_promise_broken(p_promise_id uuid, p_broken_reason text, p_updated_by text) -> jsonb` [DEFINER, VOL, plpgsql]
- `mark_promise_kept(p_promise_id uuid, p_actual_amount numeric, p_actual_date date, p_actual_via text, p_related_payment_id uuid, p_updated_by text) -> jsonb` [DEFINER, VOL, plpgsql]
- `postpone_promise(p_promise_id uuid, p_new_date date, p_postpone_reason text, p_updated_by text) -> jsonb` [DEFINER, VOL, plpgsql]
- `recalculate_all_health_scores(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `record_payment(… 20 params …) -> jsonb` [DEFINER, VOL, plpgsql]
- `record_promise_reminder(p_promise_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `redeposit_pdc(p_cheque_id uuid, p_company_id uuid, p_new_deposit_date date) -> jsonb` [DEFINER, VOL, plpgsql]
- `reject_payment_link(p_payment_link_id uuid, p_rejected_by text, p_rejection_reason text) -> jsonb` [DEFINER, VOL, plpgsql]
- `remove_client_from_campaign(p_campaign_id uuid, p_client_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `remove_ip_whitelist_entry(p_company_id uuid, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `remove_legal_cost(p_company_id uuid, p_case_id uuid, p_index integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `remove_legal_document(p_company_id uuid, p_case_id uuid, p_index integer) -> jsonb` [DEFINER, VOL, plpgsql]
- `resolve_login_email(p_company_code text, p_username text) -> jsonb` [DEFINER, STA, plpgsql]
- `save_company_branding(p_company_id uuid, p_data jsonb) -> void` [DEFINER, VOL, plpgsql]
- `save_company_targets(p_company_id uuid, p_monthly numeric, p_annual numeric) -> void` [DEFINER, VOL, plpgsql]
- `save_security_settings(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `schedule_pdc_deposit_bulk(p_company_id uuid, p_cheque_ids jsonb, p_deposit_date date) -> jsonb` [DEFINER, VOL, plpgsql]
- `seed_default_templates(p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `send_payment_confirmation(p_payment_link_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `send_payment_link_reminder(p_payment_link_id uuid, p_sent_by text) -> jsonb` [DEFINER, VOL, plpgsql]
- `set_client_comms_optout(p_client_id uuid, p_company_id uuid, p_opt_out boolean) -> jsonb` [DEFINER, VOL, plpgsql]
- `set_company_feature_flag(p_company_id uuid, p_feature_key text, p_is_enabled boolean, p_note text, p_set_by text) -> jsonb` [DEFINER, VOL, plpgsql]
- `set_payment_method_default(p_id uuid, p_company_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `set_sale_number() -> trigger` [INVOKER, VOL, plpgsql]
- `set_updated_at() -> trigger` [INVOKER, VOL, plpgsql]
- `signup_new_company(… 11 params …) -> jsonb` [DEFINER, VOL, plpgsql]
- `snapshot_installment_schedule(p_company_id uuid, p_sale_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `submit_buyer_complaint(p_client_id uuid, p_company_id uuid, p_subject text, p_message text) -> jsonb` [DEFINER, VOL, plpgsql]
- `submit_payment_proof(… 15 params …) -> jsonb` [DEFINER, VOL, plpgsql]
- `suspend_company(p_company_id uuid, p_reason text, p_suspend boolean) -> jsonb` [DEFINER, VOL, plpgsql]
- `sync_reset_password(p_new_password text) -> jsonb` [DEFINER, VOL, plpgsql]
- `toggle_payment_method_active(p_id uuid, p_company_id uuid, p_active boolean) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_additional_receivable(p_id uuid, p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_agent(… 19 params …) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_agent_extended(p_id uuid, p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_app_user(… 9 params …) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_blacklist_entry(p_id uuid, p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_campaign(p_id uuid, p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_client(p_id uuid, p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_company(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_company_profile(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_company_settings(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_escalation(p_id uuid, p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_noc_status(p_id uuid, p_company_id uuid, p_status text, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_payable(p_id uuid, p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_pdc_cheque(p_id uuid, p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_promise_status() -> trigger` [INVOKER, VOL, plpgsql]
- `update_radar_outcome(p_radar_log_id uuid, p_client_id uuid, p_payment_amount numeric, p_payment_date date) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_sa_ticket(p_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_unit(p_id uuid, p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `update_unit_possession_fields(p_id uuid, p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `upload_payment_screenshot(… 8 params …) -> jsonb` [DEFINER, VOL, plpgsql]
- `upload_sale_document(p_company_id uuid, p_sale_id uuid, p_document_type text, p_document_name text, p_document_url text, p_uploaded_by text) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_bank(p_company_id uuid, p_data jsonb, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_client(p_company_id uuid, p_data jsonb, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_commission_structure(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_floor(p_company_id uuid, p_data jsonb, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_legal_case(p_company_id uuid, p_data jsonb, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_message_template(p_company_id uuid, p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_payment_method(p_company_id uuid, p_data jsonb, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_possession(p_company_id uuid, p_data jsonb, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_project(p_company_id uuid, p_data jsonb, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_project_bank_account(p_company_id uuid, p_data jsonb, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_project_expense(p_company_id uuid, p_data jsonb, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_project_milestone(p_company_id uuid, p_data jsonb, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_sa_announcement(p_data jsonb) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_unit(p_company_id uuid, p_data jsonb, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_unit_status(p_company_id uuid, p_data jsonb, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `upsert_unit_type(p_company_id uuid, p_data jsonb, p_id uuid) -> jsonb` [DEFINER, VOL, plpgsql]
- `verify_login(p_company_code text, p_username text, p_password text) -> jsonb` [DEFINER, VOL, plpgsql]
- `verify_payment(p_proof_id uuid, p_action text, p_verified_by uuid, p_notes text) -> jsonb` [DEFINER, VOL, plpgsql]
- `verify_payment_link(… 8 params …) -> jsonb` [DEFINER, VOL, plpgsql]
- `verify_super_admin(p_password text) -> jsonb` [DEFINER, VOL, plpgsql]

> Long-signature RPCs abbreviated above (`… N params …`): `execute_unit_cancellation` (44), `execute_unit_transfer` (33), `execute_unit_transfer_v2` (25), `record_payment` (20), `update_agent` (19), `submit_payment_proof` (15), `signup_new_company` (11), `log_payment_promise` (10), `get_audit_logs` (10), `update_app_user` (9), `upload_payment_screenshot` (8), `verify_payment_link` (8). Full parameter lists are available via `pg_get_function_identity_arguments` if needed.

---

# 6. Triggers (59)

| Table | Trigger | Timing/Event | Level | Function |
|---|---|---|---|---|
| additional_receivables | set_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| agents | _trg_audit | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| agents | trg_agents_upd | BEFORE UPDATE | ROW | set_updated_at |
| agents | trg_agents_updated_at | BEFORE UPDATE | ROW | agents_set_updated_at |
| app_users | trg_app_users_upd | BEFORE UPDATE | ROW | set_updated_at |
| category_payment_types | trg_cat_payment_types_upd | BEFORE UPDATE | ROW | set_updated_at |
| category_unit_statuses | trg_cat_unit_statuses_upd | BEFORE UPDATE | ROW | set_updated_at |
| category_unit_types | trg_cat_unit_types_upd | BEFORE UPDATE | ROW | set_updated_at |
| clients | _trg_audit | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| clients | clients_set_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| clients | trg_clients_upd | BEFORE UPDATE | ROW | set_updated_at |
| companies | trg_companies_upd | BEFORE UPDATE | ROW | set_updated_at |
| contact_logs | trg_call_health | AFTER INSERT | ROW | _trg_health_recalc |
| contact_logs | trg_health_contact | AFTER INSERT | ROW | _trg_health_recalc |
| escalations | set_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| installments | _trg_audit | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| installments | trg_installments_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| legal_cases | set_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| payables | set_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| payment_promises | _trg_audit | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| payment_promises | set_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| payment_promises | trg_promise_health | AFTER UPDATE | ROW | _trg_health_recalc |
| payments | _trg_audit | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| payments | trg_health_payment | AFTER INS/UPD | ROW | _trg_health_recalc |
| payments | trg_payment_health | AFTER INS/UPD | ROW | _trg_health_recalc |
| payments | trg_payments_upd | BEFORE UPDATE | ROW | set_updated_at |
| payments | trg_update_promise_on_payment | AFTER INSERT | ROW | update_promise_status |
| pdc_cheques | _trg_audit | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| pdc_cheques | trg_health_pdc | AFTER UPDATE | ROW | _trg_health_recalc |
| pdc_cheques | trg_pdc_health | AFTER UPDATE | ROW | _trg_health_recalc |
| platform_api_keys | audit_trg | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| platform_email_templates | trg_pet_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| platform_invitations | audit_trg | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| platform_organization_members | audit_trg | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| platform_organization_members | trg_pom_fill_auth_user_id | BEFORE INS/UPD | ROW | _trg_pom_sync_auth_user_id |
| platform_organization_members | trg_pom_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| platform_settings | audit_trg | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| platform_settings | trg_ps_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| platform_subscription_features | trg_psf_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| platform_user_preferences | trg_pup_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| platform_webhooks | audit_trg | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| platform_webhooks | trg_pwh_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| projects | _trg_audit | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| projects | enforce_project_plan_limit | BEFORE INSERT | ROW | check_project_plan_limit_trigger |
| projects | trg_projects_upd | BEFORE UPDATE | ROW | set_updated_at |
| recovery_agents | set_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| sale_amendments | _trg_audit | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| sales | _trg_audit | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| sales | trg_auto_flag_resale | BEFORE INSERT | ROW | fn_auto_flag_resale |
| sales | trg_sale_number_gen | BEFORE INSERT | ROW | set_sale_number |
| sales | trg_sales_updated_at | BEFORE UPDATE | ROW | set_updated_at |
| subscription_plans | trg_subscription_plans_upd | BEFORE UPDATE | ROW | set_updated_at |
| subscriptions | trg_subscriptions_upd | BEFORE UPDATE | ROW | set_updated_at |
| unit_cancellations | _trg_audit | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| unit_cancellations | trg_mark_unit_ex_cancelled | AFTER INSERT | ROW | fn_mark_unit_ex_cancelled |
| unit_transfers | _trg_audit | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| units | _trg_audit | AFTER INS/DEL/UPD | ROW | audit_trigger_function |
| units | trg_units_upd | BEFORE UPDATE | ROW | set_updated_at |
| units | units_set_updated_at | BEFORE UPDATE | ROW | set_updated_at |

(All triggers enabled — `tgenabled = 'O'`.)

---

# 7. Views (5)

All 5 are `platform_*` compatibility/aliasing views over base tables (column renames for a platform API layer):

| View | Source table | Notes |
|---|---|---|
| platform_audit_log | audit_logs | renames company_id→organization_id, changed_by→user_id, etc. |
| platform_invoices | invoices | renames company_id→organization_id, due_date→due_at, plan_id→legacy_plan_id |
| platform_organizations | companies | `WHERE deleted_at IS NULL`; company_name→name, company_type→industry |
| platform_subscriptions | subscriptions | company_id→organization_id, amount→amount_pkr |
| platform_users | app_users | company_id→primary_organization_id, role→primary_organization_role |

---

# 8. Audit observations (read-only — nothing changed)

These are flagged for awareness only; no fixes were applied.

1. **RLS disabled on 4 tables** — `auth_events`, `company_feature_flags`, `sa_announcements`, `sa_support_tickets`. Functionally these are accessed via SECURITY DEFINER RPCs, but with RLS off, any direct table-level grant to `anon`/`authenticated` would be unprotected. Worth confirming no direct grants exist on these.

2. **Two different multi-tenant isolation mechanisms coexist** (Pattern B):
   - Some policies use `company_id = (SELECT company_id FROM app_users WHERE id = auth.uid())`.
   - Others use `company_id = current_setting('app.current_company_id', true)::uuid`.
   Note: `auth.uid()` returns the Supabase **auth** user id, whereas `app_users.id` is the app PK (the auth id is stored separately in `app_users.auth_user_id`). Unless `app_users.id == auth_user_id` for these tenants, the `app_users.id = auth.uid()` predicate may not match — **verify** this resolves correctly for the custom-auth login path.

3. **Redundant duplicate triggers firing the same function twice** (harmless but wasteful — candidates for cleanup):
   - `clients`: `clients_set_updated_at` + `trg_clients_upd` (both → set_updated_at)
   - `agents`: `trg_agents_upd` (→set_updated_at) + `trg_agents_updated_at` (→agents_set_updated_at) — two updated_at triggers
   - `units`: `trg_units_upd` + `units_set_updated_at` (both → set_updated_at)
   - `payments`: `trg_health_payment` + `trg_payment_health` (both → _trg_health_recalc)
   - `pdc_cheques`: `trg_health_pdc` + `trg_pdc_health` (both → _trg_health_recalc)
   - `contact_logs`: `trg_call_health` + `trg_health_contact` (both → _trg_health_recalc)

4. **Overloaded functions** (two signatures each):
   - `check_username_available(text)` vs `check_username_available(text, text)`
   - `get_record_history(company_id, table, record)` vs `get_record_history(table, record, company_id)` — different return shapes; the swapped-argument-order pair is a callable-ambiguity risk.

5. **Client deletion is intentionally protected**: `legal_cases.client_id` and `payables.client_id` are `ON DELETE RESTRICT`, while `sales/payments/unit_cancellations/unit_transfers` reference clients with `NO ACTION`. Net effect: a client with financial/legal history cannot be hard-deleted (the `delete_client*` RPCs handle this). `sales.project_id` is also `RESTRICT`.

6. **Security model is RPC-centric**: 388/394 functions are `SECURITY DEFINER`; the 6 `SECURITY INVOKER` are trigger helpers (`set_updated_at`, `agents_set_updated_at`, `_trg_health_recalc`, `_trg_pom_sync_auth_user_id`, `fn_auto_flag_resale`, `set_sale_number`, `_generate_noc_number`, `build_whatsapp_message`). All direct table DML for RMS tables is blocked by `deny_all_anon`. This matches the documented PATH_B RPC-lockdown design.
