# Finding 2026-09-05-E — "Bank Received" reads PKR 0 on every cancellation and every transfer

| | |
|---|---|
| **Found** | 2026-09-05, reconciling KBH August 2026 collections against QuickBooks |
| **Written up** | 2026-09-05 |
| **Status** | **FIXED 2026-09-05 — the bank filter only.** Exposure measured in §3b before fixing: no money decision was ever recorded through either panel. §4.2 and §4.4 remain open; so does the question in §3b. |
| **Scope** | `js/pages/cancellation.js:304`, `js/pages/transfers.js:415`. **Every tenant, every sale.** |
| **Severity** | Correctness of a figure shown at the moment a director approves a cancellation or a transfer. |

The money is safe — no refund arithmetic reads these numbers. What is wrong is the breakdown a
director is looking at while deciding.

---

## 1 · What breaks

`js/pages/cancellation.js:303-305` (and the identical block at `js/pages/transfers.js:414-416`):

```js
const cashPaid = pmts.filter(p => p.payment_method === 'cash'  && p.payment_category !== 'adjustment')…
const bankPaid = pmts.filter(p => p.payment_method === 'bank'  && p.payment_category !== 'adjustment')…
const adjPaid  = pmts.filter(p => p.payment_category === 'adjustment')…
```

Two literals in there match nothing that exists.

**`payment_method === 'bank'`.** The column has never held that value. Across the whole database:

| `payment_method` | rows |
|---|---|
| `cash` | 2,111 |
| `bank_transfer` | 866 |
| `adjustment` | 203 |
| `cheque` | 78 |
| `other` | 19 |

`list_payments_for_sale` passes the column through untouched — the RPC builds
`'payment_method', p.payment_method` with no mapping — so `bankPaid` evaluates to **0 for every
sale in every tenant**, and has since the line was written.

**`payment_category === 'adjustment'`.** `payment_category` is `'regular'` on all **3,277** rows in
the table. There is no other value, and no null. So `adjPaid` is always 0 as well, the
`!== 'adjustment'` guard on the other two filters is a no-op, and the conditional `Adjustment` row
at `cancellation.js:351` never renders. The adjustment signal does not live in that column at all —
it lives in `payment_method = 'adjustment'`, 203 rows of it.

Net effect on the panel: `cheque`, `bank_transfer`, `adjustment` and `other` payments — 1,166 of
3,277 rows — fall into **no** bucket. They are counted in neither Cash nor Bank nor Adjustment.

---

## 2 · What the user actually sees

`totalPaid` is computed separately, from installments (`cancellation.js:294-296`), so it is right.
The breakdown underneath it is not, and the two are shown together:

> Total Paid **PKR 7,000,000**
> Cash Received **PKR 200,000**
> Bank Received **PKR 0**

That is unit 3-18 in KBH as the cancellation screen would draw it today. The real split is
6,800,000 bank and 200,000 cash. A director reading that panel would conclude the buyer paid
almost nothing through the bank.

There is no error and nothing looks broken — the numbers are formatted, aligned and confidently
wrong. It is only visible if you notice that Cash + Bank does not reach Total Paid.

---

## 3 · Who is affected

Every user who opens the cancellation review or the transfer review on any sale, on any tenant —
KBH, FMH, Fourteen Group, Awami. It is worst for KBH, where bank transfers are the majority of
collected value on the larger units. Both are director-level actions. **How many times that has
actually happened, and what was decided on it, is measured below.**

---

## 3b · How much was decided on it — measured, 2026-09-05

The question that decides whether this is a quiet fix or a different conversation: **were any
approvals made against a panel reading Bank 0?** Measured against the live database.

### Transfers — zero exposure

`unit_transfers` holds **two rows in total, both on ZZTEST.** The transfer module has never been
used on KBH, FMH, Fourteen Group or Awami. `transfers.js:415` has never shown a wrong figure to
anyone outside the test tenant.

### Cancellations — the panel was seen 21 times, but nothing financial was decided on it

`unit_cancellations` holds 24 rows: 3 on ZZTEST, **21 on live tenants** — 17 KBH (Fourteen Group)
and 4 FMH. They were entered through the UI, not imported: consecutive rows are 25–80 seconds
apart with a reason category chosen for each. So the panel was drawn 21 times in front of a real
user.

