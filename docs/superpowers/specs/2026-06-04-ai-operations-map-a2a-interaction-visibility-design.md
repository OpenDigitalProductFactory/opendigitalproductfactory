# AI Operations Map - Coworker-to-Coworker (A2A) Interaction Visibility - Design

| Field | Value |
|-------|-------|
| **Status** | Reviewed and implementation-aligned (2026-06-05) |
| **Created** | 2026-06-04 |
| **Last review** | 2026-06-05 architecture/UI/spec pass |
| **Owner** | Platform / AI Operations |
| **Surface** | `/platform/ai/operations-map`, `apps/web/lib/ai-operations-map/*`, `apps/web/components/platform/AiOperationsMap.tsx`, `apps/web/components/platform/A2aInteractionsPanel.tsx` |
| **Parent epic / item** | `EP-AI-OPSMAP`; `BI-65B0D697` ("AI Operations Map - coworker-to-coworker (A2A) interaction visibility re-architecture") |
| **Related live work** | `EP-A2A`; `BI-9DB7C332` ("Multi-agent collaboration & visibility - user-facing handoff/summon + pattern lens") owns the runtime/capture side |
| **Related specs/plans** | `docs/superpowers/specs/2026-04-23-a2a-aligned-coworker-runtime-design.md`, `docs/superpowers/specs/2026-05-10-ai-coworker-visual-control-surface-design.md`, `docs/specs/routing-resilience-and-failure-observability-spec.md`, `docs/superpowers/plans/2026-05-13-ai-routing-topology-map.md`, `docs/superpowers/plans/2026-06-04-ai-operations-map-a2a-interaction-visibility.md` |
| **Backlog posture** | Live MCP check on 2026-06-05: do not file a duplicate. `BI-65B0D697` is already open under `EP-AI-OPSMAP`; `BI-9DB7C332` is in progress under `EP-A2A` and should remain the coordination point for capture/runtime enrichment. |

## 0. Architecture Review Summary

The current direction is architecturally sound: A2A visibility belongs in the existing AI Operations Map as a read/projection/render slice, not as a new route or a new database subsystem. The important correction is scope honesty. The first implementation increment already landed a migration-free typed-edge substrate and a separate A2A panel, but it has not yet completed the original three-band shared layout, replay-window composition, persisted A2A filter preferences, source-record click-through for every edge type, or live-edge verification on the canonical runtime.

This spec therefore treats the work as a staged re-architecture:

| Layer | Current repo truth | Target contract |
|---|---|---|
| Topology data model | `types.ts` now has `OperationsMapA2aEdge`, `OperationsMapA2aEdgeKind`, `a2aEdges`, and `a2aLegend`; provider routes remain `OperationsMapRoutingRoute`. | Keep provider routes stable while making A2A edges first-class typed coworker-to-coworker edges. |
| Projection | `project-a2a-interactions.ts` exists and is pure; `load-map-data.ts` wires `DelegationChain`, `PhaseHandoff`, and `TaskRun` lineage. Deliberation projection exists as a pure function path, but the loader passes `deliberations: []` because `TaskNode` currently has branch role/status but no branch agent id. | Compose every stable A2A source without a migration. Wire deliberation fan-out only when branch-persona agent identity exists or an equivalent runtime event source lands. |
| Rendering | `A2aInteractionsPanel.tsx` renders a separate coworker-to-coworker interaction panel below the provider routing panel. It has type/state/coworker filters and an inspector. | Evolve toward a cohesive operations view: A2A interaction band, provider-routing band, shared timeline, shared filter state, and consistent inspector behavior. |
| UI system | The first panel uses DPF tokens, keyboard-selectable SVG paths, and readable empty states. It still uses local `Stat`/chip primitives, local state-color mapping, and `Intl.DateTimeFormat` directly. | Reserve refactoring capacity to fold status/count/filter/time display onto report-kit/status intent/`LocalTime` patterns where they fit, while keeping the custom SVG graph for the interaction topology. |

The governing decision remains: compose existing substrate before adding tables. This protects the parallel `EP-A2A` capture thread and keeps v1 implementation narrow, reviewable, and truthful.

## 1. Problem

The Operations Map can already explain provider routing: which coworker routed to which provider, which provider failed, what fallback occurred, and what the recent routing window looked like. It does not yet answer the A2A operational questions:

