# AI Operations Map — A2A Interaction Visibility — Implementation Plan

> **For agentic workers:** Execute task-by-task with TDD. Steps use checkbox (`- [ ]`) syntax for tracking. Backlog item: `BI-65B0D697` (epic `EP-AI-OPSMAP`). Design: `docs/superpowers/specs/2026-06-04-ai-operations-map-a2a-interaction-visibility-design.md`.

**Goal:** Re-architect `/platform/ai/operations-map` to render coworker-to-coworker (A2A) interactions — delegation, build phase-handoff, task spawn/lineage, deliberation fan-out — as first-class typed edges alongside the existing coworker→provider routing, with audit/troubleshooting filtering and an enriched inspector.

**Architecture:** Generalize the existing `apps/web/lib/ai-operations-map/` projection layer from an implicit two-lane bipartite model to a typed-node / typed-edge graph. Add a second pure projector that reads **existing** A2A substrate (`DelegationChain`, `PhaseHandoff`, `TaskRun` lineage, `DeliberationRun`) — **no migration**. Compose both projectors in the loader. Re-architect `AiOperationsMap.tsx` rendering into three bands (coworker interaction band, provider routing band, shared replay timeline) and extend filtering + inspector.

**Tech Stack:** Next.js App Router, Prisma via `@dpf/db`, React/SVG, Vitest, `lucide-react`, DPF `--dpf-*` theme tokens.

**Coordination:** Parallel A2A-capture thread owns the write path (`EP-A2A`, `BI-9DB7C332`). This plan is read-only + migration-free + additive to avoid collision. Re-sweep open PRs + recent `main` before every push.

---

## File Structure

- Modify `apps/web/lib/ai-operations-map/types.ts` — add `OperationsMapNodeKind`, `OperationsMapEdgeKind`, `OperationsMapA2aInteractionState`, `OperationsMapA2aEdge`, `OperationsMapA2aLegendItem`; add `a2aEdges` + `a2aLegend` to `OperationsMapRoutingTopology`.
- Create `apps/web/lib/ai-operations-map/project-a2a-interactions.ts` — pure projector: A2A source rows → `OperationsMapA2aEdge[]` + contributed coworker nodes + timeline markers.
- Create `apps/web/lib/ai-operations-map/project-a2a-interactions.test.ts` — TDD coverage per edge kind, state mapping, self-edge/missing-agent handling, aggregation.
- Modify `apps/web/lib/ai-operations-map/load-map-data.ts` — fetch the four A2A sources in the existing `Promise.all`; compose A2A edges into `routingTopology`.
- Modify `apps/web/lib/ai-operations-map/load-map-data.test.ts` — assert the new source queries and merged `a2aEdges`.
- Modify `apps/web/lib/ai-operations-map/project-routing-topology.ts` — emit `a2aEdges: []` + `a2aLegend` defaults so the topology shape is stable when the A2A projector is absent (keeps existing tests green during Slice 1).
- Modify `apps/web/components/platform/AiOperationsMap.tsx` — three-band layout, A2A edge rendering + legend, interaction-dimension filters, A2A inspector detail.
- Modify `apps/web/components/platform/AiOperationsMap.test.tsx` — A2A edges render, filters narrow, inspector shows from→to + click-through, empty-state.
- Modify `apps/web/components/platform/ai-operations-map-prefs.ts` (+ test) — persist the new interaction-dimension + A2A filter state.

---

## Phase / Slice 1 — Data model + A2A projector (migration-free, TDD) — ✅ DONE (2026-06-04)

> No rendering change. Independently verifiable via vitest. This is the foundational re-architecture; everything else builds on it. **Status: complete — 51 `lib/ai-operations-map` tests pass, `typecheck` clean.** Deliberation projection is supported + unit-tested but left unwired in the loader (TaskNode carries no branch-persona `agentId` yet) → Slice 4.

### Task 1.1: Generalize the topology type model

