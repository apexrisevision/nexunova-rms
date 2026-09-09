# One dealer, three spellings — the requester on a desk booking is free text

**Found:** 2026-09-09, loading Rashid's 113-unit opening position.
**Status:** the two duplicate dealers are MERGED (Rashid confirmed each pair is one man). The cause — a free-text requester — is untouched, so it can happen again.

## What it is

`reserve_unit_desk` takes a requester three ways: an agent id, a portal member
id, or `p_requested_by_name` as free text. Awami's holds are almost entirely
the third. Counted on Awami's live reservations before this load:

| requested_by_name | rows | is an agent |
|---|---|---|
| `Waqar landlord`  | 11 | no |
| `Waqar Landlord`  | 10 | no |
| `Akbar Sha`       | 6  | no |
| `Rashid Manzoor`  | 3  | yes |
| `Rashid Manzoor`  | 2  | no |
| `Rashid MANZOOR`  | 2  | no |

Same person, several strings, and nothing joins them. The 113 rows loaded today
used `Waqar Landlord` and `Akbar Shah` (Rashid's own spellings), so `Waqar`
now stands at 11 + 96 across two spellings and `Akbar` at 6 + 7 across two.

## What it changes for a live user

Any question of the form "how many units is Waqar holding" has to be asked
three times and added up by hand, and a dealer report grouped on this column
will show one person as several. It is not wrong data — the units and the
statuses are right — it is data that cannot be totalled.

## Why it is not fixed here

Merging names is a decision about people, not a code change: only Rashid knows
whether `Akbar Sha` and `Akbar Shah` are one man. The durable fix is the one
the picker already supports — put these dealers in the agents master and let
the desk resolve them to an id, which is what
[[identity_cnic_matches_phone_disambiguates]] says and what
`_reindex()` in `js/portal-reserve-desk.js` was rebuilt for.

Until then the free-text box stays, because refusing a name that is not in the
master would stop a booking the desk exists to take.

## What was done, 2026-09-09

Rashid confirmed `Waqar landlord` = `Waqar Landlord` and `Akbar Sha` = `Akbar
Shah` — one person each. 17 reservations were renamed onto his own spellings
(11 + 6), scoped to Awami’s company, on `reservations.requested_by_name` only;
`availability_requests` held none of these names. After: **Waqar Landlord 109
rows / 108 active**, **Akbar Shah 13 / 13 active**, and no other case variant of
either name exists in that company.

The three `Rashid Manzoor` variants were left alone — not asked about, and one
of them carries a real agent id while the others do not, which is a different
question from a misspelling.

## And the cause was closed too, 2026-09-09

Rashid asked for the eight dealers to be put in the agents master and the old
holds joined to them. Done: `AGT-2026-0019` … `AGT-2026-0026` (Waqar Landlord,
Akbar Shah, Haseeb, Naeem Hussain, Raza Ullah, Siraj, Sohail, Nasir), and 143
reservations now carry `requested_by_agent_id`. **No active hold on Awami is
recorded against a typed name any more.** They appear in the desk’s requester
picker, so the next booking resolves to an id rather than re-typing a string.

Two things were NOT resolved and are deliberately left open:

1. **Phone and CNIC are blank on all eight.** `agents.phone` is NOT NULL so it
   holds an empty string; commission is NULL rather than the app’s 2% default,
   because inventing a rate is worse than leaving it unset. Every other agent
   in this company has both fields filled.
2. ~~**`Naeem Hussain` is also a DIRECTOR in `sales_users`.**~~ RESOLVED the same
   day: Rashid confirmed it is the director. The three holds (GF-192, GF-193 and
   one released) were moved onto his `requested_by_sales_user_id`, and the agent
   row `AGT-2026-0022` was deleted after checking that nothing else in the
   schema pointed at it — sales, submissions, transactions, commission payments,
   portal users, unit changes, cancellations and sub-agents were all zero.

   This is the case the name-is-not-identity rule exists for: seven of the eight
   were dealers who needed an agent row, and the eighth was a man who already
   had an account. Only Rashid could tell them apart.

   Awami now stands at **139 active holds against an agent id, 2 against a portal
   member, 0 against a typed name.**

## Why the app could not have done this

`create_agent` refuses at the plan cap, and Awami is on `basic_monthly` with
**max_agents 10 against 16 already active** — so the Agents screen would have
blocked all eight before asking anything else. These were inserted directly,
with `generate_agent_code()` for the codes so the format matches. Raising the
cap on this tenant is a separate decision and was not taken.
