-- ════════════════════════════════════════════════════════════════════════════
-- AD-SPEND TRACKING + COST-PER-LEAD (sales-portal marketing ROI).
-- 2026-06-21. The lead_entry operator (who runs the ads) logs what each
-- FB/Instagram/WhatsApp campaign cost; CFO + Director see cost-per-lead =
-- spend ÷ source-matched leads, date-matched to the campaign's own range.
-- This is RMS sales-side ROI only — NOT QuickBooks accounting.
--
-- Lock model (see 20260621_lead_entry_role.sql): non-entry RPCs carry a
-- `_sales_role_of(token)='lead_entry' → forbidden` guard; the allowlist is the
-- set WITHOUT it. log_ad_spend + get_my_ad_spend are created WITHOUT the guard
-- (lead_entry may call them); get_ad_performance IS guarded + role-gated to
-- admin/cfo/director (the operator can log spend but never see the ROI report).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) data: per-tenant ad campaign spend
CREATE TABLE IF NOT EXISTS public.ad_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('facebook','instagram','whatsapp')),
  campaign_name text NOT NULL CHECK (length(btrim(campaign_name)) > 0),
  amount        numeric NOT NULL CHECK (amount >= 0),
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  notes         text,
  created_by    uuid REFERENCES public.sales_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_company_platform_dates
  ON public.ad_campaigns (company_id, platform, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_created_by ON public.ad_campaigns (created_by);
-- access only via SECURITY DEFINER RPCs (match leads / reservations: RLS on, 0 policies)
ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;

-- 2) log_ad_spend — operator (+ director/cfo/admin) records a campaign's cost.
--    NO lead_entry guard → on the operator's allowlist. Scoped to caller's company.
CREATE OR REPLACE FUNCTION public.log_ad_spend(
  p_session_token text, p_platform text, p_campaign_name text,
  p_amount numeric, p_start_date date, p_end_date date, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_id uuid;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('lead_entry','director','cfo','admin') THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  IF p_platform NOT IN ('facebook','instagram','whatsapp') THEN
    RETURN jsonb_build_object('success',false,'error','bad_platform'); END IF;
  IF p_campaign_name IS NULL OR length(btrim(p_campaign_name))=0 THEN
    RETURN jsonb_build_object('success',false,'error','name_required'); END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN jsonb_build_object('success',false,'error','bad_amount'); END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RETURN jsonb_build_object('success',false,'error','bad_dates'); END IF;
  INSERT INTO public.ad_campaigns(company_id,platform,campaign_name,amount,start_date,end_date,notes,created_by)
  VALUES (v_ses.company_id, p_platform, btrim(p_campaign_name), round(p_amount::numeric,2),
          p_start_date, p_end_date, NULLIF(btrim(COALESCE(p_notes,'')),''), v_ses.sales_user_id)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'id',v_id);
END
$function$;
REVOKE ALL ON FUNCTION public.log_ad_spend(text,text,text,numeric,date,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_ad_spend(text,text,text,numeric,date,date,text) TO anon, authenticated;

-- 3) get_my_ad_spend — the operator reviews the campaigns SHE entered + monthly roll-up.
--    NO lead_entry guard → on the operator's allowlist. Scoped to created_by = caller.
CREATE OR REPLACE FUNCTION public.get_my_ad_spend(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_rows jsonb; v_monthly jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',id,'platform',platform,'campaign_name',campaign_name,'amount',amount,
           'start_date',to_char(start_date,'YYYY-MM-DD'),'end_date',to_char(end_date,'YYYY-MM-DD'),
           'notes',notes,'created_at',created_at) ORDER BY start_date DESC, created_at DESC),'[]'::jsonb)
    INTO v_rows
    FROM public.ad_campaigns
    WHERE company_id=v_ses.company_id AND created_by=v_ses.sales_user_id;

  SELECT COALESCE(jsonb_agg(m ORDER BY (m->>'month') DESC),'[]'::jsonb) INTO v_monthly FROM (
    SELECT jsonb_build_object(
      'month', to_char(start_date,'YYYY-MM'),
      'month_label', to_char(start_date,'Mon YYYY'),
      'total', SUM(amount),
      'campaigns', COUNT(*),
      'facebook',  COALESCE(SUM(amount) FILTER (WHERE platform='facebook'),0),
      'instagram', COALESCE(SUM(amount) FILTER (WHERE platform='instagram'),0),
      'whatsapp',  COALESCE(SUM(amount) FILTER (WHERE platform='whatsapp'),0)) m
    FROM public.ad_campaigns
    WHERE company_id=v_ses.company_id AND created_by=v_ses.sales_user_id
    GROUP BY to_char(start_date,'YYYY-MM'), to_char(start_date,'Mon YYYY')
  ) q;

  RETURN jsonb_build_object('success',true,'rows',v_rows,'monthly',v_monthly);
