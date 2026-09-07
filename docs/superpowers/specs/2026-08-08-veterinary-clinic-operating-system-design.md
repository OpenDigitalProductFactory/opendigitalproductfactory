---
status: draft
---

# Veterinary Clinic Operating System — Canonical Design

**Date:** 2026-08-08  
**Status:** Proposed; DPF architecture, data, and UX guardrail review complete. Veterinary
clinical and Illinois legal/compliance validation remain required before regulated
implementation slices are promoted.  
**Epic:** `EP-55AF36AC`  
**Design backlog item:** `BI-685634EB`  
**Research backlog item:** `BI-576D0882`  
**Canonical scenario backlog item:** `BI-79449954`  
**Scope:** Existing `healthcare-wellness / veterinary-clinic` leaf, initially an
independent, single-location US companion-animal general practice.  
**Decision record:** `DI-8BCD8C073E0D` — animal Principal plus PatientProfile,
high-confidence platform recommendation.

## 1. Executive decision

DPF will deepen the existing veterinary-clinic leaf as a **care-practice capability
profile**, not create a parallel veterinary application. It will reuse DPF's canonical
organization, principal, care scheduling and intake, workforce, customer, finance,
document, compliance, work-queue, storefront, portal, and evidence substrates. The
veterinary profile adds the animal-patient, guardian authority, veterinary encounter,
diagnostics, procedure, medication, inventory-lot, controlled-substance, recall, and
jurisdiction semantics that those shared substrates do not currently own.

The primary experience is role-specific and simple by default:

- Julia sees one operational attention surface for the clinic, not another dashboard;
- front-desk staff see today's client/animal flow and exceptions;
- clinicians see the correct animal, guardian/VCPR context, safety facts, encounter,
  diagnostics, medications, charges, and follow-up in one workflow;
- technicians see an actionable treatment/whiteboard queue with witnessed and
  qualification-gated tasks;
- pet owners see the next useful action for each animal through the existing portal.

This design explicitly supersedes the assertion in
`docs/architecture/archetype-business-value-streams.md` that a veterinary pet is
canonically a `CustomerConfigurationItem`. An animal is an identity-bearing
`Principal(kind="animal")`; its `PatientProfile` is the care-role record. Any customer
estate/configuration display of a pet becomes a derived projection or reference, never a
second animal authority. No schema migration is authorized by this document; the
implementation BI must update the doctrine and supply a safe backfill/compatibility plan.

## 2. Problem, users, and outcome

The current archetype can publish a veterinary storefront and collect owner and pet
booking fields, but it cannot safely run the clinical and operating loop from booking to
recall. Generic CRM, inventory counts, invoices, and documents do not by themselves
provide animal identity, clinical record integrity, VCPR, dispensing authority, drug lot
traceability, witnessed controlled-substance adjustments, diagnostic reconciliation, or
compassionate end-of-life handling.

### Primary users and jobs

| Persona | Job the system must make easier and safer |
|---|---|
| Julia, owner/operator/DVM | Know what threatens care, clients, cash, people, inventory, or compliance now; resolve it at the owning record; still practice medicine without managing software all day. |
| Associate veterinarian | Review a trustworthy patient history, conduct and sign the encounter, order/review diagnostics, authorize treatment and medication, and communicate the plan. |
| Credentialed technician | Move patients safely through rooming, treatment, anesthesia, specimens, dispensing, stock use, and discharge within credential and supervision boundaries. |
| Assistant/kennel staff | Complete assigned, permitted care and facility tasks without seeing or doing more than the role requires. |
| Client-service representative | Identify the correct household and animal, schedule the right resources, manage arrival and communications, collect approved payments, and route clinical questions. |
| Practice/inventory manager | Staff capacity, receive and count stock, manage suppliers and recalls, reconcile money and controlled-drug exceptions, and preserve evidence. |
| Animal owner/authorized guardian | Book, complete intake and consent, approve estimates, pay, receive released records/results/discharge, request refills, and keep preventive care current. |

### Product outcome

A small companion-animal clinic can operate a complete, auditable day in DPF without a
shadow spreadsheet, paper controlled-drug log, separate whiteboard, or duplicate animal
record, while clinical judgment and regulated actions remain with qualified humans.

### Governed objective baseline

1. **OBJ-VET-001:** Deepen the existing veterinary archetype as a care-practice
   capability profile that reuses canonical DPF identity, work, scheduling, resource,
   finance, inventory, document, compliance and evidence authorities. Do not create a
   parallel veterinary application or a second animal authority.
2. **OBJ-VET-002:** Let Oak & Prairie and Julia operate a deterministic, complete and
   auditable clinic day from booking through care, diagnostics or procedure, medication,
   checkout, discharge and recall without shadow operating systems.
3. **OBJ-VET-003:** Keep clinical judgment and regulated actions with qualified humans,
   and make controlled-substance, inventory, waste, consent, signature and correction
   paths fail closed with actor, subject, authority, time, reason and provenance.
4. **OBJ-VET-004:** Give every named clinic role a job-appropriate first viewport and
   action flow. Julia sees ranked care, safety, compliance and operating exceptions
   before generic commercial metrics, with accessible desktop and mobile behavior.
5. **OBJ-VET-005:** Define one declarative acceptance-scenario authority that projects
   into Demo Business, simulation, live exercise, UX/audit and replay/export/restore
   evidence with deterministic identity and time. Runner-specific state must not become
   business truth.
6. **OBJ-VET-006:** Use tiered acceptance coverage and a long-tail backlog to deepen
   veterinary functionality while protecting the other archetypes. Reserve approximately
   20% of every implementation slice for tested convergence at seams the slice touches.

### Evidence labels and business-model hypothesis

- **Researched facts** in this document are linked to primary vendor, regulator, statute,
  standard, or current DPF source. Product-review sentiment is explicitly secondary
  evidence.
- **Platform decisions** are stated as decisions and, where applicable, include their
  DPF decision record. They govern the product design but are not claims about veterinary
  medicine.
- **Scenario assumptions** are deterministic choices for Oak & Prairie. They make the
  design and tests concrete; they are not market averages or forecasts.
- **Open hypotheses** require operator/SME or measured-product validation. Examples are
  the best default urgent-capacity reserve, task time budgets, reminder cadence, stock
  reorder parameters, wellness-plan structure, and which client self-service actions
  actually reduce staff time.

The initial business-model hypothesis is an independent, appointment-led general
practice whose scarce capacity is qualified clinical labor plus rooms/equipment. Revenue
comes from visits and procedures, diagnostics, dispensed medications/preventives,
selected retail, wellness subscriptions, and limited insurance assistance. The major
controllable costs are labor, medical/retail cost of goods, outsourced diagnostics,
facility/equipment, payment fees, waste/compliance services, and software/integration
cost. DPF should help Julia improve safe capacity, charge capture, preventive retention,
inventory turns/expiry, and team workload—not maximize visit volume at the expense of
care or staff. Prices, staffing ratios, compensation, clinical protocols, inventory
targets, and plan economics remain organization-owned decisions, not platform defaults.

