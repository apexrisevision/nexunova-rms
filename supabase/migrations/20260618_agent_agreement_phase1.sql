-- ════════════════════════════════════════════════════════════════════════════
-- SALE AGENT AGREEMENT — Phase 1: foundation (clause-versioned digital consent).
-- Owner ask: every sale agent (sub-dealer) signs a Job Description / Duties &
-- Responsibilities at signup (checkbox + typed-name signature → signed PDF saved to
-- their documents). When admin later adds/edits a clause, ONLY that clause is shown
-- at the agent's next login with "I Agree" / "Not agree — contact office"; declining
-- holds the account until they agree later OR an admin bypasses. Every acceptance is
-- logged for a full exportable record. All agent-facing copy is English.
--
-- Model: the agreement is a SET OF CLAUSES, each with a stable clause_key + version.
--   • add clause     → new clause_key, becomes pending for already-signed agents
--   • edit clause     → new version of same clause_key, re-sign just that clause
--   • pending(agent) = active clauses with no acceptance row at the current version
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.agent_agreement_clauses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  clause_key   uuid NOT NULL DEFAULT gen_random_uuid(),
  seq          int  NOT NULL DEFAULT 0,
  title        text NOT NULL,
  body         text NOT NULL,
  version      int  NOT NULL DEFAULT 1,
  is_active    boolean NOT NULL DEFAULT true,
  effective_from date,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aac_company_active ON public.agent_agreement_clauses(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_aac_key ON public.agent_agreement_clauses(clause_key, version);

CREATE TABLE IF NOT EXISTS public.agent_agreement_acceptances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  sales_user_id uuid NOT NULL,
  clause_id     uuid NOT NULL,
  clause_key    uuid NOT NULL,
  version       int  NOT NULL,
  accepted_at   timestamptz NOT NULL DEFAULT now(),
  method        text NOT NULL DEFAULT 'login',   -- signup | initial | amendment | admin_bypass
  signature_name text,
  ip            text,
  bypassed_by   uuid,
  reason        text
);
CREATE INDEX IF NOT EXISTS idx_aaa_user ON public.agent_agreement_acceptances(sales_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_aaa_user_clause_ver ON public.agent_agreement_acceptances(sales_user_id, clause_key, version);

ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS agreement_hold boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS agreement_hold_reason text;
ALTER TABLE public.sales_users ADD COLUMN IF NOT EXISTS agreement_hold_at timestamptz;

ALTER TABLE public.agent_agreement_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_agreement_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_agreement_clauses FROM anon, authenticated;
REVOKE ALL ON public.agent_agreement_acceptances FROM anon, authenticated;

-- Idempotent default content (English). Admin edits later (Phase 4).
CREATE OR REPLACE FUNCTION public.seed_default_agent_agreement(p_company_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n FROM public.agent_agreement_clauses WHERE company_id=p_company_id;
  IF v_n > 0 THEN RETURN 0; END IF;
  INSERT INTO public.agent_agreement_clauses (company_id, seq, title, body) VALUES
  (p_company_id, 1, 'Appointment & Scope',
   'You are engaged as an authorised Sale Agent to market and sell the company''s units and to support the recovery of amounts due from the clients you onboard. This agreement defines the duties, conduct and responsibilities expected of you. It does not create employment unless agreed separately in writing.'),
  (p_company_id, 2, 'Duties & Responsibilities',
   'You will: (a) introduce and register genuine buyers; (b) present prices, areas, plans and terms only as published by the company; (c) keep your client and unit information accurate and up to date in the system; and (d) actively follow up with your clients on their payment schedule.'),
  (p_company_id, 3, 'Sales Conduct & Representations',
   'You will not make any promise, commitment, discount, or assurance to a client that has not been approved by the company in writing. Any verbal or written representation outside published terms is unauthorised and is your sole responsibility.'),
  (p_company_id, 4, 'Payment & Cash Handling',
   'All client payments must be made through the company''s official channels (bank, cheque, or the official receipt process). You are not authorised to collect cash in your personal capacity, hold client funds, or issue any receipt other than the company''s official receipt.'),
  (p_company_id, 5, 'Recovery & Follow-up',
   'You remain responsible for following up with the clients you onboard until their dues are cleared. You will cooperate with the company''s recovery process, log your follow-ups, and escalate non-paying clients promptly.'),
  (p_company_id, 6, 'Confidentiality & Data Protection',
   'Client data, pricing, inventory and company records accessed through this portal are confidential. You will use them only for your authorised work and will not copy, share, or retain them after your engagement ends.'),
  (p_company_id, 7, 'Use of Company Name, Brand & Records',
   'You may represent the company only to the extent authorised. You will not use the company name, brand, or documents for any purpose other than approved sales activity, and you will keep your portal credentials private.'),
  (p_company_id, 8, 'Compliance, Anti-Fraud & Conflict of Interest',
   'You will act honestly and lawfully, will not misrepresent a client or a transaction, will not create fictitious bookings, and will disclose any conflict of interest. Fraud, forgery, or misuse of the system will result in immediate suspension and may be reported to the authorities.'),
  (p_company_id, 9, 'Suspension & Termination',
   'The company may suspend or terminate your access and engagement for breach of this agreement, misconduct, or non-compliance. On termination you will immediately stop representing the company and return or delete all company information.'),
  (p_company_id, 10, 'Acknowledgement',
   'By signing, you confirm that you have read and understood this agreement, that the information you provided is true, and that you agree to be bound by these duties and responsibilities and by any future amendments you accept.');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$function$;
REVOKE ALL ON FUNCTION public.seed_default_agent_agreement(uuid) FROM PUBLIC;

-- Portal read: what does this session's agent still need to sign?
CREATE OR REPLACE FUNCTION public.get_agreement_for_session(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_prior int; v_result jsonb;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT COUNT(*) INTO v_prior FROM public.agent_agreement_acceptances WHERE sales_user_id=v_su.id;
  SELECT jsonb_build_object(
    'success', true,
    'hold', COALESCE(v_su.agreement_hold,false),
    'hold_reason', v_su.agreement_hold_reason,
    'is_initial', (v_prior = 0),
    'agent_name', v_su.full_name,
    'pending', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('clause_id',c.id,'clause_key',c.clause_key,'version',c.version,
                'seq',c.seq,'title',c.title,'body',c.body) ORDER BY c.seq, c.title)
      FROM public.agent_agreement_clauses c
      WHERE c.company_id=v_ses.company_id AND c.is_active
        AND NOT EXISTS (SELECT 1 FROM public.agent_agreement_acceptances a
              WHERE a.sales_user_id=v_su.id AND a.clause_key=c.clause_key AND a.version=c.version)
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END
$function$;
REVOKE ALL ON FUNCTION public.get_agreement_for_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agreement_for_session(text) TO anon, authenticated;

-- Accept all currently-pending clauses (clears any hold).
CREATE OR REPLACE FUNCTION public.accept_agreement(p_session_token text, p_signature_name text DEFAULT NULL, p_ip text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions; v_su public.sales_users; v_prior int; v_method text; v_n int;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  SELECT * INTO v_su FROM public.sales_users WHERE id=v_ses.sales_user_id;
  SELECT COUNT(*) INTO v_prior FROM public.agent_agreement_acceptances WHERE sales_user_id=v_su.id;
  v_method := CASE WHEN v_prior=0 THEN 'initial' ELSE 'amendment' END;
  INSERT INTO public.agent_agreement_acceptances (company_id, sales_user_id, clause_id, clause_key, version, method, signature_name, ip)
  SELECT v_ses.company_id, v_su.id, c.id, c.clause_key, c.version, v_method, NULLIF(p_signature_name,''), p_ip
  FROM public.agent_agreement_clauses c
  WHERE c.company_id=v_ses.company_id AND c.is_active
    AND NOT EXISTS (SELECT 1 FROM public.agent_agreement_acceptances a
          WHERE a.sales_user_id=v_su.id AND a.clause_key=c.clause_key AND a.version=c.version)
  ON CONFLICT (sales_user_id, clause_key, version) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.sales_users SET agreement_hold=false, agreement_hold_reason=NULL, agreement_hold_at=NULL WHERE id=v_su.id;
  RETURN jsonb_build_object('success',true,'accepted',v_n);
END
$function$;
REVOKE ALL ON FUNCTION public.accept_agreement(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_agreement(text,text,text) TO anon, authenticated;

-- Decline → hold the account until released.
CREATE OR REPLACE FUNCTION public.decline_agreement(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ses public.sales_sessions;
BEGIN
  SELECT * INTO v_ses FROM public.sales_sessions WHERE session_token=p_session_token AND expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','session_expired'); END IF;
  UPDATE public.sales_users
     SET agreement_hold=true, agreement_hold_reason='Declined updated terms', agreement_hold_at=now()
   WHERE id=v_ses.sales_user_id;
  RETURN jsonb_build_object('success',true,'hold',true);
END
$function$;
REVOKE ALL ON FUNCTION public.decline_agreement(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decline_agreement(text) TO anon, authenticated;

-- Seed defaults for the active tenant.
SELECT public.seed_default_agent_agreement('3249e3b5-c411-4f5f-ae48-0246304c9c87');
