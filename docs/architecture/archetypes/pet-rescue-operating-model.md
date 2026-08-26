# Standing requirements: `pet-rescue` / `animal-shelter` archetype

Status: **standing acceptance criteria**, not a wish list. An archetype is not "supported" until
it can run the day below. Derived from domain research, not from what the platform happens to
do — per the audit method, the operating day is written before consulting the product.

Applies to `pet-rescue` and `animal-shelter` (`nonprofit-community`), and largely to
`veterinary-clinic`, `pet-boarding`, `mobile-vet` and the ranching archetypes, which share the
animal-as-subject spine.

---

## 1. The operating day

**06:30 — Rounds.** A kennel tech walks the dog ward with a tablet. Per animal: fed yes/no,
water, stool quality, meds given and signed, visible condition, enrichment. Roughly 40 animals
in 45 minutes. Then the cat ward, where cages are **stacked three high**, so "where is this
animal" is a room, a row, a column and a *tier*.

**07:30 — Isolation last, deliberately.** The parvo suspect in iso is done after everything
else so the tech does not carry infection back down the ward. Order of operations is a
biosecurity control, not a preference.

**08:00 — Intake.** A member of the public arrives with a stray found on Route 9. Staff:
scan for a microchip, photograph the animal, weigh it, record found-location and finder details,
assign a temporary ID, start the **stray hold clock**, and place it in an intake kennel — not
the general ward, because it is unvaccinated and unassessed. The hold clock is legally binding:
this animal cannot be adopted, transferred or euthanised until the hold expires.

**09:00 — Owner surrender appointment.** Different pathway entirely. Requires a surrender form
transferring ownership, a reason code, and the owner's disclosure of bite history. No hold
applies — the shelter owns the animal immediately.

**09:30 — Medical.** Intake exams on yesterday's arrivals: vaccines (with due dates for
boosters), deworming, flea treatment, and a spay/neuter slot booked. A dog with a bite history
goes into **10-day bite quarantine**, which is a health-department obligation, not a shelter
choice.

**11:00 — Adoption floor.** Two scheduled meet-and-greets and a walk-in family. The walk-in
falls for a dog still inside its stray hold — so the answer is "you can place a hold, not adopt
today", and the system must know why.

**13:00 — Foster coordination.** A litter of bottle babies goes to a foster with neonatal
experience. The foster home is a **housing location that happens to be off-site**, and it
leaves with supplies: formula, bottles, a crate, a scale.

**14:00 — A found-pet call.** Someone describes a lost dog. Staff search intake records by
description, area and date, hoping to match. If matched, the outcome is **return-to-owner**,
not adoption — a different outcome code with its own fee and paperwork.

**15:00 — Vet transport.** Three animals to the partner clinic for surgery. Costs are tracked
per animal.

**16:30 — Capacity check.** Nineteen dogs, seventeen runs. Population pressure is the number
that drives the hardest decisions.

**17:00 — Evening rounds.** The morning again, and the day's outcomes recorded.

## 2. The bad day

**A parvo outbreak.** One dog tests positive. Every animal in that ward is now *exposed* and
must be traced by contact and housing history. The ward is quarantined: no adoptions from it,
no intake into it, deep clean, staff movement restricted. Any animal already adopted out from
that ward in the incubation window must be traced and the adopters called.

This tests whether housing history is a **timeline** rather than a current-location field. If
the system only stores "where is this animal now", contact tracing is impossible.

**A hoarding seizure.** Animal control arrives with forty cats from a cruelty case. All are
legal **evidence** — they cannot be adopted while the case is open, regardless of health or
space. They arrive at once, exceeding capacity, requiring emergency foster placement and
possibly a temporary annex. Each needs individual documentation to evidentiary standard.

**Capacity crisis.** When intake exceeds outcomes for long enough, a shelter faces
euthanasia-for-space decisions. This is a real, legally and ethically governed process and the
platform must handle it rather than look away — see §4.

## 3. The periodic cycle

- **Monthly** — statistics: intakes by pathway, outcomes by type, average length of stay, and
  **live release rate**, the sector's headline KPI. Many shelters report to a national dataset
  on a standardised schema; municipal contracts usually mandate it.
- **Monthly** — controlled-substance reconciliation. Euthanasia solution is a controlled drug
  with a legally required log that must balance.
- **Quarterly/annual** — facility licensing and inspection; rabies vaccination reporting to the
  county; vaccine lot and expiry audits (cold chain); grant reporting against restricted funds.
- **Seasonal** — kitten season. Intake can triple. Capacity planning is annual, not ad hoc.

## 4. Load-bearing obligations

The audit's completeness prompt: *what, if it stopped for a week, would harm an animal or break
the law?* These are the ones that must not be optional.

