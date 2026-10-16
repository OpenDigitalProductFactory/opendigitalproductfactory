---
status: active
---

# Plan: review is instantiated by workroom shape and step criticality

- **Backlog item:** BI-E27F3600
- **Design:** `docs/superpowers/specs/2026-09-26-review-instantiation-by-shape-and-criticality-design.md`
- **Integration prerequisite:** BI-74B2A8CD merged. Phases 2 and 6 call `resolveDecisionEscalation`, `decisionAllowsStep` and the shared damaging definition it adds to `apps/web/lib/govern/authority/escalation-gate.ts`. No authority/decision integration starts before it lands. The original approved phase 1 may be prepared and tested independently: its pure calculation has no dependency on that module and is not wired into runtime dispatch by this preparation.

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

Source checkpoint, 2026-10-16: after merging the completed BI-74B2A8CD source,
the pure `resolveReviewAuthority` calculation is implemented beside its decision
twin. Seven new tests first failed on the missing export. All 224 tests in nine
selected related suites then passed, including all six expected outcomes and a
1,152-combination walk using the shared decision rule's damage fact. Both TS7
programs and the style/token, document-index and whitespace checks passed.
The principle sentence is pinned by the existing conformance guard. No runtime
consumer, calibration mode, grant, approval routing or interim hold changed;
canonical integration and live workflow proof remain outstanding.

## Phase 3: one craft classifier

