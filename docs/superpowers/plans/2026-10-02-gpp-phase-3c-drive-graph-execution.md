---
status: draft
---

# GPP Phase 3c: drive execution of parallel, rework/refuse, deadline and sub-shape

| | |
|---|---|
| Date | 2026-10-02 |
| Design | [GPP Phase 3c: the work-shape drive executes graph constructs](../specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md), §4 state model, §5 non-disruption, §6 per-construct semantics, §7 switch and guard, §8 deadlines, §9 sub-shape, §10 baseline |
| Parent design | [GPP shape notation, execution semantics and compiler](../specs/2026-10-02-gpp-shape-notation-and-compiler-design.md) §5.4, §6, §11. Not edited by this plan or by any PR in it. |
| Prior plan | [GPP Phase 3a and 3b](2026-10-02-gpp-shape-notation-compiler-phase-3.md) |
| Epic | EP-B932453F |
| Backlog | BI-8875C9DF. First consumer: BI-580A970A (EP-MBSE-WORKROOM-SPINE). |
| Standard | [GPP](../../architecture/gated-permissions-process.md) §7, §12.4 |
| Verified against | `origin/main` at `879b344fa1` |

## Outcome

When Phase 3c is finished, the work-shape drive runs the four executable-flag constructs that the
compiler currently refuses: parallel split/join, rework edge together with refuse routes, stage
deadline, and sub-shape. Each flag in `CONSTRUCT_EXECUTABLE` flips to `true` only in the PR that
also proves the drive and the reference interpreter agree for that construct.

Rooms whose shapes use none of these constructs keep running exactly as they do today, down to
the byte. Today that is every registry definition. A golden captured before any runtime change
proves it. Build Studio is not touched.

## Constraints (binding on every PR)

1. **No disruption to running rooms.**
   - A shape that uses no graph construct goes down the existing code path unchanged.
   - Its persisted snapshot gains no key.
   - Its task id is unchanged.
   - AC-3C-SEQ-IDENTICAL must pass on every PR, not only on the first.
2. **No new dependency.** Parity uses the seeded `mulberry32` already in
   `interpreter-parity.test.ts:49-58`. No `fast-check`, no workflow engine, no timer service.
3. **No Prisma migration.** All state is additive JSON inside `workspaceState.workroomDrive`. If a
   PR finds it needs a column, it stops and comes back to design review.
4. **Build Studio is untouched.** No PR edits `apps/web/lib/build/` (including
   `plan-to-build-transition-core.ts`), `apps/web/lib/explore/`, the Build Studio MCP packs or the
   Build Studio routes. Each PR's verification step includes `git diff --name-only`.
5. **One switch.** Only a flip PR changes `CONSTRUCT_EXECUTABLE`, and it carries that construct's
   parity test. No second runtime flag exists.
6. **Parent spec not edited.** Refinements live in the design's §11 and in "Spec refinements" below.
7. **No shape is registered by this plan.** R2D (BI-580A970A) is the first consumer, in its own
   PR, after PR-3c-2.

## Facts this plan is built on (origin/main `879b344fa1`)

Every path and line below was read on this commit.

**Drive**

- `nextStageKey` is exported at `drive-resolution.ts:142-156`.
- `resolveDrivePlan` (`:190-396`) handles a human or governed stage at `:309-327`, writeback-latch
  dispatch at `:338-394`, and builds the task id with `workroomDriveTaskId` (`:104-106`).
- `applyDrivePlan` (`workroom-drive.ts:214-384`):
  - builds the snapshot keys in order at `:260-284`;
  - checks the stall notice and `hold.notifiedAt` at `:253-256`;
  - dispatches under the lease at `:311-371`.
- `runWorkroomDriveJob` (`:386-502`) earns receipts for one stage at `:438-444`.
- The persist transaction (`:651-696`):
  - merges receipts at `:662-670`;
  - compare-and-sets on `updatedAt` at `:671-681`.
- The cron is `*/15 * * * *`, with a run-now event (`workroom-drive-constants.ts:5-8`).
- `loadStageDispatchTimes` joins on `workroomDrive.stageKey` (`workroom-drive-data.ts:144-174`).
- `loadRecordedEvidence` selects `stageKey`, `kind` and `outcome` only (`:180-222`).
- `readStoredWorkroomDriveState` keeps only `stageKey` and `kind` per receipt
  (`workroom-drive-state.ts:18-49`).
- `appendCompletingWorkroomDriveReceipt` deduplicates on `(stageKey, kind)`
  (`workroom-drive-receipts.ts:26-45`).
- `earnEvidenceReceipts` / `stageHasCompletingEvidence` handle one stage, bounded by `dispatchedAt`
  (`stage-evidence-receipts.ts:69-101`).
- `driveHoldKey` (`workroom-drive-hold.ts:47-51`).

**Readers of the single stage**

- `evaluateWorkroomShapeConformance` does index arithmetic at `workroom-shape-conformance.ts:311-370`
  and `:434-447`.
- `stageInFlight` (`workroom-shape-rebind.ts:44-55`); `REBIND_REFUSAL_CODES` (`:18-24`).
- `readPendingGovernedDecision` (`workroom-stage-decision.ts:45-55`).
- `shape-projection.ts:243-276`.
- `held-workrooms.ts:39-48`.
- The stall source (`lib/attention/sources/workroom-stall.ts:225-234`).

**Stage decision**

- `STAGE_DECISION_CHOICES = ["accept", "patch", "defer"]` (`workroom-stage-decision.ts:32`).
- `stageDecisionChoices` (`:76-78`) and `buildStageDecisionEvidence` (`:166-190`). The outcome is
  always `completed`, so `defer` advances today.
- The evidence payload is the evidence object (`work-capsule-activity-store.ts:52-75`), so the
  choice is at `payload.result.choice`.

