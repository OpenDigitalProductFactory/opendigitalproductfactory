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

## 5b. The operators

§5 lists what the business holds. This section lists **who does the day**, and it is scored under
operability rather than coverage so the thirty-entity denominator above stays comparable.

Added 2026-08-26 after running the day proved that a complete §5 would still leave the rescue
unable to staff itself.

**Roles the operating day requires.** Every one appears by name in §1:

| Role | Steps in §1 it performs |
|---|---|
| Kennel technician | 06:30 and 17:00 rounds, the highest-volume job in the building |
| Intake officer / front desk | 08:00 stray, 09:00 surrender, 14:00 found-pet call |
| Veterinary technician / medical lead | 09:30 exams, vaccines, medication rounds, 15:00 transport |
| Adoption counsellor | 11:00 meet-and-greets and walk-ins, applications, home checks |
| Foster coordinator | 13:00 placement, supplies, check-ins, returns |
| Volunteer coordinator | Shifts, training levels, background checks, hours |
| Shelter manager | 16:30 capacity, live release rate, compliance deadlines, euthanasia authorisation |
| Transport driver | 15:00 vet runs, partner transfers, health certificates |

**Worker classes.** A rescue's largest labour pool is **volunteers**, not employees — unpaid,
shift-based, with training levels and background checks that gate what they may handle. Foster
carers are a second unpaid class, housing animals off-site. Neither is an employment type in the
usual full-time / part-time / contractor sense, and both must be first-class or the roster is
fiction.

**Work locations are operational places**, not office arrangements: dog ward, cat room, isolation,
intake, the surgery, a foster home, an offsite adoption event. Headquarters / hybrid / remote does
not describe anywhere an animal lives.

**Shipped 2026-08-27 — the vocabulary, not yet the roles** (`BI-A30152B6`). `EmploymentType` and
`WorkLocation` are open tables, not enums, and `WorkerClassification` already carried `volunteer`
and named it "the majority classification for nonprofit and community archetypes". So this needed
no new structure, only rows:

- **Volunteer** joins the platform defaults, because the canonical enum had already anticipated it
  and no install could record one.
- **Foster carer** and the seven operational locations above are declared on the archetype
  (`workforceProfile`) and applied to the install that actually runs that archetype, so a
  restaurant never acquires a cat room. A class an archetype needs is now a row it contributes,
  not a closed set the platform widens.
- A classification is written on create only. The four seeded types a migration left unresolved
  stay unresolved: an unpaid worker directed like an employee is a wage claim, and a confident
  wrong answer is the most damaging kind available.
- A boot reconciler applies the rows to an install that finished onboarding before the archetype
  declared them. Without one this fix would have been invisible on every existing install: the
  seed chain re-runs on boot only for an organization whose WWWD corpus is missing, and a healthy
  install short-circuits that check. *A seed that only runs at setup completion has not shipped to
  anyone who completed setup — check for the reconciler, not just the seeder.*

**Still open on `BI-A30152B6`, and why:**

- **The eight roles above are not seeded.** Roles live in `packages/db/data/occupation_registry.json`,
  which has thirteen entries across healthcare, trades, agriculture and manufacturing and **none**
  for nonprofit-community — which is why the only role vocabulary a rescue manager sees is the
  platform's own `HR-000`..`HR-600` ladder. Each entry carries a coworker roster, a feature
  surface and an onboarding curriculum that must all resolve, so the eight roles are a piece of
  work in their own right, not a list to paste in.
- **Recruiting still has no create control**, and an employee record still grants no access — the
  sign-in is a separate create in Admin, so the counts read "2 people / 1 user" with nothing
  joining them.
- **Role is still write-once** in the UI.

**Authorisation follows the role, and some of it is statutory.** Euthanasia authorisation belongs
to named people. Controlled-substance draw belongs to fewer. A behavioural assessment restricts
who may handle an animal — the colour-coded collar is an access rule, not a label. Conversely a
volunteer walking dogs needs the rounds surface and nothing else.

**The reachability requirement.** Each role must be able to open the surfaces its steps need,
signed in as itself. A model only the founder can reach is a single-operator business regardless
of how complete the model is.

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

## 6b. What can be done today — measured by running the day, 2026-08-26

§6 measured the schema. This section measures a **run**: the §1 operating day performed in order
on a live install, as the founder and then as two newly created staff accounts.

**Operability 0.30** — of ten steps, **0 completed, 6 partial, 4 impossible**. Coverage on the
previous day was 0.05. Both figures stand; they measure different things.