END
$function$;
REVOKE ALL ON FUNCTION public.get_my_ad_spend(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_ad_spend(text) TO anon, authenticated;

-- 4) get_ad_performance — CFO/Director cost-per-lead report for a month.
--    GUARDED (lead_entry forbidden) + role-gated to admin/cfo/director.
--    Per platform: spend (campaigns active in the month) ÷ DISTINCT leads whose
--    source=platform AND created_at within a matching campaign's OWN date range
--    (period-matched — leads outside every campaign range are not counted).
--    leads=0 → cost_per_lead = null (UI shows "no leads yet", no divide error).
CREATE OR REPLACE FUNCTION public.get_ad_performance(p_session_token text, p_month text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_co uuid;
  v_ms date; v_me date; v_platforms jsonb; v_campaigns jsonb; v_tot_spend numeric; v_tot_leads int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  IF public._sales_role_of(p_session_token)='lead_entry' THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  SELECT role INTO v_role FROM public.sales_users WHERE id=v_ses.sales_user_id;
  IF v_role NOT IN ('admin','cfo','director') THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;
  v_co := v_ses.company_id;

  -- selected month (YYYY-MM); default current month
  BEGIN v_ms := date_trunc('month', to_date(COALESCE(p_month,to_char(CURRENT_DATE,'YYYY-MM')),'YYYY-MM'))::date;
  EXCEPTION WHEN others THEN v_ms := date_trunc('month',CURRENT_DATE)::date; END;
  v_me := (v_ms + interval '1 month')::date;

  -- campaigns active in the month (range overlaps [v_ms, v_me))
  WITH camps AS (
    SELECT id, platform, campaign_name, amount, start_date, end_date, notes
    FROM public.ad_campaigns
    WHERE company_id=v_co AND start_date < v_me AND end_date >= v_ms
  ),
  -- per-campaign leads: source=platform AND created_at within the campaign's own range
  camp_leads AS (
    SELECT c.id, COUNT(l.id) leads
    FROM camps c
    LEFT JOIN public.leads l
      ON l.company_id=v_co AND l.source=c.platform
      AND l.created_at::date BETWEEN c.start_date AND c.end_date
    GROUP BY c.id
  ),
  -- per-platform spend
  plat_spend AS (
    SELECT platform, SUM(amount) spend, COUNT(*) campaigns FROM camps GROUP BY platform
  ),
  -- per-platform DISTINCT leads (de-dupe across overlapping same-platform campaigns)
  plat_leads AS (
    SELECT c.platform, COUNT(DISTINCT l.id) leads
    FROM camps c
    JOIN public.leads l
      ON l.company_id=v_co AND l.source=c.platform
      AND l.created_at::date BETWEEN c.start_date AND c.end_date
    GROUP BY c.platform
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'platform', ps.platform, 'spend', ps.spend, 'campaigns', ps.campaigns,
        'leads', COALESCE(pl.leads,0),
        'cost_per_lead', CASE WHEN COALESCE(pl.leads,0)>0 THEN round(ps.spend/pl.leads,0) ELSE NULL END)
      ORDER BY ps.spend DESC)
      FROM plat_spend ps LEFT JOIN plat_leads pl ON pl.platform=ps.platform),'[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'platform', c.platform, 'campaign_name', c.campaign_name, 'amount', c.amount,
        'start_date', to_char(c.start_date,'YYYY-MM-DD'), 'end_date', to_char(c.end_date,'YYYY-MM-DD'),
        'notes', c.notes, 'leads', COALESCE(cl.leads,0),
        'cost_per_lead', CASE WHEN COALESCE(cl.leads,0)>0 THEN round(c.amount/cl.leads,0) ELSE NULL END)
      ORDER BY c.platform, c.start_date DESC)
      FROM camps c LEFT JOIN camp_leads cl ON cl.id=c.id),'[]'::jsonb),
    COALESCE((SELECT SUM(amount) FROM camps),0),
    COALESCE((SELECT SUM(leads) FROM plat_leads),0)
  INTO v_platforms, v_campaigns, v_tot_spend, v_tot_leads;

  RETURN jsonb_build_object('success',true,
    'month', to_char(v_ms,'YYYY-MM'), 'month_label', to_char(v_ms,'Mon YYYY'),
    'platforms', v_platforms, 'campaigns', v_campaigns,
    'totals', jsonb_build_object('spend', v_tot_spend, 'leads', v_tot_leads,
      'cost_per_lead', CASE WHEN v_tot_leads>0 THEN round(v_tot_spend/v_tot_leads,0) ELSE NULL END));
END
$function$;
REVOKE ALL ON FUNCTION public.get_ad_performance(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ad_performance(text,text) TO anon, authenticated;
