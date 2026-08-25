# Archetype Business Value Streams

**Status:** Draft — 2026-08-01 (106/24 source catalog reflected, including agriculture/ranching; lifecycle seam corrected to explicit DigitalProduct bindings)
**Kind:** Planning artefact (architecture + testing + archetype documentation)
**Owner surface:** Architecture feature (`/ea`), archetype documentation, and the archetype audit.
**Consumed by:** [archetype-audit-plan.md](../testing/archetype-audit-plan.md) · the EA / architecture feature · per-archetype documentation.
**Implemented by:** [2026-06-12-value-stream-architecture-platform-design.md](../superpowers/specs/2026-06-12-value-stream-architecture-platform-design.md) — platform design that captures these value streams as architecture, measures/optimizes each archetype's business model, and drives coworker facilitation + proactivity (the *how*).
**Grounded in:** `packages/storefront-templates/src/archetypes/` (106 seeded archetypes across 24 categories as of 2026-08-01) and `packages/storefront-templates/src/types.ts` (operating-model axes, commercial models, activation profiles).
**Decision authority:** Defines value-stream interpretation, audit severity rationale, EA rendering semantics, and archetype documentation language. It does **not** override seed data, create new runtime tables, or authorize WWMD/WWWD perspective blending.

> **Current standards authority (2026-08-01).** This document remains the detailed operational and
> audit profile for the six-stage archetype backbone. The
> [Four-Portfolio Archetype and AI Workforce Operating Standard](four-portfolio-archetype-ai-workforce-operating-standard.md)
> now owns the distinction among industry value streams, local DigitalProduct lifecycle keys,
> portfolios, work, performers, evidence, and candidate external mappings. External equivalence
> requires the complete authorized mapping envelope in that standard.

---

## 0. Why this document exists

The archetype audit drives 106 seeded archetypes through a browser-realistic experience and records gaps. The risk it names in its own Section 1 — *"The platform must behave correctly for each organizational model"* — is that **testing becomes arbitrary**: we click through phases A–H because the checklist says so, not because each click defends something the business actually depends on.

This artefact removes the arbitrariness. It states, for every archetype, **the operational value stream the business runs in the real world** — the end-to-end sequence of value-adding stages that creates the outcome its stakeholders rely on. For a commercial business this may turn a stranger into a served, paid, retained customer. For a rescue it moves an animal through safe intake, health and welfare, and placement. Every test phase then exists to validate a *named stage of a real value stream*, and every finding can be tied to *the stage of the business it threatens*. A vet booking form that drops the pet fields is not "an important finding because the checklist says pet fields" — it is a **break in the Capture-Demand → Deliver-Care handoff** that makes the clinic's core value stream non-functional.

Four consumers, one source of truth:

1. **Testing & validation** — the audit phases map to value-stream stages (Section 4). A finding cites the stage it breaks; severity follows from how load-bearing that stage is for the archetype.
2. **Architecture feature** — the value streams render against the substrate the platform already carries (`OperatingModelAxes`, `ActivationProfile`, `It4ItStage`, `PortfolioDecomposition`) and export to ArchiMate (Section 8).
3. **Archetype documentation** — each archetype's "how this business actually works" narrative (Section 6) is the human-readable answer to *why* its storefront, vocabulary, scheduling, finance, and compliance defaults are shaped the way they are.
4. **Business-context decision substrate (WWWD)** — the value-stream architecture and its concerns are foundational input to the org's own *"What Would We Do"* decision perspective: the governed profile of how *this business* operates and decides. See Section 8.8 for the WWWD-vs-WWMD context separation.

**Reader contract.** This document is deliberately both architectural and operational. Architects use it to bind value stages to capabilities and export semantics. Testers use it to justify severity. UX designers use it to decide what the operator should see first. Business analysts use it to turn a vague gap ("booking feels wrong") into a stage-specific requirement with acceptance evidence ("S3 Schedule ignores provider capacity for an appointment-checkout business").

---

## 1. Two senses of "value stream" — keep them distinct

The platform already has a canonical [Value Stream entity](../founder-kernel/wiki/entities/value-stream.md)
and a local seven-key DigitalProduct lifecycle vocabulary — Evaluate, Explore, Integrate, Deploy,
Release, Operate, Consume. These keys describe how DPF plans, changes, supplies, consumes, and runs
DigitalProducts. Their correspondence to any external reference architecture remains
`present-unverified` until an authorized mapping is completed.

This document is about the other sense: the **operational value stream of the customer's business** — *how a salon, a bank, or a town creates and delivers value to its own end customers*. The two relate cleanly:

| | DPF DigitalProduct lifecycle keys | Operational value streams (this doc) |
|---|---|---|
| Whose flow | Any organization managing a DigitalProduct lifecycle | The archetype business serving its customers |
| Canonical slugs | `evaluate … consume` | leaf-defined stage slugs, or `attract · capture · qualify · deliver · settle · retain` as the fallback (Section 3) |
| Example | "Voice STT slice moves Explore→Integrate→Deploy" | "A vet clinic moves a pet from booking → exam → invoice → recall" |
| Standards posture | local lifecycle vocabulary; IT4IT™ is a future authorized comparison target | FPAW Stage contract; BACM/ArchiMate® are future representation-review targets |

> **Current semantic authority:** FPAW defines a Stage as a measurable stakeholder-value state
> transition with acceptance, capability/work realization, evidence and measures. BACM and
> ArchiMate® are reference-only targets for future authorized representation mappings; this document
> does not use their publications to substantiate the local contract.

This distinction matters. A value stream is not a click path, process map, or implementation workflow. A value-stream stage may be realized by multiple UI flows and processes, and one UI flow may touch multiple stages. The stage names therefore stay stable even when the portal design changes.

The bridge is a typed, many-to-many relationship—not containment. An industry stage stands on its
own because it describes stakeholder value whether the work is digital, human, physical, or mixed.
When a DigitalProduct enables or constitutes part of that stage, the implementation maps the exact
touchpoint to a named DigitalProduct and local lifecycle key with relationship, rationale, evidence,
and binding state. An external stream identifier may be added only through the authorized FPAW
mapping contract. A consumption interaction never contains the customer's complete operational
value stream.

---

## 2. The default small-business value stream

The commercial backbone recurs across most of the 106 archetypes. It is the subject-agnostic fallback when a leaf archetype does not define a more truthful process. Differences usually concern **which stage is load-bearing, what "value delivered" means, and which trust gate governs it.** The fallback backbone:

```
                 ┌─────────────────── TRUST & COMPLIANCE (cross-cutting) ───────────────────┐
                 │                                                                            │
  S1 ATTRACT  →  S2 CAPTURE  →  S3 QUALIFY  →  S4 DELIVER  →  S5 SETTLE  →  S6 RETAIN
  & Discover     Demand          & Schedule     the Value      & Account     & Grow
                 │                                                                            │
                 └────────────────── OPERATE & IMPROVE (cross-cutting) ──────────────────────┘
```

**Primary stages**

| Stage | The value increment | What the operator must be able to do |
|-------|---------------------|--------------------------------------|
| **S1 Attract & Discover** | The business is *found* and its offer is *legible* to the right person. | Publish a public portal with correct hero, services/products, vocabulary, and CTA label that matches the business. |
| **S2 Capture Demand** | Intent is *captured without friction* — the moment money or commitment becomes possible. | Drive the archetype's primary CTA (book / quote / buy / donate / apply) end-to-end and issue a reference. |
| **S3 Qualify & Schedule** | Demand is *triaged, assigned, and slotted* against real capacity. | Route the inbox item, assign staff, place it on a calendar that reflects real availability and hours. |
| **S4 Deliver the Value** | The core thing the customer actually pays for *happens* (the cut, the exam, the loaf, the loan decision, the permit). | Hold the records the delivery needs — customer/account, pet/asset/unit, the service item — so delivery is informed, not improvised. |
| **S5 Settle & Account** | Money is *recognised correctly* — invoice, receipt, bill, P&L — even when DPF never moves the money. | Record the bill/invoice/donation receipt; see revenue and expense land truthfully in the P&L. |
| **S6 Retain & Grow** | The relationship *persists* — repeat, recall, renewal, membership, feedback. | Keep the customer estate, surface the next interaction, let the coworker reason about the relationship. |

**Cross-cutting concerns** (govern every stage; failures here are not optional polish):

- **Trust & Compliance** — the right vocabulary (patients, members, ratepayers, borrowers), the right disclosures (FDIC, NMLS, gift-aid), and the *refusals* a regulated business needs (no clinical/legal/financial advice; no CJI access). For licensed archetypes this is **load-bearing in S1–S2 already** — the offer is not legible if it is not compliant.
- **Operate & Improve** — the coworker and the ops backlog: the always-on operator's assistant that must speak the *business's* language, never the platform-developer's, and convert demand into operational work.

> **Reading guide:** a stage is *load-bearing* for an archetype when a defect there makes the business non-functional, not merely inconvenient. The per-category profiles (Section 6) name the load-bearing stage(s) for each archetype. Audit severity should track this: a defect in a load-bearing stage is `critical`/`important`; the same class of defect in a non-load-bearing stage is `minor`.

### 2.1 Leaf process profiles replace the fallback when the business works differently

`ActivationProfile.processProfile.valueStreams` is the canonical seam for a leaf-authored operating model. When populated, `deriveOperationalValueStream` projects those streams and does not append the commercial fallback. Each stream and stage carries its input, output, responsible role, trust gates, load-bearing status, and handoff target. The same derived model feeds Enterprise Architecture and the generated public archetype drill-down.

Pet Rescue is the first leaf profile on this seam. It defines three primary streams — **Intake and safe placement**, **Health and welfare**, and **Adoption and placement** — plus Fundraising, Volunteer Coordination, Supplies, Compliance, and Reporting as supporting capabilities. Its capacity-full decision, welfare exception, custody transfer, and failed-placement return are explicit stages. `Capture Demand` is therefore not presented as Pet Rescue's operating model.

The committed public projection is generated with `pnpm docs:business-types`; `public-process-projection.test.ts` fails if it drifts from the canonical archetype definition.

---

## 3. The commercial model decides the value-stream shape

The single axis that most changes the shape of the stream is `OperatingModelAxes.commercialModel` (see `types.ts`). It determines what S2/S5 look like and where the load-bearing stage sits. The eight shapes we actually ship:

| Commercial model | Archetype families | S2 Capture is… | S5 Settle is… | Load-bearing stage |
|------------------|--------------------|----------------|---------------|--------------------|
| **appointment-checkout** | beauty & personal care | book + pay at service; no running account | per-visit, no estate | **S3 Schedule** (the calendar *is* the product) |
| **encounter-based** | healthcare, veterinary | book an episode of care; estate carries patient/pet | per-encounter invoice against the record | **S4 Deliver** (the record must inform the encounter) |
| **transactional / point-of-sale** | retail, bakery, florist, artisan | add-to-cart → checkout → order ref | order-linked invoice | **S2 Capture** (catalog → cart → checkout must not drop) |
| **subscription** | gym, yoga, sports-club | join → recurring membership | recurring, not one-off | **S6 Retain** (the renewal, not the first sale) |
| **recurring-agreement** | IT MSP, facilities, cleaning contracts | inquiry → agreement; strict estate isolation | per-agreement, per-period | **S4 Deliver** under **strict estate separation** |
| **account-based-fees (+ KYC)** | banking, credit union, mortgage | inquiry/apply → KYC-gated relationship | fee schedule, prepared-not-prescribed | **Trust gate before S3** (KYC/disclosure precede everything) |
| **statutory-fees-and-levies** | municipality, utility, law enforcement | request a statutory service; no sale | fee schedule by ordinance | **Trust & universal-service obligation** (must serve every resident) |
| **donation** | charity, shelters, rescue, co-op | give; no invoice, receipt only | donation receipt, **no billing account** | **S2 Capture** + the *absence* of a purchase artefact |
| **quote / inquiry-to-engagement** | trades, professional services, catering, wholesale, HOA | capture a qualified lead → quote | ad-hoc invoice after delivery | **S2 Capture quality** (urgency/property/scope fields) |

This table is the *why* behind the audit's CTA-by-CTA Phase B5 scripts and the Phase G financial variants. It also explains the audit's three "full fresh install" rules (banking, MSP, public sector / law enforcement): those are exactly the models whose **trust gate precedes the value stream**, and a swap does not re-provision the gate.

---

## 4. The bridge — value-stream stage → platform surface → audit phase

This is the table the audit refers to when executing. It makes every phase non-arbitrary: each one defends a named stage. (`[A]` = archetype-specific evaluation target; `[C]` = common mechanic proven once in Run 0.)

