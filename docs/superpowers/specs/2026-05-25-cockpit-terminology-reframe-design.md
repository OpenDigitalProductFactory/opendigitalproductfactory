# Cockpit Terminology Reframe Design

**Backlog item:** BI-19D40BE7
**Epic:** EP-REDUCTION-GEAR-ARCH
**Date:** 2026-05-25
**Status:** Implemented and verified on `codex/cockpit-terminology-reframe`

## 1. Goal

The Cockpit remains the platform-operator diagnostic surface for the Reduction Gear architecture. It keeps the five-ring gear-train topology, numeric readings, drill paths, torque/slip/wear/lubrication/heat/graduation terms, and GearInterface data source. The change is that on-screen nouns are resolved from the install's configured identity and market vertical when that configuration is present.

Configured installs should read as their own operating system, not as a generic diagram. Cold installs and partial installs must fall back to the current abstract gear vocabulary with a visible banner, never silently pretending to be tailored.

This BI applies only to the first row of the audience table in the anchor spec: platform operator / admin. It does not remove gear vocabulary for in-trench workers or external customers.

## 2. Anchor Constraints

From `docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md`:

- Section 5 defines the Cockpit as a gear-train diagnostic panel for platform operators.
- Section 5.4 requires a dense operations surface, stable filters, every metric drillable to evidence, DPF theme tokens only, no decorative dashboard treatment, and unknown states shown honestly.
- Section 5.5 keeps gear language only in the Cockpit audience. Worker and customer surfaces translate the same stream into vertical-native vocabulary elsewhere.
- Section 5.7 requires production-path UX verification with desktop and mobile screenshots, no new hardcoded color classes, seeded/fixture-backed transmissions/slips/HITL/graduation or veto path, and drill-to-evidence or explicit unknown reasons.

## 3. Current Audit

### 3.1 Cockpit string sources

Current file: `apps/web/app/(shell)/admin/cockpit/page.tsx`.

The current Cockpit page is a single server component with local helpers and embedded copy. It imports one Cockpit-specific child component, `apps/web/components/cockpit/GraduationVetoButton.tsx`, which is already scoped to the graduation/veto affordance and does not own the abstract overview/drill-down vocabulary. This BI therefore audits and refactors `page.tsx` plus the new render helpers; `GraduationVetoButton` remains in scope only if label wiring needs to pass through it.

Abstract terms are concentrated in:

| Area | Current source | Current vocabulary |
| --- | --- | --- |
| Header | inline JSX | "Reduction Gear Cockpit", "agentic gear train", "Phase 0 emits at Ring 1->2 only" |
| Interface list | `ALL_INTERFACES` local constant | "Ring 1->2 Coworker -> Workflow", "Ring 2->3 Workflow -> Archetype", etc. |
| Empty lanes | inline JSX | "pilot waiting on a completed Build Studio phase run", "emitter not active in Phase 0" |
| Metric labels | inline JSX | "outward", "inward", "torque", "slip", "cost", "Gear interfaces" |
| Slip rollup | inline JSX | raw `slipReason`, "Slip by reason" |
| Triple wear | inline JSX | raw `agentIdForTriple`, `capabilityName`, `archetypeContext`; heading "Triple wear" |
| Graduation panel | inline JSX | raw capability/archetype/agent IDs and "Ring N->M" |
| Recent events | inline JSX | raw ring, capability, source, actor, torque, outcome, grader |
| Footer | inline JSX | Phase 0 and old BI reference |

The page already follows the key data rule: it reads Cockpit aggregates from `apps/web/lib/gear-interface/query.ts` and does not reconcile source tables directly. This BI must preserve that.

### 3.2 Existing configuration sources

No new schema is required for the implementation slice.

