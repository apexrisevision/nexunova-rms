# Finding 2026-09-07-H — most Fourteen Group and many FMH agents have no CNIC, so identity cannot be resolved there at all

| | |
|---|---|
| **Found** | 2026-09-07, while making the Reserve Desk requester picker separate people who share a name |
| **Status** | **DATA QUALITY — no cleanup attempted, deliberately.** The owner is raising it with the sales team. Nothing here is a code defect. |
| **Scope** | `public.agents`, live. **Awami is clean. FMH and Fourteen Group are not.** |
| **Severity** | **Missing CNIC is the serious half** — commission attribution depends on it. Missing phone is an inconvenience. |

---

## 1 · The headline

**A missing phone is an inconvenience. A missing CNIC means two people who share
a name cannot be told apart at all — not by the desk, not by a report, not by a
person reading the table.** Commission attribution rests on knowing which agent a
booking belongs to, so this is a money question, not a tidiness one.

Active agents only, the three real tenants:

| Company | Active agents | **No CNIC** | No usable phone |
|---|---:|---:|---:|
| **Awami Market** | 16 | **0** | 0 |
| **FMH** | 35 | **20** | 0 |
| **Fourteen Group of companies** | 72 | **57** | 56 |

"No usable phone" means NULL, all zeros, or fewer than ten digits.

## 2 · What this means for the Reserve Desk, stated plainly

**The desk is safe on Awami today and would NOT be safe on the other two.**

The desk credits a booking to an agent row (`reservations.requested_by_agent_id`).
It separates people who share a display name by showing the phone beside the
name, and the operator picks one. That works on Awami because all 16 active
agents have a real CNIC and a real phone: two people called *Fawad khan* were
provably two people, and each is separately selectable
([[fawad_khan_two_people_not_a_duplicate]]).

Point the same feature at **FMH** or **Fourteen Group** and both supports fail
together:

- **57 of 72** Fourteen Group agents have no CNIC, so where a name repeats there
  is no way — *in the data* — to say whether that is one person with two rows or
  two people. The question is not hard to answer; it is currently unanswerable.
- **56 of 72** also have no usable phone, so the label the operator picks from
  degrades to `0000-000000` and disambiguates nothing:

```
Akbar Shah · AGT-2026-0017 · 0332-9817276
Akbar Shah · AGT-2026-0019 · 0000-000000     ← tells the operator nothing
```

Those examples come from the pre-scoping picker, which spanned the whole dealer
group. Scoping the picker to the project's own company removed them from
Rashid's desk — **it did not fix them.** They are waiting behind whichever
project is opened next.

**So: before the Reserve Desk is used for an FMH or Fourteen Group project, the
CNIC gap in that tenant has to be closed first.** That is a prerequisite, not a
nice-to-have.

## 3 · How it surfaced

The picker appends a phone to entries whose display name collides, because a
phone is what the operator has just read in the WhatsApp group and an agent code
is not ([[identity_cnic_matches_phone_disambiguates]]). Building that decoration
required counting name collisions across the group, which is what exposed how
many rows carry neither a phone nor a CNIC.

Related and already recorded: [[fmh_kbh_workforce_separation]] notes the FMH
register carried no CNICs at all, and [[fmh_agent_attribution_wrong_aug2026]]
flags FMH agent attribution as unverified. This finding is consistent with both
and quantifies them.

## 4 · Do not clean this up in code

Filling a CNIC or a phone is asserting a fact about a real person, and getting it
wrong merges two people or splits one — both of which move commission. It is a
sales-team task with a paper trail, not a migration. If a bulk update is ever
authorised it should come from a list the sales team has signed off, matched on
CNIC, and applied per tenant.

To re-measure at any time:

```sql
SELECT c.company_name,
       count(*) AS active_agents,
       count(*) FILTER (WHERE a.cnic IS NULL OR trim(a.cnic) = '') AS no_cnic,
       count(*) FILTER (WHERE a.phone IS NULL OR a.phone ~ '^0+$'
                           OR length(regexp_replace(a.phone,'\D','','g')) < 10) AS no_phone
  FROM public.agents a
  JOIN public.companies c ON c.id = a.company_id
 WHERE a.status = 'active' AND c.company_code NOT ILIKE 'zztest%'
 GROUP BY c.company_name
 ORDER BY c.company_name;
```
