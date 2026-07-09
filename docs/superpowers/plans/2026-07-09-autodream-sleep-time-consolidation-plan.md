# Sleep-time memory consolidation ("autoDream") — implementation plan

- **BI:** BI-907C4327 (EP-8C706944 — AI Coworker Memory & Context Architecture, Phase 2)
- **Date:** 2026-07-09
- **Kernel ledger:** DI-F69AE978B70C
- **Status:** Nightly pass wired (this PR)

## Problem

The autonomous memory-consolidation loop ("autoDream") was designed in `docs/superpowers/specs/2026-04-02-agentic-architecture-patterns-design.md` and never shipped. The write-time gate (BI-840FDD43) only compares a *new* entry to the existing set, so duplicates that predate their eventual twins still coexist, and stale entries never expire without a sweep.

## Design

A nightly, low-priority reflection pass — Letta's sleep-time compute / generative-agents reflection — reusing DPF's existing nightly-Inngest + quiescence-gate + scheduled-job-catalog substrate.

1. **Pure batch planner** `memory-consolidation-sweep.ts`: `planBatchDedupe(entries)` processes a scope newest-first, keeps the first representative of each near-duplicate cluster as the canonical winner (reusing the BI-840FDD43 `classifyConsolidation` similarity), and returns the supersede plan for the rest. Deterministic, order-independent → 6 unit tests.
2. **Runner** `memory-consolidation-runner.ts`: `dedupeCoworkerNotes` (per `noteKind`) and `dedupeUserFacts` (per `category`) apply the plan with the provenance chain intact.
3. **Nightly function** `queue/functions/memory-consolidation-nightly.ts`: `runMemoryConsolidationSweep` iterates coworkers with active notes and users with active facts — batch-dedupe then expire (reusing BI-153F7E4A `expireStale*`) — each entity independent (one failure logged, pass continues). Registered behind the quiescence gate, cron **04:20 UTC** (clear of the 03:00 backup and 04:00 retention slots), concurrency 1.
4. **Catalog + registration**: added to `scheduledFunctions` and `SCHEDULED_JOB_CATALOG` (the drift guard requires both; the admin Scheduled Jobs surface renders the catalog entry).

## Non-goals (future slices)

- Promoting confirmed durable learnings to the WWWD/WSID commons via `dpf-route-learning-to-commons` — a heavier routing step; this pass consolidates and expires, and the commons-promotion hook lands once the two-scope model (BI-1772D0B7) defines what is org-shareable.
- Raw-message pruning across all threads — `pruneSummarizedThreadMessages` (BI-153F7E4A) is ready; wiring it per-thread into this pass is deferred until effort-scoped threads (BI-23A65B81) define the active-thread set to sweep.

## Verification

- Unit: `memory-consolidation-sweep.test.ts` (6 — distinct entries, cluster collapse, cluster separation, order-independence, empty) + `index.test.ts` cron↔catalog parity guard green.
- Runtime (post-merge): after the pass, a coworker with two near-duplicate active notes has one; a user fact unused > 28 days is superseded; the admin Scheduled Jobs surface lists "Coworker memory consolidation" at 04:20.
