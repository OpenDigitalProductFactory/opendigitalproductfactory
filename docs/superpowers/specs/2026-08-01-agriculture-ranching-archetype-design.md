# Agriculture and Ranching Archetype Design

**Status:** Proposed
**Date:** 2026-08-01
**Epic:** `EP-7015CB99`
**Umbrella backlog item:** `BI-1A2F61F9`
**Decision:** `DI-2DC225DEF0FF`
**Coworker architecture decision:** `DI-AE18927B5DCB`
**Plan:** `docs/superpowers/plans/2026-08-01-agriculture-ranching-archetype.md`

## Purpose

DPF should add `agriculture-ranching` as a first-class archetype category for people who operate farms and ranches, beginning with three leaves:

- `mixed-farm-ranch` — the primary whole-operation leaf;
- `crop-hay-farm` — fields, crop and forage plans, harvest, inputs, equipment, and contracted field work;
- `cattle-ranch` — herds, individual animals where needed, breeding, health, movement, forage, and market readiness.

The category is not a cosmetic template. It must help an owner decide what needs attention now, next, and this season across land, crops and hay, cattle, working horses, equipment and implements, materials, suppliers and dealers, outside services, weather, markets, licenses, exemptions, and regulatory obligations.

The first release is an owner decision cockpit and operating record, not an autonomous agronomist, veterinarian, lawyer, commodity trader, tractor controller, or complete precision-agriculture FMIS.

## Why this is a new category

DPF has no production-agriculture category or leaf. The existing `agricultural-cooperative` leaf is intentionally a nonprofit/community pattern for shared machinery, member equity, patronage, reservations, and returns. It does not own crop production, animal husbandry, land stewardship, or a single operator's seasonal plan.

Three approaches were compared through WWMD:

| Option | Shape | Result |
| --- | --- | --- |
| New category | `agriculture-ranching` plus focused leaves | **Selected** |
| Existing-category leaves | Place farms under trades, property, or nonprofit | Rejected: false business semantics |
| Composition only | Assemble cooperative, rental, pet, retail, and trades leaves | Rejected: no canonical agricultural operating context |

Decision `DI-2DC225DEF0FF` selected the new category with high confidence (composite 10.1556, margin 4.2838, no commandment conflict). The category introduces a distinct biological, seasonal, geographic, equipment-intensive, and jurisdiction-sensitive operating loop while still reusing common DPF primitives.

## Design grounding

Operational-Precedent: farmos-map

### Existing platform substrate

Reuse these canonical owners:

| Concern | Canonical DPF owner | Agriculture use |
| --- | --- | --- |
| Due work and recurring plans | `WorkItem`, `CalendarEvent`, `ScheduledAgentTask` | field work, care, maintenance, appointments, renewal and monitoring cadence |
| Human availability | staffing demands, shifts, assignments, resource links | arrange an owner/hand to assist a veterinarian, farrier, dealer, or contractor |
| Vendors and purchasing | `Supplier`, `SupplierContract`, purchase orders | dealers, parts, feed, fertilizer, seed, veterinarians, farriers, custom operators |
| Financial asset record | `FixedAsset` | optional cross-reference for depreciation and book value |
| Compliance | `Regulation`, `Obligation`, `Control`, evidence and licensing substrate | jurisdiction-aware pesticide, animal movement, license, exemption, and evidence tracking |
| Field operations | `EP-FIELD-OPS-SUBSTRATE` | expected presence, eligibility, dispatch, daily logs, evidence packets |
| Operational visual | `OperationalSceneLayout`, `TERRITORY`, spatial operational views | geographic land units, herds/groups, equipment and exceptions |
| Scarce-resource view | typed runtime mirror and adapter registry | explain availability and conflicts without moving domain ownership |

Do not reuse these as agricultural domain truth:

- `AdoptableAnimal` belongs to the shelter/adoption bounded context. Cattle and working horses have different identity, lifecycle, breeding, movement, treatment, withdrawal, workload, and group semantics.
- `InventoryEntity` is an IT-estate model.
- `FixedAsset` is finance-owned and cannot express operational readiness, implements, meter readings, maintenance, compatibility, or location.
- `OperationalSceneLayout` owns placement and geometry, not the state of a field, crop, animal, or machine.

### Schema audit conclusion

The current schema has no canonical owner for land units, production plans, livestock, working animals, farm equipment, implements, agricultural materials, or dated agricultural activities. A typed agriculture bounded context is therefore justified. It should link to shared owners rather than duplicate them.

The implementation design must prefer explicit, strongly typed records over a universal `AgriculturalAsset` table with an unconstrained JSON facts blob. At minimum it needs clear owners for:

- land units and their geographic hierarchy;
- crop/forage production plans or stands and dated activities;
- animals and managed animal groups;
- agricultural equipment and implements;
- dated agricultural activity/event records with typed participants;
- observations, source provenance, and evidence.

Exact Prisma names and table decomposition remain an implementation decision after a focused schema impact review. Every closed axis becomes a Prisma enum plus generated TypeScript union. Migrations must be forward-only and safe against existing data.

Animals, land units, and equipment are business-domain entities, not authenticating actors. They must not create parallel identity or authorization tables; people, coworkers, devices, and service accounts continue through the canonical `Principal`/`PrincipalAlias` substrate.

## Research and benchmarking

### Open-source leaders

**farmOS** models land, plants, animals, equipment, structures, materials, and groups as assets whose histories are recorded by dated logs. Equipment logs cover maintenance, use, movement, fuel, and machine hours; animal groups support herd/flock-level management. DPF adopts its asset-history insight and explicit location/movement semantics, but rejects a single loose asset schema as DPF's canonical relational model.

**LiteFarm** centers crop management plans that generate actionable tasks and now supports individual or batch animal records, movement, vaccination, and feeding activities. DPF adopts the plan-to-work pattern and individual-versus-group animal distinction, while keeping DPF's common work, calendar, evidence, and coworker orchestration substrate.

**Tania** demonstrates the value of a simple farm journal, extensible standard operating procedures, and optional sensor/IoT input. DPF adopts progressive disclosure and a dated operational journal; it defers broad IoT ingestion until a provider and data-quality contract is proven.

### Interoperability standards

The ADAPT Standard 2.0 supplies portable concepts and JSON/GeoParquet/GeoTIFF exchange shapes for fields, crops, equipment, work records, and operations. ISO 11783 defines serial data communication between tractors, implements, and farm-management systems. DPF should use these as adapter boundaries and vocabulary checks, not copy them directly into the transactional schema. Initial delivery does not control machines.

### Official US-first evidence sources

Provider ports should begin with official sources while keeping jurisdiction and provider replaceable:

- NWS API for short-range weather observations, forecasts, alerts, and grid data;
- NOAA Climate Prediction Center for outlooks from weeks through seasons;
- USDA NASS Quick Stats for agricultural statistics;
- USDA AMS Market News for livestock, grain, hay, and other market observations;
- EPA pesticide labels and certification guidance;
- USDA APHIS animal-disease traceability and interstate movement rules.

Official data is still evidence, not a conclusion. Each signal must carry source, jurisdiction, observed/published/as-of time, horizon, confidence or limitation, and the human decision it informs. State and tribal requirements may be stricter than federal baselines.

Every adapter must wrap the canonical DPF deployment contracts. Provider-specific endpoints, credentials, rate limits, and transformations remain at the adapter edge; the archetype must not add fixed host ports, host paths, shell assumptions, or a provider-specific contract to the core domain.

## Operating model

The owner loop is:

1. Observe actual state and external signals.
2. Compare actual state with the operation's plan, cadence, thresholds, and obligations.
3. Explain what changed and why it matters over a stated time horizon.
4. Propose a bounded next action, draft, or scheduling change.
5. Require the right human approval for consequential actions.
6. Record completion, outcome, evidence, and updated state.