| Obligation | Why it is load-bearing |
|---|---|
| **Stray hold period** | Statutory. Adopting or euthanising inside it is unlawful and destroys an owner's property rights. Duration varies by jurisdiction and by whether the animal has ID. |
| **Bite quarantine** | Public-health mandated, typically 10 days, reportable to the health department. |
| **Rabies vaccination + certificate** | Legally required; certificate is a controlled document, often county-reportable. |
| **Spay/neuter before adoption** | Statutory in many jurisdictions; where deferred, a compliance obligation follows the adopter. |
| **Medication administration** | Missed doses harm animals. Must be scheduled, timed and signed. |
| **Isolation / biosecurity** | An outbreak can kill an entire ward. |
| **Controlled substance log** | Euthanasia solution must reconcile. Failure is a criminal matter. |
| **Cruelty-case evidence chain** | Animals held as evidence cannot be rehomed; documentation must survive court. |
| **Interstate transport health certificate** | A CVI is required to move animals across state lines. |
| **Outcome statistics** | Usually contractual with the municipality and required for grants. |

**Jurisdiction is a first-class input.** Hold length, quarantine rules, licensing, reporting and
mandatory spay/neuter all vary by state and often by county. The rescue's location determines
its obligations, so jurisdiction cannot be a label — it must drive rules.

## 5. Required entities

Grouped by dependency. Nothing below depends on anything beneath it.

**Subject**
1. **Animal** — an identity that exists independently of any public listing, from the moment of
   first contact. Species, breed, sex, DOB estimate, colour/markings, microchip, ID tag, weight
   series, status, jurisdiction. Must support litters (dam linkage) and community cats.
2. **Animal photo set** — many photos over time, typed (intake, current, medical, marketing).
   One `primaryPhotoAssetId` is a catalog field, not a record.
3. **Identifier** — microchip number, registry, registration status, rabies tag, licence.

**Arrival**
4. **Field/stray report** — a report that precedes the animal: reporter, location, description,
   photo, dispatch, outcome. A found-animal report may never become an intake.
5. **Intake** — pathway (stray, surrender, transfer-in, born-in-care, seizure, return),
   date/time, source, finder or surrenderer, condition, and the **hold clock**.
6. **Lost-pet report and match** — searchable against intakes; produces return-to-owner.

**Housing**
7. **Housing unit** — kennel, run, cage, condo, stall, or a foster home. Capacity-bearing, with
   species suitability, isolation capability, and **a position that includes tier** because cat
   condos stack. Canonical analogue: `Resource` (`kindSlug`, `capacity`, `capacityUnit`).
8. **Housing placement** — a *timeline*, not a current field. Contact tracing and length-of-stay
   both need history.
9. **Ward / zone / site** — grouping for biosecurity and rounds order. Foster network is a site.
10. **Kennel layout** — a visual, editable map with an optional floor-plan underlay, supporting
    stacked units. Canonical analogue: `OperationalSceneLayout` (`spaceKind: cartesian-interior`,
    `layoutState`, `underlayRef`).

**Care**
11. **Care round** — a scheduled sweep producing a per-animal record: fed, watered, cleaned,
    medicated, observed. Signed and timed. Must work one-handed on a tablet, and tolerate
    losing signal in a concrete kennel block.
12. **Medical record** — exams, diagnoses, weights, treatment plans.
13. **Vaccination schedule** — protocol-driven, with due dates, boosters, lot numbers, expiry.
14. **Medication course** — drug, dose, route, frequency, start/end, administration log.
15. **Procedure** — spay/neuter, dental, surgery; partner practice, cost, outcome.
16. **Behavioural assessment** — determines adoptability and handling level (the colour-coded
    collar most shelters use), and restricts who may handle the animal.
17. **Hold** — typed and clock-bearing: stray, bite quarantine, medical, evidence, adoption
    reservation. Multiple holds may run at once. **A hold must be able to block an action.**
18. **Euthanasia record** — authorisation (who may decide), reason code (medical, behavioural,
    capacity, owner-requested), method, controlled-substance draw linked to the log, witness,
    body disposition, and reporting. Also **died-in-care**, which is a distinct outcome.

**Placement**
19. **Adopter / applicant** — application, screening (landlord, vet reference, home check),
    approval state.
20. **Meet-and-greet** — appointment *and* walk-in; scheduled against animal, adopter and staff.
21. **Adoption** — contract, fee, spay/neuter compliance, microchip re-registration, follow-up,
    return window.
22. **Outcome** — the standardised set: adoption, return-to-owner, transfer-out, euthanasia,
    died-in-care, lost-in-care, returned-to-field, disposal. **Statistics depend on this being a
    controlled vocabulary, not free text.**
23. **Foster placement** — foster home, skills/capacity, supplies issued, check-ins, return or
    conversion to adoption.
