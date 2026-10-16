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

Source checkpoint, 2026-10-16: the shared classifier now validates against
`PROFESSION_REGISTRY`, recognizes a registered family's own corpus path without
a resident-room entry, and normalizes path separators/case. Existing resident
order and first-match routing remain stable; additional families follow canonical
registry order. Four executed red cases and a separate resident-whitelist
negative test preceded the fix. Thirty classifier, advisory-consumer and registry
tests, both TS7 programs and style/whitespace checks passed. This is prerequisite
work only: the semantic selector/persona roster is still present, and live
eligible-coworker resolution and independence checks remain to be integrated.

Source recovery checkpoint, 2026-10-16: `evaluate_profession_decision` now accepts
an explicit `consultProfessionKey` separately from authenticated actor identity.
It validates the canonical profession registry, resolves the named craft, retains
the actor and caller in the ledger, and returns `advisoryOnly: true` with
`allowed: false`. This does not dispatch a specialist or satisfy a review receipt.
Six new regressions first failed, then all 46 tests in the gate, pack and phase
consult suites passed; both TypeScript 7 programs and the style guard passed.
Native consultation, integration gate and live acceptance remain unrun. The
attempted Workroom feed post was refused as not-admitted; no alternate write path
was used. Existing source-recovery authority permits this bounded source repair,
not bypassing admission, grants or independent receipt writers.

Source recovery checkpoint, engagement execution, 2026-10-16: the existing
request tool can now resume a caller-owned engagement using a Workroom stage
and immutable repository artifact. Source adds a closed advisory task binding
to the existing TaskRun digest, atomic admission and deferred-message/outbox
path, background reconstruction, execution and governed-tool checks. Admission
rechecks current credential/actor/provider grants, offer boundaries and exact
room admission; it grants no membership. Source/result metadata is server-owned.
Settlement projects only evidence-backed contributions; source/corpus tool
execution IDs, criteria and current revision are required. An author disposition
remains explicitly pending. Failed, unavailable and unknown outcomes cannot be
projected as successful specialist work. A read of the existing request repairs
a lost status projection without launching another task.

The live UX offer is internal, low risk and proposal-only; that boundary is
retained. Its critique-corpus lookup is included, and an empty calibrated set is
recorded as a limitation rather than a calibrated verdict. No provider grants
are added. The first new-module run could not import the absent module (no tests
executed); a later metadata-forgery regression failed against the old creation
path, then passed. The broader source run passed 739 tests across 63 suites;
the subsequent focused run passed 39 tests across four suites. Current source
still needs independent authority assessment, task-boundary/reconstruction and
projection regressions, the canonical integration gate and live execution.
Required-profession scheduling and per-step review wiring remain outstanding.
The served target is still b8de657544c4 and does not contain prerequisite6432;
source recovery is not a native baseline approval or live delivery claim.

Independent source assessment of engagement commit acb3f63b63f49385f9ce25a9f9f1ba08c9e4b83b
held two P2 findings: unknown engagements could not observe a later verified
original result, and canonical providers could be rejected at their registered
runtime identity. Corrections keep unknown effects parked, allow read-only
reprojection of the same association, and use the existing canonical/runtime
identity contract with grants and room checks for both records. A room-session
credential is additionally restricted to its original room and run. The room
credential regression failed when the check was removed, then passed restored;
the unknown-result regression failed after DB injection made the actual control
flow testable, then passed. The focused run passed 104 tests across four suites.
The next focused run passed 116 tests across five suites, including actual
background reconstruction: the original binding survives, a changed revision
fails its digest, and widened persisted tools are refused even if a digest is
recomputed. That last regression first failed before the worker reused the
closed submission parser. Both TypeScript 7 programs passed after correcting
test-fixture literal types; the commit hook had correctly rejected those test
type errors. The new delta still requires independent reassessment and
canonical/live gates.

The phase-3 edit claim was refused on three existing scopes: semantic review
background belongs to WC-82EAA947, and routed review/its MCP pack belong to
WC-AF5C3944. Their owners are being coordinated; no force claim or overlapping
edit was made. The classifier and remaining scheduler are not delivered merely
because these source repairs exist.

