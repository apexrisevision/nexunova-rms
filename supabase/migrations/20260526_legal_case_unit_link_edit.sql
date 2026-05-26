-- Module 2: Legal cases — allow unit_id to be updated via upsert_legal_case
-- Previously unit_id was only set on INSERT; the UPDATE block did not touch it.
-- This migration adds unit_id handling to the UPDATE path (already applied to DB).

CREATE OR REPLACE FUNCTION public.upsert_legal_case(
  p_company_id uuid,
  p_data       jsonb,
  p_id         uuid DEFAULT NULL::uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO public.legal_cases (
      company_id, client_id, sale_id, unit_id, case_number, stage, case_type,
      lawyer_name, lawyer_contact, filed_date, next_hearing_date,
      outcome, claim_amount, settled_amount, notes, created_by
    ) VALUES (
      p_company_id,
      (p_data->>'client_id')::uuid,
      NULLIF(p_data->>'sale_id','')::uuid,
      NULLIF(p_data->>'unit_id','')::uuid,
      NULLIF(p_data->>'case_number',''),
      COALESCE(p_data->>'stage','pre_legal'),
      COALESCE(NULLIF(p_data->>'case_type',''),'court'),
      NULLIF(p_data->>'lawyer_name',''),
      NULLIF(p_data->>'lawyer_contact',''),
      NULLIF(p_data->>'filed_date','')::date,
      NULLIF(p_data->>'next_hearing_date','')::date,
      NULLIF(p_data->>'outcome',''),
      COALESCE((p_data->>'claim_amount')::numeric, 0),
      COALESCE((p_data->>'settled_amount')::numeric, 0),
      NULLIF(p_data->>'notes',''),
      NULLIF(p_data->>'created_by','')::uuid
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.legal_cases SET
      unit_id           = CASE WHEN p_data ? 'unit_id'
                               THEN NULLIF(p_data->>'unit_id','')::uuid
                               ELSE unit_id END,
      case_number       = COALESCE(NULLIF(p_data->>'case_number',''),       case_number),
      stage             = COALESCE(p_data->>'stage',                         stage),
      case_type         = COALESCE(NULLIF(p_data->>'case_type',''),          case_type),
      lawyer_name       = COALESCE(NULLIF(p_data->>'lawyer_name',''),        lawyer_name),
      lawyer_contact    = COALESCE(NULLIF(p_data->>'lawyer_contact',''),     lawyer_contact),
      filed_date        = COALESCE(NULLIF(p_data->>'filed_date','')::date,   filed_date),
      next_hearing_date = COALESCE(NULLIF(p_data->>'next_hearing_date','')::date, next_hearing_date),
      outcome           = COALESCE(NULLIF(p_data->>'outcome',''),            outcome),
      claim_amount      = COALESCE((p_data->>'claim_amount')::numeric,       claim_amount),
      settled_amount    = COALESCE((p_data->>'settled_amount')::numeric,     settled_amount),
      notes             = COALESCE(NULLIF(p_data->>'notes',''),              notes),
      updated_at        = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.upsert_legal_case(uuid, jsonb, uuid) TO authenticated, anon;