- Which coworker delegated work to another coworker, and why?
- Which Build Studio phase was handed from one coworker to the next, and what gate result governed it?
- Which task run spawned or shifted work from an initiating/parent coworker to the acting coworker?
- Which deliberation fanned work out to peer-review personas, and which branch roles participated?
- For any of those interactions, what authority, status, source record, and evidence can the operator inspect after the fact?

This is not just a missing filter. The provider-routing topology was originally a two-lane bipartite graph: coworker nodes on one side, provider nodes on the other, and every path shaped as coworker -> provider. A2A edges have two coworker endpoints, so they require an explicit typed-edge model and a rendering grammar that does not pretend every edge has a provider.

## 2. Current Repo and Substrate Truth

### 2.1 Rendering and Projection Surfaces

Verified in `claude/admiring-wescoff-cd6a30` on 2026-06-05:

| Surface | Current truth |
|---|---|
| `apps/web/components/platform/AiOperationsMap.tsx` | 2605 lines. Renders the existing `RoutingTopologyPanel`, then the new `A2aInteractionsPanel`. Provider-routing layout is still preserved. |
| `apps/web/components/platform/A2aInteractionsPanel.tsx` | 585 lines. New client component for visible A2A interactions, local filters, local summary counts, SVG edge band, and inspector. |
| `apps/web/lib/ai-operations-map/types.ts` | Extended with A2A edge/legend types and `a2aEdges`/`a2aLegend` on `OperationsMapRoutingTopology`. |
| `apps/web/lib/ai-operations-map/project-a2a-interactions.ts` | Pure projector for delegation, handoff, task lineage, and deliberation-shaped input DTOs. No Prisma or React imports. |
| `apps/web/lib/ai-operations-map/load-map-data.ts` | Fetches `DelegationChain`, `PhaseHandoff`, and lineage-relevant `TaskRun` rows, then merges the A2A projection into the existing routing topology. Deliberation wiring is intentionally deferred. |
| `apps/web/components/ui/report-kit/README.md` | Canonical reporting/data-display palette: `StatusBadge`, `StatCard`, `FilterBar`, `DataTable`, `ExportButton`, `Chart`, `statusColors`, and `LocalTime` guidance. |

### 2.2 A2A Substrate

The platform already persists enough data to render useful A2A visibility without a migration. The table below separates what is wired now from what is future-ready.

| Model | A2A-relevant fields | Edge yielded | Loader status |
|---|---|---|---|
| `DelegationChain` | `fromAgentId`, `toAgentId`, `skillId`, `status`, `reason`, `chainId`, `depth`, `parentLinkId`, `authorityScope[]`, `originUserId`, `originAuthority[]`, `startedAt`, `completedAt` | `a2a-delegation`: explicit coworker -> coworker delegation with authority envelope and status. | Wired in `load-map-data.ts`. |
| `PhaseHandoff` | `fromAgentId`, `toAgentId`, `fromPhase`, `toPhase`, `summary`, `buildId`, `gateResult`, `tokenBudgetUsed`, `iterationCount`, `createdAt` | `a2a-handoff`: Build Studio phase handoff with gate context. | Wired in `load-map-data.ts`; explicit gate failure maps to `blocked`, otherwise recorded handoffs map to `completed`. |
| `TaskRun` | `initiatingAgentId`, `currentAgentId`, `parentTaskRunId`, `a2aMetadata`, `source`, `status`, `contextId`, `threadId`, `buildId`, `title`, `objective`, `startedAt`, `completedAt` | `a2a-task-lineage`: initiating/parent coworker -> current coworker when distinct. | Wired in `load-map-data.ts`; parent agent is resolved from the fetched task-run set when available. |
| `DeliberationRun` + `TaskNode` | `DeliberationRun.taskRunId`, `consensusState`, `diversityMode`, `adjudicationMode`; branch `TaskNode.workerRole`, `influenceLevel`, `status` | Target `a2a-deliberation`: coordinator -> branch persona. | Not loader-wired yet. `TaskNode` has branch role/status but no branch-persona `agentId`, so rendering this as agent-to-agent would currently fabricate identity. |
| `AgentThread` | `parentThreadId`, `childCount`, `cancelledAt` | Secondary corroboration for thread spawning lineage. | Not a primary v1 edge source; agent attribution should come through `TaskRun` or future capture events. |

Conclusion: v1 remains migration-free, but the definition of "v1" must not promise deliberation fan-out until branch identity exists. This is an architecture integrity constraint, not a UI nicety.

