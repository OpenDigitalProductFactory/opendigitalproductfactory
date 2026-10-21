---
status: draft
---

# Executor takeover: implementation plan

**Design:** [2026-10-21-executor-takeover-design.md](../specs/2026-10-21-executor-takeover-design.md).
**Parent:** BI-E2871BDE.

Each deliverable ships as its own PR, with its own Workroom, through the normal
gates. Order: D1 and D2 are independent and remove most of the observed
friction. D3 comes before D4. D5 comes last.

## Coverage

| Deliverable | Backlog item | Design | Acceptance |
| --- | --- | --- | --- |
| D1 PR/branch lookup | BI-679D2BF6 | §3.1 | AC-1, AC-2 |
| D2 merged PR clears delivery state | BI-3A8F935B (absorbs BI-150D4696) | §3.4 | AC-5 |
| D3 heartbeat checkpoint | BI-11EF5A8C | §3.2 | AC-3 |
| D4 checkpoint before admission + batched handover | BI-D4144471 | §3.3 | AC-3, AC-4 |
| D5 takeover runbook | BI-70341CE8 | §3.5 | AC-6 |

Stopping stage tasks on terminal rooms is BI-1DDCE164 (AC-2 there), already
in delivery in another Workroom. Nothing here depends on its internals.

## Phase 1: D1, PR/branch lookup (BI-679D2BF6)

1. **Red.** Extend `apps/web/lib/work-capsules/list-observation.test.ts`, and
   add one if it is missing:
   - A filtered query (`headBranch`, `pullRequestNumber`) by an OAuth
     assistant returns the same person's room created by another assistant,
     with only the not-admitted projection.
   - Another person's room is never returned.
   - An unfiltered query returns the same rows as before (snapshot of the
     current `where`).
2. **Green.**
   - `list-observation.ts`: accept both filters into `where`.
   - When a filter is present and `authSource === "oauth"`, replace the
     two-principal `AND` with a person-only clause.
   - Project rows the assistant is not admitted to through the existing
     not-admitted shape from `mcp-handlers.ts`, reusing its builder, not a copy.
3. **Schema.** Add both properties to `list_workrooms` in
   `lib/mcp/packs/work-capsules-pack.ts`, and add the filter keys to the
   observation identity so cursors stay filter-bound.
4. **Verify.** Run the affected vitest and the web typecheck. On the live
   install, `list_workrooms {pullRequestNumber}` must resolve a room created by
   another assistant.

## Phase 2: D2, merged PR clears delivery state (BI-3A8F935B)

Delivered under BI-3A8F935B's own plan. This plan only requires its acceptance
to include AC-5: a merged bound PR sets `prDelivery.status = merged` and clears
an open escalation within one sync. The regression case is WC-5DE121A4.

## Phase 3: D3, heartbeat checkpoint (BI-11EF5A8C)

1. **Red.** Add tests in `lib/work-capsules/`:
   - A heartbeat with a valid checkpoint stores it in
     `workspaceState.executorCheckpoint`, with `recordedAt` and the writer.
   - An oversize or invalid checkpoint is refused and the lease is unchanged.
   - A heartbeat without a checkpoint keeps the previous one.
2. **Green.** Add `checkpoint` to `heartbeat_workroom`'s schema. Validate it in
   the handler and write it in the same update that renews the lease.
3. **Docs.** Update the `dpf-finishing-a-development-branch` skill and its
   heartbeat guidance in the DPF skill pack, so agents send a checkpoint at
   each stage boundary.

## Phase 4: D4, checkpoint before admission and batched handover (BI-D4144471)

1. **Red.** Tests:
   - The not-admitted `get_workroom` result includes `checkpoint`,
     `pullRequest` and `leaseExpiresAt`.
   - `reassign_workroom_executor {capsuleIds}`: a dry run returns a stable
     `planDigest`.
   - Apply with a matching digest hands over every room. A lease holder that
     changed in between is skipped and reported. A mismatched digest refuses
     the call. More than 20 ids are refused.
   - One approval envelope covers the set.
2. **Green.** Compose the existing single-room handover per room, inside one
   approval whose fingerprint covers `capsuleIds` plus `planDigest`.
3. **Verify.** On the live install, one approval takes over three rooms.

## Phase 5: D5, runbook (BI-70341CE8)

Add the section described in design §3.5 to
`docs/architecture/delivery-surfaces-runbook.md`, linking D1 and D4. Run docs
lint.

## Stop conditions

- Any phase that needs a new table or a new MCP tool goes back to design
  review. None is planned.
- If D1's person-scoped matching needs authority beyond what
  `workroom_assistant_not_admitted` already discloses, stop and request
  architecture review.
