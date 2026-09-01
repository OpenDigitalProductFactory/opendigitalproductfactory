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
7. Complete the recorded owner-visibility acceptance on the existing `/ops`
   backlog row: batch-project active Workroom ownership from the same liveness
   read model, then show a compact linked strip with the Workroom status,
   executor, branch, and true-liveness label. Keep session refs, worktree paths,
   and lease internals out of the default human view.
8. Measure the changed `/ops` route against its UX-fit budget, verify the
   duplicate-claim refusal on the canonical install after the merged SHA is
   served, and reconcile the objective before closing the BI and Workroom.

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
- Owner UI: a backlog item with live work names and links its Workroom and
  exposes status, executor, branch, and liveness without internal session or
  filesystem noise; an unowned item adds no empty ownership chrome.
- Live acceptance: a second branch/session claim against BI-BFBF1BBB is
  refused before Workroom mutation, and the original three-item read path
  returns non-vacuous ownership rather than an empty projection.

## UX-fit decision

- **Owning area / route:** Operations, on the existing canonical `/ops`
  backlog list. No route or navigation layer is added.
- **Persona:** a platform operator deciding whether a backlog item is already
  being worked. The first answer is the linked Workroom; infrastructure detail
  stays backstage.
- **Component convergence:** reuse `StatusBadge`, the existing backlog row,
  and the canonical Workroom detail route at `/workspace/cases/[caseKey]`.
- **Source of truth:** `loadBacklogWorkroomOwnership`, which already reuses the
  shared true-liveness inventory used by claim admission and MCP reads.
- **Empty/failure state:** no strip when no live Workroom exists; loader
  failures remain page-read failures rather than inventing an unowned state.
- **Verification:** focused rendering and projection tests, `/ops` desktop and
  narrow browser inspection, measured UX-fit manifest, affected Vitest, and
  the web production build.