- Replace `selectSemanticReviewSpecialists` in `apps/web/lib/change-review/semantic-change-review-operation.ts` with `deriveImpactedAcumens`, resolved to live coworkers (acumen `coworkerAgentId`, else the registry family's first active role).
- Remove `SPECIALIST_SYSTEM_PROMPTS` from `apps/web/lib/change-review/routed-semantic-review.ts`; the craft corpus from `specialist-craft-context.ts` supplies the persona.
- Tests: a craft added to the registry is selectable without a code change; identical files give identical crafts.

## Phase 4: room-bound instantiation

- Add `stepReviewBinding` to the external coworker task contract (`apps/web/lib/mcp/external-coworker-task-adapter.ts`), following `initiativeReviewBinding`.
- Extend `apps/web/lib/backlog/initiative-readiness/server-reviewer-dispatch.ts` to dispatch step reviews idempotently on `step-review:<workroom>:<stage>:<head>:<profession>`. Validate the exact server-issued binding, current caller and provider authority, sensitivity and room access before participant assignment or enqueue. Then upsert `WorkroomParticipant` role `reviewer` through `room-participant-assignment.server.ts`; reconcile its association to the same durable task after interruption.
- Generalise `resolveBoundInitiativeReviewBinding` in `apps/web/lib/govern/authority/resolve-coworker-tool-authority.ts` to recognise `stepReviewBinding`, so the reviewer's writer carries `independent-reviewer` steering.
- Tests: missing authority creates neither participant nor task; dispatch is idempotent across interrupted association/enqueue; steering resolves for the bound writer only. Assignment itself supplies no tool grants.

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
   for authority, dispatch and undecided-hold integration. Only the original
   approved phase 1's pure calculation/type declaration may be prepared and
   tested before it lands, with no new runtime reader. Preserve the other room's
   ownership. This sequencing correction does not approve expanded AC-7–AC-10.
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

## Backlog coverage

The following is the proposed coverage reconciliation, not an accepted new
receipt. The checked-in coverage gate allows a plan to preserve a concrete
blocked-by condition; implementation authority still comes from live receipts.

- Decision: atomic
- Rationale: the phases in this branch form one participation lifecycle: obligation selection, bounded authorization, durable dispatch and attributable completion must agree before the changed runtime behavior can be released. The isolated helper is preparation without runtime consumers. The owner requested one combined PR; independent approval/handoff and provider-page work remain outside this delivery and with their existing BIs. This supersedes the earlier proposed decomposed label, which incorrectly combined internal sequencing with independently owned related work.
- Parent: BI-E27F3600
- Receipt: blocked-by: expanded AC-7 through AC-10 need independently accepted revised scope and plan coverage; exact-head claims return historical passes without a new reviewer packet, while independent-review dispatch requires that packet.
- Dependencies: BI-74B2A8CD must land before authority/decision integration; revised-scope review and delivery mapping for BI-0AABCD1F remain pending.
- step-criticality, review-authority, craft-classifier, room-instantiation, need-and-receipts, undecided-hold -> BI-E27F3600 (original six-deliverable coverage; not new scope approval).
- governed external consultation and executed-result/corpus evidence -> BI-0AABCD1F (triage research, design and final delivery mapping pending).
- approval and bounded executor-handoff changes -> BI-B22C8E02 (separate active chat; not implemented in this branch).
- provider-page prototype and compact UX -> BI-7AA4EB6B (separate chat; not implemented in this branch).

The original immutable six-deliverable coverage belongs to the previous scope.
This expanded plan has **coverage pending**, not a fabricated replacement receipt.
Do not implement the expanded scope or runtime integration until the dependency
and revised coverage above are resolved. Original phase 1 is already covered by
the accepted OBJ-NEED / AC-1 baseline and original six-deliverable coverage. Its
source-only preparation does not satisfy AC-1's eventual end-to-end review proof.
The exact-head implementation claim IRD-DC3770D02E22 admitted that existing scope;
it is not evidence of independent approval of this revision. This remains a
resumption checkpoint, not a completed design or shipped fix.

## Source preparation evidence, 2026-10-15

Prepared the original section 3.1 pure `resolveStepCriticality` calculation.
It accepts the already-resolved effective shape, advance kind, transition risk,
server-resolved damaging fact and optional declared stage floor. The calculation
takes the maximum and never grants permission or infers that high review depth
means damage. No runtime dispatcher consumes it yet. The optional stage-field
declaration now uses the same criticality type and vocabulary in `WorkShapeStage`
and the shape-document schema. Lowering and decompilation preserve all three
values while keeping an undeclared floor absent. No existing shape instance was
changed and no runtime authority or review consumer was enabled.

- Test-first red: the new focused suite failed because the calculation module
  did not exist; this was an executed test run, not a missing runtime dependency.
- Green: 13 tests passed in this worktree, including 320 signal combinations
  that verify no input floor can be lowered, and explicit expected outputs for
  each shape, risk, governed transition and damaging declaration.
- `pnpm --filter web typecheck`: passed, TypeScript 7 and generated route types.
- Style/token drift guard and `git diff --check`: passed.
- The managed dependency bootstrap now reports compile-ready with repository-
  pinned pnpm 10.33.2 and zero ignored builds.
- Merged-code gate passed for the preparation commit `3a856b8d051fb5f3c96d5e4eb332cd5d7f09ea53` against main `dca25ccab156b7aa73e990dc1391ab18ffc205f8`: 13 affected tests, both TS7 programs and 84 host guards. Full unit suite, live workflow proof and complete acceptance remain unrun. These results do not cover later document revisions.
  This source preparation is not the end-to-end specialist participation fix.

BI-B22C8E02 is being handled by the separate chat named `Execute BI-B22C8E02`;
this branch does not compete for its approval/handoff implementation scope.

Additional phase-1 preparation verification: the first executed round-trip run
failed for all three declared values because the schema rejected `criticality`.
After the type/schema/lowering/decompilation changes, 1,182 tests in 38 selected
compiler and graph-related suites passed, along with both TS7 programs. The
generated GPP artifacts, style/token drift and whitespace checks passed. These
are source-local results, not a new canonical integration gate or live workflow
proof. Full specialist participation and the expanded baseline remain pending.

## Fulfillment implementation sequence — pending revised review and coverage

These are internal phases of the requested combined delivery, not additional
approved deliverables. BI-E27F3600 retains the proposed participation repair;
BI-0AABCD1F remains its research intake until live delivery mapping is accepted.
The existing coverage block above still applies. MCP is unavailable at this
checkpoint: no new baseline, coverage receipt or source-head synchronization is
claimed. Independent source review can proceed on immutable Git artifacts.

1. **Recover the prerequisite through its existing ownership route.** Latest
   native read before the connector outage shows BI-74B2A8CD open, no active
   rooms, and WC-8D031416 past its lease grace. Preserve the existing
   `fix/decision-escalation-rule-table` branch and worktree. When MCP returns,
   read its current holder/head and use the supported handoff with those exact
   values and a manifest naming unfinished acceptance and preserved commits.
   Do not seize its files, revive an old session identity or invent missing
   escalation functions. No prerequisite handoff has been requested here.
2. **Obtain the expanded design and plan assessment.** Review spec section 7,
   especially the fulfillment binding and actor/consulted-profession split,
   independently of the already-assessed pure helper. Reconcile feedback, then
   obtain the live baseline and plan coverage required by the recorded shape.
   Native code semantic task TR-GATE-A65B7093AF74FAEECF27F9CA was admitted for
   the earlier preparation commit; its outcome remains unknown during this
   outage and it cannot approve a later document revision.
3. **Implement the bounded engagement dispatch connection.** Touched seams:
   `coworker-service-catalog/engagements.ts`, its tests,
   `mcp/packs/coworker-service-catalog-pack.ts` and its tests,
   `mcp/external-coworker-task-adapter.ts` and the current authority resolver.
   Resolve the exact existing engagement/offer/actor/room/artifact on the server,
   check authority before any assignment or enqueue, and route through the
   existing durable task lifecycle. Define the bounded binding in that existing
   contract, with review of the actual grant intersection. Do not silently
   extend `initiativeReviewBinding` to mean arbitrary advisory work. Inspect
   schema and current task enqueue/recovery contracts before deciding where the
   engagement/task association belongs; no new table is presumed necessary.
4. **Record and project actual fulfillment.** Extend the existing engagement,
   A2A result projection and room evidence adapters together. Preserve one task
   per immutable request scope. Map persisted task state and returned evidence
   honestly, including failed, unavailable and unknown effects. A completed
   result requires artifact revision, provider/profession attribution, criteria,
   corpus references or an explicit limitation, and author disposition. Tests
   cover interruption before and after enqueue, repeated reads/fulfillment,
   stale artifact, revocation and unreturned provider effects. Use the original
   approved engagement in recovery; do not create another as a workaround.
5. **Implement explicit cross-profession consultation.** Inspect
   `mcp/packs/profession-decision-pack.ts`, its tests and its imported profession
   evaluator. Add separate actor and consulted-profession semantics through the
   existing evaluator and decision ledger. Tests prove an authenticated external
   software engineer can consult registered UX doctrine while its original actor,
   grants and membership remain intact; an unregistered profession is rejected;
   no caller becomes the consulted specialist or earns its approval by naming it.
6. **Integrate obligations and execute acceptance.** Complete the revised
   classifier/bounded scheduling work and original phases 1–6 only after their
   dependencies and scope receipts are satisfied. Preserve all required professions
   across batches. Verify the original approved UX request and routing prototype
   case with real dispatch and a returned revision-bound contribution on the
   served containing release. Unit mocks, invitation execution, room comments
   and task admission alone do not satisfy AC-9 or AC-10.

| Proposed delivery | Owning coverage to reconcile | Verification |
|---|---|---|
| Engagement dispatch and returned evidence | BI-E27F3600 AC-9; BI-0AABCD1F research, final live mapping pending | authority-negative, interruption, replay, revocation, stale-revision and actual UX-run proof |
| Explicit actor-preserving craft consult | BI-E27F3600 AC-10; BI-0AABCD1F research, final live mapping pending | separate actor/consulted profession, corpus evidence, unknown profession rejection and governed live consult |
| Required authoring/review professions | BI-E27F3600 AC-7 and AC-8 | prototype before React files, more than three obligations, partial failure and independent principals |

**Release and rollback:** keep undecided-hold behavior unchanged until its
executable reviewer path passes. Preserve task identities and completed history
on rollback; never replay unknown provider effects. Disabling new admission must
not erase existing pending work or label it complete. The containing canonical
release and live acceptance are coordinated with the existing release owner;
this source worktree does not build or swap the installed runtime.
