# Vertical Workspace Home Design

| Field | Value |
| ----- | ----- |
| Status | Draft for review |
| Date | 2026-05-24 |
| Backlog item | BI-89C19AAF |
| Epic | EP-REDUCTION-GEAR-ARCH |
| Anchor spec | `docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md` sections 5.5, 5.6, 8.3 |
| Scope | Internal employee workspace home tailored per `StorefrontArchetype` |
| Out of scope | Implementation, schema migration, route rewrite, customer portal changes |

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

I verified the Docker-served app at `http://127.0.0.1:3000/workspace` with the local admin account. The current home presents:

- A shell header reading "Internal cockpit" and "Small human team, AI coworkers filling in specialist expertise".
- Platform navigation across Workspace, Customer, People, Finance, Compliance, Portal, Portfolio, Platform, Build, and Admin.
- `BusinessCommandCenter` cards for AI coworkers, open work, customer accounts, finance items, open incidents, and builds.
- Readiness rows for AI workforce, customers and delivery, finance, compliance, people, and platform delivery, each across Context, Connections, Capabilities, Cadence, Confidence, and Containment.
- Generic workspace tiles such as Direct AI coworkers, Shape products, and Run the business.
- Calendar and activity feed.

This is coherent for platform operations. It is not what an HVAC dispatcher, clinic scheduler, retail merchandiser, or field tech would naturally scan first.

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

1. Audience first. Platform operators get the Cockpit. Employees get vertical-native work surfaces. Customers get customer-scoped portal views.
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

The platform should support three home modes from one shell:

| Mode | Audience | Route | Language | Source |
| ---- | -------- | ----- | -------- | ------ |
| Platform home | Founder/operator/admin | `/workspace` fallback or `/platform/workspace` future route | Platform operations | Existing command center, readiness, platform sections |
| Vertical workspace home | In-trench employees | `/workspace` when archetype contribution resolves | Vertical-native | Operational records + translated GearInterface projections |
| Customer portal | External customers | `/s/[slug]`, `/portal` | Customer-native | Storefront + customer-scoped projections |

No routing decision should be based only on role. A platform admin in a configured HVAC install may still need the worker home. The shell should expose a switch only where authorized, but the default employee landing page should be vertical-native when a contribution exists.

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

GearInterface projection filtering needs the same discipline. Current Ring 2->3 emission resolves `archetypeContext` from `StorefrontConfig.archetypeId`, which means current rows may carry the internal FK rather than the semantic slug. Therefore the workspace-home signal BI has a hard dependency on one of these fixes:

1. Land the stable archetype follow-on (`BI-44C34478`) so GearInterface rows carry semantic `StorefrontArchetype.archetypeId`; or
2. Normalize FK-backed `archetypeContext` values inside the projection loader by joining through `StorefrontArchetype` before filtering.

The UI and contribution registry should always speak in semantic archetype slugs. If a projection cannot resolve the semantic archetype, it must return an observable unconfigured signal for setup/admin users and avoid showing fabricated confidence to workers.

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

1. Load `StorefrontConfig` for the current organization and include `StorefrontArchetype`.
2. Match a contribution by exact `archetypeId`.
3. If none matches, match by `category`.
4. If none matches, return `unconfigured` with the generic platform home fallback.

### 5.5 Contribution manifest

Each vertical home ships as a typed manifest in code. DB records may enable, disable, order, or override labels; they must not inject arbitrary React components.

```ts
type WorkspaceHomeContribution = {
  id: string;
  displayName: string;
  audience: "internal-worker";
  matches: {
    archetypeIds?: string[];
    categories?: string[];
    activationProfiles?: string[];
  };
  vocabulary: WorkspaceHomeVocabulary;
  layout: "dispatch-board" | "schedule-board" | "queue-board" | "merchandising-board";
  slots: WorkspaceHomeSlotSpec[];
  projections: WorkspaceHomeProjectionSpec[];
  quickActions: WorkspaceHomeActionSpec[];
};

type WorkspaceHomeSlotSpec = {
  slotId: string;
  component: WorkspaceHomeComponentKey;
  title: string;
  tone?: "neutral" | "success" | "warning" | "critical" | "info";
  dataRef: string;
  priority: number;
};
```