### 2.3 Boundary With the A2A Capture Thread

`EP-A2A` / `BI-9DB7C332` owns richer capture semantics: handoff/summon UX, runtime event enrichment, A2A metadata, and any future event rows. This spec owns the read/projection/render path for Operations Map visibility.

Rules:

- This slice must not add a parallel A2A event table unless the capture thread explicitly establishes it as the canonical source.
- `a2aMetadata` is a forward-compatible enrichment slot, not a required v1 dependency.
- When the capture thread lands richer events, add one projector input path. Do not replace `DelegationChain`, `PhaseHandoff`, and `TaskRun` projections unless the new source is declared authoritative.
- Before push/PR, re-sweep `origin/main`, open PRs, `EP-AI-OPSMAP`, and `EP-A2A` for overlap.

## 3. Research and Benchmarking

### 3.1 A2A Protocol

Primary sources:

- [A2A latest specification](https://a2a-protocol.org/latest/specification/)
- [A2A upstream specification repository](https://github.com/a2aproject/A2A/blob/main/docs/specification.md)

Relevant standard pressure:

- A2A defines task-native communication around `Task`, `Message`, `Artifact`, `Part`, status updates, artifact updates, task lookup, task cancellation, and task subscription.
- The current spec supports blocking and non-blocking send behavior; async callers are expected to poll, subscribe, or receive push notifications.
- `Message` and `Artifact` are distinct payload concepts. DPF should not collapse coworker interaction visibility into chat text or provider logs.

Adopted for this spec:

- DPF maps A2A-like work identity to `TaskRun`, not to a new map-only concept.
- DPF maps interaction outputs/evidence to existing record refs first and future `TaskArtifact` / event rows later.
- The Operations Map visualizes A2A-shaped task history; it does not claim public A2A endpoint conformance.

Rejected for v1:

- No public `AgentCard`, `SendMessage`, or `SubscribeToTask` implementation as part of this slice.
- No live streaming animation in the map until the runtime/capture contract provides stable event semantics.

### 3.2 Observability Standards

Primary sources:

- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
- [W3C Trace Context Recommendation](https://www.w3.org/TR/trace-context/)

Relevant standard pressure:

- OpenTelemetry separates traces, logs, metrics, events, and resources. The Operations Map should preserve source-record references and correlation ids instead of replacing them with a screenshot-only dashboard.
- W3C Trace Context gives a portable correlation model, and its privacy guidance warns against putting personally identifiable information into trace state.

Adopted for this spec:

- A2A edges carry `refs` to authoritative DPF rows and may later carry trace/span correlation fields when those exist.
- Timeline markers should be projections of source records, not handcrafted display-only events.
- Future correlation fields must be opaque ids or stable internal references, not free-form human/user data.

### 3.3 DPF UI Standards

Primary sources:

- `AGENTS.md` section 12: no hardcoded colors; use theme tokens.
- `docs/platform-usability-standards.md`: WCAG 2.2 AA, token-backed surfaces/text/borders/focus.
- `apps/web/components/ui/report-kit/README.md`: reporting/data-display primitives and status intent registry.

Adopted:

- Custom SVG is acceptable for the interaction graph because report-kit `Chart` is not a graph-topology primitive.
- Status pills, KPI counts, filter rows, tables, and exports must use report-kit primitives when the primitive fits.
- Status and severity color semantics should flow through `statusColors` or token-backed semantic intent, not a per-panel color map.
- Timestamps in React UI should use shared time rendering (`LocalTime`) rather than direct `Intl.DateTimeFormat` in leaf components.

## 4. Goals and Non-Goals

### Goals

1. Render coworker-to-coworker interactions as first-class edges for delegation, phase handoff, and task lineage in the current v1 slice.
2. Keep deliberation fan-out as a supported typed-edge concept, but wire it only when branch agent identity is present.
3. Preserve existing provider-routing functionality and tests.
4. Give operators audit/troubleshooting controls by interaction type, actor role, state, and eventually authority/sensitivity.
5. Provide an inspector that explains from coworker, to coworker, edge kind, state, reason/summary, authority/gate context, and source-record refs.
6. Stay migration-free until the capture thread establishes a canonical new write path.
7. Reserve about 20% of remaining implementation effort for refactoring the A2A panel into established DPF UI/reporting primitives and smaller pure helpers.

### Non-Goals

- No writes to delegation, handoff, task, deliberation, or thread state.
- No new database models or migrations in v1.
- No public A2A server/client protocol implementation.
- No live-SSE animation in v1.
- No separate `/platform/ai/a2a-map` route.
- No fabricated deliberation branch-agent edges while the schema lacks branch agent identity.

## 5. Design - Typed-Edge Topology Model

### 5.1 Node Model

Coworkers and providers remain separate node kinds. Coworkers can be both a source and target of A2A edges, so they are not merely a left lane.

```ts
export type OperationsMapNodeKind = "coworker" | "provider";
```

The current implementation preserves `OperationsMapRoutingCoworker` and `OperationsMapRoutingProvider`. A discriminator can be added later if a generic graph renderer replaces the current separate provider and A2A panels.

### 5.2 Edge Model

Provider routes stay backward-compatible as `OperationsMapRoutingRoute`. A2A interactions are their own discriminated edge type:

```ts
export type OperationsMapEdgeKind =
  | "provider-route"
  | "a2a-delegation"
  | "a2a-handoff"
  | "a2a-task-lineage"
  | "a2a-deliberation";

export type OperationsMapA2aEdgeKind = Exclude<
  OperationsMapEdgeKind,
  "provider-route"
>;

export type OperationsMapA2aInteractionState =
  | "active"
  | "completed"
  | "failed"
  | "blocked";
```

`OperationsMapA2aEdge` carries the minimum audit envelope:

```ts
export type OperationsMapA2aEdge = {
  id: string;
  edgeKind: OperationsMapA2aEdgeKind;
  fromCoworkerId: string;
  toCoworkerId: string;
  state: OperationsMapA2aInteractionState;
  label: string;
  summary: string;
  occurredAt: string | null;
  authorityScope?: string[];
  sensitivity?: string | null;
  skillId?: string | null;
  buildId?: string | null;
  gateResult?: string | null;
  refs: {
    delegationChainId?: string | null;
    phaseHandoffId?: string | null;
    taskRunId?: string | null;
    parentTaskRunId?: string | null;
    deliberationRunId?: string | null;
  };
  weight: number;
};
```

`OperationsMapRoutingTopology` includes:

```ts
export type OperationsMapRoutingTopology = {
  coworkers: OperationsMapRoutingCoworker[];
  providers: OperationsMapRoutingProvider[];
  routes: OperationsMapRoutingRoute[];
  a2aEdges: OperationsMapA2aEdge[];
  markers: OperationsMapRoutingMarker[];
  timeline: OperationsMapRoutingTimelineMarker[];
  legend: OperationsMapRoutingLegendItem[];
  a2aLegend: OperationsMapA2aLegendItem[];
};
```

`a2aEdges` defaults to `[]`. Empty A2A data must never break the provider topology.

## 6. Design - A2A Projection

`project-a2a-interactions.ts` is the correct architectural boundary: pure in, pure out, no Prisma, no React. `load-map-data.ts` owns database reads and DTO shaping.

| Source | Edge kind | State mapping | Required guardrails |
|---|---|---|---|
| `DelegationChain` | `a2a-delegation` | `completed`, `failed`, `blocked`; all else `active`. | Drop self-edges and rows missing either agent. Preserve `authorityScope`, `skillId`, and `reason`. |
| `PhaseHandoff` | `a2a-handoff` | Explicit gate failure -> `blocked`; otherwise a recorded handoff -> `completed`. | Preserve `buildId`, `gateResult` label, phase labels, and token-weight bucket. |
| `TaskRun` lineage | `a2a-task-lineage` | `completed`/`archived` -> `completed`; `failed`/`rejected` -> `failed`; `canceled` -> `blocked`; all else `active`. | Prefer parent agent for child task runs; otherwise initiating agent. Drop initiating==current self-edges. |
| `DeliberationRun` + branches | `a2a-deliberation` | Consensus/branch status. | Do not wire in loader until branch-persona agent identity exists. Pure projector support is fine; runtime projection without identity is not. |

Composition requirements:

- Merge A2A-contributed coworker nodes into provider-topology coworker nodes by `agentId`, preserving provider topology labels when duplicated.
- Merge provider and A2A timeline markers chronologically.
- Keep A2A source fetch limits bounded by the existing recent-window discipline until the map has URL/date-range controls.
- Do not turn missing source rows into synthetic "example" interactions.

## 7. Design - Rendering and Interaction

### 7.1 Current Increment

The current visible increment is a separate `A2aInteractionsPanel` rendered under the provider routing panel. This is acceptable as a stabilization slice because it:

- avoids destabilizing the 2605-line provider topology component,
- proves the A2A projection creates renderable operator value,
- gives tests a focused component boundary, and
- preserves existing provider routing UX.

It is not the final visual architecture. The final v1 UX should feel like one operations surface rather than two unrelated panels.

### 7.2 Target Layout

The target layout is a cohesive operations map with three coordinated bands:

1. **Coworker interaction band:** directional A2A edges between coworkers.
2. **Provider routing band:** existing coworker -> provider routing paths.
3. **Shared timeline:** one replay window that can scrub provider and A2A events together.

Coworker labels and vertical positioning should converge where possible so an operator can visually connect "this coworker delegated to another coworker" and "this coworker routed to this provider" without relearning the map twice.

### 7.3 A2A Visual Grammar

| Edge kind | Line treatment | Meaning |
|---|---|---|
| `a2a-delegation` | Solid | Authority-bearing delegation between coworkers. |
| `a2a-handoff` | Long dash | Build-phase handoff with gate result. |
| `a2a-task-lineage` | Short dash | Parent/initiating coworker to acting coworker task lineage. |
| `a2a-deliberation` | Dotted/fan | Coordinator to branch personas once branch identity is available. |

State uses semantic tokens plus explicit text:

- `active`: active/accent intent
- `completed`: success intent
- `failed`: danger/error intent
- `blocked`: warning intent

Color is never the only channel. State must also appear as text in the inspector and the graph must vary dash/shape/labels by edge kind.

### 7.4 Filters

Current first increment:

- A2A type filter
- state filter
- coworker actor filter with `either` / `from` / `to`
- reset action local to the panel

Remaining target:

- top-level dimension toggle: `Provider routes`, `A2A interactions`, `Both`
- authority/sensitivity filter when data exists
- shared replay-window filter across provider and A2A markers
- persisted A2A filter state through the existing Operations Map preference mechanism
- saved operator views that include A2A filter state

### 7.5 Inspector and Click-Through

Current first increment:

- Shows edge kind, from coworker, to coworker, summary, state, time, skill/gate/authority/build when available.
- Links to source/target coworker and build when `buildId` exists.

Remaining target:

- Link to authoritative source records for delegation chain, phase handoff/build, task run, and deliberation outcome when route surfaces exist.
- Use stable href builders rather than inline route construction inside the graph component.
- Render timestamps through shared time display.
- Surface "source record unavailable" honestly rather than hiding missing links.

## 8. UI, Accessibility, and Refactoring Requirements

This is an operational dashboard, not a landing page. It should be dense, quiet, scannable, and built for repeated troubleshooting.

Mandatory UI rules:

- Use `--dpf-*` tokens for text, surfaces, borders, accents, success/warning/error, and focus rings.
- Do not add local raw hex colors or a local status color registry.
- Use report-kit primitives where they fit:
  - `StatCard` or a report-kit equivalent for KPI counts.
  - `StatusBadge` / `statusColors` for status and severity semantics.
  - `FilterBar` where filters become reusable facets.
  - `LocalTime` for timestamp display.
- Custom SVG remains acceptable for the A2A graph because report-kit `Chart` does not model directed coworker interaction topology.
- Keyboard users must be able to select each rendered edge and reset/narrow filters.
- SVG paths need accessible names that include from coworker, to coworker, edge kind, and state.
- Text must fit on desktop and mobile; long coworker labels should truncate inside SVG and be fully visible in the inspector.
- Avoid nested card visual hierarchy. A panel can be a bounded tool surface, but repeated items should not become cards inside cards.

Refactoring allocation:

Reserve about 20% of remaining implementation effort for targeted cleanup that improves durability without expanding scope:

- Extract graph layout math and edge style mapping into pure helpers with tests.
- Replace local count/status/filter primitives with report-kit primitives where the API fits.
- Move A2A state-to-intent mapping into a shared status intent path instead of keeping a private `stateStroke` map.
- Replace direct timestamp formatting in `A2aInteractionsPanel` with shared time rendering.
- Keep the first panel extraction if it protects the provider map, but avoid a permanent forked design language.

## 9. Verification Plan

Source-local gates in the worktree:

- `pnpm --filter web exec vitest run lib/ai-operations-map`
- `pnpm --filter web exec vitest run components/platform/A2aInteractionsPanel.test.tsx`
- `pnpm --filter web exec vitest run components/platform/AiOperationsMap.test.tsx`
- `pnpm --filter web typecheck`
- `pnpm --filter web build`

Functional gate on canonical runtime or shared local-CI convergence sandbox:

- Drive `/platform/ai/operations-map`.
- Confirm provider routing remains intact.
- Confirm the A2A panel renders real `DelegationChain`, `PhaseHandoff`, or `TaskRun` lineage edges when rows exist.
- Confirm filters narrow by type/state/coworker role.
- Confirm inspector shows from/to, state, summary, authority/gate/build context, and honest source links.
- Confirm empty state when no A2A rows exist in the selected window.
- Record dynamic-analysis evidence naming the substrate. Do not claim UX complete from source-local tests alone.

If the install has no A2A rows:

- Prefer generating a real phase handoff through an existing Build Studio or coworker flow.
- If that is not feasible in the verification window, record source-local green plus canonical empty-state UX only, and leave live-edge verification open.

## 10. Backlog and Coordination

Live MCP state on 2026-06-05:

- `EP-AI-OPSMAP` remains the parent epic for the Operations Map visibility work.
- `BI-65B0D697` is the existing backlog item for this work. Do not create another.
- `EP-A2A` / `BI-9DB7C332` is the capture/runtime coordination point.

Before PR:

- Update `BI-65B0D697` with implementation evidence and any deferred live-edge verification caveat.
- Cross-link the PR and the implementation plan.
- Re-check open PRs and recent `main` for changes to `AiOperationsMap.tsx`, `load-map-data.ts`, `TaskRun`, `PhaseHandoff`, `DelegationChain`, and deliberation runtime files.

## 11. Sequencing

1. **Slice 1 - data model + A2A projector (done in current worktree, verify before PR).** Typed A2A edge model, pure projector, loader composition for delegation/handoff/task-lineage, and tests.
2. **Slice 2A - separate visible A2A panel (done in current worktree, verify before PR).** Separate panel below provider routing with A2A SVG, local filters, legend, empty state, and inspector.
3. **Slice 2B - cohesive map layout (remaining polish).** Move from "separate panel" toward coordinated coworker/provider/timeline bands without destabilizing provider routing.
4. **Slice 3 - shared filters, inspector, preferences (partially done).** Add top-level dimension toggle, authority/sensitivity filtering, persisted A2A filter state, saved-view integration, and source-record href builders.
5. **Slice 4 - deliberation identity/capture integration (later).** Wire `a2a-deliberation` only after branch persona agent identity is captured by schema/runtime or an authoritative event source.
6. **Slice 5 - live/correlation enrichment (later).** Consume stable A2A event rows, task artifacts, or trace/correlation ids when the runtime/capture contract exists.

## 12. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| The UI claims deliberation agent-to-agent visibility without agent identity. | Keep deliberation as a future typed edge; do not wire loader projection until branch agent identity exists. |
| The first panel becomes a permanent forked design system. | Allocate refactoring time to report-kit/status intent/LocalTime adoption and pure layout helpers. |
| A2A map work collides with `EP-A2A` capture work. | Keep this slice read-only and migration-free; coordinate through `BI-65B0D697` and `BI-9DB7C332`; re-sweep before push. |
| Sparse A2A data makes the surface look empty. | Render a clear empty state; verify with real generated rows when possible; never ship fake examples as live data. |
| Reworking a large SVG map destabilizes provider routing. | Keep provider panel stable while introducing A2A in an isolated component, then converge layout in smaller tested slices. |
| Local tests pass but live UX is broken. | Treat source-local gates as necessary but insufficient; canonical-runtime UX evidence is required before claiming completion. |

## 13. Definition of Done

For this backlog item to be complete:

- The map shows real coworker-to-coworker A2A edges for delegation, phase handoff, and task lineage from existing substrate with no migration.
- Deliberation is either wired from a truthful branch-agent source or explicitly left as a later slice; no fabricated branch-persona edges.
- Existing provider routing remains intact.
- Operators can filter A2A interactions by type, state, and coworker actor role; final v1 also persists filter state and composes with the replay window.
- The inspector shows from/to coworker, state, summary, authority/gate/build context, and honest source-record links.
- UI uses DPF theme tokens and report-kit/status/time primitives where appropriate.
- Source-local tests, typecheck, and build pass on the worktree.
- Functional verification is run on the canonical local install or shared local-CI convergence sandbox, with substrate named in the evidence.