24. **Transfer** — partner in/out, transport run, health certificate.

**Sustaining**
25. **Supply stock** — food, litter, bedding, medication, vaccine (lot, expiry, cold chain),
    controlled substances (reconciled).
26. **Funding** — donations, animal sponsorship, **restricted funds and grants with reporting
    obligations**, municipal contracts with per-animal reimbursement, adoption fees, in-kind.
27. **Volunteer** — shifts, training level, background check, hours.
28. **Event** — adoption events, offsite, vaccine and TNR clinics, fundraisers.
29. **Jurisdiction rule set** — hold lengths, quarantine, licensing, reporting, mandatory
    spay/neuter, driven by the rescue's location.
30. **Compliance calendar and statutory reports** — licence renewals, inspections, rabies and
    bite reporting, monthly statistics, controlled-substance reconciliation.

## 6. What exists today — measured 2026-08-25

The entire animal surface in the shipped product is `/storefront/animals`:

> **Adoptable animals** — "These appear in the 'Animals available for adoption' section of your
> public storefront, each with their photos."
> Fields: **Name\*, Species, Breed, Age, Sex, Size, Description** -> *Add animal*

`AdoptableAnimal` requires `storefrontId` and cascade-deletes with the storefront. Every consumer
is a storefront surface — the public section, the storefront admin manager, the catalog API.
There are no operational surfaces at all.

Verified absent — searches over `packages/db/prisma/schema/*.prisma` returning zero:
`StrayReport`/`FieldReport`/`IntakeRequest`, `Kennel`, `Euthan*`, `Vaccinat*`/`Immuniz*`,
`Microchip`, `Foster`, `WalkIn`. Apparent hits for "tier" (`riskTier`, `hitlTier`) and
"jurisdiction" (AI-coworker `us|eu|uk` practice scopes) and `legalHold` (a care-records flag)
are **decoys** — none relate to animal welfare.

**Score: 3 of 60 — coverage 0.05.** Of 30 required entities, one is partial (Animal, as a
catalog row = 1), one is partial (photos, single primary asset = 1), one is vertical-bound but
reachable in principle (housing via `Resource` = 1), and 27 are absent. This supersedes the
0.28 recorded on 2026-08-22, which scored 18 nouns drawn from a thinner operating day; that
figure was optimistic because the day it was scored against was incomplete.

**Canonical analogues that already exist and are simply unreached:**

| Need | Existing model | Note |
|---|---|---|
| Housing unit | `Resource` | `kindSlug` is an open vocabulary; `capacity` + `capacityUnit` already generic |
| Kennel layout | `OperationalSceneLayout` | `spaceKind: cartesian-interior`, `layoutState`, `underlayRef` floor plan — already generic, not restaurant-welded |
| Intake / staged admission | `CareIntakePacket` (+response, access-grant, exception, status-event) | **Already subject-agnostic.** Carries required `subjectKindSlug` + `subjectRef`; `patientProfileId` is nullable. |
| Scheduled event against a subject | `CareAppointment` | **Already subject-agnostic**, same subject-reference contract. |
| Scheduling | `ResourceAvailability`, `ResourceCapacityAllocation` | generic |
| Photos | `MediaAsset` / `MediaAttachment` | already many-to-one capable |

Ratified direction (BI-51C95802): **generalise `verticals-care`** into a subject-agnostic care
substrate rather than cloning it or promoting the catalog row.

## 7. UX requirements

The operator's standing requirement: *to the point for the intended activity, minimal cognitive
overload, no erroneous distractions for day-to-day workers.*

**Measured 2026-08-25.** In `Full` mode a logged-in user sees a platform cockpit: Portfolio,
Backlog, Architecture, Delivery, Build Studio, AI Workforce, Platform Hub, Admin, Knowledge,
Coworker Decision Engine. A kennel tech doing morning rounds has no business seeing a build
pipeline.

**`Simple` mode works and deserves credit.** It cuts navigation from ~25 destinations to 9,
removing every builder and platform surface:

```
Operations (here) · Customer · People · Finance · Compliance · Portal ·
Knowledge · Coworker Decision Engine · All docs
```

**But it is generic-business, not rescue-operational.** Of those 9: "Customer" is wrong
vocabulary — a shelter has adopters, surrenderers and finders, not customers; "Coworker Decision
Engine" and "All docs" are platform concepts; and **there is no animal destination at all.** No
Animals, no Rounds, no Intake, no Kennels. The only animal surface in the product sits under the
storefront admin at Portal -> Animals, i.e. filed under *marketing*.

So the correct finding is not "the UI is cluttered" — the density problem is already solved.
It is that **simplification reveals there is nothing operational underneath.** A kennel tech
given `Simple` mode still has no destination for the work they actually do.

