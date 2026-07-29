-- FMH backfill: 21 sales / 803 installments
-- Generated 2026-07-29T16:55:48.831Z by migration_work/fmh_backfill_gen.js
-- MF-57 deliberately EXCLUDED (already live as SAL-2026-0009).
-- NO receipts/payments are created. Schedule rows are DUE dates only.

BEGIN;

-- Guard: refuse to run against the wrong tenant ------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND company_code='fmh') THEN
    RAISE EXCEPTION 'guard: company 71d33e07-e55c-49af-8f5b-fdd7fd6e8612 is not FMH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612') THEN
    RAISE EXCEPTION 'guard: project ce05f4bb-a527-4e2b-b529-970c76c8d855 does not belong to FMH';
  END IF;
END $$;

-- Rollback aid: snapshot the unit statuses we are about to flip -------------
CREATE TABLE IF NOT EXISTS fmh_backfill_unit_status_backup_20260729 AS
SELECT id, unit_no, status_id FROM units
WHERE project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND unit_no IN ('MF-30','MF-61','MF-62','6-01','2-14','MF-18','5-02','5-03','5-05','5-06','5-14','8-09','8-15','10-18','11-15','GF-43','LG-21','LG-24','LG-37B','MF-19','12-09');

-- 0. MF-57 (SAL-2026-0009) schedule rebuilt from the booking record --------
CREATE TABLE IF NOT EXISTS fmh_mf57_installments_backup_20260729 AS
SELECT i.* FROM installments i JOIN sales s ON s.id=i.sale_id
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='SAL-2026-0009';

DO $mf57$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM payments p JOIN sales s ON s.id=p.sale_id
   WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='SAL-2026-0009';
  IF v <> 0 THEN RAISE EXCEPTION 'MF-57 guard: % payment(s) exist, refusing to rebuild schedule', v; END IF;

  SELECT count(*) INTO v FROM installments i JOIN sales s ON s.id=i.sale_id
   WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='SAL-2026-0009'
     AND (i.amount_paid <> 0 OR i.related_payment_id IS NOT NULL);
  IF v <> 0 THEN RAISE EXCEPTION 'MF-57 guard: % installment(s) carry money', v; END IF;

  SELECT count(*) INTO v FROM payment_promises pp
   JOIN installments i ON i.id=pp.installment_id JOIN sales s ON s.id=i.sale_id
   WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='SAL-2026-0009';
  IF v <> 0 THEN RAISE EXCEPTION 'MF-57 guard: % payment promise(s) linked', v; END IF;
END $mf57$;

DELETE FROM installments i USING sales s
WHERE i.sale_id = s.id AND s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='SAL-2026-0009';

INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, v.typ, 'pending', v.lbl
FROM sales s,
     (VALUES (0,DATE '2026-07-06',3083160.00,'1st Booking','down_payment'),
         (1,DATE '2026-08-06',150000.00,'2nd Booking','installment'),
         (2,DATE '2026-09-06',150000.00,'3rd Booking','installment'),
         (3,DATE '2026-10-06',150000.00,'Installment No.1','installment'),
         (4,DATE '2026-11-06',150000.00,'Installment No.2','installment'),
         (5,DATE '2026-12-06',150000.00,'Installment No.3','installment'),
         (6,DATE '2027-01-06',150000.00,'Installment No.4','installment'),
         (7,DATE '2027-02-06',150000.00,'Installment No.5','installment'),
         (8,DATE '2027-03-06',150000.00,'Installment No.6','installment'),
         (9,DATE '2027-04-06',150000.00,'Installment No.7','installment'),
         (10,DATE '2027-05-06',150000.00,'Installment No.8','installment'),
         (11,DATE '2027-06-06',150000.00,'Installment No.9','installment'),
         (12,DATE '2027-07-06',150000.00,'Installment No.10','installment'),
         (13,DATE '2027-08-06',150000.00,'Installment No.11','installment'),
         (14,DATE '2027-09-06',400000.00,'Annual No.1 Inst No.12','installment'),
         (15,DATE '2027-10-06',150000.00,'Installment No.13','installment'),
         (16,DATE '2027-11-06',150000.00,'Installment No.14','installment'),
         (17,DATE '2027-12-06',150000.00,'Installment No.15','installment'),
         (18,DATE '2028-01-06',150000.00,'Installment No.16','installment'),
         (19,DATE '2028-02-06',150000.00,'Installment No.17','installment'),
         (20,DATE '2028-03-06',150000.00,'Installment No.18','installment'),
         (21,DATE '2028-04-06',150000.00,'Installment No.19','installment'),
         (22,DATE '2028-05-06',150000.00,'Installment No.20','installment'),
         (23,DATE '2028-06-06',150000.00,'Installment No.21','installment'),
         (24,DATE '2028-07-06',150000.00,'Installment No.22','installment'),
         (25,DATE '2028-08-06',150000.00,'Installment No.23','installment'),
         (26,DATE '2028-09-06',400000.00,'Annual No.2 Inst No.24','installment'),
         (27,DATE '2028-10-06',150000.00,'Installment No.25','installment'),
         (28,DATE '2028-11-06',150000.00,'Installment No.26','installment'),
         (29,DATE '2028-12-06',150000.00,'Installment No.27','installment'),
         (30,DATE '2029-01-06',150000.00,'Installment No.28','installment'),
         (31,DATE '2029-02-06',150000.00,'Installment No.29','installment'),
         (32,DATE '2029-03-06',150000.00,'Installment No.30','installment'),
         (33,DATE '2029-04-06',150000.00,'Installment No.31','installment'),
         (34,DATE '2029-05-06',150000.00,'Installment No.32','installment'),
         (35,DATE '2029-06-06',150000.00,'Installment No.33','installment'),
         (36,DATE '2029-07-06',150000.00,'Installment No.34','installment'),
         (37,DATE '2029-08-06',150000.00,'Installment No.35','installment'),
         (38,DATE '2029-09-06',400000.00,'Annual No.3 Inst No.36','installment'),
         (39,DATE '2029-10-06',150000.00,'Installment No.37','installment'),
         (40,DATE '2029-11-06',594040.00,'Final Payment','installment')) AS v(n,d,a,lbl,typ)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='SAL-2026-0009';

UPDATE sales SET installment_count=40
WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND sale_number='SAL-2026-0009';

