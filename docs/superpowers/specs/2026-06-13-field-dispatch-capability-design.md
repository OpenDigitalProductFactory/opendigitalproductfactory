# Field Dispatch — Cross-Archetype Capability Design

| Field | Value |
| ----- | ----- |
| Status | Reviewed draft — architecture and UX guardrails folded in |
| Date | 2026-06-13 |
| Reviewed | 2026-06-14 |
| Author | Agent (with Mark Bodman direction) |
| Scope | Generalize "dispatcher" from an HVAC-specific coworker into a horizontal **Field Dispatch** capability that any archetype with mobile field resources composes — derived from operating-model axes, parameterized by a per-vertical profile, realized through existing substrate. |
| Supersedes framing of | [Field Service Trades — AI Dispatch design](2026-05-19-field-service-trades-ai-dispatch-design.md) (HVAC becomes the *first consumer* of this capability, not a bespoke build) |
| Grounded by | [FSM dispatch competitive analysis](../research/2026-06-13-fsm-dispatch-competitive-analysis.md), [Multi-Archetype Composition design](2026-06-13-multi-archetype-composition-design.md), [Dale HVAC persona](../../personas/dale-hvac.md) |
| Substrate | `packages/storefront-templates/src/types.ts` (`OperatingModelAxes`, `ArchetypeModule`, `PrimaryAction`, `CapabilityActivation`, `SchedulingDefaults`), `packages/db/src/business-capability-perspectives.ts` (`trades-dispatch-technician-readiness`), `apps/web/lib/workspace-home/*`, `packages/db/prisma/schema.prisma` (`WorkItem`) |
| Working mode | Backlog is not in this build (backed up). Decompose into features and build directly in the worktree; `BI-FS-*`/`EP-TRADES-FIELD-SERVICE` codes below are historical references from the backed-up backlog, not queryable here. |

---

## Review outcome folded into this revision

**Architecture review (advisory):** aligned with guardrails. The horizontal capability shape is correct: dispatch is derived from archetype axes, parameterized by a profile, and realized through `WorkItem`, `CalendarEvent`, workspace-home contributions, communications, and report-kit. The spec must not imply the database already enforces a field-service lifecycle; `WorkItem.status` is a generic string today, so dispatch needs a typed application vocabulary and validation helpers.

**UX fit review:** fits-with-guardrails. The owning operator surface is `/workspace`; the dispatch board is a workspace-home contribution, not a new global nav item and not a standalone `/dispatch` dashboard. The first viewport must answer: what is unassigned, what is late, who is en route/on site, what needs customer contact, and what resource/parts/compliance constraint blocks dispatch.

**Substrate verification verdict:** extend existing substrate. Do not create `FieldTechnician`, `DispatchJob`, `DispatchBoard`, or `CustomerLocation` tables for the core slice. Use existing identity/person models (`Principal` / `PrincipalAlias`, `User`, `EmployeeProfile`, `ServiceProvider` where appropriate), existing customer/account/contact models, `CalendarEvent`, `WorkItem`, `CommunicationChannelBinding`, `CommunicationDeliveryAttempt`, `MediaAsset`, and the inventory/workbook substrate where the current install already carries the data.

**Major corrections added by review:**

- Add a formal research-and-benchmarking section inside this spec, not only in the companion research note.
- Treat job lifecycle values as a typed application contract, not a Prisma enum and not an implicit DB guarantee.
- Add field-dispatch status semantics through report-kit `STATUS_INTENT`; no local color maps.
- Keep geocoding/routing behind a provider interface with caching, rate-limit, and "no provider configured" behavior; no hidden dependency on bulk public geocoding.
- Exclude regulated clinical/PHI-heavy verticals from the smallest slice unless a privacy/retention evidence design is added.
- Make AI notification and assignment actions previewable, auditable, and policy-bound before autonomous execution.

## 1. Purpose

Mark's prompt: *"There are elements of this in other business models too, such as windshield replacement, maid / cleaning services and plenty of others."*

He is right, and it changes the architecture. The dispatcher is **not an HVAC feature** — it is a **horizontal capability** that recurs in every business where a **mobile resource travels to a customer location to perform work**: HVAC techs, auto-glass installers, house cleaners, mobile groomers, home-health nurses, appliance-repair techs, pest-control applicators, field inspectors, delivery/install crews. The HVAC spec ([2026-05-19](2026-05-19-field-service-trades-ai-dispatch-design.md)) modelled this once, vertically. This spec lifts it to a reusable capability so the platform builds it **once** and every field-service archetype inherits it.

This is the platform's **reusability-by-design** principle applied at the archetype layer, and it mirrors how the codebase already derives `BillingPatternProfile` and `PartnerProgramProfile` from operating-model axes rather than hand-authoring them per archetype.

This spec answers:

1. What is the archetype-agnostic core of "dispatch," and what varies per vertical?
2. How does it attach to an archetype without per-archetype duplication?
3. What existing substrate already models pieces of it (so we extend, not reinvent)?
4. How does it decompose into features we can build next, in dependency order?

The companion [archetype gap analysis](../research/2026-06-13-field-dispatch-archetype-gap-analysis.md) identifies which archetypes that would consume this capability **do not exist yet** — handed off to a separate thread.

---

## 2. The generalization thesis

Every field-dispatch business runs the **same operational loop**:

```
Intake → Triage → Schedule → Assign → Confirm → En-route → On-site → Close → Invoice → Settle
  │         │         │         │         │         │         │         │         │        │
 call/    urgency   time      resource  T-24h    on-my-way on/      voice    job→     payment
 web      + type    window    to job    reminder + ETA     arrival  capture  invoice  link
```

