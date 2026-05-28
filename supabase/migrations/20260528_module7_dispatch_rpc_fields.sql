-- ================================================================
-- NEXUNOVA RMS — MODULE 7 DISPATCH — Phase G: RPC FIELD EXTENSIONS
-- 2026-05-28
-- Extend the foundation RPCs so the Comms Center can read/write the new
-- Meta template fields and see live delivery status. All additive
-- (CREATE OR REPLACE, same signatures) — no behaviour removed.
-- ================================================================

-- list_message_templates: surface Meta fields for the editor
CREATE OR REPLACE FUNCTION public.list_message_templates(p_company_id uuid, p_channel text DEFAULT NULL)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.channel, t.category, t.name), '[]'::jsonb)
  FROM (
    SELECT id, name, channel, category, subject, body, is_active, created_by, created_at, updated_at,
           meta_template_name, meta_language, variable_map
    FROM message_templates
    WHERE company_id = p_company_id AND (p_channel IS NULL OR channel = p_channel)
  ) t;
$$;
GRANT EXECUTE ON FUNCTION public.list_message_templates(uuid, text) TO anon, authenticated;

-- upsert_message_template: persist Meta fields (template name / language / variable map)
CREATE OR REPLACE FUNCTION public.upsert_message_template(p_company_id uuid, p_data jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_params');
  END IF;
  IF COALESCE(p_data->>'name','') = '' OR COALESCE(p_data->>'body','') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'name_and_body_required');
  END IF;
  v_id := NULLIF(p_data->>'id','')::uuid;
  IF v_id IS NOT NULL THEN
    UPDATE message_templates SET
      name = COALESCE(NULLIF(p_data->>'name',''), name),
      channel = COALESCE(NULLIF(p_data->>'channel',''), channel),
      category = COALESCE(NULLIF(p_data->>'category',''), category),
      subject = p_data->>'subject',
      body = COALESCE(NULLIF(p_data->>'body',''), body),
      is_active = COALESCE((p_data->>'is_active')::boolean, is_active),
      meta_template_name = p_data->>'meta_template_name',
      meta_language = COALESCE(NULLIF(p_data->>'meta_language',''), meta_language),
      variable_map = COALESCE(p_data->'variable_map', variable_map),
      updated_at = now()
    WHERE id = v_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'template_not_found'); END IF;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'updated', true);
  ELSE
    INSERT INTO message_templates (company_id, name, channel, category, subject, body, is_active, created_by,
                                   meta_template_name, meta_language, variable_map)
    VALUES (p_company_id, p_data->>'name', COALESCE(NULLIF(p_data->>'channel',''),'whatsapp'),
            COALESCE(NULLIF(p_data->>'category',''),'custom'), p_data->>'subject', p_data->>'body',
            COALESCE((p_data->>'is_active')::boolean, true), NULLIF(p_data->>'created_by',''),
            p_data->>'meta_template_name', COALESCE(NULLIF(p_data->>'meta_language',''),'en'),
            COALESCE(p_data->'variable_map','[]'::jsonb))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'updated', false);
  END IF;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_message_template(uuid, jsonb) TO anon, authenticated;

-- get_message_log: surface provider + delivery timestamps for the live status view
CREATE OR REPLACE FUNCTION public.get_message_log(p_company_id uuid, p_limit int DEFAULT 100)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT ml.id, ml.client_id, c.full_name AS client_name, ml.channel, ml.category,
           ml.to_address, ml.body_rendered, ml.status, ml.sent_by, ml.created_at,
           ml.provider, ml.provider_message_id, ml.scheduled_at,
           ml.sent_at, ml.delivered_at, ml.read_at, ml.error
    FROM message_log ml
    LEFT JOIN clients c ON c.id = ml.client_id
    WHERE ml.company_id = p_company_id
    ORDER BY ml.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 1000))
  ) r;
$$;
GRANT EXECUTE ON FUNCTION public.get_message_log(uuid, int) TO anon, authenticated;
