-- ═══════════════════════════════════════════════════════════════════════════
-- get_map_unit_detail — a THIRD tier for a sold unit
--
-- Until now the answer had two shapes: a director saw everything, and a rep saw
-- the word "Sold" and nothing else. The owner asked for the middle ground a
-- salesperson actually needs at a client meeting:
--
--   REP / STAFF   unit_no · floor · type · area  +  the client's NAME
--                 and NOTHING that is money or contact:
--                 no price, no list price, no phone, no dues.
--   DIRECTOR      all of the above plus phone, sale number, net, paid,
--                 outstanding and overdue.
--
-- The split is made HERE, not in the browser. A rep's response never contains a
-- price or a phone number, so there is nothing on the wire to un-hide — which is
-- the whole point, and is what scripts/verify-map-detail-roles.js measures.
--
-- Also new: `price`/`rate_pending` are withheld from a rep on a SOLD unit only.
-- An available or reserved unit still carries its price for everyone — a rep has
-- to quote, hold and plan against it.
--
-- Signature, name and every existing key are unchanged, so the live unit map
-- keeps working; the rep's sold sheet simply gains a Client row and loses a Rate
-- row it should never have had.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_map_unit_detail(p_session_token text, p_unit_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_role text; v_priv boolean; v_cos uuid[];
        v_u public.units; v_state text; v_out jsonb; v_sale record; v_res record;
        v_client text;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  v_cos := public._map_scope_companies(p_session_token);

  SELECT * INTO v_u FROM public.units WHERE id = p_unit_id AND company_id = ANY(v_cos);
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;

  SELECT role INTO v_role FROM public.sales_users WHERE id = v_ses.sales_user_id;
  v_priv  := v_role IN ('director','admin','cfo');
  v_state := public._map_unit_state(p_unit_id);

  v_out := jsonb_build_object(
    'success', true, 'unit_id', v_u.id, 'unit_no', v_u.unit_no,
    'state', v_state, 'area', v_u.area, 'floor_label', v_u.floor_label,
    'type', (SELECT t.type_name FROM public.category_unit_types t WHERE t.id = v_u.unit_type_id),
    'can_reserve', (v_state = 'available' AND COALESCE(v_u.base_price,0) > 0),
    'privileged', v_priv);

  -- Money leaves the server only when the caller may see it. Everyone may price a
  -- unit that is still for sale; only a director may price one that is sold.
  IF v_priv OR v_state <> 'sold' THEN
    v_out := v_out || jsonb_build_object(
      'price', v_u.base_price, 'rate_pending', (COALESCE(v_u.base_price,0) = 0));
  END IF;

  IF NOT v_priv THEN
    v_out := v_out || jsonb_build_object('label',
      CASE v_state WHEN 'sold' THEN 'Sold' WHEN 'reserved' THEN 'Reserved' ELSE 'Available' END);

    -- the new middle tier: the buyer's NAME, and nothing else about them
    IF v_state = 'sold' THEN
      SELECT c.full_name INTO v_client
        FROM public.sales s LEFT JOIN public.clients c ON c.id = s.client_id
       WHERE s.unit_id = p_unit_id AND s.status = 'active' LIMIT 1;
      IF v_client IS NOT NULL THEN
        v_out := v_out || jsonb_build_object('sale', jsonb_build_object('client_name', v_client));
      END IF;
    END IF;

    RETURN v_out;
  END IF;

  IF v_state = 'sold' THEN
    SELECT s.id, s.sale_number, s.net_amount, s.sale_date, c.full_name AS client_name, c.phone_primary AS phone,
           COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.sale_id = s.id AND p.status <> 'cancelled'),0) AS paid
      INTO v_sale
      FROM public.sales s LEFT JOIN public.clients c ON c.id = s.client_id
     WHERE s.unit_id = p_unit_id AND s.status = 'active' LIMIT 1;
    IF v_sale.id IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('sale', jsonb_build_object(
        'sale_number', v_sale.sale_number, 'client_name', v_sale.client_name,
        'client_phone', v_sale.phone, 'sale_date', v_sale.sale_date,
        'net_amount', v_sale.net_amount, 'paid', v_sale.paid,
        'outstanding', COALESCE(v_sale.net_amount,0) - v_sale.paid,
        'overdue', COALESCE((SELECT sum(i.amount_due - COALESCE(i.amount_paid,0))
                               FROM public.installments i
                              WHERE i.sale_id = v_sale.id AND i.due_date < current_date
                                AND COALESCE(i.amount_paid,0) < i.amount_due),0)));
    END IF;
  ELSIF v_state = 'reserved' THEN
    SELECT r.client_name, r.client_phone, r.expiry_date, r.token_amount, su.full_name AS by_name
      INTO v_res
      FROM public.reservations r LEFT JOIN public.sales_users su ON su.id = r.reserved_by
     WHERE r.unit_id = p_unit_id AND r.status = 'active' ORDER BY r.created_at DESC LIMIT 1;
    IF v_res.expiry_date IS NOT NULL OR v_res.client_name IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('reservation', jsonb_build_object(
        'client_name', v_res.client_name, 'client_phone', v_res.client_phone,
        'expires_at', v_res.expiry_date, 'token_amount', v_res.token_amount,
        'reserved_by', v_res.by_name));
    END IF;
  END IF;

  RETURN v_out;
END $function$;