**Per-role surfaces required:**

- **Kennel tech (rounds)** — the highest-volume surface in the building. One ward at a time, in
  biosecurity order, one animal per card, large touch targets, glanceable meds-due flags,
  single-tap completion, works one-handed on a tablet, tolerates loss of signal. Must show
  nothing about donations, marketing or the storefront.
- **Intake staff** — a single fast flow: scan chip, photograph, weigh, record found-location,
  start hold. Under 90 seconds with an animal in one arm.
- **Medical** — today's treatments, meds due, surgery schedule, overdue vaccines.
- **Adoption counsellor** — applications queue, today's meet-and-greets and walk-ins, and a
  clear reason when an animal is **not** adoptable today.
- **Manager** — capacity and population pressure, live release rate, length of stay, compliance
  deadlines.

**Cross-cutting UX rules:**

1. **A blocked action must state its reason.** "Not adoptable — stray hold until Thu 14:00" is
   the requirement; a greyed-out button is a failure.
2. **Location must be legible as a place**, including tier for stacked cages. "Cat Room B, row
   3, column 2, tier 3" or a visual map — never an opaque id.
3. **Kennel cards must print.** A physical sheet on the door is a real artifact of this business.
4. **Species-appropriate vocabulary.** A ranch has head of cattle, a shelter has animals in care;
   neither has "items".
5. **Never present an animal as priced merchandise.** Adoption fees are fees, not prices. This
   is both a dignity issue and a legal one.
6. **Euthanasia surfaces must be plain, unavoidable and complete** — authorisation, reason,
   controlled-substance link, disposition. This is the most sensitive workflow in the building
   and it must not be euphemised, hidden, or left to a free-text note.
7. **Read the whole page for cognitive load**, including nav. The existing UX-budget gate already
   measures reading grade over the whole page including navigation.

## 7b. The adoption listing — researched against the industry standard

Added 2026-08-26 after the founder asked whether the listing had been researched rather than
assumed. It had not been. This section is the corrected baseline.

**This is the primary business-to-consumer interaction of the archetype.** Adoption is driven by
a photo and a name, and the standard acquisition path is one specific animal being shared to a
prospective adopter.

**Rescues do not primarily rely on their own site.** RescueGroups.org syndicates to **40+**
destinations including Petfinder, Adopt-a-Pet, the ASPCA and Chewy. Petfinder's animal schema is
the de-facto standard, so listing fields must map to it or the archetype cannot reach adopters
where they actually look.

Required listing fields (Petfinder-aligned):

- **type**: dog, cat, rabbit, small-furry, horse, bird, scales-fins-other, barnyard
- **breed**: primary, secondary, mixed flag, unknown flag
- **age**: controlled vocabulary `baby | young | adult | senior` — never free text
- **size**: small, medium, large, xlarge · **gender** · **coat**: short, medium, long, wire,
  hairless, curly · **colors**
- **environment**: good_with_children, good_with_dogs, good_with_cats — typed booleans
- **attributes**: house_trained, spayed_neutered, shots_current, special_needs, declawed
- **status**: adoptable | adopted | found (map DPF's available/pending/hold/adopted to this)
- **photos** (many) and **videos**; **tags**; **adoption fee**; **location + distance**
- sort by recent and by distance; filter on every controlled field above

Required listing behaviour:

1. **Each animal has a stable public URL and a detail page.** Without it an animal cannot be
   shared, and sharing is the acquisition channel.
2. **Per-animal inquiry** carrying the animal reference, so staff know who is being asked about.
3. **Filtering and sorting** on the typed fields.
4. **Syndication export** to the standard schema.

**Anything an adopter filters on must be a typed column.** Storing good-with/house-trained in an
untyped `attributes` Json makes the filter impossible to build — the concrete case for the
accommodation doctrine's rule that a cross-surface queried field graduates out of Json.

## 8. Definition of done

The archetype may be described as supported when:

1. An animal exists from first contact, independent of any public listing.
2. All six intake pathways are representable, each with its correct hold behaviour.
3. Housing is a capacity-bearing unit with a **position including tier**, a visual layout, and a
   **placement history**.
4. A care round can be completed on a tablet for a full ward, signed and timed.
5. A hold can **block** an action and explain itself in the UI.
6. Outcomes use the standardised controlled vocabulary and produce monthly statistics including
   live release rate.
7. Euthanasia is fully modelled including authorisation and controlled-substance reconciliation.
8. Jurisdiction drives rules rather than labelling them.
9. Restricted funds and municipal contracts are distinguishable from general donations.
10. Each role's primary surface passes a cognitive-load review with no platform-builder
    navigation present.
11. Coverage score re-measured and recorded, with the date.

An archetype below **0.6** must not be described as supported in external material.
Current: **0.05**.