| Value-stream stage | Platform surface (capability) | Audit phase(s) | What a failure here means for the business |
|--------------------|-------------------------------|----------------|--------------------------------------------|
| **S1 Attract & Discover** | Public portal: hero, sections, items, CTA label, vocabulary | A2–A4 (suggest), B1–B4, B6–B7 `[A]` | The business is invisible or mislabelled — the customer bounces before intent forms. |
| **S2 Capture Demand** | Primary CTA flow + reference number; domain form fields | B5, B5x `[A]` | Demand is lost at the exact moment of commitment — the worst possible failure. |
| **S3 Qualify & Schedule** | Team/availability, operating hours, booking calendar, inbox routing | P1–P3, B5 steps 3–4, F1–F4 `[C/A]` | Capacity is mismodelled — double-bookings, no-show economics, wrong staff. |
| **S4 Deliver the Value** | Customer estate, ConfigurationItem (pet/asset/unit), service item, scheduling defaults | P4–P5, B5 record-verify, E5 `[A]` | Delivery is uninformed — the wrong record, missing pet/asset/patient context. |
| **S5 Settle & Account** | Suppliers, bills, invoices, P&L, donation-receipt rule | G1–G6 `[C/A]` | Money is recognised wrongly or not at all — the operator cannot trust their own books. |
| **S6 Retain & Grow** | Customer account linkage, coworker memory, ops backlog | B5 step 7 (account link), E2–E5, F4 `[A]` | One-shot transactions; no recall/renewal/membership — the business cannot compound. |
| **Trust & Compliance** (X-cut) | Vocabulary overrides, disclosures/licensing, coworker refusals | C1–C4, E4, AI-3, VOCAB-1/2/3, GRC-1 `[A]` | Regulatory exposure, wrong persona language, advice a licensed body must not give. |
| **Operate & Improve** (X-cut) | Coworker routing/identity, inbox→backlog | AI-0/1/2, B6, F4 `[C/A]` | The operator's assistant speaks platform-dev language or cannot turn demand into work. |

> **Severity derivation rule for the audit:** locate the finding's stage in Section 6's per-archetype "load-bearing stages." A defect in a load-bearing stage → `critical` (flow broken / wrong data) or `important` (missing field/label/module). The same defect in a non-load-bearing stage → `minor`. This replaces ad-hoc severity calls with a stated rationale.

---

## 5. The value-stream stages map onto substrate the platform already carries

Nothing here invents a new table. The stages bind to existing fields, which is what lets the architecture feature render them (Section 8) and the audit read expected values from seed rather than from prose.

| Stage | Bound to (existing substrate in `types.ts` / archetype seed) |
|-------|--------------------------------------------------------------|
| S1 Attract | `sectionTemplates`, `ctaType`, `vocabulary` override, category vocabulary |
| S2 Capture | `formSchema`, `ItemTemplate.ctaType/ctaLabel`, `CtaType` |
| S3 Schedule | `SchedulingDefaults` (pattern/assignment/hours/buffers/notice) |
| S4 Deliver | `ActivationProfile.modules` (`customer-estate`, `service-operations`, `projects`), `SeededConfigurationItemType`, `estateSeparation`, `customerGraph` |
| S5 Settle | `BillingPatternProfile` (`primaryPaymentPattern`, `invoiceExecutionMode`, `recurringBillingApplicability`), `billingReadinessMode` |
| S6 Retain | `ActivationProfile.modules` (`service-agreements`, `lifecycle-signals`), `PartnerProgramProfile` |
| Trust & Compliance | `GovernanceModel`, `ProvisioningModel` (`account-with-kyc`/`episode-of-care`), `seededServiceCategories` (e.g. BIAN `compliance`), `disclosures` section type |
| Operate & Improve | coworker identity (`vocabulary.agentName`), `PortfolioDecomposition` with `It4ItStage` per role |

The current `PortfolioDecomposition` tags each portfolio role with legacy `It4ItStage[]` metadata.
That metadata is a migration input, not a conformance assertion: a generic
`request-to-fulfill` value cannot prove an external correspondence. The standards-grade seam is an
explicit mapping from a specific industry stage or work definition to a specific DigitalProduct and
local lifecycle key, with relationship, rationale, confidence, evidence and BindingState. External
identifiers additionally require FPAW's authorized source and complete mapping envelope.

### 5.1 Architecture and usability invariants

These invariants keep this artefact useful to architecture, UX, testing, and business analysis without turning it into a parallel product model:

| Invariant | Why it matters | Enforcement signal |
|-----------|----------------|--------------------|
| **Seed data remains executable truth.** | Prevents prose drift from becoming a hidden source of product behavior. | If this doc and `packages/storefront-templates/src/archetypes/` disagree, fix the seed or fix this doc; do not special-case the runtime. |
| **Stages are projections, not tables.** | The platform can render and audit value streams without adding a second business-process data model. | EA rendering derives from `ActivationProfile`, `SchedulingDefaults`, `BillingPatternProfile`, `PortfolioDecomposition`, and vocabulary. |
| **Operators see business language first.** | A non-technical user should understand "booking capacity" or "donor receipt" before "S3" or "S5". | UI labels use archetype vocabulary; stage codes appear only as secondary admin/architecture metadata. |
| **Load-bearing stages drive attention.** | The first viewport, audit severity, and coworker prompts must focus where business failure is most expensive. | EA and audit views highlight load-bearing stages; non-load-bearing stages remain visible but quieter. |
| **Trust gates are first-class constraints.** | Regulated, licensed, public-body, and member-owned archetypes fail if trust is treated as footer copy. | Disclosures, refusals, KYC/statutory obligations, and governance constraints attach to the stage they govern. |
| **Evidence must round-trip.** | A gap should move cleanly from observation to requirement to verification. | Every finding names stage, capability, user impact, seed/source expectation, and acceptance evidence. |

**Usability consequence.** The EA surface should not present a dense architecture diagram as the first experience for an operator. The default view should be a short stage ribbon with the load-bearing stage, trust gate, and next operational action visible. Capability bindings, IT4IT joins, and ArchiMate details are drill-down material for architects and admins.

---

## 6. Per-category value-stream profiles (all 106 archetypes across 24 categories)

> The field-dispatch leaves folded into existing categories on 2026-06-13 (e.g. `hvac-contractor`, `home-health-care`, `mobile-pet-grooming`) share their category's value-stream profile below and are catalogued — with their cross-category pattern — in §10.2. The three dispatch-native categories are §6.16–6.18; `media-production` and `live-events-venues` are now first-class profiles in §6.20–§6.21.

Each profile gives: the **value the end customer receives** (job-to-be-done), the **commercial model** (Section 3 shape), the **load-bearing stage(s)**, the **distinctive stage** that the audit must scrutinise, and the **trust gate**. Per-archetype rows name only what diverges from the category. Service names and CTA labels are *expected from seed* — where prose and seed disagree, seed wins.

---

### 6.1 Trades & Maintenance (Run 1) — `plumber`, `electrician`, `facilities-maintenance`, `landscaping`, `cleaning-service`

- **Value delivered:** a property problem is *fixed* or kept-from-breaking — competently, on time, often urgently.
- **Commercial model:** quote / inquiry-to-engagement (`facilities-maintenance` and `cleaning-service` add recurring-agreement for planned contracts).
- **Load-bearing stage:** **S2 Capture** — the inquiry must capture *enough to quote and triage* (`jobType`, `urgency` Emergency/Routine/Planned, `propertyType`). A leak at midnight that lands as a content-free "contact us" is a lost job.
- **Distinctive stage:** S3 Qualify — urgency drives dispatch order; emergency vs planned is the whole economics of trades.
- **Trust gate:** licensed trades (electrician — EICR/NICEIC; gas) must frame certification correctly; coworker must not improvise safety/compliance advice.
- **Value-stream-critical assertions:** TRADES_FORM_FIELDS (`urgency`, `propertyType`) render and submit; inbox shows urgency so dispatch can prioritise; coworker says "jobs/call-outs/quotes/technicians," never "appointments/products."

| Archetype | Diverges from category by |
|-----------|---------------------------|
| `plumber` | Emergency call-out is the headline S2 path; boiler service is the recurring hook into S6. |
| `electrician` | Stronger Trust gate (safety certification); EV-charger/consumer-unit are planned (S3) not emergency. |
| `facilities-maintenance` | B2B; **recurring-agreement** planned-maintenance contract makes **S6 Retain** co-load-bearing; the dedicated `hvac-contractor` field-dispatch leaf is catalogued in §10.2. |
| `landscaping` | Seasonal/recurring framing; gallery section feeds S1; `gardenSize` qualifies the quote. |
| `cleaning-service` | `frequency` (one-off/weekly/…) is the S6 recurring signal captured at S2; residential vs commercial splits the stream. |

---

### 6.2 Beauty & Personal Care (Run 2) — `hair-salon`, `barber-shop`, `nail-salon`, `beauty-spa`, `personal-trainer`, `mobile-beauty`

- **Value delivered:** a personal-care service performed by a *specific practitioner* in a *specific slot*.
- **Commercial model:** **appointment-checkout** — book and pay at service; **no running account/estate**.
- **Load-bearing stage:** **S3 Schedule** — the calendar *is* the product. Practitioner availability, operating hours, slot length, and no-show buffers are the business. A booking that ignores the stylist's real hours is a broken business.
- **Distinctive stage:** S2 → S3 handoff: provider selection must show *that provider's* slots, not generic ones.
- **Trust gate:** **unconfigured metadata gap — not evidence of low risk.** Until a complete organization/leaf profile binds the controls, audit the missing derived gate as a control-coverage gap and keep coworker action inside scheduling and operational-service boundaries. `beauty-spa` requires contraindication and consent checks, a bounded treatment/practitioner-escalation path, and sensitive-note provenance, access, and retention; `personal-trainer` requires consented health context, bounded non-diagnostic guidance, emergency handoff, session-safety/exception evidence, and controlled progress records; `mobile-beauty` additionally inherits the field-dispatch controls in §10.2.
- **Value-stream-critical assertions:** `customer-estate` module is **NOT** active (appointment-checkout); coworker confirms "no account balance — pay at time of service"; duration variants render (spa 60/90 min); vocabulary "clients/appointments/stylists," not "patients/members."

| Archetype | Diverges from category by |
|-----------|---------------------------|
| `hair-salon` | Canonical appointment-checkout reference; bridal package is a higher-value S2 variant. |
| `barber-shop` | "clients" vocabulary; walk-in culture means S3 must tolerate same-day. |
| `nail-salon` | Fixed/per-session pricing — no "quote" path; high-frequency rebooking loads S6 lightly. |
| `beauty-spa` | Duration options (60/90) are first-class in S3; couples package = multi-resource slot. |
| `personal-trainer` | Session-pack pricing pulls a little S6 (pack depletion) into an otherwise appointment-checkout stream; category fit must not produce salon-flavoured coworker framing. |
| `mobile-beauty` | Mobile practitioner travels to the customer; use the beauty appointment vocabulary plus the field-dispatch assignment/ETA loop. |

---

### 6.3 Healthcare & Wellness (Run 3) — `veterinary-clinic`, `dental-practice`, `medical-practice`, `physiotherapy`, `counselling`, `optician`, plus medical-mobile leaves in §10.2

- **Value delivered:** an *episode of care* for a patient (or pet) whose history must inform the encounter.
- **Commercial model:** **encounter-based**; provisioning `episode-of-care`.
- **Load-bearing stage:** **S4 Deliver** — the encounter is only safe/useful if the **record** (patient/pet, history, reason for visit) is present. This is why `customer-estate` + `ConfigurationItem` (pet) are the spine.
- **Distinctive stage:** S2 must capture the *clinical subject* — pet fields for vet, patient identity for dental/physio. A vet booking with no pet fields breaks the whole stream (audit logs this `critical`).
- **Trust gate:** highest in the consumer set — coworker stays in scheduling/operational territory, **never diagnoses or triages clinical/mental-health crises**; counselling crisis → route to emergency services.
- **Value-stream-critical assertions:** pet/patient fields render on the booking form *and* surface on the inbox record; "patients/owners/appointments" vocabulary; initial-assessment slot longer than follow-up (physio scheduling defaults); invoice ties to the patient record (S5↔S4).

| Archetype | Diverges from category by |
|-----------|---------------------------|
| `veterinary-clinic` | Pet `ConfigurationItem` is mandatory S4 substrate; emergency appointment is the urgent S2 path. |
| `dental-practice` | "new or returning patient?" qualifier; regulated vocabulary, no clinical recommendations. |
| `medical-practice` | Core clinical-practice leaf; patient intake, telehealth boundary, PHI/HIPAA posture, and urgent-symptom escalation are the trust-gate tests. |
| `physiotherapy` | Differential slot lengths (assessment vs follow-up) are load-bearing in S3; rehab packages touch S6. |
| `counselling` | Most sensitive vocabulary ("clients," jurisdiction-dependent); crisis-routing refusal is a hard Trust-gate test. |
| `optician` | Clinical-adjacent eye-care Trust gate; the "fitting/screening" services straddle care and retail, but source category is healthcare-wellness. |

