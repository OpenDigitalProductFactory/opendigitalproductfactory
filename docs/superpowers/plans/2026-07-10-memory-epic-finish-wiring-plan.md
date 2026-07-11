# EP-8C706944 finish-wiring — close the three deferred consumers

- **Epic:** EP-8C706944 (AI Coworker Memory & Context Architecture)
- **Date:** 2026-07-10
- **Kernel ledger:** DI-F69AE978B70C (program)
- **Status:** Wires the three loose ends left after the 9 BIs merged

## Problem

The 9 BIs of EP-8C706944 all merged, but three capabilities shipped as libraries with no live consumer — code present, not exercised:

1. `pruneSummarizedThreadMessages` (BI-153F7E4A) existed but nothing called it — raw `AgentMessage` rows were never actually pruned.
2. `getThreadSpend` / `getEffortSpend` (BI-CCF1ACBB) had no UI — "readable by admins" was unmet.
3. `/platform/ai/memory` (BI-DC8B03AB) was URL-reachable only — not in the nav.

## Changes

1. **Prune wired into autoDream** (`memory-consolidation-nightly.ts`): after the fact/note dedupe+expire sweep, iterate `AgentThread`s that have a `compactionWatermarkAt` and call `pruneSummarizedThreadMessages` on each; new `threadsPruned` / `messagesPruned` result counters. Only checkpointed threads are candidates and only summarized+aged rows are deleted (content survives in the summary).
2. **Ledger surfaced** (`memory-audit.ts` + memory page): `loadMySpendLine` sums the caller's spend across all their threads via `getEffortSpend` and renders it as a line on the memory transparency page ("Your AI usage across all conversations: …").
3. **Nav link** (`platform-nav.ts`): "Coworker Memory" → `/platform/ai/memory` under AI Operations, so the audit surface is discoverable.

## Verification

- Unit: existing sweep / nav / audit-shape / cron-parity suites green (27 tests across the four affected files).
- Typecheck: `tsc --noEmit` exit 0.
- Runtime (post-merge): the nightly pass reports non-zero `messagesPruned` once a checkpointed thread has aged rows; the memory page shows a spend line; "Coworker Memory" appears in the AI Operations nav.