| Step | Outcome | What stopped it | What the operator did instead |
|---|---|---|---|
| 08:00 stray intake | partial | No field for finder, location, time, condition, weight, chip result, hold clock or housing | Paper intake form; hold date on the corridor whiteboard |
| 09:00 owner surrender | partial | One admission path only; no pathway, ownership transfer, reason code, or safe place for bite history | Surrender form signed on paper; bite history on the cage card and by voice |
| 09:30 rounds | impossible | No round, care record, medication log or observation field | Clipboard, printed grid, transcribed nowhere |
| 10:00 medical | impossible | No vaccination record or booster dates; the calendar cannot create | Phoned the clinic; paper desk diary |
| 11:00 walk-in adopter | partial | No per-animal page; hold shows without reason or date; reservation is free text, not a hold | Sticky note on the kennel card and a promise to call |
| 12:00 publish and share | partial | No typed listing attributes; no per-animal URL to share; only the lead photo reaches the public | Posted the photos to social media by hand |
| 13:00 found-pet call | impossible | Zero search or filter controls, and nothing searchable was recordable at intake | Walked the paper binder back three weeks |
| 14:00 foster placement | impossible | No foster home, placement, supplies or return date; no status meaning in-foster | Group text and a shared spreadsheet |
| 15:00 adoption | partial | Status change worked and reached the mission metric; no contract, fee, spay/neuter compliance, chip re-registration or typed outcome | Contract on paper, fee on the card reader, chip re-registered on the registry's own site |
| 16:00 numbers | partial | Outcomes correct; kennels-free unanswerable; intakes not recorded as intakes | Counted the ward on foot |

**One row above is half wrong, and the correction is worth keeping.** The 10:00 finding recorded
that "the calendar cannot create". Driving the live install on 2026-08-27 found that clicking a
day *does* open a chooser offering **Create event** and **Schedule AI coworker**, with no page
error. What is true is that the page carried **no create control at all**, so the only way in was
a gesture nothing announced, and the workspace agenda linked here promising "a booking, invoice,
or appointment" — three things this calendar does not make. Both were fixed (`BI-460BFA84`): the
calendar now has a *New event* control, and the agenda promises what the calendar does. **The
remaining half of the 10:00 step stands:** `CareAppointment` is subject-agnostic and already
built, but the business calendar neither reads it nor writes it, so a spay/neuter slot is a
free-text event rather than an appointment against the animal. *A step recorded as impossible
because a control could not be found is a discoverability finding, not a capability one — check
which before designing the fix.*

**A second row needs correcting, in the other direction.** The 16:00 step recorded the outcomes as
correct. They were correct while empty. Two gifts taken through `/s/rescue/donate` — $50 and $25,
one currency, on a workspace that has never held a second — turned **Donations received** into
`Unavailable · Multiple donation currencies are not combined`. Two defects met there. First,
`submitDonation` stamped a hardcoded `GBP` on every gift while the donate page rendered the
workspace's own symbol, so a USD install showed the donor `$50` and wrote GBP to its books; every
gift on every non-GBP install was affected, not only this archetype. Second, `summarizeDonations`
counted rows rather than currencies — `matching.length !== rows.length` is true whenever the gifts
are in *any* single currency other than the workspace's — so one currency reported as several and
the tile withheld a total it already held. Both fixed (`BI-685ADDCD`): the stored code now comes
from `OrgSettings.baseCurrency`, the same source the symbol comes from, and gifts sharing one
currency total wherever that currency came from. A genuine mix shows each currency side by side
rather than nothing. **The two recorded gifts still carry `GBP`** — the platform does not silently
rewrite the currency of an amount someone gave, so correcting them is the operator's call.
*A metric that was honest while empty has not been measured. Populate it before scoring it.*

### What the run found that §6 could not

Three findings sit outside the thirty entities entirely, and each alone prevents the business
running as more than one person with a clipboard:

1. **No hireable role may see an animal.** `HR-600 Workforce Member` and `HR-500 Operations
   Manager` are both refused the only animal surface; only the superuser reaches it. Recruiting
   has no create control, the organization has zero departments and zero positions, and employment
   type has no volunteer. See §5b for what the day actually requires. *(BI-2777B86B, BI-A30152B6)*
   **The navigation half was fixed 2026-08-29**: the shell breadcrumb offered both roles a *Portal*
   crumb to `/storefront` — the one page whose layout refuses them — because the rail filtered on
   `view_storefront` and the trail filtered on nothing. Both now read the same granted set, so the
   product no longer advertises a door these roles cannot open. **The refusal itself stands.**
   Granting storefront-manage to an operational role would make the 404 go away and cement animals
   living under storefront and marketing administration, which is the actual defect
   (`BI-4F8A484C`).
2. **Every public inbound channel requires a donation.** Both the adoption enquiry and the
   site-wide contact form reject a submission without a donation amount, so the found-pet caller,
   the surrendering owner and the would-be volunteer are all turned away at the door. This stands
   in front of the §7b interaction the whole archetype depends on. *(BI-7F851119)*
3. **Operational notes are published, and cannot be taken back.** Recording an intake put a
   finder's name, telephone number and home address on the open web within seconds, and every
   descriptive field is write-once, so the only redaction is deleting the animal and its
   photographs. *(BI-56BB6038)* **Half fixed 2026-08-27**: species, breed, age, sex, size and
   description are now correctable on the animal, behind a per-card disclosure, and a refused
   save says so instead of leaving an edit that only looks applied. Publication itself is not
   fixed — the description is still the animal's only text field and it is still public marketing
   copy, so intake detail has nowhere private to go until `BI-4F8A484C` gives an animal an
   existence independent of its listing.

