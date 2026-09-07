# Finding 2026-09-07-F — five sold units name nobody as the seller

| | |
|---|---|
| **Found** | 2026-09-07, during the Reserve Desk Stage 2 multi-tenant board check |
| **Status** | **KNOWN DATA GAP — not fixed, deliberately.** Owner accepted it as pre-existing and out of scope for the Reserve Desk work. |
| **Scope** | Live data in two tenants. **Not a code defect** — the board renders exactly what the data says. |
| **Severity** | Low. Cosmetic on the board; possibly meaningful for commission attribution. |

---

## 1 · What was measured

`get_availability_board` was read read-only through an umbrella session for all
three projects, counting sold units against sold units that resolve a name:

| Project | Company | Units | Sold | `sold_by` present | **Missing** |
|---|---|---:|---:|---:|---:|
| Awami Market | Awami Market | 1,467 | 0 | 0 | 0 |
| Fourteen Manzil Height | FMH | 455 | 251 | 250 | **1** |
| KHUSHAL BAGH HEIGHTS | Fourteen Group of companies | 322 | 175 | 171 | **4** |

Every unit returned every expected key (`any_unit_missing_keys` = 0 on all three),
so this is not a shape problem in the payload.

## 2 · Why it happens

`sold_by` is a two-step fallback, unchanged by Stage 2:

```sql
'sold_by', CASE WHEN st.status_code='SOLD'
                THEN COALESCE(ag.full_name, seller.full_name) ELSE NULL END
```

- `ag` — the agent on the unit's active sale (`sales.agent_id` → `agents`)
- `seller` — failing that, the person who held the last **converted** reservation

A sold unit resolves to NULL only when **both** are empty: the sale carries no
`agent_id`, and no converted reservation ever pointed at that unit. That is
plausible for stock imported before the portal existed — most of the KBH and FMH
inventory was loaded by import, not booked through a reservation.

## 3 · Why it is being left alone

- It **pre-dates** the Reserve Desk entirely. Stage 2 only added
  `requested_by_name` to the same object; it did not touch `sold_by`, its
  fallback, or `sales.agent_id`.
- Fixing it means deciding **who** those five sales belong to — an attribution
  question with commission consequences, and one only the owner can answer. It is
  not a code change.
- Related and already recorded: [[fmh_agent_attribution_wrong_aug2026]] flags FMH
  agent attribution as unverified more broadly. These five may be part of that,
  or may be genuinely agent-less direct sales. **Not investigated here.**

## 4 · If it is ever picked up

Identify the rows first, then ask before writing:

```sql
SELECT c.company_name, p.project_name, u.unit_no, s.sale_number, s.sale_date, s.net_amount
  FROM sales s
  JOIN units u      ON u.id = s.unit_id
  JOIN projects p   ON p.id = s.project_id
  JOIN companies c  ON c.id = s.company_id
 WHERE s.status = 'active' AND s.agent_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM reservations r
                    WHERE r.unit_id = s.unit_id AND r.status = 'converted')
 ORDER BY c.company_name, u.unit_no;
```

Setting `sales.agent_id` changes commission. Do not do it without the owner
naming the agent per sale.