What is **invariant** across verticals (the capability core):
- A **job** is the unit of work (one `WorkItem`, `sourceType = "field-service-job"`).
- A **mobile resource** is assigned to it (skill + proximity + availability + value).
- The **customer is kept informed** (confirm / on-my-way / running-late / complete), routed by preference.
- A **dispatcher** coordinates it — as an **autonomous AI coworker** and as a **human dispatch board**, over one substrate.

What **varies** per vertical (the vertical profile — §7.2):
- The **resource noun** and unit (solo technician, 2-person crew, installer, driver, nurse, groomer, inspector).
- The **serviced entity** (HVAC unit, vehicle VIN, property/rooms, animal, person, parcel).
- The **compliance overlay** (EPA 608 refrigerant, ADAS auto-glass calibration, pesticide-applicator license, HIPAA/clinical, bonding/insurance, DOT hours).
- The **inventory model** (truck stock, glass-SKU-by-VIN, cleaning supplies, none).
- The **vocabulary** ("jobs/trucks/techs" vs "installs/vans/installers" vs "visits/cars/cleaners").

**Design consequence:** build the loop once; express each vertical as data (a `FieldDispatchProfile`), not code.

---

## 3. Research & Benchmarking

This section satisfies the DPF design-research requirement and summarizes the companion competitive analysis into the spec's load-bearing design choices.

### 3.1 Open-source and standards references