Further source hardening binds the task objective and complete server-built
prompt to the original engagement at submission, transactional admission and
execution. A direct-content substitution regression first failed, then passed;
the focused task/engagement run passed 76 tests across four suites. This delta
is not covered by the c833 independent assessment until separately reviewed.

Readback correction: bound engagement results now require current Workroom data
access in the MCP read path and in the existing authenticated A2A read route.
The session's user identity is passed to that reader; an unadmitted or missing
principal receives no task contents. The cross-room MCP result and authenticated
A2A disclosure cases both reproduced before the checks, then the focused run
passed 40 tests across three suites. The Workroom session's `runRef` is checked
against the actual `room.taskRunId` used by its issuer, not the unrelated drive
cycle key; that contract regression also first failed before correction. No
credential scopes or grants were added. Independent review and live acceptance
are still required for this delta.

Source checkpoint, live specialist selection, 2026-10-16: qualified main through
517143a53e6 is merged at dbb6118614372b7f7266a9359561613cfe0f7015.
Independent assessment found no blocking issue in the engagement port to the new
shared persisted-request module. The combined task recovery/engagement run passed
136 tests across eight suites; both TS7 programs and normal merge hooks passed.

The external and Build Studio admission paths now derive required professions
from declared shape stages and the shared classifier, resolve current selectable
canonical/runtime pairs, and exclude the actual requester, contributor identities
and Build Studio build-task authors. All required families remain accounted for.
Selections bind the person, room, registered families and authors into a digest
that also separates gate identity and receipt freshness. New reviews use the
profession-bound reviewer version; persisted older contracts retain their old
reader/dispatch behavior. The legacy four-persona compatibility path remains
only for those historical inputs, rather than silently changing queued prompts.
Programmatic and compiled shapes validate optional profession declarations.

New dispatch revalidates current identity, grants and exact room content access,
requires recorded craft material, uses human craft labels, and schedules every
required branch in batches of at most three. Missing providers, corpus or
contributions cannot yield a passing review. This code does not grant membership;
room-bound assignment, stage receipts and authoring participation remain pending.
The first missing-module run executed no preparation tests. New regressions for
room/actor binding, missing providers, corpus, shape validation and selection
freshness reproduced before their corrections. The broader run passed 490 tests
in 28 suites; both TS7 programs, GPP freshness and style/token checks passed.
Native specialist execution, canonical integration and live acceptance are still
unrun. No interim decision hold has been enabled.

Source hardening checkpoint, 2026-10-16: selection now prefers the registered
acumen steward rather than alphabetically substituting a different role in the
same family. A red case selected UX Accessibility in place of UX Design Critic.
Required craft contributions stay advisory: the independent Change Reviewer runs
after all contributions complete, receives their proposed findings as data, and
retains the existing severity-based verdict contract. Missing contributions leave
review inconclusive before that final inference. The critic gains no blocking or
calibrated authority. An explicit regression reproduced the unwanted blocker.

UX branches now read the calibrated critique corpus as well as their recorded
profession pages. Server metadata retains page references and the exact prompt
material fingerprint across paid-for checkpoints. An empty calibrated set is an
explicit limitation in the combined receipt. Provider text cannot manufacture
that metadata. Engagement projection additionally requires calibratedOnly=true
for its UX critique lookup; the negative test reproduced false calibration before
correction. Preparation includes paths parsed from the immutable diff, even when
the supplied path list omits the prototype. The existing diff splitter is reused.
The broader source run passed 530 tests in 30 suites; subsequent focused checks
and both TS7 programs passed. Native execution and integration remain unrun.

The pure resolveStepReviewNeed calculation now composes shape/stage floors with
the shared review-authority rule and retains every required family. Four new red
cases preceded the implementation; 75 tests in three related suites passed.
Identical impacted paths draw core-only review in a routine small step and the
full impacted set plus architecture in a critical large step. Stewardship narrows
review depth without lowering criticality or the damaging human boundary. This
calculation is not yet a runtime consumer or an enabled interim hold.

