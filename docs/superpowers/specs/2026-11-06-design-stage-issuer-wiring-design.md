---
title: Design-stage issuer wiring
status: active
backlog_item: BI-CAB5D233
---

# Design-stage issuer wiring

Backlog: BI-CAB5D233. Workroom: WC-A764A76A.
Atomic successor of [2026-11-06-design-stage-platform-reviewer-design.md](./2026-11-06-design-stage-platform-reviewer-design.md) (BI-9CCB88C4 / PR #6934).

**Research:** live CAN-TEST of served SHA `d7e6f713a18fcfdd5710e0c21efe252291a7b018` (SUR-2DBD0CF3, 2026-11-06T14:39:45Z). Parent research `docs/superpowers/research/2026-11-06-design-stage-platform-reviewer.md` and WWMD DI-3C73211052BB remain the architecture decision; this spec does not re-open them.

## Evidence and boundary

On the live install after #6934:

1. `apps/web/lib/mcp/standing-connection.ts` skips credentials-kind rows when `toolName === "request_coworker"`.
2. `dispatchReviewerRequest` calls `routeToPlatformReviewer` only when `args.issuer` is set. Otherwise `platform.kind === "not-applicable"`.
3. `dispatchOwedIndependentReviews` passes issuer only for `candidate.target === "completion"`.
4. `liveReviewerDispatch` in `apps/web/lib/queue/functions/workroom-drive-review-stages.ts` passes no issuer.

Live AC-3 of BI-9CCB88C4 therefore failed: BI-015012AA design-spec recovery stayed `reviewerRoutes []` / `workroom-not-found`, and no `WC-DSR-*` capsule existed. WC-11DD9FFD is lease-expired; this item does not force-claim it.

## Design grounding

Keep option D + room-key D2. Pass the same issuer identity PIR already uses into every design-stage `dispatchReviewerRequest` call:

- `liveReviewerDispatch`: `issuer: { userId: input.userId, agentId }` from the room author.
- `dispatchOwedIndependentReviews`: issuer when `target === "design"` as well as `"completion"`, from `candidate.room`.

Do not change `isCurrentOAuthExecutionAuthority`. Do not let a credentials client call `request_coworker`. Do not implement BI-015012AA / OSM. Do not mutate peer-owned BI-30EB6898. Do not reopen BI-9CCB88C4.

## Objectives and acceptance

**OBJ-1:** When the authoring assistant has no consent-bound carrier, an owed design-spec, spec-approval, or architecture-review packet is handed to the platform reviewer the same way PIR is today, because the dispatcher passes issuer.

**OBJ-2:** Token-bound `request_coworker` from a credentials client remains refused.

**OBJ-3:** After merge and canonical-runtime deploy, a live owed design-spec packet (BI-015012AA when that packet exists) dispatches without a consent-bound Claude or Codex session, or the live proof names the remaining liveness blocker without claiming a pass.

| AC | Objective | Criterion |
| --- | --- | --- |
| AC-1 | OBJ-1 | `liveReviewerDispatch` and `dispatchOwedIndependentReviews` (`target === "design"`) pass `issuer` into `dispatchReviewerRequest`. A test asserts that a credentials-only standing connection plus an owed design-spec packet calls `routeToPlatformReviewer` and returns `outcome: "platform-reviewer"`. |
| AC-2 | OBJ-2 | Token-bound `request_coworker` from a credentials client remains refused; existing PIR issuer tests stay green. |
| AC-3 | OBJ-3 | After merge and canonical deploy, BI-015012AA's current design-spec packet is dispatched without a consent-bound Claude/Codex session, or the recorded live proof states that the authoring room is still lease-expired and names that as the remaining blocker. |

## Out of scope

OSM leaf; data/ux/security/compliance/domain/plan-review steward widening; mutating BI-30EB6898; changing `PLATFORM_WORK_SCOPE_KINDS`; force-claiming WC-11DD9FFD.
