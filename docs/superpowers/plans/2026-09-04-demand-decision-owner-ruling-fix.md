---
status: active
---

# Demand Decision Owner Ruling Fix — Implementation Plan

Backlog: BI-EB5E9BE3  
Design: `docs/superpowers/specs/2026-09-04-demand-decision-owner-ruling-fix-design.md`

## Delivery boundary

This is one atomic repair. The query predicate, its regression test, and the page integration cannot ship independently: separating them would either preserve the defect or introduce an unused contract.

## Ordered implementation

1. Add `apps/web/lib/decision/organization-decision-inbox.test.ts` to prove organization-profile decisions from any business route are selected and missing-profile state fails closed. Verify Red against the named pre-fix ref and Green against the fix head.
2. Add `apps/web/lib/decision/organization-decision-inbox.ts` as the typed canonical predicate. Keep build, task, profession, kernel-consult, empty-question, answered, and platform-WWMD interactions excluded.
3. Update `apps/web/app/(shell)/coworker-decisions/review/page.tsx` to resolve the organization profile and use the predicate without adding another owner surface.
4. Run the focused and related tests, typecheck, prose/style obligations, exact-tree `pnpm run pregate`, PR health, merge queue, governed self-upgrade, and live `/coworker-decisions/review` verification.

## Traceability

- Requirement: every unresolved organization-profile WWWD decision is owner-rulable through Review & adjust.
- Contract: `DecisionPerspectiveProfile.profileId` is the organization decision-ownership boundary.
- Flow: `/ops/demand` → `DecisionInteraction` → Review & adjust → existing `OrgDecisionCaptureList` resolution.
- Verification: focused red/green predicate test, related decision-review tests, exact-tree local-CI evidence, and canonical-runtime UX exercise.

## Risks and rollback

The blast radius is the owner decision inbox query. Over-broad selection could expose platform or task-scoped decisions; the negative predicate assertions guard those boundaries. Rollback is the single PR revert, restoring the prior route-specific query while leaving all persisted decisions unchanged.

## Backlog coverage

Pending governed `record_plan_backlog_coverage` receipt for atomic BI-EB5E9BE3.
