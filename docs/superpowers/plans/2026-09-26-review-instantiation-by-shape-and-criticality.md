---
status: active
---

# Plan: review is instantiated by workroom shape and step criticality

- **Backlog item:** BI-E27F3600
- **Design:** `docs/superpowers/specs/2026-09-26-review-instantiation-by-shape-and-criticality-design.md`
- **Prerequisite:** BI-74B2A8CD merged. Phases 2 and 6 call `resolveDecisionEscalation`, `decisionAllowsStep` and the shared damaging definition it adds to `apps/web/lib/govern/authority/escalation-gate.ts`. No phase starts before it lands.

Owner revision, 2026-10-15: target one PR for the related participation and
consultation repairs. The phases below are internal sequencing, not a requirement
for six PRs. Reconcile delivery mappings and renew independent coverage for the
revised design before implementation. Until phase 6, retain the existing decision
behavior; never enable a hold without its executable reviewer path.

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

## Resumption and expanded participation scope, 2026-10-15

Codex took over WC-8D35443E through the approved executor-transfer envelope,
preserved the two design/plan commits and rebased only those commits onto
origin/main at b338f06e581e6cc7886c334b519f098feb142865. No implementation
existed on the resumed branch. The managed readiness probe reports source-only
(`node_modules` and the generated Prisma client are absent); no test or typecheck
pass is implied.

Apply design section 7 before sequencing the revised implementation:

1. Reconcile BI-74B2A8CD with its existing room/branch. It remains the prerequisite
   for the authority and undecided-hold work; no phase starts before it lands
   under this plan's existing contract. Preserve the other room's ownership.
2. Review the overlapping live items named in design section 7. Map authoring
   participation, complete profession coverage, external consultation and
   executed-result evidence onto their proper existing BIs. BI-0AABCD1F remains
   research intake until that mapping and design coverage are accepted.
3. Obtain independent review of the changed scope and immutable revised artifacts;
   renew the baseline/plan coverage. Old receipts cannot authorize AC-7–AC-10.
4. Extend the existing classifier with deliverable requirements before path-based
   inference. Replace silent three-profession truncation with bounded scheduling
   that retains all required contributions. Include roles needed during authoring
   as well as independent review.
5. Trace a real service engagement from request through dispatch and returned
   revision-bound evidence. Reuse the task/room/evidence substrate and preserve
   honest pending, failed and unavailable states. A request row earns no pass.
6. Add the supported external-caller craft consultation seam while retaining the
   authenticated actor, scoped grants and explicit consulted-profession ledger.
7. Complete phases 1–6 against the then-current substrate. Update the architecture
   and contributor documentation; compare the resulting diff against the renewed
   impact contract before testing or publication.

Required functional evidence includes more than three required professions,
an HTML prototype before React paths exist, different room criticalities over
identical files, failure of one contribution, independent author/reviewer
principals, a stale revision refusing reuse, and a governed Codex-to-UX consult
whose evidence identifies both actor and consulted craft. Preserve advisory
calibration limits. Source-local tests, typecheck, shared-runtime workflow proof
and protected PR checks remain required; none has run on this revision.

For this docs-only planning revision, the recorded impact contract has no
testImpact or guardObligation entries and requires the derived doc index check.
Run the available doc guards and record any unavailable checks as unrun.

### Backlog coverage status

The original immutable six-deliverable coverage belongs to the previous scope.
This expanded plan has **coverage pending**, not a fabricated replacement receipt.
Do not enter implementation until the dependency and revised coverage above are
resolved. This is a resumption checkpoint, not a completed design or shipped fix.