**But every financial field on all 21 is zero or null:**

| Field | Value on all 21 live rows |
|---|---|
| `total_paid` | `0` |
| `cancellation_charges`, `booking_forfeiture`, `processing_fee`, `late_payment_penalty`, `other_deductions`, `total_deductions` | `0` |
| `net_refund_amount` | `0` |
| `agent_commission_total`, `commission_recovery_amount` | `0` |
| `commission_action` | `no_clawback` |
| `refund_method`, `refund_payment_mode` | `NULL` |
| `refund_status` | `pending` |

No deduction was computed, no refund amount was set, no refund method was chosen, and no refund
has been marked executed. **The module recorded the cancellation event and nothing else.** Its
financial half has never been used on a live tenant.

### Where it would have bitten, if it had been

Five of the 21 had real bank money that the panel would have shown as PKR 0:

| Unit | Tenant | Real cash | Real bank |
|---|---|---|---|
| 7-08 | KBH | 180,000 | **2,230,000** |
| 3-02 | KBH | 250,000 | **1,650,000** |
| 6-08 | KBH | 1,950,000 | 400,000 |
| 1-10 | KBH | 1,900,000 | 300,000 |
| 7-12 | KBH | 750,000 | 90,000 |

Eight more had adjustment money invisible the same way (`adjPaid` is dead — §1), the largest
being UG-01 at 4,000,000 and UG-20 and 1-04 at 3,000,000 each. On those eight the panel showed
Cash and Bank both at or near zero against sales that were substantially paid.

One cancellation mentions a refund at all, and only in free text: FMH **11-19**, notes reading
"Company cancel the unit and Refund the Amount to Client by Online." No amount, no method field,
`refund_status` still `pending`. That unit's real split is 100,000 cash and **zero bank** — so
even the single case where money moved is one where the panel happened to be right.

### Verdict

**Quiet fix.** No approval on any live tenant was taken against a wrong split, because no
approval involving money was taken through these panels at all. Nothing needs revisiting and no
past decision is in question.

Two things follow, and both are worth more than the fix:

1. **The finding upgrades rather than downgrades.** "Nobody was misled" is true only because
   nobody has used the module's financial half yet. The defect is still live and the first
   cancellation that computes a real refund would be the first one misled.
2. **A separate question this opened:** the cancellation module writes `total_paid = 0` and
   `net_refund_amount = 0` on every live row while the sale plainly has payments against it.
   Whether that is a second defect or simply an unused workflow is **not established here** and
   is not part of this finding.

---

## 4 · What the correct behaviour would be

1. **Match the values that exist.** Bank should be the set the rest of the codebase already uses —
   `js/pages/search.js:1154` gets this right: `['bank_transfer','bank','cheque','online']`.
   Whatever the fix, cancellation, transfers and search must use **one** shared predicate, not a
   third hand-written list.
2. **Take adjustments from `payment_method`, not `payment_category`.** 203 rows are
   `payment_method = 'adjustment'` and they belong in the adjustment bucket, out of cash and bank.
3. **Make the breakdown provably complete.** Cash + Bank + Adjustment + Other must equal the total
   of the rows the RPC returned. If it does not, show the remainder rather than dropping it —
   silently vanishing rows are what made this survive.
4. **Consider retiring `payment_category`.** One value on 3,277 rows is not a category; it is a
   column three screens are reading for information it has never carried. Decide whether it gets
   populated or removed — leaving it is how the next filter gets written against it.

---

## 5 · What would change for a KBH or FMH user the moment this is fixed

### 5a · "Bank Received" stops reading zero

On the great majority of sales the figure jumps from 0 to a real number, and on KBH's larger units
that number is most of the sale. Anyone who has been reading these panels has been reading them
wrong — but per §3b **no past decision rests on it**, so the fix carries no need to revisit
anything. It is the next cancellation, not the last one, that this protects.

### 5b · An Adjustment row appears where none has ever appeared

`cancellation.js:351` renders that row only when `adjPaid` is non-zero, which has never happened.
On the 203 payments booked as adjustments it will start appearing, and on KBH it will land on
exactly the sales where the money never moved — the Awami Market adjustment on UG-06 is one of
them (see [2026-09-05-D](2026-09-05-D-rms-ran-ten-days-behind-the-book.md)). That is correct, and
it will still be the first time anyone has seen it.