Canonical DEV recovery101 is served at b3dc42544260f6afccae94bf1e767af88b45383a;
readiness now confirms prerequisite6432 containment. The amended research receipt
was refused because the Workroom still records historical head48ad78b7a1b3.
Follow the supported head-sync procedure after freezing the current source; do
not bind a review to a fabricated or rewound Workroom head. Current design and
architecture receipts are stale, not renewed approvals.

Independent review of adf3ecd8e618 raised one P2: entry admission did not
revalidate authority before later batches or the final inference. Both revocation
regressions reproduced a false pass, then passed with a current check inside
every actual inference callback. A completed room is also refused before new
preparation or dispatch. No provider identity is substituted; no membership or
grant is changed. The focused recovery/selection run passed 109 tests across
three suites; the subsequent room/dispatch/selection run passed 41 tests in three
suites, and both TS7 programs passed. Independent closure remains pending.

The Workroom has now been synchronized through normal adoption to exact local
head adf3ecd8e618cceb52457cca9460e16778a2b767. Renewed author research against
that immutable artifact was then refused by the repository provider with HTTP422
because this local source is not yet published. Native receipts remain stale;
source assessments are not replacement approvals. Preserve the original review
and engagement identities while completing the normal publication/evidence path.

## Phase 4: room-bound instantiation

Design section 8 supersedes the original external `stepReviewBinding` proposal.
Reuse the semantic-review TaskRun and fenced per-agent TaskNode checkpoints;
do not add an external terminal writer or repurpose the CI-correlation tool.

- Extend the immutable contracts in `semantic-change-review.ts` and `semantic-review-request.ts` with server-derived room, current stage, head, criticality, authority and complete profession obligations. Version new requests explicitly; preserve historical packets, identities and unknown effects.
- Resolve stage facts in `review-specialist-preparation.ts` before selecting providers. Inspect the existing room/shape, item sensitivity and transition-risk readers; an unresolved required fact leaves admission outstanding rather than defaulting to a lower floor. Keep authoring obligations distinct from independent review depth and exclude author identities from every independent reviewer, including the core reviewer.
- Add the claimed `step-review-participants.ts` seam beside the existing admission store. Validate original actor/token/consent, legitimate room-invitation authority, current canonical provider grants and both execution identities, independence, sensitivity and restrictive room policy before any write. Reuse `room-participant-assignment.server.ts`; preserve existing roles and refuse removed participants or policy widening.
- In `semantic-review-single-flight.ts`, put new participant assignments and the same durable TaskRun admission in one transaction. A repeated request subscribes to its original admission; it creates no replacement task or participant lifecycle reset. Existing native per-provider checkpoints remain the distinct evidence obligations.
- Tests: authorization refusal writes neither participant nor task; a transaction failure rolls both back; concurrent admission has one winner; a removed participant stays removed; restrictive policy and revoked canonical authority refuse; alias grants cannot restore a revocation; original actor and room/stage/head remain bound after reconstruction. Resolve graph-linked and colocated tests for every changed seam before Red; unresolved impact advice expands the gate.

## Phase 5: need and traceable receipts

- Connect the existing pure `resolveStepReviewNeed` to server-owned preparation, then `resolveSemanticReviewCoordination`. Required authoring professions remain accounted for even when independent review is routine. Every required profession has a result or an explicit unavailable obligation; bounded concurrency never truncates the set.
- Bind `stageKey`, exact head, criticality, authority, providers, corpus fingerprints and author disposition into immutable request and receipt identity. A stage/head/authority change invalidates reuse. Use the existing semantic background packet forwarding and per-agent checkpoints; coordinate its file owner before editing that module if a real change is needed.
- Recheck current actor, room, stage and provider authority before each inference and the final independent core review. Craft proposals remain advisory and cannot manufacture blocking authority, calibration or source-read provenance.
- Extend the existing engagement lifecycle with a supported revision extension and author disposition while retaining prior requests, findings and original task effects. A completion projection must match the current stage and artifact and retain actual source/corpus evidence. Never re-label an earlier critique as coverage for a corrected artifact.
- Tests: identical files in routine/small and critical/large rooms draw different review depth and name its cause; a declared HTML prototype requires UX before React files exist; more than three required professions all receive accounted outcomes; partial failure cannot pass; stage/head changes and revocation during execution stop later calls; authoring and independent review use separate eligible principals; accepted/rejected author dispositions retain the contribution and rationale.