This loop supports four planning horizons:

| Horizon | Examples |
| --- | --- |
| Now | severe-weather alert, water problem, sick animal, machine unavailable, missed contractor arrival |
| Next 7–14 days | fertilizer window, hay cutting coordination, farrier visit, vaccination, service parts, breeding check |
| This season | planting/harvest sequence, forage availability, breeding/calving cycle, maintenance campaign, license renewal |
| Longer range | seasonal climate outlook, capital replacement, herd/crop strategy, conservation and regulatory changes |

## Domain boundaries

### Land, crops, hay, and work records

Land units form an organization-scoped geographic hierarchy: operation, property, field/pasture, and optional management zone. A crop or forage plan is time-bounded and attached to one or more land units. Dated activity records capture planned and actual work, participants, inputs, equipment, conditions, observations, evidence, and outcome.

This layer integrates with common work scheduling. It does not create another task/calendar engine.

### Livestock and working animals

Support an individual record when identity matters and a managed group when herd-level work is sufficient. Movements and group membership are dated, never overwritten history. Health, breeding, vaccination, treatment, withdrawal/hold, and care events require typed event kinds and evidence provenance.

Working horses are animals with health, care, training/availability, workload, and work-event context. They are not employees and not equipment. A farrier or veterinary appointment schedules the provider, the animal, and any required human helper through existing vendor and staffing/work primitives.

### Equipment, implements, materials, and services

Operational equipment owns readiness, location, meter readings, maintenance intervals, service events, downtime, and compatible implements/attachments. A finance link may connect it to `FixedAsset`. Materials support agricultural lot/stock and due-reorder signals without reusing IT inventory. Dealers, parts vendors, veterinarians, farriers, and custom operators reuse `Supplier` and contract/procurement primitives.

Outside service coordination covers requests, availability, quotes or terms, required prerequisites, scheduled presence, completion evidence, and invoice reconciliation. AI may draft contact; sending or committing remains approval-gated.

### Weather, market, and regulation

Provider adapters normalize evidence into typed signals. A weather signal differentiates observation, forecast, alert, and seasonal outlook. A market signal is an observation or published outlook, not a sell command. A regulatory signal names jurisdiction, regulated subject, applicability basis, authority, effective date, evidence requirement, and review state.

The platform must never infer that a pesticide use is permitted from product name alone. The current label, application site/crop, pest, rate, restrictions, applicator status, location, and stricter local rules all matter. Consequential recommendations require human review and source links.

## Archetype provisioning — all four dimensions

### 1. Template substrate

Add category `agriculture-ranching` and the three initial leaves. Provide category finance defaults, business value streams, applicability rules, launch primitives, scheduling/field-dispatch profiles, and `TwinProfile` rules.

Use the existing `TERRITORY` geographic twin with a typed `farm-operation` variant unless implementation evidence shows it cannot represent fields, pastures, herds/groups, equipment, and structures. Do not add another twin template merely for agricultural vocabulary.

### 2. WSID profession corpus

Create shared category professions for farm/ranch ownership, crop/forage operations, livestock husbandry, equipment maintenance, agricultural compliance, and vendor/custom-operator coordination. Leaf overlays add only genuinely different decision rules. Sources, review dates, confidence, jurisdiction, and safety boundaries are mandatory.

### 3. Coworker decision

Establish one primary `Farm & Ranch Steward` coworker because no current coworker owns the biological, seasonal, geographic whole-operation loop. It orchestrates planning, attention, records, and drafts, and collaborates with existing licensing/compliance, finance, procurement, and research capabilities. Do not create separate weather, cattle, equipment, pesticide, horse, and market coworkers in the first pass.