- [ ] Add `OperationsMapNodeKind = "coworker" | "provider"`.
- [ ] Add `OperationsMapEdgeKind = "provider-route" | "a2a-delegation" | "a2a-handoff" | "a2a-task-lineage" | "a2a-deliberation"`.
- [ ] Add `OperationsMapA2aInteractionState = "active" | "completed" | "failed" | "blocked"`.
- [ ] Add `OperationsMapA2aEdge` (from/to coworker, edgeKind, state, label, summary, occurredAt, authorityScope?, sensitivity?, skillId?, buildId?, gateResult?, refs{}, weight) per spec §4.2.
- [ ] Add `OperationsMapA2aLegendItem` (edgeKind, label, description).
- [ ] Add `a2aEdges: OperationsMapA2aEdge[]` and `a2aLegend: OperationsMapA2aLegendItem[]` to `OperationsMapRoutingTopology`.
- [ ] Keep `OperationsMapRoutingRoute` unchanged (it IS the `provider-route` variant) for backward compatibility.

### Task 1.2: A2A projector tests (write first, expect red)

- [ ] `DelegationChain` row → one `a2a-delegation` edge `fromAgentId`→`toAgentId`; state mapped from `status`; `authorityScope`/`skillId`/`reason` carried; refs.delegationChainId set.
- [ ] `PhaseHandoff` row → one `a2a-handoff` edge with `fromPhase→toPhase` label, `gateResult` carried, refs.phaseHandoffId/buildId set.
- [ ] `TaskRun` with `parentTaskRunId` set OR `initiatingAgentId ≠ currentAgentId` → one `a2a-task-lineage` edge; rows where initiating==current and no parent yield no edge.
- [ ] `DeliberationRun` + branch `TaskNode`s → coordinator→branch `a2a-deliberation` edges, aggregated per run.
- [ ] Self-edge (`from === to`) dropped; row missing an agent on either end skipped.
- [ ] Coworkers referenced only as a delegation *target* still appear in contributed coworker nodes.
- [ ] Run `pnpm --filter web exec vitest run lib/ai-operations-map/project-a2a-interactions.test.ts` and confirm it fails for the missing module.

### Task 1.3: Implement `project-a2a-interactions.ts`

- [ ] Pure function `projectA2aInteractions(input)` — no Prisma, no React imports (mirror `project-routing-topology.ts`).
- [ ] Define source-row DTO types for the four sources.
- [ ] Map each source per spec §4.3 table; conservative defaults (unknown status → `active`).
- [ ] Contribute coworker nodes via an `ensureCoworker`-style helper; return `{ a2aEdges, coworkers, timeline }`.
- [ ] Aggregate deliberation branch edges per run to avoid clutter.
- [ ] Re-run tests to green; keep existing `project-routing-topology.test.ts` passing.

### Task 1.4: Compose in the loader

- [ ] Add `a2aLegend` constant + `a2aEdges: []` defaults to `projectRoutingTopology` output so the topology shape is stable.
- [ ] In `load-map-data.ts`, add to the existing `Promise.all`: recent `delegationChain`, `phaseHandoff`, `taskRun` (lineage subset), `deliberationRun` (+ branch nodes) fetches, bounded by `RECENT_TOOL_LIMIT`.
- [ ] Call `projectA2aInteractions`, merge its coworker nodes into the topology coworker set, set `topology.a2aEdges`, and merge timeline markers.
- [ ] Update `load-map-data.test.ts` to assert the new queries issue and `a2aEdges` is populated.

### Task 1.5: Verify Slice 1

- [ ] `pnpm --filter web exec vitest run lib/ai-operations-map`
- [ ] `pnpm --filter web typecheck`
- [ ] Confirm no rendering regression (component still compiles against the extended topology with `a2aEdges` unused).

---

## Phase / Slice 2 — Rendering band — ✅ FIRST INCREMENT DONE (2026-06-04)

> Implemented as an isolated, tested `A2aInteractionsPanel.tsx` component rendered below the provider routing panel, rather than re-cutting the 2599-line provider SVG in place — this delivers operator-facing A2A visibility now without destabilizing the working provider view. It renders a from→to coworker interaction band (typed per-kind line styles + per-state colors + arrowheads + legend), the interaction-type / state / coworker(role) filters (Slice 3 scope, folded in here), and a click-through inspector. 5 behavioral render tests pass. The fully-merged three-band orbital SVG layout (spec §5.1) — sharing coworker Y-positions with the provider band — remains the polish target for a later increment.