---

### 6.4 Pet Services (Run 4) — `pet-grooming`, `pet-boarding`, `dog-walking`, plus mobile pet leaves in §10.2

- **Value delivered:** care for a *named pet* whose details (size, breed, temperament) shape the service.
- **Commercial model:** appointment-checkout with an encounter-like estate (the pet record).
- **Load-bearing stage:** **S4 Deliver** informed by the pet record + **S3 Schedule** (multi-night for boarding, recurring for walking).
- **Distinctive stage:** S3 varies sharply — grooming is a slot, boarding is a **date range**, dog-walking is a **recurring** booking.
- **Trust gate:** **unconfigured metadata gap — not evidence of low risk.** Until a complete organization/leaf profile binds the controls, audit the missing derived gate as a control-coverage gap. The category boundary requires animal/owner identity, owner instructions, condition, custody transfers, incident/escalation, welfare, and return acceptance. `mobile-vet` additionally requires a specialized clinical profile for veterinary-advice boundaries, urgent triage and owner communication, qualified-clinician dispatch, controlled supplies/specimen custody, and clinical-record provenance, consent, access, retention, and veterinary approval.
- **Value-stream-critical assertions:** pet `ConfigurationItem` carries to the inbox booking; size-based "from" pricing renders (grooming); multi-night date-range flow (boarding); recurring vs one-off distinction the coworker understands (walking).

---

### 6.5 Food & Hospitality (Run 5) — `restaurant`, `catering`, `bakery`

- **Value delivered:** food — *reserved* (restaurant), *commissioned for an event* (catering), or *bought* (bakery). Three different streams in one category.
- **Commercial model:** booking (restaurant), quote/inquiry (catering), transactional/point-of-sale (bakery).
- **Load-bearing stage:** restaurant **S3** (table/party-size/meal-service slot); catering **S2** (event type/date/guest-count quote); bakery **S2** (catalog → cart → checkout).
- **Distinctive stage:** the *mixed CTA* — the category proves the platform can host booking, inquiry, and purchase side by side; bakery's custom-cake commission is an inquiry-style sub-flow *inside* a purchase archetype.
- **Trust gate:** allergen/dietary capture is a duty-of-care surface (restaurant/catering).
- **Value-stream-critical assertions:** party-size field (restaurant) renders and reaches inbox; single vs dual operating window (lunch/dinner) — log single-window as a minor S3 gap; "Shop/Order" not "Book" (bakery); commission sub-flow submits to inbox.

---

### 6.6 Retail & Goods (Run 6) — `retail-goods`, `artisan-goods`, `florist`, `wholesale-distribution`

- **Value delivered:** a physical good acquired (retail/artisan/florist) or a *trade supply relationship* opened (wholesale).
- **Commercial model:** transactional/point-of-sale — **except `wholesale-distribution`, which is inquiry** (trade-account/bulk-quote), the deliberate B2B exception in a retail category.
- **Load-bearing stage:** **S2 Capture** — catalog → product detail → cart → checkout → order reference must not drop a link; **S6** the customer/account linkage that turns a buyer into a repeat customer.
- **Distinctive stage:** delivery logistics enter S4/S5 — florist needs delivery date/address for perishables; artisan commission and workshop are sub-flows (inquiry + booking) inside purchase.
- **Trust gate:** low (consumer goods); wholesale adds trade-account verification.
- **Value-stream-critical assertions:** "Shop Now" label; image placeholders not broken tags; order links to the customer account (S2→S6); wholesale renders **inquiry** ("trade customers/accounts"), not "Shop Now."

---

### 6.7 Fitness & Recreation (Run 7) — `gym`, `yoga-studio`, `dance-studio`

- **Value delivered:** ongoing access to facilities/classes via *membership*.
- **Commercial model:** **subscription** — recurring, not one-off.
- **Load-bearing stage:** **S6 Retain** — the renewal and the membership lifecycle are the business, not the first join. Day passes are the transactional on-ramp.
- **Distinctive stage:** S5 must express *recurring* billing language, not a single purchase; class schedules (yoga) are a class-pattern S3 sub-surface.
- **Trust gate:** age/DOB and emergency-contact capture for membership; low regulatory.
- **Value-stream-critical assertions:** coworker frames subscription/auto-renew, never "appointment-checkout"; "members/students" vocabulary (gym/yoga/dance); membership tiers render with recurring price language.

---

### 6.8 Education & Training (Run 8) — `corporate-training`, `tutoring`, `driving-school`, `music-school`

- **Value delivered:** a learner gains a skill — delivered 1:1, in cohorts, or as a B2B programme.
- **Commercial model:** booking (tutoring/driving/music), inquiry (corporate-training, B2B).
- **Load-bearing stage:** **S3 Schedule** for the 1:1/cohort bookings (instructor assignment, term enrolment); **S2** for B2B programme inquiries.
- **Distinctive stage:** the *subject is a third party* — parent books, **student** is delivered to (age/year-group/instrument/level fields). Term-based enrolment vs drop-in is an S3/S6 distinction.
- **Trust gate:** safeguarding tone for minors; B2B (corporate) frames to L&D/HR with "delegates/participants," not "customers."
- **Value-stream-critical assertions:** learner-vs-payer fields render; instructor/pickup-location captured (driving); B2B framing for corporate-training.

---

### 6.9 Professional Services A (Run 9) — `consulting`, `legal-services`, `marketing-agency`, `accounting`

- **Value delivered:** expertise applied to a client's problem under an engagement/retainer.
- **Commercial model:** quote/inquiry-to-engagement; retainer/project-milestone billing in S5.
- **Load-bearing stage:** **S2 Capture quality** then **S6 Retain** (retained advisory, ongoing engagements compound the relationship).
- **Distinctive stage:** S5 is retainer/milestone, not point-of-sale; B2B vocabulary throughout ("clients/engagements/retainers/deliverables").
- **Trust gate:** `legal-services` and `accounting` are **regulated** — coworker must not give legal/financial advice; "consult a qualified solicitor/accountant" framing.
- **Value-stream-critical assertions:** "clients" not "customers"; regulated disclaimers; portfolio/case-study section (marketing); strict estate separation **not** active (standard profile).

---

### 6.10 Professional Services B — IT MSP (Run 10) — `it-managed-services`