| Need | Existing source | Notes |
| --- | --- | --- |
| Install/business identity | `Organization.name`, `Organization.slug`, `Organization.industry`, `StorefrontConfig.organization` | AGENTS.md identifies `Organization` as canonical for org identity. `StorefrontConfig` points to the active organization. |
| Portal identity | `StorefrontConfig` + `StorefrontArchetype.customVocabulary.portalLabel` | Storefront admin already resolves vocabulary through `getVocabulary(...)`. |
| Market vertical | `StorefrontConfig.archetypeId -> StorefrontArchetype` | The relation points to `StorefrontArchetype.id`; display should use `name`, `category`, and seeded/custom vocabulary. GearInterface `archetypeContext` stores semantic slugs in newer Ring 2+ paths. |
| Named coworker identity | `Agent.agentId`, `Agent.slugId`, `Agent.name`; fallback `packages/db/data/agent_registry.json` through `resolveCoworkerIdentity` | The database is best for render-time resolution. The registry resolver remains a fallback for seeded coworkers not present in the DB. |
| Raw gear readings | GearInterface query API | Data layer remains unchanged. |

### 3.3 Precedent

The Storefront surface already resolves configured vocabulary:

- `apps/web/app/(shell)/storefront/layout.tsx` loads `StorefrontConfig` with its archetype and calls `getVocabulary(...)`.
- `apps/web/lib/storefront/archetype-vocabulary.ts` merges category defaults with `StorefrontArchetype.customVocabulary`.
- `apps/web/lib/storefront/resolve-vocabulary.ts` chooses archetype category before organization industry.

The Cockpit should mirror that read-time translation pattern without moving vocabulary into GearInterface rows.

## 4. Research & Benchmarking

### 4.1 Open-source/operator UI precedents

- Grafana dashboard JSON data model separates dashboard metadata, panels, template variables, and panel queries. The data model precedent is that the dashboard shape and query contracts stay stable while variables scope the same panels to a selected context. Adopt the pattern of treating install context as a render-time variable layer, not as duplicated metric data. Source: https://grafana.com/docs/grafana/latest/reference/dashboard/
- Grafana variables are first-class dashboard inputs that can be reflected in URLs. Adopt URL-visible filter state for overview-to-drill paths so a metric click produces a shareable filtered GearInterface view. Source: https://grafana.com/docs/grafana/latest/visualizations/dashboards/variables/
- Kubernetes Dashboard organizes the Kubernetes API data model into resource categories such as workloads, services, storage, ConfigMaps, and namespaces. Adopt resource-specific labels and clear namespace scoping, but reject edit/create affordances in this read-first Cockpit slice. Source: https://kubernetes.io/docs/tasks/access-application-cluster/web-ui-dashboard/
- OpenSearch Dashboards uses index patterns and saved objects as explicit data bindings for visualizations and dashboards. Adopt explicit context/data binding and reject silent missing-index behavior by showing the Cockpit fallback banner when install identity is incomplete. Source: https://docs.opensearch.org/latest/dashboards/management/management-index/

### 4.2 Commercial/operator UI precedents

- Datadog dashboard template variables refine a dashboard without changing each widget. Adopt dashboard-level install and vertical context applied consistently across panels. Source: https://docs.datadoghq.com/dashboards/template_variables/
- New Relic dashboards support template variables to dynamically filter what dashboard users see. Adopt the same idea of stable panels with a visible context selector/label. Source: https://docs.newrelic.com/docs/query-your-data/explore-query-data/dashboards/manage-your-dashboard/
- Honeycomb query specifications are JSON query definitions reused by APIs, boards, triggers, and template links. Adopt the separation of query semantics from presentation labels. Source: https://honeycomb.mintlify.app/api/query-specification/

### 4.3 Adopted patterns

- Stable data/query model, dynamic label layer.
- Dashboard-level context state visible near the top of the viewport.
- Template/context labels should propagate to overview, drill-down rows, and empty/unknown states.
- Missing data or missing context must show an explicit empty/unknown state.

### 4.4 Rejected patterns

- No per-install hardcoded copy in JSX.
- No mutation of GearInterface rows to store display names.
- No hidden fallback to generic labels when install identity or archetype is absent.
- No broad dashboard personalization in this BI; this is organization-level vocabulary, not per-user preference.

### 4.5 Gap this design fills

The benchmark tools all support context-scoped dashboards, but none has DPF's exact split between a canonical mechanical substrate and install-native platform-operator vocabulary. This design fills that gap by keeping GearInterface as the raw diagnostic record while letting the Cockpit's nouns resolve from `Organization`, `StorefrontConfig`, `StorefrontArchetype`, and coworker identity sources at render time.

## 5. Design

### 5.1 Terminology layer

