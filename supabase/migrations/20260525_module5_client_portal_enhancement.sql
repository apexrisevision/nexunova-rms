-- ================================================================
-- NEXUNOVA RMS — MODULE 5 — CLIENT PORTAL ENHANCEMENT
-- 2026-05-25 — Applied via MCP + verified.
-- New table : buyer_complaints (RLS-enabled, company_isolation policy)
-- New RPCs  : submit_buyer_complaint, get_buyer_complaints,
--             get_buyer_possession_for_portal, get_buyer_nocs_for_portal
-- All GRANT-ed to anon + authenticated (portal uses anon key, no JWT).
-- Security  : every RPC validates client_id + company_id together.
-- ================================================================

-- ── buyer_complaints table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.buyer_complaints (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL REFERENCES public.clients(id)  ON DELETE CASCADE,
  subject        text NOT NULL,
  message        text NOT NULL,
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','in_progress','resolved','closed')),
  response       text,
  responded_by   text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  responded_at   timestamptz
);

ALTER TABLE public.buyer_complaints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation" ON public.buyer_complaints
  FOR ALL USING (
    company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid())
  );

-- ── submit_buyer_complaint ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_buyer_complaint(
  p_client_id  uuid,
  p_company_id uuid,
  p_subject    text,
  p_message    text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('error', 'Invalid client');
  END IF;
  IF length(trim(p_subject)) < 3 THEN
    RETURN jsonb_build_object('error', 'Subject too short');
  END IF;
  IF length(trim(p_message)) < 10 THEN
    RETURN jsonb_build_object('error', 'Message too short');
  END IF;
  INSERT INTO buyer_complaints (company_id, client_id, subject, message)
  VALUES (p_company_id, p_client_id, trim(p_subject), trim(p_message))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'success', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_buyer_complaint(uuid,uuid,text,text) TO anon, authenticated;

-- ── get_buyer_complaints ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_buyer_complaints(
  p_client_id  uuid,
  p_company_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('error', 'Invalid client');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           c.id,
    'subject',      c.subject,
    'message',      c.message,
    'status',       c.status,
    'response',     c.response,
    'created_at',   c.created_at,
    'responded_at', c.responded_at
  ) ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_rows FROM buyer_complaints c
  WHERE c.client_id = p_client_id AND c.company_id = p_company_id;
  RETURN v_rows;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_buyer_complaints(uuid,uuid) TO anon, authenticated;

-- ── get_buyer_possession_for_portal ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_buyer_possession_for_portal(
  p_client_id  uuid,
  p_unit_id    uuid,
  p_company_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('error', 'Invalid client');
  END IF;
  SELECT jsonb_build_object(
    'id',              p.id,
    'possession_date', p.possession_date,
    'status',          p.status,
    'remarks',         p.remarks,
    'created_at',      p.created_at
  ) INTO v_result
  FROM possessions p
  WHERE p.unit_id = p_unit_id AND p.company_id = p_company_id
  ORDER BY p.created_at DESC LIMIT 1;
  RETURN COALESCE(v_result, '{}'::jsonb);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_buyer_possession_for_portal(uuid,uuid,uuid) TO anon, authenticated;

-- ── get_buyer_nocs_for_portal ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_buyer_nocs_for_portal(
  p_client_id  uuid,
  p_unit_id    uuid,
  p_company_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('error', 'Invalid client');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',          n.id,
    'noc_number',  n.noc_number,
    'noc_type',    n.noc_type,
    'status',      n.status,
    'valid_from',  n.valid_from,
    'valid_until', n.valid_until,
    'approved_at', n.approved_at,
    'created_at',  n.created_at
  ) ORDER BY n.created_at DESC), '[]'::jsonb)
  INTO v_rows FROM noc n
  WHERE n.unit_id = p_unit_id AND n.company_id = p_company_id
    AND n.status = 'approved';
  RETURN v_rows;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_buyer_nocs_for_portal(uuid,uuid,uuid) TO anon, authenticated;