Component keys should be registered in code, for example `today-schedule`, `unassigned-work`, `technician-load`, `customer-callbacks`, `parts-watch`, `notification-status`, `inventory-alerts`, `patient-queue`, and `retail-replenishment`. This gives plugin ergonomics without a runtime component sandbox.

### 5.6 Data flow

```text
StorefrontConfig
  -> StorefrontArchetype
  -> WorkspaceHomeResolver
  -> WorkspaceHomeContribution
  -> WorkspaceHomeLoader
       -> canonical domain queries
       -> GearInterface projection queries
       -> vocabulary translation
  -> WorkspaceHomeShell
       -> registered slot components
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

Add a translated projection API near the existing GearInterface query module:

```ts
type WorkspaceHomeSignal = {
  id: string;
  severity: "info" | "warning" | "critical";
  label: string;
  body: string;
  actionHref?: string;
  source: {
    kind: "gear-interface";
    rowIds?: string[];
    capabilityName?: string;
    archetypeContext?: string | null;
  };
};

async function loadWorkspaceHomeSignals(input: {
  archetypeContext: string;
  contributionId: string;
  window: QueryWindow;
}): Promise<WorkspaceHomeSignal[]>;
```

This module may call `getTripleWearReadings`, `getSlipByReason`, `getRecentGraduations`, or newer query helpers. It returns translated signal objects only. The UI should not import `getSlipByReason` or read `prisma.gearInterface` directly.

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
| Coworker handoffs | Human decisions pending | WorkItem messages, TaskRun/tool evidence where linked | Veto/human override/graduation translated |

### 6.5 Query map

| UI question | Primary query | Projection query |
| ----------- | ------------- | ---------------- |
| What is on today's board? | `WorkItem` where `sourceType = field-service-job`, linked `CalendarEvent.startAt` in day window | None |
| What is unscheduled? | `WorkItem` where `sourceType = field-service-job` and `calendarEventId = null` | Gear signal for intake/booking capability gap |
| Which jobs need confirmation? | WorkItem status/evidence plus customer notification preference once available | Gear signal for confirmation workflow failures |
| Did a customer update fail? | `CommunicationDeliveryAttempt` where target maps to job/customer and status is failed | Slip/failed outcome for notification capability |
| Is a technician overloaded? | Calendar duration + assigned WorkItems + `WorkSchedule.maxConcurrent` | Gear signal for route/ETA automation confidence |
| Are parts/equipment missing? | `CustomerConfigurationItem` and WorkItem evidence sidecar | Gear signal for pre-job brief capability gap |
| Which coworker handoff needs review? | WorkItem messages / task activity associated to dispatch capability | GearInterface rows normalized to semantic `archetypeContext = hvac-contractor` |

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

## 8. Unconfigured State

When a business has a `StorefrontArchetype` but no matching home contribution:

- `/workspace` still renders the current platform home.
- A compact notice appears only for users with setup/admin authority: "No vertical workspace home is configured for [archetype name]. Employees are seeing the platform home."
- The resolver records the missing contribution as observable telemetry so product can see which archetypes lack homes.
- No worker-facing page should pretend to be vertical-tailored when it is not.

When a business has no `StorefrontConfig`:

- `/workspace` renders the platform home.
- Setup/admin flows should point the operator toward storefront/business setup rather than asking a worker to configure architecture.

## 9. Refactoring Allocation

Reserve 20% of the implementation effort for refactoring. This is not optional polish; it is what keeps vertical homes from becoming route forks.

Required refactoring targets:

1. Split `apps/web/app/(shell)/workspace/page.tsx` into a thin route and a loader boundary. The route should choose platform, vertical, or unconfigured home; data loading should live in `apps/web/lib/workspace-home/`.
2. Extract the current generic command-center page into a reusable `PlatformWorkspaceHome` so it remains the fallback and admin/operator home.
3. Add a typed contribution registry under `apps/web/lib/workspace-home/contributions/`.
4. Add a translated signal loader under `apps/web/lib/workspace-home/signals/` that wraps GearInterface query APIs.
5. Move vertical UI components under `apps/web/components/workspace-home/`, keeping shared shell/chrome separate from vertical content.
6. Replace hardcoded calendar color values with semantic DPF tokens before reusing the calendar as a vertical-home primitive.
7. Constrain tile/status colors to semantic tone keys instead of unconstrained strings.
8. Add fixture helpers for workspace-home tests so the substrate and HVAC home can be tested without copy-pasted JSON. Clinic and retail fixtures belong to their own follow-on BIs.

Suggested file boundary:

```text
apps/web/lib/workspace-home/
  resolve-workspace-home.ts
  load-workspace-home-context.ts
  contributions/
    registry.ts
    trades-maintenance.ts
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