**Types**

- `WorkShapeAdvance` has no `gate` on main (`work-shapes.ts:53-55`).
- `readWorkShapeDefinitionContract` copies 11 fields (`:173-187`).

**Compiler side**

- `CONSTRUCT_EXECUTABLE` (`executable-constructs.ts:58-75`). The header says nothing in the app
  imports it (`:30`).
- E-NOT-EXECUTABLE sites: `drc.ts:173-183`, `:380-387`, `:465-477`.
- `decompile` never emits `flow`, `deadline` or `subShape` (`decompile.ts:12-13`).
- `legacyProjection` drops them (`legacy.ts:21-23`).
- `resolve.ts:142-143` computes sub-shape existence. The DRC does not check it.

**Interpreter**

- Graph builder: `interpreter.ts:152-264`.
- Join: `:378-386`.
- Refuse and rework: `:417-462`.
- One firing per event: `:464-487`.

**Rooms, relations and permits**

- `createWorkCapsule` is idempotent on `idempotencyKey` (`work-capsule-store.ts:113-175`).
- `updateWorkCapsuleStatus` (`:928`).
- `WORKROOM_RELATION_KINDS` (`room-relations.ts:8-14`).
- Containment reconcile: `workroom-drive-data.ts:26-80`.
- `withWorkShapeClaim` (`workroom-shape-claim.ts:126-135`).
- `child-completion` is an evidence kind (`work-shape-evidence-kinds.ts:22`).
- Permits: `GPP_PERMIT_TTL_MS` (`permit-mint.ts:27`); `shapeRef` and `stageKey` are null
  (`:60-61`).

