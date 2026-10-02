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
| Verified against | `origin/main` at `879b344fa1`. Review revisions re-checked at `6ce2f7e445`, which adds #5977 (PR-3b-4/5) and touches none of the drive files cited. |

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
- `driveHoldKey({ action, reason, stageKey, conformance })` takes one object
  (`workroom-drive-hold.ts:47-51`).
- `driveTickIsNews` is true only on `dispatch_agent` or a changed hold key (`:90-92`). Quiet ticks
  write no activity row (`workroom-drive.ts:257-258, 683`).
- `persist` replaces the whole `workroomDrive` snapshot (`workroom-drive.ts:679`) and merges back
  only receipts (`:662-670`).
- `emptyPlan` writes `stageKey: null` (`drive-resolution.ts:117-140`, `:130`).
- `writebackLatchHolds` returns `false` when `prior.stageKey !== stageKey`
  (`writeback-latch.ts:53-54`). Its prior type is `PriorDriveForLatch` (`:20-26`), built room-level
  by `priorDriveFromStored` (`workroom-drive-state.ts:51-58`).
- `postureLevelOf` never returns `null`; it defaults to `balanced` (`workroom-drive.ts:169-173`).
- The task upsert sets `isActive: true` and `nextRunAt` (`workroom-drive.ts:735-758`).
- `DRIVE_REASONS_BY_ACTION` (`drive-conclusion.ts:50-57`), `BLOCKAGES` (`:86-119`), `IN_MOTION`
  (`:122-130`), `resolveDriveConclusion` (`:143-211`).
- `loadRecordedEvidence` applies `LIMIT 500` across all rooms in the tick, not per room
  (`workroom-drive-data.ts:203`). This is a pre-existing defect; the coordinator will file a BI.
- The containment reconciler loads only `standing-room:` rooms (`workroom-drive-data.ts:29-30`) and
  withdraws only standing-room keys (`standing-room-nesting.ts:113-118`).

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
- `decompile` never emits `flow`, `deadline` or `subShape` (`decompile.ts:12-14` at `6ce2f7e445`).
  It takes `advance.gate` only from the ratification table, never from the definition
  (`:18-21, 59-60`).
- `legacyProjection` drops them (`legacy.ts:21-23`).
- `resolve.ts:142-143` computes sub-shape existence. The DRC does not check it.

**Interpreter**

- Graph builder: `interpreter.ts:152-264`.
- Join: `:378-386`.
- Refuse and rework: `:417-462`.
- One firing per event: `:464-487`.

**Rooms, relations and permits**

- `createWorkCapsule` is idempotent on `idempotencyKey`. An existing key returns the existing row
  (`work-capsule-store.ts:130-133`).
- `updateWorkCapsuleStatus` (`:928`).
- `WORKROOM_RELATION_KINDS` (`room-relations.ts:8-14`).
- Containment reconcile: `workroom-drive-data.ts:26-80`.
- `withWorkShapeClaim` (`workroom-shape-claim.ts:126-135`).
- `child-completion` is an evidence kind (`work-shape-evidence-kinds.ts:22`).
- Permits: `GPP_PERMIT_TTL_MS` (`permit-mint.ts:27`); `shapeRef` and `stageKey` are null
  (`:60-61`).

**Phase 3b status** (verified at `6ce2f7e445`)

