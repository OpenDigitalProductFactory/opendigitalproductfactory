# Campground / RV park — operating model and probe result

Archetype family: `campground`, `rv-park`, `glamping`, and by extension marina slips.
Probe type: **confirmation probe** (per the [accommodation doctrine](../accommodation-doctrine.md)).
Written 2026-08-25 as part of the archetype operating-model audit.

The operating day below was written from domain research **before** classifying anything against
the schema, per step 1 of the [audit method](../archetype-operating-model-audit.md). The
classification in §5 was done afterwards.

---

## 1. The operating day

**07:00 — Bathhouse and grounds.** A host cleans the two bathhouses (three times daily in
season), empties trash on the loops, and checks the dump station. This is a **round**: a fixed
sweep producing a per-location record.

**08:00 — Departures.** Eleven sites check out by 11:00. Each needs turnover: fire ring cleaned,
site raked, hookups checked, trash cleared. A site is not sellable again until turnover is done —
which matters because three of those sites are booked for arrival the same afternoon.

**09:00 — The overnight arrival problem.** A rig came in at 23:00 after office hours, used the
late-arrival envelope, and parked on site 22. Site 22 was booked to someone else from tonight.
Staff must find them, verify, and move somebody.

**10:00 — Reservations.** Phone and online. Some guests book a **specific site** ("we want 14,
we had it last year"); others book a **site class** ("any full-hookup pull-through") and get
assigned at check-in. Both are normal, and the second is how the park keeps flexibility.

Minimum stays apply — two nights on weekends, three on holidays. A one-night request on a
Saturday is refused by policy, not by availability.

**11:00 — A fit problem.** A caller has a 38-foot fifth wheel plus a tow vehicle. Half the park
cannot take it: site length, back-in versus pull-through, overhanging trees, turning radius at
the loop head. **Availability is not the question — fit is.** The site is empty and still wrong.

**13:00 — Check-ins.** Registration takes vehicle plate, rig type and length, occupant count,
pets, and emergency contact. In several jurisdictions guest registration is a legal requirement,
as it is for hotels. Wristbands and a vehicle placard are issued; the site is assigned if the
booking was class-only.

**14:00 — Seasonal row.** Sites 40-58 are seasonal: occupied from April to October by the same
guests, with **sub-metered electric** read monthly and billed separately from the site fee.
These episodes run for **months**, not nights.

**15:00 — Extension request.** The guest on site 31 wants two more nights. Site 31 is booked
from tomorrow, so the answer is "yes, but you move to 33" — or no.

**16:00 — Maintenance.** A power pedestal on the B loop has failed. Three sites are unusable
until it is fixed; two of them have guests arriving tonight who must be relocated.

**17:00 — Camp store.** Firewood, ice, propane. Retail alongside lodging, taxed differently.

**20:00 — Quiet hours round.** The host drives the loops: compliance checks, noise, unregistered
vehicles, dogs off leash, campfires during a burn ban.

## 2. The bad day

**Evacuation.** A flash-flood warning or an approaching wildfire. The park must know **who is on
site right now**, on which site, with what contact number, and who has already left — within
minutes. This is a query over open episodes, and it is life-safety.

**A fire ban imposed mid-stay.** The county raises the fire-danger level at noon. Campfires
become illegal immediately, the camp store must stop selling firewood, and every guest on site
must be told. **The rule changed while occupancy was in flight, and it came from outside.**

**Overbooking or a double-assigned site**, usually created by an after-hours arrival or a
turnover that did not complete.

**A rig that does not fit**, arriving at 21:00 having booked online without a length check.

## 3. The periodic cycle

- **Season opening and closing** — winterisation is a real operational cycle: blow out water
  lines, close bathhouses, shut seasonal utilities, and reverse it in spring.
- **Monthly** — sub-meter reads and billing for seasonal sites; occupancy statistics; **transient
  lodging / occupancy tax** remitted to the municipality, at a different rate from retail sales
  tax.
- **Seasonal** — rate cards by period (peak, shoulder, off, holiday premiums).
- **Annual/periodic** — potable water testing, septic and pool/spa inspection, health-department
  visits, licence renewal.

## 4. Load-bearing obligations

| Obligation | Why |
|---|---|
| **Guest registration** | Legally required in several jurisdictions, as for hotels. |
| **Evacuation roster** | Life-safety. Must answer "who is on site now" instantly. |
| **Fire ban compliance** | Externally imposed, dynamic, and enforced. |
| **Length-of-stay limits** | Statutory on public land (commonly 14 days, then a required absence). |
| **Potable water testing / septic / pool inspection** | Health-department mandated. |
| **Occupancy / lodging tax** | Remitted to the municipality; distinct from sales tax. |
| **Food-storage rules** | Legally enforced in bear country. |

## 5. Probe result — classification

Using the doctrine's five-step procedure. **Confirmations dominate, as predicted for a
confirmation probe.**

### Confirmed — no new canonical element

| Difference | Classification | Resolution |
|---|---|---|
| site / pad / loop / slip naming | pattern 1 — vocabulary | `Resource.kindSlug` |
| site fees, extra vehicle, pet fee | vertical pricing | existing |
| stay = occupancy episode | canonical element 8 | same shape as `HospitalityServiceTurn` |
| reservation, walk-in, waitlist, hold | pattern 3 — demand vocabulary | `ResourceCapacityAllocation.demandSlug` |
| host rounds, bathhouse cleaning, quiet-hours patrol | same round shape as kennel rounds | second sighting of "round" |
| campground map with numbered sites | existing | `OperationalSceneLayout`, `spaceKind: cartesian-interior`; **flat — does not stress tier**, as predicted |
| site turnover before re-sale | episode stage + gate | canonical lifecycle grammar (`ready` / `on-track` / `blocked`) |
| **class booking vs specific-site booking** | **existing** | `ResourceCapacityPool` versus a specific `Resource` — the pool model already distinguishes these. **A predicted-new item that turned out to be already solved.** |
| evacuation roster | existing | a query over open episodes; needs no new model |
| camp store retail | existing | storefront retail |
| guest / rig profile, repeat preference | canonical element 7 — subject | same keystone as animals |

### Promoted by the counting rule

**Resource-to-capability map — third independent sighting, promotes.**

- beauty — `BeautyResourceService` (built)
- pet-rescue — kennel suitability (large dog, isolation-capable)
- **campground — hookup amperage, water, sewer, pull-through vs back-in**

Three unrelated verticals. Promotes to canonical without further discussion, exactly as the
doctrine's worked example predicted.

### Genuinely new candidates

Only two, which is the expected yield for a confirmation probe and is evidence the nine-element
set is well cut.

**A. Dimensional fit — capacity is not the constraint**

`Resource.capacity: Int` counts. It cannot express *"a 38-foot rig plus tow vehicle fits a
40-foot back-in pad with a tight loop-head turn."* An empty site can still be the wrong site.

This is **constraint matching against resource attributes**, not counting, and it is the same
shape as:

- which kennel can hold a large dog, or is isolation-capable
- which warehouse rack is refrigerated, or rated for the pallet weight
- which treatment room has the required equipment

Recommendation: treat as an **extension of the promoted capability map** rather than a separate
element — the capability map answers "can this resource do/hold X", and dimensional fit is that
question with a numeric comparison instead of a set membership. Deciding these together avoids
two mechanisms for one question.

**B. Externally-driven, dynamic jurisdictional rules — second sighting of jurisdiction**

Pet-rescue needs jurisdiction for **static** rules: stray-hold length, mandatory spay/neuter,
quarantine duration. Set at onboarding, changing rarely.

Campground needs the same *plus* a **dynamic** one: a county fire-danger level that changes
mid-occupancy and immediately restricts what guests may do and what the store may sell.

That is a genuine delta — a rule source that is **external, time-varying, and must reach
in-flight episodes**. Static jurisdiction is a configuration lookup; dynamic jurisdiction is a
subscription with an effect on live state.

**Sighting count for jurisdiction is now 2.** Under the doctrine, jurisdiction rules are
load-bearing (unlawful to get wrong), and load-bearing promotes at 2. **Jurisdiction promotes.**
Whether the *dynamic* variant is part of that element or a later extension should be decided when
a third archetype needs it — transport (hours-of-service), healthcare (licensure) and public
sector are all likely.

### Confirmed stress test — long episodes

Predicted and worth recording as checked. A seasonal site runs **April to October**; a restaurant
turn runs ninety minutes. `HospitalityServiceTurn` carries `startedAt` / `expectedEndAt` /
`closedAt`, which is span-agnostic in shape, and `ResourceCapacityAllocation` indexes on
`([resourceId, organizationId, startsAt])` and `([startsAt, endsAt])` for conflict-window scans.

**No structural short-span assumption was found in the model.** The risk is in
*conflict-window queries*, where a six-month allocation overlaps almost every scan window — a
performance and query-shape concern, not a schema defect. It should be load-tested before
seasonal sites ship, not redesigned.

Sub-metered utilities billed against a long episode are **vertical** on current evidence (one
sighting; marina slips would be a second).

## 6. Doctrine verdict

Campground behaved as a confirmation probe should:

- **eleven confirmations**, several resolving to substrate that already exists
- **one promotion** by the counting rule, decided arithmetically rather than by debate
- **two new candidates**, one of which folds into the promotion rather than standing alone
- **one predicted-new item (class-vs-specific booking) that was already solved** by
  `ResourceCapacityPool` — a good sign, and a reminder to check before proposing
- the predicted stress test found a **query-shape** risk rather than a modelling defect

The doctrine's falsification condition was *"if a confirmation probe surfaces many new canonical
elements, the nine-element set is mis-cut."* It surfaced one-and-a-half. **The set holds.**

## 7. What campground still needs before it could run

Not yet scored — the archetype does not exist in the product (`grep -rli campground` returns
nothing across `docs/`, `packages/`, `apps/`). Recorded so the eventual build is measured, not
assumed:

1. Subject identity for a guest party with a **rig profile** (element 7).
2. Occupancy episode with a **long span** (element 8).
3. Capability map with **dimensional fit** (promoted).
4. Jurisdiction rules including a **dynamic** source (promoted).
5. Turnover as a gate between episodes on the same resource — the site is not sellable until
   turnover reaches an exit-ready state.
6. Sub-metering and lodging tax — vertical until a second sighting.

## 8. Cross-archetype notes

- **"Round" is now at two sightings** (kennel care rounds, host/bathhouse rounds). A third —
  facilities maintenance, ward rounds, or store opening checks — promotes it. Worth watching; it
  is likely the highest-volume operator surface in several archetypes.
- **Turnover-blocks-reuse** generalises: a hotel room, a treatment room between patients, a
  kennel after an infectious occupant. Currently expressible as a lifecycle stage gate.
- **Flat versus stacked layout** — campground is flat, so `layoutState` tier remains at one
  sighting (pet-rescue). Warehousing racking would be the second. Until then, **register the key
  rather than promoting it**, per the escape-hatch discipline.