## Phase 6: undecided decisions hold for review

- Only after the amended reviewer path is executable and verified, set `INDEPENDENT_REVIEW_INTERIM = "hold"` (BI-74B2A8CD §3.6) and dispatch a step review at `consequential` for an `independent_review` decision route, carrying its follow-on. Preserve the current behavior before qualification; an unavailable reviewer is not a fabricated receipt.
- Tests: an undecided non-damaging decision holds its step until a reviewer receipt releases or blocks it; a damaging one still goes to a person.

## Traceability

| Deliverable | Phase | Requirement | Contract | Flow | Verification |
|---|---|---|---|---|---|
| step-criticality | 1 | OBJ-NEED | resolveStepCriticality | design §3.1 | AC-1 |
| review-authority | 2 | OBJ-AUTHORITY | resolveReviewAuthority | design §3.5 | AC-5 |
| craft-classifier | 3 | OBJ-CRAFT | deriveImpactedAcumens | design §3.3 | AC-3 |
| room-instantiation | 4 | OBJ-INSTANCE | immutable semantic request and fenced TaskNode obligations | design §8 supersedes §3.4 | AC-4 |
| need-and-receipts | 5 | OBJ-NEED | resolveSemanticReviewCoordination | design §3.2 | AC-2 |
| undecided-hold | 6 | OBJ-UNDECIDED | INDEPENDENT_REVIEW_INTERIM | design §3.6 | AC-6 |
| declared-profession-obligations | 4-5 | OBJ-CRAFT | requiredProfessions and current-stage preparation | design §7 and §8 | AC-7 |
| complete-craft-scheduling | 4-5 | OBJ-INSTANCE | immutable semantic request and per-agent TaskNode | design §7 and §8 | AC-8 |
| returned-contribution-and-disposition | 5 | OBJ-INSTANCE | engagement task binding and attributable result | design §7 and §8 | AC-9 |
| explicit-profession-consult | 3 | OBJ-CRAFT | consultProfessionKey with original actor ledger | design §7 | AC-10 |

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


## Current source checkpoint, 2026-10-16

Independent source assessment of exact `1a90d9c788ea03b7cab450e61f14efc237ca1fdf`
closed the per-inference authority P2 and found no remaining blocking finding in
the 1d0566f/adf3ecd/1a90 selection/corpus dispatch scope. This is a peer source
assessment, not a native receipt or live UX acceptance. The latest native room
head is adf3ecd; publication of this local tail is still owed.

Host preflight failed on import-cycle growth and missing seed/convergence
attestations. The cycle repair separates immutable engagement contracts from
execution so request parsing no longer imports the fulfillment runtime. Keep
runtime submission in the existing external coworker adapter. Do not raise the
cycle baseline. The two affected seeded principle/craft pages express shared
platform rules and general UX craft, so the seed-fit decision is global-default.
Convergence uses promote.sh step 4b -> docker-entrypoint.sh -> seed.ts, including
seedWikiKernel and idempotent seedProfessionCorpus. Existing custom overlays and
human calibration are preserved; this is not an install-local database edit.

Section 8 of the design proposes the native TaskRun/TaskNode amendment. Obtain
independent assessment and reconcile the native baseline after publishing the
immutable source. Participant/stage integration and the undecided hold remain
unimplemented, and no superseding native approval is claimed.

The capture regression reproduced the browser-session refusal with the old
transport call. The repaired MCP path passed with no browser session, retained
the actual authenticated user and forced draft/agent-proposed metadata despite
forged user and founder fields in tool input. Missing authenticated identity
wrote nothing. The three capture/wiki suites passed 36 tests; the focused
engagement/capture run passed 71 tests in five suites. Both transport wrappers
retain their own authentication boundaries. The live rejected critique was not
saved by an alternate path.