**Not on main yet** (PR-3b-1…3 merged as #5969; no later commit under `lib/gpp/shape-language`)

- PR-3b-4: `gate?` and `binding?` types, binding-diff rows, `compile()`.
- PR-3b-5: generator and `check:gpp-shapes`.
- PR-3b-6: proof migration.

## Scope and staging

Five PRs. One construct per flag, as the parent requires. The one grouping (rework with refuse) is
forced by the code having a single flag for both. The substrate is its own PR because it is the
only PR that touches the path every existing room runs.

| PR | What it does | Flag flipped | Runtime behaviour change? |
|---|---|---|---|
| **PR-3c-1** | Substrate. Additive types, a shared flow graph moved to `work-management`, a marking reader, the N-token step machinery (tested pure, not reachable), the structural branch, fail-closed `construct_not_executable`, flow-aware conformance, iteration-scoped receipts, per-stage dispatch times, rebind and hold readers, decompiler carry-through, registry guard, characterization golden | none | None for any existing room. A graph shape (none exist) would pause with `construct_not_executable` |
| **PR-3c-2** | Parallel split/join; per-branch tasks; plural pending attention; room view marks every current stage; parity | `parallel-split-join` | None until a shape uses it |
| **PR-3c-3** | Refuse routes and rework edges; the `refuse` ("Send back") choice; verdicts from decision evidence; iteration bump; the revocation hook; parity | `rework-edge` | None until a shape declares a refuse route. Needs PR-3b-4 merged |
| **PR-3c-4** | Stage deadline: due check, notice once per iteration, attention source; interpreter `deadline` event; parity | `stage-deadline` | None until a shape declares a deadline |
| **PR-3c-5** | Sub-shape: child room lifecycle, containment, `child-completion` evidence, D-9 and D-10; interpreter `child-stop` event; parity | `sub-shape` | None until a shape declares a sub-shape |

**Order.**

- PR-3c-1 first.
- Then PR-3c-2, PR-3c-4 and PR-3c-5 can go in any order. PR-3c-3 also needs PR-3b-4.
- R2D (BI-580A970A) needs only PR-3c-1 and PR-3c-2.
- Recommended sequence: 3c-1 → 3c-2 (unblocks R2D) → 3c-4 → 3c-3 → 3c-5.

**Why not fewer PRs.** The operator asked for few PRs because the local CI gate is expensive.

- Folding PR-3c-1 into PR-3c-2 saves one gate run. The cost is mixing the only every-room change
  with a flag flip. Then a parity failure in parallel could not be reverted without also reverting
  the substrate.
- Folding deadline into sub-shape mixes the lowest-risk construct with the highest.
- Recommendation: keep five. If the founder prefers four, fold PR-3c-1 into PR-3c-2 and keep the
  golden as that PR's first commit (design Q5).
- Every PR runs only the tiered fast local gate. The heavy build runs once, in the merge queue
  (AGENTS.md §4).

**Branches and claims.**

- One branch per PR from `main`: `feat/gpp-3c-<slug>`.
- Each PR is claimed in its own workroom against BI-8875C9DF. Declare the delivery shape at claim.
  The backlog item is `delivery-large`.

## PR-3c-1: drive marking substrate (no flag flipped)

**Goal.**

- Make the drive capable of many tokens without any existing room noticing.
- Everything construct-specific is deferred to the flip PRs.
- The only reachable new runtime outcome is a fail-closed pause for a shape that uses a disabled
  construct.

**First commit: the golden (before any runtime file changes)**

- `apps/web/lib/work-management/__fixtures__/drive-sequential-golden.json` (new, generated).
- `apps/web/lib/work-management/drive-sequential-identity.test.ts` (new). It produces the golden;
  the comparison mode is added in the second commit.
  - For every definition in `listWorkShapes()` and `WORK_SHAPE_PRIOR_VERSIONS`, it runs 20 seeded
    tick sequences.
  - Seed: `0x8875c9df + shapeIndex * 1000 + n`, using `mulberry32` copied from the parity test.
  - Each tick feeds receipts, blocked receipts, stop hits, a review-due flag and the
    `preauthorized` boundary into `resolveDrivePlan`.
  - It then calls `applyDrivePlan` with in-memory effects that capture every `persist` snapshot,
    every `upsertAgentTask` task id, and every `deactivateAgentTask` call.
  - The fixture records `canonicalJson` of the captured sequence.
- This commit changes no runtime file. The fixture is generated by the code on `origin/main`.

**Files**

- `apps/web/lib/work-management/work-shapes.ts`, types only:
  - `WorkShapeFlow` (`nodes: {id; type: "parallel-split"|"parallel-join"; pairs?}[]`,
    `edges: {from; to; rework?: {maxIterations}}[]`)
  - `WorkShapeStageDeadline = { afterDays: number; description: string }`
  - `WorkShapeStage.deadline?`
  - `WorkShapeStage.subShape?: \`${string}@${string}\``
  - `WorkShapeDefinition.flow?`
  - `WorkShapeDefinitionContract` gains `flow?`. `readWorkShapeDefinitionContract` copies it with a
    conditional spread, only when present, so sequential contracts keep the same own keys (design
    correction 4).
- `apps/web/lib/work-management/work-shape-flow-graph.ts` (new). This is a **move**, not a rewrite:
  - It takes `buildShapeFlowGraph`, `forwardReach`, `backwardReach` and the `GppFlow*` and
    `InterpretableShape` types from `interpreter.ts:85-291`.
  - `interpreter.ts` and `soundness.ts` import from it.
  - `interpreter.ts` re-exports the moved names so existing imports compile.
  - It imports only `element-ids` helpers. `element-ids.ts` has no runtime dependency on the
    compiler, and this PR verifies that.
- `apps/web/lib/gpp/shape-language/executable-constructs.ts`:
  - Add `constructsUsedBy(shape): Array<{ construct; elementId }>`, built from the same walk as the
    DRC's E-NOT-EXECUTABLE.
  - Refactor `drc.ts` to call it, so there is one walk.
  - Update the header (`:30`): the drive reads this table at runtime from Phase 3c.
- `apps/web/lib/work-management/drive-marking.ts` (new, pure):
  - `DriveMarking` type (design §4.1).
  - `readStoredDriveMarking(workspaceState, definition)` → `{ ok: marking } | { ok: false; reason: "marking_unreadable" }`.
    An absent marking is derived from `stageKey`.
  - `usesGraphConstructs(definition)` — true when the shape declares `flow`, any `deadline`, any
    `subShape`, or any `gate.onRefuse` (read structurally; no `gate` type is needed before PR-3b-4).
  - `markedStageKeys(definition, marking)`.
  - `enabledStages(definition, marking, receipts)`.
  - `isCompletingAt(receipt, stageKey, iteration)`.
  - `stepDriveMarking(definition, marking, observations, now)`. It fires at most one stage, the first
    enabled in document order. Only the forward-edge move to a stage or stop is implemented here.
    Split, join, rework, deadline and child branches throw `construct_not_implemented`. They are
    unreachable, because the flags are off and the drive pauses first.
- `apps/web/lib/work-management/drive-resolution-graph.ts` (new): `resolveGraphDrivePlan(input)`.
  1. Check `constructsUsedBy` against `CONSTRUCT_EXECUTABLE`. Any construct that is off →
     `pause` / `construct_not_executable`. The ledger names the construct and element id.
  2. Read the marking. If unreadable → `pause` / `marking_unreadable`.
  3. Otherwise build per-token plans with the existing human, governed, agent and writeback-latch
     rules, factored into a shared `planStage(stage, …)` helper.
  - The plan returns `DrivePlan` with additive optional `tokens?: DriveTokenPlan[]` and
    `marking?: DriveMarking`.
- `apps/web/lib/work-management/drive-resolution.ts`:
  - Add `if (input.definition && usesGraphConstructs(input.definition)) return resolveGraphDrivePlan(input);`
    after the posture and substrate early returns.
  - Extract `planStage` from `:299-395` with **no behaviour change**. The golden proves it.
  - `DrivePlan` gains optional `tokens?` and `marking?`.
- `apps/web/lib/queue/functions/workroom-drive.ts`:
  - `applyDrivePlan`: if `plan.marking` is present, add `marking` and `pendingAttentions` to the
    snapshot after the existing keys, and handle `plan.tokens` (dispatches are handled in PR-3c-2).
    Otherwise do exactly today's path.
  - `runWorkroomDriveJob`: earn receipts per marked stage only when a marking is present.
    `driveHoldKey` input takes the marked keys for graph rooms.
- `apps/web/lib/queue/functions/workroom-drive-data.ts`: `loadStageDispatchTimesByStage(capsuleIds)`
  for graph rooms only (rooms whose snapshot has `marking`). It returns `Map<capsuleId, Map<stageKey, Date>>`.
  - Dispatch rows use `payload.dispatchedStageKeys`.
  - Attention rows use the `pendingAttentions` stage keys.
  - `loadStageDispatchTimes` is unchanged.
  - `loadRecordedEvidence` additionally selects `payload #>> '{result,choice}'` as `choice` on
    `RecordedEvidence` (optional field). Nothing reads it until PR-3c-3.
- `apps/web/lib/work-management/workroom-drive-receipts.ts`:
  - `WorkroomDriveReceipt.iteration?: number`.
  - The dedupe key becomes `(stageKey, kind, iteration ?? 0)`.
  - New `isCompletingWorkroomDriveReceiptAt`.
  - `isCompletingWorkroomDriveReceipt` is unchanged and is used by the sequential path.
- `apps/web/lib/work-management/workroom-drive-state.ts`: copy `iteration` only when it is a finite
  non-negative integer. Expose `marking` through `readStoredDriveMarking`; do not add it to
  `StoredWorkroomDriveState`.
- `apps/web/lib/work-management/stage-evidence-receipts.ts`: an optional `iteration` passes through
  to the earned receipt.
- `apps/web/lib/work-management/workroom-shape-conformance.ts`: optional input
  `flowOrder?: { enabled: string[]; delivered: Record<string, boolean>; reworkRoute?: {from; to} }`.
  - When present, it replaces the `:311-370` block with graph checks, and
    `nextPermittedStageKey = enabled[0] ?? null`.
  - When absent, the existing code runs as it is.
- `apps/web/lib/work-management/workroom-shape-rebind.ts`:
  - Add `marking_not_mappable` to `REBIND_REFUSAL_CODES`.
  - `planWorkroomShapeRebind` refuses when the stored marking has more than one token, a token
    inside a parallel block of either version, any `reworkTaken`, or any live child.
  - The `stageInFlight` sequential rule is unchanged.
- `apps/web/lib/work-management/workroom-drive-hold.ts`: `driveHoldKey` takes optional
  `markedKeys`. When given, it joins `sorted(key#iteration)` in place of `stageKey`.
- `apps/web/lib/work-management/work-shape-binding-diff.ts`: new kinds, each firing only when one
  side declares the field:
  - `flow-changed` (widening)
  - `deadline-added` (narrowing)
  - `deadline-relaxed` and `deadline-removed` (widening)
  - `sub-shape-changed` (widening)
- `apps/web/lib/gpp/shape-language/decompile.ts` and `emit.ts` (`lowerToDefinition`): carry `flow`,
  `deadline` and `subShape` when present (design correction 5). `legacy.ts` is unchanged.
- `apps/web/lib/work-management/work-shape-graph-constructs.test.ts` (new): the registry guard
  (design §7.2), with a shrink-only `KNOWN_GRAPH_SHAPES` allow list. It is empty at merge.

**Tests** (`pnpm --filter web exec vitest run lib/work-management lib/gpp/shape-language lib/queue/functions/workroom-drive`)

- `drive-sequential-identity.test.ts`, second commit. It compares against the golden.
  **AC-3C-SEQ-IDENTICAL.** It also asserts that no captured snapshot has a `marking` or
  `pendingAttentions` key, and that the captured task ids equal `workroomDriveTaskId(room, shape)`.
- `drive-marking.test.ts` (new): reading absent, derived and malformed markings; the iteration
  predicate; and, with a test-only flag override, a forward move on a two-stage `flow` fixture that
  equals `nextStageKey` on its sequential twin.
- `workroom-drive-state.test.ts` (extend). **AC-3C-STATE-COMPAT.** Fixtures: no drive key, a v1
  snapshot, receipts without and with `iteration`, a malformed `iteration`. Legacy outputs are
  byte-identical.
- `workroom-drive-receipts.test.ts` (extend): dedupe with iteration; legacy dedupe unchanged.
- `drive-resolution.test.ts` (extend): a graph fixture with any flag off → `pause` /
  `construct_not_executable`, naming the element. **AC-3C-FAILCLOSED** (runtime half).
- `work-shape-graph-constructs.test.ts`. **AC-3C-FAILCLOSED** (registry half). A seeded unsound
  fixture, or one with its flag off, is refused when injected.
- `workroom-shape-conformance.test.ts` (extend). **AC-3C-CONFORMANCE** (sequential half): every
  existing case unedited; a `flowOrder` forward move is legal; an out-of-graph proposal raises
  `out_of_order_stage`.
- `workroom-shape-rebind.test.ts` (extend). **AC-3C-REBIND** (multi-token and rework-counter
  cases).
- `work-shape-binding-diff.test.ts` (extend): one case per new kind; existing cases unedited.
- `registry-roundtrip.test.ts` and `interpreter-parity.test.ts`: unchanged and green. The flow-graph
  move is invisible to them.
- `pnpm --filter web typecheck`.

**Rollout.** No existing room reaches the new path. **Rollback.** Revert the PR. No data depends on
it, because no room has a `marking`.

**Satisfies:** OBJ-3C-NODISRUPT, OBJ-3C-FAILCLOSED; AC-3C-SEQ-IDENTICAL, AC-3C-STATE-COMPAT,
AC-3C-FAILCLOSED, AC-3C-CONFORMANCE (sequential half), AC-3C-REBIND (part), AC-3C-BUILD-STUDIO.

## PR-3c-2: parallel split / join (`parallel-split-join`)

**Goal.** Execute design §6.1, and prove it against the interpreter.

**Files**

- `drive-marking.ts`: implement split placement (recursive through nested splits) and join
  arrivals `{ node, from }` with completion, following `interpreter.ts:364-389`. Each placed token
  gets `enteredAt = now`.
- `drive-resolution-graph.ts`:
  - One `DriveTokenPlan` per marked stage.
  - The aggregate action follows design §4.3 precedence.
  - Task id: the first marked agent stage keeps `workroomDriveTaskId(roomId, shapeKey)`; every
    other concurrent agent stage gets `workroomDriveBranchTaskId(roomId, shapeKey, stageKey)`
    (`…--<stageKey>`).
- `drive-resolution.ts`: export `workroomDriveBranchTaskId` beside `workroomDriveTaskId`.
- `workroom-drive.ts`, `applyDrivePlan`:
  - Acquire the lease once, then `upsertAgentTask` per dispatch token.
  - The snapshot records `dispatchedStageKeys`.
  - On `stop`, `do_not_wake` or success, deactivate the primary task and every branch task named
    in the prior marking.
  - Per-token writeback latch (`writebackLatchHolds` already takes `stageKey`).
- `workroom-stage-decision.ts`:
  - `readPendingGovernedDecisions(workspaceState)` (plural) reads `pendingAttentions`, falling back
    to `pendingAttention`.
  - `readPendingGovernedDecision` returns the first, unchanged.
  - `workroom-stage-decision.server.ts`: `loadDecisionContext` accepts the stage key the control
    already posts (`StageDecisionInput.stageKey`), validated against the plural list.
- `shape-projection.ts`: when the observation carries several marked stages, each reads "current".
  The sequential branch is unchanged.
- `executable-constructs.ts`: `"parallel-split-join": true`.
- `interpreter.ts` / `drc.ts` header comments: note the flag is on.

**Tests**

- `apps/web/lib/work-management/drive-parity-parallel.test.ts` (new). **AC-3C-PARALLEL-PARITY.**
  - Fixtures (in `__fixtures__/graph-shapes/`):
    - `split-2`
    - `split-nested`
    - `split-governed-branch`
    - `r2d-deploy-fork`: four branches (`linux`, `macos`, `windows`, `edge`), each
      `plan → fulfill → validate → observe`, then a join, then `release`.
  - Each fixture passes `checkSoundness` with zero findings.
  - 200 seeded sequences per fixture. Events are completing or blocked receipts for marked and
    unmarked stages, duplicates, and stop events.
  - After each event: one drive tick (`stepDriveMarking`, with the earned receipts) and one
    `stepShapeInstance`. Marked stage keys, `stopped.kind` and `stopped.stopId` must be equal.
  - Coverage assertion: every stage was marked at least once, and every join completed at least
    once.
- `workroom-drive.test.ts` (extend):
  - two concurrent agent branches → two `upsertAgentTask` calls with distinct ids under one lease;
  - a stop deactivates all branch tasks;
  - one branch latched by writeback does not block the other.
- `workroom-stage-decision.test.ts` (extend): two pending decisions are both listed; deciding one
  leaves the other pending.
- `workroom-shape-conformance.test.ts` (extend). **AC-3C-CONFORMANCE** (parallel half): legal
  concurrent proposals raise nothing; a stage beyond an incomplete join raises
  `missing_prerequisite_receipt`.
- `not-executable.test.ts` (edit). **AC-3C-FLAG-FLIP**: the parallel fixture now compiles; the
  other four constructs are still refused.
- `drive-sequential-identity.test.ts`: still green.

**Rollout.**

- No registry shape uses `flow`; `KNOWN_GRAPH_SHAPES` is empty.
- UX verification is not reachable at merge, because no room can enter the path. It is **owed by
  BI-580A970A's PR**, which registers R2D and must exercise:
  - the four-branch fork on the canonical runtime through `claim_nonprod_environment_lease`, with
    real release evidence;
  - the room view showing several current stages;
  - two simultaneous pending decisions.
- This plan records it as owed, not passed.

**Rollback.** Flip the flag back (the kill switch). Any room on a parallel shape then pauses with
`construct_not_executable`, visibly. Or revert the PR.

**Satisfies:** OBJ-3C-MARKING, OBJ-3C-PARITY; AC-3C-PARALLEL-PARITY, AC-3C-CONFORMANCE,
AC-3C-FLAG-FLIP.

## PR-3c-3: refuse routes and rework edges (`rework-edge`)

**Precondition.** PR-3b-4 is merged, which gives `WorkShapeAdvance` its `gate?: WorkShapeGate` with
`onRefuse`. One flag covers both notations (design correction 1).

**Files**

- `drive-marking.ts`:
  - Refuse routing per design §6.2 and `interpreter.ts:417-462`:
    - target is a stop → consume all tokens;
    - target is an earlier stage → counter, bound check (the first budget stop when exceeded),
      `iterations[s] += 1` across the loop region, clear the region's tokens, place a token on the
      target with fresh `enteredAt`;
    - no route → the token stays.
  - A verdict is ignored unless its mode equals the gate's mode.
- `drive-resolution-graph.ts`:
  - `deriveGateVerdict(stage, evidence, iteration)`. It reads the latest `decision-record` for the
    stage at this iteration using `RecordedEvidence.choice`:
    - `accept` → `admit`
    - `patch` → `admit`
    - `defer` → `admit` (the founder's 2026-10-02 decision keeps `defer` advancing; `hold` waits for
      the confirmation required by spec §14 Q1, and changing it is a one-line follow-up with its own
      decision)
    - `refuse` → `refuse`
  - Only for enforced, blocking gates with a refuse route.
  - A refuse with no route → `attention` / `gate_refused` to `gate.escalation.role` ?? the stage
    principal.
- `workroom-stage-decision.ts`:
  - Add `"refuse"` to `STAGE_DECISION_CHOICES` and `STAGE_DECISION_CHOICE_LABEL.refuse = "Send back"`.
  - `stageDecisionChoices` gains a second parameter `hasRefuseRoute` and appends `refuse` only then.
    Existing call results are unchanged.
  - `buildStageDecisionEvidence` adds the verb "sent back".
- `apps/web/lib/gpp/stage-permit-revocation.ts` (new): `revokeStagePermits({ workroomId, stageKeys })`
  through the existing permit store. It is a no-op while no permit carries `stageKey`. It is called
  on every rework transition.
- `executable-constructs.ts`: `"rework-edge": true`.

**Tests**

- `drive-parity-rework.test.ts` (new). **AC-3C-REWORK-PARITY.**
  - Fixtures:
    - `rework-1` (b → a, max 1)
    - `rework-2-bound` (max 2, driven past the bound)
    - `refuse-to-stop`
    - `refuse-no-route`
    - `shadow-gate`
    - `rework-inside-branch` (a rework inside a parallel branch, same-block rule)
  - Events add `gate-verdict`. For the drive, a verdict is a `decision-record` evidence row with
    `choice`.
  - Asserted after each event: marked stages, stopped, and `reworkTaken`, compared with the
    interpreter's `reworkTaken`.
  - Plus: a stale-iteration receipt never completes the new iteration.
- `workroom-stage-decision.test.ts` (extend):
  - `refuse` is offered only with a refuse route;
  - every existing stage's offered choices are unchanged, checked over the registry;
  - the evidence summary uses the new verb.
- `stage-permit-revocation.test.ts` (new): with an injected permit store holding a permit for that
  `workroomId` and `stageKey`, the permit is revoked; with none, nothing is written.
- `workroom-shape-conformance.test.ts` (extend): the declared refuse route is legal; any other
  backward move still raises `out_of_order_stage`.
- `not-executable.test.ts` (edit). **AC-3C-FLAG-FLIP**: both the rework-edge fixture and the
  refuse-edge fixture now compile.
- `drive-sequential-identity.test.ts`: still green.

**Rollout.**

- No registry stage declares a refuse route, so "Send back" appears nowhere.
- Design Q1 must be answered before any shape adopts a refuse route on a stage whose current
  choices include `defer`.

**Rollback.** Flip the flag back, or revert.

**Satisfies:** OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-ACCOUNTABLE; AC-3C-REWORK-PARITY,
AC-3C-CONFORMANCE, AC-3C-FLAG-FLIP.

## PR-3c-4: stage deadline (`stage-deadline`)

**Files**

- `interpreter.ts`, its own first commit: event `{ type: "deadline"; stageKey }`, which returns the
  marking unchanged (parent §6.1 rule 8). It comes with `interpreter.test.ts` cases written from the
  rule text.
- `drive-marking.ts`: `overdueDeadlines(definition, marking, now)`. It lists tokens with
  `now ≥ enteredAt + afterDays·86 400 000 ms` whose key `<stageKey>#<iteration>` is not yet in
  `marking.deadlines`.
- `drive-resolution-graph.ts`: adds the overdue entries to the plan's marking with
  `notifiedAt: null`, adds a ledger line per entry, and adds `deadlinesDue` to the plan. The marking
  is otherwise unchanged.
- `workroom-drive.ts`:
  - Persist first.
  - On the next tick, for every `deadlines` entry with `notifiedAt: null` already committed in the
    stored marking, call an optional effect `notifyDeadline`, composed from `notifyWorkroomStall`'s
    owner resolution (`workroom-stall-notice.ts:16`).
  - Set `notifiedAt` on success. On failure, leave it for retry.
  - Write a `workroom-drive-deadline` activity when the entry is first raised.
- `lib/attention/sources/workroom-stall.ts`: also selects rooms whose
  `workroomDrive.marking.deadlines` holds an entry for a still-marked token. It reuses the source's
  existing row shape, with the reason "Stage <title> is past its deadline".
- `executable-constructs.ts`: `"stage-deadline": true`.

**Tests**

- `drive-parity-deadline.test.ts` (new). **AC-3C-DEADLINE-PARITY.**
  - Over the PR-3c-2 fixtures plus `deadline-seq` (a sequential shape with one deadline, which
    enters the graph path because it declares a deadline), deadline events interleave with
    receipts. The drive's and the interpreter's markings are equal.
  - Under a stepped clock: exactly one entry per `<stageKey>#<iteration>`; a rework creates a new
    key; a failed notify retries; a successful notify never repeats.
- `workroom-stall.test.ts` (extend): an overdue room appears once, with the deadline reason.
- `not-executable.test.ts` (edit): AC-3C-FLAG-FLIP.
- `drive-sequential-identity.test.ts`: still green.

**Rollout.** No registry stage declares a deadline. **Rollback.** Flip the flag back, or revert.

**Satisfies:** OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-ACCOUNTABLE; AC-3C-DEADLINE-PARITY,
AC-3C-FLAG-FLIP.

## PR-3c-5: sub-shape (`sub-shape`)

**Files**

- `interpreter.ts`, its own first commit: event `{ type: "child-stop"; stageKey; kind }`.
  - `success` on a marked stage behaves as a completing receipt for it.
  - `failure` or `budget` leaves the marking unchanged.
  - Comes with unit tests.
- `drive-marking.ts`: when a token enters a sub-shape stage, add a child entry
  `children["stageKey#iter"] = { capsuleId: null-until-created, ref }`.
- `drive-resolution-graph.ts`:
  - A sub-shape stage plans `ensure_child` (internal) plus `attention` / `awaiting_sub_shape`.
  - It reads the child's stored drive snapshot through the existing room loader:
    - `stop` / `success` → plan `record_child_completion`;
    - `stop` with a failure or budget stop → `attention` / `sub_shape_stopped`, with the
      disposition.
- `apps/web/lib/queue/functions/workroom-drive-children.ts` (new; keeps `workroom-drive.ts` under
  the substrate-complexity threshold noted at `workroom-drive-data.ts:3-5`). Effects:
  - `ensureChildRoom` — `createWorkCapsule` with
    `idempotencyKey = "sub-shape:<parentCapsuleId>:<stageKey>:<iteration>"`,
    `scopeClaims = withWorkShapeClaim([], ref)`, the parent's owner, the system actor; plus a
    `contains` relation with `skipDuplicates`.
  - `recordChildCompletion` — `recordWorkCapsuleEvidence` on the parent:
    - kind `child-completion`, outcome `completed`, current iteration;
    - payload `{ childCapsuleId, childShapeRef, disposition }`;
    - then `updateWorkCapsuleStatus(child, "complete")`, or the governed completion path if that
      helper refuses a system actor (verify first; design Q6).
  - `abandonChild` — on rework across the stage, set the stale child to `abandoned` with a reason.
    The terminal-room reconcile withdraws its `contains` row (`workroom-drive-data.ts:41-52`).
- `apps/web/lib/gpp/shape-language/drc.ts` and `diagnostics.ts`:
  - Add `D-9` (sub-shape widening: child `grants` ⊄ parent `grants`, or a child stage tool outside
    the parent's grants).
  - Add `D-10` (sub-shape resolution: an unresolved `key@version`, using `resolve.ts:142-143`; a
    cycle in the sub-shape call graph, walked over `shapeVersionExists` plus the registry).
  - `GppRuleId` gains both.
  - `__fixtures__/drc/` gains one fixture each; `expected.json` gains the entries.
- `workroom-shape-rebind.ts`: refuse while any `children` entry is live (`marking_not_mappable`).
- `executable-constructs.ts`: `"sub-shape": true`.

**Tests**

- `drive-parity-sub-shape.test.ts` (new). **AC-3C-SUBSHAPE-PARITY.**
  - Fixtures: `sub-seq` (a middle stage calls a two-stage child) and `sub-in-branch` (a sub-shape
    inside a parallel branch).
  - Events add `child-stop`. The drive sees them as the child's stored snapshot.
  - Marked stages and stopped are equal after each event.
- `workroom-drive-children.test.ts` (new), with in-memory db:
  - exactly one child per stage and iteration across repeated ticks (idempotency);
  - the child pins the declared version;
  - a `contains` row exists;
  - success records `child-completion` and completes the child;
  - failure holds the parent with `sub_shape_stopped` and does not complete the child;
  - rework abandons the stale child and creates a new one.
- `drc-corpus.test.ts` (extend). **AC-3C-SUBSHAPE-NO-WIDEN**: D-9 and D-10 fixtures are refused
  with their rule id and element id.
- `workroom-shape-rebind.test.ts` (extend): a live child → `marking_not_mappable`. Completes
  AC-3C-REBIND.
- `not-executable.test.ts` (edit): AC-3C-FLAG-FLIP. After this PR no construct remains off.
- `drive-sequential-identity.test.ts`: still green.

**Rollout.** No registry stage declares a sub-shape. **Rollback.** Flip the flag back. Live
children then pause with their parent, visibly. Or revert.

**Satisfies:** OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-CONTAINMENT, OBJ-3C-ACCOUNTABLE;
AC-3C-SUBSHAPE-PARITY, AC-3C-SUBSHAPE-NO-WIDEN, AC-3C-REBIND, AC-3C-FLAG-FLIP.

## Tasks

### PR-3c-1

- [ ] Commit 1: golden generator and fixture from unmodified `origin/main` code
- [ ] Types (`flow?`, `deadline?`, `subShape?`; contract `flow?` by conditional spread)
- [ ] Move the flow graph to `work-shape-flow-graph.ts`; re-export from the interpreter
- [ ] `constructsUsedBy`, with the DRC refactored onto it; header update
- [ ] `drive-marking.ts`, `drive-resolution-graph.ts`, structural branch, `planStage` extraction
- [ ] Iteration-aware receipts, state reader, evidence `choice` column, per-stage dispatch loader
- [ ] Flow-aware conformance input; rebind `marking_not_mappable`; hold key; binding-diff kinds
- [ ] Decompile and lower carry-through; registry guard with an empty allow list
- [ ] Tests; `typecheck`; Build Studio diff check; fast local gate; PR

### PR-3c-2

- [ ] Split/join step; per-branch task ids; lease-once multi-dispatch; terminal deactivation
- [ ] Plural pending decisions; projection marks several current stages
- [ ] Parallel parity (four fixtures including the R2D fork); flag flip; not-executable edit
- [ ] Fast local gate; PR; record "UX owed by BI-580A970A" on BI-8875C9DF

### PR-3c-3 (after PR-3b-4)

- [ ] Refuse routing and iteration bump; verdict derivation; "Send back" choice
- [ ] Revocation hook and test; rework parity; flag flip
- [ ] Fast local gate; PR

### PR-3c-4

- [ ] Interpreter `deadline` event (own commit); overdue detection; notify-after-commit with retry
- [ ] Stall source extension; deadline parity; flag flip
- [ ] Fast local gate; PR

### PR-3c-5

- [ ] Interpreter `child-stop` event (own commit); child lifecycle effects module
- [ ] D-9 and D-10 with fixtures; rebind refusal for live children; sub-shape parity; flag flip
- [ ] Fast local gate; PR; record execution evidence; BI-8875C9DF to `done` after acceptance

## Spec refinements and open questions

The design's §11 lists the corrections to the parent. These items are open for plan review.

1. **Golden scope.** The golden uses 20 seeded sequences per definition, not 200. It is a
   byte-level snapshot, so size matters; parity tests carry the 200. Confirm at review.
2. **`planStage` extraction.** This is the one edit to `resolveDrivePlan`'s existing body. It
   is a pure refactor, and AC-3C-SEQ-IDENTICAL is the proof. If review prefers literally no edit,
   the graph path can duplicate the per-stage rules instead. That is not recommended, because it
   creates two homes for the human-stage and latch rules.
3. **`usesGraphConstructs` before PR-3b-4.** It reads `advance.gate?.onRefuse` structurally,
   without the type. After PR-3b-4 it uses the type.
4. **Design Q1–Q7** need founder or WWMD answers. Q1 blocks any shape adopting a refuse route on an
   accept/defer stage, not the PR. Q6 blocks PR-3c-5's completion write if `updateWorkCapsuleStatus`
   refuses a system actor.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The substrate subtly changes a sequential room (key order, hold key, task id) | Golden from pre-change code; conditional spreads; legacy readers untouched; every PR re-runs it |
| R2 | The flow-graph move breaks the compiler | Pure move with re-exports; the AC-INTERPRETER, soundness and DRC suites unchanged and green |
| R3 | Parity passes but the drive differs in production because of evidence timing | Parity feeds the drive through `earnEvidenceReceipts`-equivalent receipts. Per-stage dispatch bounds are unit-tested. R2D's live verification is the functional proof |
| R4 | Branch tasks leak after a stop | Deactivate every branch task named in the prior marking; a test asserts none stays active |
| R5 | `defer → hold` reaches a live stage | The founder decided on 2026-10-02 that existing stages keep `defer` advancing. On refuse-route stages, `defer → hold` needs founder confirmation (after WWMD) before PR-3c-3 flips `rework-edge`; until then `defer` advances there too. Spec §14 Q1 |
| R6 | The deadline notice duplicates or is lost | Key per iteration; notify after commit; retry on failure |
| R7 | Child rooms orphan or multiply | Idempotency key; terminal on stop; abandon on rework; `contains` withdrawn by the existing rule |
| R8 | PR-3b-4 slips and blocks PR-3c-3 | PR-3c-2, -4 and -5 do not need it; R2D needs only PR-3c-2 |
| R9 | `workroom-drive.ts` crosses the complexity hotspot threshold | New effects go in `workroom-drive-children.ts` and the graph planner in `drive-resolution-graph.ts` |

## Research & Benchmarking

See the design's [§12](../specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md#12-research-and-benchmarking).

- From Camunda 8 / Zeebe, this plan takes four things:
  - join by arrival on each incoming flow;
  - the call activity as a child instance;
  - non-interrupting timers;
  - refusing a migration whose active elements cannot be mapped.
- From Temporal, it takes deterministic replay as the parity method, and child workflows as
  separate durable units.
- From Apache Airflow, it takes evaluation on each scheduler tick, and `all_success` as the join.
  It rejects Airflow's OR-style trigger rules.
- From Flowable, it takes per-branch execution state.

This plan adds no comparison beyond the design.

## Traceability to the scope baseline

The baseline is the design's §10. It is minted by spec approval for BI-8875C9DF.

| Deliverable | Objectives | Acceptance | Contracts | Flows |
|---|---|---|---|---|
| PR-3c-1 substrate | OBJ-3C-NODISRUPT, OBJ-3C-FAILCLOSED | AC-3C-SEQ-IDENTICAL, AC-3C-STATE-COMPAT, AC-3C-FAILCLOSED, AC-3C-CONFORMANCE, AC-3C-REBIND, AC-3C-BUILD-STUDIO | contract:workroom-drive-state, contract:drive-marking, contract:executable-construct-flags, contract:work-shape-binding-diff | flow:drive-tick, flow:sequential-receipt-to-next-stage |
| PR-3c-2 parallel | OBJ-3C-MARKING, OBJ-3C-PARITY | AC-3C-PARALLEL-PARITY, AC-3C-CONFORMANCE, AC-3C-FLAG-FLIP | contract:shape-token-semantics, contract:drive-marking | flow:parallel-split-join, flow:drive-tick |
| PR-3c-3 rework and refuse | OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-ACCOUNTABLE | AC-3C-REWORK-PARITY, AC-3C-CONFORMANCE, AC-3C-FLAG-FLIP | contract:shape-token-semantics, contract:stage-decision-choices | flow:gate-refuse-route |
| PR-3c-4 deadline | OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-ACCOUNTABLE | AC-3C-DEADLINE-PARITY, AC-3C-FLAG-FLIP | contract:drive-marking | flow:stage-deadline-notice |
| PR-3c-5 sub-shape | OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-CONTAINMENT, OBJ-3C-ACCOUNTABLE | AC-3C-SUBSHAPE-PARITY, AC-3C-SUBSHAPE-NO-WIDEN, AC-3C-REBIND, AC-3C-FLAG-FLIP | contract:gpp-diagnostics, contract:drive-marking | flow:sub-shape-child-room |
| R2D room using the fork, plus UX verification of parallel on the canonical runtime | OBJ-3C-MARKING | (BI-580A970A's own acceptance) | — | flow:parallel-split-join |

Coverage:

- Every OBJ-3C and AC-3C id appears against at least one 3c PR.
- Every deliverable maps to BI-8875C9DF, except the R2D row, which maps to BI-580A970A.
- No new backlog item is needed.

## Verification

- Per PR:
  - `pnpm --filter web exec vitest run` over the touched suites (`lib/work-management`,
    `lib/gpp/shape-language`, `lib/queue/functions/workroom-drive*`, `lib/attention/sources`);
  - `pnpm --filter web typecheck`;
  - `pnpm --filter web check:gpp-shapes`, once PR-3b-5 exists.
- `pnpm --filter web build` runs once, in the cloud merge queue (tiered gate).
- Migrations: none.
- UX:
  - PR-3c-1, -4 and -5: no surface is reachable at merge.
  - PR-3c-2 and -3: their surfaces (several current stages, plural decisions, "Send back") are
    reachable only through a shape that uses the construct.
  - So UX verification is **owed by the first consumer** and recorded as unrun, not passed
    (AGENTS.md §4, "a gate that could not run is not a verdict").
- Build Studio check on every PR: `git diff --name-only origin/main...HEAD` lists no path under
  `apps/web/lib/build/`, `apps/web/lib/explore/` or the Build Studio packs.
- After each merge: record execution evidence on BI-8875C9DF. After PR-3c-5, reconcile against the
  baseline and close.

## Documentation impact

- **Each flip PR:**
  - updates GPP `docs/architecture/gated-permissions-process.md` §12.4.3 ("Executable model") and
    Annex A for its construct;
  - updates the header table in `executable-constructs.ts`;
  - adds the flag state to the status line of
    `docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md`.
- **User guide copy** for "Send back" and overdue-deadline notices lands with the first shape that
  uses them, since nothing shows them before then. That is recorded in BI-580A970A's or the
  adopting shape's PR.
- **No-docs-needed for PR-3c-1.** It is internal substrate with no user, coworker, route, prompt or
  install change.