- **Value delivered:** a client's IT estate is *kept running and secure* under a recurring agreement, with each client's data isolated.
- **Commercial model:** **recurring-agreement**; `profileType: managed-service-provider`; channel-partner delivery.
- **Load-bearing stage:** **S4 Deliver under strict estate separation** + **S6** the agreement lifecycle. The whole archetype exists to prove **multi-client isolation**.
- **Distinctive stage:** every stage is per-client-scoped; the customer graph is a `separate-customer-projection`; modules `customer-estate`, `service-agreements`, `service-operations`, `projects`, `lifecycle-signals`, `integrations` are all active.
- **Trust gate:** estate-isolation correctness *is* the trust gate (one client must never see another's assets/tickets).
- **Value-stream-critical assertions:** onboarding a new client invokes service-agreement + estate-isolation + asset-discovery framing, not "add a customer"; an access-issue report triggers incident/helpdesk framing; vocabulary "clients/agreements/incidents/tickets/assets/estate."

---

### 6.11 Nonprofit & Community (Run 11) — `charity`, `pet-rescue`, `animal-shelter`, `community-shelter`, `sports-club`, `cooperative`, `agricultural-cooperative`, plus `meal-delivery-program` in §10.2

- **Value delivered:** a cause is *advanced* by a supporter's gift — or, for `cooperative`, member-owners govern a shared enterprise.
- **Commercial model:** **donation** (charity/rescue/shelter/community leaves) / inquiry-membership with **member-owned governance** (cooperative and agricultural-cooperative) / membership/community participation (`sports-club`).
- **Load-bearing stage:** **S2 Capture** *plus the deliberate absence of S5-as-purchase* — a donation issues a **receipt, never an invoice/billing account**. An auto-created invoice is a stream defect (`important`).
- **Distinctive stage:** the value stream intentionally *omits* commerce artefacts; cooperative adds a governance value stream (member meetings, surplus distribution, share purchase).
- **Trust gate:** sensitive vocabulary — "supporters/donors/beneficiaries/guests," never "customers"; gift-aid/tax-relief language (UK); cooperative uses member-democratic framing.
- **Value-stream-critical assertions:** "Donate" CTA; amount selection renders; **no invoice generated**; cooperative `customVocabulary` "Members" renders and governance framing answers "how do I call a special general meeting?"

---

### 6.12 HOA & Property Management (Run 12) — `homeowners-association`, `condo-association`, `property-management-company`

- **Value delivered:** a community/property is *governed and maintained* on behalf of residents/owners.
- **Commercial model:** inquiry (dues, maintenance requests, reservations); HOA dues are levy-like.
- **Load-bearing stage:** **S2 Capture** of maintenance/violation/reservation requests with property/unit context + **S3** routing to the right party.
- **Distinctive stage:** dual audience — `property-management-company` serves landlord *clients* (B2B) and tenant *users* (B2C) in one stream; coworker must switch framing.
- **Trust gate:** "residents/homeowners/unit owners," not "customers"; covenant/dues language.
- **Value-stream-critical assertions:** "residents" vocabulary; maintenance request carries property address + urgency; shared-facility booking works as a booking sub-flow (condo amenity room); dual landlord/tenant framing (property-management).

---

### 6.13 Software & Platform (Run 13 / folded into Run 0) — `software-platform`

- **Value delivered:** an enterprise evaluates and adopts the platform — DPF's own dogfood meta-case.
- **Commercial model:** inquiry (demo/pilot/partnership); platform ecosystem.
- **Load-bearing stage:** **S2 Capture** (inquiry → backlog) and the **Operate & Improve** loop — inquiry "Send to product backlog" creates a BI linked to the digital product.
- **Distinctive stage:** the meta-case — the coworker must frame DPF as *the product*, not the container; no circular "what is DPF?" confusion.
- **Trust gate:** vocabulary "users/developers/enterprise customers/pilots," not "patients/members."
- **Value-stream-critical assertions:** inquiry → inbox → backlog → BI linked to the digital product; no recursion confusion.

---

### 6.14 Banking & Financial Services (Runs 14a–c) — `community-bank`, `credit-union`, `mortgage-lending`

- **Value delivered:** a financial relationship is *opened and serviced* — deposits/lending (bank), member share accounts (CU), loan origination (mortgage).
- **Commercial model:** **account-based-fees**, provisioning **account-with-kyc**, `billingReadinessMode: prepared-not-prescribed` (DPF records fee obligations, **never moves money** — engagement layer only; core banking stays with the institution).
- **Load-bearing stage:** the **Trust gate *before* S3** — KYC, disclosures (FDIC/NCUA/NMLS), and BIAN-anchored capability map gate the whole stream. This is why each gets a full fresh install (a swap doesn't re-provision the gate).
- **Distinctive stage:** S1/S2 carry mandatory disclosure sections; the EA tool exposes the **BIAN capability perspective** (Loans and Deposits, Relationship Management, Compliance); strict estate separation + separate customer projection.
- **Trust gate:** the entire archetype. Coworker cites specific regulation (FDIC Part 328), references KYC steps, gives **no** rate/legal advice.
- **Value-stream-critical assertions:** BIAN perspective in `/ea`; correct regulatory pack (FDIC vs NCUA vs NMLS/RESPA/TILA); `customVocabulary` renders ("Become a Member"/"Borrowers"/"Share Accounts"); **no Donate/Book/Cart** anywhere; "Apply" CTA on lending items.

| Archetype | Diverges by |
|-----------|-------------|
| `community-bank` | Investor-owned; FDIC + OCC pack; "customers/accounts/deposits/lending." |
| `credit-union` | **member-owned** governance; NCUA not FDIC; "Members/Share Accounts/Dividends"; "Become a Member" CTA. |
| `mortgage-lending` | Origination/brokerage; NMLS/RESPA/TILA; "Borrowers/Loan Officers/Applications"; HELOC present; rate-quote is a quote price type. |

---

### 6.15 Public Sector & Law Enforcement (Runs 15–16) — `small-town-municipality`, `municipal-utility`, `law-enforcement-agency`

- **Value delivered:** a statutory service is *rendered to a resident* under a universal-service obligation — no profit motive.
- **Commercial model:** **statutory-fees-and-levies**; `GovernanceModel: public-body`; primary consumer `resident`.
- **Load-bearing stage:** the **Trust & universal-service obligation** cross-cut — the service must be available to *every* resident, fee schedules are set by ordinance/statute, and (law enforcement) sensitive-data refusals are absolute.
- **Distinctive stage:** S2 is a *civic request* (permit, records/FOIA, 311 service, service connection) not a sale; S5 is a statutory fee schedule, not a market price.
- **Trust gate:** "residents/constituents/ratepayers," not "customers"; correct regulatory references (SDWA/NPDES for utility; POST/CJIS for police); **law enforcement: no CJI access in Phase 1** — coworker firmly declines to look up arrest/warrant/dispatch data.
- **Value-stream-critical assertions:** resident/ratepayer `customVocabulary` renders; statutory-fee framing; SDWA/NPDES (utility) and POST/CJIS (police) compliance placeholders; police coworker declines CJI lookups and routes complaints to the intake flow without legal opinion.

| Archetype | Diverges by |
|-----------|-------------|
| `small-town-municipality` | Mixed inquiry/permit-fee CTAs; "residents/constituents/permit applications/fee schedules." |
| `municipal-utility` | "Ratepayers/Service Connections"; SDWA + NPDES; service initiation/termination + billing-dispute stream. |
| `law-enforcement-agency` | Highest governance sensitivity; public-inquiry intake only; POST/CJIS-gate; absolute CJI refusal; "officers/community members/incidents/public records." |

---

### 6.16 Automotive Services (field-dispatch) — `auto-glass`, `mobile-mechanic`, `mobile-detailing`, `mobile-tire`, `roadside-assistance`, `locksmith`

- **Value delivered:** a technician travels to the customer's **vehicle** (driveway, workplace, roadside) and restores it — glass, mechanical, cosmetic, mobility, or access. Field service on a VIN-identified asset.
- **Commercial model:** **appointment-checkout** for scheduled mobile service (glass/mechanic/detailing/tire); **transactional**, per-incident for `roadside-assistance` and `locksmith`; primary consumer `individual`.
- **Load-bearing stage:** **S3 Assign / S4 Deliver** — the dispatch and the on-site fix. For roadside it collapses to a real-time S2→S4: the call *is* the job.
- **Distinctive stage:** **VIN→part resolution** at S2/S3 (glass SKU, key blank, tire size) and, for `auto-glass`, a post-install **ADAS calibration** that gates warranty — the category's moat overlay, a sibling to HVAC's EPA 608 that no FSM covers.
- **Trust gate:** honest diagnosis / no-needless-work; ADAS calibration certified; DOT for towing operations; bonding for locksmith.
- **Value-stream-critical assertions:** `onsite-plus-portal` axes derive field dispatch; `auto-glass` carries the `adas` tag anchoring its calibration overlay; roadside/locksmith are **emergency-reactive** (real-time), not scheduled appointments.

| Archetype | Diverges by |
|-----------|-------------|
| `roadside-assistance` | Real-time, location-keyed (no VIN required); demand is emergency-reactive; the dispatch ETA *is* the product. |
| `locksmith` | Spans **vehicle and property-site** serviced entities (auto + residential); bonding/licensing gate. |

### 6.17 Moving & Logistics — `moving-company`, `junk-removal`, `courier-delivery`, `last-mile-freight`, `freight-brokerage`

**Dispatch-native operator/crew leaves.**

- **Value delivered:** a **crew and truck** travel to load, haul, and deliver goods — household possessions, junk, parcels, or freight.
- **Commercial model:** **transactional** per-job for the household side (`moving-company`, `junk-removal`); **account-based-fees** for the B2B side (`courier-delivery`, `last-mile-freight`); consumer `household` vs `business`.
- **Load-bearing stage:** **S4 Deliver** — the move/haul/run itself, bounded by crew-hours × route geography.
- **Distinctive stage:** **route + load planning** at S3; the **DOT hours-of-service** overlay; chain-of-custody for medical/legal courier work.
- **Trust gate:** careful handling; honest estimate; DOT driver hours; chain-of-custody (medical/legal courier).
- **Value-stream-critical assertions:** `onsite-plus-portal` axes derive field dispatch; **distinct from `wholesale-distribution`** (which is B2B route delivery of a goods brand's *own* stock); the B2B leaves derive `customer-accounts`.

| Archetype | Diverges by |
|-----------|-------------|
| `courier-delivery` / `last-mile-freight` | B2B account-based recurring routes rather than one-off household jobs; consolidated billing. |
| `junk-removal` | Adds a disposal/manifest leg after the haul (S4→settle). |

**Non-asset brokerage leaf — `freight-brokerage`.**

- **Value delivered:** a shipper's load is matched to qualified third-party carrier capacity on the required lane, equipment class, date, service level, and price; the broker owns no truck and takes no physical custody.
- **Commercial model:** **account-based-fees**, `sales-assisted`; revenue is the spread on a load rather than a charge for operating a fleet.
- **Load-bearing stage:** **S3 Qualify & Match** — source and qualify carrier capacity, tender the load, and re-tender safely when the first carrier cannot accept or continue it.
- **Distinctive value flow:** S1 acquire shipper/carrier relationships → S2 capture quote and load details → S3 source, qualify, tender, and cover → S4 track the carrier's delivery and coordinate exceptions without claiming custody → S5 reconcile carrier/shipper settlement and margin → S6 retain the account and lane history.
- **Trust gate:** broker/contract authority, carrier qualification and insurance, tender/substitution approval, tracking/documentation, settlement evidence, and an explicit no-custody boundary.
- **Capacity dynamic:** broker/operations case throughput × **qualified carrier-market capacity by lane, equipment, and date**. This is a load-coverage and tender pipeline, not mobile-labour routing; §7.2 gives the dedicated capacity row.
- **Value-stream-critical assertions:** the source `sales-assisted` channel must keep Field Dispatch inapplicable; the load board uses quote → tender → covered → in transit → delivered → invoiced states; no surface assigns the broker's own truck, driver, or custody record.

### 6.18 Security Services (field-dispatch) — `guard-patrol`, `alarm-cctv-install`

- **Value delivered:** physical protection of people and property — manned/patrol coverage (`guard-patrol`) and field-installed alarm/CCTV with recurring monitoring (`alarm-cctv-install`).
- **Commercial model:** **recurring-agreement** (guard contracts; monitoring plans); `business` consumer for guarding, `household` for residential alarm.
- **Load-bearing stage:** for `guard-patrol`, **S4 Deliver** runs as a *real-time* post-assignment / patrol-route / incident-response loop — a dispatch variant; for `alarm-cctv-install`, S3/S4 is the install and **S6 Retain** carries the recurring-monitoring relationship.
- **Distinctive stage:** post assignments + patrol routes + incident response (the real-time dispatch variant); the monitoring stream layered on the install.
- **Trust gate:** licensed officers (PSO); documented incident response; low-voltage licensing (install); credible, never fear-mongering, marketing.
- **Value-stream-critical assertions:** `onsite-plus-portal` axes derive field dispatch; `guard-patrol`'s recurring-agreement makes `service-agreements` **required**; install + monitoring compose into one relationship.

| Archetype | Diverges by |
|-----------|-------------|
| `guard-patrol` | Real-time patrol/incident dispatch over managed B2B client sites (customer-estate). |
| `alarm-cctv-install` | One-off field install plus a recurring monitoring retention stream; residential primary. |

### 6.19 Real Estate & Construction — `new-home-builder`, `custom-home-builder`

> Added 2026-07-17. This category was seeded (EP-GRID-BUILDER) but had no value-stream profile — the 2026-06-13 changelog's "87 archetypes" count folded in the 17 Gap-A leaves + 12 Gap-B leaves (= 85) and omitted these two builders. This section closes that gap; the seed is the executable truth (see §5.1).

- **Value delivered:** the household receives a **built home** — a production/spec house selected from plans (`new-home-builder`) or a bespoke house designed and constructed to order (`custom-home-builder`). Physical goods delivered to a household over a multi-month build.
- **Commercial model:** **milestone/draw-billed project** — `form=goods`, `primaryConsumer=household`, `delivery=physical`, `billingReadinessMode: prepared-not-prescribed` with `modules` including `billing-readiness` + `projects`. Not a slot-booked service and not a shelf-goods sale.
- **Load-bearing stage:** **S2 Capture → S4 Deliver / S5 Settle** — capture is plan/design selection; the load-bearing weight is the milestone-billed **build project** (S4) and its **draw schedule** (S5). S1 Attract is unusually heavy for the production builder (the model home *is* the funnel).
- **Distinctive stage:** each leaf carries a **booking item with `schedulingDefaults`** (model-home tour / design consultation) even though the top-level CTA is `inquiry` — an S1/S3 appointment front-door onto a goods/project business. `custom-home-builder` additionally runs **`service-operations`** for active subcontractor coordination during the build.
- **Trust gate:** state contractor/home-builder license; new-home **warranty** obligations; design/architectural sign-off (custom); milestone-draw transparency so the buyer is never over-billed ahead of completed work.
- **Value-stream-critical assertions (guarded by `archetypes.test.ts` "home builder archetypes"):** both carry a booking item + `schedulingDefaults`; `form=goods`, `primaryConsumer=household`, `delivery=physical`; both include `billing-readiness` + `projects` with `prepared-not-prescribed` billing. `new-home-builder` model homes open **7 days** (Sunday hours present); `custom-home-builder` runs **business-hours only** (no Sat/Sun tour slots).

| Archetype | Diverges by |
|-----------|-------------|
| `new-home-builder` | Production/spec builder: plan-book selling + design-centre options; model home open 7 days is the S1 funnel; category-default vocabulary. |
| `custom-home-builder` | Bespoke design→contract→build; leaf vocabulary override (**Clients**, **Build Team**, **Build Consultant**); adds `service-operations` for subcontractor coordination; business-hours only. |

---

### 6.20 Media Production — `film-video-production`, `post-production-studio`, `event-production-staging`

> Added 2026-07-18. This category is project/timeline work that produces a media asset or staged production for a client. It is distinct from `asset-rental` because the business sells a produced outcome, not the temporary use of equipment, and distinct from `live-events-venues` because it produces the show rather than selling the ticketed event.

- **Value delivered:** a produced creative/technical asset or staged production — commercial video, post/VFX delivery, or AV/staging execution.
- **Commercial model:** inquiry-to-project with milestone/delivery billing; `projects` and `billing-readiness` are load-bearing.
- **Load-bearing stage:** **S3 Qualify / S4 Deliver** — scope, schedule, crew/artist/suite capacity, dependencies, review rounds, and deadline management determine whether the project succeeds.
- **Distinctive stage:** waiting-on-client/asset/approval states are not generic notes; they are the project bottleneck and should surface as needs-you quests in the workspace/twin.
- **Trust gate:** rights/usage, client approval, safety/logistics for event staging, and honest capability promises. Coworker should not blur this into general consulting.
- **Value-stream-critical assertions:** inquiry forms capture project type, budget/spec, deadline, and brief; seeded booking/discovery items render from `schedulingDefaults`; workspace/twin derives PIPELINE/timeline posture; milestone/project language survives finance handoff.

| Archetype | Diverges by |
|-----------|-------------|
| `film-video-production` | Full-service production: pre-production, crewed shoot, post, delivery; "Crew" vocabulary. |
| `post-production-studio` | Digital delivery; review/version/deadline queues and "Artists" vocabulary are load-bearing. |
| `event-production-staging` | Physical event build/strike with site visit; staging/AV crew and logistics constraints dominate S3/S4. |

---

### 6.21 Live Events & Venues — `event-venue`, `tour-promoter`, `talent-booking-agency`

> Added 2026-07-18. This category sells or books the show: tickets, venue space, tours, acts, and event dates. It is distinct from media production because physical capacity, dates, holds, guest/fan communication, and settlement are the value-stream spine.

- **Value delivered:** a guest/fan/client gets access to a live event or talent booking; the operator safely manages capacity, date conflicts, and event readiness.
- **Commercial model:** ticket/package purchase for `event-venue` and `tour-promoter`; inquiry-to-booking for `talent-booking-agency`; booking sub-flows exist for venue hire and consultations.
- **Load-bearing stage:** **S2 Capture / S3 Qualify & Schedule** — the sale or inquiry only works if it respects event date, capacity, space/artist availability, holds, and conflict avoidance.
- **Distinctive stage:** venue/date/talent conflicts are the core operational risk; the platform must not imply a full ticketing seat-map, payment rail, artist contract, or settlement engine unless those surfaces exist.
- **Trust gate:** truthful ticket/availability language, accessibility/access needs capture, event safety/staffing posture, and contract/booking boundary clarity.
- **Value-stream-critical assertions:** "What's On & Tickets", "Shows & Tours", or "Booking Services" vocabulary renders; purchase/inquiry flows issue references; weekend/long-day scheduling appears where seeded; coworker handles double-booking as a decision gate rather than a generic task.

| Archetype | Diverges by |
|-----------|-------------|
| `event-venue` | Box-office posture; ticket/package purchases and private venue hire booking. |
| `tour-promoter` | Tour/package sales and venue/buyer inquiries; carries box-office risk across dates. |
| `talent-booking-agency` | Client inquiry and roster/talent availability; consultation booking is the front door. |

---

### 6.22 Warehousing & Fulfilment — `third-party-logistics`, `ecommerce-fulfilment`, `cold-chain-storage`, `cross-dock-transload`

> Added 2026-07-21. The goods-custody category: the operator takes goods it does **not** own into its facility and is paid to hold and handle them. Gated by the `custody-and-fulfilment` provisioning axis. Distinct from `asset-rental`'s `self-storage` (customer keeps the key; no custody, no handling), from `retail-goods`' `wholesale-distribution` (sells stock it owns), and from `moving-and-logistics` (custody is transient and in-transit, with no facility inventory of record). Design: [`docs/superpowers/specs/2026-07-21-warehousing-fulfilment-archetype-design.md`](../superpowers/specs/2026-07-21-warehousing-fulfilment-archetype-design.md).

- **Value delivered:** a client's stock is held safely, counted accurately, and despatched correctly and on time — the client's working capital and their promise to their own customers both sit on the operator's racks.
- **Commercial model:** `account-based-fees` — contract accounts invoiced monthly off a **rate card with two meters**: storage rent on space held (per pallet/bin per period) plus handling on work done (per receipt, pick, pack, or order), with monthly minimums and accessorials.
- **Load-bearing stage:** **S4c Receive & Store** — the custody-only stage inserted between Qualify (the dock appointment) and Deliver (pick/pack/despatch). Custody is won or lost on the inbound: dock-to-stock and inventory accuracy determine whether every downstream pick is possible and correct.
- **Distinctive stage:** goods come to rest *before* the outbound work, inverting the rental ordering (where the asset returns *after*). Stock is strictly segregated per owning client — one client's inventory must never surface in another's view.
- **Trust gate:** goods-in-trust liability and insurance posture, honest count variances (flag a discrepancy rather than absorb it), and per-client data separation. Cold chain adds temperature-record integrity (GDP/GxP).
- **Value-stream-critical assertions:** storage and handling render as separate revenue lines; the DOCK twin shows dock doors, racking, and pick waves rather than a sales floor; the receive-store stage appears in demand-by-stage; capacity reads as `custodial-space` (pallet positions/cube), not `durable-stock`.

| Archetype | Diverges by |
|-----------|-------------|
| `third-party-logistics` | Contract storage posture; pallet-in/pallet-out, bonded storage, and kitting/VAS. |
| `ecommerce-fulfilment` | Order-centric: pick/pack per order, channel integrations, returns processing. |
| `cold-chain-storage` | Temperature bands and continuous monitoring; compliance certification is the differentiator. |
| `cross-dock-transload` | Near-zero dwell — dock-door time, not storage, is the constraint and the meter. |

Related: §6.17 carries the complete `freight-brokerage` leaf profile. It is the non-asset movement model and is deliberately **not** dispatch-native.

---

### 6.23 Fabric Care Services — `dry-cleaning-plant-network`, `wash-and-fold-laundry`, `alterations-tailoring`

> Added 2026-07-22. The garment/textile custody-and-return category: the operator accepts customer-owned garments or laundry, issues a claim ticket, processes work through a plant, counter, workroom, or pickup route, and returns the same property against a ready promise. It is distinct from `beauty-personal-care` because the customer is not the work surface, from `warehousing-fulfilment` because the custody is household/local service work rather than B2B inventory storage, and from `trades-maintenance` because the work happens primarily inside the operator's counter/plant network. Design: [`docs/superpowers/specs/2026-07-22-fabric-care-services-archetype-design.md`](../superpowers/specs/2026-07-22-fabric-care-services-archetype-design.md).

- **Value delivered:** a customer's garment, bag, textile, or alteration item is cleaned, pressed, repaired, folded, or preserved, then returned to the same customer on or before the ready promise.
- **Commercial model:** `point-of-sale` with `account-with-billing` readiness for recurring laundry plans, pickup routes, and small commercial accounts. Payment is usually at counter or pickup; account billing is prepared, not prescribed.
- **Load-bearing stage:** **S4 Deliver the Value** — plant/workroom throughput, item tracking, and ready-promise discipline determine whether the customer receives the right property at the right time.
- **Distinctive stage:** the claim-ticket/tag chain is the custody control from drop-off/pickup through plant, satellite store, and return. Missing, mixed, damaged, or delayed garments are exceptions, not generic inbox notes.
- **Trust gate:** care-label respect, existing-damage capture, high-value/sentimental item escalation, and early delay communication. Specialty leaves may later add preservation, solvent, or environmental compliance overlays.
- **Value-stream-critical assertions:** the catalog renders "Services" and "Orders"; forms capture preferred location, service mode, needed-by date, and garment notes; item templates mention claim tickets and ready notifications; the BAYS twin shows station/work-order throughput rather than a retail stock floor.

| Archetype | Diverges by |
|-----------|-------------|
| `dry-cleaning-plant-network` | Central plant plus satellite stores/routes; dry cleaning, pressing, laundry, alterations, and specialty care under one claim-ticket flow. |
| `wash-and-fold-laundry` | Bagged laundry, recurring plans, household textiles, commercial laundry, and route pickup/delivery. |
| `alterations-tailoring` | Fittings and workroom routing around event deadlines; repairs and fit changes tracked as ticketed garment work. |

---

### 6.24 Agriculture & Ranching — `mixed-farm-ranch`, `crop-hay-farm`, `cattle-ranch`

> Added 2026-08-01. This category operates land, crops/forage, livestock, working animals, machinery, materials, and outside services through weather- and biology-constrained windows. It is distinct from the nonprofit `agricultural-cooperative`, which coordinates member-owned shared assets rather than owning one operation's production plan.

- **Value delivered:** cared-for land and animals produce a safe, saleable crop, forage, or livestock outcome while the operation preserves future productive capacity.
- **Commercial model:** seasonal production and sale, sometimes supplemented by breeding stock, custom work, direct sales, or grazing arrangements; cash commitments precede uncertain yields, weights, quality, and market timing.
- **Load-bearing stage:** **S4 Deliver the Value** — land condition, biological timing, equipment/material readiness, qualified people and providers, and a workable weather window must coincide. Missing one prerequisite can erase the window rather than merely delay a task.
- **Distinctive stage:** Now / Next / Season readiness joins long-horizon planning to near-term execution. Forecasts, outlooks, market reports, labels, and regulations are dated evidence, never silent permission or guaranteed outcomes.
- **Trust gate:** animal welfare and qualified veterinary authority; pesticide label, applicator, site/crop/pest, and jurisdiction constraints; working-animal care; safe equipment release; and human approval for sales, spend, filings, external contact, and machinery control.
- **Value-stream-critical assertions:** farm/ranch vocabulary survives portal, workspace, finance, marketing, and coworker surfaces; `TERRITORY` aggregates land/herd/equipment attention; outside-service prerequisites and human-helper needs are visible; every consequential proposal shows source, as-of time, uncertainty, and approval owner.

| Archetype | Diverges by |
|-----------|-------------|
| `mixed-farm-ranch` | Whole-operation coordination across forage/crops, cattle, working horses, machinery, inputs, providers, and multiple seasonal horizons. |
| `crop-hay-farm` | Field/stand readiness, fertility and pest evidence, harvest windows, equipment/material dependencies, storage, and custom cutting/baling dominate. |
| `cattle-ranch` | Herd/group and individual identity, breeding/calving, health, movement, forage/water, working-animal support, and market-readiness decisions dominate. |

---

## 7. Demand–capacity dynamics at the load-bearing stage

The load-bearing stage (Section 6) is not only where the main transaction interface between stakeholders sits — it is also **where demand meets finite capacity.** That is not a coincidence: a stage is load-bearing precisely because the business lives or dies on its ability to match demand against a scarce resource there. Managing that match — *neither starving demand nor paying for idle capacity* — is the operator's hardest recurring decision, and it is where a typical operator most needs the platform's help.

This section characterises those dynamics per archetype so the platform can later carry adequate functionality to manage them. It is therefore also a **requirements input**: every "platform lever" named below is a candidate capability the platform must eventually provide (forecasting, advance-booking windows, waitlists, deposits/no-show protection, demand-based pricing, reorder points, seasonal staff flex, utilization dashboards).

### 7.1 The model: capacity unit × demand signature × two-sided risk

**Capacity is not one thing.** The scarce resource differs by archetype, and its *type* dictates which lever works:

| Capacity-unit type | What is scarce | Can it flex up fast? | Examples |
|--------------------|----------------|----------------------|----------|
| **Time-slot capacity** | practitioner-hours in bookable slots | only by hiring/rostering | salon chairs, vet/dental/physio appointments, tutoring, driving lessons |
| **Physical-unit capacity (hard cap)** | a fixed number of physical places | barely — building-limited | kennels, restaurant tables, gym floor/class mats, shelter beds, condo amenity rooms |
| **Perishable inventory** | stock that spoils if unsold | yes, but spoils → asymmetric loss | flowers, fresh bakery, restaurant produce |
| **Durable inventory** | stock/parts that hold value | yes, but ties up cash | retail goods, plumbing/HVAC parts, wholesale stock |
| **Throughput / processing capacity** | how many cases can be worked per period | slowly (skilled labour) | loan underwriting, permit/inspection processing, accounting returns, MSP tickets, dry-cleaning plant work |
| **Mobile labour + route capacity** | technician-hours × drive-time geography | seasonally (temp crews) | trades, landscaping, dog-walking, field service |
| **Brokerage / network capacity** | qualified third-party supply by lane/date/equipment × broker case throughput | carrier supply can flex, but availability and price are volatile | freight brokerage load coverage and tendering |

**Demand has a signature.** The shape of the peak dictates how far ahead the operator must plan:

- **Weekly cycle** — evening/weekend peaks (salon, barber, restaurant, gym classes).
- **Annual season** — temperature- or daylight-driven (HVAC, landscaping, utility usage).
- **Calendar-event spike** — fixed dates (florist V-Day/Mother's Day, pet boarding at Thanksgiving/Christmas, restaurant NYE).
- **Fiscal / regulatory cycle** — deadline-driven (accounting tax season, corporate-training budget cycles, HOA dues, year-end insurance-benefit use).
- **Economic / rate cycle** — exogenous (mortgage refi waves; consulting tied to client fiscal planning).
- **Unpredictable / emergency** — must hold reserve capacity (plumbing burst, vet emergency, property-management lockout, charity disaster appeal).
- **Statutory baseline (must-serve)** — demand cannot be turned away or fully smoothed (municipality, utility, law enforcement).

**The risk is two-sided.** This is the crux the operator needs help with, and the cost asymmetry decides the right buffer:

- **Under-capacity** → demand is *turned away*: lost revenue, lost customer, reputational damage, and (for must-serve archetypes) statutory failure. Rover data show **39% of pet owners struggle to secure care during peak periods** — that is demand walking to a competitor. ([MoeGo](https://www.moego.pet/blog/holiday-survival-guide-for-pet-boarding-and-daycare-businesses))
- **Over-capacity** → resource sits *idle or spoils*: paid-for staff with no clients, dead stock tying up cash, and — worst — **perishables with zero salvage value.** A florist who over-orders for Valentine's is left "not with inventory that can be discounted later, but with organic matter that has zero value within days"; even a **10% overestimate can wipe out the margin**, against a baseline **5–10% spoilage rate**. ([ProfitableVenture](https://www.profitableventure.com/flower-shop-inventory-management-tips/)) A salon below **70% chair utilization is paying for too much idle time**; above **85% it needs to hire**. ([FinancialModelsLab](https://financialmodelslab.com/blogs/kpi-metrics/hair-salon))

The buffer the operator should hold is a function of that asymmetry: where turn-away is cheap and idle is expensive (perishables, idle labour), run lean and use waitlists; where turn-away is catastrophic and reserve is cheap (emergencies, must-serve), hold slack. **The platform's job is to make that trade-off visible and adjustable, not to leave it to the operator's gut.**

### 7.2 Per-archetype demand–capacity matrix

Severity note for the audit: a capacity/demand surface (calendar, inventory, roster, lead-time, waitlist) that is *missing or wrong on a load-bearing-stage archetype* is at least `important` — it means the platform cannot run that business's hardest decision.

| Archetype(s) | Constrained capacity unit | Peak demand signature | Over-capacity / waste failure mode | Primary platform lever implied |
|--------------|---------------------------|------------------------|------------------------------------|--------------------------------|
| `plumber`, `electrician` | technician-hours + **replacement-parts stock** (fittings, boilers) | winter burst/freeze; emergency-unpredictable; boiler service pre-winter | idle techs in shoulder seasons; cash tied in slow-moving parts | emergency-reserve slots; van-stock reorder points; planned-work backfill of troughs |
| `facilities-maintenance` | **mixed-trade technician/team hours** + subcontractor availability + cross-trade parts/materials | planned inspection/preventive cycles plus reactive HVAC, electrical, plumbing, and building-fabric failures; a multi-site contract portfolio can smooth trade-specific seasons | reactive work crowds out planned SLA commitments; one trade idles while another queue backlogs; wrong skill or part causes repeat visits | multi-trade skill matrix; planned-vs-reactive capacity bands; SLA/priority queue; subcontractor-pool and cross-trade parts readiness |
| `hvac-contractor` | technician-hours + HVAC parts | **AC repair +266% winter→summer; true peak October** (cooling→heating flip); emergency reserve needed | summer/winter overwhelmed, spring/fall idle | **shift planned maintenance into Feb–Apr troughs to flatten the curve**; block ~20% daily capacity for emergencies; seasonal temp techs ([Samsara](https://www.samsara.com/blog/peak-season-for-hvac), [BDR](https://www.bdrco.com/blog/hvac-maintenance-scheduling/)) |
| `landscaping` | seasonal crew + equipment + daylight | spring/summer growth peak; deep winter trough | **off-season crew with no billable work** (classic overstaffing trap) | seasonal rostering; winter service lines (clearance/gritting); recurring contracts to smooth |
| `cleaning-service` | cleaner-hours | end-of-tenancy at month/term end; commercial contracts smooth | idle one-off capacity between spikes | recurring-frequency capture (weekly/fortnightly) to convert spikes into baseline load |
| `hair-salon`, `barber-shop`, `nail-salon`, `beauty-spa` | **chair/practitioner slot-hours** | weekly (Thu–Sat, evenings); pre-holiday (Dec busiest); wedding/prom; **Jan–Feb −15–25%** | **<70% utilization = paying for idle chairs**; no-shows waste prime slots (10% no-show ≈ $30–60k/yr) | utilization target band (75–85%); **card-on-file + reminders cut no-shows 50–70%**; fill dead weekday mornings with promos ([FinancialModelsLab](https://financialmodelslab.com/blogs/kpi-metrics/hair-salon), [QuarkBooker](https://www.quarkbooker.com/blog/salon-capacity-problem-empty-chairs)) |
| `optician`, `personal-trainer` | practitioner slot-hours | benefit-year resets, back-to-school (optician); Jan + pre-summer (PT) | idle clinical/coaching hours off-peak | same slot-utilization levers; package/pre-pay to pull demand forward |
| `veterinary-clinic`, `dental-practice`, `physiotherapy` | vet/dentist/physio slot-hours + room | seasonal (parasite/allergy spring, sports-injury, **year-end insurance-benefit surge** for dental); emergency reserve (vet) | empty rooms and idle clinicians; over-long default slots waste throughput | differential slot lengths (assessment vs follow-up); recall/recare scheduling; emergency reserve |
| `counselling` | counsellor-hours (emotionally finite) | winter/Jan stress peak | burnout if over-booked; idle if under | conservative caseload caps; waitlist rather than overbook |
| `pet-boarding` | **kennels — physical hard cap** | **Thanksgiving / Christmas / NYE / spring break / summer**; deep off-peak troughs | **peak demand exceeds supply (39% of owners can't secure care)**; off-peak kennels empty | far-advance booking windows + deposits; **holiday surcharge ($5–15/night)**; off-peak daycare/promotions to lift trough occupancy ([MoeGo](https://www.moego.pet/blog/holiday-survival-guide-for-pet-boarding-and-daycare-businesses)) |
| `pet-grooming` | groomer-table slot-hours | pre-holiday; spring shedding | idle tables midweek/off-season | slot utilization; size-based duration so the calendar reflects true capacity |
| `dog-walking` | walker-hours × **route geography** | weekday daytime (owners at work); recurring | gaps between geographically scattered one-offs | recurring-booking capture; route/zone clustering to raise walks-per-hour |
| `restaurant` | **tables × turns × covers** (hard cap) + kitchen throughput | Fri–Sat dinner; **V-Day, Mother's Day, NYE**; patio season | empty covers (each lost turn = lost revenue; +0.5 turn ≈ +25% revenue); over-prep → food waste | reservation slots sized to turn-time; **slight overbooking against ~10% no-show + waitlist**; deposit for large/peak bookings ([RestaurantBookingSystem](https://restaurantbookingsystem.com/academy/table-turnover-rate/)) |
| `catering` | kitchen + event-staff + equipment | wedding season (summer), Q4 corporate parties; long lead time | committed staff/stock for cancelled events | lead-time + deposit at S2; event-date capacity calendar to avoid double-commit |
| `bakery` | oven + baker-hours + **perishable stock** | daily AM; weekend; holiday custom-cake (Christmas/Easter) | **unsold fresh goods spoil same-day**; sold-out by noon = lost demand | par-bake forecasting; pre-order/commission capture to pre-sell perishables |
| `retail-goods`, `artisan-goods` | **durable inventory** + checkout/maker-hours | Q4 holiday surge (Black Friday→Christmas); gift seasons; commission lead time | dead stock ties up cash; stockout = lost sale | reorder points / safety stock; pre-order for commissions/workshops |
| `florist` | **perishable flower stock (no salvage)** + arrangement labour | **V-Day +200–300% (≈30% of annual revenue in one week)**, Mother's Day, weddings; funerals unpredictable | **over-order = total loss** (10% overestimate wipes margin; 5–10% baseline spoilage); wholesale +20–40% at peak | pre-order/cut-off windows to pre-commit demand before buying stock; FIFO inventory; per-event capacity caps ([ProfitableVenture](https://www.profitableventure.com/flower-shop-inventory-management-tips/), [Fresh-o-Fair](https://www.fresh-o-fair.com/blog/mothervsvalentines/)) |
| `wholesale-distribution` | warehouse stock + logistics throughput | downstream-seasonal; bulk lead times | overstock in slow lines; under-stock breaks trade accounts' supply | trade-account demand signals; min-order + lead-time capture; reorder thresholds |
| `gym`, `yoga-studio`, `sports-club` | floor/class-mat **physical cap**; trainer-hours | **January +25–30% sign-ups (~12% of annual)**; Sept restart | **67% of memberships go unused** — the breakage that funds selling beyond physical capacity, but real classes still cap out | sell memberships beyond floor cap on breakage math, but **cap and waitlist classes**; dynamic class pricing; Jan-cohort retention (14% churn by Feb) ([Gymdesk](https://gymdesk.com/blog/gym-membership-statistics)) |
| `corporate-training` | trainer-days | client budget cycles (year-end, Q1); B2B lead time | booked trainers idle if pipeline gaps | pipeline-based capacity forecasting; lead-time booking |
| `tutoring`, `driving-school`, `music-school`, `dance-studio` | tutor/instructor/studio slot-hours | exam season (spring), back-to-school (Sept), term start; recital/test windows | idle instructors out of term; studio empty off-peak | term-enrolment capture; instructor rostering to academic calendar; pickup/route capacity (driving) |
| `consulting`, `legal-services`, `marketing-agency` | **billable fee-earner hours (utilization)** | project/matter-driven; client fiscal cycles; retainers smooth | under-utilization burns margin directly; over-commit risks delivery | utilization tracking; retainer/pipeline smoothing; engagement-capacity visibility |
| `accounting` | accountant-hours (skilled, slow to flex) | **brutal Jan–Apr 15 tax peak + Oct 15 extension; 60–80h weeks** | over-hired permanent staff idle May–Dec | **hire/outsource 4–6 months ahead, flex down off-season**; treat busy season "as a capacity exercise, not a crisis" ([Infinity Globus](https://www.infinity-globus.com/blog/tax-season-staffing-strategy-for-accounting-firms/)) |
| `it-managed-services` | engineer-hours per tier + on-call | recurring agreements smooth; reactive incident spikes; planned project waves | over-provisioned seats vs actual ticket load; SLA breach if under | per-client SLA-aware capacity; incident reserve; agreement-seat vs utilization tracking |
| `charity`, `pet-rescue`, `animal-shelter`, `community-shelter` | volunteer/staff processing; **shelter beds / foster capacity (hard cap)** | **year-end giving (Nov–Dec, Giving Tuesday)**, disaster spikes; intake "kitten season" + post-holiday surrenders; winter shelter demand | volunteer over-mobilised off-peak; **beds full → animals/people turned away** (the hardest cap) | campaign/seasonal volunteer scheduling; intake-vs-capacity tracking; foster overflow network |
| `cooperative` | governance/volunteer cycle | AGM season, surplus-distribution cycle | n/a (governance, not throughput) | member-meeting + governance-cycle calendar |
| `homeowners-association`, `condo-association` | board-volunteer time + contractor scheduling; **amenity rooms (cap)** | dues cycle; seasonal maintenance (pool summer, snow winter); AGM | contractor over-booked at seasonal peak; amenity double-booking | maintenance-season scheduling; amenity booking with hard caps; dues-cycle calendar |
| `property-management-company` | PM staff + contractor pool | tenant-turnover season (summer/academic moves); reactive maintenance + emergencies | idle between turnovers; emergency under-coverage | turnover-season capacity; contractor pool + emergency reserve |
| `community-bank`, `credit-union` | banker/officer appointment slots + loan-processing throughput | spring home-buying; year-end; rate-sensitive lending | idle officers in slow lending periods | appointment slots + underwriting throughput visibility |
| `mortgage-lending` | **loan-officer + underwriting throughput** | **spring purchase season; refi waves when rates drop (exogenous, violent)**; Jan rate-trough/volume-slump | classic **boom-bust**: over-hire in a refi boom, lay off in the bust | throughput-aware pipeline caps; eClosing to lift processing capacity; flex staffing to the rate cycle ([HousingWire](https://www.housingwire.com/articles/understanding-the-seasonal-patterns-of-mortgage-rates/)) |
| `small-town-municipality` | clerk + inspector throughput | permit/construction season (spring–summer); tax/budget deadlines; **statutory must-serve baseline** | over-staffed off-season vs statutory obligation to serve all | seasonal permit-throughput planning; cannot turn away — must size to obligation |
| `municipal-utility` | meter/field crews | **usage-seasonal (summer water, winter heating)**; service connections in moving season; must-serve | crews idle off-peak vs universal-service obligation | seasonal crew planning; service-connection queue; must-serve sizing |
| `law-enforcement-agency` | records/admin throughput | records/FOIA steady; community-concern event-driven; must-serve | n/a commercial; under-capacity = statutory delay | records-request queue/throughput; no commercial capacity lever |
| `new-home-builder`, `custom-home-builder` | **build slots** (crews + subcontractor pool + working capital tied in WIP) + design/sales throughput | interest-rate + housing-season sensitive (spring purchase peak); production builder smooths via inventory homes, custom is pipeline-lumpy | overcommitted crews/subs → slipped completion + carrying cost on unsold spec homes; idle crews between contracts | project-pipeline capacity + subcontractor scheduling; milestone-draw cadence to keep WIP financed; model-home/design-centre throughput (production) vs consultative pipeline (custom) |
| Field-dispatch leaves not otherwise given a dedicated row (Gap-A/Gap-B: all `automotive-services` and `security-services` leaves; `moving-company`, `junk-removal`, `courier-delivery`, `last-mile-freight`; and the folded trades/healthcare/pet/professional/beauty/nonprofit/retail leaves; **never `freight-brokerage`**) | **mobile labour × route/drive-time geography** (crew/technician/officer-hours) | per-vertical: emergency-reactive (roadside, lockout), seasonal (moving, pest), steady-recurring (guard coverage, monitoring, pool service) | idle crews between geographically scattered jobs; emergency under-coverage; over-routed days that slip appointments | see §10.2 — route/assignment (skill×proximity×availability), emergency-reserve blocking, recurring-route capture; the horizontal Field Dispatch capability is the platform lever |
| `freight-brokerage` | **broker/operations case throughput × qualified carrier-market capacity** by lane, equipment, date, service level, and price | lane- and customer-specific seasons plus spot-market, weather, and disruption volatility | idle broker capacity when shipper demand falls; when loads outrun qualified carrier supply, tenders go uncovered or require re-tendering, compressing margin and risking service failure | load-coverage pipeline; carrier qualification/availability; tender and re-tender workflow; lane-capacity, margin, exception, and service-level alerts — no fleet dispatch |
| `dry-cleaning-plant-network`, `wash-and-fold-laundry`, `alterations-tailoring` | **plant/workroom throughput** + counter/route capacity | weekly repeat laundry rhythm; weather and event spikes (coats, gowns, uniforms, back-to-school); commercial accounts smooth the baseline | idle plant labour in troughs; over-accepted work misses ready promises or causes garment mix-ups | promised-ready board; ticket/tag reconciliation; plant capacity lanes; recurring route/account smoothing; early delay notifications |
| `mixed-farm-ranch`, `crop-hay-farm`, `cattle-ranch` | **land/forage carrying capacity × biological window × ready equipment/people/provider capacity** | seasonal and weather-driven; planting/harvest, breeding/calving, forage growth, care and regulatory calendars; market timing is exogenous | unused forage/field window, spoiled inputs or crop, idle capital equipment, animal-health/welfare risk, forced sale, or missed custom-operator slot | backward-plan from latest-safe biological/field dates; dependency readiness; fallback windows; forage/feed and herd-capacity scenarios; source-dated weather/market/regulatory evidence |

### 7.3 What this means for platform functionality (requirements implication)

The matrix collapses to a small set of capabilities the platform must eventually carry to manage demand-vs-capacity for *any* archetype — parameterised by the capacity-unit type, not hand-built per business:

1. **A capacity model per archetype** — bind the constrained unit (Section 7.1 type) to the load-bearing stage so the platform knows *what* is scarce (slot-hours vs hard-cap units vs perishable/durable stock vs throughput).
2. **Demand-signature awareness** — seasonal/weekly/event/fiscal/rate/emergency tags so forecasting and prompts are tuned to the right cycle, not a generic average.
3. **Booking-side levers** — advance-booking windows, lead-times, deposits/no-show protection, waitlists, and overbooking-against-no-show — sized by the cost asymmetry (Section 7.1).
4. **Inventory-side levers** — reorder points / safety stock (durable) and pre-order/cut-off + FIFO (perishable), because over-ordering perishables is the highest-asymmetry loss in the whole set.
5. **Workforce-side levers** — roster-to-forecast, seasonal/temp flex, emergency-reserve blocking, and utilization-band targets (under = idle cost, over = need to hire).
6. **A utilization/occupancy dashboard** — the single surface that makes the two-sided risk visible, so the operator manages the trade-off by data rather than by gut.

These are recorded here as the value-stream-derived requirement set; turning them into backlog items is a separate step (they map naturally onto the scheduling, finance/billing, customer-estate, and inventory surfaces the audit already exercises).

**Business-analysis acceptance frame.** When any of the capabilities above becomes delivery work, the backlog item should carry this minimum evidence:

| Requirement family | User story frame | Acceptance evidence |
|--------------------|------------------|---------------------|
| Capacity model | As an operator, I need the platform to know what constrains my business so I can avoid overpromising or underusing resources. | Archetype row identifies constrained unit; load-bearing stage renders it; booking/order/inbox flow preserves it. |
| Demand signature | As an operator, I need seasonal or event-driven demand to be explicit so forecasts and coworker advice are not generic. | Archetype demand signature appears in EA/admin context and coworker reasoning; audit can cite it in severity. |
| Booking levers | As an operator, I need lead times, deposits, waitlists, and no-show protection tuned to the cost asymmetry of my business. | CTA flow enforces the relevant lever and records the reason in the booking/order reference. |
| Inventory levers | As an operator, I need stock rules that match perishability and lead time, not a generic product list. | Perishable and durable inventory surfaces expose different control points and reporting signals. |
| Workforce levers | As an operator, I need staffing and emergency reserve decisions tied to utilization, not just calendar availability. | Schedule/inbox/admin views show utilization band, reserved capacity, and overload/idle indicators. |
| Utilization dashboard | As an operator, I need one place to see over-capacity and under-capacity risk. | Report-kit-based view shows capacity, demand, utilization/occupancy, and stage impact without hardcoded colors or one-off tables. |

---

## 8. How the architecture feature consumes this

The value streams are not free-text — they bind to substrate the EA surface already holds, so the architecture feature can render them per-archetype without new data:

1. **Stage backbone as a value-stream lane.** Render the six primary stages + two cross-cuts
   (Section 2) as the active archetype's independent operational value stream, in line with the
   canonical [Value Stream entity](../founder-kernel/wiki/entities/value-stream.md). It is neither an
   expansion of a DigitalProduct consumption interaction nor a synonym for any local lifecycle key.
2. **Stage → capability binding from Section 5.** Each stage lights up the `ActivationProfile.modules`, `SchedulingDefaults`, and `BillingPatternProfile` that enable it, so the operator sees *which platform capability carries which stage of their business*.
3. **DigitalProduct lifecycle seam via explicit bindings.** Treat the legacy `It4ItStage[]` attached per
   `PortfolioRole` as candidate migration metadata. A valid join identifies the industry stage or
   work definition, the enabling or constituent DigitalProduct, the local lifecycle key, the
   semantic relationship, rationale, confidence, evidence and BindingState. An external identifier
   is optional and remains `present-unverified` until its source-authorized review. The EA tool can
   then show both kinds of stream on one canvas without conflating them.
4. **ArchiMate export.** `export_archimate` should emit each operational stage as an ArchiMate **Value Stream** element with **serving** relationships to the capabilities (modules) from Section 5 — making the operational stream a first-class, exportable architecture object, not a doc-only diagram.
5. **Banking already shows a useful local binding pattern.** The `seededServiceCategories` values are
   industry capability/service-domain references that can serve operational stages; they are not the
   operational ValueStream itself and are not external conformance evidence. Preserve that
   distinction when generalizing across all 24 categories and 106 current leaves.
6. **Demand–capacity overlay (Section 7).** Render the constrained capacity unit and demand signature on the load-bearing stage so the EA canvas shows not just *which* stage carries the business but *where it is capacity-constrained* — the join point to future capacity-management capabilities.

### 8.7 EA usability presentation contract

The architecture feature has two audiences: operators who need to run the business, and architects/admins who need to understand the substrate. The same model should serve both without exposing the wrong level first.

| View | Primary user question | Required presentation |
|------|-----------------------|-----------------------|
| **Operator summary** | "What part of my business does DPF think is load-bearing, and what do I need to watch today?" | Stage ribbon; load-bearing stage highlighted; trust gate and capacity signal visible; stage labels in business vocabulary. |
| **Capability map** | "Which platform modules carry this stage?" | Stage-to-capability list from Section 5; missing/optional modules called out as capability applicability, not hidden. |
| **Audit / evidence view** | "Why is this defect important?" | Finding grouped by stage, capability, user impact, and severity rationale. |
| **Architecture export view** | "How does this map to standards?" | ArchiMate value-stream elements, serving relationships to capabilities, and explicit evidence-bearing IT4IT DigitalProduct bindings. |

Do not make the first viewport a wall of EA terminology. The load-bearing stage, trust gate, and next operational risk are the first-viewport signals; standards mapping is a drill-down.

### 8.8 Decision substrate — feeds WWWD (business context), not WWMD (platform)

This artefact is **business-context** substrate, and the platform keeps two decision perspectives strictly separate by context. Routing the value-stream architecture to the wrong one would have a coworker reason about a salon using the platform's own build-prioritization stance — exactly the conflation to avoid.

| | **WWWD — "What Would *We* Do"** | **WWMD — "What Would Mark Do"** |
|---|---|---|
| Context | The **customer org's business** — how *this* salon / bank / town operates and decides | The **DPF platform itself** — portal/product build, technical & architectural operation |
| Scope of decisions | Operate the business: serve customers, manage demand vs capacity, honour the trust gate | Prioritize the backlog, what architecture to trust, when to push vs escalate a build |
| Profile source | The org's own leadership decisions, principles, corrections (compounds per-install) | Mark's seed profile (`build-studio-gate.ts`), the founder kernel |
| What this artefact feeds | **Yes — foundational.** The value-stream model, load-bearing stage, demand–capacity concerns, and trust gates are core inputs to the org's WWWD profile | Only indirectly — WWMD governs *how the platform decides to build* the archetype features, not the archetype's business decisions |

**How it feeds WWWD.** The per-archetype value-stream architecture gives a new install a *starting* WWWD perspective grounded in how its kind of business actually works — before the org has accumulated its own decision history. A coworker asking "what would we do here?" for a veterinary clinic should land on: *encounter-based, load-bearing stage is Deliver, capacity is vet slot-hours against seasonal+emergency demand, trust gate forbids clinical advice* — and weight its recommendation accordingly. As the org accumulates its own decisions, its WWWD overlay compounds on top of this archetype-seeded baseline (mirroring how the founder kernel notes an org evolves "from what would Mark do toward what would *we* do").

The separation is the rule: **business-of-the-customer decisions → WWWD (seeded by this artefact); portal/platform/build/architecture decisions → WWMD.** A coworker must select the perspective by context, never blend them.

### 8.9 Provider suitability consumes the value-stream lens

AI provider policy composes onto this projection without creating a second vertical or process taxonomy. The canonical `StorefrontConfig` archetype and a real `OperationalValueStreamStageKey` provide conservative workload defaults when an activity does not already carry a governed data profile. For example, `attract` defaults to public marketing; `settle` defaults to payments/finance; healthcare delivery, banking delivery, education delivery, and public-sector delivery resolve to their bounded regulated workload classes.

The activity contract may carry logical governed asset/field references, processing purpose, and workload hints. Those references identify the work but do not classify or authorize it: the `govern/data` profile and PDP remain authoritative and override every archetype default. Unknown or conflicting high-risk context fails to review/deny. Occupation is a recommendation-focus lens only and cannot widen RBAC, coworker grants, tool authority, or provider eligibility.

This preserves one route-selection path: the work-context adapter produces workload profiles for the existing provider-suitability compiler, which produces hard constraints for the existing V2 router. Cost, quality, health, and capacity rank only inside that eligible set.

---

## 9. How the audit consumes this (and the back-reference)

- **Before a run:** read the archetype's Section 6 profile to know its **load-bearing stage(s)** and **trust gate**. These set where to scrutinise hardest and how to grade severity (Section 4 severity-derivation rule).
- **During a run:** when logging a finding, name the **value-stream stage it breaks** in the OBSERVATION/EXPECTED, and let the load-bearing status drive severity. "Pet fields missing on vet booking" → *breaks S2→S4 handoff of an encounter-based, S4-load-bearing archetype* → `critical`, with the rationale stated rather than asserted.
- **After a run:** the post-audit BI consolidation (test plan Section 10) can group findings **by value-stream stage across archetypes** — e.g. "S3 Schedule defects" or "Trust-gate disclosure gaps" — which is a more actionable dedup axis than per-archetype symptoms.

- **Capacity-aware testing:** read the archetype's Section 7 row before driving Phase P/B/G. A booking calendar that ignores real availability, an inventory surface with no reorder concept, or a finance flow blind to recurring/seasonal revenue is a defect against the *load-bearing demand–capacity decision*, not a cosmetic gap — grade it accordingly.

The archetype audit plan carries a back-reference to this document in its **Related** line and a pointer in its Section 1 so any execution thread reaches the value-stream rationale before driving phases.

---

## 10. Recognized gaps — value-stream patterns not yet covered by a seeded archetype

This section records value-stream *patterns* beyond the original six-stage backbone. One — the rental / shared-asset loop — was identified here as a gap and has since been **built upstream**; it is retained as the canonical description of that pattern (now realized) plus the platform-capability work that remains.

### 10.1 The rental / shared-asset utilization loop (now modelled upstream — `asset-rental` + `agricultural-cooperative`)

**Businesses:** equipment & tool rental, vehicle/trailer rental, party & event rental (tents, chairs, AV), **film/production equipment rental**, **self-storage**, and the **agricultural co-op that shares machinery among member-farmers**.

**Substrate check (re-verified 2026-07-18 against `origin/main`):** these are **now seeded**. The `asset-rental` category carries `equipment-rental`, `self-storage`, and `production-equipment-rental`; the `cooperative`'s `agricultural`/`shared-machinery` sub-type was promoted to a dedicated `agricultural-cooperative` leaf (category `nonprofit-community`, `member-owned`) whose items reserve shared machinery equitably among members. A `rental` value exists in the `CtaType` enum, and `rental-fleet` / `rental-agreements` / `asset-pool` capability types plus a rental/shared-asset entitlement model are in `types.ts`.

**Why it's a genuinely new pattern — not just a missing name.** Every commercial model in Section 3 assumes the offered thing either *leaves* (sale, donation) or is *consumed in a slot* (appointment, encounter). A rental asset does neither: it is **reserved → handed out → used for a period → returned → inspected → re-pooled.** That utilization loop is a value-stream shape the current six-stage backbone only partially fits:

```
  S1 Attract → S2 Reserve a specific asset for a window → S3 Agreement/Deposit/ID
            → S4 Hand-out & Use period → S4b RETURN & INSPECT → S5 Settle (+ damage/late fees) → S6 Re-pool & Retain
```

The new element is **S4b Return & Inspect** and the re-pool — there is no "return" stage anywhere in the sale/booking/donation streams.

**The capacity dynamic it adds (refines Section 7.1).** The capacity unit is neither a perishable nor a static hard cap — it is a **reusable pooled asset**, and its KPIs are *asset-utilization %, turnaround time between rentals, reservation conflicts/overbooking, deposit & damage exposure, and overdue returns.* The demand signature is the sharpest **synchronized-contention** case in the whole set:

- **Ag-equipment co-op:** every member-farmer needs the combine/baler in the *same* harvest window — peak demand is not just seasonal, it is simultaneous against a shared pool that cannot scale for one fortnight a year.
- **Equipment/vehicle/party rental:** month-end and weekend moving trucks; wedding/graduation-season event kit; spring/summer tool demand.
- **Self-storage:** a *physical hard cap* (like kennels) rented on a **subscription/occupancy** basis — its KPI is occupancy %, its peak is the moving season, and its over-capacity failure is the empty unit.

**The co-op wrinkle the commercial renter doesn't have:** when a shared member-owned pool cannot meet simultaneous demand, it must **ration equitably among member-owners** (fair scheduling / allocation), not simply clear the queue by price. That is a member-governance capability (allocation fairness) layered on the rental loop — exactly the seam the existing `member-owned` `GovernanceModel` exists to gate.

**What is built vs. what remains.** Built (2026-06-12): the three archetype leaves, the `rental` CTA, the reservation-with-return form fields (pickup/return dates, unit size, waitlist), and the `rental-fleet`/`rental-agreements`/`asset-pool` capability *types*. **Remaining** is the cross-archetype **asset-pool capacity *engine*** — the running surfaces that make the **S4b Return & Inspect** loop and the reusable-pooled-asset KPIs real: reservation-conflict/overbooking checks, turnaround/utilization tracking, deposit & damage exposure, overdue-return handling, and (for the co-op) the equitable-allocation rationing layer over conflicting member reservations. That engine is the rental-family instance of this design's deferred **capacity-management requirement set** (Section 7.3 / the implementation design §7.3, §10) — not a per-archetype template but a first-class platform capability.

**Disposition:** archetypes — **done** (`equipment-rental`, `self-storage`, `production-equipment-rental`, `agricultural-cooperative`). The **rental/shared-asset value-stream pattern** and its **reusable-pooled-asset** capacity unit are now a recognized part of the model (this section is their canonical description). The asset-pool capacity engine is tracked as capacity-management work, not new-archetype work.

### 10.2 The field-dispatch (mobile-resource-to-customer) loop (now modelled — Gap A leaves + dispatch-native Gap B leaves, 2026-06-13)

**Businesses:** any business where a **mobile resource travels to the customer's site, asset, or person** to perform the work, rather than the customer coming to a premises. This recurs across the catalog rather than living in one category:

- **Folded into existing categories (Gap A leaves):** `hvac-contractor`, `pest-control`, `appliance-repair`, `pool-spa-service`, `pressure-washing`, `roofing-gutters` (trades); `home-health-care`, `mobile-phlebotomy`, `dme-delivery` (healthcare); `mobile-pet-grooming`, `mobile-vet` (pet); `field-inspection`, `land-surveying`, `process-serving-notary` (professional); `mobile-beauty` (beauty); `meal-delivery-program` (nonprofit); `furniture-delivery-install` (retail).
- **New categories containing dispatch-native leaves (Gap B):** all leaves in `automotive-services` (§6.16) and `security-services` (§6.18), plus `moving-company`, `junk-removal`, `courier-delivery`, and `last-mile-freight` in `moving-and-logistics` (§6.17). `freight-brokerage` is expressly excluded: its `sales-assisted` non-asset brokerage flow owns no mobile resource and takes no custody, so it uses the separate §6.17/§7.2 load-coverage model.

**Why it's a recognized pattern — not just a set of leaves.** In every commercial model in Section 3 the **Deliver (S4)** stage happens at the *operator's* premises or in a booked slot there. In field dispatch S4 happens at the *customer's* location, which inserts coordination stages a premises-based stream never has — **assign (skill × proximity × availability), en-route (on-my-way + ETA), and on-site capture.** It is **derived, not flagged**: applicability is a pure function of the operating-model axes —

```
needsFieldDispatch(axes) := form="services" AND delivery∈{physical,hybrid}
                            AND service performed at the customer's location or on the customer's asset
```

read from `consumptionChannel: onsite-plus-portal` (and `episode-of-care` provisioning for in-home care). The loop:

```
  S1 Attract → S2 Intake/Triage → S3 Schedule & Assign(skill×proximity×availability)
            → Confirm → En-route (on-my-way + ETA) → S4 On-site (capture / compliance log)
            → Close → S5 Settle (job → invoice → payment)
```

**The capacity dynamic (refines §7.1).** Within this loop, the capacity unit is **mobile labour + route capacity** — technician/crew/officer-hours × drive-time geography — already in the §7.1 taxonomy. Demand signatures vary: emergency-reactive (HVAC no-heat, roadside, lockout), seasonal (moving, pest), steady (guard coverage, monitoring). The `freight-brokerage` carrier-market capacity model is outside this loop.

**Compliance overlays as job by-products — the moat.** Each vertical attaches a regulated artifact captured at job close: **EPA 608** (HVAC), **ADAS calibration** (auto-glass), **pesticide-applicator** logs (pest), **HIPAA/clinical** notes (home-health, phlebotomy, medical courier), **DOT** hours (moving, towing), **PSO / low-voltage** licensing (security). This is a pluggable overlay framework, not per-archetype code — and no field-service-management product in the market covers any of these.

**Disposition:** dispatch applicability — **done** for the 17 Gap-A leaves, every `automotive-services` and `security-services` leaf, and the four dispatch-native `moving-and-logistics` leaves named above. Those leaves carry the `onsite-plus-portal` axes and compose under `service-operations` until the dispatch module ships; `freight-brokerage` is intentionally outside the set. The **horizontal Field Dispatch capability** — the dispatch board (`map-dispatch` visual pattern), the dispatcher coworker, the skill/proximity/value-aware assignment engine, on-my-way/ETA, and the compliance-overlay framework — is built by a **parallel effort** and derives from these axes via `needsFieldDispatch()`; it is tracked as capability work, not new-archetype work. Source: the 2026-06-13 *Field Dispatch capability design* and its companion *archetype gap analysis*.

---

## 11. Changelog

- **2026-08-01** — Reconciled agriculture/ranching and the **106 archetypes / 24 categories** source
  baseline. Corrected the standards seam: industry operational value streams are independent
  stakeholder-value flows, not lifecycle-consumption expansions. Recast legacy lifecycle metadata
  as migration input and required explicit, evidence-bearing bindings to a named DigitalProduct and
  local lifecycle key; external identifiers require authorized mapping review. Added the current
  operating-standard authority pointer and removed the stale HVAC-leaf gap. Corrected absent trust
  metadata to an unconfigured control-coverage gap, separated non-asset `freight-brokerage` from
  Field Dispatch, and assigned HVAC-specific capacity evidence to `hvac-contractor` rather than the
  mixed-trade `facilities-maintenance` leaf.

- **2026-07-22** — Added **§6.23 `fabric-care-services`** (`dry-cleaning-plant-network`, `wash-and-fold-laundry`, `alterations-tailoring`) and updated the source catalog baseline to **103 archetypes / 23 categories**. The category models garment custody and ready-promise throughput without adding a new provisioning enum in this slice.
- **2026-07-18** — Re-grounded the active text against the current source catalog: **95 archetypes / 21 categories**. Added §6.20 `media-production` and §6.21 `live-events-venues`, moved `medical-practice`/`optician` under healthcare-wellness, corrected fitness/education/nonprofit category headings, and added `production-equipment-rental` to the rental/shared-asset loop.
- **2026-07-17** — Closed the **`real-estate-construction`** coverage gap: added **§6.19** (`new-home-builder`, `custom-home-builder`) and a §7.2 demand–capacity row for the builders + a field-dispatch capacity row. These two builders (EP-GRID-BUILDER) were seeded but never given a value-stream profile — the 2026-06-13 "87 archetypes" count folded in the 17 Gap-A + 12 Gap-B leaves (= 85) and silently omitted them. Inventory re-grounded against `origin/main` `packages/storefront-templates/src/archetypes/` (enumerated `ALL_ARCHETYPES`, cross-checked `archetypes.test.ts`): **87 archetypes / 19 categories** confirmed (real-estate-construction is the 19th category, 2 leaves). Surfaced by the [archetype audit plan](../testing/archetype-audit-plan.md) 87/19 re-grounding (BI-186FFCA7, EP-ARCH-8D4F2A).
- **2026-06-13** — Folded the **field-dispatch archetypes** from the 2026-06-13 gap analysis into the catalog: 17 Gap-A leaves across 7 existing categories (trades, healthcare, pet, professional, beauty, nonprofit, retail) and 3 new dispatch-native categories — `automotive-services` (§6.16), `moving-and-logistics` (§6.17), `security-services` (§6.18). Added §10.2 recognizing the **field-dispatch (mobile-resource-to-customer) loop** as a value-stream pattern that spans categories and is derived from the operating-model axes (`onsite-plus-portal`). Seed count is now **87 archetypes across 19 categories**. Each leaf carries the axes that let the forthcoming horizontal Field Dispatch capability derive dispatch via `needsFieldDispatch()`; the capability itself is a parallel effort.
- **2026-06-12** — Added **Implemented by** link to the platform implementation design (`2026-06-12-value-stream-architecture-platform-design.md`) and the WWWD consumer/§8.8 reference. Corrected §10.1: the rental / shared-asset gap was **built upstream** (asset-rental category + `equipment-rental`/`self-storage`/`agricultural-cooperative`, `rental` CTA, asset-pool capability types; seed now 56) — flipped from "not modelled" to "now modelled," retaining the pattern as canonical and narrowing the remaining work to the asset-pool capacity engine. (Sweep-main caught a worktree-stale gap claim.)
- **2026-06-12** — Enterprise architecture / usability / business-analysis review: clarified decision authority, added reader contract, corrected the standards grounding so ArchiMate and Business Architecture Guild usage are aligned rather than conflated, added architecture/usability invariants, added BA acceptance evidence for demand-capacity capabilities, and split EA consumption into operator, evidence, and architecture/export presentation views.
- **2026-06-11** — Initial draft. Derived from `archetype-audit-plan.md` (53 archetypes, 14 categories), the archetype seed (`packages/storefront-templates/src/archetypes/`), and the operating-model substrate (`types.ts`). Defined the universal six-stage operational value stream, the commercial-model variant table, the stage→surface→phase bridge, the substrate binding, and per-category profiles for all 53 archetypes.
- **2026-06-11** — Added Section 7 (Demand–capacity dynamics at the load-bearing stage): capacity-unit taxonomy, demand-signature taxonomy, two-sided over/under-capacity risk model, a per-archetype demand–capacity matrix for all 53 archetypes (researched seasonality/capacity grounding cited inline), and the derived platform-functionality requirement set. Renumbered subsequent sections (8 architecture, 9 audit, changelog).
- **2026-06-11** — Added the WWWD decision-substrate consumer (§0 item 4) and Section 8.8 (WWWD-vs-WWMD context separation): this artefact is **business-context** substrate that seeds the org's *"What Would We Do"* perspective; **WWMD** ("What Would Mark Do") stays scoped to platform/portal/build/architecture decisions. Decisions must select the perspective by context, never blend them.
- **2026-06-11** — Added Section 10 (Recognized gaps): documented the **rental / shared-asset utilization loop** — equipment/vehicle/party rental, self-storage, and the agricultural shared-machinery co-op — as a value-stream + capacity pattern none of the 8 commercial models expresses (new S4b Return & Inspect stage; reusable-pooled-asset capacity unit; synchronized-contention demand; co-op equitable-allocation wrinkle). Verified against the seed that no such leaf exists and that `cooperative` is modelled as a consumer/membership co-op. Changelog renumbered to 11.
