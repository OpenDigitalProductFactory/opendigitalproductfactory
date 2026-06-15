# AI Operations Map - Three-Band Cohesive Layout - Design

| Field | Value |
|-------|-------|
| Status | Draft, second architect/UX-fit review 2026-06-05 |
| Created | 2026-06-05 |
| Owner | Platform / AI Operations |
| Parent | `EP-AI-OPSMAP`; `BI-65B0D697` |
| Related work | `EP-A2A`; `BI-9DB7C332`; `BI-8DF5E740` |
| Surface | `/platform/ai/operations-map`, `apps/web/components/platform/AiOperationsMap.tsx`, `A2aInteractionsPanel.tsx`, `a2a-interaction-graph.ts`, `ai-operations-map-prefs.ts`, `apps/web/lib/ai-operations-map/*` |
| Predecessor specs | `docs/superpowers/specs/2026-06-04-ai-operations-map-a2a-interaction-visibility-design.md`; `docs/superpowers/specs/2026-06-05-deliberation-branch-identity-for-a2a-ops-map-design.md` |

## 0. Architect Review Summary

The coworker-spine idea is the right final geometry: coworkers are the one shared axis between A2A interactions and provider routing. The original draft was directionally strong, but it was stale against the worktree. It treated several already-landed behaviors as future work and did not define a hard enough parity gate for replacing two verified panels with one canvas.

This revision makes the plan implementation-ready:

1. Keep the work in the existing AI Operations Map route. Do not create a new route, graph subsystem, data source, table, or map-only event store.
2. Treat the remaining work as a render refactor, not an A2A data or capture project.
3. Build the unified canvas additively and cut over only when provider, A2A, replay, inspector, accessibility, and responsive parity are proven.
4. Keep deliberation as the sibling lens until branch persona identity is represented by a real agent id or an authoritative event source.
5. Spend the requested refactoring budget on pure layout helpers, parity tests, duplicated SVG/control extraction, and deletion of retired panels after cutover.

The recommended first implementation sequence is Stage 0, then Stage A: freeze the current behavior with parity fixtures, then extract the pure spine/layout model. If the diff stays small, these can land together; if not, Stage 0 is the smallest safe first PR. Do not start by moving SVG markup around.

Second-pass tightening:

- The plan now treats this as `fits-with-guardrails` for the existing Platform > AI Operations route, not as a new dashboard or navigation surface.
- Saved-view and local-storage boundaries are explicit: current saved views persist projection filters only; unified topology controls need a versioned extension if they join saved views.
- Layout success is measurable: row order stability, parity fixture counts, focusability, density behavior, and desktop/mobile no-overlap evidence.
- The implementation sequence now has a mergeable first PR path that does not expose a second canvas to operators.

## 1. Current Repo Truth

Verified 2026-06-05 in `D:\DPF\.claude\worktrees\admiring-wescoff-cd6a30`.

### 1.1 Worktree and backlog state

- The worktree is on `claude/a2a-ops-map-three-band-design` and is behind `origin/main` by 12 commits at second review time. Re-sweep before implementation PR.
- This spec file is currently untracked in the worktree, so it was not returned by `search_specs_and_plans`.
- Live MCP epic state: `EP-AI-OPSMAP` is open with 17 items total, 4 open, 2 in progress, and 5 done.
- Live MCP knowledge search identifies `BI-65B0D697` as the relevant item: "AI Operations Map - coworker-to-coworker (A2A) interaction visibility re-architecture".
- Live MCP knowledge search also identifies `BI-8DF5E740`: "Deliberation branch identity + Ops-Map overlap reconciliation for A2A deliberation edges". That item owns the deliberation-branch identity gap; this layout slice must not absorb it.

### 1.2 Rendering state

The map is not yet one cohesive canvas. It is two working map bands under one route:

- `AiOperationsMap.tsx` owns the shell, dimension toggle, provider routing panel, A2A panel, deliberation lens, activity projection details, and replay handoff.
- `RoutingTopologyPanel` is still a function inside `AiOperationsMap.tsx`.
- `A2aInteractionsPanel.tsx` is a separate component rendered below the provider panel.
- `OperationsTopologyCanvas` and `buildCoworkerSpine` do not exist yet.

Already implemented and should not be re-planned as future scope:

- Provider/A2A/Both dimension toggle.
- Dimension preference persistence under `ai-operations-map:dimension`.
- A2A filter persistence under `ai-operations-map:a2a`.
- Saved Operations Map view storage under `ai-operations-map:saved-views` for the projection filters.
- Shared replay playhead from provider routing to A2A.
- A2A authority filter.
- A2A report-kit `StatCard` and `StatusBadge`.
- A2A shared `LocalTime` usage.
- `a2aInteraction` status intent in `statusColors.ts`.
- Pure A2A graph helpers in `a2a-interaction-graph.ts`.

The remaining UI gap is spatial coherence, not basic A2A visibility or filter plumbing.

Preference boundary:

- `ai-operations-map:view` stores projection quick-view/source/severity filters.
- `ai-operations-map:saved-views` stores named projection-filter presets.
- `ai-operations-map:dimension` stores Provider/A2A/Both focus.
- `ai-operations-map:a2a` stores A2A type/state/actor/authority filters.
- Today, saved operator views do not own the topology dimension, provider filters, replay window, or A2A filters. Stage D must either keep that boundary or introduce a versioned saved-view payload with migration tests.

### 1.3 Projection and schema state

The data shape is already migration-free and should stay that way for this slice:

- `load-map-data.ts` reads `DelegationChain`, `PhaseHandoff`, and `TaskRun` lineage, then projects them through `project-a2a-interactions.ts`.
- `project-a2a-interactions.ts` is pure and emits `OperationsMapA2aEdge`, contributed coworker nodes, A2A timeline markers, and A2A legend items.
- `load-map-data.ts` merges A2A timeline markers with provider routing timeline markers.
- `TaskNode` has `workerRole`, `status`, `routeDecision`, and `deliberationRunId`, but no branch coworker `agentId`.
- `DeliberationRun` is therefore shown through `DeliberationLensPanel`, not as coworker-to-coworker A2A edges.

This spec must not promise deliberation branches on the spine until `BI-8DF5E740` or an equivalent capture source lands.

## 2. Problem and UX Fit

### 2.1 Problem

The Operations Map now answers both questions separately:

- Which coworker routed work to which provider?
- Which coworker delegated, handed off, or spawned work to which coworker?

It still makes the operator learn two spatial maps. A coworker can appear in the provider topology at one vertical position and in the A2A panel at another. That disconnect hides the most valuable mental model: "this coworker took part in peer work on the left, then routed to or depended on providers on the right."

The final layout should make one coworker row mean one coworker across both kinds of activity.

### 2.2 UX fit decision

Decision: `fits-with-guardrails`.

| UX-fit axis | Decision |
|---|---|
| Owning area | Platform |
| Route family | Existing `/platform/ai/operations-map` |
| Primary persona | Founder/operator or platform operator troubleshooting AI workforce behavior |
| Navigation layer | Local page controls only: dimension, filters, replay, inspector |
| Reuse/convergence | Reuse existing Operations Map projection, report-kit primitives, token styling, and current preference helpers |
| Source truth | Existing `load-map-data.ts` read model and `routingTopology` projection |
| Empty/failure behavior | Honest empty states for no A2A rows, no provider routes, missing source links, and sparse installs |
| AI boundary | No coworker prompt send or action launcher in this slice; graph controls are read-only inspection controls |

Guardrails:

- No new global nav, section nav, or route.
- No marketing-style hero, overview cards, or explanatory onboarding surface.
- No new KPI/status/filter primitive unless it retires duplication or fills a real report-kit gap.
- The first viewport remains the operational map, not a stack of dashboard cards.
- Copy should describe operator work: provider route, coworker interaction, replay, source record, authority. Avoid implementation-phase labels in the UI.

## 3. Target Geometry

The final map is one SVG topology canvas with three coordinated regions:

```text
 A2A interaction space        coworker spine        provider routing space
 coworker -> coworker         one row per coworker  coworker -> provider

 left-bulging arcs            centered nodes        right-bulging routes
 delegation / handoff         stable labels         provider paths / markers
 task lineage                 selected row          route decisions / failures

 shared replay timeline below the topology
 shared inspector outside the topology
```

Rules:

- Coworker rows are computed once from the union of provider-routing coworkers and A2A participants.
- Provider-only mode renders the spine and right side.
- A2A-only mode renders the left side and spine.
- Both mode renders left, spine, and right.
- Deliberation stays a sibling lens until branch nodes have truthful coworker identity.
- Custom SVG remains appropriate because report-kit `Chart` is not a graph-topology primitive.
- Reporting widgets around the graph still use report-kit primitives.

