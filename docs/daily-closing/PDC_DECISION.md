# PDC — one register or two

Written in P2 to answer `RULES.md` (b) Q6. **No PDC data was seeded and no PDC table was
written to.** The final PDC work is Phase 3 (P16); this is the decision that has to be made
before it starts, because it decides whether a table created in P1 gets used or dropped.

---

## (a) What already exists, and how the module's needs land on it

`public.pdc_cheques` — live, audited, in daily use. **7 rows, one tenant, statuses actually
in use: `pending`, `cleared`, `bounced`.**

Around it: `js/pages/pdc.js`, the `pdc` feature flag in `nav()`'s `_PAGE_FLAG`, a `_trg_audit`
trigger, and **thirteen RPCs** — `create_pdc_cheque`, `create_pdc_bundle`, `update_pdc_cheque`,
`delete_pdc_cheque`, `get_pdc_register`, `get_pdc_analytics`, `list_pdc_for_sale`,
`mark_pdc_deposited`, `mark_pdc_cleared`, `mark_pdc_bounced`, `redeposit_pdc`,
`schedule_pdc_deposit_bulk`, `expire`-adjacent helpers.

| §A6 `pdc_register` wants | `pdc_cheques` has | Verdict |
|---|---|---|
| `id` | `id uuid` | ✅ |
| `project_id` | `project_id uuid` **nullable**, with `idx_pdc_cheques_project` | ⚠️ present but nullable |
| — | `company_id uuid NOT NULL` | ✅ better — §A6 omits the tenant everywhere |
| `kind` RECEIVABLE / PAYABLE | — | ❌ **missing** |
| `cheque_no` | `cheque_no text NOT NULL` | ✅ |
| `bank_name` | `bank_name text` | ✅ |
| `amount` | `amount numeric` | ⚠️ unscaled, not `numeric(18,2)` |
| `party_payee_id` → `payees` | `client_id`, `sale_id` | ❌ **missing** — see below |
| `unit_id` | `sale_id` → `sales` (unit reachable through it) | ✅ better — RMS keys money to the sale |
| `due_date` | `cheque_date date NOT NULL` | ✅ same thing, different name |
| `status` PENDING/CLEARED/BOUNCED | `status text`, **no CHECK**; code uses `pending`, `deposited`, `cleared`, `bounced`, `replaced` | ⚠️ superset, lowercase, unconstrained |
| `cleared_entry_id` → `cash_entries` | `payment_id` → `payments` | ❌ **missing** |
| `bounce_note` | `bounce_reason text` | ✅ same thing |
| `created_by`, `created_at` | both | ✅ |

And a set of columns `pdc_register` has no answer for, all of which encode real work the
office already does: `received_date`, `deposit_date`, `clearance_date`, `replaced_by_id`
(the replacement chain), `penalty_amount` / `penalty_collected` / `penalty_date` /
`penalty_notes` (the bounce penalty), `notes`, `updated_at`.

### The §A4 state machine against the live one

```
BLUEPRINT §A4            pdc_cheques (live)
PENDING ──Clear──▶ CLEARED      pending ──mark_pdc_deposited──▶ deposited
        ──Bounce─▶ BOUNCED              ──mark_pdc_cleared────▶ cleared   (creates a payment)
                                        ──mark_pdc_bounced────▶ bounced   (raises a follow-up)
                                        ──replace─────────────▶ replaced  (replaced_by_id)
```

The live machine is a **superset**, and the extra states are not noise: `deposited` is the
window between handing a cheque to the bank and hearing back, which is exactly when somebody
asks where it is. Note that only `pending`, `cleared` and `bounced` appear on live rows —
`deposited` and `replaced` are reachable in code and unused so far.

The one real behavioural gap is what "Clear" produces. §A4 says clearing **creates a BANK/IN
or BANK/OUT cash entry, linked**. `mark_pdc_cleared` creates a **`payments` row** — the RMS
side — and knows nothing about the cash book. Both need to happen, and they need to be the
same act, in one transaction, or a cleared cheque shows up in the client ledger and not in
the day's closing.

---

## (b) Exactly what is missing

Four things, and only four:

1. **`kind`** — `text NOT NULL DEFAULT 'RECEIVABLE' CHECK (kind IN ('RECEIVABLE','PAYABLE'))`.
   `pdc_cheques` is receivable-only by construction: it hangs off `sale_id` and `client_id`.
   A cheque the company *writes* — to a contractor, a dealer, PESCO — has nowhere to live.
2. **`party_payee_id`** — `uuid REFERENCES payees(id)`. Follows from (1): the counterparty on
   a PAYABLE cheque is a vendor, and a vendor is a payee, not a client. `client_id` stays for
   receivables; the two are not interchangeable and both should be nullable with a CHECK that
   one of them is present.
3. **`cleared_entry_id`** — `uuid REFERENCES cash_entries(id)`, plus
   `CHECK ((status='cleared') = (cleared_entry_id IS NOT NULL))` **once the cash book is the
   system of record**. Not before: seven live rows already carry `cleared` with no cash entry
   behind them, and the constraint would reject them.
4. **A status lifecycle that is actually constrained.** Today `status` is free text with no
   CHECK, which is how a typo becomes a fifth state. It should become
   `CHECK (status IN ('pending','deposited','cleared','bounced','replaced'))` — the live
   lowercase vocabulary kept as-is, not renamed to §A6's uppercase. Renaming would rewrite
   thirteen RPCs and a page to gain nothing.

**Project scoping is *not* missing** — `project_id` and its index exist. It is *nullable*,
and one of the seven live rows is NULL, so invariant 8's `NOT NULL` needs that row given a
project first. One row, one tenant: a five-minute job, not a migration risk.

`amount` being unscaled `numeric` rather than `numeric(18,2)` is the same story — worth
tightening when Phase 3 touches the table, cheap at seven rows.

---

## (c) Recommendation

### Extend `pdc_cheques`. Drop `pdc_register`.

`pdc_register` was created in P1 only because the P1 brief named its index in the required
list. It is empty, nothing references it, and nothing ever should. Dropping it now costs one
line; dropping it after Phase 3 has written to it costs a data migration.

Four reasons, in order of weight:

1. **Two registers for one drawer of cheques is a reconciliation problem, not a design.**
   The question "which cheques are outstanding" would have two answers that drift the first
   time somebody records a cheque in the wrong one. This is precisely the class of problem
   invariants 4 and 7 exist to prevent, and it would be self-inflicted.
2. **The live table is richer where it matters.** Deposit scheduling, the bounce penalty, the
   replacement chain, `list_pdc_for_sale` — all of it is workflow the office already relies
   on and none of it is in §A6. Building `pdc_register` means reimplementing it or losing it.
3. **The gap is four columns.** Against thirteen working RPCs, a page, a feature flag and an
   audit trigger, that is a small extension of something proven versus a large duplication of
   something unproven.
4. **`mark_pdc_cleared` is most of the way there already.** It clears the cheque and creates
   the money row in one transaction. Phase 3 adds a second leg — the cash entry — inside that
   same transaction and stores the link. That is an amendment to one function, not a new
   subsystem.

### What Phase 3 (P16) would then do

- `ALTER TABLE pdc_cheques` — add `kind`, `party_payee_id`, `cleared_entry_id`; add the
  `status` CHECK; backfill the one NULL `project_id` and set it `NOT NULL`; tighten `amount`.
- Amend `mark_pdc_cleared` to create the linked `BANK/IN` (or `BANK/OUT`) cash entry in the
  same transaction and store `cleared_entry_id`.
- Amend `mark_pdc_bounced` to flag the client and, for a PAYABLE, leave the cash book alone.
- Point S6 (§A12) at `get_pdc_register`, which already takes a project and a date window.
- `DROP TABLE public.pdc_register;` — and remove it from `20260903r`, `SCHEMA.md` and the
  `deny_all_anon` lockdown loop in the same commit.

### If the recommendation is rejected

Then `pdc_register` needs `company_id NOT NULL`, `sale_id`, the deposit and penalty columns,
and its own RPCs and page — and `pdc_cheques` needs a documented rule saying which cheques
belong in which register, enforced somewhere, or the two will drift within a month.

---

**Decision needed from the owner before P16.** Nothing in P2 or P3 depends on it; this is
recorded now because P1 created a table on a brief's say-so, and a table that may be dropped
should not be discovered by whoever writes P16.
