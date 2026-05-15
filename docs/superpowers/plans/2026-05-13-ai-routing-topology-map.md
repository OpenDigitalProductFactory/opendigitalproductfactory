# AI Routing Topology Map Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents are explicitly authorized) or execute this plan task-by-task with TDD. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only provider-routing topology overlay to the existing AI Operations Map so operators can see coworker-to-provider traffic, route decisions, quota pressure, failover, and scheduled future work.

**Architecture:** Extend the existing `apps/web/lib/ai-operations-map/` projection layer instead of introducing a new route or event grammar. The slice reads canonical runtime rows (`RouteDecisionLog`, `TokenUsage`, `ModelProvider`, `ScheduledAgentTask`, `ScheduledJob`) and renders a stable schematic topology inside the existing `AiOperationsMap` component using DPF theme tokens and symbol+label status grammar.

**Tech Stack:** Next.js 16 App Router, Prisma via `@dpf/db`, React/SVG, Vitest, existing `lucide-react` icon set, DPF `--dpf-*` theme variables.

---

## File Structure

- Modify `apps/web/lib/ai-operations-map/types.ts`: add routing-topology DTOs for coworkers, providers, routes, decision markers, timeline markers, and legend entries.
- Modify `apps/web/lib/ai-operations-map/load-map-data.ts`: load route decisions, token usage, providers, and future schedules; return a `routingTopology` field alongside existing map data.
- Create `apps/web/lib/ai-operations-map/project-routing-topology.ts`: pure projection helpers that classify decisions into active, secondary, failover, scheduled, quota, error, governance, and local/provider categories.
- Create `apps/web/lib/ai-operations-map/project-routing-topology.test.ts`: TDD coverage for route-symbol classification, provider/coworker node assembly, cost/quota signals, and future schedule markers.
- Modify `apps/web/components/platform/AiOperationsMap.tsx`: add a topology panel above the existing business-flow map with SVG routes, arrowheads, line styles, symbols, legend, and timeline rail.
- Modify `apps/web/components/platform/AiOperationsMap.test.tsx`: assert the map exposes route lines, symbol labels, timeline labels, and a no-data empty state.
- Modify `docs/superpowers/specs/2026-05-10-ai-coworker-visual-control-surface-design.md`: add a V2 routing-topology addendum documenting the visual grammar.

---

## Tasks

### Task 1: Document the visual grammar

- [ ] Add a spec addendum for the routing topology layer.
- [ ] Capture the symbol decisions: diamond route decision, gauge quota, octagon/X error, clock scheduled future, shield governance/local-only.
- [ ] Record accessibility rules: color is never the only channel; each state must have shape, line style, and label.

### Task 2: Add routing-topology projection tests

- [ ] Write tests that project a selected route decision into an active route with a route-decision marker.
- [ ] Write tests that classify fallback traces as failover routes and excluded/rate-limit reasons as quota markers.
- [ ] Write tests that aggregate `TokenUsage.costUsd` per provider and expose spend labels.
- [ ] Write tests that create scheduled/future markers from active `ScheduledAgentTask` and `ScheduledJob` rows.
- [ ] Run `pnpm --filter web exec vitest run lib/ai-operations-map/project-routing-topology.test.ts` and confirm the tests fail for the expected missing module.

### Task 3: Implement the projection layer

- [ ] Add routing topology types.
- [ ] Implement `projectRoutingTopology` as a pure function with no Prisma or React imports.
- [ ] Keep unrecognized candidate/fallback JSON shapes safe by parsing conservatively and falling back to summary text.
- [ ] Re-run the topology tests and keep the existing operations-map projection tests passing.

### Task 4: Load canonical data

- [ ] Extend `loadOperationsMapData` to fetch recent route decisions, provider rows, token usage rows, and future schedules in the same existing `Promise.all`.
- [ ] Keep the default window bounded (`RECENT_TOOL_LIMIT`) and avoid migrations.
- [ ] Update loader tests to assert the new source queries are issued and merged into `routingTopology`.

### Task 5: Render the topology panel

- [ ] Add the topology panel above the existing operations schematic.
- [ ] Use SVG paths for route traffic and `lucide-react` symbols for decision markers where practical.
- [ ] Use DPF tokens for surfaces, text, borders, and state colors; no hardcoded app UI colors.
- [ ] Add static timeline controls for History, Current routing, and Future schedule; live animation remains a later slice.
- [ ] Preserve the existing inspector/filter behavior below the new topology panel.

### Task 6: Verify

- [ ] `pnpm --filter web exec vitest run lib/ai-operations-map components/platform/AiOperationsMap`
- [ ] `pnpm --filter web typecheck`
- [ ] `pnpm --filter web build`
- [ ] Run the app and visually verify `/platform/ai/operations-map` in browser at desktop and mobile widths.

---

## Non-Goals

- No writes to routing policy, providers, or schedules.
- No live SSE animation in this slice.
- No new database models or migrations.
- No new permissions or theme tokens.
- No route layout persistence yet; layout is deterministic from the projection.