## 3. Scope and non-goals

### MVP operating core

1. Animal identity, household/guardian authority, VCPR evidence, alerts, and record
   transfer.
2. Online/requested booking, staff scheduling, urgent reserve, waitlist, arrival,
   room/resource flow, and no-show/cancellation handling.
3. Intake, consent, estimate, encounter, SOAP-style documentation, treatment plan,
   immutable signature/amendment, charges, checkout, payment, and discharge.
4. Diagnostic order, specimen/acquisition, result receipt, clinician review, release,
   client notification, and follow-up reconciliation.
5. Procedures, anesthesia/treatment tasks, dentistry foundations, hospitalization
   whiteboard for short-stay care, and humane end-of-life/remains choices.
6. Medication authorization, dispense/administer/waste/return, label and refill data,
   VCPR and species checks, controlled-substance perpetual log, witnessed adjustments,
   and required inventory snapshots.
7. Lot/batch/expiry stock, purchase/receive/use/adjust/transfer/quarantine/recall/dispose,
   cold-chain exceptions, reorder, and food/supplement retail.
8. Reminders/recalls, two-way communications, owner portal, wellness-plan entitlement,
   released records, and insurance assistance.
9. Workforce credential/supervision/rota/capacity controls, compliance evidence, waste
   streams, incidents, audit, end-of-day close, and Julia's attention/cockpit view.
10. Import/export, backup/restore evidence, integration failure queues, and canonical
    scenario fixtures.

### Long tail

- multi-location stock and clinical continuity, mobile/house-call care, emergency and
  specialty/referral networks;
- overnight inpatient/ICU/boarding, blood bank, oncology, rehabilitation, advanced
  dentistry, specialty imaging, and referral coordination;
- equine, herd/food-animal, withdrawal-time, VFD, public-health, reportable disease,
  premises/group-animal, and jurisdiction-specific certification packs;
- richer insurance claims, financing, corporate groups, franchise analytics, research,
  outcomes, and population-health reporting;
- governed AI documentation, coding suggestions, client-message drafting, recall
  outreach, inventory forecasting, and exception triage after the authoritative records
  and evaluation sets exist.

### Explicit non-goals for the initial product

- diagnosis, prescribing, dosing, prognosis, triage disposition, or euthanasia decisions
  made autonomously by AI;
- claiming legal or regulatory compliance from software configuration alone;
- food-producing animals, herd records, boarding, referral hospital, ICU, or 24/7
  emergency operations in the MVP;
- replacing a licensed veterinarian's professional judgment or a practice's counsel,
  regulator, waste vendor, laboratory, pharmacy, or insurer;
- treating animal medical records as ordinary CRM notes or unversioned documents;
- a new top-level Veterinary navigation silo, a second customer/finance engine, or a
  universal inventory database.

## 4. Research & Benchmarking

Research was refreshed on 2026-08-08. Vendor statements describe advertised capability;
verified-review themes describe user sentiment, not guaranteed product behavior. Open
source maturity is stated explicitly because there are not three equally established
open-source veterinary leaders.

### Commercial leaders and modern challengers

