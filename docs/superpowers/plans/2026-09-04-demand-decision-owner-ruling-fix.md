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

| Ref | Trace |
| --- | --- |
| OBJ-DDOR-001 | Every unresolved organization-profile WWWD decision is owner-rulable through Review & adjust. |
| OBJ-DDOR-002 | Platform, build, task, profession, kernel, answered, and malformed decisions remain excluded. |
| CONTRACT-DDOR-001 | `DecisionPerspectiveProfile.profileId` is the organization decision-ownership boundary. |
| FLOW-DDOR-001 | `/ops/demand` → `DecisionInteraction` → Review & adjust → existing `OrgDecisionCaptureList` resolution. |
| AC-DDOR-001 | An unresolved `/ops/demand` organization decision appears in Review & adjust. |
| AC-DDOR-002 | Existing `/coworker-business` decisions remain visible. |
| AC-DDOR-003 | Every fail-closed exclusion remains enforced. |
| AC-DDOR-004 | Red/green predicate tests and canonical-runtime UX verify the repair. |

## Risks and rollback

The blast radius is the owner decision inbox query. Over-broad selection could expose platform or task-scoped decisions; the negative predicate assertions guard those boundaries. Rollback is the single PR revert, restoring the prior route-specific query while leaving all persisted decisions unchanged.

## Backlog coverage

The atomic mapping above is pending a governed receipt because no initiative scope baseline exists for BI-EB5E9BE3. The independent spec-approval route must establish that baseline before the coverage writer can bind this plan to it.
