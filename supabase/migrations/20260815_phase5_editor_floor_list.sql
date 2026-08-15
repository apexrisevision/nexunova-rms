-- Phase 5 — the editor needs to know which floors it can draw before it can open one.
-- Admin-only, same guard as the rest of the editor surface.

CREATE OR REPLACE FUNCTION public.get_map_editor_floors()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me public.app_users := public._rms_caller(); v_rows jsonb;
BEGIN
  IF v_me.id IS NULL OR NOT public._rms_is_admin(v_me) THEN
    RETURN jsonb_build_object('success',false,'error','forbidden'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'floor_label', p.floor_label, 'status', p.status,
      'project_name', pr.project_name, 'unit_prefix', p.unit_prefix,
      'artwork_key', a.artwork_key,
      'units',  (SELECT count(*) FROM public.units u
                  WHERE u.project_id = p.project_id AND u.floor_label = p.floor_label
                    AND public._map_unit_state(u.id) <> 'retired'),
      'drawn',  (SELECT count(*) FROM public.unit_map_shapes s WHERE s.artwork_id = p.artwork_id)
    ) ORDER BY pr.project_name, p.sort_order), '[]'::jsonb) INTO v_rows
  FROM public.unit_map_plans p
  JOIN public.projects pr ON pr.id = p.project_id
  LEFT JOIN public.unit_map_artworks a ON a.id = p.artwork_id
  WHERE p.company_id = v_me.company_id;

  RETURN jsonb_build_object('success',true,'floors',v_rows);
END $$;
