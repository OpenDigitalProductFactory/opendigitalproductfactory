---
status: active
---

# Plan: review is instantiated by workroom shape and step criticality

- **Backlog item:** BI-E27F3600
- **Design:** `docs/superpowers/specs/2026-09-26-review-instantiation-by-shape-and-criticality-design.md`
- **Prerequisite:** BI-74B2A8CD merged. Phases 2 and 6 call `resolveDecisionEscalation`, `decisionAllowsStep` and the shared damaging definition it adds to `apps/web/lib/govern/authority/escalation-gate.ts`. No phase starts before it lands.

One pull request per phase, in this order. Each phase is independently revertible and leaves the platform working: until phase 6, review still runs, only chosen differently.

## Phase 1: step criticality

- Add `resolveStepCriticality()` in `apps/web/lib/work-management/step-criticality.ts`. It returns `routine | consequential | critical`, taking the maximum of the four floors in design §3.1: effective delivery shape, stage advance kind, transition risk tier, and damaging declaration.
- Add an optional `criticality` field to `WorkShapeStage` in `apps/web/lib/work-management/work-shapes.ts`, read as one more floor.
- Tests: every floor combination; the function never lowers a floor.

## Phase 2: review authority from the rule table

- Add `resolveReviewAuthority({ criticality, damaging })` in `apps/web/lib/govern/authority/escalation-gate.ts`, beside `resolveDecisionEscalation`, returning `advisory | blocking | blocking-with-person`.
- Extend `escalation-gate.conformance.test.ts` to walk every criticality × damaging combination. It proves `blocking-with-person` if and only if damaging, and extends `describeEscalationRule()` plus the principle page with the review sentence.

## Phase 3: one craft classifier

- Replace `selectSemanticReviewSpecialists` in `apps/web/lib/change-review/semantic-change-review-operation.ts` with `deriveImpactedAcumens`, resolved to live coworkers (acumen `coworkerAgentId`, else the registry family's first active role).
- Remove `SPECIALIST_SYSTEM_PROMPTS` from `apps/web/lib/change-review/routed-semantic-review.ts`; the craft corpus from `specialist-craft-context.ts` supplies the persona.
- Tests: a craft added to the registry is selectable without a code change; identical files give identical crafts.

## Phase 4: room-bound instantiation

- Add `stepReviewBinding` to the external coworker task contract (`apps/web/lib/mcp/external-coworker-task-adapter.ts`), following `initiativeReviewBinding`.
- Extend `apps/web/lib/backlog/initiative-readiness/server-reviewer-dispatch.ts` to dispatch step reviews idempotently on `step-review:<workroom>:<stage>:<head>:<profession>`. It first upserts `WorkroomParticipant` role `reviewer`, `assignmentSource: "step-review"`, through `room-participant-assignment.server.ts`.
- Generalise `resolveBoundInitiativeReviewBinding` in `apps/web/lib/govern/authority/resolve-coworker-tool-authority.ts` to recognise `stepReviewBinding`, so the reviewer's writer carries `independent-reviewer` steering.
- Tests: dispatch is idempotent; the participant row exists before the TaskRun; steering resolves for the bound writer only.

## Phase 5: need and traceable receipts

- `resolveSemanticReviewCoordination` derives the review need from the room's shape and the step's criticality (design §3.2), and only then selects crafts.
- The semantic-review receipt gains `stageKey`, `criticality` and `authority` (`semantic-review-background.ts`).
- Tests: the same files in a routine small room and a critical large room draw different reviews, and each receipt names the cause.

## Phase 6: undecided decisions hold for review

- Set `INDEPENDENT_REVIEW_INTERIM = "hold"` (BI-74B2A8CD §3.6) and dispatch a step review at `consequential` for an `independent_review` decision route, carrying its follow-on.
- Tests: an undecided non-damaging decision holds its step until a reviewer receipt releases or blocks it; a damaging one still goes to a person.

## Traceability

| Deliverable | Phase | Requirement | Contract | Flow | Verification |
|---|---|---|---|---|---|
| step-criticality | 1 | OBJ-NEED | resolveStepCriticality | design §3.1 | AC-1 |
| review-authority | 2 | OBJ-AUTHORITY | resolveReviewAuthority | design §3.5 | AC-5 |
| craft-classifier | 3 | OBJ-CRAFT | deriveImpactedAcumens | design §3.3 | AC-3 |
| room-instantiation | 4 | OBJ-INSTANCE | stepReviewBinding | design §3.4 | AC-4 |
| need-and-receipts | 5 | OBJ-NEED | resolveSemanticReviewCoordination | design §3.2 | AC-2 |
| undecided-hold | 6 | OBJ-UNDECIDED | INDEPENDENT_REVIEW_INTERIM | design §3.6 | AC-6 |
