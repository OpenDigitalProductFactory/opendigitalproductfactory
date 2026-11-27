---
title: Software Platform PR ownership implementation plan
status: draft
backlogItem: BI-C3EBDCEC
---

# Software Platform PR ownership implementation plan

This plan implements the [PR ownership design](../specs/2026-11-24-software-platform-pr-ownership-design.md) and tracks delivery in BI-C3EBDCEC and WC-40C49642. The phases are internal sequencing for a single change. Adoption needs a repair route, and either path needs terminal settlement to avoid leaving another live room with no next action.

## 1. Inventory and ownership

**FLOW-PR-1** extends the contributor inventory’s GitHub reader, `syncAndBind` in `contributor-inventory-sync.ts`, and `pull-request-binding-runtime.ts`. Prove completeness of the open population, bind prior rooms before routing unmatched PRs, and reconcile custody through the current Workroom repository. Use the existing standing room and roster declarations in `packages/storefront-templates` for applicability and accountability. Preserve existing shape references when updating the declaration.

**CONTRACT-PR-IDENTITY** binds one current occurrence to its managed repository, PR number, base branch, head repository, head ref, head SHA, and authority. A duplicate sync or webhook can repeat an observation. A stale observation cannot acquire custody or replace a live executor. A lapsed lease uses the existing handoff reservation and fence.

**VERIFY-PR-1** covers AC-PR-1 with replay, concurrent binding and adoption, ETag reuse, an old still-open PR, partial pages, provider outage, stale head, a fork sharing the same ref, a live lease, and an eligible lapsed lease. Assert one room per PR, with a recovery reason where the system can observe but cannot act.

### Custody admission and recheck

`WC-0147A0E4` completes the existing inventory and ownership phase for rooms that have a PR but no actor able to advance it. The standing duty can steward a PR, but a reviewer on its roster is not automatically a repair executor. Resolve a recorded active human who can own the work and use the existing Workroom ownership path when creating custody or handing off an eligible lapsed lease. Leave active leases, valid owners, existing admission decisions, and the repair dispatcher's authority checks intact.

On a complete inventory sweep, check the exact PR and head before reconciling existing custody. If nobody admitted can act, keep the same room in observation and record a hold naming the next responsible coordinator or existing owner. Recheck on the next complete sweep. Repeated observations of the same hold do not create more rooms or activity. An admitted, eligible coordinator can resume same-head custody without changing an existing lease or overriding an advise-only posture. A different lapsed owner still requires the normal handoff.

Extend **VERIFY-PR-1** with a reviewer-only dependency PR already in custody. Verify one hold across a replay, then admit an eligible coordinator and verify one resume on the same room. Also verify that an exact ownerless PR reuses its room, a current lease is untouched, and a lapsed room with a different owner records a hold without transferring it. Use the binding runtime's focused tests and the localization, style, and Spec/Plan/Doc guards before the exact-tree gate.

The installed acceptance in **VERIFY-PR-3** still requires an eligible dependency PR to reach a provider-confirmed outcome without a chat takeover. A mislabeled dependency PR such as #7184 needs an authorized supersession decision or an acknowledged hold on its actual head. It is not a successful merge fixture.

## 2. Bounded repair and protected publication

**FLOW-PR-2** extends `build-pr-delivery-reconcile.ts` and `pr-ci-repair.ts` after FLOW-PR-1. Use the existing repair dispatcher, outcome record, review readiness refresh, and queue writer. Select a repair executor for verified PR-only custody through the existing Workroom authority path. A FeatureBuild, when already linked, keeps its established path. The repair dispatcher spends the existing per-PR attempt allowance and records a bounded hold or escalation when it cannot acquire an eligible worker.

**CONTRACT-PR-REPAIR** carries current PR facts and the existing bounded repair packet. Re-read identity before writing. Publication preserves dependency intent, requires current review and DCO, and uses the protected merge queue. CI output is evidence about the failing check. Tool and publication authority comes from the Workroom policy.

**VERIFY-PR-2** covers AC-PR-2 and AC-PR-3 by reproducing the failing guard class from PR #7180, deduplicating and refreshing the allowed dependency artifacts, and leaving a deliberate SBOM budget increase awaiting policy. Exercise an exhausted bound, unavailable replacement, a cleared hold, and a stale repair callback. A canonical nonproduction run must demonstrate source checks, a signed new head, independent review, and queue admission before claiming live verification.

## 3. Closeout and installed verification

**FLOW-PR-3** extends the existing PR delivery and Workroom terminal settlement after FLOW-PR-2. Use a provider-confirmed merge or closure at the exact occurrence. Record an undelivered outcome if the PR closed without merging and the room is eligible to end. Retain any scope needed to carry outstanding authorized work. Keep local source and queued effects subject to the current cleanup and writer fences.

**CONTRACT-PR-CLOSE** preserves distinct outcomes for delivery, withdrawal and supersession. Never infer delivery from a branch title, mergeable status, failed provider read, or replacement PR.

**VERIFY-PR-3** covers AC-PR-4 using merged, closed, closed with outstanding local work, and stale or out-of-order observations. Verify that a successor never reuses the old PR identity. In the canonical installed runtime verify open PR coverage, autonomous handling of an eligible red dependency PR, protected merge, and the correct terminal Workroom readback.

## Admission and rollback

Record the source impact contract before code edits and add its required tests, guards, and documentation dispositions to the appropriate phase. Begin with focused inventory, ownership, delivery, and closeout tests. Run package typecheck and the exact-tree gate before publication. Use the canonical shared environment for runtime effects and verify live behavior only after the matching install is available.

If activation causes a regression, suspend the new adoption and repair effects through the existing job or policy controls and fence in-flight writes. Retain Workrooms and their evidence. The existing observation and provider protection paths remain available while the repair is corrected.

## Backlog coverage

The phases below deliver BI-C3EBDCEC as one change. The independent design review approved the objectives and acceptance criteria. The plan coverage receipt is pending.

| Phase | Objective | Acceptance | Contract | Flow | Verification |
| --- | --- | --- | --- | --- | --- |
| Inventory and ownership | OBJ-PR-OWN | AC-PR-1 | CONTRACT-PR-IDENTITY | FLOW-PR-1 | VERIFY-PR-1 |
| Bounded repair and protected publication | OBJ-PR-REPAIR | AC-PR-2, AC-PR-3 | CONTRACT-PR-REPAIR | FLOW-PR-2 | VERIFY-PR-2 |
| Closeout and installed verification | OBJ-PR-CLOSE | AC-PR-4 | CONTRACT-PR-CLOSE | FLOW-PR-3 | VERIFY-PR-3 |
