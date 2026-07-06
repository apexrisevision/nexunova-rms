-- Phase 1B — buyer portal (Mera Hisaab) shows the developer's brand.
-- Adds a `company` object (legal name + logo + white_label) to get_portal_sales
-- so the buyer portal topbar can render the developer's logo + legal name.
-- Applied to prod via MCP 2026-07-06.
CREATE OR REPLACE FUNCTION public.get_portal_sales(p_session_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.portal_sessions; v_cl public.clients; v_sales jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.portal_sessions
   WHERE session_token = p_session_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_expired'); END IF;

  SELECT * INTO v_cl FROM public.clients
   WHERE id = v_ses.client_id AND company_id = v_ses.company_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'sale_id', s.id, 'sale_number', s.sale_number, 'unit_id', s.unit_id,
           'unit_no', u.unit_no, 'project_name', pr.project_name, 'status', s.status
         ) ORDER BY s.sale_date DESC NULLS LAST), '[]'::jsonb)
    INTO v_sales
  FROM public.sales s
  LEFT JOIN public.units u   ON u.id = s.unit_id
  LEFT JOIN public.projects pr ON pr.id = COALESCE(s.project_id, u.project_id)
  WHERE s.company_id = v_ses.company_id AND s.client_id = v_ses.client_id
    AND s.status = 'active' AND s.unit_id IS NOT NULL;

  RETURN jsonb_build_object('success', true,
    'client', jsonb_build_object('full_name', v_cl.full_name,
                                 'client_code', v_cl.client_code, 'cnic', v_cl.cnic),
    'company', (SELECT jsonb_build_object(
                  'name', c.company_name,             -- buyer-facing → legal name
                  'logo_url', c.logo_url,
                  'white_label', public._company_white_label(c.id)
                ) FROM companies c WHERE c.id = v_ses.company_id),
    'sales', v_sales);
END; $function$
