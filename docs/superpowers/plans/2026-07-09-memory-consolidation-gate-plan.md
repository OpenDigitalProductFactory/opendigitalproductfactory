# Write-time memory consolidation gate — implementation plan

- **BI:** BI-840FDD43 (EP-8C706944 — AI Coworker Memory & Context Architecture, Phase 2)
- **Date:** 2026-07-09
- **Kernel ledger:** DI-F69AE978B70C
- **Status:** Gate core + wiring into both stores (this PR)

## Problem

`upsertUserFact` (UserFact) and `recordCoworkerNote` (CoworkerMemoryNote) both supersede only on an **exact key match**. Two entries that mean the same thing under different keys — `preferred_meeting_time` vs `meeting_time`, `review_style_preferred` vs `preferred_review_style` — both persist, so the stores accumulate near-duplicates and unresolved contradictions.

## Design

A pure write-time gate (mem0's ADD/UPDATE/DELETE/NOOP controller, adapted to a deterministic lexical signal so it is unit-testable without a model).

1. **Pure core** `apps/web/lib/tak/memory-consolidation.ts`: `classifyConsolidation(candidate, existing, opts)` →
   - **NOOP** — exact key with an equivalent value, or a near-duplicate that restates the same value.
   - **UPDATE** — exact key, changed value (preserves current behavior).
   - **SUPERSEDE** — a different-key near-neighbor (key-token Jaccard ≥ `DEFAULT_SUPERSEDE_THRESHOLD` = 0.6) with a changed value.
   - **ADD** — no equivalent or near neighbor.

   Matching is driven by the **key** token set, not key+value: two entries about the same concept share key tokens, and whether the value differs is exactly what separates SUPERSEDE from NOOP — folding value tokens in would dilute the signal in the supersede case. 11 unit tests.

2. **Wiring** (additive, exact-key behavior unchanged): when neither store finds an exact-key match, it loads the active siblings in scope (UserFact: same `userId`+`category`; CoworkerMemoryNote: same `agentId`+`noteKind`), runs the gate, and applies NOOP (skip) / SUPERSEDE (create + retire the near-neighbor with the provenance chain) / ADD (create).

## Non-goals (own BIs)

- Batch consolidation / contradiction resolution across the whole store → the sleep-time pass (BI-907C4327) reuses this same gate in batch mode.
- Expiry/pruning of superseded rows → BI-153F7E4A.
- Embedding-based similarity — deliberately deterministic lexical for now; an embedding signal can be layered behind the same `classifyConsolidation` seam later without changing callers.

## Verification

- Unit: `memory-consolidation.test.ts` (11 — similarity, all four actions, custom threshold, empty store) + `coworker-memory.test.ts` (2 new — near-dup supersede + near-dup noop). Existing user-facts/coworker-memory suites green (24 total across the three files).
- Runtime (post-merge): recording `review_style_preferred` when `preferred_review_style` is active supersedes the latter instead of creating a second active note.