The independent reviewer assessed exact 0bb4542cb218487005947552f53adc155992379e:
no blocking source finding in the critique transport repair, and section 8's
native TaskRun/TaskNode amendment is architecturally coherent. This remains a
source assessment, not native EA/baseline approval. Narrow capture additionally
refuses collisions without updating an existing calibrated page; 38 tests in the
three focused capture/wiki suites and both TS7 programs passed.

The import-cycle repair now passes at the existing 75-file budget, with no
static value cycle and no baseline increase. Immutable engagement parsing is a
leaf contract; submission remains in the existing external coworker adapter.
Two callers now import the provider implementation directly instead of a cyclic
compatibility re-export. Ninety-seven tests across six selected engagement,
adapter, readiness and attention suites passed. Seed-fit and convergence guards
passed after adding the recorded global-default/auto-converges attestations.
Canonical integration, native baseline renewal and live acceptance remain owed.


The exact merged-source preflight at 50ca4f3 failed after 558 seconds, before
claiming a local-CI lease. It caught type re-exports in both new server-action
wrappers. The image-script dependency check also found a new static zod edge
through live-specialist-selection; its enclosing host stage was inconclusive,
which must not be treated as a pass. The wrappers now retain inline type aliases,
and immutable selection schema/digest live beside the existing semantic receipt
schema, below the live provider resolver. Both failed guards now pass, as does
the unchanged 75-file cycle budget. All 129 tests in eight affected suites pass.
A transient lazy-import experiment failed the concurrent pack test and was
removed; admission retains its original static preparation seam. The next
canonical gate must cover this corrected source, not reuse 50ca4f3 as a pass.


## Integration correction and next implementation boundary

Candidate 1f710ccb59433e518b6d016b9577c3cd5c245edd passed all 84 host guards,
then its admitted NPEL-C2698B78ED integration failed and recorded evidence
cmvaq4nw30eoe01pdmn6rbe1d. The run had 11,279 passing tests, one schema-parity
assertion failure and a GPP emitter worker heap failure. This is a FAIL, not a
passing gate. The corrected uniqueness test also exercises duplicate required
professions; its 34 focused tests passed.

The emitter heap failure reproduced alone. Pure semantic coordination still
imported the live provider selector for a schema/digest that already had a
contract home. Removing that edge and keeping profession/criticality vocabulary
in dependency leaves reduced the shape-type compiler graph from 1,837 to 1,316
files. The full 13-test emitter suite then passed without increasing heap size.
A regression guard rejects live specialist runtime in the offline type program;
reintroducing the bad edge produced the intended explicit failure, not an OOM.
The control root checkout bd3540d6 passed 13 emitter tests; it is not a claim
that current main or this corrected branch has passed canonical integration.

Current read-only live evidence also exposed raw alias-grant intersection in
the engagement validator. A real-shaped empty-alias regression failed against
that implementation. The correction reads canonical authority owners while
preserving actor attribution, canonical revocations, both identity lifecycles
and room checks. The provider's missing file_read is still refused: no live
grant or membership was changed. Design section 9 proposes a separately
qualified actor-owned artifact handoff, not an implemented permission fallback.
Its sensitivity/provenance checks require substrate inspection and independent
frozen/native assessment before implementation.

After the source corrections pass the normal gate, publish the immutable branch
so native artifact readers can renew the expanded design, architecture, baseline
and plan coverage. Then complete stage/participant obligations, authoring versus
independent review, actual returned contribution/disposition and served UX
acceptance. Preserve old unknown executions and the B22 handoff owner's scope.


Correction verification: 404 tests in 18 affected compiler, registry, review,
authority and engagement suites passed, including the new compiler dependency
guard and canonical actor/empty-provider-alias/revocation cases. No heap limit
was raised. The type-reexport, image-script dependency and unchanged 75-file
cycle guards passed. Live-specialist authority and prototype acceptance are
still unrun on this corrected source; the existing failed native gate is retained.

## Published checkpoint and current boundary, 2026-10-16

### Acceptance evidence to collect after qualification