| Reference | Pattern adopted | Pattern rejected |
| --------- | --------------- | ---------------- |
| [OCA Field Service](https://github.com/oca/field-service) | Field service should model locations, workers, and orders distinctly enough for dispatch, territory, portal, stock, sale, and accounting add-ons to compose. | Do not import an Odoo-shaped module tree or create a new DPF ERP app beside existing workspace/storefront/customer surfaces. |
| [Odoo Field Service](https://www.odoo.com/app/field-service) and [Odoo task creation docs](https://www.odoo.com/documentation/19.0/applications/services/field_service/creating_tasks.html) | Dispatch needs multiple operator views: calendar/schedule, map, work cards, time tracking, and invoices from completed work. | Do not mirror Odoo's app split or visible vendor language. DPF keeps this as a workspace contribution plus existing finance/customer drill routes. |
| [Beveren FSM for ERPNext](https://github.com/Beveren-Software-Inc/Field_Service_Management) | End-to-end field service needs requests, scheduled jobs, technician assignment, spare parts, on-site tracking, and invoicing in one operational flow. | Do not adopt an ERPNext-specific job model; DPF uses `WorkItem` + `CalendarEvent` + finance actions. |
| [Google OR-Tools VRPTW](https://developers.google.com/optimization/routing/vrptw) | Route optimization is a vehicle-routing-with-time-windows problem: vehicles/resources, locations, service windows, and travel time constraints. | Do not promise continuous route optimization in the smallest slice; F5/F6 only add the provider boundary and later optimization hook. |
| [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) and [OSRM](https://project-osrm.org/) | Geocoding/routing must be provider-swappable, cacheable, and respectful of public service limits; routing can be self-hosted later. | Do not bulk geocode customer addresses against a public endpoint, and do not make dispatch fail when no mapping provider is configured. |

### 3.2 Commercial benchmarks

| Benchmark | Pattern adopted | Pattern rejected |
| --------- | --------------- | ---------------- |
| [Microsoft Dynamics 365 Field Service schedule board](https://learn.microsoft.com/en-us/dynamics365/field-service/work-with-schedule-board) | Dispatcher view centers on resource availability, bookings, reassignment, and requirements. | Do not expose enterprise scheduling jargon to small-business operators; use "jobs", "crew", "tech", "route", and profile vocabulary. |
| [ServiceTitan Dispatch Pro](https://www.servicetitan.com/features/pro/dispatch) | Assignment should become skill/proximity/value-aware, not just next available. | Do not overfit to HVAC revenue optimization in the generic capability; value is one scoring signal, not the whole model. |
| [Housecall Pro](https://www.housecallpro.com/compare/housecall-pro-jobber/) / [Jobber](https://www.getjobber.com/comparison/jobber-vs-housecall-pro/) | SMB field service users expect dispatch board, customer reminders, GPS/on-my-way, and simple scheduling without configuration tax. | Do not build a separate dispatcher product that has to integrate back into DPF. |
| [Salesforce Field Service / Agentforce](https://www.salesforce.com/blog/field-service-scheduling-optimization-in-the-agentforce-era/) and [Dynamics 365 2026 Wave 1](https://learn.microsoft.com/en-us/dynamics365/release-plan/2026wave1/service/dynamics365-field-service/) | Agentic scheduling and schedule-gap resolution are becoming mainstream; DPF should preserve an autonomous optimization path. | Do not make autonomous dispatch the MVP default. Start with explicit previews and policy-bound automation. |
| [FieldCamp AI Dispatcher launch](https://roboticsandautomationnews.com/2026/03/19/fieldcamp-introduces-ai-dispatcher-for-field-service-skills-matching-route-optimization-and-emergency-reshuffling-built-for-the-trades/99895/) | The market is splitting "AI that books/assigns" from "board that manages"; DPF's differentiator is one coworker plus one board over one work substrate. | Do not model the AI dispatcher and human dispatch board as two separate systems or duplicate queues. |

### 3.3 Design implications

- A useful dispatcher is **visual first**: map, schedule, resource lanes, unassigned queue, communication failures, and blocking constraints. Text explains; it does not carry the whole experience.
- The commercial baseline is already strong on dispatch efficiency. DPF must reach parity, then differentiate through compliance-as-job-byproduct, voice-first field capture, and one board/coworker over one `WorkItem` stream.
- Open-source models confirm that field service is an operating flow across CRM, scheduling, inventory, work execution, and invoicing. DPF should compose existing surfaces rather than create a parallel FSM product.
- Routing/geocoding standards make provider abstraction mandatory. The smallest slice can render a schematic map/route list from known locations; external routing is a later configured capability, not a hidden requirement.

---

## 4. Substrate audit

Per [`verify-substrate-before-proposing-new`](../../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md), every proposed element is checked against live substrate first.

| Proposed element | Existing substrate (verified) | Recommendation |
| ---------------- | ----------------------------- | -------------- |
| The field-service "job" record + lifecycle | `WorkItem` (`schema.prisma`) — polymorphic `sourceType`, generic string `status` defaulting to `queued`, `assignedToUserId/AgentId`, `calendarEventId`, `evidence` Json, `parentItemId`, message thread, `routingDecision`, `completedAt` | **Reuse with an application contract.** Use `sourceType = "field-service-job"` and add a typed dispatch status/evidence helper in app code. Do not claim Prisma enforces the field-service lifecycle. No new model in the core slice. |
| "Dispatch" as a UI action | `PrimaryAction` documents capability-contributed map-pin actions such as `{ id: "dispatch-tech", label: "Dispatch", surface: "map-pin" }` (`types.ts`) | **Reuse/instantiate.** Dispatch is already a fit for capability-contributed primary actions on map pins and rows — wire it, don't invent an action substrate. |
| Field-work visual surface | Composition `StorefrontServiceLineView.visualPattern` reserves `"map-dispatch"` "for field work" (`2026-06-13-multi-archetype-composition-design.md` §4.2) | **Reuse.** The composition layer already names the visual pattern; this spec defines how the workspace contribution renders it. |
| Dispatch as a business capability | `business-capability-perspectives.ts` already seeds `trades-dispatch-technician-readiness` ("Assign technicians or crews, schedule visits, check skills/tools/parts readiness, keep dispatcher queues current") | **Generalize.** Lift this L2 capability out of the trades-only perspective into a reusable field-dispatch capability. |
| Dispatch board (operator first-viewport) | `apps/web/lib/workspace-home/*` substrate (registry, activation-orchestrator, types) exists; **no `contributions/` dir** — the board itself is unbuilt | **Build on it.** One generic field-dispatch workspace-home contribution parameterized by profile (not one per vertical). |
| Dispatcher AI coworker | Designed in [HVAC spec §8.2]; **not seeded** (`seed.ts` has zero dispatcher refs) | **Build.** Generic dispatcher coworker; vertical profile supplies vocabulary/compliance prompts. |
| "Which archetypes need dispatch?" flag | `OperatingModelAxes` (`form`, `delivery`, `provisioning`, `commercialModel`) already drives derived profiles (`BillingPatternProfile`, `PartnerProgramProfile`) | **Derive, don't flag.** Compute field-dispatch applicability from axes — no per-archetype boolean. |
| Module to gate it | `ArchetypeModule` union = `customer-estate | service-agreements | billing-readiness | service-operations | projects | lifecycle-signals | integrations | rental-fleet | rental-agreements` — **no dispatch module** | **Add one derived value:** `"field-dispatch"`, composing with `service-operations`. |
| Assignment config | `SchedulingDefaults.assignmentMode = "next-available" | "customer-choice"`; `WorkItem.workerConstraint`; `WorkSchedule`; `ServiceProvider` and employee identity models | **Extend** with skill/proximity/value-aware assignment as application scoring. Do not create `FieldTechnician` or `DispatchResource` for the core slice. Crew/resource grouping is deferred to F4. |
| Notification rail | `CommunicationChannelBinding`, `CommunicationChannelSession`, `CommunicationDeliveryAttempt`, `Notification`, customer/contact fields, communication dispatch policy helpers | **Reuse** for confirm/on-my-way/running-late + failed-delivery exceptions. Customer-facing sends require channel binding or a verified contact path; failures surface on the board. |
| Evidence/photos/certificates | `WorkItem.evidence` Json, `MediaAsset`, compliance models, and existing attachment patterns | **Start with schema-validated evidence metadata.** Large photos/certificates belong in `MediaAsset`; regulated artifacts get a F9 storage decision before PHI or compliance-heavy content is captured. |

**Net:** the capability is mostly *wiring existing hooks together* + one derived module + one profile type + the (still-unbuilt) coworker and board. No new top-level Prisma model is required for the core loop.

---

## 5. Architecture decisions

### ADR-1 — Field dispatch is a **derived capability**, computed from operating-model axes
Applicability is a pure function of `OperatingModelAxes`, not a hand-set per-archetype flag:

```
needsFieldDispatch(axes) :=
  axes.form === "services"
  && (axes.delivery === "physical" || axes.delivery === "hybrid")
  && serviceIsPerformedAtCustomerLocationOrOnCustomerAsset(axes)
```

The third clause is read from `provisioning` / `consumptionChannel` (`onsite-plus-portal`, `episode-of-care`, `reservation-and-return` with delivery, etc.). This mirrors `deriveBillingPatternProfile(commercialModel)` and `derivePartnerProgramProfile(axes)` — same "axes in, profile out" shape. **Rationale:** [`principle-based-rules`](../../founder-kernel/wiki/principles/principle-based-rules.md) — one durable rule beats an enumerated per-archetype list, and new archetypes inherit dispatch automatically when their axes qualify.

### ADR-2 — Gate with a new **derived** `field-dispatch` `ArchetypeModule`, composing with `service-operations`
`service-operations` stays the office/back-office service-work module; `field-dispatch` is the additive mobile-resource-to-site coordination layer. The module is set by the derivation in ADR-1, not authored into each archetype literal. It unions cleanly through `mergeActivationProfiles` (composition spec §8), so a composed storefront (e.g. trades primary + supplies-reorder secondary) gets dispatch from whichever line qualifies.

### ADR-3 — One dispatcher **role**, two surfaces, one substrate (carried from HVAC ADR-1)
The Dispatcher AI coworker (autonomous coordination) and the dispatch board (human operator) are the **same role** reading/writing one `WorkItem` stream. The 2026 market sells these as two products that must be integrated (competitive analysis §2); DPF keeps them unified. **This is the defensible differentiator and is non-negotiable in the design.**

### ADR-4 — Each vertical is a `FieldDispatchProfile` (data), not bespoke code
The per-archetype variation (resource noun, serviced entity, compliance overlay, inventory model, vocabulary, assignment signals, notification copy) is a typed profile derived from / attached to the archetype. Adding "windshield replacement" or "maid service" is then **authoring a profile**, not writing a dispatcher. (§7.2, §10.)

### ADR-5 — Compliance overlays are a **pluggable framework**, EPA 608 is the first instance
The HVAC spec's EPA 608 work (refrigerant logs, cert expiry, leak-rate) is one instance of a general pattern: *a regulated artifact captured as a by-product of the job close, stored on `WorkItem.evidence` + a `ComplianceArtifact` on the resource's profile, immutable, retention-bound.* Siblings: **ADAS calibration certificates** (auto-glass), **pesticide-applicator licensing + per-application logs** (pest control), **HIPAA/clinical notes** (home health), **bonding/insurance** (cleaning), **DOT hours-of-service** (long-haul). Build the overlay framework; ship EPA 608 + ADAS as the first two. **Moat:** no FSM in the market covers any of these (competitive analysis §5.2).

### ADR-6 — Realize through existing UI substrate, not new bespoke surfaces
Wire the typed-but-unwired hooks: `PrimaryAction { id: "dispatch-tech", surface: "map-pin" }`, composition `visualPattern: "map-dispatch"`, the `trades-dispatch-technician-readiness` capability (generalized), and the workspace-home contribution registry. The dispatch board is a workspace-home **contribution**, consistent with the [HVAC dispatcher workspace home plan](../plans/2026-06-04-hvac-dispatcher-workspace-home.md), generalized to read its labels from the `FieldDispatchProfile`.

### ADR-7 — Dispatch status is an application vocabulary, not a new DB enum
`WorkItem.status` remains the persistence column, but field dispatch owns a typed union and parser in app code:

```ts
export const FIELD_DISPATCH_JOB_STATUSES = [
  "quoted",
  "scheduled",
  "confirmed",
  "en-route",
  "on-site",
  "complete",
  "invoiced",
  "paid",
  "cancelled",
  "needs-review",
] as const;
```

The helper validates writes, maps legacy/unknown values to `needs-review` for the board, and records `completedAt` when a job reaches `complete`. The spec intentionally does **not** add a Prisma enum because `WorkItem` is a shared work substrate across multiple domains.

### ADR-8 — Status colors and dispatch board data display compose report-kit
Add `fieldDispatchJob` and, if not already present, `operationalStatus` domains to `apps/web/components/ui/report-kit/statusColors.ts`. The board uses `StatusBadge`, `StatCard`, `DataTable`/thin client wrappers, and shared token-backed intent semantics. No local color map, raw Tailwind status palette, or handwritten table should appear in the dispatch surface. Every status marker pairs color with visible text or an accessible label.

### ADR-9 — Mapping/routing is provider-swappable and non-blocking
The core board can render a schematic map/list from known addresses and calendar windows. External geocoding, route duration, live traffic, and optimization are provider-backed capabilities behind interfaces such as `geocodeAddress`, `routeBetweenStops`, and `estimateArrival`. If no provider is configured, the board still works with "route unavailable" / "location not geocoded" states. Public geocoding services must be cached and proxyable per the Nominatim policy; no bulk geocoding or periodic reverse-geocoding jobs run against a public endpoint.

### ADR-10 — Regulated evidence is captured by reference until its storage decision lands
The smallest slice may store non-sensitive dispatch evidence metadata on `WorkItem.evidence`, but photos, certificates, signed forms, and regulated artifacts are linked via `MediaAsset` or a later F9 compliance artifact decision. Home health, mobile phlebotomy, HIPAA-heavy clinical notes, and similar PHI workflows are consumers of the future framework, not part of the first buildable slice.

---

## 6. Where we must reach parity vs. where we win (from the competitive analysis)

| Build to **parity** (table stakes — look broken without it) | Build as **moat** (no competitor has it) |
| --- | --- |
| Visual dispatch board (D3) | Compliance-as-job-byproduct: EPA 608, ADAS calibration, applicator logs (ADR-5) |
| Skill+proximity **value-aware** auto-assign (D4) — ServiceTitan/Housecall already weight ticket size | Unified board+AI on one `WorkItem` substrate (ADR-3) |
| Route/ETA + on-my-way (D5/D9) | Voice-first field capture as primary input |
| Appointment confirmation (D8) | Hive-mind shared dispatch defaults across installs |
| Real-time reschedule / running-late cascade (D6) | Conduit model for financing/rebates (no partner lock-in) |

Design rule from the analysis: the **efficiency axis is commoditizing** (FieldCamp, Agentforce, D365 all claim 20–40% gains); reach parity there, but invest the differentiation budget in the compliance/voice/hive/unified axes nobody else occupies.

---

## 6.5 The differentiated spine: QuickBooks + parts inventory + AI monitoring

> Operator directive (2026-06-13): *"the combination of QuickBooks financial management, inventory management of parts for the field service industry … with AI agents in the mix that keep tabs on all aspects of the jobs and tasks … is the critical need we can bring together uniquely."*

This is the wedge. Incumbents do dispatch; none unify **field dispatch + accounting truth + field-parts inventory + always-on AI oversight** over one work record. The 2026-06-13 substrate audit confirms DPF already has most of the rails — this is *integration*, not greenfield, which is why DPF can ship the combination faster than a point vendor can bolt them together.

### Verified substrate (audit 2026-06-13)

| Spine pillar | What already exists (reuse) | What to build |
| ------------ | --------------------------- | ------------- |
| **Native financial management (QuickBooks-equivalent)** | DPF-native AR rails exist on `Invoice` (job `sourceType`/`sourceId` → `WorkItem.itemId`, line items, totals, status); AP (`Bill`/`PurchaseOrder`/`Supplier`) + payments substrate exist; a QuickBooks read client + `erpSyncStatus`/`erpRefId` fields exist as a **migration bridge** (import-from-QB / optional sync), NOT the system of record. | **Build native financials — do NOT interface to QB (strategic direction 2026-06-14, deferred):** job-complete→DPF-native invoice (warranty-classified, F14); then close the gap to QB-equivalence so a switcher loses nothing. The cohesion of one system (dispatch+financials+inventory+AI) is the reason to replace QuickBooks. Grounded gap + sequencing: [Native Financial Management strategy](2026-06-14-native-financial-management-strategy.html). Reverses HVAC ADR-5. |
| **Field-parts inventory** | Workbooks substrate (`WorkbookTable/Row/Column/Cell` + `WorkbookCellLink`, landed #1849) is a general user-defined-table store that holds per-vehicle parts stock. `WorkItem.evidence` (F1 `parts-used`) records parts consumed on a job. `Supplier`/`PurchaseOrder`/`PurchaseOrderLineItem` exist for reorder. | The parts-stock workbook template, the job→stock deduction on parts-used, and the low-stock→draft-PO reorder signal. No new schema. |
| **AI monitoring of every job/task** | Autonomous coworker runtime, `WorkItem` + `WorkItemMessage` thread, `routingDecision`, scheduled probes, PAR handoffs, Governor `require-hitl`. | The Dispatcher coworker's standing watches: schedule adherence, unconfirmed jobs, failed notifications, parts-blocked jobs, cert/compliance expiry, and **finance exceptions** (job complete but not invoiced; invoice synced-failed). |

### Why this is the moat (not the dispatch board)

The dispatch board and auto-assign are parity (every vendor has them, and they commoditize). The defensible position is the **closed loop**: a job is dispatched → parts are drawn from the truck → the work closes by voice → a warranty-classified invoice posts to DPF's **own native accounting** → payment is collected → the parts hit reorder → and an **AI coworker is watching every seam** for the thing that fell through (the unconfirmed visit, the un-invoiced completion, the truck that will run out Thursday). No incumbent closes that loop; most don't even own the accounting or the van inventory. **The strategic target (deferred) is to replace QuickBooks with native, cohesive financials** — the AI seeing the whole chain (job → part → warranty → invoice → payment) in one system is the reason to switch, not "better accounting." F9 (compliance) and voice-first sit on top of this spine.

---

## 7. The Field Dispatch capability model

### 7.1 Core (archetype-agnostic)

- **Job substrate:** `WorkItem` with `sourceType = "field-service-job"`; field-dispatch application status validated by `FIELD_DISPATCH_JOB_STATUSES`; `calendarEventId` for scheduled windows; `workerConstraint` for resource needs; `routingDecision` for assignment rationale; `evidence` for schema-validated non-sensitive metadata and references; `parentItemId` for "main visit + parts order + follow-up."
- **Dispatcher coworker:** scheduled automations (T-24h confirm, T-1h pre-job brief, daily overview) + event automations (running-late cascade, on-my-way fire, job-complete -> invoice draft). Tools are capability-scoped operations such as `get_jobs_for_day`, `propose_customer_notification`, `assign_resource`, `calculate_eta`, `update_job_status`, and `prepare_invoice_from_job`. Customer-facing sends start as preview + confirmation unless an explicit automation policy has been configured and audited.
- **Dispatch board:** workspace-home contribution — resource schedule/load, jobs-needing-attention queue, coworker handoffs (PAR + Governor HITL), map/list of service locations, inventory watch, compliance blockers, and failed-customer-update exceptions.
- **Assignment:** `assign(job, resources)` scoring skill match x proximity x availability x value/urgency, returning a recommendation with rationale and confidence. Surfaced as the `dispatch-tech` `PrimaryAction` on the map pin or work row. The recommendation does not mutate assignment until accepted or until a governed automation policy allows auto-assign.
- **Notification routing:** per-customer verified contact path and communication-channel binding where available (SMS/call/email/push/in-app), with escalation; dedupe via `CommunicationDeliveryAttempt`; failures surface as board exceptions.
- **Status semantics:** board statuses resolve through report-kit domains (`fieldDispatchJob`, `operationalStatus`) and render with text + icon + accessible name. Unknown/missing data is neutral, not green.

### 7.2 The `FieldDispatchProfile` (per-vertical parameterization)

```typescript
// packages/storefront-templates/src/field-dispatch.ts (new)
export interface FieldDispatchProfile {
  resource: {
    noun: string;            // "technician" | "installer" | "cleaner" | "groomer" | "nurse" | "driver" | "inspector"
    nounPlural: string;
    unit: "solo" | "crew" | "vehicle-bound";
    fleetNoun?: string;      // "truck" | "van" | "vehicle" | "rig"
  };
  servicedEntity:
    | "equipment-unit"       // HVAC unit, appliance
    | "vehicle"              // auto glass (VIN-keyed)
    | "property-site"        // cleaning, landscaping, pest, inspection
    | "animal"               // mobile grooming / mobile vet
    | "person"               // home health
    | "parcel";              // delivery / install
  siteModel: "customer-premises" | "mobile-to-customer" | "route-based";
  assignmentSignals: ("skill" | "proximity" | "availability" | "parts" | "value" | "urgency")[];
  notificationEvents: ("confirm" | "on-my-way" | "running-late" | "complete")[];
  complianceOverlays: ComplianceOverlayKey[];   // ["epa-608"] | ["adas-calibration"] | ["pesticide-applicator"] | ["hipaa-clinical"] | []
  inventoryModel: "truck-stock" | "sku-by-vehicle" | "supplies" | "none";
  routeMode: "schematic" | "geocoded" | "optimized";
  privacyClass: "standard" | "location-sensitive" | "regulated-health" | "regulated-public-safety";
  vocabulary: { job: string; jobPlural: string; visit: string; /* … */ };
}

export function deriveFieldDispatchProfile(
  axes: OperatingModelAxes,
  archetypeId: string,
): FieldDispatchProfile | null;   // null when needsFieldDispatch(axes) === false
```

The profile is **derived with per-archetype overrides** (same pattern as `MediaProfile`: derive sensibly, allow an explicit exception). HVAC → `{resource: technician/truck, servicedEntity: equipment-unit, compliance: [epa-608], inventory: truck-stock}`. Auto-glass → `{installer/van, vehicle, compliance: [adas-calibration], inventory: sku-by-vehicle}`. Maid → `{cleaner/crew, property-site, compliance: [bonding-insurance], inventory: supplies}`.

### 7.3 Workspace surface contract

The field-dispatch board is an **operational board inside `/workspace`**, not a new route, not a global nav item, and not a marketing hero. It uses workspace-home primitive families:

| Board region | Workspace primitive | Operator question answered |
| ------------ | ------------------- | -------------------------- |
| Critical strip | `decision-queue` / `communication-exceptions` | What is unassigned, late, unconfirmed, failed to notify, or blocked right now? |
| Map/list | `geo-map` | Where are today's jobs and which ones need dispatch action? |
| Resource lanes | `capacity-lanes` / `appointment-schedule` | Who is free, loaded, en route, on site, or over capacity? |
| Work cards | `case-board` | What job is this, who is the customer, what is needed, and what is the next action? |
| Inventory/parts | `inventory-watch` | Which truck/van/supply constraint blocks first-visit completion? |
| Customer contact | `communication-exceptions` | Which customer update failed or needs approval? |
| Coworker handoff | `handoff-queue` | What did the dispatcher coworker propose, and what needs human acceptance? |

UX rules:

- First viewport order: critical strip, schedule/resource lanes, map/list, then supporting inventory/contact/handoff panels. The operator should not need to read architecture text to know what to do.
- Use profile vocabulary: "cleaner", "crew", "installer", "tech", "van", "visit", "job". Avoid generic schema terms such as `WorkItem`, `sourceType`, or visible phase names.
- Show a compact visual board. Do not put a map/schedule inside nested cards. Cards are acceptable for individual repeated jobs, not as the page section frame.
- Use lucide icons where available for route/location, clock, alert, check, user/crew, package/parts, phone/message, shield/compliance, and invoice/payment actions.
- Reporting/data-display UI composes report-kit (`StatusBadge`, `StatCard`, `DataTable`, `FilterBar`) and shared status domains. No local status color maps or hardcoded colors.
- Empty states are honest: "No jobs scheduled today", "No verified contact channel", "Location not geocoded", "No routing provider configured", "No eligible resource found." Empty is never rendered as healthy green.
- On mobile, the board becomes priority-first: critical strip -> today's list -> selected job detail -> map as optional collapsed panel. Text must wrap without overlap.
- AI coworker actions that contact customers, change assignments, or prepare invoices require preview and confirmation unless the install has an explicit automation policy and audit trail for that event type.

---

## 8. Feature decomposition (build order)

Dependency-ordered; each is independently shippable. **★ = in the smallest buildable slice.**

| ID | Feature | Depends on | Parity/Moat |
| -- | ------- | ---------- | ----------- |
| **F0a ★** | `field-dispatch` module + `needsFieldDispatch(axes)` derivation (pure logic + tests) | — | enabler |
| **F0b ★** | `FieldDispatchProfile` type + `deriveFieldDispatchProfile()` + per-archetype override slot | F0a | enabler |
| **F1 ★** | `WorkItem` `field-service-job` lifecycle helpers: sourceType, typed status vocab/parser, evidence metadata schema, report-kit status domains | — | enabler |
| **F2 ★** | Dispatcher coworker core — T-24h confirm proposal + on-my-way proposal + verified-channel routing + failed-delivery exception | F1 | parity |
| **F3 ★** | Field-dispatch workspace-home contribution (generic board, reads profile vocabulary, no new route) | F1, workspace-home substrate | parity |
| **F4** | Assignment engine — skill+proximity+availability+**value/urgency** auto-assign; wire `dispatch-tech` map-pin action | F1, F3 | parity (value-aware = catch-up) |
| **F5** | Route/ETA — mapping-provider abstraction, caching, no-provider fallback, ETA in on-my-way when configured | F2, F4 | parity |
| **F6** | Running-late cascade → whole-board re-optimization hook | F4, F5 | parity→frontier |
| **F7 ★** | Trades-maintenance vertical profiles (plumber/electrician/cleaning/landscaping today; HVAC leaf when seeded) | F0b | enabler for first install |
| **F8** | Voice-first field capture (job notes/parts/complete → structured) | F1, STT slice | moat |
| **F9** | Compliance-overlay framework + EPA 608 instance (+ ADAS as sibling); storage/retention decision before regulated evidence | F1 | **moat** |
| **F10** | Inbound AI call answering (answer→qualify→book) | F2, TTS slice | parity (emerging) |
| **F11** | Field-parts inventory — per-vehicle stock (Workbooks substrate), parts-used→stock deduction, low-stock→draft-PO reorder | F0b, F1 | **moat (spine §6.5)** |
| **F12** | Native job→invoice→AR — job-complete→DPF-native `Invoice` (warranty-classified, `sourceType=field-service-job`), payment collection. QuickBooks import/sync is a **migration bridge** only. Native GL/statements/sales-tax deferred → [strategy spec](2026-06-14-native-financial-management-strategy.html). | F1, F14 | **moat (spine §6.5)** |
| **F13** | AI job/finance monitoring — Dispatcher coworker standing watches: schedule adherence, unconfirmed, failed-notify, parts-blocked, cert expiry, **un-invoiced completion / sync-failed** | F1, F2 | **moat (spine §6.5)** |
| **F14** | Warranty-aware service — per-component parts/labor coverage (e.g. compressor 10yr parts / 0 labor) on the equipment record; field-invoice line classification (covered → $0 customer line) | F12, equipment record | **moat** |
| **F15** | Mobile field-app contract — geo / comms / routing / customer-location detail / field-invoice / payment surfaces the dispatcher consumes; the dispatch↔mobile convergence contract | F1, F2 | enabler |

> **F14/F15 detail + warranty model + the mobile convergence contract are specified in [Field Dispatch — Mobile Field-App Contract & Warranty Service](2026-06-14-field-dispatch-mobile-contract-and-warranty-design.html) (HTML+SysML).** The native mobile archetype apps (separate thread, PR #1886) implement the contract's ports; warranty logic is built + verified in `@dpf/validators/field-dispatch-warranty.ts`.

### Smallest buildable slice (no external dependencies)
**F0a + F0b + F1 + F2(propose confirm + propose on-my-way) + F3(minimal board) + F7(trades vocab).**
This gives the **entire `trades-maintenance` category** a working dispatcher *today* — plumber, electrician, cleaning-service, landscaping, facilities-maintenance — and HVAC the moment its leaf seeds. Definition of done mirrors the HVAC spec §12, generalized: archetype-agnostic board renders for any field-dispatch archetype, customer notifications are previewed/approved or clearly blocked by missing contact/provider state, and `field-service-job` `WorkItem`s show validated status/evidence metadata. Typecheck, affected unit tests, production build, and UX verification must pass on the proper substrate.

---

## 9. Cross-vertical worked examples (proof the profile generalizes)

| Vertical | Resource / fleet | Serviced entity | Compliance overlay | Inventory | Distinctive dispatch wrinkle |
| -------- | ---------------- | --------------- | ------------------ | --------- | ---------------------------- |
| **HVAC** (Dale) | technician / truck | equipment-unit | EPA 608 | truck-stock | refrigerant log at close; cert-expiry blocks assignment |
| **Windshield / auto glass** | installer / van | vehicle (VIN) | **ADAS calibration** | SKU-by-VIN | glass SKU resolved from VIN; **mobile-to-customer** default; calibration cert required post-install for warranty |
| **Maid / cleaning** | cleaner / crew | property-site | bonding/insurance | supplies | 2-person crew as one assignable unit; recurring visit templates; key/access handling |
| **Mobile pet grooming** | groomer / van | animal | rabies-vax check | van supplies | per-pet history; weather/temperature constraints on van |
| **Home health** | nurse/aide | person | **HIPAA + clinical** | DME/supplies | episode-of-care job; PHI/clinical notes are deferred until regulated evidence storage and strict customer-scope verification land |
| **Pest control** | applicator / truck | property-site | **pesticide-applicator license + per-application log** | chemical stock | wind/weather gating; re-entry interval; license-class match to job |
| **Appliance repair** | technician / van | equipment-unit | none | parts-by-van | model/serial → parts lookup; first-visit-fix vs parts-return |
| **Field inspection** | inspector | property-site / vehicle | license/certification | none | report-as-deliverable; no parts; photo-evidence heavy |

All eight run the §7.1 core unchanged; only the §7.2 profile differs. That is the test of the design. The first implementation proves low/standard-privacy trades profiles first; regulated-health and public-safety profiles remain consumers of the same model but are not first-slice acceptance fixtures.

---

## 10. How a new vertical is added (the payoff)

To add "windshield replacement" once this capability ships:
1. Author the leaf `ArchetypeDefinition` (services, sections, form, axes with `form: services`, `delivery: physical`).
2. The `field-dispatch` module + dispatcher + board are **derived automatically** from axes (ADR-1/2) — zero dispatcher code.
3. Author a `FieldDispatchProfile` override (`installer/van`, `vehicle`, `[adas-calibration]`, `sku-by-vehicle`).
4. If `adas-calibration` overlay doesn't exist yet, build it once in the F9 framework — then mobile-tire, detailing, etc. reuse it.

The archetype gap analysis (§ companion doc) lists every such vertical we don't yet have.

---

## 11. Risks

| Risk | Likelihood | Severity | Mitigation |
| ---- | ---------- | -------- | ---------- |
| Over-abstraction: a "universal dispatcher" that fits no vertical well | Medium | High | Drive the design from 3 concrete profiles (HVAC, auto-glass, cleaning) in F7/F9; the §9 table is the acceptance test. Ship trades first, prove on Dale. |
| `needsFieldDispatch(axes)` mis-derives (false pos/neg) for edge archetypes | Medium | Medium | Pure function with a golden-file test over all 47 leaves; per-archetype override escape hatch (ADR-4). |
| Compliance overlays become legal liability if presented as authoritative | Low | High | Carry HVAC spec's disclaimer: DPF is a log-keeping tool, not compliance advice. Immutable append-only logs; operator owns accuracy. |
| Generalizing the workspace board regresses the (planned) HVAC board | Low | Medium | The HVAC board plan ([2026-06-04](../plans/2026-06-04-hvac-dispatcher-workspace-home.md)) becomes the first instance of the generic contribution; reconcile rather than fork. |
| Scope balloons past the slice | Medium | Medium | Smallest slice (§8) is F0/F1/F2/F3/F7 only; F5–F11 are explicitly later. |
| `WorkItem.status` becomes a pile of unvalidated strings | Medium | High | Field dispatch owns `FIELD_DISPATCH_JOB_STATUSES`, parser/tests, and statusColors mappings before any board writes statuses. Unknown values render as `needs-review`. |
| Dispatch becomes another dashboard/nav destination | Medium | High | UX fit decision: `/workspace` contribution only; no global nav or `/dispatch` route unless a later IA review supersedes this spec. |
| Mapping provider usage violates service policy or fails offline | Medium | Medium | Provider boundary, caching, proxy/switch requirement, no bulk public geocoding, and no-provider fallback states. |
| Location/customer contact data leaks beyond the dispatcher context | Low | High | Permission checks, strict customer scope where applicable, no PHI in first-slice evidence, and board rows reveal only the minimum needed. |
| AI sends customer messages or reassigns jobs without authority | Medium | High | Preview + confirmation by default; autonomous sends/assignments require explicit automation policy, audit trail, and failure surfacing. |

---

## 12. Deferred decisions

1. **Derive vs. author the `FieldDispatchProfile`** — start derived-with-override; revisit if derivation logic outgrows the axes.
2. **`ComplianceArtifact` storage** — `WorkItem.evidence` append-only vs. a dedicated row on the resource profile (carried from HVAC §16.6).
3. **Crew as an assignable unit** — model a 2-person crew as one resource or as a group of `assignedToUserId`s. Decide in F4.
4. **Mapping/telephony providers** — provider-abstracted (HVAC §16.2/16.3); conduit model per ADR-7 of the HVAC spec.
5. **Whole-board re-optimization (F6 frontier)** — reactive cascade first; continuous optimization is a later, opt-in escalation.
6. **SMS / voice-call channels (capability gap, confirmed 2026-06-14)** — field-service customers (homeowners) are primarily reached by **text and phone call**, but the platform comms substrate (`channel-types.ts`) ships `in-app/push/email/teams/slack/whatsapp/telegram/webhook` with **no `sms` and no voice-`call` adapter**. WhatsApp is the only real customer-facing channel today. F2 reuses `selectCommunicationPlan` and routes over whatever verified bindings exist; an **SMS adapter** (and later a TTS voice adapter, per HVAC spec Sprint 6) is a prerequisite for true field-service parity and should be its own BI. Until then, on-my-way/confirmation reach customers via WhatsApp/email only.
7. **Per-customer channel preference** — `CustomerContact` has no `preferredNotificationChannel`/`phoneType` (confirmed). F2 channel choice is urgency-driven (`selectCommunicationPlan`) over verified bindings only. The HVAC spec ADR-3 "prefers call/SMS/email" preference is a deferred additive migration on `CustomerContact`.

---

## 13. Acceptance & Evidence

### 13.1 Architecture acceptance

- `needsFieldDispatch(axes)` is pure and tested across every current `ALL_ARCHETYPES` entry; tests assert native, partial, and non-dispatch archetypes.
- `field-dispatch` is added to `ArchetypeModule` and to activation-profile validation/merge logic as a derived module, not hand-authored per leaf.
- `deriveFieldDispatchProfile()` returns a profile for dispatch archetypes and `null` otherwise. Representative tests cover plumber/electrician/cleaning/landscaping, auto-glass or its pending profile fixture, mobile pet grooming, field inspection, and a non-dispatch shop/service archetype.
- No new core Prisma table is introduced for jobs, technicians, boards, or locations in F0-F3. Any later storage addition must cite the existing substrate gap it solves.
- Field-dispatch job status writes pass through a typed helper and unknown persisted statuses render as `needs-review`.

### 13.2 UX acceptance

- `/workspace` renders the dispatch contribution when the active archetype or merged composition includes `field-dispatch`.
- The first viewport shows critical exceptions, today's schedule/resource load, and map/list context without relying on long explanatory text.
- Missing providers/data produce honest neutral states: no geocoder, no verified contact channel, no eligible resource, no jobs today, no inventory signal.
- Status colors resolve through report-kit domains (`fieldDispatchJob`, `operationalStatus`) and every status has visible text or an accessible label.
- The board uses existing workspace/report-kit primitives and theme tokens. A scan finds no local status color maps, raw hex colors, or hardcoded Tailwind status palettes in the new dispatch surface.
- Mobile verification confirms the critical strip and job list are usable before the map, with no text overlap.

### 13.3 Operational acceptance

- A dispatcher can see unassigned, scheduled, confirmed, en-route, on-site, complete, and needs-review jobs.
- The coworker can propose a confirmation/on-my-way message, show the target channel and content preview, and either send after approval or explain why sending is blocked.
- Assignment recommendations show rationale: skill, proximity/location availability where known, availability window, urgency, and value signal when available.
- Communication failures create or reuse `CommunicationDeliveryAttempt` records and surface as board exceptions.
- Evidence captured in the first slice is non-sensitive metadata or references; regulated artifacts are blocked/deferred until F9 storage/retention decisions land.

### 13.4 Verification commands and substrate

- Source-local unit tests: `pnpm --filter @dpf/storefront-templates exec vitest run` for field-dispatch derivation/profile tests, plus affected `web` unit/component tests.
- Source-local typecheck: `pnpm --filter web typecheck` and any affected package typecheck if the worktree is compile-ready.
- Production build and UX verification run on the canonical local install after governed self-upgrade or on the shared local-CI convergence sandbox, not a worktree-local runtime.
- UX evidence captures at least two archetypes: one trades-maintenance dispatch-native profile and one non-dispatch archetype that should not render the board.

---

## 14. Recommended next step

Build the **smallest buildable slice** (§8: F0a+F0b+F1+F2+F3+F7) directly in the worktree — it lights up dispatch for the whole `trades-maintenance` category and is the foundation every other feature and vertical sits on. In parallel, the [archetype gap analysis](../research/2026-06-13-field-dispatch-archetype-gap-analysis.md) goes to a separate thread to stand up the missing dispatch-native archetypes (automotive-services, home-health, pest-control, etc.) that will consume this capability.
