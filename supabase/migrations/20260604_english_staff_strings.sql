-- ════════════════════════════════════════════════════════════════════════
-- 2026-06-04  i18n: staff-facing Roman-Urdu → English (Category A audit).
-- notify_admin_subuser_reset: the WhatsApp body sent to the ADMIN (a staff user)
-- is the only change. Everything else in the function body is byte-identical.
-- Client-facing comms (build_whatsapp_message, send_payment_*, seed_default_templates)
-- and Urdu report templates are intentional and deliberately NOT touched.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_admin_subuser_reset(p_company_code text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_email    TEXT := lower(trim(p_email));
  v_company  RECORD;
  v_sub_user RECORD;
  v_admin    RECORD;
  v_at       INT;
  v_masked   TEXT;
BEGIN
  SELECT id, company_name AS name INTO v_company
  FROM public.companies
  WHERE upper(trim(company_code)) = upper(trim(p_company_code)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT id, full_name INTO v_sub_user
  FROM public.app_users
  WHERE company_id = v_company.id AND lower(email) = v_email
    AND role NOT IN ('admin', 'owner')
    AND (status IS NULL OR status = 'active')
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT id, full_name, email, phone INTO v_admin
  FROM public.app_users
  WHERE company_id = v_company.id AND role IN ('admin', 'owner')
    AND (status IS NULL OR status = 'active')
  ORDER BY (role = 'owner') DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'no_admin'); END IF;

  IF v_admin.phone IS NOT NULL AND trim(v_admin.phone) <> '' THEN
    PERFORM public.enqueue_message(
      v_company.id,
      jsonb_build_object(
        'channel',    'whatsapp',
        'to_address', v_admin.phone,
        'body',       format(
          'Nexunova RMS: "%s" requested a password reset. Reset it in Admin Panel > Users.',
          v_sub_user.full_name
        ),
        'category', 'subuser_reset_request'
      )
    );
  END IF;

  IF v_admin.email IS NOT NULL AND trim(v_admin.email) <> '' THEN
    PERFORM net.http_post(
      url     := 'https://itqxljtfbrppntgyfush.supabase.co/functions/v1/send-otp-email',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'email',         v_admin.email,
        'purpose',       'subuser_reset_notify',
        'subuser_name',  v_sub_user.full_name,
        'subuser_email', v_email,
        'company_name',  v_company.name
      )
    );
  END IF;

  v_at     := position('@' IN v_admin.email);
  v_masked := left(v_admin.email, least(2, v_at - 1)) || '***'
              || substring(v_admin.email FROM v_at);

  RETURN jsonb_build_object('notified', true, 'admin_email', v_masked);
END;
$function$;
