---
status: active
---

# Published PR repair verification

Owner: BI-760F2571, WC-2B55BEC9. This is an atomic correction to the existing
[PR follow-through duty](2026-10-01-pr-follow-through-workroom-duty-design.md),
under EP-4614F35E; it introduces no tool, queue or authorization policy.

## Reproduction

At source `4d09e963b91d277d6f36e8753732e175ee840217`, the actual dispatched
defect-repair packet says "after the local gate passes". A targeted Vitest
scenario rejecting that instruction failed (one failure, ten skipped).
The owning design repeats the instruction. Both contradict the existing
[build gate runbook](../../architecture/build-gate-runbook.md#published-corrections-and-host-guard-reuse).

## Acceptance

- REQ-1: Preserve valid executed evidence for an unchanged published head;
  queue delay or infrastructure failure does not require a repeated whole local gate.
- REQ-2: Source corrections require affected tests, reproduction of the named
  failure and independent review of changed code.
- REQ-3: Final main-plus-PR integration belongs to required GitHub checks and
  the protected merge queue; DCO and the existing repair scope remain required.
- REQ-4: Classification, per-head deduplication, recovery budgets, infrastructure
  rerun bounds and prohibitions on force-push or weakening tests remain intact.

## Ordered fix

1. Correct only the existing emitted `PR_REPAIR_CONSTRAINTS` instructions.
2. Reconcile the owning duty design's repair and retained-verification sections.
3. Run the real packet regression and existing follow-through/dispatch tests,
   then affected package typechecks and independent source review.
4. Publish a DCO-signed PR; qualify its protected integration and verify the
   running packet after a later canonical deployment.

## Coverage and verification

One atomic deliverable, BI-760F2571: the packet, owning design and regression
must agree. CONTRACT: existing PR follow-through duty and build gate runbook.
FLOW: published defect classification to bounded repair dispatch. VERIFICATION:
`pr-follow-through.test.ts`, its existing dispatch consumers, package typechecks
and protected GitHub checks. Initial unpublished validation is unchanged.
