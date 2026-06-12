# Nexunova RMS — Field Census & Owner Decision List
**Read-only audit · 2026-06-12 · zero code/DB changes.**

Purpose: surface every field the lean overhaul may have hidden or dropped, so the owner doesn't have to remember anything.

**Legend**
- **EXPOSED** — editable/visible in the current UI (location noted).
- **HIDDEN** — column preserved in DB, **no current UI** (data safe, just not shown/editable).
- **WRITE-ONLY** — set by the system / an event flow (cancellation, transfer, recovery engine, timestamps); not a manual field.
- **DEAD** — no writer in code **and** 0 stored values; legacy/superseded.
- **∅** — 0 non-null values in live data (FG: 166 clients / 233 sales / 282 units / 1 775 payments / 6 461 installments; PDC 7 & contact_logs 1 are ZZTEST test rows). **Empty ≠ dropped** — the schema keeps every column; ∅ just means nobody has filled it yet.

---

## A. DATA CENSUS (live schema, all 9 tables)

### clients (55 cols · 166 rows)
| Column | Class | Where / note |
|---|---|---|
| id, company_id, project_id | WRITE-ONLY | keys (project locked in form) |
| client_code | EXPOSED | shown (auto-generated) |
| full_name, father_name, cnic, phone_primary | EXPOSED | ClientForm identity block |
| overseas_local, passport_no ∅ | EXPOSED | ClientForm overseas toggle |
| client_photo_url ∅ | EXPOSED | ClientForm photo (punch #2) |
| next_of_kin_name/relation/phone ∅ | EXPOSED | ClientForm "Nominee" (punch #1) |
| email, address, city, whatsapp ∅, client_category, reference_by, notes, status | EXPOSED | ClientForm → More details |
| country | WRITE-ONLY | defaulted "Pakistan"; not user-editable |
| **phone_secondary ∅** | **HIDDEN** | legacy `cf-phone2` dropped in 3E |
| **occupation ∅** | **HIDDEN** | legacy field, no UI |
| **company_name ∅** | **HIDDEN** | employer; legacy field, no UI |
| **lead_source ∅** | **HIDDEN** | legacy field, no UI |
| **bank_name / bank_account_title / bank_account_no / bank_iban ∅** | **HIDDEN** | legacy bank block dropped in 3E |
| **cnic_front_url / cnic_back_url ∅** | **HIDDEN** | legacy CNIC-scan uploads dropped in 3E |
| metadata | WRITE-ONLY | jsonb system bag |
| has_cancellation_history, is_defaulter, is_blacklisted, flag_notes | WRITE-ONLY | flags set by cancellation/blacklist flows |
| recovery_status, escalation_level, total_contacts_count, comms_opt_out | WRITE-ONLY | recovery engine |
| recovery_status_updated_at/by ∅, last_contact_date ∅ | WRITE-ONLY | recovery engine (not yet triggered) |
| dnd_status, dnd_reason ∅, dnd_set_by ∅, dnd_set_date ∅, dnd_until ∅, dnd_review_date ∅, dnd_director_note ∅ | WRITE-ONLY/HIDDEN | "Do-Not-Disturb" feature — **no live UI surfacing it, unused** |
| created_by, created_at, updated_at | WRITE-ONLY | audit |

### sales (54 cols · 233 rows)
| Column | Class | Where / note |
|---|---|---|
| id, company_id, project_id, sale_number, unit_id, client_id | WRITE-ONLY | keys (sale_number auto) |
| price_per_sqft, area_sqft, discount, down_payment, sale_date, installment_count | EXPOSED | New Sale 5-step |
| agent_id ∅, commission_rate | EXPOSED | New Sale (agent + comm) — agent_id ∅: KBH import set no agents |
| total_amount, net_amount, remaining_amount | WRITE-ONLY | **generated** columns (price·area − discount − down) |
| notes | EXPOSED | Edit Sale only |
| **co_buyer_name / co_buyer_cnic / co_buyer_share_pct ∅** | **EXPOSED (Edit Sale only)** | joint buyer — in `saveSale` sf- form, **NOT in New Sale booking flow** |
| **nominee_name / nominee_cnic / nominee_relation ∅** | **EXPOSED (Edit Sale only)** | sale-level nominee — Edit Sale only, not New Sale |
| **wht_amount / cvt_amount** (dflt 0) | **EXPOSED (Edit Sale only)** | FBR WHT/CVT — Edit Sale only, not New Sale |
| **sale_type_id ∅, discount_approved_by ∅, discount_notes ∅** | **EXPOSED (Edit Sale only)** | Edit Sale only |
| payment_plan_type, discount_amount, discount_percentage | WRITE-ONLY | plan engine |
| status, is_active, sale_type_id | WRITE-ONLY | lifecycle |
| cancellation_reason/date/id ∅, cancelled_by ∅, closed_at ∅, closure_reason ∅ | WRITE-ONLY | Cancellation flow (none in data) |
| is_transfer, transferred_from_sale_id ∅, is_resale, resale_of_cancellation_id ∅ | WRITE-ONLY | Transfer / Re-sale ops |
| delivery_breach, breach_months ∅, breach_reason_type/detail ∅, breach_approved_by/ref/at ∅ | WRITE-ONLY | delivery-breach module |
| created_by, created_at, updated_at | WRITE-ONLY | audit |

### units (35 cols · 282 rows)
| Column | Class | Where / note |
|---|---|---|
| id, company_id, project_id, unit_no, unit_code | EXPOSED | Units form (code auto) |
| unit_type_id, floor_id, floor_label, floor_no | EXPOSED | Units form (floor/type) |
| area, area_unit, base_price, parking_count, block ∅, facing ∅, notes ∅ | EXPOSED | Units form |
| bedrooms ∅, bathrooms ∅ | EXPOSED | Units form (∅ — commercial stock, unused) |
| is_premium, is_corner | EXPOSED | Units form (all default false) |
| **carpet_area ∅** | **HIDDEN** | legacy unit field, dropped in 3C |
| **maintenance_monthly ∅** | **HIDDEN** | monthly maintenance — dropped in 3C |
| **possession_date ∅** | **HIDDEN** | unit possession date — dropped in 3C |
| **handover_status ∅** | **HIDDEN** | dropped in 3C (possession module covers handover) |
| status_id | WRITE-ONLY | availability lifecycle |
| features, image_urls, document_urls | HIDDEN | jsonb media — no current UI |
| origin_type, last_event_at ∅, last_cancellation_id ∅ | WRITE-ONLY | ops lifecycle |
| **transfer_history ∅** | **DEAD** | legacy text; superseded by ownership-chain table |
| created_by ∅, created_at, updated_at | WRITE-ONLY | audit |

### installments (16 cols · 6 461 rows)
| Column | Class | Where / note |
|---|---|---|
| id, company_id, project_id, sale_id | WRITE-ONLY | keys |
| installment_number, due_date, amount_due, installment_type, notes | EXPOSED | New Sale plan / schedule |
| amount_paid, status | WRITE-ONLY | maintained by record_payment_simple (FIFO) |
| outstanding | WRITE-ONLY | **generated** (amount_due − amount_paid) |
| **paid_at ∅, related_payment_id ∅** | **DEAD** | never populated; FIFO model uses payments, not per-line links |
| created_at, updated_at | WRITE-ONLY | audit |

### payments (32 cols · 1 775 rows)
| Column | Class | Where / note |
|---|---|---|
| id, company_id, project_id, payment_code, voucher_code, sale_id, client_id | WRITE-ONLY | keys/codes (auto) |
| amount, payment_date, payment_method, reference_no, bank_name, notes, cheque_date | EXPOSED | Record Payment (3F) |
| created_by, status | WRITE-ONLY | attribution + lifecycle |
| **installment_id ∅** | **WRITE-ONLY (NULL by design)** | one-aging-law: FIFO at read (register #14) |
| penalty_amount, tax_amount, tax_type ∅, payment_category | EXPOSED (Edit Payment) | not in the lean Record-Payment flow |
| **bank_id ∅, deposit_date ∅, deposit_confirmed** | **HIDDEN** | bank-deposit reconciliation — no current UI |
| **adjustment_note ∅, adjustment_type ∅** | **HIDDEN** | "adjustment" mode meta — no UI surfacing it |
| **payment_type_id ∅, receipt_url ∅, proof_url ∅, refund_amount ∅** | **DEAD/HIDDEN** | proof_url/receipt_url legacy upload; refund via refund flow |
| created_at, updated_at | WRITE-ONLY | audit |

### pdc_cheques (24 cols · 7 rows, all ZZTEST)
| Column | Class | Where / note |
|---|---|---|
| id, company_id, project_id, sale_id, client_id, payment_id | WRITE-ONLY | keys (payment_id set on clear) |
| cheque_no, bank_name, amount, cheque_date, received_date, notes | EXPOSED | PDC bundle / entry (3F) |
| status, deposit_date, clearance_date, bounce_date, bounce_reason | WRITE-ONLY | PDC transitions (3F) |
| **penalty_amount, penalty_collected, penalty_date ∅, penalty_notes ∅** | **HIDDEN** | bounce-penalty tracking — no current UI |
| created_by, created_at, updated_at | WRITE-ONLY | audit |

### contact_logs (32 cols · 1 row, ZZTEST)
| Column | Class | Where / note |
|---|---|---|
| id, company_id, project_id, unit_id, client_id, sale_id | WRITE-ONLY | keys |
| contact_date, contact_time, channel, direction, agent_id, response_received, remarks, internal_notes, promise_to_pay, promise_amount, promise_date, next_followup_date, next_followup_channel, status_tag, escalation_flag, attachments | EXPOSED | Log-Call modal |
| created_by, created_at | WRITE-ONLY | audit |
| **call_status ∅, response_type ∅, phone_used ∅, duration_minutes ∅, next_action ∅, reminder_channels, recovery_agent_id ∅, client_name ∅** | **DEAD/HIDDEN** | legacy duplicate columns; modal uses channel/response_received/remarks instead |

### floors (6 cols) / category_unit_types (10 cols · 13 rows)
| Column | Class | Where / note |
|---|---|---|
| floors: id, company_id, name, sort_order, is_active, created_at | EXPOSED | Units setup (floor manager) |
| cat_unit_types: id, company_id, project_id, type_code, type_name, sort_order, is_active, created_at, updated_at | EXPOSED | Categories / unit-type setup |
| **cat_unit_types: description ∅** | **HIDDEN** | optional type description — no UI |

---

## B. LEGACY FORM CENSUS (pre-overhaul → now)

### B1. Old client modal (pre-3E, ~30 fields) → ClientForm (3E + punches)
| Legacy field | Now |
|---|---|
| name, father, cnic, phone, email, address, city, category, reference, notes, status | **kept** |
| overseas-local, passport | **kept** |
| kin-name, kin-relation, kin-phone | **kept** (restored — punch #1, was hidden 3E→) |
| photo (file/url) | **kept** (restored — punch #2) |
| whatsapp | moved to **More** |
| **phone2 (secondary)** | **hidden-preserved** |
| **country** | **hidden** (defaulted) |
| **occupation** | **hidden-preserved** |
| **company (employer)** | **hidden-preserved** |
| **lead-source** | **hidden-preserved** |
| **bank-name / bank-title / bank-acctno / bank-iban** | **hidden-preserved** |
| **cnic-front / cnic-back (scans)** | **hidden-preserved** |

_No client field dropped with data loss — `update_client` updates only managed keys; hidden columns are untouched on edit._

### B2. Old new-sale form (pre-3D, ~30 fields) → New Sale 5-step (3D)
| Legacy field | Now |
|---|---|
| unit, client, agent, comm-pct, date, price-sqft, area, discount, down, notes, installments plan | **kept** (New Sale 5-step) |
| **cobuyer-name / cobuyer-cnic / cobuyer-share** | **moved to secondary** — Edit Sale form only, **NOT in New Sale booking** |
| **nominee-name / nominee-cnic / nominee-relation** (sale-level) | **moved to secondary** — Edit Sale only |
| **wht (WHT) / cvt (CVT)** | **moved to secondary** — Edit Sale only |
| **sale-type, disc-approved-by, disc-notes** | **moved to secondary** — Edit Sale only |

_⚠️ Not data-loss (Edit Sale `saveSale` still writes them), but a buyer booked via New Sale has **no way to capture co-buyer / nominee / WHT / CVT at booking time** — must edit the sale afterward._

### B3. Old unit modal (pre-3C, ~22 fields) → Units rebuild (3C)
| Legacy field | Now |
|---|---|
| unit_no, unit_code, type, floor, area, area_unit, base_price, parking, block, facing, notes, bedrooms, bathrooms, is_premium, is_corner | **kept** |
| **carpet_area** | **hidden-preserved** |
| **maintenance_monthly** | **hidden-preserved** |
| **possession_date** (unit) | **hidden-preserved** |
| **handover_status** | **hidden-preserved** |

### B4. Old payment form (pre-3F) → Record Payment (3F)
| Legacy field | Now |
|---|---|
| amount, date, method, reference, bank, notes, cheque date | **kept** (lean Record Payment) |
| **penalty_amount, tax (WHT) amount/type, payment_category** | **moved to secondary** — Edit Payment only, not the new flow |
| **bank_id (deposit bank), deposit_date/confirmed** | **hidden-preserved** |
| **adjustment_note / adjustment_type** | **hidden-preserved** |
| explicit per-installment allocation (custom-alloc) | **removed by design** — FIFO at read (register #14) |

_No payment field dropped with data loss; all columns preserved._

---

## C. DOMAIN CHECKLIST (PK/Gulf real-estate booking package)

| Domain item | Status | Where / gap |
|---|---|---|
| Client photo | **supported** | ClientForm + profile (punch #2) |
| Nominee — name / relation | **supported** | client next_of_kin (punch #1) + sale-level (Edit Sale) |
| Nominee — CNIC | **partial** | sales.nominee_cnic (Edit Sale) ✓; **client next_of_kin has NO cnic col → #19** |
| Nominee — photo | **absent** | no column → **#20** |
| Co-applicant / joint buyers | **partial** | single co-buyer (name/cnic/share) on sale, **Edit Sale only**; no multi-buyer table |
| Guardian for minor buyers | **absent** | no guardian columns anywhere → schema |
| Witness name + CNIC (agreement) | **absent** | no witness columns → schema |
| Permanent vs mailing address | **absent** | clients has **one** address only |
| Occupation / employer | **partial** | columns exist (occupation, company_name) but **hidden — no UI** |
| Overseas client (passport, foreign address) | **partial** | passport + overseas toggle ✓; **no dedicated foreign address** (single address field) |
| Dealer / agent + commission on sale | **supported** | sales.agent_id + commission_rate (New Sale) |
| Payment-plan surcharges / rebates | **absent** | installments carry amount_due only; no surcharge/rebate field |
| Possession charges | **absent** | no possession-charges column (possession installment-type exists, but no distinct charge) |
| Transfer fee | **partial** | captured in the Transfer flow (transfer RPC), not a sales column |
| Utility / extra charges | **absent** | no column |
| Cancellation deduction terms | **partial** | handled in Cancellation flow (sales.cancellation_*), not a booking field |
| Token / bayana stage before booking | **absent** | booking starts at down-payment; no pre-booking token entity |

---

## OWNER DECISION LIST  (tick yes/no — does the product need a UI home for this?)

### Hidden client fields (data-safe, just no form field)
| # | Item | Need it back? |
|---|---|---|
| 1 | Secondary phone | ☐ Yes ☐ No |
| 2 | WhatsApp (already in More — keep?) | ☐ Yes ☐ No |
| 3 | Occupation | ☐ Yes ☐ No |
| 4 | Employer / company name | ☐ Yes ☐ No |
| 5 | Lead source | ☐ Yes ☐ No |
| 6 | Bank details (name/title/acct/IBAN) | ☐ Yes ☐ No |
| 7 | CNIC front/back scan uploads | ☐ Yes ☐ No |
| 8 | Do-Not-Disturb (DND) feature | ☐ Yes ☐ No |

### Sale fields not in the New-Sale booking flow (Edit-Sale only)
| # | Item | Add to booking flow? |
|---|---|---|
| 9 | Co-buyer / joint buyer (name/CNIC/share) | ☐ Yes ☐ No |
| 10 | Sale-level nominee (name/CNIC/relation) | ☐ Yes ☐ No |
| 11 | WHT amount | ☐ Yes ☐ No |
| 12 | CVT amount | ☐ Yes ☐ No |
| 13 | Sale type / discount approver + notes | ☐ Yes ☐ No |

### Hidden unit fields
| # | Item | Need it back? |
|---|---|---|
| 14 | Carpet area | ☐ Yes ☐ No |
| 15 | Monthly maintenance | ☐ Yes ☐ No |
| 16 | Unit possession date | ☐ Yes ☐ No |
| 17 | Handover status | ☐ Yes ☐ No |
| 18 | Unit images / documents (jsonb) | ☐ Yes ☐ No |

### Hidden payment / PDC fields
| # | Item | Need it back? |
|---|---|---|
| 19 | Penalty amount on payment | ☐ Yes ☐ No |
| 20 | Tax (WHT) on payment | ☐ Yes ☐ No |
| 21 | Deposit bank + deposit-confirmed reconciliation | ☐ Yes ☐ No |
| 22 | Adjustment mode (note/type) | ☐ Yes ☐ No |
| 23 | PDC bounce-penalty tracking | ☐ Yes ☐ No |

### Absent — would need a schema migration
| # | Item | Build it? |
|---|---|---|
| 24 | Client nominee CNIC (#19) | ☐ Yes ☐ No |
| 25 | Client nominee photo (#20) | ☐ Yes ☐ No |
| 26 | Multiple joint buyers (table, not single co-buyer) | ☐ Yes ☐ No |
| 27 | Guardian for minor buyers | ☐ Yes ☐ No |
| 28 | Witness (name + CNIC) for agreement | ☐ Yes ☐ No |
| 29 | Permanent vs mailing address (2nd address) | ☐ Yes ☐ No |
| 30 | Foreign address for overseas clients | ☐ Yes ☐ No |
| 31 | Payment-plan surcharges / rebates | ☐ Yes ☐ No |
| 32 | Possession charges (distinct line) | ☐ Yes ☐ No |
| 33 | Utility / extra charges | ☐ Yes ☐ No |
| 34 | Token / bayana stage before booking | ☐ Yes ☐ No |

### Confirm-safe-to-retire (DEAD — 0 data, no writer)
| # | Item | Drop it? |
|---|---|---|
| 35 | units.transfer_history (superseded by ownership-chain) | ☐ Yes ☐ No |
| 36 | installments.paid_at / related_payment_id | ☐ Yes ☐ No |
| 37 | contact_logs legacy dup cols (call_status, response_type, phone_used, duration_minutes, next_action, recovery_agent_id, client_name) | ☐ Yes ☐ No |
| 38 | payments.payment_type_id / receipt_url / proof_url | ☐ Yes ☐ No |