- PR-3b-4 and PR-3b-5 are merged (#5977).
  - `WorkShapeAdvance` carries `gate?: WorkShapeGate` (`work-shapes.ts:54-56`), with `onRefuse?`
    (`:73-84`).
  - `compile()`, the generator and `check:gpp-shapes` exist.
- PR-3b-6 (proof migration) is not merged.

**Room-view plumbing** (verified)

- `projectStoredWorkroomDriveObservation` (`workroom-drive-state.ts:62-76`) is called at
  `workspace-case-loader.ts:725` and `workroom-only-case-projection.ts:156`.
- From there it reaches the observation type (`room-read-model.ts:94-100`) and the conformance call
  (`:258-268`).
- The view receives it as `processOverseer: WorkroomShapeConformance` (`room-types.ts:261`).
- `shape-projection.ts:240-243` reads it.

## Scope and staging

Five PRs. One construct per flag, as the parent requires. The one grouping (rework with refuse) is
forced by the code having a single flag for both. The substrate is its own PR because it is the
only PR that touches the path every existing room runs.

| PR | What it does | Flag flipped | Runtime behaviour change? |
|---|---|---|---|
| **PR-3c-1** | Substrate. Additive types, a shared flow graph moved to `work-management`, a marking reader, the N-token step machinery (tested pure, not reachable), the structural branch, fail-closed `construct_not_executable`, flow-aware conformance, iteration-scoped receipts, per-stage dispatch times, rebind and hold readers, decompiler carry-through, registry guard, characterization golden | none | None for any existing room. A graph shape (none exist) would pause with `construct_not_executable` |
| **PR-3c-2** | Parallel split/join; per-branch tasks; plural pending attention; room view marks every current stage; parity | `parallel-split-join` | None until a shape uses it |
| **PR-3c-3** | Refuse routes and rework edges; the `refuse` ("Send back") choice; verdicts from decision evidence; iteration bump; the revocation hook; parity | `rework-edge` | None until a shape declares a refuse route. PR-3b-4 is merged (#5977) |
| **PR-3c-4** | Stage deadline: due check, notice once per iteration, attention source; interpreter `deadline` event; parity | `stage-deadline` | None until a shape declares a deadline |
| **PR-3c-5** | Sub-shape: child room lifecycle, containment, `child-completion` evidence, D-9 and D-10; interpreter `child-stop` event; parity | `sub-shape` | None until a shape declares a sub-shape |

**Order.**

- **Chain:** PR-3c-1 → PR-3c-2 → {PR-3c-3, PR-3c-4, PR-3c-5}. The last three can go in any
  order after PR-3c-2, because each reuses PR-3c-2's parallel machinery in a fixture:
  - `rework-inside-branch` (PR-3c-3);
  - the PR-3c-2 fixtures (PR-3c-4);
  - `sub-in-branch` (PR-3c-5).
- **Why not split the in-branch fixtures into a follow-up PR.** That would add a sixth PR to make
  the last three independent of PR-3c-2. PR-3c-2 comes second in every sensible sequence anyway,
  because it unblocks R2D. So the simpler option is to keep the fixtures and declare the dependency.
- R2D (BI-580A970A) needs only PR-3c-1 and PR-3c-2.
- Recommended sequence: 3c-1 → 3c-2 (unblocks R2D) → 3c-4 → 3c-3 → 3c-5.
- **Reverting PR-3c-2 after a later PR has merged.** The flag rollback (parallel flag back to
  `false`) stays independent, because parity tests call the pure step directly and do not read the
  flag. Reverting PR-3c-2's *code* is different: it also removes the in-branch fixtures from
  whichever of PR-3c-3, PR-3c-4 or PR-3c-5 have merged, or those PRs are reverted first.

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

- One branch per PR from `main`: `feat/gpp-3c-<slug>`. Each later PR branches from `main` after its
  predecessor has merged.
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
- `apps/web/lib/work-management/drive-sequential-identity.test.ts` (new). It holds the generator
  and the comparison. **Commit 2 and every later commit must not edit the generator**; only the
  comparison side may grow.
  - **Runner.** It drives the real runner:
    `runWorkroomDriveJob(now, { listRooms, effects, reconcileNesting: async () => 0, reconcileNotifications: async () => {} })`
    (`workroom-drive.ts:386-502`).
  - **Clock.** `now` starts at `2026-01-01T00:00:00.000Z` and steps by 15 minutes per tick.
  - **Sequences.** 20 seeded sequences for every definition in `listWorkShapes()` and
    `WORK_SHAPE_PRIOR_VERSIONS`. Seed: `0x8875c9df + shapeIndex * 1000 + n`, using `mulberry32`
    copied from `interpreter-parity.test.ts:49-58`.
  - **Rooms.** `listRooms` returns one `WorkroomDriveRoom` per sequence. Each tick feeds the
    previous tick's captured snapshot back as `workspaceState.workroomDrive`. Each room is built
    the way the production loader builds it, by spreading
    `readStoredWorkroomDriveState(workspaceState)` (`workroom-drive.ts:623`). So `currentStageKey`,
    receipts and the other stored fields come from the fed-back snapshot.
  - **Effects.** `effects` is in-memory:
    - `persist` applies the **exported production merge function** (`mergeWorkroomDriveSnapshot`,
      extracted from `:660-670` in commit 1 as a pure move) and captures the result;
    - `acquireLease` returns `"acquired"`, or `"held"` on seeded ticks;
    - `upsertAgentTask` and `deactivateAgentTask` record task ids;
    - `notifyStall` records calls;
    - `resolveAccountability` is a stub returning a fixed resolved owner.
  - **Where each `DriveResolutionInput` field comes from**, as `runWorkroomDriveJob` builds it
    (`workroom-drive.ts:445-466`):

    | Field | Source |
    |---|---|
    | `roomId` | `room.capsuleId` |
    | `definition` | `resolveWorkShapeClaim(room.scopeClaims)` → `readWorkShapeDefinitionContract` (the claim pins the definition under test) |
    | `collaborationShape` | the definition's |
    | `postureLevel` | `postureLevelOf(scopeClaims)`: a seeded posture claim, `quiet` on some sequences |
    | `participants` | `projectPersistedWorkroomRoster` over seeded `room.participants`, including coordinator-overlap cases that reach `conformance_escalate` |
    | `currentStageKey`, `budgetUsage`, `stopConditionHits`, `reviewDue` | the fed-back snapshot, plus seeded room values (stop hits → `conformance_stop`; review due → `conformance_pause`) |
    | `receipts` | `earnEvidenceReceipts` over seeded `recordedEvidence` and `stageDispatchedAt` |
    | `substrateReachable`, `substrateEmpty` | seeded room booleans (→ `unreachable_substrate`, `empty_read`) |
    | `coordinatorEligibility` | seeded room value |
    | `now` | the stepped clock |
    | `priorDrive` | `priorDriveFromStored` over the fed-back snapshot (→ `executor_writeback_unavailable`, `cycle_complete`) |
    | `actionBoundary`, `proposedGrants`, `independent*PrincipalRef`, `requiredRoles`, `trigger`, `proposedStageKey` | not passed by `runWorkroomDriveJob`, so absent, exactly as in production |

    `missing_shape` comes from a seeded room whose claim resolves to no definition.
  - **Reason coverage.** The test asserts that every reason in `DRIVE_REASONS_BY_ACTION`, plus
    `executor_writeback_unavailable` and `cycle_complete`, was reached. Two cannot be reached
    through the runner with registry shapes, so they are generated by direct `resolveDrivePlan`
    cases in the same file:
    - `no_posture`: `postureLevelOf` never returns `null`;
    - `unknown_principal`: no registry stage has such a principal.
  - **Output.** The fixture records `canonicalJson` (`@dpf/integration-shared/canonical-json`) of
    every captured snapshot, plan summary, task id and deactivation.
- Commit 1 changes no runtime behaviour. Its only runtime edit is the pure extraction of
  `mergeWorkroomDriveSnapshot`. The fixture is generated by that code.

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
    `InterpretableShape` types, which start with `InterpretableGate` at `interpreter.ts:79` and end
    at `:291`.
  - `interpreter.ts` and `soundness.ts` import from it.
  - `interpreter.ts` re-exports the moved names so existing imports compile.
  - It imports only `element-ids` helpers. `element-ids.ts` has no runtime dependency on the
    compiler, and this PR verifies that.
- `apps/web/lib/gpp/shape-language/executable-constructs.ts`:
  - Add `constructsUsedBy(contract: WorkShapeDefinitionContract): Array<{ construct; elementId }>`.
    It walks the definition contract and covers exactly the elements of the current
    E-NOT-EXECUTABLE walk (`drc.ts:380-387, 465-477`).
  - Refactor `drc.ts` to call it on `lowerToDefinition(document)` (`emit.ts:142` at `6ce2f7e445`),
    so there is one walk.
  - Update the header (`:30`): the drive reads this table at runtime from Phase 3c.
- `apps/web/lib/work-management/drive-marking.ts` (new, pure):
  - `DriveMarking` type (design §4.1), including `cycleKey` and the per-token `taskId`,
    `lastAction`, `lastReason` and `lastCycleKey`.
  - `readStoredDriveMarking(workspaceState, definition, cycleKey)` returns one of:
    - `{ ok: marking }`;
    - `{ ok: false; reason: "marking_unreadable"; raw }`, where `raw` is the stored value, kept
      verbatim so it can be carried forward.
    An absent marking is derived from `stageKey`. A marking whose `cycleKey` differs from the
    current cycle is discarded, and a fresh one starts at the shape's start.
  - `usesGraphConstructs(definition)` is true when the shape declares `flow`, any `deadline`, any
    `subShape`, or any `advance.gate.onRefuse`. That last field is typed since #5977.
  - `latchPriorFor(token)` builds `PriorDriveForLatch` (`writeback-latch.ts:20-26`) from the
    token's own `lastAction`, `lastReason` and `lastCycleKey`, plus the token's stage.
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
  3. Both pauses keep the stored `stageKey`, rather than `emptyPlan`'s `null` at
     `drive-resolution.ts:130`, and carry the stored marking forward unchanged: the verbatim raw
     value when it is malformed (design §4.2).
  4. Otherwise build per-token plans with the existing human, governed, agent and writeback-latch
     rules, factored into a shared `planStage(stage, …)` helper. The latch uses `latchPriorFor(token)`.
  - The plan returns `DrivePlan` with additive optional `tokens?: DriveTokenPlan[]` and
    `marking?: DriveMarking | { raw: unknown }`.
- `apps/web/lib/work-management/drive-resolution.ts`:
  - Add `if (input.definition && usesGraphConstructs(input.definition)) return resolveGraphDrivePlan(input);`
    after the posture and substrate early returns.
  - Extract `planStage` from `:299-395` with **no behaviour change**. The golden proves it.
  - `DrivePlan` gains optional `tokens?` and `marking?`.
- `apps/web/lib/queue/functions/workroom-drive.ts`:
  - Export `mergeWorkroomDriveSnapshot(current, next)`, extracted from `persist` (`:660-670`) as a
    pure function in commit 1. In this PR it also merges `marking` and `pendingAttentions` from the
    current row when the next snapshot is for a graph shape, under the same compare-and-set and the
    same `lastCycleKey` condition as receipts.
  - `applyDrivePlan`, graph shapes:
    - If `plan.marking` is present, add `marking` and `pendingAttentions` to the snapshot.
    - **If `plan.marking` is absent, copy the stored `marking` and `pendingAttentions` forward
      verbatim.** This covers the posture and substrate early returns, `quiet`, the two fail-closed
      pauses and `lease_held`. It closes review blocker 1: today `persist` replaces the whole
      snapshot (`:679`).
    - Handle `plan.tokens` (dispatches are handled in PR-3c-2).
  - `applyDrivePlan`, sequential shapes: exactly today's path, with no new key.
  - `runWorkroomDriveJob`: earn receipts per marked stage, iteration-aware, only when a marking is
    present.
  - Hold and news on graph rooms:
    - `driveHoldKey`'s object gains `markedKeys` for graph rooms.
    - `driveTickIsNews` returns `true` when any token's `stageKey#iteration` changed, so an
      iteration change is never a quiet tick.
- `apps/web/lib/queue/functions/workroom-drive-data.ts`: `loadStageDispatchTimesByStage(capsuleIds)`
  for graph rooms only (rooms whose snapshot has `marking`). It returns `Map<capsuleId, Map<stageKey, Date>>`.
  - Dispatch rows use `payload.dispatchedStageKeys`.
  - Attention rows use the `pendingAttentions` stage keys.
  - `loadStageDispatchTimes` is unchanged.
  - `loadRecordedEvidence` additionally selects `payload #>> '{result,choice}'` as `choice` on
    `RecordedEvidence` (optional field). Nothing reads it until PR-3c-3. The query is unit-tested
    against an injected `$queryRaw`, asserting the selected columns and the row mapping.
  - `LIMIT 500` across all rooms (`:203`) is a pre-existing defect and is **not** changed here. The
    coordinator files a BI for it.
- `apps/web/lib/work-management/workroom-drive-receipts.ts`:
  - `WorkroomDriveReceipt.iteration?: number`.
  - The dedupe key becomes `(stageKey, kind, iteration ?? 0)`.
  - New `isCompletingWorkroomDriveReceiptAt`.
  - `isCompletingWorkroomDriveReceipt` is unchanged and is used by the sequential path.
- `apps/web/lib/work-management/workroom-drive-state.ts`: copy `iteration` only when it is a finite
  non-negative integer. Expose `marking` through `readStoredDriveMarking`; do not add it to
  `StoredWorkroomDriveState`.
- `apps/web/lib/work-management/stage-evidence-receipts.ts`:
  - An optional `iteration` passes through to the earned receipt.
  - When `iteration` is given, the early return (`:97`) uses
    `isCompletingWorkroomDriveReceiptAt(receipt, stageKey, iteration)`.
  - Evidence must post-date that iteration's own dispatch or attention activity, which is the
    `dispatchedAt` the per-stage loader supplies for the current iteration.
  - Without `iteration`, the function is unchanged.
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
- `apps/web/lib/work-management/workroom-drive-hold.ts`:
  - `driveHoldKey`'s input object (`:47-51`) gains optional `markedKeys`. When given, it joins
    `sorted(key#iteration)` in place of `stageKey`.
  - `driveTickIsNews` (`:90-92`) gains an optional `iterationChanged` flag.
- `apps/web/lib/work-management/drive-conclusion.ts`: register `construct_not_executable` and
  `marking_unreadable` under `pause` in `DRIVE_REASONS_BY_ACTION`, each with a `BLOCKAGES` entry
  (design §5 table).
- `apps/web/lib/work-management/work-shape-binding-diff.ts`: new kinds, each firing only when one
  side declares the field:
  - `flow-changed` (widening)
  - `deadline-added` (narrowing)
  - `deadline-relaxed` and `deadline-removed` (widening)
  - `sub-shape-changed` (widening)
- `apps/web/lib/gpp/shape-language/decompile.ts` and `emit.ts` (`lowerToDefinition`): carry four
  things when present (design corrections 5 and 12). `legacy.ts` is unchanged.
  - `flow`, `deadline` and `subShape`.
  - The definition's own `advance.gate`. Today `decompile.ts:18-21, 59-60` takes the gate only from
    the ratification table. A declared gate wins, and D-8 still compares it with the ratified entry.
- `apps/web/lib/work-management/work-shape-graph-constructs.test.ts` (new): the registry guard
  (design §7.2), with a shrink-only `KNOWN_GRAPH_SHAPES` allow list, empty at merge.
  - For each graph shape it runs `checkSoundness` and the full `runDesignRules` with
    `defaultResolveSources()` over the decompiled document.
  - It expects no error-severity finding. D-9 and D-10 are included once PR-3c-5 adds them.

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
- `drive-marking-durable.test.ts` (new). **AC-3C-MARKING-DURABLE.** It uses a graph fixture and a
  test-only flag override, through `runWorkroomDriveJob` with the in-memory merge persist:
  - Kill switch: flag off, then on. The room pauses `construct_not_executable` with its `stageKey`
    and marking intact, then resumes the same marking.
  - Posture `quiet`, then `balanced`. A stored marking holding `reworkTaken` keeps it.
  - A malformed stored marking survives a `marking_unreadable` pause byte-for-byte.
  - A cycle-key change discards the marking and restarts at the start.
  - `lease_held` changes nothing.
- `drive-conclusion.test.ts` (extend). **AC-3C-CONCLUDED** (part): `construct_not_executable` and
  `marking_unreadable` never conclude `unconcluded` (`drive-conclusion.ts:143-211`).
- `workroom-drive-data.test.ts` (new; no test file exists for `workroom-drive-data.ts` today): the `loadRecordedEvidence` `choice` column and mapping.
- `stage-evidence-receipts.test.ts` (extend): an iteration-0 receipt does not short-circuit
  iteration 1; evidence older than iteration 1's dispatch does not earn it.
- `workroom-drive-receipts.test.ts` (extend): dedupe with iteration; legacy dedupe unchanged.
- `drive-resolution.test.ts` (extend): a graph fixture with any flag off → `pause` /
  `construct_not_executable`, naming the element. **AC-3C-FAILCLOSED** (runtime half).
- `work-shape-graph-constructs.test.ts`. **AC-3C-FAILCLOSED** (registry half). A seeded unsound
  fixture, or one with its flag off, is refused when injected.
- `workroom-shape-conformance.test.ts` (extend). **AC-3C-CONFORMANCE** (sequential half): every
  existing case unedited; a `flowOrder` forward move is legal; an out-of-graph proposal raises
  `out_of_order_stage`.
- `workroom-shape-rebind.server.test.ts` (extend; the existing rebind suite). **AC-3C-REBIND** (multi-token and rework-counter
  cases).
- `work-shape-binding-diff.test.ts` (extend): one case per new kind; existing cases unedited.
- `registry-roundtrip.test.ts` and `interpreter-parity.test.ts`: unchanged and green. The flow-graph
  move is invisible to them.
- `pnpm --filter web typecheck`.

**Rollout.** No existing room reaches the new path. **Rollback.** Revert the PR. No data depends on
it, because no room has a `marking`.

**Satisfies:** OBJ-3C-NODISRUPT, OBJ-3C-FAILCLOSED, OBJ-3C-MARKING; AC-3C-SEQ-IDENTICAL,
AC-3C-STATE-COMPAT, AC-3C-MARKING-DURABLE, AC-3C-FAILCLOSED, AC-3C-CONFORMANCE (sequential half),
AC-3C-REBIND (part), AC-3C-CONCLUDED (part), AC-3C-BUILD-STUDIO.

## PR-3c-2: parallel split / join (`parallel-split-join`)

**Goal.** Execute design §6.1, and prove it against the interpreter.

**Files**

- `drive-marking.ts`: implement split placement (recursive through nested splits) and join
  arrivals `{ node, from }` with completion, following `interpreter.ts:364-389`. Each placed token
  gets `enteredAt = now`.
- `drive-resolution-graph.ts`:
  - One `DriveTokenPlan` per marked stage.
  - The aggregate action follows design §4.3 precedence.
  - **The task id is fixed when a token enters an agent stage** and stored as `token.taskId`.
    - It is `workroomDriveTaskId(roomId, shapeKey)` when no other live token holds that id.
    - Otherwise it is `workroomDriveBranchTaskId(roomId, shapeKey, stageKey)` (`…--<stageKey>`).
    - Later ticks reuse the stored id and never recompute it from the current marking.
  - The per-token latch uses `latchPriorFor(token)`. After a dispatch, the token's `lastAction`,
    `lastReason` and `lastCycleKey` are updated.
- `drive-resolution.ts`: export `workroomDriveBranchTaskId` beside `workroomDriveTaskId`.
- `workroom-drive.ts`, `applyDrivePlan`:
  - Acquire the lease once, then `upsertAgentTask` per dispatch token, with `token.taskId`.
  - The snapshot records `dispatchedStageKeys`.
  - **When a token leaves its stage**, deactivate its `taskId` in the same tick. A token leaves when
    it fires, waits as a join arrival, or is cleared by a rework. The upsert reactivates a task and
    resets `nextRunAt` (`workroom-drive.ts:735-758`), so a task left active keeps running for a
    stage that is no longer marked.
  - On `stop`, `do_not_wake` or success, deactivate every `taskId` in the prior marking.
  - Per-token writeback latch. The room-level prior latches only the stage it names
    (`writeback-latch.ts:53-54`), so each token supplies its own prior.
- `workroom-stage-decision.ts`:
  - `readPendingGovernedDecisions(workspaceState)` (plural) reads `pendingAttentions`, falling back
    to `pendingAttention`.
  - `readPendingGovernedDecision` returns the first, unchanged.
  - `workroom-stage-decision.server.ts`: `loadDecisionContext` accepts the stage key the control
    already posts (`StageDecisionInput.stageKey`), validated against the plural list.
- Room-view plumbing. Every change is optional, and absent means today's single stage:
  - `workroom-drive-state.ts`: `projectStoredWorkroomDriveObservation` (`:62-76`) adds
    `currentStageKeys` from the marking.
  - `workspace-case-loader.ts:725` and `workroom-only-case-projection.ts:156` pass it through.
  - `room-read-model.ts`: the observation type (`:94-100`) gains `currentStageKeys?`, and the
    conformance call (`:258-268`) forwards it.
  - `workroom-shape-conformance.ts`: `WorkroomShapeConformance` gains `currentStageKeys?`. It
    reaches the view as `processOverseer` (`room-types.ts:261`).
  - `shape-projection.ts:240-243`: each key in `currentStageKeys` reads "current". The sequential
    branch is unchanged.
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
  - two concurrent agent branches → two `upsertAgentTask` calls with distinct, stored ids under one
    lease;
  - **two agent branches that never write back each latch after exactly one dispatch per cycle**,
    with no re-dispatch on later ticks of that cycle (AC-3C-BRANCH-LATCH);
  - a token that fires, waits at a join, or is cleared has its task deactivated in that tick;
  - a stop deactivates all branch tasks;
  - one branch latched by writeback does not block the other.
- `room-read-model.test.ts` and `shape-projection.test.ts` (extend): several current stages render as
  current; a sequential room is unchanged.
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

**Satisfies:** OBJ-3C-MARKING, OBJ-3C-PARITY; AC-3C-PARALLEL-PARITY, AC-3C-BRANCH-LATCH,
AC-3C-CONFORMANCE, AC-3C-FLAG-FLIP.

## PR-3c-3: refuse routes and rework edges (`rework-edge`)

**Preconditions.**

- PR-3c-2 is merged, because the `rework-inside-branch` fixture needs the parallel step.
- PR-3b-4 is merged (#5977), which gives `WorkShapeAdvance` its `gate?: WorkShapeGate` with
  `onRefuse` (`work-shapes.ts:54-56, 73-84` at `6ce2f7e445`).
- One flag covers both notations (design correction 1).
- **Q1 must be asked before PR-3c-3 merges.** Its answer blocks only a shape adopting a refuse route
  on a stage that offers `defer`.

**Files**

- `drive-marking.ts`:
  - Refuse routing per design §6.2 and `interpreter.ts:417-462`:
    - target is a stop → consume all tokens;
    - target is an earlier stage → counter, bound check (the first budget stop when exceeded),
      `iterations[s] += 1` across the loop region, clear the region's tokens, place a token on the
      target with fresh `enteredAt`;
    - no route, meaning the declared route's bound is exceeded and the shape has no budget stop
      (`interpreter.ts:439-441`) → the token stays.
  - A verdict is ignored unless its mode equals the gate's mode.
- `drive-resolution-graph.ts`:
  - `deriveGateVerdict(stage, evidence, iteration)`. It reads the latest `decision-record` for the
    stage at this iteration using `RecordedEvidence.choice`:
    - `accept` → `admit`
    - `patch` → `admit`
    - `defer` → `admit`, per the founder decision of 2026-10-02 that `defer` keeps advancing. `hold`
      waits for the spec §14 Q1 confirmation, and changing it is a one-line follow-up with its own
      decision.
    - `refuse` → `refuse`
  - Only for enforced, blocking gates with a refuse route.
  - A refuse with no route → `attention` / `gate_refused` to `gate.escalation.role` ?? the stage
    principal.
- `drive-conclusion.ts`: register `gate_refused` under `attention`, with a `BLOCKAGES` entry
  (design §5 table).
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
    - `refuse-bound-no-budget-stop` (renamed from `refuse-no-route`). The bound is exceeded and the
      shape has no budget stop, so the token stays (`interpreter.ts:420-441`). This parity-only
      fixture is deliberately not S-6-sound.
    - `shadow-gate`
    - `defer-on-refuse-route`: a `defer` decision on a refuse-route stage advances the token
    - `rework-inside-branch` (a rework inside a parallel branch, same-block rule)
  - Events add `gate-verdict`. For the drive, a verdict is a `decision-record` evidence row with
    `choice`.
  - The harness maps `defer` to an `admit` verdict for the interpreter.
  - For enforced, blocking gates **without** a refuse route, where the drive derives no verdict,
    the harness feeds the interpreter `admit` alongside every completing receipt. The interpreter
    otherwise holds such a token (`interpreter.ts:471-477`) while the drive advances it. That
    divergence is recorded as part of Q1, not hidden.
  - Asserted after each event: marked stages, stopped, and `reworkTaken`, compared with the
    interpreter's `reworkTaken`.
  - Plus: a stale-iteration receipt never completes the new iteration.
- `workroom-stage-decision.test.ts` (extend):
  - `refuse` is offered only with a refuse route;
  - every existing stage's offered choices are unchanged, checked over the registry;
  - the evidence summary uses the new verb.
- `drive-conclusion.test.ts` (extend): `gate_refused` never concludes `unconcluded`.
- `stage-permit-revocation.test.ts` (new): with an injected permit store holding a permit for that
  `workroomId` and `stageKey`, the permit is revoked; with none, nothing is written.
- `workroom-shape-conformance.test.ts` (extend): the declared refuse route is legal; any other
  backward move still raises `out_of_order_stage`.
- `not-executable.test.ts` (edit). **AC-3C-FLAG-FLIP**: both the rework-edge fixture and the
  refuse-edge fixture now compile.
- `drive-sequential-identity.test.ts`: still green.

**Rollout.**

- No registry stage declares a refuse route, so "Send back" appears nowhere.
- Q1 must be asked before PR-3c-3 merges. Its answer blocks only a shape adopting a refuse route on
  a stage that offers `defer`.

**Rollback.** Flip the flag back, or revert.

**Satisfies:** OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-ACCOUNTABLE; AC-3C-REWORK-PARITY,
AC-3C-CONFORMANCE, AC-3C-CONCLUDED (part), AC-3C-FLAG-FLIP.

## PR-3c-4: stage deadline (`stage-deadline`)

**Precondition.** PR-3c-2 is merged, because the deadline parity runs over the PR-3c-2 fixtures.

**Files**

- `interpreter.ts`, its own first commit: event `{ type: "deadline"; stageKey }`, which returns the
  marking unchanged (parent §6.1 rule 8). It comes with `interpreter.test.ts` cases written from the
  rule text.
- `drive-marking.ts`: `overdueDeadlines(definition, marking, now)`. It lists tokens with
  `now ≥ enteredAt + afterDays·86 400 000 ms` whose key `<cycleKey>#<stageKey>#<iteration>` is not
  yet in `marking.deadlines`.
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
  - Under a stepped clock, the checks are:
    - exactly one entry per `<cycleKey>#<stageKey>#<iteration>`;
    - a rework creates a new key;
    - the next cycle can notify the same stage again;
    - a failed notify retries;
    - a successful notify never repeats.
- `workroom-stall.test.ts` (extend): an overdue room appears once, with the deadline reason.
- `not-executable.test.ts` (edit): AC-3C-FLAG-FLIP.
- `drive-sequential-identity.test.ts`: still green.

**Rollout.** No registry stage declares a deadline. **Rollback.** Flip the flag back, or revert.

**Satisfies:** OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-ACCOUNTABLE; AC-3C-DEADLINE-PARITY,
AC-3C-FLAG-FLIP.

## PR-3c-5: sub-shape (`sub-shape`)

**Precondition.** PR-3c-2 is merged, because the `sub-in-branch` fixture needs the parallel step.

**Files**

- `interpreter.ts`, its own first commit: event `{ type: "child-stop"; stageKey; kind }`.
  - `success` on a marked stage behaves as a completing receipt for it.
  - `failure` or `budget` leaves the marking unchanged.
  - Comes with unit tests.
- `drive-marking.ts`: when a token enters a sub-shape stage, add a child entry
  `children["<cycleKey>#stageKey#iter"] = { capsuleId: null-until-created, ref }`.
- `drive-resolution-graph.ts`:
  - A sub-shape stage plans `ensure_child` (internal) plus `attention` / `awaiting_sub_shape`.
  - It reads the child's stored drive snapshot through the existing room loader:
    - `stop` / `success` → plan `record_child_completion`;
    - `stop` with a failure or budget stop → `attention` / `sub_shape_stopped`, with the
      disposition.
- `apps/web/lib/queue/functions/workroom-drive-children.ts` (new; keeps `workroom-drive.ts` under
  the substrate-complexity threshold noted at `workroom-drive-data.ts:3-5`). Effects:
  - `ensureChildRoom` — `createWorkCapsule` with
    `idempotencyKey = "sub-shape:<parentCapsuleId>:<cycleKey>:<stageKey>:<iteration>"`. The cycle key
    is needed because an existing key returns the existing row (`work-capsule-store.ts:130-133`),
    which would hand a new cycle the previous cycle's completed child.
    `scopeClaims = withWorkShapeClaim([], ref)`, the parent's owner, the system actor; plus a
    `contains` relation with `skipDuplicates`.
  - `recordChildCompletion` — `recordWorkCapsuleEvidence` on the parent:
    - kind `child-completion`, outcome `completed`, current iteration;
    - payload `{ childCapsuleId, childShapeRef, disposition }`;
    - then `updateWorkCapsuleStatus(child, "complete")` (`work-capsule-store.ts:928`). Before
      relying on it, run a technical check that `updateWorkCapsuleStatus` accepts the system actor;
      if it does not, use the governed completion path;
    - and, **in the same transaction**, delete the parent→child `contains` row.
  - `abandonChild` — on rework across the stage, set the stale child to `abandoned` with a reason,
    and in the same transaction delete its parent→child `contains` row.
  - **Why the drive deletes the row itself.** The existing terminal-room reconcile does not cover
    child rooms. It loads only `standing-room:` keys (`workroom-drive-data.ts:29-30`) and withdraws
    only standing-room keys (`standing-room-nesting.ts:113-118`).
- `drive-conclusion.ts`: register `awaiting_sub_shape` (attention, `IN_MOTION`) and
  `sub_shape_stopped` (attention, `BLOCKAGES`) (design §5 table).
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
  - exactly one child per cycle, stage and iteration across repeated ticks (idempotency); a new
    cycle creates a new child;
  - the child pins the declared version;
  - a `contains` row exists;
  - success records `child-completion`, completes the child and removes the `contains` row in one
    transaction;
  - failure holds the parent with `sub_shape_stopped` and does not complete the child;
  - rework abandons the stale child, removes its `contains` row in the same transaction, and
    creates a new one.
- `drive-conclusion.test.ts` (extend): `awaiting_sub_shape` and `sub_shape_stopped` never conclude
  `unconcluded`. Completes AC-3C-CONCLUDED.
- `drc-corpus.test.ts` (extend). **AC-3C-SUBSHAPE-NO-WIDEN**: D-9 and D-10 fixtures are refused
  with their rule id and element id.
- `workroom-shape-rebind.server.test.ts` (extend; the existing rebind suite): a live child → `marking_not_mappable`. Completes
  AC-3C-REBIND.
- `not-executable.test.ts` (edit): AC-3C-FLAG-FLIP. After this PR no construct remains off.
- `drive-sequential-identity.test.ts`: still green.

**Rollout.** No registry stage declares a sub-shape. **Rollback.** Flip the flag back. Live
children then pause with their parent, visibly. Or revert.

**Satisfies:** OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-CONTAINMENT, OBJ-3C-ACCOUNTABLE;
AC-3C-SUBSHAPE-PARITY, AC-3C-SUBSHAPE-NO-WIDEN, AC-3C-REBIND, AC-3C-CONCLUDED, AC-3C-FLAG-FLIP.

## Tasks

### PR-3c-1

- [ ] Commit 1: extract `mergeWorkroomDriveSnapshot` (pure move); golden generator through `runWorkroomDriveJob`; fixture
- [ ] Types (`flow?`, `deadline?`, `subShape?`; contract `flow?` by conditional spread)
- [ ] Move the flow graph to `work-shape-flow-graph.ts`; re-export from the interpreter
- [ ] `constructsUsedBy`, with the DRC refactored onto it; header update
- [ ] `drive-marking.ts` (cycle-scoped marking, per-token latch prior), `drive-resolution-graph.ts`, structural branch, `planStage` extraction
- [ ] Marking carry-forward in `applyDrivePlan` and the merge; fail-closed pauses keep `stageKey` and marking; durable-marking tests
- [ ] `drive-conclusion.ts` entries for `construct_not_executable` and `marking_unreadable`
- [ ] Iteration-aware receipts and evidence early return, state reader, evidence `choice` column (unit-tested), per-stage dispatch loader, iteration-change-is-news
- [ ] Flow-aware conformance input; rebind `marking_not_mappable`; hold key; binding-diff kinds
- [ ] Decompile and lower carry-through, including the definition's own `advance.gate`; registry guard (full `runDesignRules`) with an empty allow list
- [ ] Tests; `typecheck`; Build Studio diff check; fast local gate; PR

### PR-3c-2

- [ ] Split/join step; task id fixed on the token at entry; lease-once multi-dispatch; deactivation on leave and on terminal actions
- [ ] Per-token latch test (two branches, one dispatch per cycle)
- [ ] Plural pending decisions; room-view plumbing for several current stages
- [ ] Parallel parity (four fixtures including the R2D fork); flag flip; not-executable edit
- [ ] Fast local gate; PR; record "UX owed by BI-580A970A" on BI-8875C9DF

### PR-3c-3 (after PR-3c-2; PR-3b-4 is merged)

- [ ] Put Q1 to the founder after WWMD consultation; it must be asked before merge
- [ ] Refuse routing and iteration bump; verdict derivation (`defer → admit`); "Send back" choice; `gate_refused` conclusion entry
- [ ] Revocation hook and test; rework parity; flag flip
- [ ] Fast local gate; PR

### PR-3c-4 (after PR-3c-2)

- [ ] Interpreter `deadline` event (own commit); overdue detection; notify-after-commit with retry
- [ ] Stall source extension; deadline parity; flag flip
- [ ] Fast local gate; PR

### PR-3c-5 (after PR-3c-2)

- [ ] Technical check that `updateWorkCapsuleStatus` accepts the system actor
- [ ] Interpreter `child-stop` event (own commit); child lifecycle effects module (cycle-scoped key, `contains` deleted in-transaction); conclusion entries
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
3. **`usesGraphConstructs` reads the typed gate.** #5977 merged `WorkShapeGate.onRefuse`
   (`work-shapes.ts:73-84` at `6ce2f7e445`), so no structural read is needed.
4. **Status of design Q1–Q7** (spec §14):
   - **Q1:** decided for every existing stage (`defer` keeps advancing; 3c maps `defer → admit`).
     The refuse-route case must be asked before PR-3c-3 merges. Its answer blocks only a shape
     adopting a refuse route on a stage that offers `defer`.
   - **Q2 and Q6:** decided (founder, 2026-10-02). What remains for PR-3c-5 is the technical check
     that `updateWorkCapsuleStatus` accepts the system actor.
   - **Q3, Q4, Q5 and Q7:** design-review defaults, open only until the review records a verdict.
5. **One golden, two runners.** The golden runs through `runWorkroomDriveJob`, plus direct
   `resolveDrivePlan` cases for the two reasons the runner cannot reach with registry shapes
   (`no_posture`, `unknown_principal`). That is a coverage limit of the runner, not of the golden.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The substrate subtly changes a sequential room (key order, hold key, task id) | Golden from pre-change code; conditional spreads; legacy readers untouched; every PR re-runs it |
| R2 | The flow-graph move breaks the compiler | Pure move with re-exports; the AC-INTERPRETER, soundness and DRC suites unchanged and green |
| R3 | Parity passes but the drive differs in production because of evidence timing | Parity feeds the drive through `earnEvidenceReceipts`-equivalent receipts. Per-stage dispatch bounds are unit-tested. R2D's live verification is the functional proof |
| R4 | Branch tasks leak after a stop | Deactivate every branch task named in the prior marking; a test asserts none stays active |
| R5 | `defer → hold` reaches a live stage | Not applied. Per the founder decision of 2026-10-02, 3c maps `defer → admit` everywhere, refuse-route stages included. Q1 must be asked before PR-3c-3 merges. Its answer blocks only a shape adopting a refuse route on a stage that offers `defer`. Spec §14 Q1 |
| R6 | The deadline notice duplicates or is lost | Key per cycle, stage and iteration; notify after commit; retry on failure |
| R7 | Child rooms orphan or multiply | Idempotency key per cycle, stage and iteration; terminal on stop; abandon on rework; the drive deletes the `contains` row in the same transaction, because the existing reconcile covers only `standing-room:` keys |
| R8 | PR-3c-2 slips and blocks PR-3c-3, -4 and -5 (their in-branch fixtures need it) | PR-3c-2 is second in the sequence anyway, because it unblocks R2D. PR-3b-4 is already merged (#5977) |
| R9 | `workroom-drive.ts` crosses the complexity hotspot threshold | New effects go in `workroom-drive-children.ts` and the graph planner in `drive-resolution-graph.ts` |
| R10 | A graph room loses its marking on a plan without one and silently restarts (review blocker 1) | Carry-forward in `applyDrivePlan`; `marking` and `pendingAttentions` merged in `mergeWorkroomDriveSnapshot` under the receipts' compare-and-set; malformed kept verbatim; fail-closed pauses keep `stageKey`; AC-3C-MARKING-DURABLE |
| R11 | Non-first branches re-dispatch every tick (review blocker 2, the #5166 defect) | Per-token latch prior; AC-3C-BRANCH-LATCH |
| R12 | Phase 4's conformance change breaks AC-3C-SEQ-IDENTICAL | The Phase 4 plan's preferred fix leaves the deviation type unchanged and derives the stage inside the detector, so the persisted `conformance` bytes the golden covers do not change. If Phase 4 widens the type instead, it regenerates the golden in its own PR, with the diff reviewed |
| R13 | Evidence starvation: `loadRecordedEvidence`'s `LIMIT 500` spans all rooms (`workroom-drive-data.ts:203`) | Pre-existing; graph rooms worsen it; the coordinator files a BI. Not fixed in 3c; should land before a wide fork relies on per-branch evidence |
| R14 | A new reason concludes `unconcluded` | `drive-conclusion.ts` entries in the PR that introduces each reason; AC-3C-CONCLUDED |

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
| PR-3c-1 substrate | OBJ-3C-NODISRUPT, OBJ-3C-FAILCLOSED, OBJ-3C-MARKING | AC-3C-SEQ-IDENTICAL, AC-3C-STATE-COMPAT, AC-3C-MARKING-DURABLE, AC-3C-FAILCLOSED, AC-3C-CONFORMANCE, AC-3C-REBIND, AC-3C-CONCLUDED, AC-3C-BUILD-STUDIO | contract:workroom-drive-state, contract:drive-marking, contract:executable-construct-flags, contract:work-shape-binding-diff | flow:drive-tick, flow:sequential-receipt-to-next-stage |
| PR-3c-2 parallel | OBJ-3C-MARKING, OBJ-3C-PARITY | AC-3C-PARALLEL-PARITY, AC-3C-BRANCH-LATCH, AC-3C-CONFORMANCE, AC-3C-FLAG-FLIP | contract:shape-token-semantics, contract:drive-marking | flow:parallel-split-join, flow:drive-tick |
| PR-3c-3 rework and refuse | OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-ACCOUNTABLE | AC-3C-REWORK-PARITY, AC-3C-CONFORMANCE, AC-3C-CONCLUDED, AC-3C-FLAG-FLIP | contract:shape-token-semantics, contract:stage-decision-choices | flow:gate-refuse-route |
| PR-3c-4 deadline | OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-ACCOUNTABLE | AC-3C-DEADLINE-PARITY, AC-3C-FLAG-FLIP | contract:drive-marking | flow:stage-deadline-notice |
| PR-3c-5 sub-shape | OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-CONTAINMENT, OBJ-3C-ACCOUNTABLE | AC-3C-SUBSHAPE-PARITY, AC-3C-SUBSHAPE-NO-WIDEN, AC-3C-REBIND, AC-3C-CONCLUDED, AC-3C-FLAG-FLIP | contract:gpp-diagnostics, contract:drive-marking | flow:sub-shape-child-room |
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
