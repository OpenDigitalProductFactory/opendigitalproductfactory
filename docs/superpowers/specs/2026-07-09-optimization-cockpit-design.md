# Optimization Cockpit — projecting the Vertical-Integration bets onto live architecture surfaces

_Status: implemented with BI-D9B58004 · EP-8DC217EB BET-0a · 2026-07-09_
_Parent plan: [`2026-07-07-vertical-integration-inward-plan.md`](../plans/2026-07-07-vertical-integration-inward-plan.md) §9 (self-optimization engine, kernel-gated enablement-first)_

## What

The EP-8DC217EB consolidation bets become a **live, projected registry** instead of
a static plan table:

- **Registry** — `apps/web/lib/optimization/consolidation-bets.ts`: the closed
  set of bets (BET-0 … BET-14), each carrying its plan grounding (move types
  T1–T7, wave, effort/leverage, Σleaf estimate), its live `BacklogItem.itemId`s,
  and **projection selectors**: Prisma model names, MCP tool names, and
  repo-relative anchor files. The contract test
  (`consolidation-bets.test.ts`) asserts every selector resolves — file exists,
  model is declared in `schema.prisma`, tool is registered in `mcp-tools.ts` —
  so the registry cannot drift into fabrication.
- **Projection loader** — `apps/web/lib/optimization/load-cockpit-data.ts`:
  per bet, real code-graph blast radius via `traceCodeSurface` (model/tool
  selectors → distinct implementation files + linked tests) and
  `summarizeCodeGraphCoverage` (anchor-file index coverage), joined with live
  backlog status from Postgres. Uses the same server-side query layer the MCP
  tools wrap — no MCP round-trip. Degrades gracefully: graph unavailable ⇒
  null projections + the freshness trust banner; a per-selector graph error ⇒
  that selector reported `unresolved`, never a 500.
- **Surface** — the existing `/ea/capabilities` page:
  `OptimizationCockpitSection` (report-kit `StatCard`/`DataTable`/`Notice`/
  `StatusBadge` only) below the capability map, plus a new capability-map
  overlay mode **“Optimization Impact”** (`CAPABILITY_OVERLAY_MODES` +
  `deriveCapabilityOverlayState`) that lights up capabilities whose traced
  backlog items belong to the bet registry (labels are `"BI-… title"`, matched
  by id prefix against `CONSOLIDATION_BET_ITEM_IDS`).

## Kernel decisions (recorded)

- **Placement/UX-fit** (`principle_decide`, governing profile platform):
  **capability-map overlay/extension** over a new `/platform` page or a new
  top-level route — HIGH confidence, composite 4.015, margin 0.435. Hence: no
  new route, no new nav entry, no new component family; the cockpit composes
  report-kit on the existing EA capabilities tab with progressive disclosure.
- BET-0 enablement-first sequencing was kernel-gated in the parent plan
  (HIGH confidence, composite 9.10, margin 0.30).

## Contract for future bets

Adding/renaming a bet requires: the parent plan amended first; live BI ids
under EP-8DC217EB; selectors verified (the contract test enforces this). When a
consolidation lands and renames/deletes a selector target, the contract test
fails on the stale selector — update the registry in the same PR that moves the
artifact. BET-0b (BI-ED9AC5A6) extends this registry into the
architecture-parity baseline so duplication becomes a measurable conformance
issue; BET-0d/0e route bets to WSID-profiled coworkers — they consume this
registry and MUST NOT grow a parallel one.

## BET-0b — consolidation bets as architecture-parity targets (BI-ED9AC5A6)

Landed as `apps/web/lib/ea/consolidation-parity-steward.ts`:
`runConsolidationParitySteward` reads the bet registry, joins live
`BacklogItem` status, and reconciles one `eaConformanceIssue` per bet with
outstanding delivery work (stable key `consolidation-parity:<betKey>`,
severity = leverage: H→warn, M→info) through the shared
`reconcileConformanceIssues` contract — so the issue auto-resolves the moment
every item delivering the bet reaches a terminal state, and duplication is a
measurable, drift-reducing conformance signal on the EA surface. A registry
item id missing from the live backlog counts as outstanding drift (never a
silent completion). It runs piggybacked on the scheduled SysML parity sweep
(`agent-task-scheduler.ts`, `SYSML_PROJECTION_TASK_ID` branch) — no new
cron/task surface.

## Research & benchmarking

Composition follows the in-repo precedents rather than external dashboards:
`build-process-matrix.ts` (closed pure data module + contract), the
`ai-operations-map` loader→page shape, and the capability-map overlay-mode
pattern (`maturity`/`coverage`/`planning`/`it4it`, now `optimization`).
External comparison (LeanIX/Ardoq initiative-to-capability overlays) matches
the chosen shape: initiatives as a first-class registry projected onto the
capability map, not a separate reporting silo.