Decision `DI-AE18927B5DCB` selected the dedicated steward with high confidence (composite 8.084, margin 1.820, no commandment conflict) over three alternatives: reuse the COO with agriculture prompts, create one generic vertical-operations steward, or assemble only a specialist swarm.

The durable rule is **identity for accountability; overlays for difference**:

| Concern | Canonical owner |
| --- | --- |
| Whole-operation seasonal, biological, geographic attention loop | `farm-ranch-steward` identity, grants, service declaration, and starter skill |
| Category and leaf vocabulary, priorities, finance posture, workspace profile, and applicability | archetype category/leaf registries and their typed contribution surfaces |
| Profession reasoning that differs by archetype or jurisdiction | WSID pages with `professionArchetype` and jurisdiction metadata |
| Legal/compliance, finance, marketing, procurement, and other specialist authority | existing specialist coworkers and profession corpora, reached through explicit handoffs |

A new coworker is justified only when a business shape introduces a durable accountability, decision loop, and authority boundary that no existing coworker owns. Vocabulary alone, a different checklist, or a different market segment belongs in an archetype/leaf overlay. This prevents a coworker per leaf while also preventing a generic orchestrator from silently absorbing specialist authority.

The steward remains draft until its checked-in definition passes conformance, certification, and promotion. It may prepare evidence and proposals; it does not diagnose or treat animals, determine pesticide legality, submit licenses or exemptions, choose a market sale, spend money, contact an outside party, or control machinery.

#### Archetype-leakage invariant

For a declared install, profession retrieval may include universal pages plus pages matching that install's archetype and jurisdiction. It must never substitute another archetype's pages when no eligible page remains. An empty applicable result is an explicit `missed-empty-applicable-corpus` state, not permission to fail open to the unfiltered profession corpus. The archetype completeness gate separately requires every new category to seed its own primary corpus, so fail-closed retrieval cannot turn a missing overlay into silent cross-archetype advice.

### 4. Skills and tools

Starter skills should cover seasonal operating review, field/crop plan review, herd/working-animal care review, equipment readiness, outside-service coordination, and regulatory evidence review. Tools must read typed records and cited provider signals; all material writes use proposal/approval envelopes. New provider integrations require tool evaluation.

## Owner decision cockpit UX

The canonical home is map-led but not map-only. The first viewport should answer “What needs me?” before asking the owner to navigate a module tree.

Suggested composition:

- a geographic operation scene with fields/pastures, herds/groups, equipment, structures, and visible exception states;
- a compact `Now / Next / Season` attention rail;
- due care and breeding, crop/hay windows, maintenance readiness, low-stock and outside-service commitments;
- weather, market, and regulatory evidence cards with source and as-of labels;
- approval-gated actions such as “draft dealer call,” “propose service window,” or “prepare compliance checklist”;
- list/text parity for every map fact.

The scene remains an operational projection. Domain records own state. All styling uses `--dpf-*` tokens and shared UI/report/twin primitives. Verification covers responsive desktop/mobile layouts, keyboard and screen-reader use, light/dark themes, zoom and dense-map behavior, empty/degraded/stale states, and owner-language comprehension. A working animal must be recognizable as an animal under care, never displayed as staff headcount or a machine.

## Safety and autonomy ceiling

The following are always human-reviewed:

- pesticide selection, rate, mixing, application, or legal-use determination;
- veterinary diagnosis, prescription, treatment, withdrawal, breeding intervention, or euthanasia;
- a market-timing or sell decision;
- submission of a license, exemption, compliance attestation, movement document, purchase order, service commitment, or external message;
- a tractor/implement command or safety-critical maintenance release.

Coworkers may collect evidence, identify conflicts, explain uncertainty, draft plans/messages, and propose scheduling changes. They must surface stale, missing, conflicting, or jurisdiction-ambiguous evidence instead of silently filling gaps.

## Non-goals for the first category release

