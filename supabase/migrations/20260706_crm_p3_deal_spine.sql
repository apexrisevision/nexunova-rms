-- CRM overhaul P3: Deal spine (deals + pipeline_stages) — additive, invisible, dual-write.
-- Lead -> Deal -> Pipeline. Deal = qualified opportunity (unit+value+stage), 1:1 with a
-- lead for v1. reservations/sale_submissions/sales stay the record layer. Nothing on the
-- live frontend changes; dual-write is maintained by loop-safe, live-write-safe triggers.
-- Applied via MCP 2026-07-06; verified on ZZTEST (backfill 23=23 exact, both directions, EXECUTE revoked).

-- 1) pipeline_stages catalog (global defaults; per-project config deferred to P4)
CREATE TABLE IF NOT EXISTS public.pipeline_stages(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,   -- NULL = global default
  key text NOT NULL,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_won boolean NOT NULL DEFAULT false,
  is_lost boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, key)
);
INSERT INTO public.pipeline_stages (company_id, key, label, sort_order, is_won, is_lost) VALUES
  (NULL,'new','New',1,false,false),
  (NULL,'contacted','Contacted',2,false,false),
  (NULL,'visit','Visit',3,false,false),
  (NULL,'negotiation','Negotiation',4,false,false),
  (NULL,'won','Won',5,true,false),
  (NULL,'lost','Lost',6,false,true)
ON CONFLICT (company_id, key) DO NOTHING;

-- 2) deals (opportunity) — 1:1 with lead for v1 (schema is deal-per-lead-capable; multi-deal UX deferred)
CREATE TABLE IF NOT EXISTS public.deals(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  lead_id uuid NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  owner_sales_user_id uuid REFERENCES public.sales_users(id) ON DELETE SET NULL,
  title text,
  unit_id uuid,
  unit_type_id uuid,
  value numeric,
  stage text NOT NULL DEFAULT 'new',
  reservation_id uuid,
  sale_id uuid,
  lost_reason text,
  is_test boolean NOT NULL DEFAULT false,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deals_company ON public.deals(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_owner   ON public.deals(owner_sales_user_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage   ON public.deals(stage);

-- 3) additive deal_id links (nullable, forward-looking; P5 write path will populate on new rows)
ALTER TABLE public.reservations     ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL;
ALTER TABLE public.sale_submissions ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL;
ALTER TABLE public.lead_activities  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL;

-- 4) BACKFILL: exactly one deal per existing lead (triggers not yet created -> no double-write)
INSERT INTO public.deals (company_id, project_id, lead_id, owner_sales_user_id, title, unit_id, unit_type_id,
                          value, stage, reservation_id, sale_id, lost_reason, is_test, last_activity_at, created_at, updated_at)
SELECT l.company_id, l.project_id, l.id, l.owner_sales_user_id, l.name, l.unit_id, l.unit_type_id,
       l.budget, COALESCE(l.status,'new'), l.converted_reservation_id, l.converted_sale_id, l.lost_reason,
       COALESCE(l.is_test,false), COALESCE(l.last_activity_at,l.created_at,now()), COALESCE(l.created_at,now()), now()
FROM public.leads l
ON CONFLICT (lead_id) DO NOTHING;

UPDATE public.lead_activities la SET deal_id=d.id FROM public.deals d WHERE d.lead_id=la.lead_id AND la.deal_id IS NULL;
UPDATE public.reservations r     SET deal_id=d.id FROM public.deals d WHERE d.reservation_id=r.id AND r.deal_id IS NULL;
UPDATE public.sale_submissions ss SET deal_id=r.deal_id FROM public.reservations r WHERE r.id=ss.reservation_id AND r.deal_id IS NOT NULL AND ss.deal_id IS NULL;

-- 5) RLS deny-all (access only via SECURITY DEFINER RPCs, built in P4). NOT forced -> definer/owner paths work.
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deals FROM anon, authenticated;
REVOKE ALL ON public.pipeline_stages FROM anon, authenticated;

-- 6) DUAL-WRITE triggers — bidirectional, loop-safe (value-equality guards), live-write-safe.
CREATE OR REPLACE FUNCTION public._deal_sync_from_lead() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.deals (company_id, project_id, lead_id, owner_sales_user_id, title, unit_id, unit_type_id,
       value, stage, reservation_id, sale_id, lost_reason, is_test, last_activity_at, created_at, updated_at)
    VALUES (NEW.company_id, NEW.project_id, NEW.id, NEW.owner_sales_user_id, NEW.name, NEW.unit_id, NEW.unit_type_id,
       NEW.budget, COALESCE(NEW.status,'new'), NEW.converted_reservation_id, NEW.converted_sale_id, NEW.lost_reason,
       COALESCE(NEW.is_test,false), COALESCE(NEW.last_activity_at,now()), COALESCE(NEW.created_at,now()), now())
    ON CONFLICT (lead_id) DO NOTHING;
  ELSE
    UPDATE public.deals SET
      company_id=NEW.company_id, project_id=NEW.project_id, owner_sales_user_id=NEW.owner_sales_user_id,
      title=NEW.name, unit_id=NEW.unit_id, unit_type_id=NEW.unit_type_id, value=NEW.budget,
      stage=COALESCE(NEW.status,'new'), reservation_id=NEW.converted_reservation_id, sale_id=NEW.converted_sale_id,
      lost_reason=NEW.lost_reason, is_test=COALESCE(NEW.is_test,false),
      last_activity_at=COALESCE(NEW.last_activity_at,now()), updated_at=now()
    WHERE lead_id=NEW.id;
    IF NOT FOUND THEN   -- self-heal: a lead without a mirror deal gets one
      INSERT INTO public.deals (company_id, project_id, lead_id, owner_sales_user_id, title, unit_id, unit_type_id,
         value, stage, reservation_id, sale_id, lost_reason, is_test, last_activity_at, created_at, updated_at)
      VALUES (NEW.company_id, NEW.project_id, NEW.id, NEW.owner_sales_user_id, NEW.name, NEW.unit_id, NEW.unit_type_id,
         NEW.budget, COALESCE(NEW.status,'new'), NEW.converted_reservation_id, NEW.converted_sale_id, NEW.lost_reason,
         COALESCE(NEW.is_test,false), COALESCE(NEW.last_activity_at,now()), COALESCE(NEW.created_at,now()), now())
      ON CONFLICT (lead_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'deal sync-from-lead failed (lead %): %', NEW.id, SQLERRM;
  RETURN NEW;   -- NEVER break a live lead write
END $fn$;

CREATE OR REPLACE FUNCTION public._lead_sync_from_deal() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    UPDATE public.leads SET status=NEW.stage, updated_at=now()
    WHERE id=NEW.lead_id AND status IS DISTINCT FROM NEW.stage;   -- guard breaks the sync loop
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'lead sync-from-deal failed (deal %): %', NEW.id, SQLERRM;
  RETURN NEW;
END $fn$;

-- trigger fns are invoked by the trigger mechanism as owner; no role needs direct EXECUTE
-- (closes the SECURITY DEFINER-via-PostgREST exposure the advisor flags).
REVOKE EXECUTE ON FUNCTION public._deal_sync_from_lead() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public._lead_sync_from_deal() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS trg_deal_sync_from_lead ON public.leads;
CREATE TRIGGER trg_deal_sync_from_lead AFTER INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public._deal_sync_from_lead();

DROP TRIGGER IF EXISTS trg_lead_sync_from_deal ON public.deals;
CREATE TRIGGER trg_lead_sync_from_deal AFTER UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public._lead_sync_from_deal();