### Task 2.1: Banded layout

- [ ] Replace fixed two-lane `ROUTING_LAYOUT` assumptions with a banded layout computing coworker Y-positions once and reusing them across the interaction band and provider band.
- [ ] Add a coworker interaction band that draws A2A edges between coworker nodes.

### Task 2.2: A2A edge visual grammar

- [ ] Per-`edgeKind` line treatment + symbol + legend entry (spec §5.2); color via `--dpf-*` only; state conveyed by shape+dash+label, never color alone.
- [ ] Aggregate deliberation fan-out visually; expandable in inspector.
- [ ] Add an empty-state for the interaction band when `a2aEdges` is empty.

### Task 2.3: Verify Slice 2

- [ ] `pnpm --filter web exec vitest run components/platform/AiOperationsMap`
- [ ] `pnpm --filter web build`
- [ ] Visual check at desktop + mobile widths.

---

## Phase / Slice 3 — Filtering + inspector — ✅ LARGELY DONE (2026-06-05, post-review)

> After the 2026-06-05 architecture/UI review, this slice was advanced alongside the report-kit refactoring allocation (spec §8):
> - **report-kit / token alignment:** A2A state→colour now flows through the shared `statusColors` `a2aInteraction` domain (no local colour map); inspector state uses `StatusBadge`; KPI counts use `StatCard`; timestamps use `LocalTime` (no `Intl.DateTimeFormat` in the leaf).
> - **Pure helpers extracted + tested:** layout math, edge styling, state intent, and source-record link building moved to [a2a-interaction-graph.ts](apps/web/components/platform/a2a-interaction-graph.ts) with full vitest coverage.
> - **Honest source-record click-through:** `/build?buildId=` deep-link verified and used; `DelegationChain`/`PhaseHandoff`/`TaskRun`/`DeliberationRun` shown as identifier text (no dead links) since they have no page route.
> - **Persisted filters:** A2A type/state/coworker(role) filter state persists via `ai-operations-map-prefs` (`loadA2aFilterPreference`/`saveA2aFilterPreference`/`clearA2aFilterPreference`), round-trip unit-tested.
>
> Verified: 87 `lib/ai-operations-map` + `components/platform` tests pass, `typecheck` clean.
> **Remaining (Slice 2B/3 polish):** top-level `Provider routes · A2A · Both` dimension toggle, authority/sensitivity filter facet, shared replay-window composition across both bands, saved-view integration that includes A2A filters, and the cohesive three-band layout.

### Task 3.1: Interaction-dimension filtering

- [ ] Dimension toggle: Provider routes · A2A interactions · Both (default Both).
- [ ] A2A type filter (delegation/handoff/lineage/deliberation, multi-select).
- [ ] Actor filter (single coworker as source/target/either).
- [ ] State filter (active/completed/failed/blocked) — the troubleshooting entry point.
- [ ] Authority/sensitivity filter where edges carry it.
- [ ] Compose all with the existing replay-time window.
- [ ] Persist new keys via `ai-operations-map-prefs` (+ test).

### Task 3.2: A2A inspector detail

- [ ] Extend the symbol/edge detail popover for A2A edges: from→to coworker, edge kind, state, reason/summary, authority scope + sensitivity, gate/consensus result, click-through links to source record (delegation chain, build, task run, deliberation).

### Task 3.3: Verify Slice 3 + functional sign-off

- [ ] Full vitest + typecheck + build gates.
- [ ] Functional: drive `/platform/ai/operations-map` on the live install; confirm A2A edges render between correct coworkers, filters narrow as specified, inspector shows from→to + authority + click-through, timeline scrubs A2A markers. Record as a dynamic-analysis narrative naming the substrate (per structural-≠-functional commandment). If no A2A rows exist yet, drive a Build Studio run to produce `PhaseHandoff` rows, or verify empty-state and defer live-edge sign-off honestly.

---

## Non-Goals

- No writes to delegation/handoff/task/deliberation state (read-only map).
- No new database models or migrations in v1.
- No dependency on the parallel A2A-capture thread shipping first.
- No live-SSE animation in v1 (reuse the existing static replay timeline).
- No new permissions or theme tokens.
