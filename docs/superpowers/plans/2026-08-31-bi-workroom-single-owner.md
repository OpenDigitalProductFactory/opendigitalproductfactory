---
status: active
---

# BI Workroom Single-Owner Hardening Plan

**Backlog:** BI-BFBF1BBB

**Epic:** EP-WORK-CONVERGENCE

**Design:** `docs/superpowers/specs/2026-07-06-bi-work-location-claim-at-start-design.md`

**Decision:** DI-ABFED7DDB995

## Outcome

A BacklogItem with demonstrably live work cannot be claimed into another
Workroom by accident. Ownership is visible on the canonical read model, repeat
claims for the same Workroom are idempotent, and intentional co-delivery is an
audited exception.

## Implementation

1. Add focused red tests for live-room refusal, same-room idempotency, dead-room
   replacement, required override reason, override audit evidence, and claim
   serialization.
2. Extract the BI ownership projection into a small module that reuses the
   existing Workroom liveness inventory; use it from both claim admission and
   `get_backlog_item`.
3. Serialize claim admission with a `BacklogItem` row lock inside the governed
   transaction, refuse before Workroom adoption, and return the structured live
   owner summaries.
4. Extend the MCP input contract with `force` and `overrideReason`; keep legacy
   callers source-compatible and make the default fail closed only when another
   Workroom is truly live.
5. Run the affected Vitest files and source guards. Because this worktree was
   classified source-only, run the production build through the governed exact-
   tree gate rather than asserting a local build that cannot execute here.
6. Commit with DCO, push, open a ready PR with Design grounding, verify PR
   health, and attach the results to BI-BFBF1BBB / WC-923105A2.

## Verification mapping

- Accidental duplicate: a live different Workroom returns
  `backlog_item_already_claimed` and no adoption occurs.
- Concurrency: the BacklogItem row is locked before ownership is evaluated.
- Compatibility: absent `force` preserves successful first claims, dead-room
  reclamation, and exact Workroom idempotency.
- Override: `force=true` without a reason fails; a reasoned override succeeds
  and writes an activity containing the displaced Workrooms.
- Read model: `get_backlog_item` returns bound Workrooms with `isLive`, liveness
  reason, branch, worktree, executor, and lease evidence.
