# Vertical Workspace Home Design

| Field | Value |
| ----- | ----- |
| Status | Reviewed by chief architect — accepted with edits |
| Date | 2026-05-24 |
| Backlog item | BI-89C19AAF |
| Epic | EP-REDUCTION-GEAR-ARCH |
| Anchor spec | [`docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md`](2026-05-24-reduction-gear-architecture-design.md) sections 5.5, 5.6, 8.3 |
| Related specs | [Portal topology consolidation (PR #1083)](2026-05-24-portal-topology-consolidation-design.md); [Archetype-aware item management](2026-04-03-archetype-aware-item-management-design.md); [Customer-surface archetype activation](2026-05-22-customer-surface-archetype-activation-design.md); [Vertical workspace home long-tail queue](2026-05-25-vertical-workspace-home-longtail-queue.md) |
| Scope | Internal employee workspace home tailored per `StorefrontArchetype` |
| Out of scope | Implementation, schema migration, route rewrite, customer portal changes |

## Architect verdict

**Accepted as substrate spec for `EP-REDUCTION-GEAR-ARCH`.** The proposed contribution / resolver / projection / shell-contract decomposition is the right shape. It mirrors the discipline that already worked for `packages/storefront-templates/src/archetypes/*.ts` on the customer-facing side, so this is *symmetric* with the existing platform — not a new pattern. The HVAC dispatcher choice as the first proving archetype is correct: the field-service trades spec gives the cleanest day-one operator story, and `WorkItem`, `CalendarEvent`, `CustomerConfigurationItem`, `CommunicationDeliveryAttempt`, and `WorkSchedule.maxConcurrent` are all verified present in the schema.

**Required corrections folded into this revision:**

1. **Audience-layering nomenclature** — the spec drifted between "Cockpit" (the §5 gear-train diagnostic from the anchor spec) and the current `/workspace` header text. The §5 Cockpit and the current platform workspace home are *not the same surface*. Sharpened in §2.3, §4 principle 1, and §5.1.
2. **Archetype identity** — picked Option 1 (land `BI-44C34478` so GearInterface rows carry the semantic slug). Option 2 (loader-side normalization) is documented only as a transitional shim with a sunset condition; consumers should not normalize forever. See §5.3.
3. **Topology naming** — verification language now matches the [portal topology consolidation spec](2026-05-24-portal-topology-consolidation-design.md): **Live portal** at `http://localhost:3000`, not "Docker-served app at 127.0.0.1". See §2.3, §10. (`localhost:3000` only — the LAN IP does not work for Claude-in-Chrome verification.)
4. **Typed contracts** — added an explicit `WorkspaceHomeComponentRegistry` contract, typed `dataRef`, fail-closed semantics for unknown component keys, and a baseline **slot covenant** every vertical home must satisfy (today/now slot, exceptions/needs-review slot, unconfigured-fallback). See §5.5.
5. **Recent substrate alignment** — explicit hooks into work that has since landed: Calibrator + Autonomy Governor (`BI-861C4959`) as a signal source alongside the raw GearInterface stream; `principleRingScope` (`BI-4AA1074B` Slice 1-3) as the filter when the worker home calls the decide/recall MCP (worker UI must only retrieve ring-scope = worker principles). See §5.7.
6. **PAR alignment** — the "coworker handoffs" slot is the canonical PAR (Propose → Acknowledge → Reassign) acknowledgement surface for workers, not a generic activity feed. Documented in §6.4 / §6.5.
7. **Verification gate** — added the kernel `structural-verification-is-not-functional` requirement explicitly: build green is not done; the dispatch board must be driven on the Live portal with seeded HVAC data and each slot observed rendering real records. Banned-copy assertion now has a concrete test mechanism (vitest over rendered slot output, word-bounded, case-insensitive). See §10.
8. **Open-question §12 demoted** — the WorkItem `field-service-job` lifecycle question is an *upstream dependency*, not an in-spec decision. The HVAC home **reads** WorkItem as-is and renders field-service vocabulary on top; it must not introduce a parallel job model. Moved to §11.1 Dependencies.

**Not folded in (deferred):** the operator-switch authority predicate (§5.2) is left abstract on purpose — the implementer BI must pick the exact permission grant from `apps/web/lib/govern/permissions.ts` after sweeping which role currently has both Platform Development and worker-vertical authority. Specifying it here would risk pinning to a stale grant.

**Build Studio routing:** the six follow-on implementation BIs in §11 (workspace-home substrate, projection service, primitive library, HVAC, clinic, and retail homes) are intentionally sized for the BS Ideate→Design→Build→Ship pipeline; this spec is the design input for the substrate BIs and is the architectural anchor for the vertical child BIs that come after. Per standing rule, Claude does not write feature code for these — file BI → promote → Ideate → BS runs.

## 1. Purpose

The Reduction Gear architecture gives the platform a diagnostic mental model. It should not become the language of daily work. The in-trench employee who opens `/workspace` at the start of a shift should see the business they work in: jobs, patients, bookings, stock, service calls, technician load, callbacks, and follow-ups. They should not see rings, torque, slip, wear, triples, or contribution-model jargon.

The customer-facing portal already has this discipline. It is tailored by `StorefrontArchetype`, vertical vocabulary, section templates, form schemas, and branding. The internal workspace home is still generic. This spec designs the symmetric internal surface: a vertical-native workspace home for employees, powered by the same canonical records and GearInterface stream, translated through archetype-specific projections.

The design goal is a platform extension substrate, not a one-off HVAC dashboard. HVAC dispatcher is the worked example because the field-service trades spec already supplies the clearest day-one operator story.

## 2. Current-State Audit

### 2.1 Route and composition

Current internal home is `apps/web/app/(shell)/workspace/page.tsx`.

The route performs all of these concerns in one server component:

- Auth guard and redirect.
- Permission-derived shell sections through `getWorkspaceSections`.
- Command-center load through `loadWorkspaceCommandCenter`.
- Calendar event range loading.
- Storefront archetype category lookup, currently only used to hide calendar source filters.
- Employee profile and activity-feed loading.
- Rendering the page title, `BusinessCommandCenter`, `AttentionStrip`, generic tiles, calendar, and activity feed.

This makes the page useful as a platform operator home, but it is not a vertical employee workspace. The visible copy says "Workspace" and "Cross-business command center for human employees, AI coworkers, operating cadence, confidence, and containment." That is still platform language.

### 2.2 Archetype awareness

The route already reads `StorefrontConfig -> StorefrontArchetype.category`, but only passes the category into `WorkspaceCalendar`. The calendar hides some source filters by category, for example `providers` for `trades-maintenance`. No layout, KPI, card, action, or alert changes by archetype.

The customer-facing portal and storefront admin are more mature:

- `StorefrontArchetype` stores `archetypeId`, `category`, `itemTemplates`, `sectionTemplates`, `formSchema`, `activationProfile`, `customVocabulary`, and `marketingSkillRules`.
- `StorefrontConfig.archetypeId` is the per-organization source of truth.
- `apps/web/lib/storefront/archetype-vocabulary.ts` maps categories to vertical labels. For `trades-maintenance`, current labels include "Services", "Service Portal", "Property Owners", "Crew", and "Job Requests".
- `packages/storefront-templates/src/archetypes/trades-maintenance.ts` currently seeds facilities maintenance, plumber, electrician, cleaning service, and landscaping. It does not yet seed `hvac-contractor`.

This is enough substrate to select and label an internal home. It is not enough to render one, because the internal home needs its own contribution contract.

### 2.3 Current UI and production-path observation

I verified the **Live portal** at `http://localhost:3000/workspace` (per the [portal topology consolidation spec](2026-05-24-portal-topology-consolidation-design.md) — do not use `127.0.0.1` or the LAN IP) with the local admin account. The current home presents:

- A shell header reading "Internal cockpit" and "Small human team, AI coworkers filling in specialist expertise". **Naming-conflict note:** this header text predates the anchor spec and is *not* the §5 Cockpit (the gear-train diagnostic). It is the current platform workspace home using "cockpit" colloquially. The Phase-1 implementation must remove the word "cockpit" from this surface to prevent collision with the architecturally reserved term. See [PR #1083 — operator-facing IA](2026-05-24-portal-topology-consolidation-design.md): user-facing language should be **Live portal**, **Build runtime / Live preview**, **Contributor preview**; the §5 Cockpit is its own reserved surface inside Platform Development.
- Platform navigation across Workspace, Customer, People, Finance, Compliance, Portal, Portfolio, Platform, Build, and Admin.
- `BusinessCommandCenter` cards for AI coworkers, open work, customer accounts, finance items, open incidents, and builds.
- Readiness rows for AI workforce, customers and delivery, finance, compliance, people, and platform delivery, each across Context, Connections, Capabilities, Cadence, Confidence, and Containment.
- Generic workspace tiles such as Direct AI coworkers, Shape products, and Run the business.
- Calendar and activity feed.

This is coherent for **platform operations** (the "platform-operator workspace home" fallback in §5.1, distinct from the §5 Cockpit of the anchor spec). It is not what an HVAC dispatcher, clinic scheduler, retail merchandiser, or field tech would naturally scan first.

### 2.4 Theme and layout risks

The current workspace components mostly use DPF CSS variables. Two reusable surfaces need cleanup before becoming a vertical-home substrate:

- `WorkspaceCalendar` carries a `CATEGORY_CONFIG` comment requiring concrete hex colors and includes inline hardcoded hex values. That conflicts with the theme-aware UI rule in `AGENTS.md`.
- `WorkspaceTiles` takes raw `accentColor` and metric color values. Today those are generally CSS variables from `apps/web/lib/govern/permissions.ts`, but the type is still an unconstrained string.

These are not blockers for the spec, but they are required refactoring targets before vertical home components reuse the calendar and tile primitives broadly.

## 3. Research and Benchmarking

### 3.1 Open-source / source-available patterns

[Frappe Workspaces](https://docs.frappe.io/framework/user/en/desk/workspace/blocks) are declarative work surfaces made from blocks such as cards, charts, shortcuts, onboarding blocks, quick lists, and number cards. Adopt the principle: a home can be configured from typed blocks. Reject copying it literally: DPF needs strongly typed vertical contributions, not arbitrary page-builder sprawl.

[OCA Field Service](https://github.com/OCA/field-service) shows field service as a family of composable modules: field-service orders, calendars, CRM conversion, routes, recurring work, stock, warranties, skills, timesheets, and vehicles. Adopt the principle: the vertical surface should be assembled from domain capabilities already present in the platform, not from a standalone dashboard model.

[Odoo Field Service](https://www.odoo.com/documentation/19.0/applications/services/field_service/creating_tasks.html) creates field-service work from manual entry, sales orders, or helpdesk tickets, while [worksheets](https://www.odoo.com/documentation/19.0/applications/services/field_service/worksheets.html) give repeatable on-site task templates. Adopt the pattern: operational home cards should point to the canonical work record plus reusable job/checklist templates. Reject the pattern of making the home a full field-service app; DPF should keep `WorkItem`, `CalendarEvent`, customer records, and coworker tools authoritative.

### 3.2 Commercial patterns

[ServiceTitan dispatching](https://help.servicetitan.com/docs/dispatching) centers office staff on technician schedules, job appointments, job trays, alerts, dispatch actions, confirmations, holds, rescheduling, technician communications, and weekly boards. Adopt the dispatch-first mental model for HVAC: schedule lanes, unassigned jobs, technician load, notifications, and exceptions above generic business KPIs.

[Jobber Schedule](https://help.getjobber.com/hc/en-us/categories/115001324208-Schedule) organizes the product around schedule views, route optimization, visits, tasks, events, reminders, day sheets, calendar colors, and calendar syncing. Adopt the one-glance day view and the separation of events from visits/tasks.

[Housecall Pro scheduling](https://help.housecallpro.com/en/articles/9483598-scheduling-and-calendar-faq) exposes dispatch view, day/week employee views, employee ordering, lead technician behavior, unscheduled jobs, and reassignment. Adopt the idea that dispatcher ergonomics start with technician ordering and the unscheduled queue.

[Shopify Home](https://help.shopify.com/en/manual/shopify-admin/shopify-home) gives a useful retail precedent: daily tasks, order tasks, metrics, adaptive cards, and insights are home-page primitives. [Square for Retail inventory](https://squareup.com/help/us/en/article/7746-tracking-your-inventory-with-square-for-retail) reinforces that retail workers care about item availability and inventory actions. Adopt these for later retail merchandiser variants: daily tasks, low-stock alerts, inventory count actions, POS/location metrics.

### 3.3 Patterns adopted

- Home layout is role and vertical specific, not one dashboard for every business.
- Schedule, queue, and exception handling are first-class for service businesses.
- Declarative contribution manifests are useful, but only when backed by typed platform components and canonical query APIs.
- The home should show tasks and exceptions before vanity metrics.
- Customer communication state is part of the operational board, not a separate report.
- Retail and field-service homes share a substrate, but not the same card language.

### 3.4 Patterns rejected

- A generic page-builder for employee homes. It would break architecture clarity and likely leak implementation jargon.
- A separate `Job` or `DispatchBoard` write model for this spec. Existing `WorkItem`, `CalendarEvent`, customer, communication, and GearInterface models should remain authoritative.
- Gear-language KPI labels in worker UI. Translation is mandatory outside the Cockpit.
- Hardcoded color palettes per vertical. Vertical identity should flow through DPF theme variables and branding tokens.

## 4. Design Principles

1. Audience first. Platform operators get **two** surfaces: the §5 Cockpit (gear-train diagnostic, anchor spec §5) for substrate diagnosis *and* the platform workspace home (current `/workspace` page, kept as fallback per §5.1) for cross-domain operations. In-trench employees get vertical-native work surfaces. External customers get customer-scoped portal views (anchor spec §8.3). Three audiences, never collapsed into one rendering.
2. The selected archetype comes from `StorefrontConfig.archetypeId` and its linked `StorefrontArchetype`, not from `Organization.industry` or `BusinessContext.industry`.
3. The home reads canonical operational records and GearInterface projections. It does not compute independent evidence.
4. GearInterface terms are internal to loaders and projection adapters. UI copy uses words a worker would say at the start of a shift.
5. New verticals extend the home through typed manifests and registered components, not route forks.
6. Unconfigured state is visible and honest. If a business has no matching contribution, the home says the vertical home is not configured and falls back to the platform home.
7. UI is dense, calm, and operational. No marketing hero, no decorative dashboard clutter, no nested cards, no oversized explanatory text.
8. Theme-aware styling is mandatory. Components use `var(--dpf-*)` tokens and semantic tones.
9. Refactoring is part of the slice, not cleanup left behind. Reserve 20% of implementation capacity for substrate cleanup.

## 5. Architecture

### 5.1 Surface split

The platform supports **four** home/surface modes from one shell. The §5 Cockpit from the anchor spec is a distinct platform-operator surface — it is listed here for completeness but is owned by the reduction-gear anchor spec, not this one:

| Mode | Audience | Route | Language | Source |
| ---- | -------- | ----- | -------- | ------ |
| Platform Cockpit (anchor spec §5) | Platform operator diagnosing the substrate | Inside Platform Development, e.g. `/platform/cockpit` | Gear-train mechanical (torque, slip, wear, lubrication, heat, graduation) | GearInterface stream directly |
| Platform workspace home | Founder / operator / admin doing cross-domain work | `/workspace` fallback when no vertical contribution matches | Platform operations (no gear language) | Existing command center, readiness, platform sections |
| Vertical workspace home | In-trench employees | `/workspace` when an archetype contribution resolves | Vertical-native | Canonical operational records + translated GearInterface projections + Calibrator/Governor signals |
| Customer portal | External customers | `/s/[slug]`, `/portal` | Customer-native | Storefront + customer-scoped projections (anchor spec §8.3) |

No routing decision should be based only on role. A platform admin in a configured HVAC install may still need the worker home. The shell exposes a mode switch only where authorized; the **default employee landing page is the vertical workspace home when a contribution exists, otherwise the platform workspace home**. The Cockpit is never the default landing — it is reached deliberately from Platform Development.

### 5.2 Workspace shell and chrome contract

The home renderer is not enough by itself. A vertical worker home embedded inside platform-heavy chrome would still violate the audience contract. The implementation substrate must define a shell context alongside the home resolution:

```ts
type WorkspaceShellMode = "worker" | "platform-operator";

type WorkspaceShellContext = {
  mode: WorkspaceShellMode;
  primaryLabel: string;
  subtitle?: string;
  navGroups: WorkspaceNavGroup[];
  showOperatorSwitch: boolean;
};
```

Worker mode requirements:

- The header must not say "Internal cockpit" or other platform-operator framing.
- Primary nav should prioritize the active vertical's daily routes, for example Dispatch, Jobs, Customers, Technicians, Calendar, Invoices, and Portal for HVAC.
- Broad platform/admin routes remain available only through role-authorized secondary navigation or an operator switch, not as the first mental model for every worker.
- Global search and notifications remain shared shell capabilities, but result labels and notification copy use vertical vocabulary where a contribution supplies it.
- The operator switch is visible only to users with authority to view both surfaces. It should make the current mode explicit: "Dispatcher home" vs "Platform home", not "Ring view" or "Cockpit mode".

This contract can be implemented incrementally. The first substrate BI should at minimum stop the home header from presenting the worker surface as an "Internal cockpit" and should leave a clear extension point for nav-group filtering.

### 5.3 Archetype identity contract

There are two identifiers in the current storefront substrate:

- `StorefrontArchetype.archetypeId` is the semantic slug, for example `hvac-contractor`.
- `StorefrontConfig.archetypeId` is the FK to `StorefrontArchetype.id` in the database.

Contribution matching must use the semantic slug. A contribution must not match against the internal FK value.

GearInterface projection filtering needs the same discipline. Current Ring 2→3 emission resolves `archetypeContext` from `StorefrontConfig.archetypeId`, which means current rows may carry the internal FK rather than the semantic slug. **Architect decision (2026-05-24):** the canonical fix is Option 1; Option 2 is permitted only as a transitional shim with an explicit sunset condition.

1. **Canonical (required):** Land the stable-archetype follow-on (`BI-44C34478`) so all GearInterface emitters write the semantic `StorefrontArchetype.archetypeId` slug as `archetypeContext`. Includes a one-time backfill of existing FK-valued rows.
2. **Transitional shim (optional, sunset at substrate BI ship):** Until BI-44C34478 lands, the projection loader may normalize FK-backed `archetypeContext` values by joining through `StorefrontArchetype`. The shim must include a `// TODO(BI-44C34478): remove after backfill` comment and a CI assertion that fails when no FK-valued rows remain. Consumers must not normalize forever.

The UI and contribution registry always speak in semantic archetype slugs. If a projection cannot resolve the semantic archetype, it must return an observable unconfigured signal for setup/admin users — never a fabricated default for workers. This follows the standing `feedback_evidence_before_diagnosis` and `feedback_fix_seed_not_runtime` memory rules: patch the emitter, not every consumer.

### 5.4 Resolver

Create a workspace-home resolver boundary:

```ts
type WorkspaceHomeMode = "platform" | "vertical" | "unconfigured";

type WorkspaceHomeResolution = {
  mode: WorkspaceHomeMode;
  organizationId: string;
  archetype: {
    archetypeId: string;
    category: string;
    name: string;
    customVocabulary?: Record<string, unknown> | null;
    activationProfile?: Record<string, unknown> | null;
  } | null;
  contribution?: WorkspaceHomeContribution;
};
```

Resolution order:

1. Load `StorefrontConfig` for the current organization and include `StorefrontArchetype`. Single-org-per-install (`project_single_org_per_install`) means exactly one `StorefrontConfig` per install; if zero, return `unconfigured` and fall back to the platform workspace home.
2. Match a contribution by exact semantic `archetypeId` slug.
3. If none matches, match by `category`.
4. If none matches, return `unconfigured` with the platform workspace home fallback (NOT the §5 Cockpit).

**Archetype change behavior.** The resolver re-evaluates per page load — there is no cached resolution. When an install changes its `StorefrontArchetype` via storefront admin, the next page render uses the new archetype. Historical GearInterface rows tagged with the old `archetypeContext` slug are simply not surfaced by the new contribution's signal filter; they remain queryable from the Cockpit. This is acceptable because workers only need *current* operational signal; the diagnostic surface owns the historical view.

### 5.5 Contribution manifest

Each vertical home ships as a typed manifest in code, symmetric with the existing customer-side pattern at `packages/storefront-templates/src/archetypes/*.ts`. DB records may enable, disable, order, or override labels; they must not inject arbitrary React components. This is deliberate: a runtime component sandbox would re-introduce the page-builder sprawl rejected in §3.4.

```ts
type WorkspaceHomeContribution = {
  id: string;
  displayName: string;
  audience: "internal-worker";
  matches: {
    archetypeIds?: string[];        // semantic slugs only — never FKs
    categories?: string[];
    activationProfiles?: string[];
  };
  vocabulary: WorkspaceHomeVocabulary;
  layout: "dispatch-board" | "schedule-board" | "queue-board" | "merchandising-board";
  slots: WorkspaceHomeSlotSpec[];
  projections: WorkspaceHomeProjectionSpec[];
  quickActions: WorkspaceHomeActionSpec[];
  setupActivation: WorkspaceHomeSetupActivation;
};

type WorkspaceHomeSlotSpec = {
  slotId: string;
  primitive: WorkspaceHomePrimitiveKey;   // reusable widget family
  component: WorkspaceHomeComponentKey;   // concrete renderer, registered in code
  title: string;
  tone?: "neutral" | "success" | "warning" | "critical" | "info";
  dataRef: WorkspaceHomeDataRef;          // typed, not a free string
  priority: number;                       // drives desktop sort AND mobile collapse order
  mobileCollapse?: "visible" | "behind-more" | "hidden";  // default derived from priority
};

type WorkspaceHomeSetupActivation = {
  includedInBusinessArchetypeSetup: boolean;
  requiredCanonicalData: WorkspaceHomeCanonicalLoaderId[];
  requiredSignals?: WorkspaceHomeSignalKindId[];
  missingDataBehavior: "seed-demo-data" | "empty-state" | "setup-task";
};

type WorkspaceHomeDataRef =
  | { kind: "canonical"; loaderId: WorkspaceHomeCanonicalLoaderId; window?: QueryWindow }
  | { kind: "signal"; signalKindIds: WorkspaceHomeSignalKindId[]; window?: QueryWindow }
  | { kind: "composite"; left: WorkspaceHomeDataRef; right: WorkspaceHomeDataRef };
```

**Reusable primitive library.** A slot is not a one-off dashboard tile. It is an instance of a reusable primitive with vertical vocabulary, data bindings, and interaction rules. The primitive library is the shared product surface that lets Dale's AC repair board, a clinic scheduler board, a retail merchandising board, and an MSP customer-estate board reuse the same reliable widget mechanics while still looking native to the work.

Initial primitive keys:

| Primitive | Purpose | Example vertical uses |
| --------- | ------- | --------------------- |
| `decision-queue` | Work needing human sequencing or acknowledgement | HVAC emergency jobs, dental missing forms, legal filing deadlines |
| `geo-map` | Location-aware customers, sites, routes, or properties | HVAC customer map, dog-walking route, property-management unit map |
| `capacity-lanes` | People/resource load by role, vehicle, room, chair, or instructor | Technician lanes, practitioner load, instructor/car capacity |
| `health-board` | Current health/status of managed customer estates or assets | MSP customer IT health, facilities asset health, software-platform service health |
| `inventory-watch` | Stock, parts, equipment, or supplies that can block work | Truck stock, retail low stock, bakery ingredients, salon supplies |
| `case-board` | Longer-running cases, matters, clients, animals, students, or residents | Legal matters, rescue animals, tutoring learners, HOA resident issues |
| `service-period-board` | Time-bounded service or production periods | Restaurant dinner service, bakery bake schedule, catering event prep |
| `communication-exceptions` | Customer/client/patient/member updates that failed or need response | HVAC ETA texts, patient reminders, owner updates, donor outreach |
| `handoff-queue` | Coworker PAR acknowledgements and human-in-the-loop decisions | Dispatcher approvals, clinic scheduler approvals, MSP escalation handoffs |

Every primitive owns:

- A canonical data contract (`dataRef` shape and loader expectations).
- A visual density contract for desktop and mobile.
- Empty, loading, stale-data, and misconfigured states.
- Allowed actions and disabled states.
- Worker-facing vocabulary inputs.
- Banned-copy protection for platform and gear language.

Concrete components, for example `TechnicianLoadSlot` or `CustomerUpdatesSlot`, implement one primitive in a vertical-specific form. A component may be reused across archetypes when only vocabulary differs; it should fork only when the operating model changes. This is the architecture that lets the feature library compound instead of spawning one screen per vertical.

**Component registry contract.** Components are registered through a single typed map. Unknown component keys must fail closed:

```ts
type WorkspaceHomeComponentRegistry = Readonly<
  Record<WorkspaceHomeComponentKey, WorkspaceHomeSlotComponent>
>;

// At render time
const component = registry[slot.component] ?? UnknownSlotComponent;  // never throw to the user
// UnknownSlotComponent renders an honest "Slot misconfigured" tile for admins
// and an empty placeholder for workers — never silent omission.
```

Registered component keys (initial set): `today-schedule`, `unassigned-work`, `technician-load`, `customer-callbacks`, `parts-watch`, `notification-status`, `inventory-alerts`, `patient-queue`, `retail-replenishment`, `coworker-handoffs`, `shift-summary`. Adding a key is a code change with type-system enforcement; this gives plugin ergonomics without a runtime component sandbox.

**Slot covenant (mandatory for every vertical home).** Every contribution MUST include at minimum:

1. A **today/now slot** — what is on the board right now (schedule, queue, today's tasks).
2. An **exceptions / needs-review slot** — what requires the worker's attention before anything else.
3. A **coworker-handoffs slot** — pending PAR acknowledgements addressed to this worker (see §6.4 and `feedback_propose_acknowledge_reassign`).

This covenant gives workers a consistent mental model across verticals — "where is my day, what's broken, what's waiting on me" — without prescribing the cards in between. The substrate BI MUST encode the covenant as a type-level constraint on `WorkspaceHomeContribution` (e.g. `slots: [TodaySlot, ExceptionsSlot, HandoffsSlot, ...rest]`) or as a runtime registration assertion with a failing test.

**Architect amendments (additive, optional).** Folded in from the 2026-05-31 archetype-aware-workspace spec architect pass so the substrate carries them rather than a parallel shape (see [2026-05-31-archetype-aware-workspace-design.md §"Folded into parent spec via amendments"](2026-05-31-archetype-aware-workspace-design.md)):

1. **`primaryOperatingQuestion?: string`** on `WorkspaceHomeContribution` — names "what one question the worker arrives asking" (HVAC: "what's on the board today?"; MSP: "what's red on the estate?"). Surfaces in business-setup activation summaries so admins can see the framing the vertical home commits to. Optional — substrate-only delivery leaves it undefined; the resolver does no derivation.
2. **`zone?: WorkspaceHomeSlotZone`** on `WorkspaceHomeSlotSpec` (named `WorkspaceHomeSlot` in the substrate code; same concept) — presentation grouping above the slot covenant, enumerated as `"critical-strip" | "primary" | "secondary" | "briefing" | "setup"`. Lets a contribution say *how* a slot reads on the worker home (front-and-center, supporting, or admin-only) without forking the slot covenant or the primitive registry. Optional; downstream renderers may derive a default from existing ordering signals when absent. The substrate stores the value verbatim and does no derivation.

Both fields are additive. Contributions written before the amendments — including any contribution registered against the registry today — remain valid without change.

**Business-archetype setup activation.** Workspace-home activation is part of archetype setup, not a later manual dashboard configuration chore. When setup selects or changes the business archetype / storefront archetype, the setup flow MUST evaluate the workspace-home contribution registry and report one of these outcomes:

1. **Exact home included** — an exact semantic `StorefrontArchetype.archetypeId` contribution exists. Setup confirms the worker home that will be installed, its primitive widgets, and any required setup data.
2. **Category home included** — a category fallback exists. Setup confirms the generic category board and names the missing exact-archetype follow-up for admins.
3. **No home yet** — no contribution exists. Setup records the missing contribution telemetry and keeps employees on the platform workspace home until a contribution lands.

The setup outcome is driven by the existing business setup / storefront setup substrate: `BusinessContext` remains the business identity context, `StorefrontArchetype` remains the surface/archetype resolver, and `BusinessModel` remains the internal operating-model / role template layer. This spec does not collapse those models. It adds a required activation handshake between them: when the archetype is configured, the matching workspace-home contribution and primitive widgets become part of the installed business experience.

Implementation implications:

- The workspace-home substrate (`BI-1CCC6264`) must expose an activation summary that setup can call without rendering `/workspace`.
- Each vertical implementation BI must include setup verification: after selecting that archetype, `/workspace` resolves to the intended primitive composition without manual admin wiring.
- Each contribution must declare required canonical data so setup can create setup tasks, seed safe demo records in test installs, or show honest empty states.
- If an archetype ships without a workspace-home contribution, setup must not imply the business has a tailored worker home.
- Feature contributions that introduce reusable worker widgets should register against primitive keys and applicability metadata so future archetypes can reuse them by composition.

### 5.6 Data flow

```text
StorefrontConfig
  -> StorefrontArchetype (semantic archetypeId slug)
  -> WorkspaceHomeResolver
       -> emits unconfigured-archetype telemetry if no contribution matches
  -> WorkspaceHomeContribution
  -> WorkspaceHomeLoader
       -> canonical domain queries (WorkItem, CalendarEvent, CustomerConfigurationItem, CommunicationDeliveryAttempt, ...)
       -> GearInterface projection queries (raw stream — anchor spec §3)
       -> Calibrator/Governor signals (BI-861C4959 — graduations, vetoes, autonomy moves)
       -> vocabulary translation (worker-native)
  -> WorkspaceHomeShell
       -> registered slot components (fail-closed on unknown keys)
```

Canonical domain queries answer factual questions:

- Which jobs are scheduled today?
- Which jobs are unassigned?
- Which customer notifications are queued, sent, failed, or awaiting reply?
- Which technician is assigned?
- Which customer/site/equipment record is attached?

GearInterface projections answer confidence and automation-health questions:

- Which coworker/capability/archetype combinations are degrading?
- Which recent transmissions ended in failed outcome, human override, cost overrun, safety block, or capability gap?
- Which automations recently graduated or were vetoed?

The home never renders GearInterface fields directly. It translates them into operational signals:

| GearInterface concept | Worker-home translation |
| --------------------- | ----------------------- |
| Semantic `archetypeContext` resolves to `hvac-contractor` | HVAC dispatcher scope |
| Low `meanTorqueTechnical` | "Needs dispatcher review" |
| `slipReason = failed-outcome` | "Automation did not complete" |
| `slipReason = human-override` | "Recently corrected by staff" |
| `slipReason = capability-gap` | "Needs setup before coworker can help" |
| `outcomeType = graduation` | "Coworker can handle more of this flow" |
| `outcomeType = veto` | "Automation blocked for safety or policy" |

### 5.7 Projection service

Add a translated projection API near the existing GearInterface query module. **Two sources, one translator** — the worker home reads raw GearInterface rows *and* Calibrator/Governor outputs (BI-861C4959, already landed); the projection service unifies both behind a single signal type:

```ts
type WorkspaceHomeSignal = {
  id: string;
  severity: "info" | "warning" | "critical";
  label: string;
  body: string;
  actionHref?: string;
  source:
    | { kind: "gear-interface"; rowIds?: string[]; capabilityName?: string; archetypeContext?: string | null }
    | { kind: "governor"; decisionId: string; outcome: "allow-auto" | "allow-with-notify" | "require-hitl" | "escalate" | "block" }
    | { kind: "calibrator"; trustKey: string; window: QueryWindow };
};

async function loadWorkspaceHomeSignals(input: {
  archetypeContext: string;     // semantic slug only
  contributionId: string;
  window: QueryWindow;
}): Promise<WorkspaceHomeSignal[]>;
```

This module may call `getTripleWearReadings`, `getSlipByReason`, `getRecentGraduations`, Governor consultation history, or Calibrator trust snapshots. It returns translated signal objects only. The UI MUST NOT import `getSlipByReason` or read `prisma.gearInterface` directly.

**Ring-scope discipline (BI-4AA1074B).** If a worker slot needs to consult the wiki recall/decide MCP (for example, to render decision-relevant principles next to an exception), the call MUST scope by `principleRingScope = worker` (or the equivalent vertical-employee scope). The Cockpit may pull every ring scope; the worker home must not surface platform-engineering principles into the in-trench surface.

## 6. HVAC Dispatcher Home

### 6.1 Archetype and vocabulary

Recommended exact archetype: `hvac-contractor`, category `trades-maintenance`.

If `hvac-contractor` is not yet seeded, the category-level `trades-maintenance` contribution can provide a generic service-dispatch home, but the UI should visibly show "HVAC home not configured yet" in setup/admin surfaces. The in-worker fallback should be useful and honest, not broken.

HVAC worker vocabulary:

| Concept | Label |
| ------- | ----- |
| Work unit | Job |
| Calendar unit | Service call |
| Worker | Technician |
| Queue | Unscheduled jobs |
| Customer | Customer |
| Customer site | Site |
| Equipment | Unit |
| Notification | Customer update |
| AI coworker action | Dispatcher handoff |

Never show: gear, ring, torque, slip, wear, triple, shaft, calibration, contribution model.

### 6.2 Primary user

The primary user is the office dispatcher or owner-operator who starts the day by answering:

- Which jobs are scheduled today?
- Which customers still need confirmation?
- Which technician is overloaded?
- Which service call is running late?
- Which unscheduled request needs a time slot?
- Which customer update failed?
- Which coworker handoff needs a human answer?

The secondary user is a field tech checking a desktop/tablet home before going mobile. Their route should be supported but not dominate the dispatcher home.

### 6.3 Desktop wireframe

```text
+--------------------------------------------------------------------------------+
| Dispatch board                                         Tue, May 26   Add job    |
| 7 service calls today     2 need review     1 customer update failed            |
+--------------------------------------------------------------------------------+
| Needs dispatcher review                                                         |
| [Confirm Johnson 10:30] [Garcia install parts check] [Voicemail needed: Lee]    |
+-----------------------+------------------------------------+-------------------+
| Unscheduled jobs      | Today's technician schedule         | Dispatcher dock   |
| - AC not cooling      |                                    | Technician load   |
| - Maintenance plan    | 8:00  Smith tune-up       Confirmed | Amy: 4 jobs       |
| - No heat callback    | 10:30 Johnson repair      Needs call| Luis: 3 jobs      |
|                       | 13:00 Garcia install      Parts hold|                   |
|                       | 16:00 Lee emergency       Unconfirmed| Customer updates |
|                       |                                    | 5 sent, 1 failed  |
+-----------------------+------------------------------------+-------------------+
| Parts and units                    | Coworker handoffs                         |
| - Garcia: condenser model missing  | - Dispatcher drafted late-arrival text     |
| - Smith: R-410A note on last visit | - Confirmation workflow paused for Lee     |
+------------------------------------+-------------------------------------------+
```

Layout notes:

- The first viewport is the board itself. No hero, no marketing copy, no feature explanations.
- Alerts are compact and action-oriented.
- The schedule is the center of gravity.
- Side panels are docks, not nested cards.
- Mobile collapses to: review queue, current/next service call, technician load, unscheduled jobs, customer updates.

### 6.4 Content map

| Slot | Purpose | Canonical data | Signal overlay |
| ---- | ------- | -------------- | -------------- |
| Shift summary | Counts for jobs, review needs, failed updates | `WorkItem` with `sourceType = field-service-job`, linked `CalendarEvent` | Translated GearInterface signal count |
| Needs dispatcher review | Exceptions requiring action | WorkItem status/evidence, `CommunicationDeliveryAttempt` failures | Low automation confidence, failed outcome, human override |
| Unscheduled jobs | Intake queue | WorkItem without `calendarEventId`, storefront inquiries/bookings once converted | Capability gap if no conversion coworker exists |
| Technician schedule | Day lane by assigned technician | `CalendarEvent`, `WorkItem.assignedToUserId`, customer/site | Running-late and missed-confirmation signals |
| Technician load | Capacity at a glance | Assigned jobs, event duration, work schedule | Coworker confidence on route/ETA automation |
| Customer updates | Confirmation/on-my-way/late notices | `CommunicationDeliveryAttempt`, notification logs | Failed notification/capability gap |
| Parts and units | HVAC-specific setup risk | `CustomerConfigurationItem`, WorkItem evidence | Missing equipment data, stale service history |
| Coworker handoffs | PAR acknowledgements addressed to this worker (`feedback_propose_acknowledge_reassign`) — coworker proposed, worker must ack/reassign before mutation proceeds | WorkItem messages, TaskRun/tool evidence where linked, Governor `require-hitl` decisions | Veto / human override / graduation translated |

### 6.5 Query map

| UI question | Primary query | Projection query |
| ----------- | ------------- | ---------------- |
| What is on today's board? | `WorkItem` where `sourceType = field-service-job`, linked `CalendarEvent.startAt` in day window | None |
| What is unscheduled? | `WorkItem` where `sourceType = field-service-job` and `calendarEventId = null` | Gear signal for intake/booking capability gap |
| Which jobs need confirmation? | WorkItem status/evidence plus customer notification preference once available | Gear signal for confirmation workflow failures |
| Did a customer update fail? | `CommunicationDeliveryAttempt` where target maps to job/customer and status is failed | Slip/failed outcome for notification capability |
| Is a technician overloaded? | Calendar duration + assigned WorkItems + `WorkSchedule.maxConcurrent` | Gear signal for route/ETA automation confidence |
| Are parts/equipment missing? | `CustomerConfigurationItem` and WorkItem evidence sidecar | Gear signal for pre-job brief capability gap |
| Which coworker handoff needs review? | WorkItem messages / task activity, joined with PAR acknowledgement state (pending acks where the worker is the named owner) | Governor `require-hitl` decisions + GearInterface rows normalized to semantic `archetypeContext = hvac-contractor` |

### 6.6 States

The worker UI should use field-service lifecycle labels from the field-service trades spec:

- Quoted
- Scheduled
- Confirmed
- En route
- On site
- Complete
- Invoiced
- Paid
- Cancelled

Those labels are UI/domain vocabulary. Implementation can store them according to the eventual WorkItem lifecycle convention, but should not create a separate job model for this spec.

## 7. Other Archetype Variants

The contribution substrate should be proven with HVAC first, then filed as separate implementation BIs for other archetypes. The spec should not bundle all vertical homes into one build.

| Archetype | Layout | First-view focus |
| --------- | ------ | ---------------- |
| `hvac-contractor` | Dispatch board | Today's service calls, technician load, failed customer updates, unscheduled jobs |
| Healthcare/wellness clinic | Schedule board | Patient queue, appointment readiness, no-shows, forms missing, practitioner capacity |
| Retail goods | Merchandising board | Open order tasks, low stock, incoming inventory, returns, POS/location sales signals |
| Professional services | Queue board | Client work queue, deadlines, waiting-on-client, document review, billable follow-ups |

The category fallback should be useful but less specific. Exact archetype contributions win when available.

### 7.1 Overall design evaluation

The overall design is architecturally sound: it keeps `/workspace` as the employee landing surface, preserves the current platform command center as a fallback/operator mode, and introduces vertical homes through typed contributions instead of route forks. The resolver / contribution / projection split is the right durability boundary because each vertical can bring its own vocabulary, layout, and first-view priority while still reading canonical records and translated GearInterface / Calibrator / Governor signals.

The remaining design risk is not the substrate shape; it is validation drift. A table of archetypes is still too abstract unless each implementation BI has a named worker whose day can be replayed. Every vertical-home BI should therefore have a persona case-study document under `docs/personas/` before Build Studio starts the feature. The persona owns the smoke: what the worker asks for, what the first viewport must show, which jargon must be hidden, which coworkers are relevant, and which canonical records must render in the Live portal.

This pass creates the first-wave persona anchors:

| Persona | Persona file | Archetype / category | Workspace-home BI | First-feature smoke |
| ------- | ------------ | -------------------- | ----------------- | ------------------- |
| Dale | [`docs/personas/dale-hvac.md`](../../personas/dale-hvac.md) | target `hvac-contractor` / category `trades-maintenance` | `BI-CE6AF925` | Dispatch board plus truck-stock visibility: today's service calls, unscheduled jobs, technician load, customer update failures, parts/units, and coworker handoffs. |
| Linda | [`docs/personas/linda-clinic.md`](../../personas/linda-clinic.md) | `dental-practice` / category `healthcare-wellness` | `BI-8954667A` | Schedule board: ready appointments, missing forms, no-show risk, practitioner capacity, and patient follow-ups. |
| Marisol | [`docs/personas/marisol-retail.md`](../../personas/marisol-retail.md) | `retail-goods` / category `retail-goods` | `BI-3F3B535D` | Merchandising board: open order tasks, low stock, incoming inventory, return exceptions, and location-level sales signals. |

Substrate BIs `BI-1CCC6264` and `BI-3E8D2CF5` remain shared prerequisites. As of the 2026-05-24 live backlog check, all three first-wave vertical BIs above are open under `EP-REDUCTION-GEAR-ARCH`. Dale's prior Build Studio blocker `BI-4396EFEC` is still `triaging`; do not run new peer-persona Build Studio sessions until a fresh Dale run proves the plan-iteration divergence no longer traps first-feature work.

## 8. Unconfigured State

When a business has a `StorefrontArchetype` but no matching home contribution:

- `/workspace` still renders the current platform home.
- A compact notice appears only for users with setup/admin authority: "No vertical workspace home is configured for [archetype name]. Employees are seeing the platform home."
- The resolver records the missing contribution as observable telemetry so product can see which archetypes lack homes.
- No worker-facing page should pretend to be vertical-tailored when it is not.

When a business has no `StorefrontConfig`:

- `/workspace` renders the platform home.
- Setup/admin flows should point the operator toward storefront/business setup rather than asking a worker to configure architecture.
- Business-archetype setup must show that the worker home is not yet activated and create/point to the missing workspace-home backlog item for that archetype.

## 9. Refactoring Allocation

Reserve 20% of the implementation effort for refactoring. This is not optional polish; it is what keeps vertical homes from becoming route forks.

Required refactoring targets:

1. Split `apps/web/app/(shell)/workspace/page.tsx` into a thin route and a loader boundary. The route should choose platform, vertical, or unconfigured home; data loading should live in `apps/web/lib/workspace-home/`.
2. Extract the current generic command-center page into a reusable `PlatformWorkspaceHome` so it remains the fallback and admin/operator home.
3. Add a typed contribution registry under `apps/web/lib/workspace-home/contributions/`.
4. Add a typed primitive library under `apps/web/lib/workspace-home/primitives/` so queue, map, capacity, health, inventory, case, service-period, communication, and handoff widgets are reusable across archetypes.
5. Add a setup activation summary API that business/storefront setup can call when an archetype is selected.
6. Add a translated signal loader under `apps/web/lib/workspace-home/signals/` that wraps GearInterface query APIs.
7. Move vertical UI components under `apps/web/components/workspace-home/`, keeping shared shell/chrome separate from vertical content.
8. Replace hardcoded calendar color values with semantic DPF tokens before reusing the calendar as a vertical-home primitive.
9. Constrain tile/status colors to semantic tone keys instead of unconstrained strings.
10. Add fixture helpers for workspace-home tests so the substrate and HVAC home can be tested without copy-pasted JSON. Clinic and retail fixtures belong to their own follow-on BIs.

Suggested file boundary:

```text
apps/web/lib/workspace-home/
  resolve-workspace-home.ts
  load-workspace-home-context.ts
  summarize-workspace-home-activation.ts
  contributions/
    registry.ts
    trades-maintenance.ts
  primitives/
    registry.ts
    contracts.ts
  signals/
    load-workspace-home-signals.ts
    translate-gear-signal.ts

apps/web/components/workspace-home/
  WorkspaceHomeShell.tsx
  PlatformWorkspaceHome.tsx
  UnconfiguredWorkspaceHomeNotice.tsx
  slots/
    TodayScheduleSlot.tsx
    ExceptionQueueSlot.tsx
    TechnicianLoadSlot.tsx
    CustomerUpdatesSlot.tsx
    InventoryAlertsSlot.tsx
```

The first implementation boundary is registry + platform fallback + `trades-maintenance`/`hvac-contractor`. Do not create healthcare or retail contribution files in the substrate BI except as type-only examples in tests. Those variants are separately filed as `BI-8954667A` and `BI-3F3B535D`.

## 10. Verification Strategy for Implementation

Implementation BIs MUST include the following. The kernel principle [`structural-verification-is-not-functional`](../../founder-kernel/wiki/principles/structural-verification-is-not-functional.md) applies — build green and tests passing do not constitute "done". The dispatch board has to be driven on the Live portal with seeded HVAC data and each slot observed rendering real records.

**Structural (necessary, not sufficient):**

- Unit tests for resolver matching: exact archetype, category fallback, unconfigured fallback, no storefront config.
- Unit tests proving GearInterface projection translation never exposes banned UI terms (see banned-copy assertion mechanism below).
- Unit test for fail-closed behavior on unknown component keys.
- Type-level assertion (or failing test) that every contribution satisfies the §5.5 slot covenant.
- Component tests for each slot using DPF CSS variables and no hardcoded color classes/hex values.
- Production build with `pnpm --filter web typecheck` and `cd apps/web && pnpm exec next build` or the current repo-approved equivalent.

**Functional (required for ship sign-off):**

- Drive the HVAC dispatch board on the **Live portal at `http://localhost:3000/workspace`** (not Contributor preview, not dev server, not `127.0.0.1`, not the LAN IP — see `project_portal_address`) with seeded HVAC data: at least one scheduled job, one unscheduled job, one over-loaded technician, one failed customer update, one pending PAR acknowledgement, and one Governor `require-hitl` decision.
- Walk every slot. Observe the canonical record rendering and the translated signal overlay. Confirm no slot silently omits when its data source has rows.
- Drive the operator-switch (if implemented in this slice) and confirm both worker and platform-operator modes render without gear-language collision.
- Submit a structured dynamic-analysis report (per `feedback_dynamic_analysis_is_evidence`): drove X → observed Y → signed off Z. Screenshots are evidence, not the report.
- Desktop AND mobile viewport verification — confirm `mobileCollapse` honors slot priority.

**Banned copy in worker-facing UI** — enforced via vitest assertion over rendered slot output with fixtures, word-bounded, case-insensitive:

- gear
- ring
- torque
- slip
- wear
- triple
- shaft
- calibration
- contribution model
- cockpit (reserved for anchor spec §5 surface; worker home must not use the word)

These words may exist in code comments, tests, type names, and projection internals, but MUST NOT appear in rendered worker UI copy. The assertion runs against the rendered HTML/text of each slot component with at least one fixture exercising every signal path.

## 11. Follow-On Implementation BIs and Upstream Dependencies

### 11.1 Upstream dependencies (must land or be in flight before substrate BI Ideate)

- **`BI-44C34478` — Stable semantic archetypeId across the GearInterface emitter path.** Required so projection consumers do not normalize FK values forever. Until landed, the transitional shim in §5.3 Option 2 applies with a documented sunset.
- **WorkItem `field-service-job` lifecycle ownership.** Originally a §12 open question, demoted here: the HVAC home **reads** WorkItem as-is and renders field-service vocabulary on top. It MUST NOT introduce a parallel job model. The enforcement spec for `field-service-job` status transitions is a separate epic; the HVAC home is tolerant of any status shape that includes `scheduled`, `unscheduled`, and `complete` semantics.

### 11.2 Follow-on BIs filed under `EP-REDUCTION-GEAR-ARCH` from this spec pass

1. `BI-1CCC6264` — Workspace home contribution substrate and resolver.
   - Build the resolver, contribution registry, context loader, platform fallback extraction, slot covenant enforcement, and unconfigured state telemetry.
   - Include the reusable primitive registry and the setup activation summary API so business-archetype setup installs or reports the matching worker home.
2. `BI-3E8D2CF5` — Workspace home projection service (GearInterface + Calibrator + Governor).
   - Build the translated signal loader unifying all three sources, banned-copy tests, ring-scope discipline on wiki recall calls, and source discipline around GearInterface query APIs.
3. `BI-5B8FE5C1` — Workspace-home primitive library.
   - Define reusable queue, map, capacity, health, inventory, case, service-period, communication-exception, and handoff widgets as typed primitives with canonical data contracts and visual behavior.
4. `BI-CE6AF925` — HVAC dispatcher workspace home.
   - Add `hvac-contractor` contribution, dispatch-board layout, today's jobs, unscheduled jobs, technician load, customer updates, parts/units, and coworker-handoffs PAR surface. First-class slice for the §10 functional verification protocol.
5. `BI-8954667A` — Clinic scheduler workspace home.
   - Add healthcare/wellness schedule-board variant with patient queue, appointment readiness, no-show risk, practitioner capacity, and missing-form signals.
6. `BI-3F3B535D` — Retail merchandiser workspace home.
   - Add retail-goods merchandising-board variant with order tasks, low stock, incoming inventory, return exceptions, and POS/location sales signals.

BIs 1-3 are substrate; they unblock BIs 4-6 and any future vertical. Each archetype BI must be independently reviewable and must not broaden the substrate unless the substrate BIs explicitly change. Per the Build Studio for ALL development standing rule, Claude does not write the feature code for any of these — file BI → promote → Ideate → BS runs.

### 11.3 Long-tail archetype queue

The long-tail queue is documented in [Vertical workspace home long-tail queue](2026-05-25-vertical-workspace-home-longtail-queue.md). It reconciles the recovered 2026-05-25 companion branch with current source and backlog state: all current storefront categories have category or exact workspace-home contribution coverage, while exact visual paradigms, projection depth, persona fixtures, and vertical-specific UX verification remain queued through follow-on BIs.

This queue is intentionally separated from the parallel business-capability seed/load thread. Capability activation owns which modules, skills, templates, and canonical records become available when an archetype is chosen; workspace-home contributions consume that activation and render the appropriate worker home. No long-tail workspace-home BI should add one-off seed fields simply to make a tile render.

## 12. Decisions and Open Questions

### Decisions

- `StorefrontConfig` remains the install-level source for selecting a vertical workspace home, but matching uses the linked `StorefrontArchetype.archetypeId` semantic slug.
- Exact archetype contributions win over category contributions.
- Worker UI renders translated signals only; no direct GearInterface labels.
- HVAC dispatcher is the first proving archetype.
- Current platform command center remains valuable and should be preserved as fallback/operator home.

### Open questions for implementation planning

- Should the platform workspace home move to a distinct route such as `/platform/workspace`, or should `/workspace` expose a user-authorized mode switch while defaulting employees to the vertical home? **Architect lean:** keep `/workspace` as the single employee landing surface; expose the mode switch only to roles already authorized for Platform Development. A distinct `/platform/workspace` route is a re-org with no compensating clarity gain over a mode switch with a clear chip label.
- Should `customVocabulary` remain flat for storefront terms and use a namespaced object for workspace-home terms, or should workspace vocabulary live entirely in contribution manifests until real customization pressure appears? **Architect lean:** keep vocabulary in contribution manifests until a real customer presses for per-install relabeling. Premature namespacing of `customVocabulary` adds a migration we can defer.
- Which permission grant in `apps/web/lib/govern/permissions.ts` authorizes the worker / platform-operator mode switch? Implementer to pick after sweeping current grants — see "Not folded in" in the architect verdict.

## 13. Reporting Protocol

This spec pass produces:

- A written spec at `docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md`.
- First-wave persona coverage under `docs/personas/` for the HVAC, clinic, and retail workspace-home variants.
- Follow-on implementation BIs under `EP-REDUCTION-GEAR-ARCH`.
- A recovered/current long-tail companion queue at `docs/superpowers/specs/2026-05-25-vertical-workspace-home-longtail-queue.md`.
- Execution evidence attached to `BI-89C19AAF`.

No implementation is included in this session.