| Outcome | Required proof | Does not satisfy it |
|---|---|---|
| Specialists selected for the deliverable | A declared UX prototype requires UX before a changed React file exists; a non-UX deliverable selects its owning profession from the registry; the room names the current stage and each obligation. | A static roster or every profession assigned to every room. |
| Complete participation | More than three required professions retain distinct attributable outcomes across bounded batches. One failed or unavailable contribution remains outstanding. | Three successful branches with the remaining obligations omitted. |
| Independent review | Authoring contributors and the core/craft independent reviewers have separate eligible principals; current stage, head, consent and revocation checks are exercised through admission and each inference. | A role label, invitation or the author reviewing its own contribution. |
| UX craft actually applied | The UX critic's returned assessment names the current immutable artifact, consulted WSID/corpus references and versions, concrete criteria/findings, calibration limitations and the author's disposition. | A requested engagement, client-authored critique or an empty calibrated corpus described as support. |
| Useful density and disclosure | The owning UI delivery verifies aligned account comparison with status, actionable cause, next timing, work boundary and next action visible. Secondary model inventories and diagnostics disclose on demand. Verify desktop and a 390px viewport with readable text and usable controls. | More text, smaller targets, hidden blocking facts or a screenshot without functional checks. |
| Human-readable surface | Human account/model/work labels identify records and actions; opaque IDs are confined to useful diagnostics. Inspect the relevant served pages because the original attached screenshot itself showed no opaque IDs. | Treating the owner's report about other pages as a finding visible in that screenshot. |
| Routine bounded handoff | BI-5366EF78 proves request, receiver acknowledgement and completion within the existing authority and room envelope without an unnecessary person gate. True authority, credential and damaging boundaries remain enforced. | Historical BI-B22C8E02 diagnostics or approval of the already-executed invitation. |

These are acceptance obligations, not executed results or a new coverage receipt.
The provider-page and routing UI owners retain their implementation scope. Bind
served proof to the containing deployed revision; a merge, source-local pass or
transport repair alone does not close their UX acceptance.

Exact d33af4512f5f81c14400e795f1aa59caf88cbf2a passed canonical local-CI
evidence cmvarkqmw0bct01t3qxkypfsa and was normally pushed. The merged tree
d843a2dc7abd897cc37fba4191a666c470309916 passed 990 suites and 11,541 tests,
both TypeScript programs, 58 repository guards and all 633 migrations. Sixteen
suites and 78 tests were skipped, with five todo tests. The production build is
delegated to the merge queue; this is no production-build or live acceptance
claim. Independent client SOURCE0 covers the exact correction; it is not a
native review receipt. The earlier 1f710 failure remains failed.

Author research is recorded as initiative-19a6682a-32df-47e1-a263-9141952ec1e0
against the published design blob f3368430fcc01583bf8df57df62caae16f061a72.
The exact issuer's amended spec and architecture requests were submitted without
new human approval. The spec task ending BF8A1F1B2D2F is input-required with
actual unknown provider settlement; its effects must be reconciled before any
retry. The architecture task ending 73E9748A68F5 was submitted and reported
capacity deferral. Neither admission is approval, and the older unknown tasks
are preserved. Native baseline and revised coverage remain pending.

The existing governed capability remedy requested file_read for UX Design
Critic AGT-906. Approval envelope cmvar6kgq079f01t3eeaadva1 is waiting for a
person because this changes authority. No grant changed. This is distinct from
the already-executed invitation. A pending grant cannot qualify a provider.
The proposed canonical grant persists across eligible contexts and covers
project readers/search, version readers and Build Studio artifact revisions.
It has no one-blob, room or expiry restriction. Existing token/user checks,
protected-path rules, canonical-repository provider checks and task bindings
still apply; they do not establish that every accessible artifact is public.
The task's exact artifact allowlist is narrower than the durable grant itself.
Native UX work still refuses until real authority and the containing release
are verified. Design section 9's artifact-sharing proposal is optional future
work, not a prerequisite replacing this supported remedy. Do not implement it
or bypass the current reader boundary to obtain a critique.

The phase 4-6 instructions above now follow design section 8. This plan
reconciliation is preparation, not permission to implement those phases before
the amended baseline and coverage are satisfied. BI-5366EF78 owns the new
bounded request/acknowledge/completion handoff; historical BI-B22C8E02 delivery
does not prove that successor is implemented or accepted.