### What worked, and is now a regression surface

- Photo handling end to end: multi-file upload, lead selection, reorder, responsive `srcSet`
  160→1280w, lazy loading, real alt text.
- `hold` renders publicly as "On hold"; `adopted` removes the animal from the listing.
- One number went end to end: recording the adoption moved **Animals placed** from 0 to 1.
- Consumer vocabulary is right — Donate, Adopt, Enquire; no price on an animal.
- The cockpit puts storefront enquiries above the platform attention list.
- `/performance` refuses to show numbers it has not computed.
- The sixteen value-stream stages carry no chevron and nothing that reads as clickable, and the
  fifteen with no queue bound to them show a dash rather than a zero no query could have produced
  (`BI-AF50DBD5`; re-verified 2026-08-29 at 1440 and at 768x1024).
- No horizontal overflow at 768×1024 on any surface tried.

### Two archetype-specific traps for the next run

**`hold` is one word doing three statutory jobs.** A stray hold, a bite quarantine and an adoption
reservation are all recorded as `status = hold`, with no clock, no reason and no ability to block
anything. Two animals in the ward carry legally different obligations and are indistinguishable on
screen. This is the concrete case for element 10 of the canonical minimal substrate.

**Destructive controls are undersized for the tablet the work is done on.** At 768×1024 the
per-animal Delete measured 59×28 px and the photo remove control 24×24, both unconfirmed, on the
device a kennel technician holds one-handed. **Both fixed** — the per-animal Delete on 2026-08-27,
the photo remove on 2026-08-28. Each asks first, and every one of the four controls carries a 44 px
target.

**The tablet worker could not reach Simple mode — the one thing §7 credits with solving the density
problem for them.** The Simple/Full toggle and its mode explanation lived inside
`#primary-navigation-menu`, which is `hidden` below `lg`, so at 768px the buttons measured 0×0 with
a null `offsetParent` and the explanation vanished. The kennel technician doing rounds was locked
in Full mode, looking at Build Studio, Backlog, Architecture, Delivery, Platform Hub and Admin
while recording that a dog had been fed. Fixed 2026-08-28 (`BI-6395DA89`): the mode control sits
outside the collapsible menu and is reachable at every width; the destinations themselves still
collapse. *A control inside a responsive disclosure is not reachable — measure the control at the
width the work is done at, not only at desktop.*

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

## 7c. Inbound channels — every reason a stranger arrives

Added 2026-08-26 after a run found the single channel that exists gated behind a donation.

§7b covers the listing, which is how someone finds an animal. This section covers how anyone
reaches the rescue at all. A shelter's inbound traffic is not one funnel:

| They arrive to | Urgency | Must reach |
|---|---|---|
| Adopt a specific animal | days | Adoption counsellor, carrying the animal reference |
| Report a found animal | **hours** | Intake, matched against open lost-pet reports |
| Report a lost animal | **hours** | Intake, matched against recent stray intakes |
| Surrender an animal | days | Intake appointment queue |
| Report cruelty or an animal at risk | **immediate** | Manager, and often animal control |
| Offer to foster or volunteer | weeks | Foster or volunteer coordinator |
| Donate, or ask about a bequest | weeks | Fundraising |

Four requirements follow:

1. **No inbound channel may require payment.** A donation prompt in front of a found-pet report is
   the worst failure available to this archetype. **Met 2026-08-27** (BI-7F851119): the five
   nonprofit archetypes were seeded with a donation form in the contact-form slot, and
   `donationAmount` was required. They now take the contact fields, including the phone number a
   found-pet caller has to leave, and `resolveInquiryFormSchema` drops donation fields from any
   enquiry that is not about a donation item, so an install seeded before the fix is corrected
   without a re-seed. Donations keep their own route and their own form. **The same form still
   serves all seven reasons** — requirement 2 below is open.
2. **The reason for contact is a typed field**, because it sets the queue and the clock. A cruelty
   report and a bequest enquiry cannot share a lane.
3. **An enquiry about an animal carries that animal's reference**, or staff cannot answer it.
4. **A reply is possible from inside the product.** Today the only action on an enquiry is to
   convert it into an internal work item; there is no reply.

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
11. Every role in §5b can sign in and reach the surfaces its steps need, volunteers and foster
    carers are first-class worker classes, and work locations name real places in the shelter.
12. Every inbound reason in §7c reaches the right queue, none of them behind a payment, and staff
    can reply from inside the product.
13. An operational fact that must not be public — bite history, medical detail, a finder's
    contact details — has a non-public home, and anything published can be corrected afterwards.
14. Coverage score and operability re-measured and recorded, each with its date.

An archetype below **0.6 coverage** must not be described as supported in external material, and
below **0.8 operability** must not be described as operable. Current: **0.05 coverage**
(2026-08-25), **0.30 operability** (2026-08-26).