-- 1. CLIENTS (idempotent on the (company,project,cnic) unique) -------------
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Kashif Rashid', 'S/O Zafar Ali Khan', '13101-9679725-1', '0315-9333433', '0315-9333433', 'Qamra Qilla, Bannu',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='13101-9679725-1');
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Sabikha Begum', 'W/O Muhammad Ilyas Khan', '17101-3527646-0', '0313-9828998', '0313-9828998', 'Mohallah Sultan Khan, Tarnab, Tehsil and District Charsadda',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='17101-3527646-0');
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Waqar Ahmad', 'S/O Awal Khan', '17101-3648938-3', '0333-1210513', '0333-1210513', 'DHA, House No#1127, Sector B, Peshawar',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='17101-3648938-3');
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Asfandyar Rahim Subhan', 'S/O Fazal Subhan', '17301-9671690-9', '0334-5959803', '0334-5959803', 'H#11, Paragon City Barki Road, Lahore Cantt, Distt Lahore',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='17301-9671690-9');
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Hamim Jan', 'S/O Abdullah Jan', '21302-3915564-1', '0301-8018871', '0301-8018871', 'Kochi Qom Mangal, Post Office Sada, Kochi Kala, Tehsil Lower Khuram, Zilla Kuram Agency',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='21302-3915564-1');
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Zemaryal', 'S/O Jan Agha', 'GP 10935978591', '0317-7777015', '0317-7777015', 'H-11, ST-1, Alzar Town Taj Abad, Peshawar',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='GP 10935978591');
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Taimur Ahmad', 'S/O Rasheed Ahmad', '17101-8984766-5', '0333-9595875', '0333-9595875', 'Per Qala, P.O Shabqadar, District Charsadda',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='17101-8984766-5');
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Shahid Ali', 'S/O Gul Muhammad', '17301-5092061-9', '0300-5820400', '0300-5820400', 'Mohallah Afridi Qilla, P.O Pajjagi, Mandar Khel, Tehsil & Distt Peshawar',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='17301-5092061-9');
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Wajid Ullah Khan', 'S/O Ajmal Khan Wazir', '17301-1227024-3', '0336-9869251', '0336-9869251', 'Hayattabad Phase 1, House No#120, Street No# E/2, Peshawar',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='17301-1227024-3');
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Yasir Younas Khan', 'S/O Muhammad Younas Khan', '17301-9442445-9', '0300-5940051', '0300-5940051', 'Haji Lala Jan Kaley, Post Office Hathiyan, Takhtbhai Distt Mardan',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='17301-9442445-9');
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Rehana Majid', 'W/O Abdul Majid', '13504-7772000-2', '0335-9112345', '0335-9112345', 'House No. CB.335 Narrian, Narrian Link Road, Abbottabad',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='13504-7772000-2');
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Fozia Bibi', 'W/O Muhammad Tariq', '17202-0602884-6', '0311-9520180', '0311-9520180', 'Pathak Khudgarzi, P.O Box Pabi R S, District Nowshera',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='17202-0602884-6');
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Ahmad', 'S/O Aminullah Khan', '21301-7068071-1', '0332-9817276', '0332-9817276', 'Muaither North, Doha, Qatar',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='21301-7068071-1');
INSERT INTO clients (company_id, project_id, client_code, full_name, father_name, cnic,
       phone_primary, whatsapp, address, country, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855',
       'FMH-C-' || LPAD((COALESCE((SELECT max(NULLIF(regexp_replace(client_code,'\D','','g'),'')::int)
          FROM clients WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND client_code LIKE 'FMH-C-%'),0)+1)::text,4,'0'),
       'Waqas Javed', 'S/O Javed Khalil', '11101-3040328-9', '0333-0311177', '0333-0311177', 'House No: 206 A, Town Ship, Bannu',
       'Pakistan','active','2026-07-29 booking-record backfill'
WHERE NOT EXISTS (SELECT 1 FROM clients
  WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND cnic='11101-3040328-9');

-- 2. SALES (idempotent: skipped if the unit already carries a live sale) ----
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-184', u.id, c.id,
       40000.00, 90.96, 400.00, 0, 42,
       'active', DATE '2025-12-02', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='13101-9679725-1'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='MF-30'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-134', u.id, c.id,
       30000.57, 159.64, 0.99, 0, 42,
       'active', DATE '2025-08-04', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17101-3527646-0'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='MF-61'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-135', u.id, c.id,
       29999.45, 163.28, 0.20, 0, 42,
       'active', DATE '2025-08-04', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17101-3527646-0'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='MF-62'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-146', u.id, c.id,
       19537.92, 804.00, 7.68, 0, 42,
       'active', DATE '2025-08-13', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17101-3527646-0'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='6-01'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-142', u.id, c.id,
       10100.00, 485.70, 0.00, 0, 42,
       'active', DATE '2025-08-04', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17101-3648938-3'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='2-14'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-138', u.id, c.id,
       30000.00, 82.11, 0.00, 0, 42,
       'active', DATE '2025-08-04', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17101-3648938-3'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='MF-18'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-237', u.id, c.id,
       9300.00, 1260.67, 1172423.00, 0, 42,
       'active', DATE '2026-04-06', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17301-9671690-9'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='5-02'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-238', u.id, c.id,
       18606.42, 826.00, 1536891.92, 0, 42,
       'active', DATE '2026-04-06', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17301-9671690-9'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='5-03'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-239', u.id, c.id,
       9300.00, 771.50, 717495.00, 0, 42,
       'active', DATE '2026-04-06', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17301-9671690-9'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='5-05'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-240', u.id, c.id,
       9300.00, 1615.61, 1502518.00, 0, 42,
       'active', DATE '2026-04-06', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17301-9671690-9'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='5-06'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-241', u.id, c.id,
       12409.37, 364.00, 451701.68, 0, 42,
       'active', DATE '2026-04-06', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17301-9671690-9'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='5-14'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-42', u.id, c.id,
       9000.00, 593.79, 0.00, 0, 4,
       'active', DATE '2024-11-12', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='21302-3915564-1'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='8-09'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-117', u.id, c.id,
       9000.00, 926.00, 833400.00, 0, 2,
       'active', DATE '2024-09-11', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='GP 10935978591'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='8-15'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-88', u.id, c.id,
       9200.00, 473.00, 351600.00, 0, 42,
       'active', DATE '2025-03-17', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17101-8984766-5'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='10-18'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-197', u.id, c.id,
       9100.00, 523.00, 209300.00, 0, 42,
       'active', DATE '2025-12-30', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17301-5092061-9'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='11-15'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-177', u.id, c.id,
       60000.00, 273.60, 547200.00, 0, 42,
       'active', DATE '2025-11-18', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17301-1227024-3'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='GF-43'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-167', u.id, c.id,
       40000.00, 150.75, 0.00, 0, 42,
       'active', DATE '2025-10-23', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17301-9442445-9'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='LG-21'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-74', u.id, c.id,
       25000.00, 97.41, 0.00, 0, 42,
       'active', DATE '2025-01-23', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='13504-7772000-2'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='LG-24'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-69', u.id, c.id,
       26000.00, 157.79, 0.00, 0, 42,
       'active', DATE '2025-01-02', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='17202-0602884-6'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='LG-37B'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-157', u.id, c.id,
       30000.00, 101.98, 0.00, 0, 42,
       'active', DATE '2025-09-17', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='21301-7068071-1'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='MF-19'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');
INSERT INTO sales (company_id, project_id, sale_number, unit_id, client_id,
       price_per_sqft, area_sqft, discount, down_payment, installment_count,
       status, sale_date, payment_plan_type, commission_rate, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855','BKG-260', u.id, c.id,
       9400.00, 559.00, 0.00, 0, 41,
       'active', DATE '2026-05-22', 'installment', 0, '2026-07-29 booking-record backfill'
FROM units u
JOIN clients c ON c.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND c.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND c.cnic='11101-3040328-9'
WHERE u.project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND u.unit_no='12-09'
  AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.unit_id=u.id AND s.status <> 'cancelled');

-- 3. INSTALLMENTS (due dates only; amount_paid stays 0, status pending) ----
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2025-12-02',363800.00,'1st Booking'),
         (2,DATE '2026-01-02',363800.00,'2nd Booking'),
         (3,DATE '2026-02-02',363800.00,'3rd Booking'),
         (4,DATE '2026-03-02',50000.00,'Installment No.1'),
         (5,DATE '2026-04-02',50000.00,'Installment No.2'),
         (6,DATE '2026-05-02',50000.00,'Installment No.3'),
         (7,DATE '2026-06-02',50000.00,'Installment No.4'),
         (8,DATE '2026-07-02',50000.00,'Installment No.5'),
         (9,DATE '2026-08-02',50000.00,'Installment No.6'),
         (10,DATE '2026-09-02',50000.00,'Installment No.7'),
         (11,DATE '2026-10-02',50000.00,'Installment No.8'),
         (12,DATE '2026-11-02',50000.00,'Installment No.9'),
         (13,DATE '2026-12-02',50000.00,'Installment No.10'),
         (14,DATE '2027-01-02',50000.00,'Installment No.11'),
         (15,DATE '2027-02-02',160000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2027-03-02',50000.00,'Installment No.13'),
         (17,DATE '2027-04-02',50000.00,'Installment No.14'),
         (18,DATE '2027-05-02',50000.00,'Installment No.15'),
         (19,DATE '2027-06-02',50000.00,'Installment No.16'),
         (20,DATE '2027-07-02',50000.00,'Installment No.17'),
         (21,DATE '2027-08-02',50000.00,'Installment No.18'),
         (22,DATE '2027-09-02',50000.00,'Installment No.19'),
         (23,DATE '2027-10-02',50000.00,'Installment No.20'),
         (24,DATE '2027-11-02',50000.00,'Installment No.21'),
         (25,DATE '2027-12-02',50000.00,'Installment No.22'),
         (26,DATE '2028-01-02',50000.00,'Installment No.23'),
         (27,DATE '2028-02-02',160000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2028-03-02',50000.00,'Installment No.25'),
         (29,DATE '2028-04-02',50000.00,'Installment No.26'),
         (30,DATE '2028-05-02',50000.00,'Installment No.27'),
         (31,DATE '2028-06-02',50000.00,'Installment No.28'),
         (32,DATE '2028-07-02',50000.00,'Installment No.29'),
         (33,DATE '2028-08-02',50000.00,'Installment No.30'),
         (34,DATE '2028-09-02',50000.00,'Installment No.31'),
         (35,DATE '2028-10-02',50000.00,'Installment No.32'),
         (36,DATE '2028-11-02',50000.00,'Installment No.33'),
         (37,DATE '2028-12-02',50000.00,'Installment No.34'),
         (38,DATE '2029-01-02',50000.00,'Installment No.35'),
         (39,DATE '2029-02-02',160000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2029-03-02',50000.00,'Installment No.37'),
         (41,DATE '2029-04-02',50000.00,'Installment No.38'),
         (42,DATE '2029-05-02',316600.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-184'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2025-08-04',1436787.00,'1st Booking'),
         (2,DATE '2025-09-04',200000.00,'2nd Booking'),
         (3,DATE '2025-10-04',200000.00,'3rd Booking'),
         (4,DATE '2025-11-04',50000.00,'Installment No.1'),
         (5,DATE '2025-12-04',50000.00,'Installment No.2'),
         (6,DATE '2026-01-04',50000.00,'Installment No.3'),
         (7,DATE '2026-02-04',50000.00,'Installment No.4'),
         (8,DATE '2026-03-04',50000.00,'Installment No.5'),
         (9,DATE '2026-04-04',50000.00,'Installment No.6'),
         (10,DATE '2026-05-04',50000.00,'Installment No.7'),
         (11,DATE '2026-06-04',50000.00,'Installment No.8'),
         (12,DATE '2026-07-04',50000.00,'Installment No.9'),
         (13,DATE '2026-08-04',50000.00,'Installment No.10'),
         (14,DATE '2026-09-04',50000.00,'Installment No.11'),
         (15,DATE '2026-10-04',300000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2026-11-04',50000.00,'Installment No.13'),
         (17,DATE '2026-12-04',50000.00,'Installment No.14'),
         (18,DATE '2027-01-04',50000.00,'Installment No.15'),
         (19,DATE '2027-02-04',50000.00,'Installment No.16'),
         (20,DATE '2027-03-04',50000.00,'Installment No.17'),
         (21,DATE '2027-04-04',50000.00,'Installment No.18'),
         (22,DATE '2027-05-04',50000.00,'Installment No.19'),
         (23,DATE '2027-06-04',50000.00,'Installment No.20'),
         (24,DATE '2027-07-04',50000.00,'Installment No.21'),
         (25,DATE '2027-08-04',50000.00,'Installment No.22'),
         (26,DATE '2027-09-04',50000.00,'Installment No.23'),
         (27,DATE '2027-10-04',300000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2027-11-04',50000.00,'Installment No.25'),
         (29,DATE '2027-12-04',50000.00,'Installment No.26'),
         (30,DATE '2028-01-04',50000.00,'Installment No.27'),
         (31,DATE '2028-02-04',50000.00,'Installment No.28'),
         (32,DATE '2028-03-04',50000.00,'Installment No.29'),
         (33,DATE '2028-04-04',50000.00,'Installment No.30'),
         (34,DATE '2028-05-04',50000.00,'Installment No.31'),
         (35,DATE '2028-06-04',50000.00,'Installment No.32'),
         (36,DATE '2028-07-04',50000.00,'Installment No.33'),
         (37,DATE '2028-08-04',50000.00,'Installment No.34'),
         (38,DATE '2028-09-04',50000.00,'Installment No.35'),
         (39,DATE '2028-10-04',300000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2028-11-04',50000.00,'Installment No.37'),
         (41,DATE '2028-12-04',50000.00,'Installment No.38'),
         (42,DATE '2029-01-04',302503.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-134'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2025-08-04',1469493.00,'1st Booking'),
         (2,DATE '2025-09-04',300000.00,'2nd Booking'),
         (3,DATE '2025-10-04',300000.00,'3rd Booking'),
         (4,DATE '2025-11-04',50000.00,'Installment No.1'),
         (5,DATE '2025-12-04',50000.00,'Installment No.2'),
         (6,DATE '2026-01-04',50000.00,'Installment No.3'),
         (7,DATE '2026-02-04',50000.00,'Installment No.4'),
         (8,DATE '2026-03-04',50000.00,'Installment No.5'),
         (9,DATE '2026-04-04',50000.00,'Installment No.6'),
         (10,DATE '2026-05-04',50000.00,'Installment No.7'),
         (11,DATE '2026-06-04',50000.00,'Installment No.8'),
         (12,DATE '2026-07-04',50000.00,'Installment No.9'),
         (13,DATE '2026-08-04',50000.00,'Installment No.10'),
         (14,DATE '2026-09-04',50000.00,'Installment No.11'),
         (15,DATE '2026-10-04',250000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2026-11-04',50000.00,'Installment No.13'),
         (17,DATE '2026-12-04',50000.00,'Installment No.14'),
         (18,DATE '2027-01-04',50000.00,'Installment No.15'),
         (19,DATE '2027-02-04',50000.00,'Installment No.16'),
         (20,DATE '2027-03-04',50000.00,'Installment No.17'),
         (21,DATE '2027-04-04',50000.00,'Installment No.18'),
         (22,DATE '2027-05-04',50000.00,'Installment No.19'),
         (23,DATE '2027-06-04',50000.00,'Installment No.20'),
         (24,DATE '2027-07-04',50000.00,'Installment No.21'),
         (25,DATE '2027-08-04',50000.00,'Installment No.22'),
         (26,DATE '2027-09-04',50000.00,'Installment No.23'),
         (27,DATE '2027-10-04',250000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2027-11-04',50000.00,'Installment No.25'),
         (29,DATE '2027-12-04',50000.00,'Installment No.26'),
         (30,DATE '2028-01-04',50000.00,'Installment No.27'),
         (31,DATE '2028-02-04',50000.00,'Installment No.28'),
         (32,DATE '2028-03-04',50000.00,'Installment No.29'),
         (33,DATE '2028-04-04',50000.00,'Installment No.30'),
         (34,DATE '2028-05-04',50000.00,'Installment No.31'),
         (35,DATE '2028-06-04',50000.00,'Installment No.32'),
         (36,DATE '2028-07-04',50000.00,'Installment No.33'),
         (37,DATE '2028-08-04',50000.00,'Installment No.34'),
         (38,DATE '2028-09-04',50000.00,'Installment No.35'),
         (39,DATE '2028-10-04',250000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2028-11-04',50000.00,'Installment No.37'),
         (41,DATE '2028-12-04',50000.00,'Installment No.38'),
         (42,DATE '2029-01-04',328817.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-135'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2025-08-13',4712544.00,'1st Booking'),
         (2,DATE '2025-09-13',700000.00,'2nd Booking'),
         (3,DATE '2025-10-13',700000.00,'3rd Booking'),
         (4,DATE '2025-11-13',250000.00,'Installment No.1'),
         (5,DATE '2025-12-13',250000.00,'Installment No.2'),
         (6,DATE '2026-01-13',250000.00,'Installment No.3'),
         (7,DATE '2026-02-13',250000.00,'Installment No.4'),
         (8,DATE '2026-03-13',250000.00,'Installment No.5'),
         (9,DATE '2026-04-13',250000.00,'Installment No.6'),
         (10,DATE '2026-05-13',250000.00,'Installment No.7'),
         (11,DATE '2026-06-13',250000.00,'Installment No.8'),
         (12,DATE '2026-07-13',250000.00,'Installment No.9'),
         (13,DATE '2026-08-13',250000.00,'Installment No.10'),
         (14,DATE '2026-09-13',250000.00,'Installment No.11'),
         (15,DATE '2026-10-13',250000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2026-11-13',250000.00,'Installment No.13'),
         (17,DATE '2026-12-13',250000.00,'Installment No.14'),
         (18,DATE '2027-01-13',250000.00,'Installment No.15'),
         (19,DATE '2027-02-13',250000.00,'Installment No.16'),
         (20,DATE '2027-03-13',250000.00,'Installment No.17'),
         (21,DATE '2027-04-13',250000.00,'Installment No.18'),
         (22,DATE '2027-05-13',250000.00,'Installment No.19'),
         (23,DATE '2027-06-13',250000.00,'Installment No.20'),
         (24,DATE '2027-07-13',250000.00,'Installment No.21'),
         (25,DATE '2027-08-13',250000.00,'Installment No.22'),
         (26,DATE '2027-09-13',250000.00,'Installment No.23'),
         (27,DATE '2027-10-13',250000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2027-11-13',250000.00,'Installment No.25'),
         (29,DATE '2027-12-13',250000.00,'Installment No.26'),
         (30,DATE '2028-01-13',250000.00,'Installment No.27'),
         (31,DATE '2028-02-13',250000.00,'Installment No.28'),
         (32,DATE '2028-03-13',250000.00,'Installment No.29'),
         (33,DATE '2028-04-13',250000.00,'Installment No.30'),
         (34,DATE '2028-05-13',250000.00,'Installment No.31'),
         (35,DATE '2028-06-13',250000.00,'Installment No.32'),
         (36,DATE '2028-07-13',250000.00,'Installment No.33'),
         (37,DATE '2028-08-13',250000.00,'Installment No.34'),
         (38,DATE '2028-09-13',250000.00,'Installment No.35'),
         (39,DATE '2028-10-13',250000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2028-11-13',250000.00,'Installment No.37'),
         (41,DATE '2028-12-13',250000.00,'Installment No.38'),
         (42,DATE '2029-01-13',95936.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-146'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2025-08-04',1300000.00,'1st Booking'),
         (2,DATE '2025-09-04',300000.00,'2nd Booking'),
         (3,DATE '2025-10-04',300000.00,'3rd Booking'),
         (4,DATE '2025-11-04',60000.00,'Installment No.1'),
         (5,DATE '2025-12-04',60000.00,'Installment No.2'),
         (6,DATE '2026-01-04',60000.00,'Installment No.3'),
         (7,DATE '2026-02-04',60000.00,'Installment No.4'),
         (8,DATE '2026-03-04',60000.00,'Installment No.5'),
         (9,DATE '2026-04-04',60000.00,'Installment No.6'),
         (10,DATE '2026-05-04',60000.00,'Installment No.7'),
         (11,DATE '2026-06-04',60000.00,'Installment No.8'),
         (12,DATE '2026-07-04',60000.00,'Installment No.9'),
         (13,DATE '2026-08-04',60000.00,'Installment No.10'),
         (14,DATE '2026-09-04',60000.00,'Installment No.11'),
         (15,DATE '2026-10-04',250000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2026-11-04',60000.00,'Installment No.13'),
         (17,DATE '2026-12-04',60000.00,'Installment No.14'),
         (18,DATE '2027-01-04',60000.00,'Installment No.15'),
         (19,DATE '2027-02-04',60000.00,'Installment No.16'),
         (20,DATE '2027-03-04',60000.00,'Installment No.17'),
         (21,DATE '2027-04-04',60000.00,'Installment No.18'),
         (22,DATE '2027-05-04',60000.00,'Installment No.19'),
         (23,DATE '2027-06-04',60000.00,'Installment No.20'),
         (24,DATE '2027-07-04',60000.00,'Installment No.21'),
         (25,DATE '2027-08-04',60000.00,'Installment No.22'),
         (26,DATE '2027-09-04',60000.00,'Installment No.23'),
         (27,DATE '2027-10-04',250000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2027-11-04',60000.00,'Installment No.25'),
         (29,DATE '2027-12-04',60000.00,'Installment No.26'),
         (30,DATE '2028-01-04',60000.00,'Installment No.27'),
         (31,DATE '2028-02-04',60000.00,'Installment No.28'),
         (32,DATE '2028-03-04',60000.00,'Installment No.29'),
         (33,DATE '2028-04-04',60000.00,'Installment No.30'),
         (34,DATE '2028-05-04',60000.00,'Installment No.31'),
         (35,DATE '2028-06-04',60000.00,'Installment No.32'),
         (36,DATE '2028-07-04',60000.00,'Installment No.33'),
         (37,DATE '2028-08-04',60000.00,'Installment No.34'),
         (38,DATE '2028-09-04',60000.00,'Installment No.35'),
         (39,DATE '2028-10-04',250000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2028-11-04',60000.00,'Installment No.37'),
         (41,DATE '2028-12-04',60000.00,'Installment No.38'),
         (42,DATE '2029-01-04',155570.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-142'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2025-08-04',750000.00,'1st Booking'),
         (2,DATE '2025-09-04',150000.00,'2nd Booking'),
         (3,DATE '2025-10-04',150000.00,'3rd Booking'),
         (4,DATE '2025-11-04',30000.00,'Installment No.1'),
         (5,DATE '2025-12-04',30000.00,'Installment No.2'),
         (6,DATE '2026-01-04',30000.00,'Installment No.3'),
         (7,DATE '2026-02-04',30000.00,'Installment No.4'),
         (8,DATE '2026-03-04',30000.00,'Installment No.5'),
         (9,DATE '2026-04-04',30000.00,'Installment No.6'),
         (10,DATE '2026-05-04',30000.00,'Installment No.7'),
         (11,DATE '2026-06-04',30000.00,'Installment No.8'),
         (12,DATE '2026-07-04',30000.00,'Installment No.9'),
         (13,DATE '2026-08-04',30000.00,'Installment No.10'),
         (14,DATE '2026-09-04',30000.00,'Installment No.11'),
         (15,DATE '2026-10-04',100000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2026-11-04',30000.00,'Installment No.13'),
         (17,DATE '2026-12-04',30000.00,'Installment No.14'),
         (18,DATE '2027-01-04',30000.00,'Installment No.15'),
         (19,DATE '2027-02-04',30000.00,'Installment No.16'),
         (20,DATE '2027-03-04',30000.00,'Installment No.17'),
         (21,DATE '2027-04-04',30000.00,'Installment No.18'),
         (22,DATE '2027-05-04',30000.00,'Installment No.19'),
         (23,DATE '2027-06-04',30000.00,'Installment No.20'),
         (24,DATE '2027-07-04',30000.00,'Installment No.21'),
         (25,DATE '2027-08-04',30000.00,'Installment No.22'),
         (26,DATE '2027-09-04',30000.00,'Installment No.23'),
         (27,DATE '2027-10-04',100000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2027-11-04',30000.00,'Installment No.25'),
         (29,DATE '2027-12-04',30000.00,'Installment No.26'),
         (30,DATE '2028-01-04',30000.00,'Installment No.27'),
         (31,DATE '2028-02-04',30000.00,'Installment No.28'),
         (32,DATE '2028-03-04',30000.00,'Installment No.29'),
         (33,DATE '2028-04-04',30000.00,'Installment No.30'),
         (34,DATE '2028-05-04',30000.00,'Installment No.31'),
         (35,DATE '2028-06-04',30000.00,'Installment No.32'),
         (36,DATE '2028-07-04',30000.00,'Installment No.33'),
         (37,DATE '2028-08-04',30000.00,'Installment No.34'),
         (38,DATE '2028-09-04',30000.00,'Installment No.35'),
         (39,DATE '2028-10-04',100000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2028-11-04',30000.00,'Installment No.37'),
         (41,DATE '2028-12-04',30000.00,'Installment No.38'),
         (42,DATE '2029-01-04',63300.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-138'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2026-04-06',3165543.00,'1st Booking'),
         (2,DATE '2026-05-06',150000.00,'2nd Booking'),
         (3,DATE '2026-06-06',150000.00,'3rd Booking'),
         (4,DATE '2026-07-06',150000.00,'Installment No.1'),
         (5,DATE '2026-08-06',150000.00,'Installment No.2'),
         (6,DATE '2026-09-06',150000.00,'Installment No.3'),
         (7,DATE '2026-10-06',150000.00,'Installment No.4'),
         (8,DATE '2026-11-06',150000.00,'Installment No.5'),
         (9,DATE '2026-12-06',150000.00,'Installment No.6'),
         (10,DATE '2027-01-06',150000.00,'Installment No.7'),
         (11,DATE '2027-02-06',150000.00,'Installment No.8'),
         (12,DATE '2027-03-06',150000.00,'Installment No.9'),
         (13,DATE '2027-04-06',150000.00,'Installment No.10'),
         (14,DATE '2027-05-06',150000.00,'Installment No.11'),
         (15,DATE '2027-06-06',500000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2027-07-06',150000.00,'Installment No.13'),
         (17,DATE '2027-08-06',150000.00,'Installment No.14'),
         (18,DATE '2027-09-06',150000.00,'Installment No.15'),
         (19,DATE '2027-10-06',150000.00,'Installment No.16'),
         (20,DATE '2027-11-06',150000.00,'Installment No.17'),
         (21,DATE '2027-12-06',150000.00,'Installment No.18'),
         (22,DATE '2028-01-06',150000.00,'Installment No.19'),
         (23,DATE '2028-02-06',150000.00,'Installment No.20'),
         (24,DATE '2028-03-06',150000.00,'Installment No.21'),
         (25,DATE '2028-04-06',150000.00,'Installment No.22'),
         (26,DATE '2028-05-06',150000.00,'Installment No.23'),
         (27,DATE '2028-06-06',500000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2028-07-06',150000.00,'Installment No.25'),
         (29,DATE '2028-08-06',150000.00,'Installment No.26'),
         (30,DATE '2028-09-06',150000.00,'Installment No.27'),
         (31,DATE '2028-10-06',150000.00,'Installment No.28'),
         (32,DATE '2028-11-06',150000.00,'Installment No.29'),
         (33,DATE '2028-12-06',150000.00,'Installment No.30'),
         (34,DATE '2029-01-06',150000.00,'Installment No.31'),
         (35,DATE '2029-02-06',150000.00,'Installment No.32'),
         (36,DATE '2029-03-06',150000.00,'Installment No.33'),
         (37,DATE '2029-04-06',150000.00,'Installment No.34'),
         (38,DATE '2029-05-06',150000.00,'Installment No.35'),
         (39,DATE '2029-06-06',500000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2029-07-06',150000.00,'Installment No.37'),
         (41,DATE '2029-08-06',150000.00,'Installment No.38'),
         (42,DATE '2029-09-06',336265.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-237'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2026-04-06',4149603.00,'1st Booking'),
         (2,DATE '2026-05-06',200000.00,'2nd Booking'),
         (3,DATE '2026-06-06',200000.00,'3rd Booking'),
         (4,DATE '2026-07-06',200000.00,'Installment No.1'),
         (5,DATE '2026-08-06',200000.00,'Installment No.2'),
         (6,DATE '2026-09-06',200000.00,'Installment No.3'),
         (7,DATE '2026-10-06',200000.00,'Installment No.4'),
         (8,DATE '2026-11-06',200000.00,'Installment No.5'),
         (9,DATE '2026-12-06',200000.00,'Installment No.6'),
         (10,DATE '2027-01-06',200000.00,'Installment No.7'),
         (11,DATE '2027-02-06',200000.00,'Installment No.8'),
         (12,DATE '2027-03-06',200000.00,'Installment No.9'),
         (13,DATE '2027-04-06',200000.00,'Installment No.10'),
         (14,DATE '2027-05-06',200000.00,'Installment No.11'),
         (15,DATE '2027-06-06',600000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2027-07-06',200000.00,'Installment No.13'),
         (17,DATE '2027-08-06',200000.00,'Installment No.14'),
         (18,DATE '2027-09-06',200000.00,'Installment No.15'),
         (19,DATE '2027-10-06',200000.00,'Installment No.16'),
         (20,DATE '2027-11-06',200000.00,'Installment No.17'),
         (21,DATE '2027-12-06',200000.00,'Installment No.18'),
         (22,DATE '2028-01-06',200000.00,'Installment No.19'),
         (23,DATE '2028-02-06',200000.00,'Installment No.20'),
         (24,DATE '2028-03-06',200000.00,'Installment No.21'),
         (25,DATE '2028-04-06',200000.00,'Installment No.22'),
         (26,DATE '2028-05-06',200000.00,'Installment No.23'),
         (27,DATE '2028-06-06',600000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2028-07-06',200000.00,'Installment No.25'),
         (29,DATE '2028-08-06',200000.00,'Installment No.26'),
         (30,DATE '2028-09-06',200000.00,'Installment No.27'),
         (31,DATE '2028-10-06',200000.00,'Installment No.28'),
         (32,DATE '2028-11-06',200000.00,'Installment No.29'),
         (33,DATE '2028-12-06',200000.00,'Installment No.30'),
         (34,DATE '2029-01-06',200000.00,'Installment No.31'),
         (35,DATE '2029-02-06',200000.00,'Installment No.32'),
         (36,DATE '2029-03-06',200000.00,'Installment No.33'),
         (37,DATE '2029-04-06',200000.00,'Installment No.34'),
         (38,DATE '2029-05-06',200000.00,'Installment No.35'),
         (39,DATE '2029-06-06',600000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2029-07-06',200000.00,'Installment No.37'),
         (41,DATE '2029-08-06',200000.00,'Installment No.38'),
         (42,DATE '2029-09-06',482408.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-238'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2026-04-06',1937236.00,'1st Booking'),
         (2,DATE '2026-05-06',100000.00,'2nd Booking'),
         (3,DATE '2026-06-06',100000.00,'3rd Booking'),
         (4,DATE '2026-07-06',100000.00,'Installment No.1'),
         (5,DATE '2026-08-06',100000.00,'Installment No.2'),
         (6,DATE '2026-09-06',100000.00,'Installment No.3'),
         (7,DATE '2026-10-06',100000.00,'Installment No.4'),
         (8,DATE '2026-11-06',100000.00,'Installment No.5'),
         (9,DATE '2026-12-06',100000.00,'Installment No.6'),
         (10,DATE '2027-01-06',100000.00,'Installment No.7'),
         (11,DATE '2027-02-06',100000.00,'Installment No.8'),
         (12,DATE '2027-03-06',100000.00,'Installment No.9'),
         (13,DATE '2027-04-06',100000.00,'Installment No.10'),
         (14,DATE '2027-05-06',100000.00,'Installment No.11'),
         (15,DATE '2027-06-06',200000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2027-07-06',100000.00,'Installment No.13'),
         (17,DATE '2027-08-06',100000.00,'Installment No.14'),
         (18,DATE '2027-09-06',100000.00,'Installment No.15'),
         (19,DATE '2027-10-06',100000.00,'Installment No.16'),
         (20,DATE '2027-11-06',100000.00,'Installment No.17'),
         (21,DATE '2027-12-06',100000.00,'Installment No.18'),
         (22,DATE '2028-01-06',100000.00,'Installment No.19'),
         (23,DATE '2028-02-06',100000.00,'Installment No.20'),
         (24,DATE '2028-03-06',100000.00,'Installment No.21'),
         (25,DATE '2028-04-06',100000.00,'Installment No.22'),
         (26,DATE '2028-05-06',100000.00,'Installment No.23'),
         (27,DATE '2028-06-06',200000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2028-07-06',100000.00,'Installment No.25'),
         (29,DATE '2028-08-06',100000.00,'Installment No.26'),
         (30,DATE '2028-09-06',100000.00,'Installment No.27'),
         (31,DATE '2028-10-06',100000.00,'Installment No.28'),
         (32,DATE '2028-11-06',100000.00,'Installment No.29'),
         (33,DATE '2028-12-06',100000.00,'Installment No.30'),
         (34,DATE '2029-01-06',100000.00,'Installment No.31'),
         (35,DATE '2029-02-06',100000.00,'Installment No.32'),
         (36,DATE '2029-03-06',100000.00,'Installment No.33'),
         (37,DATE '2029-04-06',100000.00,'Installment No.34'),
         (38,DATE '2029-05-06',100000.00,'Installment No.35'),
         (39,DATE '2029-06-06',200000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2029-07-06',100000.00,'Installment No.37'),
         (41,DATE '2029-08-06',100000.00,'Installment No.38'),
         (42,DATE '2029-09-06',220219.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-239'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2026-04-06',4056796.00,'1st Booking'),
         (2,DATE '2026-05-06',200000.00,'2nd Booking'),
         (3,DATE '2026-06-06',200000.00,'3rd Booking'),
         (4,DATE '2026-07-06',200000.00,'Installment No.1'),
         (5,DATE '2026-08-06',200000.00,'Installment No.2'),
         (6,DATE '2026-09-06',200000.00,'Installment No.3'),
         (7,DATE '2026-10-06',200000.00,'Installment No.4'),
         (8,DATE '2026-11-06',200000.00,'Installment No.5'),
         (9,DATE '2026-12-06',200000.00,'Installment No.6'),
         (10,DATE '2027-01-06',200000.00,'Installment No.7'),
         (11,DATE '2027-02-06',200000.00,'Installment No.8'),
         (12,DATE '2027-03-06',200000.00,'Installment No.9'),
         (13,DATE '2027-04-06',200000.00,'Installment No.10'),
         (14,DATE '2027-05-06',200000.00,'Installment No.11'),
         (15,DATE '2027-06-06',500000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2027-07-06',200000.00,'Installment No.13'),
         (17,DATE '2027-08-06',200000.00,'Installment No.14'),
         (18,DATE '2027-09-06',200000.00,'Installment No.15'),
         (19,DATE '2027-10-06',200000.00,'Installment No.16'),
         (20,DATE '2027-11-06',200000.00,'Installment No.17'),
         (21,DATE '2027-12-06',200000.00,'Installment No.18'),
         (22,DATE '2028-01-06',200000.00,'Installment No.19'),
         (23,DATE '2028-02-06',200000.00,'Installment No.20'),
         (24,DATE '2028-03-06',200000.00,'Installment No.21'),
         (25,DATE '2028-04-06',200000.00,'Installment No.22'),
         (26,DATE '2028-05-06',200000.00,'Installment No.23'),
         (27,DATE '2028-06-06',500000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2028-07-06',200000.00,'Installment No.25'),
         (29,DATE '2028-08-06',200000.00,'Installment No.26'),
         (30,DATE '2028-09-06',200000.00,'Installment No.27'),
         (31,DATE '2028-10-06',200000.00,'Installment No.28'),
         (32,DATE '2028-11-06',200000.00,'Installment No.29'),
         (33,DATE '2028-12-06',200000.00,'Installment No.30'),
         (34,DATE '2029-01-06',200000.00,'Installment No.31'),
         (35,DATE '2029-02-06',200000.00,'Installment No.32'),
         (36,DATE '2029-03-06',200000.00,'Installment No.33'),
         (37,DATE '2029-04-06',200000.00,'Installment No.34'),
         (38,DATE '2029-05-06',200000.00,'Installment No.35'),
         (39,DATE '2029-06-06',500000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2029-07-06',200000.00,'Installment No.37'),
         (41,DATE '2029-08-06',200000.00,'Installment No.38'),
         (42,DATE '2029-09-06',565859.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-240'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2026-04-06',1219592.00,'1st Booking'),
         (2,DATE '2026-05-06',50000.00,'2nd Booking'),
         (3,DATE '2026-06-06',50000.00,'3rd Booking'),
         (4,DATE '2026-07-06',50000.00,'Installment No.1'),
         (5,DATE '2026-08-06',50000.00,'Installment No.2'),
         (6,DATE '2026-09-06',50000.00,'Installment No.3'),
         (7,DATE '2026-10-06',50000.00,'Installment No.4'),
         (8,DATE '2026-11-06',50000.00,'Installment No.5'),
         (9,DATE '2026-12-06',50000.00,'Installment No.6'),
         (10,DATE '2027-01-06',50000.00,'Installment No.7'),
         (11,DATE '2027-02-06',50000.00,'Installment No.8'),
         (12,DATE '2027-03-06',50000.00,'Installment No.9'),
         (13,DATE '2027-04-06',50000.00,'Installment No.10'),
         (14,DATE '2027-05-06',50000.00,'Installment No.11'),
         (15,DATE '2027-06-06',250000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2027-07-06',50000.00,'Installment No.13'),
         (17,DATE '2027-08-06',50000.00,'Installment No.14'),
         (18,DATE '2027-09-06',50000.00,'Installment No.15'),
         (19,DATE '2027-10-06',50000.00,'Installment No.16'),
         (20,DATE '2027-11-06',50000.00,'Installment No.17'),
         (21,DATE '2027-12-06',50000.00,'Installment No.18'),
         (22,DATE '2028-01-06',50000.00,'Installment No.19'),
         (23,DATE '2028-02-06',50000.00,'Installment No.20'),
         (24,DATE '2028-03-06',50000.00,'Installment No.21'),
         (25,DATE '2028-04-06',50000.00,'Installment No.22'),
         (26,DATE '2028-05-06',50000.00,'Installment No.23'),
         (27,DATE '2028-06-06',250000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2028-07-06',50000.00,'Installment No.25'),
         (29,DATE '2028-08-06',50000.00,'Installment No.26'),
         (30,DATE '2028-09-06',50000.00,'Installment No.27'),
         (31,DATE '2028-10-06',50000.00,'Installment No.28'),
         (32,DATE '2028-11-06',50000.00,'Installment No.29'),
         (33,DATE '2028-12-06',50000.00,'Installment No.30'),
         (34,DATE '2029-01-06',50000.00,'Installment No.31'),
         (35,DATE '2029-02-06',50000.00,'Installment No.32'),
         (36,DATE '2029-03-06',50000.00,'Installment No.33'),
         (37,DATE '2029-04-06',50000.00,'Installment No.34'),
         (38,DATE '2029-05-06',50000.00,'Installment No.35'),
         (39,DATE '2029-06-06',250000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2029-07-06',50000.00,'Installment No.37'),
         (41,DATE '2029-08-06',50000.00,'Installment No.38'),
         (42,DATE '2029-09-06',245717.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-241'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2024-11-12',0.00,'1st Booking'),
         (2,DATE '2024-12-12',0.00,'2nd Booking'),
         (3,DATE '2025-01-12',0.00,'3rd Booking'),
         (4,DATE '2025-02-12',5344110.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-42'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2024-09-11',0.00,'1st Booking'),
         (2,DATE '2024-10-11',7500600.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-117'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2025-03-17',400000.00,'1st Booking'),
         (2,DATE '2025-04-17',400000.00,'2nd Booking'),
         (3,DATE '2025-05-17',400000.00,'3rd Booking'),
         (4,DATE '2025-06-17',70000.00,'Installment No.1'),
         (5,DATE '2025-07-17',70000.00,'Installment No.2'),
         (6,DATE '2025-08-17',70000.00,'Installment No.3'),
         (7,DATE '2025-09-17',70000.00,'Installment No.4'),
         (8,DATE '2025-10-17',70000.00,'Installment No.5'),
         (9,DATE '2025-11-17',70000.00,'Installment No.6'),
         (10,DATE '2025-12-17',70000.00,'Installment No.7'),
         (11,DATE '2026-01-17',70000.00,'Installment No.8'),
         (12,DATE '2026-02-17',70000.00,'Installment No.9'),
         (13,DATE '2026-03-17',70000.00,'Installment No.10'),
         (14,DATE '2026-04-17',70000.00,'Installment No.11'),
         (15,DATE '2026-05-17',70000.00,'Installment No.12'),
         (16,DATE '2026-06-17',70000.00,'Installment No.13'),
         (17,DATE '2026-07-17',70000.00,'Installment No.14'),
         (18,DATE '2026-08-17',70000.00,'Installment No.15'),
         (19,DATE '2026-09-17',70000.00,'Installment No.16'),
         (20,DATE '2026-10-17',70000.00,'Installment No.17'),
         (21,DATE '2026-11-17',70000.00,'Installment No.18'),
         (22,DATE '2026-12-17',70000.00,'Installment No.19'),
         (23,DATE '2027-01-17',70000.00,'Installment No.20'),
         (24,DATE '2027-02-17',70000.00,'Installment No.21'),
         (25,DATE '2027-03-17',70000.00,'Installment No.22'),
         (26,DATE '2027-04-17',70000.00,'Installment No.23'),
         (27,DATE '2027-05-17',70000.00,'Installment No.24'),
         (28,DATE '2027-06-17',70000.00,'Installment No.25'),
         (29,DATE '2027-07-17',70000.00,'Installment No.26'),
         (30,DATE '2027-08-17',70000.00,'Installment No.27'),
         (31,DATE '2027-09-17',70000.00,'Installment No.28'),
         (32,DATE '2027-10-17',70000.00,'Installment No.29'),
         (33,DATE '2027-11-17',70000.00,'Installment No.30'),
         (34,DATE '2027-12-17',70000.00,'Installment No.31'),
         (35,DATE '2028-01-17',70000.00,'Installment No.32'),
         (36,DATE '2028-02-17',70000.00,'Installment No.33'),
         (37,DATE '2028-03-17',70000.00,'Installment No.34'),
         (38,DATE '2028-04-17',70000.00,'Installment No.35'),
         (39,DATE '2028-05-17',70000.00,'Installment No.36'),
         (40,DATE '2028-06-17',70000.00,'Installment No.37'),
         (41,DATE '2028-07-17',70000.00,'Installment No.38'),
         (42,DATE '2028-08-17',140000.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-88'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2025-12-30',500000.00,'1st Booking'),
         (2,DATE '2026-01-30',500000.00,'2nd Booking'),
         (3,DATE '2026-02-28',500000.00,'3rd Booking'),
         (4,DATE '2026-03-28',30000.00,'Installment No.1'),
         (5,DATE '2026-04-28',30000.00,'Installment No.2'),
         (6,DATE '2026-05-28',30000.00,'Installment No.3'),
         (7,DATE '2026-06-28',30000.00,'Installment No.4'),
         (8,DATE '2026-07-28',30000.00,'Installment No.5'),
         (9,DATE '2026-08-28',30000.00,'Installment No.6'),
         (10,DATE '2026-09-28',30000.00,'Installment No.7'),
         (11,DATE '2026-10-28',30000.00,'Installment No.8'),
         (12,DATE '2026-11-28',30000.00,'Installment No.9'),
         (13,DATE '2026-12-28',30000.00,'Installment No.10'),
         (14,DATE '2027-01-28',30000.00,'Installment No.11'),
         (15,DATE '2027-02-28',165000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2027-03-28',30000.00,'Installment No.13'),
         (17,DATE '2027-04-28',30000.00,'Installment No.14'),
         (18,DATE '2027-05-28',30000.00,'Installment No.15'),
         (19,DATE '2027-06-28',30000.00,'Installment No.16'),
         (20,DATE '2027-07-28',30000.00,'Installment No.17'),
         (21,DATE '2027-08-28',30000.00,'Installment No.18'),
         (22,DATE '2027-09-28',30000.00,'Installment No.19'),
         (23,DATE '2027-10-28',30000.00,'Installment No.20'),
         (24,DATE '2027-11-28',30000.00,'Installment No.21'),
         (25,DATE '2027-12-28',30000.00,'Installment No.22'),
         (26,DATE '2028-01-28',30000.00,'Installment No.23'),
         (27,DATE '2028-02-28',165000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2028-03-28',30000.00,'Installment No.25'),
         (29,DATE '2028-04-28',30000.00,'Installment No.26'),
         (30,DATE '2028-05-28',30000.00,'Installment No.27'),
         (31,DATE '2028-06-28',30000.00,'Installment No.28'),
         (32,DATE '2028-07-28',30000.00,'Installment No.29'),
         (33,DATE '2028-08-28',30000.00,'Installment No.30'),
         (34,DATE '2028-09-28',30000.00,'Installment No.31'),
         (35,DATE '2028-10-28',30000.00,'Installment No.32'),
         (36,DATE '2028-11-28',30000.00,'Installment No.33'),
         (37,DATE '2028-12-28',30000.00,'Installment No.34'),
         (38,DATE '2029-01-28',30000.00,'Installment No.35'),
         (39,DATE '2029-02-28',165000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2029-03-28',30000.00,'Installment No.37'),
         (41,DATE '2029-04-28',30000.00,'Installment No.38'),
         (42,DATE '2029-05-28',1505000.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-197'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2025-11-18',1600000.00,'1st Booking'),
         (2,DATE '2025-12-18',1600000.00,'2nd Booking'),
         (3,DATE '2026-01-18',1600000.00,'3rd Booking'),
         (4,DATE '2026-02-18',200000.00,'Installment No.1'),
         (5,DATE '2026-03-18',200000.00,'Installment No.2'),
         (6,DATE '2026-04-18',200000.00,'Installment No.3'),
         (7,DATE '2026-05-18',200000.00,'Installment No.4'),
         (8,DATE '2026-06-18',200000.00,'Installment No.5'),
         (9,DATE '2026-07-18',200000.00,'Installment No.6'),
         (10,DATE '2026-08-18',200000.00,'Installment No.7'),
         (11,DATE '2026-09-18',200000.00,'Installment No.8'),
         (12,DATE '2026-10-18',200000.00,'Installment No.9'),
         (13,DATE '2026-11-18',200000.00,'Installment No.10'),
         (14,DATE '2026-12-18',200000.00,'Installment No.11'),
         (15,DATE '2027-01-18',820000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2027-02-18',200000.00,'Installment No.13'),
         (17,DATE '2027-03-18',200000.00,'Installment No.14'),
         (18,DATE '2027-04-18',200000.00,'Installment No.15'),
         (19,DATE '2027-05-18',200000.00,'Installment No.16'),
         (20,DATE '2027-06-18',200000.00,'Installment No.17'),
         (21,DATE '2027-07-18',200000.00,'Installment No.18'),
         (22,DATE '2027-08-18',200000.00,'Installment No.19'),
         (23,DATE '2027-09-18',200000.00,'Installment No.20'),
         (24,DATE '2027-10-18',200000.00,'Installment No.21'),
         (25,DATE '2027-11-18',200000.00,'Installment No.22'),
         (26,DATE '2027-12-18',200000.00,'Installment No.23'),
         (27,DATE '2028-01-18',820000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2028-02-18',200000.00,'Installment No.25'),
         (29,DATE '2028-03-18',200000.00,'Installment No.26'),
         (30,DATE '2028-04-18',200000.00,'Installment No.27'),
         (31,DATE '2028-05-18',200000.00,'Installment No.28'),
         (32,DATE '2028-06-18',200000.00,'Installment No.29'),
         (33,DATE '2028-07-18',200000.00,'Installment No.30'),
         (34,DATE '2028-08-18',200000.00,'Installment No.31'),
         (35,DATE '2028-09-18',200000.00,'Installment No.32'),
         (36,DATE '2028-10-18',200000.00,'Installment No.33'),
         (37,DATE '2028-11-18',200000.00,'Installment No.34'),
         (38,DATE '2028-12-18',200000.00,'Installment No.35'),
         (39,DATE '2029-01-18',820000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2029-02-18',200000.00,'Installment No.37'),
         (41,DATE '2029-03-18',200000.00,'Installment No.38'),
         (42,DATE '2029-04-18',1608800.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-177'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2025-10-23',1809000.00,'1st Booking'),
         (2,DATE '2025-11-23',100000.00,'2nd Booking'),
         (3,DATE '2025-12-23',100000.00,'3rd Booking'),
         (4,DATE '2026-01-23',100000.00,'Installment No.1'),
         (5,DATE '2026-02-23',100000.00,'Installment No.2'),
         (6,DATE '2026-03-23',100000.00,'Installment No.3'),
         (7,DATE '2026-04-23',100000.00,'Installment No.4'),
         (8,DATE '2026-05-23',100000.00,'Installment No.5'),
         (9,DATE '2026-06-23',100000.00,'Installment No.6'),
         (10,DATE '2026-07-23',100000.00,'Installment No.7'),
         (11,DATE '2026-08-23',100000.00,'Installment No.8'),
         (12,DATE '2026-09-23',100000.00,'Installment No.9'),
         (13,DATE '2026-10-23',100000.00,'Installment No.10'),
         (14,DATE '2026-11-23',100000.00,'Installment No.11'),
         (15,DATE '2026-12-23',100000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2027-01-23',100000.00,'Installment No.13'),
         (17,DATE '2027-02-23',100000.00,'Installment No.14'),
         (18,DATE '2027-03-23',100000.00,'Installment No.15'),
         (19,DATE '2027-04-23',100000.00,'Installment No.16'),
         (20,DATE '2027-05-23',100000.00,'Installment No.17'),
         (21,DATE '2027-06-23',100000.00,'Installment No.18'),
         (22,DATE '2027-07-23',100000.00,'Installment No.19'),
         (23,DATE '2027-08-23',100000.00,'Installment No.20'),
         (24,DATE '2027-09-23',100000.00,'Installment No.21'),
         (25,DATE '2027-10-23',100000.00,'Installment No.22'),
         (26,DATE '2027-11-23',100000.00,'Installment No.23'),
         (27,DATE '2027-12-23',100000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2028-01-23',100000.00,'Installment No.25'),
         (29,DATE '2028-02-23',100000.00,'Installment No.26'),
         (30,DATE '2028-03-23',100000.00,'Installment No.27'),
         (31,DATE '2028-04-23',100000.00,'Installment No.28'),
         (32,DATE '2028-05-23',100000.00,'Installment No.29'),
         (33,DATE '2028-06-23',100000.00,'Installment No.30'),
         (34,DATE '2028-07-23',100000.00,'Installment No.31'),
         (35,DATE '2028-08-23',100000.00,'Installment No.32'),
         (36,DATE '2028-09-23',100000.00,'Installment No.33'),
         (37,DATE '2028-10-23',100000.00,'Installment No.34'),
         (38,DATE '2028-11-23',100000.00,'Installment No.35'),
         (39,DATE '2028-12-23',100000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2029-01-23',100000.00,'Installment No.37'),
         (41,DATE '2029-02-23',100000.00,'Installment No.38'),
         (42,DATE '2029-03-23',221000.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-167'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2025-01-23',0.00,'1st Booking'),
         (2,DATE '2025-02-23',60000.00,'Installment No.1'),
         (3,DATE '2025-03-23',60000.00,'Installment No.2'),
         (4,DATE '2025-04-23',60000.00,'Installment No.3'),
         (5,DATE '2025-05-23',60000.00,'Installment No.4'),
         (6,DATE '2025-06-23',60000.00,'Installment No.5'),
         (7,DATE '2025-07-23',60000.00,'Installment No.6'),
         (8,DATE '2025-08-23',60000.00,'Installment No.7'),
         (9,DATE '2025-09-23',60000.00,'Installment No.8'),
         (10,DATE '2025-10-23',60000.00,'Installment No.9'),
         (11,DATE '2025-11-23',60000.00,'Installment No.10'),
         (12,DATE '2025-12-23',60000.00,'Installment No.11'),
         (13,DATE '2026-01-23',60000.00,'Installment No.12'),
         (14,DATE '2026-02-23',60000.00,'Installment No.13'),
         (15,DATE '2026-03-23',60000.00,'Installment No.14'),
         (16,DATE '2026-04-23',60000.00,'Installment No.15'),
         (17,DATE '2026-05-23',60000.00,'Installment No.16'),
         (18,DATE '2026-06-23',60000.00,'Installment No.17'),
         (19,DATE '2026-07-23',60000.00,'Installment No.18'),
         (20,DATE '2026-08-23',60000.00,'Installment No.19'),
         (21,DATE '2026-09-23',60000.00,'Installment No.20'),
         (22,DATE '2026-10-23',60000.00,'Installment No.21'),
         (23,DATE '2026-11-23',60000.00,'Installment No.22'),
         (24,DATE '2026-12-23',60000.00,'Installment No.23'),
         (25,DATE '2027-01-23',60000.00,'Installment No.24'),
         (26,DATE '2027-02-23',60000.00,'Installment No.25'),
         (27,DATE '2027-03-23',60000.00,'Installment No.26'),
         (28,DATE '2027-04-23',60000.00,'Installment No.27'),
         (29,DATE '2027-05-23',60000.00,'Installment No.28'),
         (30,DATE '2027-06-23',60000.00,'Installment No.29'),
         (31,DATE '2027-07-23',60000.00,'Installment No.30'),
         (32,DATE '2027-08-23',60000.00,'Installment No.31'),
         (33,DATE '2027-09-23',60000.00,'Installment No.32'),
         (34,DATE '2027-10-23',60000.00,'Installment No.33'),
         (35,DATE '2027-11-23',60000.00,'Installment No.34'),
         (36,DATE '2027-12-23',60000.00,'Installment No.35'),
         (37,DATE '2028-01-23',60000.00,'Installment No.36'),
         (38,DATE '2028-02-23',60000.00,'Installment No.37'),
         (39,DATE '2028-03-23',60000.00,'Installment No.38'),
         (40,DATE '2028-04-23',60000.00,'Installment No.39'),
         (41,DATE '2028-05-23',60000.00,'Installment No.40'),
         (42,DATE '2028-06-23',35250.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-74'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2025-01-02',100000.00,'1st Booking'),
         (2,DATE '2025-02-02',100000.00,'Installment No.1'),
         (3,DATE '2025-03-02',100000.00,'Installment No.2'),
         (4,DATE '2025-04-02',100000.00,'Installment No.3'),
         (5,DATE '2025-05-02',100000.00,'Installment No.4'),
         (6,DATE '2025-06-02',100000.00,'Installment No.5'),
         (7,DATE '2025-07-02',100000.00,'Installment No.6'),
         (8,DATE '2025-08-02',100000.00,'Installment No.7'),
         (9,DATE '2025-09-02',100000.00,'Installment No.8'),
         (10,DATE '2025-10-02',100000.00,'Installment No.9'),
         (11,DATE '2025-11-02',100000.00,'Installment No.10'),
         (12,DATE '2025-12-02',100000.00,'Installment No.11'),
         (13,DATE '2026-01-02',100000.00,'Installment No.12'),
         (14,DATE '2026-02-02',100000.00,'Installment No.13'),
         (15,DATE '2026-03-02',100000.00,'Installment No.14'),
         (16,DATE '2026-04-02',100000.00,'Installment No.15'),
         (17,DATE '2026-05-02',100000.00,'Installment No.16'),
         (18,DATE '2026-06-02',100000.00,'Installment No.17'),
         (19,DATE '2026-07-02',100000.00,'Installment No.18'),
         (20,DATE '2026-08-02',100000.00,'Installment No.19'),
         (21,DATE '2026-09-02',100000.00,'Installment No.20'),
         (22,DATE '2026-10-02',100000.00,'Installment No.21'),
         (23,DATE '2026-11-02',100000.00,'Installment No.22'),
         (24,DATE '2026-12-02',100000.00,'Installment No.23'),
         (25,DATE '2027-01-02',100000.00,'Installment No.24'),
         (26,DATE '2027-02-02',100000.00,'Installment No.25'),
         (27,DATE '2027-03-02',100000.00,'Installment No.26'),
         (28,DATE '2027-04-02',100000.00,'Installment No.27'),
         (29,DATE '2027-05-02',100000.00,'Installment No.28'),
         (30,DATE '2027-06-02',100000.00,'Installment No.29'),
         (31,DATE '2027-07-02',100000.00,'Installment No.30'),
         (32,DATE '2027-08-02',100000.00,'Installment No.31'),
         (33,DATE '2027-09-02',100000.00,'Installment No.32'),
         (34,DATE '2027-10-02',100000.00,'Installment No.33'),
         (35,DATE '2027-11-02',100000.00,'Installment No.34'),
         (36,DATE '2027-12-02',100000.00,'Installment No.35'),
         (37,DATE '2028-01-02',100000.00,'Installment No.36'),
         (38,DATE '2028-02-02',100000.00,'Installment No.37'),
         (39,DATE '2028-03-02',100000.00,'Installment No.38'),
         (40,DATE '2028-04-02',100000.00,'Installment No.39'),
         (41,DATE '2028-05-02',100000.00,'Installment No.40'),
         (42,DATE '2028-06-02',2540.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-69'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2025-09-17',917820.00,'1st Booking'),
         (2,DATE '2025-10-17',100000.00,'2nd Booking'),
         (3,DATE '2025-11-17',100000.00,'3rd Booking'),
         (4,DATE '2025-12-17',50000.00,'Installment No.1'),
         (5,DATE '2026-01-17',50000.00,'Installment No.2'),
         (6,DATE '2026-02-17',50000.00,'Installment No.3'),
         (7,DATE '2026-03-17',50000.00,'Installment No.4'),
         (8,DATE '2026-04-17',50000.00,'Installment No.5'),
         (9,DATE '2026-05-17',50000.00,'Installment No.6'),
         (10,DATE '2026-06-17',50000.00,'Installment No.7'),
         (11,DATE '2026-07-17',50000.00,'Installment No.8'),
         (12,DATE '2026-08-17',50000.00,'Installment No.9'),
         (13,DATE '2026-09-17',50000.00,'Installment No.10'),
         (14,DATE '2026-10-17',50000.00,'Installment No.11'),
         (15,DATE '2026-11-17',50000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2026-12-17',50000.00,'Installment No.13'),
         (17,DATE '2027-01-17',50000.00,'Installment No.14'),
         (18,DATE '2027-02-17',50000.00,'Installment No.15'),
         (19,DATE '2027-03-17',50000.00,'Installment No.16'),
         (20,DATE '2027-04-17',50000.00,'Installment No.17'),
         (21,DATE '2027-05-17',50000.00,'Installment No.18'),
         (22,DATE '2027-06-17',50000.00,'Installment No.19'),
         (23,DATE '2027-07-17',50000.00,'Installment No.20'),
         (24,DATE '2027-08-17',50000.00,'Installment No.21'),
         (25,DATE '2027-09-17',50000.00,'Installment No.22'),
         (26,DATE '2027-10-17',50000.00,'Installment No.23'),
         (27,DATE '2027-11-17',50000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2027-12-17',50000.00,'Installment No.25'),
         (29,DATE '2028-01-17',50000.00,'Installment No.26'),
         (30,DATE '2028-02-17',50000.00,'Installment No.27'),
         (31,DATE '2028-03-17',50000.00,'Installment No.28'),
         (32,DATE '2028-04-17',50000.00,'Installment No.29'),
         (33,DATE '2028-05-17',50000.00,'Installment No.30'),
         (34,DATE '2028-06-17',50000.00,'Installment No.31'),
         (35,DATE '2028-07-17',50000.00,'Installment No.32'),
         (36,DATE '2028-08-17',50000.00,'Installment No.33'),
         (37,DATE '2028-09-17',50000.00,'Installment No.34'),
         (38,DATE '2028-10-17',50000.00,'Installment No.35'),
         (39,DATE '2028-11-17',50000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2028-12-17',50000.00,'Installment No.37'),
         (41,DATE '2029-01-17',50000.00,'Installment No.38'),
         (42,DATE '2029-02-17',41580.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-157'
ON CONFLICT (sale_id, installment_number) DO NOTHING;
INSERT INTO installments (company_id, project_id, sale_id, installment_number,
       due_date, amount_due, amount_paid, installment_type, status, notes)
SELECT '71d33e07-e55c-49af-8f5b-fdd7fd6e8612','ce05f4bb-a527-4e2b-b529-970c76c8d855', s.id, v.n, v.d, v.a, 0, 'installment', 'pending', v.lbl
FROM sales s,
     (VALUES (1,DATE '2026-05-22',520000.00,'1st Booking'),
         (2,DATE '2026-06-22',520000.00,'2nd Booking'),
         (3,DATE '2026-07-22',520000.00,'3rd Booking'),
         (4,DATE '2026-08-22',70000.00,'Installment No.1'),
         (5,DATE '2026-09-22',70000.00,'Installment No.2'),
         (6,DATE '2026-10-22',70000.00,'Installment No.3'),
         (7,DATE '2026-11-22',70000.00,'Installment No.4'),
         (8,DATE '2026-12-22',70000.00,'Installment No.5'),
         (9,DATE '2027-01-22',70000.00,'Installment No.6'),
         (10,DATE '2027-02-22',70000.00,'Installment No.7'),
         (11,DATE '2027-03-22',70000.00,'Installment No.8'),
         (12,DATE '2027-04-22',70000.00,'Installment No.9'),
         (13,DATE '2027-05-22',70000.00,'Installment No.10'),
         (14,DATE '2027-06-22',70000.00,'Installment No.11'),
         (15,DATE '2027-07-22',350000.00,'Annual No.1 Inst No.12'),
         (16,DATE '2027-08-22',70000.00,'Installment No.13'),
         (17,DATE '2027-09-22',70000.00,'Installment No.14'),
         (18,DATE '2027-10-22',70000.00,'Installment No.15'),
         (19,DATE '2027-11-22',70000.00,'Installment No.16'),
         (20,DATE '2027-12-22',70000.00,'Installment No.17'),
         (21,DATE '2028-01-22',70000.00,'Installment No.18'),
         (22,DATE '2028-02-22',70000.00,'Installment No.19'),
         (23,DATE '2028-03-22',70000.00,'Installment No.20'),
         (24,DATE '2028-04-22',70000.00,'Installment No.21'),
         (25,DATE '2028-05-22',70000.00,'Installment No.22'),
         (26,DATE '2028-06-22',70000.00,'Installment No.23'),
         (27,DATE '2028-07-22',350000.00,'Annual No.2 Inst No.24'),
         (28,DATE '2028-08-22',70000.00,'Installment No.25'),
         (29,DATE '2028-09-22',70000.00,'Installment No.26'),
         (30,DATE '2028-10-22',70000.00,'Installment No.27'),
         (31,DATE '2028-11-22',70000.00,'Installment No.28'),
         (32,DATE '2028-12-22',70000.00,'Installment No.29'),
         (33,DATE '2029-01-22',70000.00,'Installment No.30'),
         (34,DATE '2029-02-22',70000.00,'Installment No.31'),
         (35,DATE '2029-03-22',70000.00,'Installment No.32'),
         (36,DATE '2029-04-22',70000.00,'Installment No.33'),
         (37,DATE '2029-05-22',70000.00,'Installment No.34'),
         (38,DATE '2029-06-22',70000.00,'Installment No.35'),
         (39,DATE '2029-07-22',350000.00,'Annual No.3 Inst No.36'),
         (40,DATE '2029-08-22',70000.00,'Installment No.37'),
         (41,DATE '2029-09-22',264600.00,'Final Payment')) AS v(n,d,a,lbl)
WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='BKG-260'
ON CONFLICT (sale_id, installment_number) DO NOTHING;

-- 4. Flip the backfilled units Available -> Sold ---------------------------
UPDATE units SET status_id='5723bb68-d558-41c8-92e5-10a0eaf6682b'
WHERE project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND status_id='839b6149-d3ef-4c49-94be-c51e5d638b31'
  AND unit_no IN ('MF-30','MF-61','MF-62','6-01','2-14','MF-18','5-02','5-03','5-05','5-06','5-14','8-09','8-15','10-18','11-15','GF-43','LG-21','LG-24','LG-37B','MF-19','12-09');

-- 5. VERIFY — any failure aborts the whole transaction ---------------------
DO $$
DECLARE
  v_sales int; v_inst int; v_total numeric; v_bad int; v_pay int; v_avail int;
BEGIN
  SELECT count(*), COALESCE(sum(net_amount),0) INTO v_sales, v_total
    FROM sales WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND sale_number IN ('BKG-184','BKG-134','BKG-135','BKG-146','BKG-142','BKG-138','BKG-237','BKG-238','BKG-239','BKG-240','BKG-241','BKG-42','BKG-117','BKG-88','BKG-197','BKG-177','BKG-167','BKG-74','BKG-69','BKG-157','BKG-260');
  IF v_sales <> 21 THEN RAISE EXCEPTION 'a) sales=% expected 21', v_sales; END IF;
  IF v_total <> 142977488 THEN RAISE EXCEPTION 'b) net total=% expected 142977488', v_total; END IF;

  SELECT count(*) INTO v_inst FROM installments i JOIN sales s ON s.id=i.sale_id
    WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number IN ('BKG-184','BKG-134','BKG-135','BKG-146','BKG-142','BKG-138','BKG-237','BKG-238','BKG-239','BKG-240','BKG-241','BKG-42','BKG-117','BKG-88','BKG-197','BKG-177','BKG-167','BKG-74','BKG-69','BKG-157','BKG-260');
  IF v_inst <> 803 THEN RAISE EXCEPTION 'c) installments=% expected 803', v_inst; END IF;

  -- every sale's schedule must sum to its own net_amount
  SELECT count(*) INTO v_bad FROM (
    SELECT s.id FROM sales s JOIN installments i ON i.sale_id=s.id
    WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number IN ('BKG-184','BKG-134','BKG-135','BKG-146','BKG-142','BKG-138','BKG-237','BKG-238','BKG-239','BKG-240','BKG-241','BKG-42','BKG-117','BKG-88','BKG-197','BKG-177','BKG-167','BKG-74','BKG-69','BKG-157','BKG-260')
    GROUP BY s.id, s.net_amount HAVING sum(i.amount_due) <> s.net_amount) x;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'd) % sale(s) whose schedule != net_amount', v_bad; END IF;

  -- HARD RULE: nothing received
  SELECT count(*) INTO v_pay FROM payments p JOIN sales s ON s.id=p.sale_id
    WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number IN ('BKG-184','BKG-134','BKG-135','BKG-146','BKG-142','BKG-138','BKG-237','BKG-238','BKG-239','BKG-240','BKG-241','BKG-42','BKG-117','BKG-88','BKG-197','BKG-177','BKG-167','BKG-74','BKG-69','BKG-157','BKG-260');
  IF v_pay <> 0 THEN RAISE EXCEPTION 'e) % payment row(s) created - must be 0', v_pay; END IF;

  SELECT count(*) INTO v_bad FROM installments i JOIN sales s ON s.id=i.sale_id
    WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number IN ('BKG-184','BKG-134','BKG-135','BKG-146','BKG-142','BKG-138','BKG-237','BKG-238','BKG-239','BKG-240','BKG-241','BKG-42','BKG-117','BKG-88','BKG-197','BKG-177','BKG-167','BKG-74','BKG-69','BKG-157','BKG-260')
      AND (i.amount_paid <> 0 OR i.status <> 'pending');
  IF v_bad <> 0 THEN RAISE EXCEPTION 'f) % installment(s) marked paid - must be 0', v_bad; END IF;

  -- no unit left Available, no negative discount, no double-sold unit
  SELECT count(*) INTO v_avail FROM units
    WHERE project_id='ce05f4bb-a527-4e2b-b529-970c76c8d855' AND unit_no IN ('MF-30','MF-61','MF-62','6-01','2-14','MF-18','5-02','5-03','5-05','5-06','5-14','8-09','8-15','10-18','11-15','GF-43','LG-21','LG-24','LG-37B','MF-19','12-09') AND status_id='839b6149-d3ef-4c49-94be-c51e5d638b31';
  IF v_avail <> 0 THEN RAISE EXCEPTION 'g) % unit(s) still Available', v_avail; END IF;

  SELECT count(*) INTO v_bad FROM sales
    WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND sale_number IN ('BKG-184','BKG-134','BKG-135','BKG-146','BKG-142','BKG-138','BKG-237','BKG-238','BKG-239','BKG-240','BKG-241','BKG-42','BKG-117','BKG-88','BKG-197','BKG-177','BKG-167','BKG-74','BKG-69','BKG-157','BKG-260') AND discount < 0;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'h) % sale(s) with negative discount', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM (
    SELECT unit_id FROM sales WHERE company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND status <> 'cancelled'
    GROUP BY unit_id HAVING count(*) > 1) x;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'i) % double-sold unit(s)', v_bad; END IF;

  -- MF-57 rebuild must land on the booking record exactly
  SELECT count(*) INTO v_bad FROM installments i JOIN sales s ON s.id=i.sale_id
    WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='SAL-2026-0009';
  IF v_bad <> 41 THEN RAISE EXCEPTION 'j) MF-57 has % rows, expected 41', v_bad; END IF;

  SELECT COALESCE(sum(i.amount_due),0) INTO v_total FROM installments i JOIN sales s ON s.id=i.sale_id
    WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='SAL-2026-0009';
  IF v_total <> 10277200 THEN RAISE EXCEPTION 'k) MF-57 schedule=% expected 10277200', v_total; END IF;

  SELECT count(*) INTO v_bad FROM sales s
    WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='SAL-2026-0009'
      AND s.net_amount <> (SELECT sum(i.amount_due) FROM installments i WHERE i.sale_id=s.id);
  IF v_bad <> 0 THEN RAISE EXCEPTION 'l) MF-57 schedule != its own net_amount'; END IF;

  -- every MF-57 due date must fall on the 6th (booking-record day), and none may carry money
  SELECT count(*) INTO v_bad FROM installments i JOIN sales s ON s.id=i.sale_id
    WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='SAL-2026-0009'
      AND (EXTRACT(DAY FROM i.due_date) <> 6 OR i.amount_paid <> 0 OR i.status <> 'pending');
  IF v_bad <> 0 THEN RAISE EXCEPTION 'm) % MF-57 row(s) off the 6th or carrying money', v_bad; END IF;

  -- the three annual lumps must exist
  SELECT count(*) INTO v_bad FROM installments i JOIN sales s ON s.id=i.sale_id
    WHERE s.company_id='71d33e07-e55c-49af-8f5b-fdd7fd6e8612' AND s.sale_number='SAL-2026-0009' AND i.amount_due=400000;
  IF v_bad <> 3 THEN RAISE EXCEPTION 'n) MF-57 has % annual lump(s), expected 3', v_bad; END IF;

  RAISE NOTICE 'ALL CHECKS PASSED: % sales, % installments, net %', v_sales, v_inst, v_total;
END $$;

COMMIT;