| Benchmark | Evidence | User or product delight to adopt | Friction or pattern to reject |
|---|---|---|---|
| [ezyVet](https://www.ezyvet.com/veterinary-practice-management-software) | Cloud PIMS with scheduling/online booking, portal, inventory and purchase-order automation, configurable clinical views, and care-driven invoice capture. [Verified review synthesis](https://www.getapp.com/industries-software/a/ezyvet/) reports strong access, integrations, customization, support, and workflow breadth. | Configurable end-to-end clinical flow, deep integrations, templates, lot/expiry operations, charge capture, portal, reporting, and multi-site reach. | Do not expose configurability as interface density. Avoid setup dependence, steep training, hidden workflow consequences, and fragile performance. |
| [Covetrus AVImark](https://covetrus.com/covetrus-platform/workflow-and-productivity-tools/avimark/) | Mature medical-history, work/follow-up lists, whiteboard, prescription, inventory, and invoice workflows; the [official manual](https://covetrus.com/wp-content/uploads/AVImark-user-manual.pdf) exposes its operational depth. [Verified reviews](https://www.capterra.com/p/92887/AVImark/reviews/) value learnability, full record access, customization, and local continuity. | Fast everyday use, trainable workflows, centralized patient activity, shortcuts/templates, local resilience, and mature clinical/inventory coverage. | Do not reproduce dated visual density, confusing reports/search, workstation/server upkeep, unreliable integration paths, or stock accuracy that depends on expert setup. |
| [Shepherd](https://www.shepherd.vet/features/) | SOAP-linked care, digital whiteboard, automatic charge capture, scheduling, and inventory. | Document once; safely derive treatment, charge, and follow-up work. Make the patient-in-clinic flow legible. | Do not hide record integrity or authorization behind convenience automation. |
| [Digitail](https://digitail.com/) | Pet-parent app, AI SOAP/documentation, summaries/discharge, flowboard, communication, and analytics. | Mobile owner engagement and useful human-reviewed AI drafts that reduce clerical work. | Do not publish or act on clinical AI output without source visibility and qualified approval. |
| [IDEXX Neo](https://software.idexx.com/products/neo) | Approachability and short-path patient workflow are useful product cues. | Simple first viewport, quick patient context, and low training burden. | Ease cannot mean a shallow or lossy clinical/audit model. |

### Open-source benchmarks required by DPF design policy

| Benchmark | Maturity and lessons | Adopt / reject |
|---|---|---|
| [OpenVPMS](https://www.openvpms.com/openvpms/) | Established open-source veterinary PMS with browser access, implementation/support services, and a substantial [training corpus](https://www.openvpms.com/training/) spanning customer/patient, scheduling, consultation, estimates, reminders, prescriptions, investigations, stock, insurance, and till balancing. | Adopt its proof that a complete veterinary workflow is broader than charting and billing. Reject dependence on heavyweight local administration as the default owner experience. |
| [OpenVPM](https://www.openvpm.com/) | Emerging 2026 AGPLv3, API-first project advertising scheduling, SOAP/labs/Rx/vaccines, estimates/invoices, lot inventory, whiteboard, audit/RBAC, export, REST/webhooks, and review-gated agent writes. It is promising but too new to call an established leader. | Adopt open contracts, scoped integrations, data portability, incremental coexistence, and review-gated writes. Do not infer production maturity or standards compliance from feature claims. |
| [Ababu](https://github.com/oldauntie/ababu) | Smaller AGPL problem-oriented veterinary PMS reference. It is useful for inspecting veterinary domain decomposition, not evidence of category leadership or production readiness. | Adopt only independently validated domain concepts. Reject its use as UI, security, deployment, or scale precedent. |

### Synthesis: DPF's differentiation

DPF should combine ezyVet's depth, AVImark's learnable daily flow and resilience, and
modern products' connected SOAP/whiteboard/portal experiences. The differentiator is not
another exhaustive feature menu. It is **progressive operational depth**: the next safe
action for each role, backed by canonical records, explainable policy, reliable export,
and human-governed AI.

## 5. Standards, law, and claim boundary

The first executable compliance profile is `US / Illinois / companion-animal general
practice`, effective-dated and source-linked. Rules are configuration and evidence
requirements, never hardcoded universal truth.

| Concern | Authoritative baseline | Design consequence |
|---|---|---|
| VCPR, prescribing, dispensing, extralabel use | [FDA VCPR and telemedicine](https://www.fda.gov/animal-veterinary/product-safety-information/veterinarian-client-patient-relationships-prescribingdispensing-animal-drugs-and-telemedicine) and [AMDUCA](https://www.fda.gov/animal-veterinary/guidance-regulations/animal-medicinal-drug-use-clarification-act-1994-amduca) | Preserve relationship/evidence and licensed authorizer; do not let an unqualified user or AI authorize a prescription. Extralabel records/labels carry animal/species, directions, cautions, and applicable withdrawal/discard data. |
| Controlled substances | DEA records/forms plus [Illinois record and inventory rules](https://www.ilga.gov/ftp/JCAR/AdminCode/077/077031000003600R.html) | Append-only receipt/use/dispense/waste/return/adjustment ledger; actor, registrant/location, animal/encounter, quantity/unit, before/after balance, reason, witness where required, and immutable correction. Support federal biennial and Illinois annual snapshots without replacing the perpetual log. |
| Clinical record/confidentiality | [Illinois Veterinary Medicine and Surgery Practice Act](https://www.ilga.gov/Legislation/ILCS/Articles?ActID=1326&ChapterID=24) | Patient/client identification; dated history/exam/procedures; every administered, prescribed, or dispensed medication and change; images/labs/consults; designated decision agent; authorizations; confidentiality; release workflow; at least five-year retention from last known contact for the fixture. |
| Pharmaceutical and medical waste | [EPA hazardous-waste pharmaceutical rule](https://www.epa.gov/hwgenerators/management-hazardous-waste-pharmaceuticals) and [OSHA hazardous-drug exposure controls](https://www.osha.gov/hazardous-drugs/controlling-occex) | Separate sharps, pharmaceutical, controlled, hazardous-drug, pathological/remains, and ordinary waste streams; container/vendor/manifests, custody, exposure incident, and disposal/destruction evidence. No drain-disposal shortcut. |
| Pet travel | USDA APHIS and destination authority requirements | Certification is a versioned, destination/date-specific evidence workflow with accredited-veterinarian approval, never a static form promise. |
| Accessibility and privacy/security | WCAG 2.2 AA; DPF identity, RLS/ABAC, audit, retention, and sensitive-data policy packs | Purpose-scoped, minimum-necessary access; non-color status; accessible forms/tables/flows; owner-facing release projection separate from internal records. |

This design is not legal advice. The practice remains responsible for applicability,
licenses, standard of care, record policy, DEA registrations, state requirements, waste
classification, vendor qualification, and approvals. Implementation gates require a
licensed veterinary SME and Illinois legal/compliance reviewer to validate rule text,
evidence, dates, and role boundaries.

## 6. Existing substrate audit and supersession

### Reuse as authority

| Domain | Existing authority to reuse | Veterinary use |
|---|---|---|
| Tenant/business identity | `Organization` | Oak & Prairie name, location, contacts, branding, locale, policy profile. No parallel practice table. |
| Identity | `Principal`, `PrincipalAlias` | People, coworkers, devices, and animal identity; microchip/legacy-PIMS aliases with issuer and provenance. |
| Care subject/authority | `PatientProfile`, `PatientAuthority`, `PatientConsentDirective` | Animal care role, owner/guardian/designated-agent scope, consent/directive evidence. |
| Access and scheduling | `CareVisitType`, `CareLocation`, `CareResource`, `CareSchedulingPolicy`, `CareAppointment` and participants/resources/status events | Veterinarian, technician, room, surgery suite, imaging, urgency reserve, arrival and resource allocation. |
| Intake | `CareIntakePacket` family | Species/reason-for-visit forms, owner attestations, access grants, consent and exceptions. |
| Customer and commercial | `CustomerAccount`, `CustomerContact`, `Quote`, `Invoice`, `Payment` and allocations | Household/client relationship, estimate, deposit, invoice, payment and balance. Clinical identity remains outside CRM. |
| Workforce | `EmployeeProfile`, `ServiceProvider`, staffing/scheduling contracts | Role, credential, availability, supervision, capacity and rota. |
| Procurement | `Supplier`, `PurchaseOrder` and line items | Distributor, lab, waste vendor and supply purchasing. |
| Documents/evidence | `Document` family, `ComplianceEvidence`, `ComplianceIncident`, audit/control substrate | Images/reports/certificates/consents/manifests with typed references, release and retention. |
| Work orchestration | `WorkItem`, queues, Workspace attention contract | callbacks, refill review, lab reconciliation, discharge, recall, inventory and compliance exceptions. |
| Portal/storefront | Existing storefront booking/catalog and `/portal` | public services, booking request, owner tasks, released animal information, payments and retail. |
| Shared capacity | Care resource authority with normalized shared-capacity read contract | Provider/room/equipment conflicts and owner-language utilization without a new resource authority. |

### Existing substrate that is insufficient or wrong for authority

- `CustomerConfigurationItem` is currently technology/customer-estate flavored and
  cannot remain the animal identity authority while care appointments require a
  `PatientProfile`. Existing veterinary CI rows need compatibility references or
  backfill, then become projections.
- `AdoptableAnimal` belongs to shelter/rescue availability and adoption lifecycle; it is
  not a clinic patient or medical-record authority.
- `StockItem` is a quantity snapshot, explicitly not a transaction ledger. It cannot
  prove lot, expiry, custody, recall, administration, wastage, or controlled balances.
- Current digital `InventoryEntity` discovery records do not own physical clinical stock.
- `Encounter`, signed clinical record, medication, diagnostic/specimen/result, stock-lot
  movement, and controlled-substance ledger authorities were not found in the live
  Prisma schema at review time. The approved healthcare foundation describes some as
  target contracts, not implemented truth.

### Canonical animal identity decision

The platform decision compared:

1. animal `Principal` plus `PatientProfile` and a thin veterinary side profile;
2. a generalized polymorphic care-subject refactor spanning Principal and configuration
   item authorities;
3. a parallel veterinary patient/appointment engine.

`principle_decide` interaction `DI-8BCD8C073E0D` recommended option 1 with high
confidence (composite 10.7704, margin 1.9335, no commandment conflict). It best preserves
Principal convergence, single source of truth, existing care contracts, and bounded
migration. Option 2 has wider platform blast radius; option 3 duplicates identity and
care engines.

## 7. Target domain model and authority

Names below are **target contracts**, not pre-approved Prisma model names. Each
implementation BI must re-audit the then-current schema, use closed enums for closed
axes, and obtain migration/data-steward review.

### Identity and relationship

- `Principal(kind="animal")` owns durable animal identity and aliases.
- One `PatientProfile` gives that principal the care-subject role.
- A thin one-to-one veterinary patient extension owns stable animal demographics:
  species/taxon reference, breed reference/free-text fallback, birth date or estimate,
  sex/reproductive status, color/markings, deceased state/date, food-chain status, and
  species-safe default units. Mutable weights, problems, allergies, medications, and
  findings are observations/clinical facts, not profile columns.
- Microchips, legacy PIMS keys, rabies certificate identifiers, and other identifiers use
  typed aliases or typed document references with issuer/provenance; uniqueness rules are
  issuer-aware.
- The owner/guardian is a human Principal connected through `PatientAuthority`, and may
  also be the CustomerAccount/CustomerContact responsible for estimates and payment.
  These roles are related, not conflated. An animal never self-authenticates.
- Multiple guardians, designated agents, foster/rescue organizations, disputed
  ownership, deceased owners, and record-release scope are explicit relationships with
  effective dates and evidence.

### Clinical and operating contracts

| Contract family | Required authority and invariants |
|---|---|
| Veterinary encounter and clinical record | Appointment and encounter remain distinct. An encounter is linked to animal, participating practitioner/team, location, reason, episode and source appointment. Notes/facts are draftable, then signed by an authorized clinician; post-signature edits create attributable amendments or entered-in-error state. Never overwrite signed history. |
| Problem/allergy/medication/immunization/measurement | Typed, provenance-bearing clinical facts with status, onset/effective time, author/source, and correction history. Weight includes value, unit and observed time; dosing computation can reference but never silently mutate it. |
| Treatment plan, estimate and consent | Clinical plan is separate from commercial `Quote`; line mappings preserve what was proposed, authorized, performed, declined and charged. Consent records signer authority, version, scope, evidence and withdrawal/revocation where meaningful. Price changes never rewrite the clinical plan or signed estimate. |
| Diagnostic order/specimen/result/imaging/referral | Order, collection/acquisition, external accession, result/report, clinician review, release and client notification are separate states. Receipt is not review; review is not release; release is not acknowledgement. Orphans/duplicates/corrections enter an exception queue. |
| Medication order/dispense/administration | Product, active ingredient, strength/form, calculated and authorized directions, animal/species/weight context, VCPR, prescriber, dispenser/administrator, lot/expiry, quantity/unit, refill and label data are traceable. Suggestions do not become orders. |
| Controlled-substance ledger | Append-only quantity movements per registrant/location/container or lot with reason, actor, animal/encounter when applicable, witness/approval, running balance, inventory snapshot linkage, discrepancy case, and destruction/return evidence. Corrections reverse and restate; never edit history. |
| Physical stock ledger | Item/SKU plus location, lot/batch/serial where relevant, expiry, quantity and unit-of-measure. Receive, reserve, dispense/administer/use, sell, transfer, adjust, quarantine, recall, expire, return and dispose are movements. `StockItem` remains a derived snapshot during transition. |
| Procedure/treatment episode | Procedure, anesthesia observations, medication administrations, monitoring, tasks, staff/resource allocation, implants/materials, recovery and discharge link to one episode. Qualification and supervision gates apply per task. |
| Preventive recall/wellness entitlement | Recommendation/due logic is distinct from reminder attempts and from paid-plan entitlement. A plan never marks care complete; performed/signed clinical facts do. |
| Waste/remains/custody | Waste class, source event, quantity/unit or container, custody handoffs, storage, vendor, manifest/certificate, witnessed destruction where required, incident and correction. End-of-life remains choice and consent are compassionate client-facing records, not stock disposal. |

### State machines

1. **Access and visit:** request -> held -> confirmed -> arrived -> in-care ->
   ready-for-checkout -> fulfilled/closed, with cancelled, no-show, declined, redirected,
   and entered-in-error paths. Resource consumption follows lifecycle, not display status.
2. **Clinical record:** draft -> in-progress -> signed -> amended or entered-in-error.
   Only qualified signers can move to signed.
3. **Diagnostic:** ordered -> collected/acquired -> sent -> received -> reconciled ->
   reviewed -> released -> notified -> acknowledged/follow-up, with corrected and
   cancelled paths.
4. **Medication:** proposed -> clinician-authorized -> prepared -> dispensed/administered
   -> reconciled, with declined, held, returned, wasted, reversed, and adverse-event
   paths.
5. **Stock lot:** ordered -> received -> available -> reserved/used/sold/dispensed or
   quarantined -> recalled/returned/expired/disposed. All quantity changes are movements.
6. **Controlled discrepancy:** detected -> contained -> assigned -> investigated ->
   approved adjustment or incident/escalation -> reconciled -> closed. Detection never
   auto-adjusts the ledger.
7. **Estimate/consent/charge:** proposed -> reviewed -> authorized/declined -> performed
   -> charged -> paid/allocated/refunded. Each transition preserves its own actor/time and
   does not imply the others.

## 8. Information architecture and UX design

### Navigation ownership

Veterinary functionality uses existing destinations and the canonical navigation model:

| User need | Owning surface | Route strategy |
|---|---|---|
| What needs action now | Workspace operator cockpit and vertical workspace contribution | Extend `/workspace`; one attention count, customer/patient impact ordering, drill-through to authority. Do not add a second cockpit. |
| My clinical/operational work | Personal queue and inbox | Extend `/workspace/my-queue` and `/workspace/inbox` with role- and permission-filtered veterinary work. |
| Day schedule and clinic flow | Business calendar plus care-flow presentation | Reuse `/workspace/calendar`; add an archetype-gated clinic day/whiteboard presentation, not a separate scheduling authority. |
| Owner household and animal records | Customer domain plus patient-care detail | Reuse `/customer` for commercial relationship; animal clinical detail resolves through the care record from a linked animal card. Never put clinical notes in CRM activity. |
| Money | Finance | Reuse quotes, invoices, payments, suppliers, purchase orders, reports and close. Add typed encounter/plan/dispense references. |
| Physical clinical inventory | Inventory presentation | Reuse `/inventory` navigation placement but route writes to the veterinary physical-stock authority, not digital inventory discovery. |
| People and credentials | Employee/workforce | Reuse `/employee` and workforce schedule/capacity contracts. |
| Compliance and evidence | Compliance | Reuse `/compliance` for obligations, controls, evidence, incidents, audits and submissions; present owner language and effective jurisdiction. |
| Owner/guardian self-service | Customer portal | Extend `/portal` with animal household, next action, forms/consent, estimate, payment, released record/result, discharge, refill and order status. |
| Public discovery/booking/retail | Storefront | Extend existing veterinary storefront and booking; do not expose internal clinical statuses. |
| Trends and business decisions | Performance/business operations | Use existing performance views for capacity, revenue, margin, recall and retention; no duplicate KPI dashboard. |

### First-viewport contracts

- **Julia:** today/now, urgent care or safety exceptions first; then flow/capacity,
  unreviewed results, controlled-drug/temperature/recall exceptions, staffing gaps,
  client-impacting callbacks and money-close issues. Show one recommended next action and
  the authority record. Routine healthy counts are subordinate.
- **Veterinarian:** selected animal identity/photo/name/species plus wrong-patient safety
  banner; reason, guardian/VCPR, allergies/current medications/problems, latest weight
  with date/unit, tasks/results, encounter editor and required approvals. Historical
  detail is progressively disclosed and searchable.
- **Technician:** real-time clinic flow/whiteboard, assigned treatment/procedure/specimen
  tasks, due/overdue state, room/resource, accountable veterinarian, and explicit
  witness/qualification gates. Mobile tap targets and interrupted-work recovery are
  mandatory.
- **CSR:** search household or animal, see communication/booking/financial context and
  only the minimum clinical flags needed for safe routing. Clinical questions become a
  task; the interface does not invite diagnosis.
- **Owner/guardian:** animals grouped in the household, one next action per animal,
  upcoming visit, forms/consent/estimate/payment, released results/discharge, medication
  or food reorder, preventive due state, and secure messaging. Internal notes, unreleased
  results, staff-only alerts and ledger details never cross the projection.

### Interaction rules

- Use DPF shared surfaces, cards, report-kit, tables, form primitives, save-state and async
  feedback. All style uses `--dpf-*` tokens, supports light/dark/branding, and meets WCAG
  2.2 AA.
- Status is always text plus accessible semantics; color/icon may reinforce but not carry
  meaning. No sub-legible text and no pointer-only interaction.
- The primary action is visible on arrival. Configuration, history, raw integration
  payloads, detailed ledgers, and advanced filters live behind progressive disclosure.
- Search tolerates owner name, animal name, phone/email, microchip, legacy ID and external
  accession while presenting enough disambiguation to prevent wrong-animal work.
- Destructive/irreversible/high-consequence actions use consequence notices, explicit
  subject confirmation, permission/qualification checks, reason, and recovery or
  correction path.
- Empty states state what is absent, whether that is safe/expected, and the next allowed
  action. Failure states preserve entered data, identify the affected authority, offer
  retry/queue/fallback, and never silently mark an operation complete.
- Offline/degraded operation may preserve read access or queue explicitly supported work,
  but it shows freshness and synchronization state. A queued clinical/financial/stock
  write is never represented as committed.

### Delight objectives

1. One search and one animal context across schedule, record, diagnostics, treatment,
   charges and communications.
2. Documentation, performed treatment, stock relief, invoice candidates and follow-up
   connect without duplicate entry, while each authoritative transition remains visible.
3. A legible live clinic flowboard with timers/exceptions rather than an overloaded grid.
4. Owner portal actions reduce phone calls but never expose unreleased or staff-only data.
5. Reliable keyboard/tablet paths and trainable role views; advanced configuration does
   not burden everyday use.
6. Open export, integration health and recoverable exception queues avoid lock-in and
   silent loss.

## 9. AI coworker boundary

Initial coworkers may summarize an already authorized record, draft a SOAP note from
source material, suggest missing documentation, draft discharge/client messages, prepare
a recall list, classify an integration or inventory exception, and propose a next
operational action. Every draft identifies its sources, patient, encounter, time, and
uncertainty; writes use existing governed tool grants and visible review.

AI must not autonomously:

- diagnose, prescribe, determine dose, authorize a refill, make a triage disposition,
  release a result, establish VCPR, sign a clinical record, or recommend/authorize
  euthanasia;
- modify a signed note, controlled ledger, stock balance, charge, consent or compliance
  evidence without the owning workflow and required human approval;
- infer owner authority, clinician credentials, jurisdiction, species, weight, or current
  medication from weak context;
- tell the practice or owner that the clinic is compliant.

Evaluation sets must include wrong animal/household, stale weight, similar drug names,
species contraindication boundary, hidden negation, duplicate result, revoked guardian,
unreleased result, expired VCPR, controlled discrepancy, and prompt/integration payload
injection. Qualified humans remain accountable for clinical and regulated actions.

## 10. Integration, resilience, and data portability

### Integration boundaries

- reference/in-house laboratories: typed order, specimen/accession, result, correction,
  review and release; identifiers and raw payload retained with provenance;
- imaging/PACS: order/worklist, study/report reference and authenticated viewer launch;
- pharmacy/e-prescribing/online pharmacy: authorized prescription/refill and fulfillment
  status, never an unreviewed AI order;
- payment/finance: existing processor and QuickBooks bridge with idempotent postings and
  reconciliation;
- distributor: catalog mapping, purchase order, acknowledgement/backorder, receive lot
  and invoice matching;
- insurer: estimate/claim/document/status assistance without claiming universal coverage
  adjudication;
- USDA APHIS/destination authorities: evidence pack and accredited-vet submission where a
  supported interface exists;
- legacy PIMS: staged import, identifier crosswalk, totals, rejects, provenance, signed
  clinical document preservation, and reconciliation report.

Every connector has scoped credentials, explicit source authority, idempotency key,
watermark, retry/dead-letter state, operator-visible last success/failure, and replay that
cannot duplicate medication, stock, charge, payment or result records. APIs and exports
use stable versioned contracts. Full tenant export includes relational records, documents,
aliases, audit/evidence and a machine-readable manifest.

### Runtime and recovery

- The canonical runtime remains the only runtime truth; veterinary capability does not
  create a special deployment path.
- Recovery objectives and backup/restore evidence are defined before production launch.
  The Julia fixture must prove restore/reconciliation, not only backup creation.
- Degraded external services keep clinical safety visible: staff can identify the animal,
  see last-synchronized essential context, record supported local work or use the named
  downtime procedure, and later reconcile without hidden duplication.
- Release is archetype-gated and reversible at presentation/integration seams; irreversible
  migrations require forward correction, preserved legacy identifiers and reconciliation.

## 11. Security, privacy, and clinical safety

- Organization isolation applies to every animal, guardian, appointment, clinical fact,
  document, stock movement, charge and audit record. Negative tenant tests are mandatory.
- Authorization considers actor, role/credential, organization, animal/encounter,
  purpose-of-use, relationship/assignment, record sensitivity, location/registrant and
  requested operation.
- Separate permissions exist for reception, assistant, technician, veterinarian,
  inventory manager, finance, practice owner, auditor and owner/guardian portal.
- Break-glass, if implemented, requires explicit reason, constrained duration, heightened
  audit and notification/review. It never grants prescribing or controlled-substance
  authority by itself.
- Clinical facts and ledgers use attributable version/amendment/reversal semantics.
  Generic audit logs are supporting evidence, not the only history.
- Portal records are explicit release projections. Owner authority, release scope and
  confidentiality exceptions are effective-dated and auditable.
- Secrets and external credentials remain in the platform credential substrate; no
  veterinary setting stores plaintext secrets.
- Exports, record releases and AI processing are purpose-scoped, logged and subject to
  retention/legal-hold policy. Deletion never silently destroys retained clinical or
  controlled-substance evidence.

## 12. Canonical scenario: Oak & Prairie Veterinary Clinic

All people, animals, identifiers, quantities and transactions are fictitious deterministic
test data, not market or clinical claims.

### Practice

- Cedar Glen, Illinois; independent single-location companion-animal GP.
- Dr. Julia Ramirez is owner, operator, medical director, treating DVM and DEA registrant.
  She treats 3.5 days/week, reviews controlled-drug reconciliation, approves novel spend,
  and owns escalated business/clinical decisions.
- Facility: four exam rooms; surgery/dental suite; treatment area; in-house lab; digital
  radiography; pharmacy and controlled safe; small retail wall; six short-stay kennels.
- Hours: Monday–Friday 07:30–18:00, Saturday 08:00–13:00; after-hours emergencies are
  referred. Same-day urgent capacity is protected.
- Team: Julia, two associate DVMs (1.0 and 0.8 FTE), practice manager, four credentialed
  technicians, three assistants, three CSRs and one kennel/clinic assistant. A senior
  technician owns inventory cycle counts.
- Deterministic scale: 2,800 owner households, 4,200 active animals, 36 typical weekday
  bookings plus urgent inserts, two procedure mornings weekly, 250 wellness-plan animals.
- Species: dogs, cats, rabbits and a small number of birds/reptiles. Food animals are out
  of MVP.
- Revenue: visits/procedures, diagnostics, dispensed medication/preventives,
  food/supplements, wellness subscriptions, selected procedure deposits and insurance
  assistance; no routine consumer credit.

### Named actors and golden journeys

| Journey | Actors and expected proof |
|---|---|
| Preventive visit and recall | Dana Brooks and Max (dog): online booking, guardian link, intake, exam, vaccine lot/expiry and certificate, wellness entitlement, invoice/payment, discharge and next recall. |
| Same-day urgent visit | Robert Chen and Luna (cat): CSR safety routing, protected urgent capacity, arrival, veterinarian assessment, diagnostics, estimate/consent, treatment, released discharge/result, payment and insurance assistance. The fixture validates workflow only, not medical advice. |
| Species boundary | Amina Yusuf and Clover (rabbit): species-aware visit/resource selection and a medication-safety escalation that prevents unsupported automation. |
| Dental/procedure | Theo Morgan and Scout (dog): estimate/consent, procedure and anesthesia/treatment tasks, controlled administration and witnessed partial-vial wastage, lot relief, automatic charge candidate, clinician sign-off, recovery and discharge. |
| Compassionate end of life | Erin Patel and Nori (cat): identity/authority, explicit euthanasia and remains-choice consent, qualified approvals, medication/waste evidence, compassionate communications and record state. |
| Inventory and safety exceptions | Expiring vaccine lot, recalled food SKU, failed refrigerator check, supplier backorder and controlled discrepancy each create containment and a Julia/manager next action without silently changing stock. |
| Operating exceptions | No-show waitlist fill, staff call-out/capacity rebalance, end-of-day payment close, pharmacy margin alert, online food order, records transfer and APHIS travel-certificate timeline. |

Fixtures include successful, exception, permission-denied, qualification-denied,
duplicate/replay, stale-data and recovery paths. Dates, IDs, prices, quantities and stock
values are resettable. At least Julia and technician views have mobile acceptance checks.

## 13. MVP release slices and dependencies

No implementation child BI is design-ready solely because it appears below. Each must
pass demand activation, link this approved design, identify its slice and golden journey,
and receive a grounded implementation plan before code.

| Slice | Outcome | Primary BIs | Entry/exit gate |
|---|---|---|---|
| 0. Activation and authority | Correct veterinary activation profile, vocabulary, animal/guardian identity and deterministic scenario. | `BI-79449954`, `BI-B18DA56E` | Clinical/compliance review; target schema and migration/backfill approved; doctrine supersession explicit; tenant/authority tests designed. |
| 1. Access and daily flow | Booking through arrival, resource allocation, urgent reserve, waitlist and clinic flow. | `BI-E80B44A7`, `BI-7B369FB4` | Care scheduling and shared-capacity reuse proven; role first view and failure states reviewed. |
| 2. Encounter and results | Signed encounter, treatment/estimate/consent/charges, diagnostics and short-stay/procedure workflow. | `BI-7C616CA3`, `BI-AD588102`, `BI-371E86F2` | Record integrity, result release, qualification, wrong-patient and interruption tests pass. |
| 3. Medication, stock and compliance | Prescribing/dispensing/admin, controlled ledger, lot inventory, cold-chain, recall, waste and evidence. | `BI-88D28A7E`, `BI-9B2ED87F`, `BI-D135101D` | Veterinary SME and Illinois legal/compliance sign-off; append-only/reconciliation/concurrency/migration verification passes. |
| 4. Client and business close | Checkout/payment, portal, communications, recalls, wellness, retail and Julia's operating attention. | `BI-7EA35349`, `BI-73A52249`, `BI-47CABF18`, narrow MVP from `BI-F2CB784B` | Release projection, accessibility, close/reconciliation, owner-task reduction and cockpit single-source checks pass. |
| 5. Ecosystem and governed delight | Migration/export, integrations, resilience and human-reviewed AI assistance. | `BI-093BAD22`, `BI-15715D7D` | Stable contracts, replay/dead-letter, restore/export, source attribution and safety evaluation gates pass. |
| Long tail | Multi-site/mobile/emergency/specialty, food animal/public health/travel depth and extended retail. | `BI-204EB07D`, `BI-C2FD0C18`, remainder of `BI-F2CB784B` | Separate approved designs and jurisdiction/specialty reviewers; not an MVP dependency except the narrow travel-certificate fixture. |

## 14. Backlog traceability and acceptance journeys

| Backlog item | Design obligation | Minimum Oak & Prairie journey |
|---|---|---|
| `BI-B18DA56E` identity/VCPR/consent/record | Animal Principal + PatientProfile, guardian authority, VCPR evidence, signed/amended record. | Max plus Nori. |
| `BI-E80B44A7` scheduling/triage/flow | Care scheduling/resources, urgent reserve, waitlist, arrivals and status history. | Luna plus no-show fill. |
| `BI-7C616CA3` encounter/treatment/estimate/charge | Encounter integrity, plan/quote/consent/performed/charge separation. | Luna. |
| `BI-AD588102` diagnostics/referrals | Order-to-result reconciliation, review/release/notification. | Luna. |
| `BI-88D28A7E` pharmacy/controlled drugs | Qualified authorization and append-only medication/controlled movements. | Scout. |
| `BI-9B2ED87F` inventory/procurement/cold chain/recall | Lot ledger and movements, PO receive, quarantine, temperature and recall. | Expiring vaccine, food recall, fridge failure, backorder. |
| `BI-371E86F2` procedures/anesthesia/dentistry/whiteboard | Procedure episode, tasks, monitoring, short stay and recovery. | Scout and Nori. |
| `BI-7EA35349` checkout/payment/insurance/wellness | Quote/invoice/payment/deposit/allocation and entitlement boundaries. | Max and Luna. |
| `BI-73A52249` portal/comms/recall/discharge/records | Explicit release projection and owner next actions. | Max, Luna and records transfer. |
| `BI-7B369FB4` workforce/credentials/rota/capacity | Credential/supervision and safe capacity response. | Staff call-out. |
| `BI-D135101D` compliance/safety/waste/incidents/audit | Effective-dated policy/evidence, waste custody, incident and audit. | Scout controlled waste, fridge failure and Nori remains choice. |
| `BI-47CABF18` Julia cockpit/KPIs | One ranked attention contract with drill-through; no duplicate dashboard. | Typical morning, exceptions and end-of-day close. |
| `BI-093BAD22` integrations/migration/portability/resilience | Crosswalk, provenance, idempotency, exception queue, export and restore proof. | Lab duplicate/correction, payment replay and legacy import. |
| `BI-15715D7D` AI delight | Source-visible drafts, tool grants, qualified review and adversarial safety tests. | SOAP/discharge draft and recall proposal; denied prescribing/release. |
| `BI-F2CB784B` retail/add-ons | Food/supplement catalog/order/stock/price/margin; wellness entitlement remains separate from care completion. | Online food order and pharmacy margin alert. |
| `BI-204EB07D` multi-location/mobile/emergency/specialty | Separate long-tail architecture; do not distort single-site MVP. | Deferred extension fixture. |
| `BI-C2FD0C18` public health/travel/food animal/jurisdiction | Versioned policy and certification/withdrawal/reporting workflows. | APHIS timeline only in initial fixture; food-animal deferred. |

### Objective-to-acceptance mapping

These criteria make the objective baseline reviewable and give implementation plans
stable requirement references. Passing a fixture oracle proves product behavior only
when the underlying capability exists; an expected-gap observation is evidence for its
owning BI, not acceptance of missing functionality.

| Acceptance criterion | Objectives | Required proof | Design coverage |
|---|---|---|---|
| **AC-VET-001** | `OBJ-VET-001`, `OBJ-VET-005` | Oak & Prairie and Julia are the sole canonical veterinary fixture identity. No Meadowbrook/Iris or runner-local business copy remains, and all projections resolve to one scenario authority. | §§1, 6, 12, 14 |
| **AC-VET-002** | `OBJ-VET-002` | Preventive, urgent, species-boundary, procedure, end-of-life, inventory-safety and operating-exception journeys are deterministic, resettable and executable or reported as explicit product gaps. | §§3, 12, 15 |
| **AC-VET-003** | `OBJ-VET-003` | Controlled-drug, waste, cold-chain, recall, consent, signature, authority and correction negative paths fail closed and preserve actor, subject, authority, time, reason and provenance. | §§5, 7, 11, 12, 15 |
| **AC-VET-004** | `OBJ-VET-004` | Julia, veterinarian, technician, assistant/kennel, CSR, manager and guardian complete their MVP jobs at real privileges; first viewport, drill-through, denial/recovery, accessibility and required mobile checks pass. | §§8, 12, 15 |
| **AC-VET-005** | `OBJ-VET-001`, `OBJ-VET-002` | Animal/guardian, VCPR, appointment, encounter, diagnostic, procedure, medication, stock, finance and evidence records resolve through their canonical authorities without a duplicate veterinary record system. | §§6–7, 12, 16 |
| **AC-VET-006** | `OBJ-VET-005` | The scenario validates and compiles deterministically; existing adapters consume compiled projections; duplicate, retry, export/restore and evidence correlation retain stable references. | §§10, 12, 15 |
| **AC-VET-007** | `OBJ-VET-006` | The tiered registry protects all 13 canonical operating shapes, deep fixtures and affected shared contracts; impact selection includes the smallest sufficient deterministic test set. | §§13–15 |
| **AC-VET-008** | `OBJ-VET-003`, `OBJ-VET-006` | Regulated implementation does not claim completion until named veterinary, legal/compliance, controlled/waste, security and accessibility reviews are recorded, and each slice accounts for its tested 20% refactoring allocation. | §§18–20 |

## 15. Verification strategy

### Functional and contract verification

- wrong-tenant, wrong-animal, wrong-guardian, revoked authority, insufficient role,
  expired credential/VCPR, and break-glass negative tests;
- lifecycle and concurrency tests for appointment/resource conflicts, signed amendments,
  diagnostic duplicates/corrections, medication authorization, stock movement and
  controlled balance;
- unit and property tests for unit conversion, quantity precision, lot allocation,
  before/after balances, idempotency and reconciliation totals;
- integration contract tests for lab/imaging/pharmacy/distributor/payment/accounting,
  including timeout, duplicate, out-of-order, malformed, corrected and replayed events;
- data migration/backfill tests against representative existing pet configuration rows,
  partial data, duplicate aliases and all supported existing states;
- backup/restore and full-export reconciliation using the canonical scenario;
- audit/evidence tests proving who, what, subject, authority, source, time, reason,
  version, approval/witness and correction.

### UX and accessibility verification

- run the affected path in the canonical runtime with Julia, DVM, technician, CSR,
  manager and owner/guardian personas at real privileges;
- verify desktop and technician/Julia mobile widths, keyboard-only operation, screen-reader
  names/landmarks/status, focus recovery, WCAG 2.2 AA contrast and non-color meaning;
- enforce route UX budgets, one visible primary action, progressive disclosure, shared
  form/save/async primitives, 44px touch targets and zero sub-legible controls;
- test empty, loading, slow, error, queued, stale/offline, permission-denied and recovery
  states; failures preserve entered work and never imply completion;
- measure time/touches for search-to-record, check-in, common encounter, treatment task,
  checkout, refill request, result review/release, inventory receive and end-of-day close.

### Safety and domain review

- licensed companion-animal veterinarian reviews clinical workflow, record requirements,
  VCPR/consent, prescription/dispense/admin boundaries, procedure and euthanasia flows;
- credentialed technician reviews treatment/whiteboard, controlled handling, inventory,
  cold chain, specimen and practical mobile workflows;
- Illinois veterinary legal/compliance reviewer validates sources, applicability,
  effective dates, retention, authority, controlled inventory and record-release rules;
- waste/safety specialist or qualified vendors validate waste classifications, custody,
  manifests, sharps and hazardous-drug controls;
- red-team AI evaluation includes the forbidden actions and adversarial cases in section 9.

### Success measures

- time to book/check in/locate correct patient and complete a common encounter;
- no-show and late-cancellation fill rate; urgent reserve use; room/provider utilization;
- unsigned records, unreconciled results, missed client notifications and overdue tasks;
- estimate-to-charge variance, missed-charge rate, end-of-day reconciliation exceptions;
- stockout, expiry, recall containment time, cold-chain exceptions and controlled
  discrepancies;
- recall completion, portal task completion, refill turnaround and avoidable call volume;
- staff training time, clicks/touches, interrupted-work recovery and usability defects;
- wrong-patient/authority/privacy incidents, forbidden AI actions and audit completeness.

## 16. SysML v2 architecture note

This is an internal architecture viewpoint over DPF's existing EA, schema, routes,
contracts and verification evidence—not a parallel source of truth and not an end-user
SysML feature.

### Boundary and requirements

- **Inside:** veterinary activation, animal/guardian authority, care access/flow,
  encounter/clinical record, diagnostics, procedures, medications, physical stock,
  controlled ledger, client projection, finance links, workforce, compliance/evidence,
  integrations and AI guardrails.
- **Outside:** clinical judgment; external labs/PACS/pharmacies/distributors/processors/
  accounting/insurers/regulators/waste vendors; specialty and food-animal depth.
- **R1:** one animal identity resolves consistently across every workflow and export.
- **R2:** no care/record access or regulated action occurs without tenant, subject,
  purpose, role/credential and authority checks.
- **R3:** no unavailable required practitioner/resource can be double allocated.
- **R4:** signed clinical history and controlled/stock movements are corrected by
  amendment/reversal, never destructive overwrite.
- **R5:** received external data is not considered reconciled, reviewed, released or
  acknowledged without the respective transition.
- **R6:** every quantity/charge/payment-affecting integration is idempotent and
  reconcilable.
- **R7:** AI suggestions never cross a qualified-human gate by implication.

### Ports and allocations

Ports are storefront/portal, staff workspace, laboratory, imaging/PACS, pharmacy,
distributor, payment/accounting, insurer, APHIS/destination authority, identity/access,
document/export and observability/recovery. Organization owns tenant identity; Principal
owns identity; care owns patient/authority/appointment/encounter; workforce owns people
and credential scheduling; physical-stock and controlled-ledger contracts own quantities;
finance owns quotes/invoices/payments; documents/compliance own evidence and retention;
connectors own transport state, never the business record.

### Verification cases and parity

Verification cases are the golden journeys and negative cases in sections 12 and 15.
Implementation must update the EA data-model mirror, route/capability manifests, relevant
SysML-derived relationships and verification evidence in the same change. Parity checks
must detect a route or schema entity without its design relationship, a design authority
without implementation, and the superseded pet-ConfigurationItem doctrine after the
animal Principal migration ships.

## 17. Delivery, migration, and rollback

1. Approve this design with the named domain reviewers; capture decisions and unresolved
   jurisdiction issues.
2. Classify/score/fund the demand and update each child BI with this design, its slice,
   dependencies, scenario journey and review gates.
3. Write a separately reviewed implementation plan per coherent BI/slice. Do not combine
   the full epic into one migration or PR.
4. Begin with activation/identity and a compatibility projection for existing pet CI
   data. Migrate with deterministic crosswalk, counts, rejects, rollback/forward-correction
   procedure and no data deletion.
5. Deliver vertical slices through the canonical runtime with feature/profile gating,
   observability and export. Run all four DPF build gates for implementation work.
6. Remove compatibility reads only after usage telemetry, reconciled migration evidence,
   export parity and an explicit follow-up decision.

Presentation and connectors can roll back behind archetype/profile flags. Forward-only
schema migrations are corrected forward. No rollback may discard signed clinical facts,
controlled movements, stock movements, consents, payments or audit/evidence.

## 18. Refactoring allocation

Reserve approximately 20% of each implementation slice for substrate convergence and
debt removal directly exposed by that slice. Expected targets include:

- replacing veterinary pet CI authority with animal Principal/PatientProfile projection;
- extracting shared clinical lifecycle, unit/quantity, idempotency, release-projection,
  and audit helpers instead of route-local copies;
- composing existing navigation, form, async, report, document, finance, compliance and
  capacity primitives;
- tightening enum types, authority links, indexes and manifests as domain contracts land;
- deleting superseded adapters/duplicate displays only after parity and migration proof.

The allocation is not permission for unrelated cleanup or a fleet-wide rewrite. Each
refactor is named in its BI/plan, covered by tests, and preserves one source of truth.

## 19. Review record and unresolved gates

### DPF architecture review — fits with guardrails

- Reuses platform contracts and existing navigation rather than creating parallel
  identity, appointment, customer, finance, compliance, resource or portal systems.
- Canonical animal identity was decided through the platform kernel; the contradictory
  CI doctrine is explicitly superseded and requires an implementation migration.
- Deployment contracts, identity, authority, evidence, integration and rollback
  boundaries are explicit.
- Guardrail: target contracts do not authorize schema names or migrations; each BI must
  re-audit then-current substrate and update EA/design parity.

### Data architecture review — fits with guardrails

- `Organization`, Principal convergence and existing care/finance/document/workforce
  ownership are preserved.
- `StockItem` and digital inventory are explicitly rejected as ledger authorities;
  signed clinical, diagnostic and medication authorities are not fabricated as current.
- Guardrail: veterinary side profile must remain thin; mutable clinical facts belong in
  versioned/observed records; migration must handle every existing data state.

### UX-fit review — fits with guardrails

- Owning areas, personas, routes, first viewport, progressive disclosure, shared
  primitives, empty/failure/offline behavior, accessibility, mobile cases and AI
  confirmation boundaries are specified.
- The Workspace cockpit remains the single attention source and links to authoritative
  domain records. No additional dashboard or top-level Veterinary nav is proposed.
- A UX manifest and measured live-path review become mandatory when UI files change;
  none is required for this spec-only change.

### Pending external reviews — blocking for regulated implementation

- licensed veterinarian and credentialed-technician workflow review;
- Illinois legal/compliance validation, including effective versions and applicability;
- controlled-substance and pharmaceutical/pathological/hazardous-waste procedure review;
- security/threat model for clinical/controlled/integration boundaries before those
  implementation slices; and
- accessibility/usability sessions with representative clinic roles before MVP release.

## 20. Definition of design-ready and done

The design is **reviewable** when the document is linked to `BI-685634EB`, its source and
path checks pass, the architecture/data/UX review record is present, and the branch is
published through the DPF PR process.

An implementation BI is **design-ready** only when:

- the design is approved and its relevant external review gates are satisfied;
- live demand activation and funding gates allow promotion;
- the BI body links this spec, dependencies, a slice, a golden journey and exact
  acceptance/verification evidence;
- current schema/routes/primitives and overlap have been rechecked; and
- a phased implementation plan has been reviewed before code.

The epic is **done** only when the agreed MVP journeys work in the canonical runtime for
their real personas, the build/migration/UX gates pass, external review evidence is
recorded, docs and manifests are current, data export/restore and failure recovery are
proven, backlog statuses reflect reality, and no regulated action is represented as
complete without its qualified human and evidence.