Create a render-layer module:

`apps/web/lib/cockpit/install-terminology.ts`

Primary responsibilities:

- Load install context for the Cockpit from existing tables.
- Build a deterministic `CockpitTerminology` object.
- Resolve a GearInterface-like row into display labels.
- Return explicit fallback state when required identity is missing.

Core API:

```ts
export async function getCockpitTerminology(): Promise<CockpitTerminology>;

export function resolveCockpitRowLabels(
  row: CockpitTerminologyRow,
  terminology: CockpitTerminology,
): CockpitResolvedLabels;
```

The first implementation slice resolves:

- Install name from `Organization.name`.
- Portal label from `getVocabulary(archetype.category, archetype.customVocabulary).portalLabel`.
- Coworker/team label from `getVocabulary(...).teamLabel`; this is an install vocabulary source, not a new field.
- Vertical label from `StorefrontArchetype.name`, then `StorefrontArchetype.category`, then `Organization.industry`.
- Coworker label from `Agent.name`/`Agent.slugId`/`Agent.agentId`, with registry fallback through `resolveCoworkerIdentity`.
- Archetype label from row `archetypeContext`, mapped through `StorefrontArchetype.archetypeId`, `category`, or `name` where possible.

### 5.2 Fallback contract

Terminology mode:

```ts
type CockpitTerminologyMode = "install-aware" | "abstract";
```

The page enters `abstract` mode if any required install context is missing:

- no `StorefrontConfig`
- no linked `Organization.name`
- no linked `StorefrontArchetype`

The banner copy:

> Install identity not configured - using abstract gear vocabulary. Configure it in Storefront setup.

The banner links to `/storefront/setup`.

Partial coworker resolution does not force page-level abstract mode. Unknown coworker IDs remain visible as IDs with an "unresolved coworker" marker because the install identity itself is still configured and the raw GearInterface record remains the audit anchor.

### 5.3 Interface label map

The canonical rings stay visible, but the operational label is install-aware:

| Interface | Abstract fallback | Install-aware label pattern |
| --- | --- | --- |
| 1->2 | Coworker -> Workflow | `{coworkerTeamLabel} -> {portalLabel} workflow` |
| 2->3 | Workflow -> Archetype | `{portalLabel} workflow -> {verticalLabel} capability` |
| 3->4 | Archetype -> Sandbox/Prod | `{verticalLabel} capability -> governed delivery` |
| 4->5 | Sandbox/Prod -> Hive | `governed delivery -> hive contribution` |

Each label still includes "Ring N->M" as the technical anchor.

`workflow`, `capability`, `governed delivery`, and `hive contribution` are acceptable platform-operator terms in this slice. They name DPF platform layers, not customer vertical nouns. Terms that describe the installed business, team, portal, archetype, or coworker must come from configuration or identity sources.

### 5.4 Overview copy

The header becomes:

- Title: `{installName} Cockpit`
- Subtitle in install-aware mode: `Operator diagnostic view for {portalLabel} across {verticalLabel} work - torque, slip, wear, cost, and graduations remain tied to GearInterface evidence.`
- Subtitle in abstract mode: current abstract wording plus the fallback banner.

Metric labels such as torque, slip, wear, cost, and graduation remain because they are the operator mechanical terms. Nouns around them become install-aware.

### 5.5 Drill-down slice

The first drill-down slice is the existing Recent transmissions table, but the implementation must make the overview-to-drill path real:

1. Overview metric links preserve `days`, `ring`, and `dir` in the URL.
2. The Recent transmissions table reads those query params and filters `listRecentGearInterfaceRows(window, filter, ...)`.
3. The table header shows the resolved interface label and the active filter state.
4. Each row links or exposes the `shaftSourceType` and `shaftSourceId` evidence anchor. If a source-event route is not available yet, the row must show `unknown source route` with the raw ID instead of pretending drill-through exists.

The drill-down consumes `resolveCockpitRowLabels(...)` for:

- ring/interface cell
- capability cell
- actor/coworker cell
- outcome/slip cell
- source title text where appropriate

The raw IDs remain available in `title` attributes or secondary muted text where they are evidence anchors.

### 5.6 Refactor allocation

At least 20% of implementation effort is allocated to refactoring before feature wiring:

- Extract pure formatting/color helpers from `page.tsx` into `apps/web/lib/cockpit/cockpit-formatting.ts`.
- Extract terminology resolution into a pure tested module.
- Keep `page.tsx` as orchestration: load data, load terminology, pass resolved labels into bands.

This is not a broad redesign. It reduces route-local glue so Phase 2 can harden drill paths without fighting a monolithic page.

## 6. Component Refactor Map

| File | Action | Responsibility |
| --- | --- | --- |
| `apps/web/lib/cockpit/cockpit-formatting.ts` | Create | `formatTorque`, `formatPercent`, `formatCost`, `torqueColor`, small summary helpers. |
| `apps/web/lib/cockpit/install-terminology.ts` | Create | Install context loading, terminology mode, row label resolution. |
| `apps/web/lib/cockpit/install-terminology.test.ts` | Create | Red/green tests for configured, cold-install fallback, coworker fallback, row label resolution. |
| `apps/web/app/(shell)/admin/cockpit/page.tsx` | Modify | Use helper modules, show fallback banner, apply install-aware labels in overview and recent transmissions. |
| `docs/superpowers/specs/2026-05-25-cockpit-terminology-reframe-design.md` | Create | This design/audit/ADR criteria. |
| `docs/superpowers/plans/2026-05-25-cockpit-terminology-reframe.md` | Create | Implementation plan. |

## 7. Testing

Unit tests:

- Configured install resolves `install-aware` mode and labels from `Organization`, `StorefrontConfig`, `StorefrontArchetype`, vocabulary, and agents.
- Cold install resolves `abstract` mode with missing-context reasons and fallback banner metadata.
- A row with `agentIdForTriple` matching `Agent.agentId` uses `Agent.name`.
- A row with only a registry match uses `resolveCoworkerIdentity`.
- Unknown coworker IDs remain visible and marked unresolved without forcing abstract mode.

Build/type checks:

- `pnpm --filter web exec vitest run apps/web/lib/cockpit/install-terminology.test.ts`
- `pnpm --filter web typecheck`
- `pnpm --filter web build`

UX verification:

- Docker-served `/admin/cockpit` on configured install.
- Docker-served `/admin/cockpit` on cold/partial install fallback.
- Desktop and mobile screenshots for overview and recent-transmissions drill-down.
- Confirm no new hardcoded color classes in Cockpit files.
- Seeded or fixture-backed data includes at least one transmission, one slip, one human-graded HITL record, and one graduation or veto row. If the live install cannot naturally produce one class in the verification window, the ADR must name the missing class and link the follow-on BI rather than treating screenshots as sufficient.
- For every visible overview metric, the ADR must either link to a filtered GearInterface table state or record the explicit `unknown` reason shown in the UI.

## 8. Sign-off ADR

Create an ADR after verification:

`docs/superpowers/decisions/2026-05-25-cockpit-terminology-reframe-signoff.md`

Required contents:

- Decision: render-time install terminology layer adopted for Cockpit.
- Evidence: configured-install screenshot paths, fallback screenshot paths, focused unit tests, typecheck, production build, seeded/fixture-backed transmission/slip/HITL/graduation-or-veto coverage, overview-to-drill URL, and source-evidence/unknown proof.
- Consequences: GearInterface rows remain canonical/raw; Cockpit copy is install-aware where context is available; unresolved coworker IDs remain observable.
- Follow-ons: any remaining Cockpit panels still using raw abstract strings after this slice.

## 9. Out of Scope

- Removing gear language from the Cockpit entirely.
- Changing `apps/web/lib/gear-interface/` data contracts.
- Adding schema fields for install identity, vertical, or coworker names.
- Per-user Cockpit terminology preferences.
- Worker workspace home vocabulary.
- External customer portal vocabulary.

## 10. Implementation Slice Acceptance

The branch is ready for PR only when:

- This spec and the implementation plan are committed.
- The terminology layer is unit-tested.
- Cockpit overview and Recent transmissions consume install-aware labels.
- Cold-install fallback banner appears when config is missing.
- Tests, typecheck, production build, and UX verification evidence are recorded on BI-19D40BE7.
- The BI body is updated only through governed MCP tools.
