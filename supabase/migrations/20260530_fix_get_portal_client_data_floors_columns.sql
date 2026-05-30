-- ════════════════════════════════════════════════════════════
-- TINY CLEANUP: fix pre-existing column-name bugs in get_portal_client_data
-- 2026-05-30.  Unrelated to project-scoping; kept separate per Rashid's instruction.
-- ════════════════════════════════════════════════════════════
-- Same class of bug as the get_agent_performance total_price → net_amount fix.
-- The function referenced FOUR non-existent columns; corrected to the real ones.
-- Verified end-to-end via a seeded portal_session; floor / unit info now returns.
--
--   floors.floor_name    → floors.name
--   floors.floor_number  → floors.sort_order
--   units.area_sqft      → units.area
--   units.unit_type      → units.unit_type_id  (FK; UUID — same shape the column actually has)
--
-- Zero current impact: no portal_sessions exist pre-go-live. The function would
-- have errored 42703 on every real portal request. Everything else (incl. the
-- deliberately-untouched isolation model) is preserved verbatim.

CREATE OR REPLACE FUNCTION public.get_portal_client_data(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ses  public.portal_sessions;
  v_cl   public.clients;
  v_sale RECORD;
  v_unit RECORD;
  v_fl   RECORD;
BEGIN
  SELECT * INTO v_ses FROM public.portal_sessions
  WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','session_expired');
  END IF;

  SELECT * INTO v_cl FROM public.clients
  WHERE id=v_ses.client_id AND company_id=v_ses.company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','client_not_found'); END IF;

  SELECT s.id, s.sale_number, s.sale_date, s.status, s.unit_id,
    COALESCE(s.net_amount,s.total_amount,0) AS net_amount,
    COALESCE(s.total_amount,s.net_amount,0) AS total_amount,
    COALESCE(s.discount,0) AS discount,
    COALESCE(s.down_payment,0) AS down_payment,
    s.installment_count,
    COALESCE((SELECT SUM(p.amount) FROM public.payments p
      WHERE p.sale_id=s.id AND p.company_id=s.company_id
        AND p.status IN ('received','cleared')),0) AS total_paid,
    GREATEST(0, COALESCE(s.net_amount,s.total_amount,0) -
      COALESCE((SELECT SUM(p.amount) FROM public.payments p
        WHERE p.sale_id=s.id AND p.company_id=s.company_id
          AND p.status IN ('received','cleared')),0)) AS total_outstanding,
    (SELECT i.due_date FROM public.installments i
     WHERE i.sale_id=s.id AND i.company_id=s.company_id
       AND COALESCE(i.amount_due,0)-COALESCE(i.amount_paid,0)>0
       AND i.due_date>=CURRENT_DATE ORDER BY i.due_date LIMIT 1) AS next_due_date,
    GREATEST(0,(SELECT COALESCE(i.amount_due,0)-COALESCE(i.amount_paid,0)
      FROM public.installments i
      WHERE i.sale_id=s.id AND i.company_id=s.company_id
        AND COALESCE(i.amount_due,0)-COALESCE(i.amount_paid,0)>0
        AND i.due_date>=CURRENT_DATE ORDER BY i.due_date LIMIT 1)) AS next_due_amount
  INTO v_sale
  FROM public.sales s
  WHERE s.client_id=v_ses.client_id AND s.company_id=v_ses.company_id AND s.status='active'
  ORDER BY s.sale_date DESC NULLS LAST LIMIT 1;

  IF v_sale.unit_id IS NOT NULL THEN
    -- FIX: u.area_sqft → u.area; u.unit_type → u.unit_type_id
    SELECT u.id, u.unit_no, u.area AS area, 'Sqft'::text AS area_unit,
           u.floor_id, u.unit_type_id AS unit_type, NULL::text AS floor_label,
           NULL::text AS block, NULL::int AS bedrooms, NULL::int AS bathrooms
    INTO v_unit FROM public.units u WHERE u.id=v_sale.unit_id;

    IF v_unit.floor_id IS NOT NULL THEN
      -- FIX: floors columns are 'name' / 'sort_order' (not 'floor_name' / 'floor_number')
      SELECT id, COALESCE(name, sort_order::text, 'Floor') AS name
      INTO v_fl FROM public.floors WHERE id=v_unit.floor_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'client', jsonb_build_object(
      'id',v_cl.id,'company_id',v_ses.company_id,'full_name',v_cl.full_name,
      'client_code',v_cl.client_code,'cnic',v_cl.cnic,
      'phone_primary',v_cl.phone_primary,'email',v_cl.email),
    'sale', CASE WHEN v_sale.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
      'id',v_sale.id,'sale_number',v_sale.sale_number,'sale_date',v_sale.sale_date,
      'status',v_sale.status,'unit_id',v_sale.unit_id,'net_amount',v_sale.net_amount,
      'total_amount',v_sale.total_amount,'discount',v_sale.discount,
      'down_payment',v_sale.down_payment,'installment_count',v_sale.installment_count,
      'total_paid',v_sale.total_paid,'total_outstanding',v_sale.total_outstanding,
      'next_due_date',v_sale.next_due_date,'next_due_amount',v_sale.next_due_amount) END,
    'unit', CASE WHEN v_unit.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
      'id',v_unit.id,'unit_no',v_unit.unit_no,'unit_type',v_unit.unit_type,
      'area',v_unit.area,'area_unit',v_unit.area_unit,'floor_label',v_unit.floor_label,
      'block',v_unit.block,'bedrooms',v_unit.bedrooms,'bathrooms',v_unit.bathrooms) END,
    'floor', CASE WHEN v_fl IS NULL OR v_fl.id IS NULL THEN '{}'::jsonb
             ELSE jsonb_build_object('id',v_fl.id,'name',v_fl.name) END,
    'company_id', v_ses.company_id
  );
END;
$function$;