The spine is not a new source of truth. It is a layout projection of `routingTopology.coworkers`, `routingTopology.routes`, `routingTopology.markers`, `routingTopology.a2aEdges`, `routingTopology.timeline`, and `routingTopology.deliberations`.

## 4. Research and Standards

Internal standards:

- `AGENTS.md` requires theme-aware CSS variables, report-kit for reporting/data display, no hardcoded colors, and canonical-runtime UX verification for UI work.
- `apps/web/components/ui/report-kit/README.md` defines the shared palette for `StatusBadge`, `StatCard`, `FilterBar`, `DataTable`, `ExportButton`, `Chart`, and `statusColors`.
- `docs/platform-usability-standards.md` requires WCAG 2.2 AA contrast, token-backed UI roles, and visible focus behavior.
- MCP design-intelligence searches for graph/topology dashboard guidance returned no curated match, so this plan falls back to DPF standards plus web accessibility standards rather than importing a new design dialect.

External standards:

- [W3C SVG accessibility support](https://www.w3.org/TR/SVG/access.html) supports using SVG semantics with accessible names, descriptions, ARIA relationships, and keyboard event support where the SVG is interactive.
- [WCAG 2.2](https://w3c.github.io/wcag/guidelines/22/) applies to the topology controls and interactive graph targets, especially text alternatives, keyboard operability, focus visibility, contrast, and target size.

Adopted:

- Interactive SVG edges and nodes need accessible names and keyboard selection.
- Color cannot be the only channel; edge kind and state need text, shape, dash, marker, or inspector reinforcement.
- Focus targets must be stable and visible across desktop and mobile viewports.
- The canvas needs a non-graph fallback path through the inspector/source-record details.

Rejected:

- A charting library for the topology. The existing custom SVG gives tighter control over graph semantics and parity with the current provider map.
- Decorative graph polish that makes the map feel richer while weakening source-record traceability.
- A new dashboard/component family for counts, badges, tables, or filters.

## 5. Architectural Decision

Adopt an additive unified-canvas strategy with parity gates.

Rejected options:

- Direct one-shot replacement: too much blast radius for a working provider topology and working A2A panel.
- Keep separate panels indefinitely: safest technically, but it leaves the core UX problem unsolved.

Accepted shape:

- Add `OperationsTopologyCanvas` alongside the old panels.
- Extract pure layout helpers before moving markup.
- Keep the old panels as the shipped surface until all parity gates pass.
- Cut over in one small PR after parity evidence exists.
- Delete retired panel code in the same or immediately following PR so the project does not keep two permanent visual systems.

The kernel scorer was attempted for this trade-off, but the run returned an all-zero tie. This document therefore records the decision from repo evidence and DPF doctrine rather than misrepresenting that tool output as a recommendation.

## 6. Non-Goals

- No schema changes.
- No new route.
- No new A2A capture table or event source.
- No new persisted operator preference shape unless the existing keys cannot carry the required state.
- No public A2A protocol implementation.
- No fake/sample graph data in the live map.
- No deliberation branch edges until truthful branch agent identity exists.
- No permanent feature flag or hidden second implementation after cutover.

## 7. Implementation Plan

### Stage 0 - Freeze parity baseline

Purpose: protect what already works before the render refactor begins.

Work:

- Add or strengthen source-local tests that count current provider routes, route markers, route filters, provider filters, replay markers, A2A edges, A2A filters, authority filter behavior, A2A replay sync, inspector content, and empty states.
- Add a deterministic fixture builder for a map with:
  - at least 3 coworkers;
  - at least 2 providers;
  - active, failover, scheduled, and historical routes;
  - delegation, handoff, and task-lineage A2A edges;
  - at least one marker without a coworker id to preserve the existing "Coworker missing" handling.
- Record current desktop and mobile screenshots from the canonical runtime or local-CI convergence sandbox before cutover work begins.

Exit gate:

- Current panels are tested enough that the unified canvas can prove parity without relying on human visual memory.

Merge posture:

- This is the smallest safe first PR if Stage A would make the opening diff too large.
- It should not add `OperationsTopologyCanvas` to the operator-visible route.
- It may add fixture builders and tests, but it should leave runtime behavior unchanged.

### Stage A - Pure layout model

Purpose: create the shared coworker spine without changing the visible UI.

Add `apps/web/components/platform/operations-topology-layout.ts` with pure helpers:

- `buildOperationsTopologyLayout(input)`
- `buildCoworkerSpine(input)`
- `layoutProviderRoutes(input)`
- `layoutA2aEdges(input)`
- `layoutTopologyTimeline(input)`
- `measureTopologyDensity(input)`

Inputs:

- `coworkers`
- `providers`
- `routes`
- `markers`
- `a2aEdges`
- current filters
- replay range/playhead
- viewport bucket

Outputs:

- stable coworker row order;
- row y positions;
- left arc lanes;
- right route lanes;
- provider node positions;
- marker anchors;
- timeline anchors;
- density warnings.

Rules:

- Preserve provider topology labels when a coworker exists in both provider and A2A data.
- Add A2A-only coworkers to the spine without fabricating provider routes.
- Prefer stable row order: selected/active rows first, then coworkers with visible edges, then alphabetical label fallback.
- Never let filter changes reorder rows unless the filtered row set actually changes.
- Reuse the same row id for the same coworker across Provider, A2A, and Both modes.
- Return explicit layout metadata for overlap/density warnings rather than letting the component infer crowded state from DOM after render.
- Density warnings are data for UI decisions, not console noise.

Exit gate:

- Pure tests cover ordering, duplicate coworkers, A2A-only coworkers, provider-only coworkers, replay-filtered edges, long labels, and high-density cases.
- Row y positions are deterministic for a fixed input fixture.
- Minimum row gaps and lane spacing are asserted in pure tests before browser screenshots become the only guard.

### Stage B - Unified canvas provider side

Purpose: prove the new canvas can render the existing provider topology before adding the A2A half.

Work:

- Add `OperationsTopologyCanvas.tsx`.
- Render the coworker spine and provider routing side using the Stage A layout.
- Reuse existing provider route semantics:
  - route state labels;
  - route style/dash;
  - route aggregation;
  - provider type filter;
  - provider filter;
  - marker glyphs;
  - marker popover;
  - replay timeline;
  - zoom controls.
- Keep `RoutingTopologyPanel` live.
- Hide the new canvas from ordinary operators until parity is proven. If an internal switch is needed, it must be temporary and removed at cutover.

Exit gate:

- Provider route count, marker count, visible provider/coworker sets, replay behavior, zoom behavior, keyboard behavior, and empty states match the old provider panel.
- Desktop and mobile screenshots show no clipping, overlap, or illegible labels.

### Stage C - Unified canvas A2A side

Purpose: add left-side A2A arcs onto the same coworker rows.

Work:

- Reuse A2A state intent, dash, width, source-record, authority, and replay helpers from `a2a-interaction-graph.ts` or move them into a shared topology helper if both panels need them during transition.
- Render left-bulging A2A arcs from/to the same spine rows used by provider routes.
- Preserve current A2A filters and `ai-operations-map:a2a` preference behavior.
- Preserve `StatusBadge`, `StatCard`, `LocalTime`, `statusColors`, and honest source-record behavior.
- Keep `DeliberationLensPanel` outside the spine.

Exit gate:

- A2A edge count, filters, authority filtering, replay sync, inspector content, source-record rendering, and empty state match the old A2A panel.
- Edge kind is distinguishable without color.
- Keyboard selection works for every visible edge.

### Stage D - Unified controls and inspector

Purpose: make the unified topology feel like one tool, not two panels packed into one SVG.

Work:

- Keep the existing Provider/A2A/Both dimension toggle.
- Consolidate provider and A2A controls into one local control rail without adding a new global nav or route.
- Keep high-density controls compact:
  - top-level dimension;
  - route state;
  - provider type/provider;
  - A2A type/state/authority/coworker actor;
  - reset view;
  - replay scale.
- Move inspector behavior to one details surface that can describe either provider route/marker or A2A edge.
- Use report-kit `FilterBar` only where it fits the facet model. Do not force graph-specific controls into a table-filter component if a segmented/icon control is clearer.

Saved-view decision for Stage D:

- Default: preserve the current storage split and do not broaden saved views.
- If operator saved views should capture topology state, add a versioned saved-view payload rather than stuffing extra fields into the existing projection-only shape.
- A versioned saved view must include migration/fallback behavior for older localStorage entries.
- Do not make the unified canvas depend on saved-view expansion; topology parity should ship independently.

Exit gate:

- Existing tests for dimension toggle, view reset, saved view persistence, replay, and inspector behavior remain green.
- Operator can narrow the same scenario in Provider, A2A, and Both modes without losing context.

### Stage E - Cutover and delete

Purpose: ship the cohesive map and remove the temporary fork.

Work:

- Switch the default render path to `OperationsTopologyCanvas`.
- Delete `RoutingTopologyPanel` only after its behavior is represented by the new canvas.
- Delete or shrink `A2aInteractionsPanel` only after its behavior is represented by the new canvas.
- Keep pure helpers and tests.
- Update predecessor docs or cross-links only if they would otherwise point at obsolete panel names.

Exit gate:

- No operator-visible route exposes both the old panel stack and the new canvas.
- No permanent feature flag remains.
- Diff removes enough retired rendering code to offset the new abstraction.

## 8. Refactoring Budget

Reserve roughly 20% of implementation effort for refactoring, but spend it narrowly.

Allowed refactoring:

- Extract pure layout math and edge styling from component files.
- Consolidate duplicated SVG interaction handlers.
- Keep status intent mapping in `statusColors.ts`.
- Keep time display on `LocalTime`.
- Keep reporting counts/badges on report-kit.
- Create focused fixture builders for provider/A2A parity tests.
- Delete retired panel code at cutover.

Not allowed under the refactoring budget:

- Reworking `load-map-data.ts` beyond import/type shape needed by the canvas.
- Renaming public route labels.
- Moving Operations Map IA.
- Inventing new domain models.
- Repainting the surface outside DPF tokens.
- Expanding into the wider provider routing subsystem.

## 9. UI and Accessibility Requirements

This is an operational tool, not a landing page. It should be dense, quiet, and built for repeated troubleshooting.

Mandatory:

- All colors use `--dpf-*` tokens or report-kit intents.
- No raw hex, `text-white`, `bg-white`, one-off status color map, or local severity palette.
- SVG edges and nodes have accessible names that include endpoint(s), kind, state, and summary.
- Every interactive graph element is keyboard selectable.
- Focus outlines are visible and not clipped by the SVG viewport.
- Hit targets for buttons/sliders/reset controls meet WCAG 2.2 expectations.
- Long coworker/provider labels truncate visually but appear fully in inspector/source detail.
- Mobile layout stacks controls without overlapping the canvas or hiding the inspector.
- Color is never the only channel for route state or A2A state.
- Empty, no-permission, and sparse-data states are honest and do not render fake activity.

Graph-specific:

- At high density, aggregate or fold visually before labels overlap.
- Provide a clear density warning or "narrow filters" affordance when both sides are too crowded.
- Keep replay timeline controls outside the most crowded graph area.
- Preserve the existing router audit/unattributed-marker semantics.

## 10. Data and Source-Truth Rules

The unified canvas is a presentation layer over existing source truth:

| Visible item | Source truth |
|---|---|
| Provider nodes | `ModelProvider`, endpoint/model profiles, MCP servers through existing routing projection |
| Provider route edges | `RouteDecision`, token usage, route outcomes, schedules, and existing topology projection |
| Provider markers | Existing routing marker projection |
| Coworker nodes | Union of registered agents already projected for Operations Map and A2A-contributed coworkers |
| A2A delegation edges | `DelegationChain` |
| A2A handoff edges | `PhaseHandoff` |
| A2A task-lineage edges | `TaskRun` parent/initiating/current agent fields |
| Deliberation summary | `DeliberationRun` plus branch `TaskNode` role/status/model-provider projection |
| Deliberation A2A edges | Out of scope until branch agent identity exists |
| Timeline | Existing provider timeline plus A2A timeline markers from source rows |

No item on the graph may be sourced from a hand-authored sample list in the component.

## 11. Verification Plan

### 11.1 Layout acceptance criteria

For the canonical parity fixture:

- Provider route count, marker count, visible provider count, and visible coworker count match the existing provider panel.
- A2A edge count, state counts, and authority-filtered counts match the existing A2A panel.
- The same coworker id maps to the same spine row in Provider, A2A, and Both mode unless the coworker is filtered out.
- No visible label or focus ring overlaps another control or graph element at desktop and mobile viewports.
- Long coworker/provider names truncate only in the canvas and appear fully in the inspector or source detail.
- Keyboard traversal reaches dimension controls, route/provider filters, A2A filters, replay controls, graph selections, inspector, and reset controls.
- Density warnings appear before graph elements overlap; they offer a filter/collapse path rather than silently degrading.
- Empty-state fixtures cover no provider routes, no A2A rows, sparse coworkers, and missing source-record hrefs.

Source-local gates in the worktree:

- `pnpm --filter web exec vitest run components/platform/a2a-interaction-graph.test.ts`
- `pnpm --filter web exec vitest run components/platform/A2aInteractionsPanel.test.tsx`
- `pnpm --filter web exec vitest run components/platform/AiOperationsMap.test.tsx`
- `pnpm --filter web exec vitest run lib/ai-operations-map`
- `pnpm --filter web typecheck`

Runtime-bound gates on the canonical local install or shared local-CI convergence sandbox:

- `pnpm --filter web build`
- Exercise `/platform/ai/operations-map`.
- Verify Provider, A2A, and Both modes.
- Verify route/provider filters and A2A type/state/authority/coworker filters.
- Verify shared replay changes both sides in Both mode.
- Verify inspector for provider marker, provider route, A2A edge, empty state, and missing source link.
- Verify desktop and mobile viewports for no overlap, no clipped focus rings, and no illegible text.
- Verify keyboard navigation through dimension controls, filters, timeline, and graph selections.

If the install lacks live A2A rows:

- Prefer generating a real `PhaseHandoff`, `DelegationChain`, or `TaskRun` lineage through an existing platform flow.
- If that is not feasible in the verification window, record canonical runtime evidence for empty state plus source-local fixture parity, and leave live-edge runtime proof open.

Completion cannot be claimed from source-local tests alone.

## 12. Coordination

Before implementation PR:

- Re-sweep `origin/main` because this worktree is behind by 12 commits at second review time.
- Search open PRs and recent mainline changes for:
  - `AiOperationsMap.tsx`
  - `A2aInteractionsPanel.tsx`
  - `a2a-interaction-graph.ts`
  - `ai-operations-map-prefs.ts`
  - `load-map-data.ts`
  - `project-a2a-interactions.ts`
  - `project-deliberations.ts`
- Confirm `BI-65B0D697` is still the parent work item.
- Confirm `BI-8DF5E740` still owns deliberation branch identity.
- Do not file another AI Operations Map epic or backlog item unless live MCP shows the current item was closed or superseded.

## 13. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| The unified canvas regresses provider routing. | Stage B proves provider parity before A2A is added. Old panel remains live until cutover. |
| The unified canvas regresses A2A filters, replay, or inspector behavior. | Stage C consumes existing A2A helpers and tests; old panel remains live until parity passes. |
| One canvas becomes visually crowded. | Stage A includes density measurement; Stage D includes folding/aggregation and dimension collapse behavior. |
| The plan drifts into data-model work. | Source-truth table is explicit: no migrations and no new event source in this slice. |
| Deliberation branches are misrepresented as coworkers. | Keep deliberation as sibling lens until branch agent identity exists. |
| Two visual systems survive permanently. | Stage E requires deletion of old panel code or a documented reason it remains as shared subcomponents. |
| Structural tests pass but UX is broken. | Canonical-runtime or local-CI convergence sandbox browser verification is part of definition of done. |

## 14. Definition of Done

This backlog item is complete when:

- The AI Operations Map has one cohesive topology canvas with A2A space, coworker spine, provider routing space, and shared replay timeline.
- Provider, A2A, and Both dimension modes all use the same canvas.
- Existing provider routing behavior is preserved.
- Existing A2A behavior is preserved.
- Deliberation remains truthful: sibling lens unless real branch coworker identity exists.
- All status/count/filter/time display uses DPF tokens and report-kit primitives where those primitives fit.
- Source-local tests and typecheck pass in the worktree.
- Production build and UX verification pass on the canonical local install or shared local-CI convergence sandbox, with desktop and mobile evidence.
- Retired panel code is deleted or converged into shared subcomponents, not left as a permanent second implementation.

## 15. Recommendation

Proceed with Stage 0 + Stage A first. That gives the next implementer a low-risk, testable foundation and spends the refactoring budget where it matters: layout math, stable fixtures, and parity gates. Stage B can then prove provider parity before the A2A side joins the canvas. A one-shot visual rewrite would be faster to type and slower to trust.