Implementation BIs should include:

- Unit tests for resolver matching: exact archetype, category fallback, unconfigured fallback, no storefront config.
- Unit tests proving GearInterface projection translation never exposes banned UI terms.
- Component tests for each slot using DPF CSS variables and no hardcoded color classes/hex values.
- Production build with `pnpm --filter web typecheck` and `cd apps/web && pnpm exec next build` or the current repo-approved equivalent.
- Production-path UX verification against the Docker-served app, not a stale dev server.
- Desktop and mobile screenshots for each implemented vertical home.
- Fixture case with at least one automation failure translated to worker-native copy.

Banned copy in worker-facing UI:

- gear
- ring
- torque
- slip
- wear
- triple
- shaft
- calibration
- contribution model

These words may exist in code comments, tests, and projection internals, but not in rendered worker UI copy.

## 11. Follow-On Implementation BIs

Filed under `EP-REDUCTION-GEAR-ARCH` from this spec pass:

1. `BI-1CCC6264` - Workspace home contribution substrate and resolver.
   - Build the resolver, contribution registry, context loader, platform fallback extraction, and unconfigured state.
2. `BI-3E8D2CF5` - Workspace home GearInterface projection service.
   - Build the translated signal loader, banned-copy tests, and source discipline around GearInterface query APIs.
3. `BI-CE6AF925` - HVAC dispatcher workspace home.
   - Add `hvac-contractor` contribution, dispatch-board layout, today's jobs, unscheduled jobs, technician load, customer updates, parts/units, and coworker handoffs.
4. `BI-8954667A` - Clinic scheduler workspace home.
   - Add healthcare/wellness schedule-board variant with patient queue, appointment readiness, no-show risk, practitioner capacity, and missing-form signals.
5. `BI-3F3B535D` - Retail merchandiser workspace home.
   - Add retail-goods merchandising-board variant with order tasks, low stock, incoming inventory, return exceptions, and POS/location sales signals.

The first two BIs are substrate. Each archetype BI should be independently reviewable and should not broaden the substrate unless the substrate BI explicitly changes.

## 12. Decisions and Open Questions

### Decisions

- `StorefrontConfig` remains the install-level source for selecting a vertical workspace home, but matching uses the linked `StorefrontArchetype.archetypeId` semantic slug.
- Exact archetype contributions win over category contributions.
- Worker UI renders translated signals only; no direct GearInterface labels.
- HVAC dispatcher is the first proving archetype.
- Current platform command center remains valuable and should be preserved as fallback/operator home.

### Open questions for implementation planning

- Should the platform home move to a distinct route such as `/platform/workspace`, or should `/workspace` expose a user-authorized mode switch while defaulting employees to the vertical home?
- Should `customVocabulary` remain flat for storefront terms and use a namespaced object for workspace-home terms, or should workspace vocabulary live entirely in contribution manifests until real customization pressure appears?
- Which WorkItem status enforcement slice should own the `field-service-job` lifecycle once HVAC dispatcher implementation begins?

## 13. Reporting Protocol

This spec pass produces:

- A written spec at `docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md`.
- Follow-on implementation BIs under `EP-REDUCTION-GEAR-ARCH`.
- Execution evidence attached to `BI-89C19AAF`.

No implementation is included in this session.