### 5c · Nothing about refunds or balances moves

`totalPaid`, `outstanding` and every refund figure derive from installments and do not touch these
three variables. No stored number changes, no receipt changes, no ledger changes. The fix is
confined to what the panel displays.

### 5d · KBH's cash-vs-bank split is only as good as the method column

Fixing the filter makes the panel read the column honestly — it does not make the column honest.
Six KBH payments in August 2026 alone are filed under a method their own note contradicts
(600,000 booked cash against a reference reading "14 Development Account FMH"; 100,000 booked cash
carrying bank UBL; three more booked cash whose notes say "online"; and the 4,900,000 on UG-06
booked cash against a note saying it never reached cash or bank). Correcting those is a data
decision that is **not** part of this fix and needs its own approval.

---

## 5e · What was actually fixed, 2026-09-05 — and what was left

**Fixed:** the bank predicate in both files, to the set `js/pages/search.js:1154` already uses:
`['bank_transfer', 'bank', 'cheque', 'online']`. Confirmed by grep across `js/`, `electron/` and
`scripts/` that **no third file** carries the `=== 'bank'` comparison — search.js was already
correct, including its `adjPaid` (which it takes from `payment_method`, the right column).

**Deliberately not touched, by instruction:**

- **§4.2 — `adjPaid` still reads `payment_category`,** so it is still always 0 and the Adjustment
  row still never renders. `adjustment` (203 rows) and `other` (19 rows) therefore still fall
  into no bucket.
- **§4.4 — `payment_category` is untouched.**
- **The `total_paid = 0` / `net_refund_amount = 0` question raised in §3b stays open** and is not
  investigated here. It is a different defect or a different explanation and needs its own work.
- **§4.1's shared predicate** — three copies of the same list now exist rather than one helper.
  Converging them is still the right end state and is still not done.

**What the fix changes on the 14 live cancellations that have money against them:**

| Unit | Cash | Bank, before | Bank, after | Still unbucketed | Total paid |
|---|---|---|---|---|---|
| 7-08 | 180,000 | 0 | **2,230,000** | — | 2,410,000 ✅ reconciles |
| 3-02 | 250,000 | 0 | **1,650,000** | — | 1,900,000 ✅ reconciles |
| 6-08 | 1,950,000 | 0 | **400,000** | 60,000 other | 2,410,000 |
| 1-10 | 1,900,000 | 0 | **300,000** | 300,000 adj | 2,500,000 |
| 7-12 | 750,000 | 0 | **90,000** | 100,000 other | 940,000 |
| UG-01 | — | 0 | — | 4,000,000 adj | 4,000,000 |
| UG-20 | — | 0 | — | 3,000,000 adj | 3,000,000 |
| 1-04 | — | 0 | — | 3,000,000 adj | 3,000,000 |
| UG-07 | 400,000 | 0 | — | 2,500,000 adj | 2,900,000 |
| 4-21 | — | 0 | — | 2,000,000 adj | 2,000,000 |
| UG-06 | 400,000 | 0 | — | 1,000,000 adj | 1,400,000 |
| UG-05 | 400,000 | 0 | — | 1,000,000 adj | 1,400,000 |
| 1-06 | 400,000 | 0 | — | 1,000,000 adj | 1,400,000 |
| 6-04 (FMH) | — | 0 | — | 500,000 adj | 500,000 |

Two of the fourteen now add up to Total Paid. **The other twelve still do not**, because the
adjustment bucket is still dead — and on eight of them the entire amount paid is an adjustment,
so the panel goes on showing a substantially-paid sale as near zero. Anyone reading these panels
should know the breakdown is now *right where it reports* and still *incomplete*, until §4.2 is
decided.

---

## 6 · Related

- [2026-09-05-D](2026-09-05-D-rms-ran-ten-days-behind-the-book.md) — found in the same pass; about
  entry timing, not code.
- `js/pages/search.js:1153-1154` and `1383-1384` — the same split, written correctly. The model to
  converge on.
- `docs/daily-closing/RULES.md` — the cash book keeps its own `CASH`/`BANK` mode on `cash_entries`
  and does **not** read `payments.payment_method`, so it is unaffected by this defect. That is also
  why the parallel run will not surface it.
