# Per-thread token/cost ledger — implementation plan

- **BI:** BI-CCF1ACBB (EP-8C706944 — AI Coworker Memory & Context Architecture, Phase 1)
- **Date:** 2026-07-09
- **Kernel ledger:** DI-F69AE978B70C
- **Status:** Derived rollup module + tests (this PR)

## Problem

Endless coworker threads have per-turn telemetry (`CoworkerTurnMetric`) but no cumulative "how much has this conversation cost" total — spend is bounded only by the provider window. The founder's stated gap: no per-conversation token/cost accounting.

## Substrate-first finding

The raw spend already exists, well-indexed by `threadId`, in two tables — so a new per-turn token table would duplicate them (single-source-of-truth):

- `AdapterRunTelemetry` — per-inference-run `inputTokens` / `outputTokens` / `estimatedCostUsd`, `@@index([threadId, startedAt])`.
- `ToolExecution` — per-tool-call `inputTokens` / `outputTokens` / `costUsd`, `@@index([threadId])`.

There is per-*provider* spend aggregation (`ai-provider-finance.ts`) but **no per-thread rollup**. So BI-CCF1ACBB is a derived rollup, not new storage — no migration.

## Design

1. **Pure core** `apps/web/lib/tak/thread-cost-ledger.ts`: `SpendRow` / `ThreadSpend` types, `summarizeThreadSpend(rows)` folding both sources into one total (null tokens/cost → 0), `combineThreadSpend` for effort-level sums, `formatThreadSpend` for display. Fully unit-tested, no DB.
2. **Server runner** `thread-cost-ledger-runner.ts`: `getThreadSpend(threadId)`, `getEffortSpend(threadIds)`, `getEffortSpendBreakdown(threadIds)` — indexed `findMany` over the two tables, folded by the pure core. Consumed by (a) the runtime to make compaction/consolidation spend-aware (P2), and (b) admin surfaces.

## Non-goals (own BIs / natural homes)

- Denormalized cumulative counters on `AgentThread` — deliberately avoided; the derived query cannot drift. Revisit only if per-turn aggregation cost is measured to matter.
- Surfacing spend in the operator UI — composes with the memory transparency/audit surface (BI-DC8B03AB, P4), which already renders per-thread/per-coworker detail; this PR ships the read API it consumes.
- Effort-scoped thread grouping — the `getEffortSpend(threadIds[])` shape is ready for the effort context (BI-23A65B81, P3), which owns the thread→effort mapping.

## Verification

- Unit: `thread-cost-ledger.test.ts` — empty, mixed-source sum, null coalescing, effort combine, formatting (dollar precision + singular/plural).
- Runtime (post-merge): `getThreadSpend(threadId)` on a live coworker thread returns a total matching a hand SUM over the two tables.
