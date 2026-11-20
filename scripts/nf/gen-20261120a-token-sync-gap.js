#!/usr/bin/env node
/* Writes supabase/migrations/20261120a_nf_token_sync_gap.sql — a token line for a unit with no active RMS hold
   (brief of 20-Nov; owner's choices: only the owner's login creates a hold, and it is made even when no WhatsApp
   number is on record). nf_day_json is patched from the LIVE definition with an asserted insertion; the rest is
   written whole. Usage: node <this> */
const fs = require('fs'), path = require('path');
const { q } = require('../_sbq');
(async () => {
  let d = (await q(`select pg_get_functiondef('public.nf_day_json'::regproc) d`))[0].d;
  const once = (find, repl, what) => { const p = d.split(find); if (p.length !== 2) throw new Error(what + ': ' + (p.length - 1)); d = p.join(repl); };
  once("  RETURN public._nf_site_view_day(v_out, d.company_id, p_day_id);",
       "  -- what the token sync just did for the line being saved, so the screen can say \"NOT in RMS\" (20261120a)\n" +
       "  v_out := v_out || COALESCE((SELECT jsonb_build_object('token_sync', s.x::jsonb)\n" +
       "                                FROM (SELECT NULLIF(current_setting('nf.token_sync_last', true), '') AS x) s WHERE s.x IS NOT NULL), '{}'::jsonb);\n" +
       "  RETURN public._nf_site_view_day(v_out, d.company_id, p_day_id);", 'day_json return');
  const sql = `-- ══ NexuFinance → RMS token sync: units with no active hold (20261120a) ══
-- NOT APPLIED until the owner says yes.
--
-- Brief of 20-Nov: a token line (head 21100) for a unit with no active RMS hold was saved in NexuFinance and never
-- reached RMS (GF-250/251 Ali Haider 33,52,500; GF-256 Uzair Ahmad 50,000, voucher 213; #205 no unit).
-- Owner's choices (20-Nov): a hold is created automatically ONLY on the owner's own login (his rule since
-- 2026-09-28: only he reserves; Iqra has no NexuFinance login); it is created even with no WhatsApp number on record.
--
-- _nf_rms_token_unit — one unit's share of a token line:
--   active hold                      → token added / taken off, as before
--   no hold, unit Available          → owner's login: V.Hold for 30 days (rms_hold_units), client = the voucher's
--                                      party, holder = the login, note = the NF voucher; then the token
--   no hold, orphan status (V.Hold / Reserved / Booked / Sold - Entry Pending with no reservation record and no
--   sale)                            → owner's login: the missing reservation record, the unit's status kept; then
--                                      the token
--   anyone else's login              → not changed in RMS: "no hold in RMS — Head Office to hold it (Retry)"
--   sold with a sale file / Pagri / any other status → not changed in RMS, the reason given
-- _nf_rms_token_sync takes the client name from the voucher's party (it read it from the narration, which for
-- "RECEIVED FROM ALI HAIDER IN GF-250/251" would have been the whole narration), and leaves what it did in
-- nf.token_sync_last so nf_day_json can hand it to the screen ("Saved in NexuFinance, NOT in RMS — …").
-- nf_token_sync_list now lists what is still NOT in RMS (each voucher's latest sync, voucher still on the books),
-- not every attempt ever made; nf_token_sync_retry (Head Office) tries a voucher's missing units again.
-- Backfill (as the owner): retry vouchers 210, 211, 212 (GF-250/251, Ali Haider, 16,76,250 each) and 213 (GF-256,
-- Uzair Ahmad, 50,000). #205 (no unit) stays listed until a unit is given.

-- the logins that may create a hold from a token line: the owner only (Iqra, the other reservation authority,
-- has no NexuFinance login)
CREATE OR REPLACE FUNCTION public._nf_may_hold(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() = ANY (ARRAY[
           '315f2852-852f-4653-9253-a5a27a7828c8'::uuid   -- Rashid (owner, Awami director)
         ])
     AND public.nf_role(p_company_id) = 'director';
$function$;

CREATE OR REPLACE FUNCTION public._nf_rms_token_unit(p_company_id uuid, p_unit text, p_share numeric, p_dir numeric,
  p_party text, p_no text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res public.reservations; v_unit public.units; v_st public.category_unit_statuses; v_new numeric; v_made text;
  v_actor text := COALESCE(public.nf_actor_name(p_company_id), 'NexuFinance');
BEGIN
  SELECT r.* INTO v_res FROM public.reservations r JOIN public.units un ON un.id = r.unit_id JOIN public.projects pj ON pj.id = un.project_id
   WHERE pj.company_id = p_company_id AND upper(un.unit_code) = p_unit AND r.status = 'active' ORDER BY r.created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    IF p_dir <= 0 THEN
      RETURN jsonb_build_object('unit', p_unit, 'share', p_share * p_dir, 'result', 'no active hold in RMS — not synced');
    END IF;
    SELECT un.* INTO v_unit FROM public.units un JOIN public.projects pj ON pj.id = un.project_id
     WHERE pj.company_id = p_company_id AND upper(un.unit_code) = p_unit FOR UPDATE OF un;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('unit', p_unit, 'share', p_share, 'result', 'unit not in RMS — not synced');
    END IF;
    SELECT * INTO v_st FROM public.category_unit_statuses WHERE id = v_unit.status_id;
    IF EXISTS (SELECT 1 FROM public.sales s WHERE s.unit_id = v_unit.id AND lower(COALESCE(s.status, '')) <> 'cancelled') THEN
      RETURN jsonb_build_object('unit', p_unit, 'share', p_share, 'result', 'sold — a sale file is in RMS; not synced');
    END IF;
    IF v_st.status_code = 'PAGRI' THEN
      RETURN jsonb_build_object('unit', p_unit, 'share', p_share, 'result', 'Pagri — not synced');
    END IF;
    IF NOT (COALESCE(v_st.is_available, false) OR v_st.status_code IN ('HOLD', 'RESERVED', 'BOOKED', 'SOLD_ENTRY_PENDING')) THEN
      RETURN jsonb_build_object('unit', p_unit, 'share', p_share, 'result', COALESCE(v_st.status_name, 'no status') || ' in RMS — not synced');
    END IF;
    IF NOT public._nf_may_hold(p_company_id) THEN
      RETURN jsonb_build_object('unit', p_unit, 'share', p_share, 'result', 'no hold in RMS — Head Office to hold it (Retry)');
    END IF;
    IF COALESCE(v_st.is_available, false) THEN
      PERFORM public.rms_hold_units(p_company_id, ARRAY[p_unit], 'V.Hold', 30, v_actor, NULL, p_party, format('NexuFinance %s', p_no));
      v_made := 'V.Hold, 30 days';
    ELSE
      -- an orphan: the unit is marked held / sold-pending but has no reservation record; give it one, status kept
      INSERT INTO public.reservations
        (company_id, project_id, unit_id, reserved_by, requested_by_name, client_name, expiry_date,
         token_received, token_amount, note, status, unit_status_id)
      VALUES (v_unit.company_id, v_unit.project_id, v_unit.id, '015effd0-7ac7-4939-a1b3-dd2826ab8fba', v_actor,
              NULLIF(btrim(COALESCE(p_party, '')), ''),
              CASE WHEN v_st.nature = 'permanent' THEN NULL ELSE now() + interval '30 days' END,
              false, 0, format('NexuFinance %s: hold record for a unit already marked %s', p_no, v_st.status_name),
              'active', v_st.id);
      v_made := v_st.status_name || ' — hold record added';
    END IF;
    SELECT r.* INTO v_res FROM public.reservations r WHERE r.unit_id = v_unit.id AND r.status = 'active' ORDER BY r.created_at DESC LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('unit', p_unit, 'share', p_share, 'result', 'hold could not be made — not synced');
    END IF;
  END IF;
  v_new := greatest(0, COALESCE(v_res.token_amount, 0) + p_share * p_dir);
  PERFORM public.rms_set_reservation_token(p_company_id, p_unit, v_new, CASE WHEN p_dir > 0 THEN p_party END,
    format('NexuFinance %s: token %s%s', p_no, CASE WHEN p_dir > 0 THEN '+' ELSE '−' END, public.nf_fmt(p_share)));
  RETURN jsonb_build_object('unit', p_unit, 'share', p_share * p_dir, 'from', v_res.token_amount, 'to', v_new, 'result', 'synced')
         || CASE WHEN v_made IS NOT NULL THEN jsonb_build_object('hold', v_made) ELSE '{}'::jsonb END;
END $function$;

CREATE OR REPLACE FUNCTION public._nf_rms_token_sync(p_company_id uuid, p_voucher_id uuid, p_description text, p_side text, p_amount numeric, p_sign integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_units text[] := public._nf_units_in(p_description);
  v_n int := cardinality(public._nf_units_in(p_description));
  v_share numeric; v_left numeric; u text; i int := 0; v_out jsonb := '[]';
  -- the client: the voucher's party; else what follows "Token #n —" in the narration
  v_party text := COALESCE(
    (SELECT p.name FROM public.nf_voucher_legs l JOIN public.nf_parties p ON p.id = l.party_id
      WHERE l.voucher_id = p_voucher_id AND l.account_code = '21100' ORDER BY l.line_no LIMIT 1),
    CASE WHEN p_description ~* '(Token|Receipt)\\s*#?\\s*[0-9]+\\s*(returned)?\\s*[—-]' THEN
      NULLIF(btrim(split_part(regexp_replace(p_description, '^.*?(?:Token|Receipt)\\s*#?\\s*[0-9]+\\s*(?:returned)?\\s*[—-]\\s*', '', 'i'), ',', 1)), '') END);
  v_dir numeric := CASE WHEN p_side = 'IN' THEN 1 ELSE -1 END * p_sign;
  v_no text := (SELECT COALESCE(manual_no, voucher_no) FROM public.nf_vouchers WHERE id = p_voucher_id);
BEGIN
  IF v_n = 0 THEN
    v_out := jsonb_build_array(jsonb_build_object('unit', NULL, 'result', 'no unit named — not synced'));
  ELSE
    v_left := p_amount;
    FOREACH u IN ARRAY v_units LOOP
      i := i + 1;
      v_share := CASE WHEN i = v_n THEN v_left ELSE round(p_amount / v_n, 2) END;
      v_left := v_left - v_share;
      BEGIN
        v_out := v_out || public._nf_rms_token_unit(p_company_id, u, v_share, v_dir, v_party, v_no);
      EXCEPTION WHEN OTHERS THEN
        v_out := v_out || jsonb_build_object('unit', u, 'share', v_share * v_dir, 'result', SQLERRM);
      END;
    END LOOP;
  END IF;
  INSERT INTO public.nf_audit (company_id, day_id, entity, entity_id, action, actor, actor_name, before, after, reason)
  VALUES (p_company_id, (SELECT day_id FROM public.nf_vouchers WHERE id = p_voucher_id), 'rms_token', p_voucher_id::text,
          'UPDATE', auth.uid(), public.nf_actor_name(p_company_id), NULL,
          jsonb_build_object('voucher', v_no, 'side', p_side, 'amount', p_amount, 'sign', p_sign, 'party', v_party, 'units', v_out),
          left(p_description, 200));
  IF p_sign = 1 THEN   -- for the screen: what this save did in RMS (nf_day_json → token_sync)
    PERFORM set_config('nf.token_sync_last', jsonb_build_object('voucher', v_no, 'units', v_out)::text, true);
  END IF;
  RETURN v_out;
END $function$;

-- what is still NOT in RMS: each token voucher's latest sync, the voucher still on the books, its units that did
-- not sync (Head Office only)
CREATE OR REPLACE FUNCTION public.nf_token_sync_list(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(p_company_id);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('voucher_id', v.id, 'voucher', l.after->>'voucher', 'date', COALESCE(v.real_date, v.voucher_date),
             'by', (SELECT m.display_name FROM public.nf_members m WHERE m.company_id = v.company_id AND m.user_id = v.created_by),
             'party', l.after->>'party', 'amount', l.after->'amount', 'description', v.narration, 'at', l.at,
             'units', (SELECT jsonb_agg(x) FROM jsonb_array_elements(l.after->'units') x WHERE x->>'result' <> 'synced'))
           ORDER BY COALESCE(v.real_date, v.voucher_date) DESC, l.at DESC)
      FROM (SELECT DISTINCT ON (a.entity_id) a.* FROM public.nf_audit a
             WHERE a.company_id = p_company_id AND a.entity = 'rms_token'
             ORDER BY a.entity_id, a.at DESC) l
      JOIN public.nf_vouchers v ON v.id::text = l.entity_id AND v.status = 'POSTED'
     WHERE COALESCE((l.after->>'sign')::int, 1) = 1
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(l.after->'units') x WHERE x->>'result' <> 'synced')), '[]');
END $function$;

-- Retry (Head Office): the voucher's units that did not sync, tried again with the same shares; a hold is made
-- only on the owner's login (_nf_may_hold)
CREATE OR REPLACE FUNCTION public.nf_token_sync_retry(p_company_id uuid, p_voucher_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v public.nf_vouchers; l public.nf_audit; x jsonb; v_out jsonb := '[]'; v_party text; v_no text;
BEGIN
  PERFORM public.nf_require_role(p_company_id, ARRAY['accountant','director']);
  PERFORM public.nf_assert_head_office(p_company_id);
  SELECT * INTO v FROM public.nf_vouchers WHERE id = p_voucher_id AND company_id = p_company_id AND status = 'POSTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'NF:VOUCHER_NOT_FOUND'; END IF;
  SELECT * INTO l FROM public.nf_audit a WHERE a.company_id = p_company_id AND a.entity = 'rms_token' AND a.entity_id = p_voucher_id::text
   ORDER BY a.at DESC LIMIT 1;
  IF NOT FOUND OR COALESCE((l.after->>'sign')::int, 1) <> 1 THEN RAISE EXCEPTION 'NF:NOTHING_TO_RETRY'; END IF;
  v_no := COALESCE(v.manual_no, v.voucher_no);
  v_party := COALESCE((SELECT p.name FROM public.nf_voucher_legs g JOIN public.nf_parties p ON p.id = g.party_id
                        WHERE g.voucher_id = v.id AND g.account_code = '21100' ORDER BY g.line_no LIMIT 1), l.after->>'party');
  FOR x IN SELECT * FROM jsonb_array_elements(l.after->'units') LOOP
    IF x->>'result' = 'synced' OR x->>'unit' IS NULL THEN v_out := v_out || x; CONTINUE; END IF;
    BEGIN
      v_out := v_out || public._nf_rms_token_unit(p_company_id, x->>'unit', abs((x->>'share')::numeric),
                 CASE WHEN l.after->>'side' = 'IN' THEN 1 ELSE -1 END, v_party, v_no);
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object('unit', x->>'unit', 'share', x->'share', 'result', SQLERRM);
    END;
  END LOOP;
  INSERT INTO public.nf_audit (company_id, day_id, entity, entity_id, action, actor, actor_name, before, after, reason)
  VALUES (p_company_id, v.day_id, 'rms_token', v.id::text, 'UPDATE', auth.uid(), public.nf_actor_name(p_company_id), l.after,
          (l.after - 'units') || jsonb_build_object('party', v_party, 'units', v_out, 'retry', true), left(v.narration, 200));
  RETURN public.nf_token_sync_list(p_company_id);
END $function$;

REVOKE ALL ON FUNCTION public._nf_may_hold(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._nf_rms_token_unit(uuid, text, numeric, numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nf_token_sync_retry(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf_token_sync_retry(uuid, uuid) TO authenticated;

${d.trim()};

-- backfill, as the owner: the token vouchers that never reached RMS
DO $b$
DECLARE co constant uuid := '96d210e7-e63b-4ef0-b1d0-74e622eac7ce'; v uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '315f2852-852f-4653-9253-a5a27a7828c8', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '315f2852-852f-4653-9253-a5a27a7828c8', true);
  FOR v IN SELECT (x->>'voucher_id')::uuid FROM jsonb_array_elements(public.nf_token_sync_list(co)) x
            WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(x->'units') u WHERE u->>'unit' IN ('GF-250', 'GF-251', 'GF-256'))
            ORDER BY x->>'date', x->>'voucher' LOOP
    PERFORM public.nf_token_sync_retry(co, v);
  END LOOP;
END $b$;
`;
  const f = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261120a_nf_token_sync_gap.sql');
  fs.writeFileSync(f, sql);
  console.log('written', f);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