- complete farm accounting, payroll, crop insurance, herdbook/genetics, grazing optimization, or precision-ag suite;
- real-time telematics, autonomous equipment control, or direct ISOBUS task execution;
- nationwide legal applicability without confirmed jurisdiction;
- disease diagnosis, treatment recommendation, or automatic pesticide recommendation;
- speculative price prediction presented as fact;
- dairy, poultry, specialty-crop, feedlot, breeding-stable, or equine-facility leaves without separate evidence.

## Refactoring allocation

Approximately 20% of implementation capacity is reserved in `BI-4EDDA6B5` for common-substrate refactoring:

- turn the closed `apps/web/lib/twin/scene-entity-resolver*` kind/loader branching into typed registries;
- preserve characterization tests for current `care-resource`, `rentable-unit`, `customer-site`, `infra-ci`, and `table` behavior;
- extend the typed scarce-resource/operations read-model adapter seam rather than add agriculture-only projection utilities;
- keep `OperationalSceneLayout` and `TERRITORY` canonical.

This allocation is a delivery constraint, not permission to rewrite unrelated platform code.

## Acceptance criteria

- The new category and three initial leaves pass the archetype completeness gate across template, WSID, coworker, and skills/tools.
- A mixed-operation fixture can represent fields/pastures, a hay or crop plan, cattle, working horses, equipment/implements, materials, vendors, outside services, obligations, and cited external signals.
- Every domain datum has one named owner; shared DPF primitives are linked, not copied.
- The owner cockpit explains now/next/season attention from a map and equivalent list/text view.
- Working-horse care, farrier scheduling, and required human help are modeled without treating the horse as an employee.
- Weather, market, and regulatory claims always expose provider, source time, jurisdiction/horizon, and uncertainty or limitation.
- Consequential veterinary, pesticide, regulatory, market, purchasing, messaging, and machine actions remain human-approved.
- Shared-adapter refactoring has regression tests before agriculture adapters are added.
- UI verification proves responsive, accessible, theme-aware behavior and degraded-state honesty.
- Migrations apply cleanly against representative existing data and all affected build-gate checks pass.

## Phase-F implementation status

The first implementation slice delivers the four-dimension category foundation under `BI-78C5A164`: category and three leaves, cross-surface typed contributions, workspace/twin profile, finance and marketing posture, dedicated draft coworker/service/occupation records, starter skill, agricultural and specialist overlay corpus, and fail-closed corpus applicability. It intentionally does not claim the typed agricultural records or map-led cockpit owned by Phases A–E and G.

## Documentation impact

Implementation updates the archetype catalogue, category/leaf documentation, owner workflow guide, coworker declaration and skill index, data architecture/ERD, integration source catalogue, compliance/autonomy guidance, and UX route documentation. Until an operator route ships, this spec and its plan are the only user-visible documentation changes.

## Sources

- farmOS asset model and guide: https://farmos.org/model/type/asset/ and https://farmos.org/guide/assets/
- farmOS location/movement: https://farmos.org/guide/location/
- LiteFarm: https://www.litefarm.org/ and https://www.litefarm.org/tutorials
- Tania: https://usetania.org/
- ADAPT Standard 2.0: https://adaptstandard.org/
- ISO 11783-1: https://www.iso.org/standard/57556.html
- NWS API: https://www.weather.gov/documentation/services-web-api
- NOAA Climate Prediction Center outlooks: https://www.cpc.ncep.noaa.gov/products/outlooks/
- USDA NASS developer resources: https://www.nass.usda.gov/developer/
- USDA AMS Market News: https://www.ams.usda.gov/market-news
- EPA pesticide labels: https://www.epa.gov/pesticide-labels/introduction-pesticide-labels
- EPA applicator certification: https://www.epa.gov/pesticide-worker-safety/how-get-certified-pesticide-applicator
- USDA APHIS animal-disease traceability: https://www.aphis.usda.gov/news/agency-announcements/aphis-bolsters-animal-disease-traceability-united-states
