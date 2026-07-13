-- Change Unit — put the trail where a human actually looks.
--
-- The first cut added the change event to get_unit_history. Nothing in the app calls that RPC.
-- The screen a human opens is the Ownership Chain, which reads get_unit_ownership_chain — and that
-- one keys every event off sales.unit_id. A unit change REPOINTS the sale to the new unit, so the
-- unit he LEFT went completely silent about a client who was once allotted it. The owner's whole
-- requirement ("trail mein rahay ga ke is client ko pehle ye unit allot hua tha") was therefore
-- not actually met on screen, even though the data was right.
--
-- unit_changes is now matched on BOTH sides: the unit he left shows an outbound event, the unit he
-- entered an inbound one. amount_a is deliberately the side belonging to the unit being viewed.
--
-- Frontend counterpart: ownership-chain.js gains a 'unit_change' entry in its type/label/tone maps
-- ("Unit Changed") and the amount labels "Price On This Unit" / "Paid & Carried".
CREATE OR REPLACE FUNCTION public.get_unit_ownership_chain(p_unit_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_rows jsonb;
  v_unit jsonb;
BEGIN
  SELECT to_jsonb(u) INTO v_unit
  FROM (
    SELECT u.id, u.unit_no, u.unit_code, u.floor_label, u.block,
           u.origin_type, u.last_event_at,
           p.project_name AS project_name
    FROM public.units u
    LEFT JOIN public.projects p ON p.id = u.project_id
    WHERE u.id = p_unit_id AND u.company_id = p_company_id
  ) u;

  IF v_unit IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unit_not_found');
  END IF;

  WITH sale_events AS (
    SELECT
      s.sale_date::timestamptz AS event_at,
      'sale'::text AS event_type,
      s.id AS sale_id,
      s.client_id,
      c.full_name AS client_name,
      c.cnic AS client_cnic,
      c.phone_primary AS client_phone,
      s.sale_number AS voucher_no,
      s.net_amount AS amount_a,
      COALESCE((SELECT SUM(i.amount_paid) FROM public.installments i WHERE i.sale_id = s.id), 0) AS amount_b,
      NULL::text AS reason,
      NULL::text AS note,
      COALESCE(s.is_resale, false) AS is_resale,
      COALESCE(s.is_transfer, false) AS is_transfer,
      COALESCE(s.is_active, true) AS is_active,
      s.created_at
    FROM public.sales s
    LEFT JOIN public.clients c ON c.id = s.client_id
    WHERE s.unit_id = p_unit_id AND s.company_id = p_company_id
  ),
  cancel_events AS (
    SELECT
      x.cancellation_date::timestamptz AS event_at,
      'cancellation'::text AS event_type,
      x.sale_id,
      x.client_id,
      c.full_name AS client_name,
      c.cnic AS client_cnic,
      c.phone_primary AS client_phone,
      x.cancellation_voucher_no AS voucher_no,
      x.total_paid AS amount_a,
      x.net_refund_amount AS amount_b,
      x.reason_category AS reason,
      x.detailed_reason AS note,
      false AS is_resale,
      false AS is_transfer,
      true  AS is_active,
      x.created_at
    FROM public.unit_cancellations x
    LEFT JOIN public.clients c ON c.id = x.client_id
    WHERE x.unit_id = p_unit_id AND x.company_id = p_company_id
  ),
  xfer_events AS (
    SELECT
      t.transfer_date::timestamptz AS event_at,
      'transfer'::text AS event_type,
      t.new_sale_id AS sale_id,
      t.new_client_id AS client_id,
      cn.full_name AS client_name,
      cn.cnic AS client_cnic,
      cn.phone_primary AS client_phone,
      t.transfer_voucher_no AS voucher_no,
      t.new_sale_price AS amount_a,
      t.total_transfer_charges AS amount_b,
      ('Transferred from ' || COALESCE(co.full_name, 'previous owner'))::text AS reason,
      t.notes AS note,
      false AS is_resale,
      true  AS is_transfer,
      true  AS is_active,
      t.created_at
    FROM public.unit_transfers t
    LEFT JOIN public.clients cn ON cn.id = t.new_client_id
    LEFT JOIN public.clients co ON co.id = t.old_client_id
    WHERE t.unit_id = p_unit_id AND t.company_id = p_company_id
  ),
  change_events AS (
    SELECT
      ch.change_date::timestamptz AS event_at,
      'unit_change'::text AS event_type,
      ch.sale_id,
      ch.client_id,
      c.full_name AS client_name,
      c.cnic AS client_cnic,
      c.phone_primary AS client_phone,
      ch.change_voucher_no AS voucher_no,
      (CASE WHEN ch.old_unit_id = p_unit_id THEN ch.old_net_amount ELSE ch.new_net_amount END) AS amount_a,
      ch.amount_received AS amount_b,
      (CASE WHEN ch.old_unit_id = p_unit_id
            THEN 'Client moved OUT to unit ' || COALESCE(NULLIF(nu.unit_no,''), nu.unit_code, '—')
            ELSE 'Client moved IN from unit ' || COALESCE(NULLIF(ou.unit_no,''), ou.unit_code, '—')
       END)::text AS reason,
      ch.reason AS note,
      false AS is_resale,
      false AS is_transfer,
      true  AS is_active,
      ch.created_at
    FROM public.unit_changes ch
    LEFT JOIN public.clients c  ON c.id  = ch.client_id
    LEFT JOIN public.units   ou ON ou.id = ch.old_unit_id
    LEFT JOIN public.units   nu ON nu.id = ch.new_unit_id
    WHERE ch.company_id = p_company_id
      AND (ch.old_unit_id = p_unit_id OR ch.new_unit_id = p_unit_id)
  )
  SELECT jsonb_agg(row_to_json(t.*) ORDER BY t.event_at, t.created_at)
  INTO v_rows
  FROM (
    SELECT * FROM sale_events
    UNION ALL SELECT * FROM cancel_events
    UNION ALL SELECT * FROM xfer_events
    UNION ALL SELECT * FROM change_events
  ) t;

  RETURN jsonb_build_object(
    'success', true,
    'unit',    v_unit,
    'chain',   COALESCE(v_rows, '[]'::jsonb)
  );
END;
$function$;
