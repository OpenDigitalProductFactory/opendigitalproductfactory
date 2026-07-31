# Decision Vectors by Business Type

## Abstract

Your AI coworkers weigh every judgement against the same named set of decision axes, defined in full
in the [Decision Vectors reference](decision-vectors.md). What changes between a plumbing firm and a
credit union is **not the axes — it is which ones dominate, which ones are hard gates that are never
traded away, and which craft-specific axes come into play.**

This page states that, per business type, so a prospective user can check whether the platform's
judgement actually fits how their business works — rather than taking "it understands your industry"
on trust.

**Why the axes do not change per business type.** An install may re-weight the shared set; it may
never declare its own axes. If every business had private axes, no two installs' judgement could be
compared, and nothing learned in one could ever generalise to another. Richness lives inside the
professions instead — see [§7.3 of the reference](decision-vectors.md#7-crowd-validation-and-hive-intake).

---

## How to read an entry

Each business type below states four things.

- **Load-bearing stage** — the point in that business's value stream where the money and the risk
  concentrate. Judgement quality matters most here.
- **Dominant axes** — what the coworker weighs most heavily in this line of work.
- **Hard gates** — axes that are *not* traded off. A high-scoring option that fails one of these is
  not chosen faster; it is refused, and a human is asked.
- **Craft axes in play** — the profession-local axes this work activates, each of which rolls up
  onto a shared axis when the decision leaves that profession.

A note on cost axes: `blast_radius`, `human_cognitive_load`, `vendor_lock_in`, `business_disruption`
and `operator_effort` are named for the bad thing. "Dominant" for those means the coworker works
hard to keep them **low**.

---

## You go to the customer — field and dispatch

Someone travels to a property or a vehicle. The shared shape of judgement here: **the decision is
made before anyone can see the site, and it is expensive to reverse once the van has moved.**

Across this group, `speed_to_value` and `evidence_density` carry the most weight — the fastest
routing decision is worthless if the technician arrives without the context to finish the job — and
`reversibility` is structurally low for everything after dispatch, which is why the coworker proposes
and a human approves rather than dispatching autonomously.

<a id="trades-and-home-services"></a>

### Trades & home services

- **Load-bearing stage:** route and dispatch the technician.
- **Dominant axes:** `speed_to_value` (an emergency call-out buried under routine quotes is a lost
  job), `evidence_density` (property type, equipment, prior visits — the first visit should be the
  fix), `operator_effort` kept low across the inbox-to-dispatch handoff.
- **Hard gates:** `public_safety`. Licensed work — electrical, gas, refrigerant handling, fall
  protection — surfaces its readiness gate. The coworker flags readiness and never improvises safety
  or code advice, at any speed.
- **Craft axes in play:** `capacity_utilization` (operations) — crew and truck time already paid for,
  rolling up onto `cost_efficiency`.

<a id="automotive-services"></a>

### Automotive services

- **Load-bearing stage:** schedule, or dispatch right now.
- **Dominant axes:** `speed_to_value` — roadside and lockout work is genuinely real-time and must not
  be forced into a booking calendar — balanced against `evidence_density`, because a quote without
  the VIN is a guess about parts and price.
- **Hard gates:** `public_safety` and `governance_compliance`, which here are the same thing:
  post-install ADAS recalibration and driver hours-of-service are tracked as steps, not
  afterthoughts.
- **Craft axes in play:** `capacity_utilization` across the two dispatch modes.

<a id="moving-and-logistics"></a>

### Moving & logistics

- **Load-bearing stage:** schedule the pickup and the route.
- **Dominant axes:** `evidence_density` (origin, destination, size, condition and disposal notes —
  the record is what settles a dispute later), `cost_efficiency` on routes, `long_term_maintainability`
  on recurring business accounts that should not be re-quoted every time.
- **Hard gates:** `governance_compliance` — hours-of-service limits and chain of custody for medical
  and legal courier work are limits, not preferences.
- **Craft axes in play:** `capacity_utilization` (truck and crew loading).

<a id="security-services"></a>

### Security services

- **Load-bearing stage:** assign officers, or complete the install.
- **Dominant axes:** `blast_radius` kept low — each client site is contractually separate, and
  bleeding one client's assignments or data into another's is the failure that ends the business —
  plus `evidence_density` on incident records.
- **Hard gates:** `public_safety` and `governance_compliance`: officer licensing and low-voltage
  certification are verified up front and over time, and incident response is documented.
- **Craft axes in play:** `business_disruption` and `evidence_confidence` (security) — how conclusive
  an incident assessment is, distinct from how much material exists, and whether the response itself
  disrupts the client's operation. They roll up onto `blast_radius` and `evidence_density`.

---

## Customers come to you — appointments and booking

The calendar is the product. The shared shape here: **decisions are individually reversible — a slot
can be moved — but they touch personal records, and the person is often already in the building.**

`human_cognitive_load` and `data_privacy` dominate across the group, and `reversibility` is high
enough that the coworker can be trusted with more of the routine work than in field dispatch.

<a id="clinics-and-wellness"></a>

### Clinics & wellness

- **Load-bearing stage:** deliver care, informed by the record.
- **Dominant axes:** `data_privacy` and `evidence_density` — the record being present at the
  appointment is what keeps care safe — with `human_cognitive_load` weighed hard, because a clinician
  who has to reconstruct context is a clinician not looking at the patient.
- **Hard gates:** `public_safety` above everything. This is the platform's most safety-critical
  consumer setting, and the boundary is absolute: the coworker stays in scheduling and operations. It
  does not diagnose, does not triage, and does not handle a clinical or mental-health crisis —
  crises route to emergency services. `governance_compliance` (health-information rules for home
  health and phlebotomy) is likewise never traded for speed.
- **Craft axes in play:** none of the demoted craft axes; the weight sits on the spine, which is
  correct — safety and privacy must stay comparable to everything else in one ledger.

<a id="beauty-and-personal-care"></a>

### Beauty & personal care

- **Load-bearing stage:** assign the practitioner and the slot.
- **Dominant axes:** `capacity_utilization` in effect — double-bookings and no-shows are the whole
  economics of the day — with `speed_to_value` and low `operator_effort` on self-rescheduling, and
  `legibility_of_consequence` so an owner can see what a schedule change will do before approving it.
- **Hard gates:** none regulatory in most of this group; the effective floor is
  `legibility_of_consequence` — the coworker does not move a booking in a way the owner could not
  have predicted.
- **Craft axes in play:** `capacity_utilization` (operations), rolling up onto `cost_efficiency`.

<a id="pet-services"></a>

### Pet services

- **Load-bearing stage:** capture the pet's context.
- **Dominant axes:** `evidence_density` — size, coat, temperament, allergies and medication decide
  whether the service arrives prepared — and `reversibility` across the three booking shapes (slots,
  date ranges, recurring).
- **Hard gates:** `public_safety` where an animal's or a handler's welfare is involved: vaccination
  status at intake and controlled-substance handling for mobile veterinary work.
- **Craft axes in play:** `capacity_utilization` for kennel and route capacity.

<a id="fitness-and-recreation"></a>

### Fitness & recreation

- **Load-bearing stage:** renewal — not the first sale.
- **Dominant axes:** `long_term_maintainability` in its commercial sense: the membership relationship
  is the asset, so a decision that wins a signup at the cost of the renewal scores badly.
  `cost_efficiency` and `capacity_utilization` on class patterns follow.
- **Hard gates:** `data_privacy` on liability intake (age, emergency contact) and
  `customer_consent_state` before any retention contact.
- **Craft axes in play:** `customer_consent_state` (marketing) rolling up onto
  `governance_compliance`; `capacity_utilization` (operations).

<a id="education-and-training"></a>

### Education & training

- **Load-bearing stage:** the inquiry or enrolment.
- **Dominant axes:** `evidence_density` on the learner-versus-payer distinction — a parent books and
  a child attends, and an instructor who does not know which is which is a problem — plus
  `long_term_maintainability` across terms and packages.
- **Hard gates:** `public_safety` and `governance_compliance` where minors are involved: guardian
  consent and instructor qualification are gates, never trade-offs.
- **Craft axes in play:** `capacity_utilization` (cohort and instructor scheduling).

---

## You sell goods — catalogue and orders

Browse, cart, checkout, fulfil. The shared shape: **the moment of commitment is fragile and the
decision window is seconds**, so `speed_to_value` and low `operator_effort` weigh heavily — but
`reversibility` is genuinely high (an order can be amended, a refund issued), which is what makes it
safe to weight speed this hard.

<a id="retail-and-goods"></a>

### Retail & goods

- **Load-bearing stage:** checkout and the order reference.
- **Dominant axes:** `speed_to_value` and `operator_effort` kept low through the cart;
  `evidence_density` on the catalogue itself, because a missing product image or price is a lost sale
  before anyone talks to anyone.
- **Hard gates:** `data_privacy` on delivery and payment details; `customer_consent_state` before any
  repeat-buyer contact.
- **Craft axes in play:** `customer_consent_state` (marketing) → `governance_compliance`;
  `capacity_utilization` (operations) on stock and reorder points.

<a id="food-and-hospitality"></a>

### Food & hospitality

- **Load-bearing stage:** reserve, quote, or order — three shapes on one engine.
- **Dominant axes:** `legibility_of_consequence` on table and duration blocking (an owner must see
  what a reservation change does before approving it) and `speed_to_value` on the booking itself.
- **Hard gates:** `public_safety`. Allergen and dietary disclosure is treated as a duty of care, not
  a free-text field that may or may not reach the kitchen. It is never traded for a faster booking.
- **Craft axes in play:** `capacity_utilization` (covers, kitchen and event capacity).

---

## You serve members and community — members, residents and regulated

Donors, members, residents, ratepayers, borrowers. The shared shape is the sharpest inversion on the
platform: **a trust gate comes before the value stream.** Eligibility, disclosure and the duty to
serve everyone are settled first, and only then does anything proceed.

Across this group `governance_compliance` and `data_privacy` dominate, and `speed_to_value` is
deliberately down-weighted — moving faster through a statutory process is not a benefit.

<a id="nonprofits-and-community"></a>

### Nonprofits & community

- **Load-bearing stage:** the gift or the joining.
- **Dominant axes:** `governance_compliance` (a gift produces a receipt, not a bill, and there is no
  account behind it — getting this wrong is not a cosmetic error) and `legibility_of_consequence` on
  member-owned structures and profit sharing.
- **Hard gates:** `governance_compliance` on charitable and cooperative obligations —
  tax-relief framing, patronage allocation, member-democratic governance.
- **Craft axes in play:** `customer_consent_state` (marketing) → `governance_compliance`, on supporter
  contact.

<a id="hoa-and-property-management"></a>

### HOA & property management

- **Load-bearing stage:** paying dues, or sending a request.
- **Dominant axes:** `legibility_of_consequence` — a resident must be able to see what a request or
  an approval will do — plus `evidence_density` (the unit or lot captured before a request moves) and
  low `operator_effort` for volunteer boards.
- **Hard gates:** `governance_compliance` on covenants, reserve disclosure, and landlord-tenant and
  deposit law.
- **Craft axes in play:** `capacity_utilization` for shared amenity booking.

<a id="public-sector-and-civic"></a>

### Public sector & civic

- **Load-bearing stage:** processing and routing the resident's request.
- **Dominant axes:** `governance_compliance` above all — funding is statutory rather than
  market-priced, and there is a universal obligation to serve every resident — with
  `evidence_density` on the archival record and `legibility_of_consequence` on routing.
- **Hard gates:** the heaviest set on the platform. Public-records law and its statutory clocks,
  drinking-water and discharge regulation for utilities, and law-enforcement information handling —
  where the coworker's posture is to **refuse** criminal-justice-information lookups outright and
  route to intake only. A refusal is a correct outcome here, not a failure to be optimised away.
- **Craft axes in play:** `evidence_confidence` (security) → `evidence_density`, where a determination
  must be conclusive rather than merely supported.

<a id="banking-and-credit-unions"></a>

### Banking & credit unions

- **Load-bearing stage:** the application and its identity check.
- **Dominant axes:** `governance_compliance` and `data_privacy`, with `blast_radius` held low by
  architecture: this platform is the engagement layer. It records applications and obligations and
  **never moves money** — core banking stays with the institution. That is a deliberate ceiling on
  how much damage a wrong judgement can do.
- **Hard gates:** the strictest profile shipped. Deposit-insurance and mortgage-lending disclosure
  must precede the call to action; identity and anti-money-laundering checks gate intake; rate and
  fee disclaimers are mandatory. None of these is weighed against conversion.
- **Craft axes in play:** `customer_consent_state` (marketing) → `governance_compliance`;
  `evidence_confidence` (security) on identity determinations.

---

## You rent, build and advise — projects, rentals and engagements

Value is delivered over time under a scope or an agreement. The shared shape: **the decision that
matters was made months before its consequence lands**, so durability outweighs speed almost
everywhere in this group.

`long_term_maintainability` and `evidence_density` dominate, and `blast_radius` is held low by client
isolation.

<a id="equipment-and-storage-rental"></a>

### Equipment & storage rental

- **Load-bearing stage:** the use period itself — the asset is out of the pool and earning or idle.
- **Dominant axes:** `capacity_utilization` above all (a pooled asset double-booked or sitting idle
  is the entire margin), then `evidence_density` on handover and return condition, which is what
  settles a damage dispute.
- **Hard gates:** `governance_compliance` on deposit law, which varies by jurisdiction.
- **Craft axes in play:** `capacity_utilization` (operations) → `cost_efficiency`. This is the
  archetype where that projection is most visible: fleet utilisation *is* the cost story.
- **Note:** this is the business shape scoped for the first pilot of an **external** situational
  signal — a seasonal demand correlate. Consistent with the reference's §5 rule, such a signal must
  be validated against recorded outcomes before it is allowed to influence any live score.

<a id="home-building-and-construction"></a>

### Home building & construction

- **Load-bearing stage:** the inquiry and the quote — an educated quote decides whether the project
  is profitable eighteen months later.
- **Dominant axes:** `long_term_maintainability` (selections, permits, warranty obligations all
  outlive the sale), `evidence_density` on buyer qualification, and `reversibility` weighed honestly:
  it collapses once ground is broken.
- **Hard gates:** `public_safety` and `governance_compliance` — building codes, permits and
  inspections are jurisdiction-specific gates, and design controls and warranty obligations bind.
- **Craft axes in play:** `capacity_utilization` on crew and trade scheduling.

<a id="professional-services"></a>

### Professional services

- **Load-bearing stage:** the quote and the scope.
- **Dominant axes:** `evidence_density` linking the original question to the quote so nothing drifts,
  and `blast_radius` kept low through strict per-client isolation — for an IT managed-services firm
  especially, one client's files reaching another is the end of the firm.
- **Hard gates:** `governance_compliance` and `public_safety` in the regulated professions: the
  coworker does not give legal or financial advice, and points to a qualified professional instead.
  Practitioner licensing and client-data isolation are gates.
- **Craft axes in play:** `operational_independence` and `vendor_lock_in` (devops-platform) for
  managed-services work — both rolling up onto `long_term_maintainability`; `evidence_confidence`
  (security) on incident determinations.

<a id="software-and-platforms"></a>

### Software & platforms

- **Load-bearing stage:** turning an inquiry into a tracked backlog item.
- **Dominant axes:** `long_term_maintainability` and `schema_grounding` — building on substrate that
  already exists rather than alongside it — plus `reusability`, since a feature that serves one
  install and no other is a cost centre.
- **Hard gates:** `data_privacy` where the platform touches customer data.
- **Craft axes in play:** the full software and platform set — `schema_grounding`, `reusability`,
  `operational_independence`, `vendor_lock_in`. All four are profession-local, and all four project
  onto `long_term_maintainability` (with `operational_independence` also onto `blast_radius`). This
  is the clearest illustration of why the demotion policy exists: this is the profession whose
  vocabulary would otherwise have colonised the shared space every other business type must reason
  over.

---

## Where this is going

The per-business-type emphases above are authored and reviewed, not measured. The work to derive
them from each profession's own corpus and from real decision history — and to record how many
independent organisations corroborate each one — is designed and under way rather than done. The
[reference's §6 and §7.2](decision-vectors.md#6-what-the-registry-currently-gets-wrong) state exactly
what is measured, what is authored, and what is not yet built.

Full axis definitions, sign conventions, sourcing classes, and the organisation-selection contract
are in the [Decision Vectors reference](decision-vectors.md).
