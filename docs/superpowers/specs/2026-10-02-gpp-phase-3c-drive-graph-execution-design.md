---
status: draft
---

# GPP Phase 3c: the work-shape drive executes graph constructs

| | |
|---|---|
| Date | 2026-10-02 |
| Epic | EP-B932453F |
| Backlog | BI-8875C9DF (child of BI-6DA17863) |
| Parent design | [GPP shape notation, execution semantics and compiler](2026-10-02-gpp-shape-notation-and-compiler-design.md), §5 catalog (Exec column), §5.4, §6.1–§6.5, §11 (Phase 3c row), §14. Approved; **not edited** by this spec. |
| Prior plan | [GPP Phase 3a and 3b](../plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md) |
| Related design | [Governed rebind of a live Workroom](2026-10-01-workroom-shape-rebind-design.md) |
| First consumer | BI-580A970A (EP-MBSE-WORKROOM-SPINE): the R2D reference room, a linear spine that forks at Deploy, one branch per target |
| Normative owner | [GPP](../../architecture/gated-permissions-process.md) §7, §12.4 |
| Verified against | `origin/main` at `879b344fa1`. Review revisions re-checked on `origin/main` at `6ce2f7e445`, which adds #5977 (PR-3b-4/5). #5977 touches none of the drive files cited here. Line numbers in `work-shapes.ts`, `decompile.ts`, `emit.ts` and `work-shape-binding-diff.ts` are taken from `6ce2f7e445` wherever that is stated. |

## 1. Problem

The compiler on main refuses any document that uses a construct the drive cannot run. It reports
`E-NOT-EXECUTABLE <construct> at <element id>` (`apps/web/lib/gpp/shape-language/drc.ts:173-183`).
Four flags are off in `CONSTRUCT_EXECUTABLE`
(`apps/web/lib/gpp/shape-language/executable-constructs.ts:58-75`):

- `stage-deadline`
- `parallel-split-join`
- `rework-edge`, which also covers a gate's `onRefuse` route (`executable-constructs.ts:24-26`;
  `drc.ts:380-381`)
- `sub-shape`

The drive has exactly one token. `nextStageKey`
(`apps/web/lib/work-management/drive-resolution.ts:142-156`) returns the current stage until a
completing receipt exists for it, then `stages[index + 1]`, then `null`. Everything around it
assumes one token:

- **Persisted state.** `workspaceState.workroomDrive` holds one `stageKey` and one
  `pendingAttention`. It is written in `apps/web/lib/queue/functions/workroom-drive.ts:260-284` and
  read in `apps/web/lib/work-management/workroom-drive-state.ts:18-49`.
- **Dispatch.** There is one `ScheduledAgentTask` per room and shape:
  `workroomDriveTaskId(roomId, shapeKey)` (`drive-resolution.ts:104-106`).
- **Evidence.** One dispatch time per room, found by joining on `workroomDrive.stageKey`
  (`apps/web/lib/queue/functions/workroom-drive-data.ts:144-174`). One receipt earned per tick, for
  the current stage only (`workroom-drive.ts:438-444`).
- **Conformance.** Stage order is checked by array-index arithmetic
  (`apps/web/lib/work-management/workroom-shape-conformance.ts:311-370`). It would flag every legal
  parallel or rework move as `out_of_order_stage`.
- **Hold and rebind.** Both key on one stage. See `driveHoldKey`
  (`apps/web/lib/work-management/workroom-drive-hold.ts:47-51`) and `stageInFlight`
  (`apps/web/lib/work-management/workroom-shape-rebind.ts:44-55`).
- **Receipts can only be added.** `appendCompletingWorkroomDriveReceipt`
  (`apps/web/lib/work-management/workroom-drive-receipts.ts:26-45`) deduplicates on
  `(stageKey, kind)`. The persist transaction merges the stored receipts back into each new
  snapshot (`workroom-drive.ts:662-670`). So the interpreter's rework rule, "clear the receipts of
  the stages the token returns across" (`interpreter.ts:446-458`), cannot be done by deleting
  receipts.

R2D needs a fork per deploy target. Until the drive can run a parallel split and join, no
non-sequential shape can exist.

## 2. Scope

**In scope.**

- The drive runs parallel split/join, rework loops including refuse routes, stage deadlines and
  sub-shapes.
- Each construct's executable flag flips only alongside a drive-versus-interpreter parity test for
  that construct.
- The persisted drive state widens additively.
- Conformance, attention, hold and rebind read the wider state.

**Out of scope.**

- Canvas rendering (Phase 4, BI-F8D4C529).
- Standing up R2D itself (BI-580A970A).
- Migrating shapes to documents (BI-ACCDC3A7).
- Build Studio as a shape (Phase 5, BI-D37B2C13).
- Binding attach and stage permits (the 3b follow-up coordinated with BI-69415B68).
- Interrupting timers, OR-joins and multi-instance. The parent §6.1 excludes all three.

## 3. Grounding: what exists and how this spec uses it

| Existing work | File | Use here |
|---|---|---|
| Reference interpreter `stepShapeInstance`, `startShapeInstance`, `markedStageKeys` | `apps/web/lib/gpp/shape-language/interpreter.ts:490-544` | The statement each construct is proven against. Rules: one stage fires per event, the first enabled in document order (`:464-487`); join waits for every incoming branch (`:378-386`); refuse routes (`:417-462`); stop consumes all tokens (`:349-357`) |
| Shared flow graph `buildShapeFlowGraph` | `interpreter.ts:152-264` | Moves to `work-management` so the drive, the interpreter and soundness read one graph (§6.1) |
| AC-INTERPRETER harness (seeded mulberry32, 200 sequences per shape) | `interpreter-parity.test.ts:43-218` | Extended per construct into drive-versus-interpreter parity |
| Soundness S-1…S-6, including "a stage has at most one incoming and one outgoing edge" | `soundness.ts:1-45` | Unchanged. The drive may assume block structure and 1-safety because no document that fails them compiles |
| Executable flags | `executable-constructs.ts:58-75` | Become the single on/off switch for both the compiler and the drive (§7) |
| Drive plan and runner | `drive-resolution.ts:190-396`; `workroom-drive.ts:214-502` | Generalized behind a structural branch. Sequential shapes keep the existing code path, unchanged (§5) |
| Cadence | `WORKROOM_DRIVE_CRON = "*/15 * * * *"` and the run-now event (`workroom-drive-constants.ts:5-8`) | The deadline clock (§8) |
| Evidence-earned receipts | `stage-evidence-receipts.ts:69-101` | Earned per marked stage, bounded by that stage's own dispatch time |
| Human stage decision (`accept` / `patch` / `defer`) recorded as completed `decision-record` evidence | `workroom-stage-decision.ts:32-38, 166-190` | The source of gate verdicts, read from `payload.result.choice` (`work-capsule-activity-store.ts:52-75` writes `payload = evidence`) |
| `child-completion` evidence kind | `work-shape-evidence-kinds.ts:22`; used by `delivery-xlarge` stage `children` (`delivery-shapes.ts:304-310`) | How a sub-shape returns the parent token (§9) |
| Room creation, idempotent on `idempotencyKey` | `createWorkCapsule` (`work-capsule-store.ts:113-175`, check at `:130-133`) | Child rooms for sub-shapes |
| Room relations `contains`, `spawned-from` | `room-relations.ts:8-14`; accountability walk `RESPONSIBILITY_RELATION_KINDS` (`human-accountability.ts:24`) | Parent→child containment, so the child inherits accountability |
| Pinned shapes per room | `readWorkShapeClaim` / `resolveWorkShapeClaim` / `withWorkShapeClaim` (`workroom-shape-claim.ts:103-155`); prior versions via `getWorkShapeVersion` (`work-shapes.ts:294`) | A child pins its exact `key@version` from `stage.subShape` |
| Binding diff | `work-shape-binding-diff.ts` | Gains rows for `flow`, `deadline` and `subShape` |
| Rebind in-flight guard | `workroom-shape-rebind.ts:44-55`, `REBIND_REFUSAL_CODES` (`:18-24`) | Gains `marking_not_mappable` |
| GPP permits | `permit-mint.ts:27` (TTL 15 min), `:56-80` (`shapeRef: null`, `stageKey: null`, `workroomId`, `parentPermitId`) | Sub-shape permit scoping (§9.4). Rework revocation is a hook with nothing to revoke yet (§6.3) |

Prerequisites from Phase 3b:

- **PR-3b-4 and PR-3b-5 are merged** (#5977, `6ce2f7e445`).
  - `WorkShapeAdvance` now carries `gate?: WorkShapeGate` (`work-shapes.ts:54-56` at `6ce2f7e445`),
    and `WorkShapeGate` has `onRefuse?` (`:73-84`).
  - The generator and `check:gpp-shapes` exist.
  - The rework PR's type dependency is therefore met.
- **Gap that remains (verified).** `decompile` copies a definition's own `stage.binding`, but it
  takes `advance.gate` **only** from the ratification table, never from the definition
  (`decompile.ts:15-21, 59-60` at `6ce2f7e445`). So a registry shape whose code declares
  `gate.onRefuse` decompiles without it, and the registry guard (§7.2) could not see the refuse
  route. PR-3c-1 makes `decompile` copy a definition's own `advance.gate` when present. D-8 still
  compares that gate with the ratified entry.
- **PR-3b-6 (proof migration) is not merged.** A *compiled document* reaches the runtime only
  through a migration. A hand-declared registry shape can carry the new optional fields earlier,
  but only under the registry guard.

## 4. Drive state model for many tokens (decision 1)

### 4.1 Decision

The persisted state gains an **optional** `marking` block inside the existing
`workspaceState.workroomDrive` JSON. A room whose shape uses no graph construct never writes it.

```ts
// workspaceState.workroomDrive (existing keys unchanged), plus, only for graph shapes:
marking?: {
  format: "drive-marking/1";
  /** The cycle this marking belongs to (projectWorkShapeCycleBoundary's cycleKey). A new cycle starts fresh (§4.2). */
  cycleKey: string;
  /** 1-safe. Stage and join-arrival tokens, sorted by node then from (the interpreter's GppToken). */
  tokens: Array<{
    node: string;
    from?: string;
    enteredAt: string;
    /** Fixed when the token enters an agent stage; the ScheduledAgentTask it dispatches through (§6). */
    taskId?: string;
    /** This token's own last tick, so the writeback latch is per token (§4.2). */
    lastAction?: string;
    lastReason?: string;
    lastCycleKey?: string;
  }>;
  /** Current iteration per stage key; absent means 0. Bumped when a rework returns a token across the stage. */
  iterations: Record<string, number>;
  /** Times each rework edge (edge element id) has been taken. Mirrors GppShapeMarking.reworkTaken. */
  reworkTaken: Record<string, number>;
  /** Deadline notices by key `<cycleKey>#<stageKey>#<iteration>`: raised once, notified at least once (§8). */
  deadlines: Record<string, { raisedAt: string; notifiedAt: string | null }>;
  /** Sub-shape children by key `<cycleKey>#<stageKey>#<iteration>` (§9). */
  children: Record<string, { capsuleId: string; ref: string }>;
};
pendingAttentions?: Array<{ principalRef: string | null; stageKey: string; reason: string }>;
```

A receipt gains an optional `iteration?: number`. Absent means `0`.

### 4.2 Why this shape

- **Additive, so it needs no migration.** `workspaceState` is JSON. No Prisma migration is added,
  so the rule that "a migration applies to any data state" is met trivially. The reader treats a
  missing `marking` as absent. A malformed one is handled as below, never as absent.
  - For a sequential shape, absent is the only state there is.
  - For a graph shape, a missing `marking` is derived from `stageKey`: one token on that stage, or
    the start when `stageKey` is null.
  - A malformed `marking` fails closed. The drive pauses with reason `marking_unreadable`, keeps
    the stored bytes unchanged, and does not guess.
- **Legacy keys keep their meaning for every existing reader.**
  - `stageKey` is the first marked stage in document order.
  - `pendingAttention` is the first entry of `pendingAttentions`.
  - Readers that keep working unchanged: `projectStoredWorkroomDriveObservation`
    (`workroom-drive-state.ts:62-76`), `readPendingGovernedDecision`
    (`workroom-stage-decision.ts:45-55`), the stall attention source
    (`lib/attention/sources/workroom-stall.ts:225-234`), `held-workrooms.ts:39-48` and
    `invocation-attribution.ts:23-24`. Each shows a true, if partial, picture.
- **Iteration-scoped receipts replace deletion.** A receipt completes stage `s` only if its
  iteration equals `marking.iterations[s] ?? 0`.
  - `appendCompletingWorkroomDriveReceipt` deduplicates on `(stageKey, kind, iteration ?? 0)`. For
    receipts without `iteration` this is exactly today's key.
  - The persist merge (`workroom-drive.ts:662-670`) therefore stays correct. A stale iteration's
    receipt is kept for audit but cannot complete the new iteration.
  - This is observationally equal to the interpreter's clearing (§6.3, parity).
  - `readStoredWorkroomDriveState` copies `iteration` only when it is a finite integer, so legacy
    receipts round-trip byte-identically.
- **`enteredAt` per token** is the only new clock fact. Stage deadlines (§8) and per-stage dispatch
  bounds need it.
- **A graph room's marking survives every tick (review blocker 1).** The danger:
  - `persist` replaces the whole `workroomDrive` snapshot (`workroom-drive.ts:679`, inside the
    `updateMany` at `:671-680`). It merges back only receipts (`:662-670`).
  - Every plan built by `emptyPlan` writes `stageKey: null` (`drive-resolution.ts:117-140`, `:130`).
    That covers the posture and substrate early returns, `quiet`, `construct_not_executable` and
    `marking_unreadable`.
  - A `lease_held` snapshot persists `observationOnly`, so it writes nothing (`workroom-drive.ts:322-331`
    with `:654`). It is safe, but only by that accident.
  - If any of those plans dropped the marking, the next tick would derive one token from a null
    `stageKey` (§4.2: "the start") and the room would silently restart.

  The rule: **for a graph shape, every persisted snapshot carries a marking.**
  - When a plan carries none, `applyDrivePlan` copies the stored `marking` and `pendingAttentions`
    forward.
  - `persist` merges `marking` and `pendingAttentions` from the current row under the same
    compare-and-set and the same `lastCycleKey` condition it uses for receipts (`:662-670`), through
    one exported merge function. The golden (§5) uses that same function.
  - A malformed stored marking is copied **verbatim**, never dropped or repaired.
  - The `construct_not_executable` and `marking_unreadable` pauses keep the stored `stageKey` and the
    stored marking, instead of `emptyPlan`'s nulls.
  - Turning the kill switch off again resumes the room from the same marking.
- **A marking belongs to one cycle (review item 4).** `marking.cycleKey` records the cycle. When
  `projectWorkShapeCycleBoundary` yields a different `cycleKey`, the drive discards the old marking
  and starts fresh from the shape's start, as the sequential drive does after `cycle_complete`.
  - Deadline keys and child idempotency keys carry the cycle key.
  - Without it, a new cycle's child would resolve to the previous cycle's completed room:
    `createWorkCapsule` returns the existing row for an existing `idempotencyKey`
    (`work-capsule-store.ts:130-133`). A deadline would also never fire again.
- **The writeback latch is per token (review blocker 2).** `writebackLatchHolds` returns `false`
  whenever `prior.stageKey !== stageKey` (`writeback-latch.ts:53-54`). The prior it receives is
  room-level, built from the snapshot's single `stageKey` (`workroom-drive-state.ts:51-58`). So every
  branch other than the first would never latch, and would re-dispatch every tick. That is the
  defect #5166 fixed for the sequential drive.
  - Each token records its own `lastAction`, `lastReason` and `lastCycleKey`.
  - The graph planner builds a per-token `PriorDriveForLatch` (`writeback-latch.ts:20-26`) as
    `{ action: token.lastAction, reason: token.lastReason, stageKey: token's stage, cycleKey: token.lastCycleKey }`.
- **Evidence across iterations (review item 11).**
  - `earnEvidenceReceipts`' early return (`stage-evidence-receipts.ts:97`, which today calls
    `isCompletingWorkroomDriveReceipt`) uses `isCompletingWorkroomDriveReceiptAt(receipt, stage, iteration)`
    on the graph path. Otherwise a previous iteration's receipt would short-circuit the new
    iteration.
  - Evidence counts for iteration *n* only if it post-dates that iteration's own dispatch or
    attention activity.
  - An iteration change is always news. Today a tick is news only on `dispatch_agent` or a changed
    hold key (`driveTickIsNews`, `workroom-drive-hold.ts:90-92`). Quiet ticks write no activity row
    (`workroom-drive.ts:257-258, 683`). On the graph path, `driveTickIsNews` also returns `true` when
    any token's `stageKey#iteration` changed. A rework therefore always leaves a trail row, which is
    also the new iteration's attention anchor.

### 4.3 What conformance, attention, hold and ledger read

| Reader | Sequential shape (no marking) | Graph shape (marking present) |
|---|---|---|
| Conformance (`evaluateWorkroomShapeConformance`) | Existing index checks, untouched | A new optional input `flowOrder` replaces the index block (`:311-370`). Proposed stages must equal the drive's enabled set. A stage's prerequisite is "every forward predecessor delivered its token in this iteration", read from the shared graph. A rework move is legal when it is the declared route of a recorded refuse verdict. `reconciliationKey` is unchanged for sequential rooms |
| Attention | `pendingAttention` | `pendingAttentions[]` (one per marked human or governed stage), plus `pendingAttention` = first. The stage decision view gains a plural reader. The decision control takes the stage key it already carries (`StageDecisionInput.stageKey`) |
| Hold | `driveHoldKey({ action, reason, stageKey, conformance })`, which takes one object (`workroom-drive-hold.ts:47-51`) | The object gains an optional `markedKeys`. When it is present, the sorted `stageKey#iteration` list replaces `stageKey`. Only graph rooms pass it, so a sequential room's hold key is unchanged and writes no extra row |
| Ledger | One line per tick | One line per token decision, in document order |
| Snapshot `action` / `reason` | As today | Aggregate by precedence `stop > escalate > pause > dispatch_agent > attention > do_not_wake`. The reason is the first token's reason at that precedence. `resolveDriveConclusion` reads the aggregate |
| Room view (`shape-projection.ts:240-276`) | `currentStageKey` | Every marked stage reads "current". Verdicts are still read off receipts (parent §9.2). The plural set travels as an optional `currentStageKeys` along the existing path (see the next paragraph) |

**Room-view plumbing for several current stages.** All paths were verified, and every change is
an optional field. Absent means today's single stage:

1. `projectStoredWorkroomDriveObservation` (`workroom-drive-state.ts:62-76`) adds
   `currentStageKeys` from the marking.
2. That observation is passed on by `workspace-case-loader.ts:725` and
   `workroom-only-case-projection.ts:156`.
3. It reaches the observation type in `room-read-model.ts:94-100` and the conformance call at
   `:258-268`.
4. `WorkroomShapeConformance` gains `currentStageKeys?`, carried to the view as
   `processOverseer: WorkroomShapeConformance` (`room-types.ts:261`).
5. `shape-projection.ts:240-243` reads it.

## 5. Non-disruption (decision 3)

Today every one of the registry's definitions is sequential. That is 51 at the parent's count; the
tests count from the registry, not from this figure. Three mechanisms keep them byte-identical:

1. **Structural branch, not a flag.** `usesGraphConstructs(definition)` is true only when the shape
   declares `flow`, any `stage.deadline`, any `stage.subShape`, or any `gate.onRefuse`.
   - When it is false, `resolveDrivePlan` runs its current body unchanged. The diff shows it
     wrapped, not edited.
   - For a sequential room, `applyDrivePlan` writes no `marking` or `pendingAttentions` key. The
     golden is what proves the persisted bytes are unchanged; no claim about key order is relied
     on.
   - The new logic lives in new files (`drive-marking.ts`, `drive-resolution-graph.ts`).
2. **A characterization golden through the real runner.**
   - **What it runs.** It drives
     `runWorkroomDriveJob(now, { listRooms, effects, reconcileNesting: async () => 0, reconcileNotifications: async () => {} })`
     (`workroom-drive.ts:386-502`), not `resolveDrivePlan` in isolation. So the receipt earning
     (`:438-444`) and the input assembly (`:445-466`) are covered too.
   - **Persistence.** The in-memory `persist` applies the exported production merge function
     (§4.2). Each tick's captured snapshot is fed back as the room's `workspaceState`.
   - **Clock.** `now` steps by 15 minutes from `2026-01-01T00:00Z`.
   - **Equality.** Output is compared under `canonicalJson`
     (`@dpf/integration-shared/canonical-json`).
   - **When it is captured.** Before the substrate PR changes any runtime file, the golden is
     generated from the unmodified code and committed. Later commits must not edit the generator.
   - **What it asserts.** Every later run produces byte-identical JSON with no `marking` key.
   - **Reason coverage.** It asserts that every reason in `DRIVE_REASONS_BY_ACTION`
     (`drive-conclusion.ts:50-57`) was reached, plus `executor_writeback_unavailable` and
     `cycle_complete`. Two reasons cannot be reached through `runWorkroomDriveJob` with registry
     shapes, so the golden adds direct `resolveDrivePlan` cases for them:
     - `no_posture`: `postureLevelOf` never returns `null` (`workroom-drive.ts:169-173`).
     - `unknown_principal`: no registry stage names a principal outside `agent:`, `role:` and
       `person:`.

     The plan lists where each `DriveResolutionInput` field comes from.
3. **Build Studio is untouched.** No PR in this phase edits `apps/web/lib/build/`
   (including `plan-to-build-transition-core.ts`), `apps/web/lib/explore/`, the Build Studio packs
   or its routes. Each PR checks this with `git diff --name-only`.

**Kill switch and shadow phase.**

- **Kill switch.** `CONSTRUCT_EXECUTABLE` is the one switch (§7). Setting a flag back to `false` in
  a reviewed PR has two effects: the compiler refuses new documents, and the drive pauses any room
  whose pinned shape uses that construct, with reason `construct_not_executable`. That pause is
  visible, attributed by `resolveDriveConclusion`, and caught by the stall notice after an hour.
  It fails closed and never silently runs the construct sequentially.
  - The pause keeps the stored `stageKey` and marking (§4.2), so turning the flag back on resumes
    each room exactly where it stopped.
  - Every new reason is added to `drive-conclusion.ts` in the PR that introduces it, so that
    `resolveDriveConclusion` never returns `unconcluded` for it (`drive-conclusion.ts:143-211`):
    - a `DRIVE_REASONS_BY_ACTION` entry;
    - a `BLOCKAGES` entry (`:86-119`) with `what` and `unblockedBy`, or an `IN_MOTION` entry
      (`:122-130`).

    | Reason | Action | Entry | PR |
    |---|---|---|---|
    | `construct_not_executable` | pause | BLOCKAGES: unblocked by the construct's flag being enabled, or the room being rebound | 3c-1 |
    | `marking_unreadable` | pause | BLOCKAGES: unblocked by the room's drive marking being repaired or the room being reset | 3c-1 |
    | `gate_refused` | attention | BLOCKAGES: unblocked by a decision recorded on the refused stage | 3c-3 |
    | `refused_to_stop` | stop | BLOCKAGES: unblocked by the room's next cycle, or a rebind to a version that routes the refusal elsewhere. Added in PR-3c-3: a refuse routed to a failure stop, or past its bound to the budget stop, ends the cycle without its outcome, which neither `success` nor `conformance_stop` describes | 3c-3 |
    | `awaiting_sub_shape` | attention | IN_MOTION: the child room is running | 3c-5 |
    | `sub_shape_stopped` | attention | BLOCKAGES: unblocked by a decision recorded on the parent stage | 3c-5 |
- **Shadow phase.** Each flag flips in a PR that registers no shape using the construct. The
  construct is executable but has no consumer until a separate PR adopts it (R2D for parallel).
- **No separate runtime shadow mode.** A second runtime flag would be a second source of truth for
  "is this construct live" (AGENTS.md §1). Running a graph shape sequentially "in shadow" would
  also be the misleading picture §5.4 forbids. Gate verdicts already have GPP's own shadow mode
  (`gate.mode`, parent §6.2), and that stays as it is.

## 6. Per-construct semantics, parity and risk (decision 2)

Common rules, all taken from the interpreter so that parity is meaningful:

- **One firing per tick.** Each drive tick applies the interpreter's rule: at most one marked stage
  fires, the first enabled one in document order (`interpreter.ts:464-487`). This is what the
  sequential drive does today (`nextStageKey` advances one stage per tick). Firing to a fixpoint
  would change existing rooms, which can hold old receipts.
  - The trade-off is latency. A four-branch join needs four ticks of firings. That is about an hour
    at the 15-minute cadence, and `workroom/drive.requested` can shorten it. See open question Q4.
- **Dispatch every tick.** Firing is limited; dispatch is not. Every marked agent stage that is
  enabled and not complete gets its own dispatch in the same tick, under the room's one drive
  lease.
  - **The task id is fixed when the token enters the stage** and is stored on the token
    (`token.taskId`). Then the task id does not depend on which stages happen to be marked at a
    later tick.
  - A token entering a stage while no other agent token holds the primary id takes
    `workroomDriveTaskId(roomId, shapeKey)`. Every other token takes
    `workroomDriveTaskId(roomId, shapeKey) + "--" + stageKey`. A sequential room's task id never
    changes.
  - **When a token leaves its stage, its branch task is deactivated in the same tick.** A token
    leaves when it fires, when it waits as a join arrival, or when a rework clears it. This matters
    because the upsert sets `isActive: true` and `nextRunAt` (`workroom-drive.ts:735-758`), so a
    task left active keeps running for a stage that is no longer marked.
  - Every task is also deactivated on stop, success or `do_not_wake`.
- **Two implementations, one graph.** The flow graph moves from `interpreter.ts` to
  `work-management/work-shape-flow-graph.ts`. The interpreter and soundness import it. The drive's
  token step (`drive-marking.ts`) is a separate implementation of the same rules.
  - The drive does not call `stepShapeInstance`. If it did, the parity gate the parent requires
    (§5.4, §6.5) would be a tautology. Two independent statements of the rules, compared
    exhaustively, is the gate.
- **The parity harness.** It extends `interpreter-parity.test.ts`'s seeded generator to fixture
  graph shapes.
  - Each event (a receipt for any marked stage, a verdict, a stop, a deadline, a child stop) is
    applied to the interpreter and, as one drive tick, to the drive's pure step.
  - After every prefix it asserts equal sets of marked stages, equal `stopped` (kind and stop id)
    and equal rework counters.
  - The seed is fixed and printed on failure. There are 200 sequences per fixture shape. No
    property-testing package is added (plan constraint 2 of Phase 3).

### 6.1 Parallel split / join (`parallel-split-join`)

- **Semantics.** As in `interpreter.ts:375-386`.
  - Reaching a split places one token on the first node of each branch, recursively through nested
    splits.
  - A join records an arrival `{ node: join, from: predecessor }`. When every forward predecessor
    has arrived, it removes all arrivals and places one token on its successor.
  - There is no partial join. A stop reached from any branch consumes every token.
  - `enteredAt` is the tick's `now` for each placed token.
- **Dispatch.** Per-branch tasks, as above. Each task pins only its own stage's `tools`, which is
  narrower than the parent's room-level "∪ of marked stages" envelope (§11, correction 7).
- **Attention.** Several branches may wait on people at once, so `pendingAttentions[]` has one
  entry per waiting stage.
- **Parity test.** `drive-parity-parallel.test.ts` covers four fixtures:
  - one split with two branches;
  - a nested split;
  - a branch whose stage is governed;
  - a four-branch fork mirroring R2D's Deploy targets (Linux, macOS, Windows, Edge), each branch
    Plan → Fulfill → Validate → Observe, closing with a join and then the Release stages.
- **Flag flip.** `parallel-split-join: true`. `not-executable.test.ts` then shows only that finding
  removed.
- **Own risk.** Several dispatches from one room run under one lease and one owner. If one branch
  pauses on the writeback latch, other branches must keep moving, and no branch may re-dispatch
  every tick.
  - The room-level prior cannot do this. `writebackLatchHolds` returns `false` for any stage other
    than the prior's single `stageKey` (`writeback-latch.ts:53-54`).
  - The latch is therefore evaluated per token, from the token's own `lastAction`, `lastReason`
    and `lastCycleKey` (§4.2).
  - Test: two agent branches that never write back each latch after exactly one dispatch per
    cycle.

### 6.2 Refuse route (`gate.onRefuse`) and rework edge (`rework-edge`)

The code has one flag for both (`executable-constructs.ts:24-26`). The interpreter takes a rework
edge **only** on a refuse verdict: either `onRefuse`, or the stage's single outgoing rework edge
(`interpreter.ts:417-426`). The two cannot ship apart without inventing a rule, so they ship in one
PR with one flag (§11, correction 1).

- **Verdicts.** The drive derives a verdict only for a stage whose typed gate is `enforced` and
  blocking **and** declares a refuse route (`onRefuse`, or a single rework edge). It reads the
  latest `decision-record` evidence for that stage and iteration, using `payload.result.choice`:
  - `accept` → `admit`
  - `patch` → `admit` (parent §6.2: the person amends and accepts)
  - `defer` → `hold`. Decided by DI-0D9DFB0FC0EF (WWMD, followed 2026-10-06, founder-delegated):
    on a stage that declares a refuse route, `defer` holds the token at the gate until an accept
    or a send-back is recorded. The verdict is derived only for such stages, so on every other
    stage `defer` keeps advancing exactly as today (founder decision 2026-10-02; §14 Q1).
  - `refuse` (new) → `refuse`

  The decision read is the latest completed `decision-record` for the stage recorded at or after
  its token's `enteredAt`, so a decision from an earlier pass through the stage never counts.
  Evidence with no `choice` gives no verdict, and the token waits.

  The verdict carries the gate's declared mode, so a verdict recorded under another mode never
  moves the token (`interpreter.ts:477-478`).
- **Enforced gates without a refuse route.** The drive derives no verdict here. Today's drive
  advances such a stage on its completing receipt (`nextStageKey`, `drive-resolution.ts:149-155`).
  The interpreter instead needs a recorded `admit` before an enforced, blocking gate moves the token
  (`interpreter.ts:471-477`).
  - The parity harness keeps them comparable by feeding the interpreter an `admit` verdict
    alongside every completing receipt on such a stage.
  - That divergence, where the runtime treats every recorded decision on these gates as admit, is
    recorded as part of Q1. It is not resolved in 3c.
- **New decision choice.** `refuse`, labelled "Send back". It is added to `STAGE_DECISION_CHOICES`
  and offered by `governedDecisionStage` only when the stage's gate declares a refuse route.
  - `buildStageDecisionEvidence` records it with outcome `completed`, because the interpreter needs
    a completing receipt plus the verdict.
  - Its summary verb is "sent back".
- **Routing.**
  - **Refuse to a stop.** All tokens are consumed and the stop's disposition is recorded.
  - **Refuse to an earlier stage `t`.** The edge counter is incremented. If it would exceed
    `maxIterations`, the token goes to the first budget stop. Otherwise every stage in the loop
    region (forward-reachable from `t` and forward-reaching the source, `interpreter.ts:446-451`)
    gets `iterations[stage] += 1`, tokens in the region are removed, and one token is placed on `t`
    with a fresh `enteredAt`.
- **A refuse with no route.** The drive derives verdicts only for stages that declare a route
  (`onRefuse`, or exactly one outgoing rework edge). So "no route" means the declared route
  cannot be taken: its counter would exceed `maxIterations` and the shape has no budget stop.
  That is the interpreter's `return false` at `interpreter.ts:439-441`. The `rework.length !== 1`
  and unresolved-target cases (`:422-423`, `:427-430`) cannot arise in a shape that passes
  soundness S-3 and S-5.
  - A shape that passes S-6 always has a budget stop (`validateWorkShape`), so in practice no route
    means a hand-built parity fixture, not a compiled shape.
  - The token stays. The drive raises attention with reason `gate_refused` to the gate's
    `escalation.role`, or else to the stage's principal. The owner-fallback rule (DI-A76F0C10EF14)
    applies.
  - A refuse never defaults to admit.
- **Re-dispatch is fresh.** The new iteration's dispatch is a new activity row. An iteration change
  is always news (§4.2), so that row is guaranteed to be written. `stageHasCompletingEvidence`'s
  "after dispatch" bound (`stage-evidence-receipts.ts:76`) then rejects the earlier attempt's
  evidence, and the iteration-aware early return (§4.2) stops an old receipt from short-circuiting.
  Evidence and receipts both enforce the fresh start.
- **Permit revocation.** Parent §5, construct 13, revokes the left stages' permits. No stage permit
  is minted on main yet (`permit-mint.ts:60-61` writes `shapeRef: null` and `stageKey: null`). The
  rework transition calls a `revokeStagePermits({ workroomId, stageKeys })` hook. In 3c it has
  nothing to revoke, and a test pins that no permit naming those stages stays valid. It becomes
  real with the binding-attach follow-up.
- **Parity test.** `drive-parity-rework.test.ts` covers:
  - refuse to an earlier stage, then admit;
  - refuse past `maxIterations`, which reaches the budget stop;
  - refuse to a stop;
  - `refuse-bound-no-budget-stop`: the route's bound is exceeded and the shape has no budget stop,
    so the token stays (`interpreter.ts:420-441`). This is a parity-only fixture that is
    deliberately not S-6-sound;
  - a shadow-mode gate, where the refuse is recorded and the token moves on its receipt;
  - `defer` on a refuse-route stage holds the token (DI-0D9DFB0FC0EF). For the interpreter, the
    harness maps it to a `hold` verdict. An enforced gate without a refuse route in the same
    fixture still advances on its receipt, with the harness feeding the interpreter `admit`;
  - a rework inside a parallel branch (`rework-inside-branch`), which leaves the sibling branch
    untouched.
- **Flag flip.** `rework-edge: true`.
- **Own risk: the `defer` contradiction.**
  - Today `defer` *advances* the stage, because it is completed evidence and so earns a receipt.
    The parent's `defer → hold` would be a behaviour change wherever it applied.
  - The founder decided on 2026-10-02 to keep `defer` advancing on every existing stage, and that
    stays: no existing stage declares a refuse route, so none derives a verdict.
  - DI-0D9DFB0FC0EF (2026-10-06) decides the refuse-route case: `defer` holds there. It changes no
    running room, because the construct is new and no registry shape adopts it in 3c. A shape that
    adopts a refuse route on a stage offering `defer` gets the hold from its first room.
  - See correction 2 (§11) and §14.

### 6.3 Stage deadline (`stage-deadline`): see §8

- **Parity test.** `drive-parity-deadline.test.ts`. The interpreter gains an explicit event
  `{ type: "deadline"; stageKey }` that returns the marking unchanged, which writes down parent §6.1
  rule 8. The test asserts that injecting deadline events never changes the drive's marking or the
  interpreter's. Separately, the drive raises exactly one notice per `<cycleKey>#<stageKey>#<iteration>`.
- **Flag flip.** `stage-deadline: true`.
- **Own risk.** Notification noise or duplicates. Mitigated by the key and by notifying from the
  snapshot (§8).

### 6.4 Sub-shape (`sub-shape`): see §9

- **Parity test.** `drive-parity-sub-shape.test.ts`. The interpreter gains
  `{ type: "child-stop"; stageKey; kind }`:
  - `success` behaves as a completing receipt for that stage;
  - `failure` or `budget` leaves the marking unchanged, so the token waits.

  The drive's step, fed the child's recorded stop, must match.
- **Flag flip.** `sub-shape: true`.
- **Own risk.** Room proliferation and orphaned children. Mitigated by the idempotency key, the
  `contains` relation and terminal handling (§9).

### 6.5 Interpreter changes

Phase 3c adds two no-op-or-receipt events (`deadline`, `child-stop`) to the interpreter, in the PRs
named above. Each lands with unit tests written from the parent's §6.1 text, in its own commit and
before the drive change, so that review sees the statement before the implementation. No existing
interpreter rule changes, and the AC-INTERPRETER suite stays green unedited.

## 7. One switch, and a guard for hand-declared shapes

### 7.1 `CONSTRUCT_EXECUTABLE` is read by the drive

The drive imports `CONSTRUCT_EXECUTABLE` and a new pure helper `constructsUsedBy(contract)`. The
helper lives beside `CONSTRUCT_EXECUTABLE` and walks the **definition contract** (the
`WorkShapeDefinitionContract` the drive already holds), covering exactly the elements the DRC's
E-NOT-EXECUTABLE walk covers today (`drc.ts:380-387, 465-477`). The DRC is refactored to call it on
`lowerToDefinition(document)`, so there is one walk, run over the runtime's own type. If a pinned shape uses a construct whose flag is off,
the drive pauses with `construct_not_executable` and names the construct and element id. The header
comment in `executable-constructs.ts` ("nothing in the running app imports this module", `:30`) is
updated in the same PR.

### 7.2 Registry guard

A hand-declared TypeScript shape could carry `flow` without ever passing the compiler. A new test,
`work-shape-graph-constructs.test.ts`, decompiles every registry definition that uses a graph
construct and asserts three things:

- `checkSoundness` returns no findings, and the full `runDesignRules` with
  `defaultResolveSources()` returns **no error-severity finding**. That covers C-1…C-9, D-1…D-10
  (including the new D-9 and D-10) and E-NOT-EXECUTABLE;
- that the shape is listed on a shrink-only allow list naming the consuming backlog item.

So a hand-declared graph shape is held to the same rules as a compiled one.

For the guard to see what the shape says, the decompiler must carry four things when present:

- `flow`, `deadline` and `subShape`. Otherwise L1 fails, because `legacyProjection` drops them
  (`legacy.ts:21-23`) and `decompile` never emits them (`decompile.ts:12-14` at `6ce2f7e445`). See
  correction 5.
- the definition's own `advance.gate`. Otherwise a code-declared `onRefuse` is invisible. On
  `6ce2f7e445` the gate comes only from the ratification table (`decompile.ts:18-21, 59-60`); see §3.

## 8. Deadlines (decision 4)

- **Clock.** The drive tick: the 15-minute cron plus run-now. It is evaluated against the tick's
  `now`, which tests inject (`resolveDrivePlan` already takes `now`). No new scheduler or timer
  service is added. Day-granular deadlines (`afterDays`) tolerate ±15 minutes.
- **Due.** A token on stage `s` with `s.deadline` is overdue when `now ≥ enteredAt + afterDays`.
- **On expiry: non-interrupting.** This follows parent §6.1 rule 8: "timers never change M".
  - The token stays where it is.
  - The drive records `marking.deadlines["<cycleKey>#s#iter"] = { raisedAt: now, notifiedAt: null }`.
  - It writes a `workroom-drive-deadline` activity naming the stage, the deadline description and
    the overdue duration.
  - It notifies the escalation target: `gate.escalation.role` if the stage's gate declares one,
    else the stage's accountable principal, resolved through the room-owner fallback the stall
    notice already uses (`workroom-stall-notice.ts:16`).
  - The workroom-stall attention source lists rooms with an un-notified or open overdue deadline,
    so the owner sees them in the attention inbox.
- **Routing to refuse or escalation on expiry: escalation only.** An expiring deadline never routes
  the token to a refuse route or a stop. Doing so is an interrupting boundary event. It would also
  give the same graph two ways to leave a stage, which the parent's soundness argument excludes
  (§6.1 table, "Cancellation region / interrupting boundary event"). A person who sees the notice
  can record a refuse verdict, and that verdict routes. See Q3.
- **Idempotency.**
  - The key is `<cycleKey>#<stageKey>#<iteration>`. A rework starts a new iteration with a fresh
    `enteredAt`, so it can owe a new notice. A new cycle starts a fresh marking (§4.2), so the same
    stage can be noticed again next cycle. The same cycle and iteration never raise twice.
  - Notification is **at least once**. The notice is sent on the tick *after* the snapshot carrying
    the key commits under the existing compare-and-set (`workroom-drive.ts:671-681`).
    `notifiedAt` is then written on the next persist. A failed send leaves `notifiedAt` null and
    retries next tick.
  - A duplicate is possible only if a send succeeds and its persist then fails. That is the same
    trade-off `notifyStall` makes with `hold.notifiedAt` (`workroom-drive.ts:253-256`).
- **Review point.** It stays as it is (`reviewDue`, conformance `review_due`). It is not a stage
  deadline.

## 9. Sub-shape (decision 5)

### 9.1 Child room, not inline

A sub-shape stage runs its child as a **separate Workroom**, pinned to the exact `key@version` in
`stage.subShape`.

| Option | Verdict | Why |
|---|---|---|
| Child room | **Adopted** | The child has its own stages, principals, grants, stops and cycle. The drive already drives any room with a `workShape` claim (`loadStandingRoomIds`, `workroom-drive.ts:519-541`). Permits, evidence and leases are per room (`workroomId` in `PermitClaims`). The `contains` relation already carries accountability (`RESPONSIBILITY_RELATION_KINDS`). Matches Camunda's call activity and Temporal's child workflow (§12) |
| Inline expansion | Rejected | Would namespace child stage keys into the parent, merge grant ceilings and stop conditions, and break the "one shape version per room" rule rebind and conformance rely on |

### 9.2 Lifecycle

- **Entering the stage.** When the token enters a sub-shape stage, the drive creates the child
  through `createWorkCapsule`, as the system actor.
  - `idempotencyKey = "sub-shape:<parentCapsuleId>:<cycleKey>:<stageKey>:<iteration>"`. This is safe
    under retries, because an existing key returns the existing room (`work-capsule-store.ts:130-133`).
    The cycle key is needed because the same return would otherwise hand a new cycle the previous
    cycle's completed child.
  - `scopeClaims = withWorkShapeClaim([], stage.subShape)`.
  - Its owner is the parent's owner.
  - The drive writes a `contains` relation from parent to child, through the same path the nesting
    reconciler uses (`workroom-drive-data.ts:26-80`).
  - It records `marking.children["<cycleKey>#stageKey#iter"]`.
  - The parent stage does not dispatch an agent. Its plan is `attention` with reason
    `awaiting_sub_shape`, attributed to the child.
- **The child runs.** It is an ordinary shaped room, driven by the same cron.
- **The child stops.**
  - **Success.** The child's `workroomDrive` records `action: "stop"`, `reason: "success"`. The
    parent's drive records `child-completion` evidence on the parent stage at the current
    iteration, with outcome `completed` and payload `{ childCapsuleId, childShapeRef, disposition }`,
    through `recordWorkCapsuleEvidence`. That earns the completing receipt, and the parent advances
    by the ordinary rule. The child is then set terminal (`complete`), so its daily cycle key does
    not restart it (`cycleCompleted`, `drive-resolution.ts:158-163`). In the same transaction,
    `recordChildCompletion` deletes the parent→child `contains` row itself.
  - **Failure or budget stop.** No completing receipt is earned. The parent raises attention
    `sub_shape_stopped` to its owner, quoting the child's stop disposition. The token waits, as the
    interpreter's `child-stop` rule says. A person may then record a refuse verdict on a gated
    parent stage (rework) or a failure stop. See Q2.
- **Rework across a sub-shape stage.** The rework starts a new iteration and so a new child. In
  one transaction, `abandonChild` sets the previous child `abandoned` with a reason and deletes its
  parent→child `contains` row.
  - **The existing terminal rule does not cover child rooms.** It loads only rooms whose
    `idempotencyKey` starts with `standing-room:` (`workroom-drive-data.ts:29-30`). It withdraws
    only those with a standing-room key (`terminalStandingRoomIds`, `standing-room-nesting.ts:113-118`).
    A `sub-shape:` child would keep its row forever.
  - Both effects are tested.

### 9.3 Claim and workroom implications

- The child is a **drive room**, not a developer workroom.
  - It is not claimed against a backlog item.
  - It holds no worktree.
  - It takes the drive lease like every shaped room (`acquireLease`, `workroom-drive.ts:697-716`).
- "Claim a workroom before you work" governs agents doing source work. A sub-shape child is the
  platform's own unit of WIP, created by the drive, and is visible in the parent's tree through
  `contains`.
- The parent's rebind is refused while any child is live (`marking_not_mappable`).

### 9.4 How GPP permits and bindings inherit

- **Nothing is inherited implicitly.** A permit names its `workroomId` and is per call, single use,
  with a 15-minute TTL (`permit-mint.ts:27, 56-80`). A child's calls mint permits under the child's
  `workroomId` and the child's `shapeRef` and `stageKey`, once binding attach exists. The parent
  stage's binding does not cover them.
- **No widening by nesting.** A new DRC rule, **D-9 sub-shape widening** (error), refuses a
  document when either holds:
  - the child definition's `grants` are not a subset of the parent shape's `grants`;
  - any child stage `tools` falls outside the parent's grants.

  A new rule, **D-10 sub-shape resolution** (error), refuses an unresolvable `key@version` and any
  cycle in the sub-shape call graph. The parent catalog already requires "Child `key@version`
  resolves; no cycles" (§5 row 14). `resolve.ts:142-143` computes existence, but `drc.ts` checks
  neither (`:387` only flags E-NOT-EXECUTABLE). `GppRuleId` gains `D-9` and `D-10`.
- **Runtime still intersects.** At runtime the child's coworkers are still filtered by TAK: agent
  grants ∩ principal capability ∩ token scope (`filterToolsForCoworkerRuntime`). D-9 keeps the
  declared ceiling honest. TAK keeps the effective reach honest.
- **Lineage.** `parentPermitId` stays reserved for permit delegation, as Phase 2 uses it. A
  child-room permit does not set it. The room lineage is the `contains` relation, which is where
  accountability already walks.

## 10. Objectives and acceptance (scope baseline for BI-8875C9DF)

- **OBJ-3C-MARKING:** The work-shape drive executes the parent's restricted token game: parallel split and join, rework and refuse routes, stage deadlines and sub-shapes, over a 1-safe block-structured marking persisted additively in the room's drive state.
- **OBJ-3C-PARITY:** Each graph construct becomes executable only in the change that proves the drive and the reference interpreter agree on it over generated event sequences.
- **OBJ-3C-NODISRUPT:** Every shape that uses no graph construct runs exactly as before: the same plans, the same persisted snapshot bytes, the same task identifiers, and no change to Build Studio.
- **OBJ-3C-FAILCLOSED:** A room whose shape uses a construct that is not enabled, or whose marking cannot be read, pauses visibly with a named reason instead of running a different flow.
- **OBJ-3C-ACCOUNTABLE:** Every token that waits, whether on a person, a refused gate, an overdue deadline or a stopped child, names who clears it.
- **OBJ-3C-CONTAINMENT:** A sub-shape runs as a contained child room that never widens the parent's declared authority.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-3C-SEQ-IDENTICAL | OBJ-3C-NODISRUPT | For every registry definition, seeded drive tick sequences produce plans and persisted snapshots byte-identical under canonical JSON to a golden captured from the pre-change code, with no marking key, and unchanged scheduled task identifiers. |
| AC-3C-STATE-COMPAT | OBJ-3C-NODISRUPT, OBJ-3C-FAILCLOSED | The drive state reader returns identical results for stored snapshots without a marking, derives a single-token marking from the stored stage for a graph shape, preserves receipts without an iteration byte-for-byte, and pauses with marking_unreadable on a malformed marking. |
| AC-3C-PARALLEL-PARITY | OBJ-3C-MARKING, OBJ-3C-PARITY | Over seeded event sequences on the parallel fixtures, including a four-branch fork, the drive's marked stages and stop equal the reference interpreter's after every prefix, and the parallel-split-join flag is enabled only in that change. |
| AC-3C-REWORK-PARITY | OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-ACCOUNTABLE | Over seeded sequences of receipts and gate verdicts, the drive matches the interpreter on refuse routes to earlier stages and to stops, on the bounded counter reaching the budget stop, on a refuse whose route is exhausted with no budget stop keeping the token, on shadow gates, and on defer holding a refuse-route stage (DI-0D9DFB0FC0EF); the rework-edge flag is enabled only in that change. |
| AC-3C-DEADLINE-PARITY | OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-ACCOUNTABLE | Deadline events never change the drive's or the interpreter's marking, the drive raises exactly one deadline notice per stage iteration and retries an unsent notice, and the stage-deadline flag is enabled only in that change. |
| AC-3C-SUBSHAPE-PARITY | OBJ-3C-MARKING, OBJ-3C-PARITY, OBJ-3C-CONTAINMENT | A sub-shape stage creates exactly one contained child room per cycle and iteration pinned to the declared version, removes the containment row when the child completes or is abandoned, a child success advances the parent exactly as a completing receipt does in the interpreter, a child failure or budget stop holds the parent with attention to its owner, and the sub-shape flag is enabled only in that change. |
| AC-3C-SUBSHAPE-NO-WIDEN | OBJ-3C-CONTAINMENT | The compiler refuses a document whose sub-shape grants or stage tools exceed the parent's grants (D-9), or whose sub-shape reference does not resolve or forms a cycle (D-10). |
| AC-3C-FAILCLOSED | OBJ-3C-FAILCLOSED | A registry shape that uses a construct whose executable flag is off makes the drive pause with construct_not_executable naming the construct, and the registry guard test fails for any graph shape that is unsound, not executable or not on the allow list. |
| AC-3C-CONFORMANCE | OBJ-3C-MARKING, OBJ-3C-NODISRUPT | Flow-aware conformance raises no out-of-order deviation for legal split, join and rework moves, still raises one for an illegal move, and returns results identical to today's for sequential shapes. |
| AC-3C-REBIND | OBJ-3C-FAILCLOSED, OBJ-3C-CONTAINMENT | A rebind is refused with marking_not_mappable while a room holds more than one token, a token inside a parallel block, a rework counter, or a live child room. |
| AC-3C-FLAG-FLIP | OBJ-3C-PARITY | In each construct's change, the not-executable test shows exactly that construct's finding removed and every other construct still refused. |
| AC-3C-BUILD-STUDIO | OBJ-3C-NODISRUPT | No change in this phase touches the Build Studio libraries, packs or routes. |
| AC-3C-MARKING-DURABLE | OBJ-3C-MARKING, OBJ-3C-FAILCLOSED | For a graph shape every persisted drive snapshot carries a marking: a plan without one copies the stored marking forward, a malformed marking is kept verbatim, a room paused by the kill switch resumes the same marking when the flag returns, a room that goes quiet and live again keeps its rework counters, and a new cycle starts a fresh marking. |
| AC-3C-BRANCH-LATCH | OBJ-3C-MARKING, OBJ-3C-FAILCLOSED | Each concurrent agent branch that produces no writeback is dispatched at most once per cycle and then latches, and a branch task is deactivated in the tick its token leaves the stage. |
| AC-3C-CONCLUDED | OBJ-3C-ACCOUNTABLE | Every drive reason introduced in this phase is registered with a blockage or in-motion meaning, so the drive conclusion never reports it as unconcluded. |

## 11. Corrections to the parent

None of these edits the parent. Each is resolved in the PR named.

1. **"Refuse edge" is not a separate flag.** §11 and the backlog item list five constructs, and
   AC-NOT-EXECUTABLE has five fixtures. The code has four flags: `rework-edge` covers both
   `flow.edges[].rework` and `gate.onRefuse` (`executable-constructs.ts:24-26`; `drc.ts:380-381`).
   The interpreter couples them (`interpreter.ts:417-426`). 3c flips `rework-edge` once, for both
   (PR-3c-3).
2. **§6.2 "Phase 3b maps accept → admit and defer → hold" did not happen, and would be a behaviour
   change.** The 3b plan has no PR for it. Today `defer` is recorded as completed evidence
   (`workroom-stage-decision.ts:166-190`), so it earns a receipt and advances. A ratified
   `enforced`, blocking gate on an accept/defer stage therefore misdescribes `defer`. Following the
   founder decision of 2026-10-02, `defer` keeps advancing on every stage without a refuse route.
   On a stage that declares a refuse route, DI-0D9DFB0FC0EF (2026-10-06) maps `defer → hold`: the
   token waits at the gate until an accept or a send-back (PR-3c-3).
3. **§6.1 rule 6 "or by an explicit rework edge".** The interpreter never takes a rework edge
   except on a refuse verdict. 3c follows the interpreter, which is the gate the parent itself sets.
4. **§4.4 says `readWorkShapeDefinitionContract` passes `flow` through.** On main it copies 11
   fields and no `flow` (`work-shapes.ts:173-187`). PR-3c-1 adds it, present only when the shape
   declares it, so sequential contracts keep identical keys.
5. **§7.3 says the decompiler "never emits `flow`, `deadline`, `subShape`".** Once a registry shape
   carries one, L1 would fail. PR-3c-1 makes the decompiler copy them when present.
6. **§5 row 14's DRC ("child resolves; no cycles") is not implemented** (`drc.ts:387`). PR-3c-5
   adds D-10, and D-9 for widening.
7. **§6.4 "envelope = ∪ over marked stages".** This is the room-level description. Each dispatch's
   envelope stays the single stage's `tools`, through per-branch tasks.
8. **§6.1 rule 2 "dispatches it as today" cannot hold for more than one token.** There is one task
   per room and shape (`drive-resolution.ts:104-106`) and one dispatch-time query
   (`workroom-drive-data.ts:155`). 3c adds per-branch task ids and a per-stage dispatch-time loader,
   for graph rooms only.
9. **Conformance is not named in the parent but must change.** Its index checks would refuse every
   legal parallel and rework move (`workroom-shape-conformance.ts:311-370`).
10. **"Permits for the stages left are revoked" has nothing to revoke on main.** No stage permit is
    minted (`permit-mint.ts:60-61`). 3c ships the hook and the test. Revocation becomes real with
    binding attach.
11. **Receipts cannot be cleared.** See §1 and §4.2. Iteration scoping is the equivalent.
12. **The decompiler does not carry a definition's own gate** (`decompile.ts:18-21, 59-60` at
    `6ce2f7e445`). It takes `advance.gate` only from the ratification table. PR-3c-1 carries a
    declared gate, so the registry guard sees `onRefuse` (§3, §7.2).

## 12. Research and benchmarking

The parent's §13 adopt/reject decisions stand: Camunda 8 coverage, workflow-net soundness, ASL,
Serverless Workflow and bpmnlint. These rows are new for runtime execution.

| Engine | What it does | DPF adopts | DPF rejects |
|---|---|---|---|
| **Camunda 8 / Zeebe** ([parallel gateway](https://docs.camunda.io/docs/components/modeler/bpmn/parallel-gateways/), [call activity](https://docs.camunda.io/docs/components/modeler/bpmn/call-activities/), [timer events](https://docs.camunda.io/docs/components/modeler/bpmn/timer-events/), [process instance migration](https://docs.camunda.io/docs/components/concepts/process-instance-migration/)) | Token-based BPMN engine. A parallel gateway forks one token per outgoing flow, and the joining gateway waits for a token on every incoming flow. A call activity starts a child process instance and completes when the child completes. Timer boundary events may be non-interrupting. Migration maps active elements and refuses unmapped ones | Join-by-arrival-per-incoming-flow (our `{ node, from }` arrivals). Child instance for a nested shape. A non-interrupting timer that does not move the token. Refusing a version move whose active elements cannot be mapped (`marking_not_mappable`, as the rebind design already cites for its in-flight guard) | Interrupting boundary events and event sub-processes (soundness, parent §6.1). Process variables flowing between parent and child: a child returns only its stop and evidence. Zeebe itself as a dependency (AGENTS.md §7, absorb don't adopt) |
| **Temporal** ([child workflows](https://docs.temporal.io/child-workflows), [timers](https://docs.temporal.io/workflow-execution/timers-delays), [deterministic constraints](https://docs.temporal.io/workflow-definition#deterministic-constraints)) | Durable execution by replaying an event history through deterministic code. Child workflows have their own history and a parent-close policy. Durable timers fire as events | Determinism: our drive step is pure over persisted state plus an injected `now`, and the parity harness replays event sequences the way Temporal replays histories. A child that is its own durable unit with its own history (its own room and activity trail). A parent-close rule: rework abandons the stale child | Workflow-as-code. The model must stay a declared, checkable document (parent's direction). Timer services as new infrastructure: the existing 15-minute drive tick is the clock |
| **Apache Airflow** ([DAGs and trigger rules](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html)) | Scheduler-tick DAG execution. Tasks run when their trigger rule over upstream states holds, `all_success` by default. DAGs are acyclic; loops are not expressible | Scheduler-tick evaluation: each tick re-reads state and decides, which is exactly the drive's model. `all_success` is our join | Trigger rules other than all-success (`one_success`, `none_failed`, and so on): they are OR-join semantics the parent excludes. Acyclicity: we need bounded rework, which Airflow cannot express |
| **Flowable** ([BPMN parallel gateway](https://www.flowable.com/open-source/docs/bpmn/ch07b-BPMN-Constructs#parallel-gateway)) | Execution-tree engine (child executions per branch, joined at the gateway) | Confirms the per-branch execution model. Each branch carries its own `enteredAt`, iteration and dispatch, the way a child execution does | Its execution-tree persistence. We keep a flat 1-safe token set, which block structure makes sufficient |

The standard followed is BPMN 2.0.2 chapter 13 token semantics, restricted as the parent's §6.1
states. There is no project-specific deviation beyond that restriction and the non-interrupting
deadline.

## 13. Risks

| Risk | Mitigation |
|---|---|
| The substrate change alters a sequential room | The structural branch keeps the old body untouched. The golden is captured before the change (AC-3C-SEQ-IDENTICAL). `marking` is written only for graph shapes |
| Drive and interpreter drift | Two independent implementations over one shared graph. Seeded parity per construct. Flags flip only with parity |
| Graph shapes enter the registry without passing the compiler | Registry guard (§7.2) with a shrink-only allow list |
| Parallel dispatch overloads a room or leaks tasks | One lease per room. The task id is fixed on the token at entry. A branch task is deactivated in the tick its token leaves the stage, and on every terminal action. A test asserts no active branch task after a stop, a success, a join wait or a rework clear |
| The `defer → hold` mapping changes live behaviour | Applied only where a stage declares a refuse route (DI-0D9DFB0FC0EF), a construct no running room uses; every other stage keeps `defer` advancing (founder decision 2026-10-02). The parity harness holds both: `defer` holds on the refuse-route stage and an enforced gate without a route advances. See correction 2 |
| A graph room loses its marking and silently restarts (review blocker 1) | Every graph snapshot carries a marking. `persist` merges it under the receipts' compare-and-set. A malformed marking is kept verbatim. Fail-closed pauses keep the stored `stageKey`. AC-3C-MARKING-DURABLE |
| Non-first branches re-dispatch every tick (review blocker 2; the #5166 defect) | Per-token latch prior (§4.2). AC-3C-BRANCH-LATCH |
| A new reason concludes as `unconcluded` | `drive-conclusion.ts` entries land in the PR that introduces each reason (§5). AC-3C-CONCLUDED |
| Phase 4's conformance change disturbs AC-3C-SEQ-IDENTICAL | The Phase 4 plan's preferred fix leaves the deviation type unchanged and derives the stage inside the detector. The persisted `conformance` bytes, which the golden covers, are therefore unchanged. If Phase 4 instead widens the deviation type, it must regenerate the golden in its own PR, with the diff reviewed |
| Evidence for graph rooms is truncated (pre-existing) | `loadRecordedEvidence` applies one `LIMIT 500` across **all** rooms in the tick (`workroom-drive-data.ts:203`), not per room. So a busy room can starve the others of evidence today. Graph rooms record more evidence per room and make this worse. This is a pre-existing defect; the coordinator will file a BI for it. 3c does not depend on fixing it. It should be fixed before a wide fork such as R2D relies on per-branch evidence |
| Deadline notices spam or vanish | Per-iteration key, at-least-once with retry, the same trade-off as the stall notice |
| Sub-shape rooms proliferate | Idempotency key per cycle, stage and iteration. The drive removes the `contains` row itself. Children go terminal on stop. Rework abandons the stale child. Rebind refused while a child is live |
| Authority widens through nesting | D-9 at compile time, TAK intersection at runtime, no implicit permit inheritance |
| One firing per tick is slow for wide forks | Run-now event. Q4 records the trade-off |

## 14. Decisions and remaining questions

**Recorded 2026-10-02.** The founder answered in chat; the answers bind this design.

- **Q1: decided for every existing stage. Keep today's behaviour.** On a gated stage, `defer`
  records the deferral and the room moves on. Moving any existing stage to `defer → hold` is a
  live-behaviour change and needs its own founder decision and PR.
  - **Decided for refuse-route stages: DI-0D9DFB0FC0EF** (WWMD, followed 2026-10-06,
    founder-delegated). On a stage that declares a refuse route, `defer` HOLDS the token at the
    gate until an accept or a send-back is recorded. On every stage without one, `defer` keeps
    advancing exactly as today. PR-3c-3 implements it: the drive derives a verdict only for a
    refuse-route stage, and the parity harness maps `defer` to `hold` there.
- **Q2 and Q6: decided. Yes, with limits.** The drive, as system actor, may create, complete and
  abandon child rooms. A child never holds more grants than its parent (D-9 enforces this). A child
  that stops on failure or budget holds the parent for its owner; the stop kind is not propagated.
- **Q3, Q4, Q5, Q7: design-review defaults.** These are technical choices owned by the design and
  plan reviewers, not founder decisions:
  - Q3: deadlines notify and never interrupt.
  - Q4: one firing per tick.
  - Q5: five PRs.
  - Q7: "Send back" as the label.
  A reviewer may challenge any of them. Each is open until the review records a verdict.

The original questions follow, for traceability.

- **Q1 (correction 2).** On a stage with a ratified `enforced` gate and no refuse route, should `defer`
  hold the token, as the parent says, or advance it, as the runtime does today? This spec keeps
  today's behaviour and applies `defer → hold` only where a refuse route exists. The proof
  migration's gate (`outbound-customer-communication`, enforced/blocking, offering accept/defer)
  is directly affected.
- **Q2.** When a child stops on failure or budget, should the parent hold for its owner
  (recommended), or propagate the same stop kind?
- **Q3.** Confirm that stage deadlines are non-interrupting (recommended, parent §6.1 rule 8), and
  that "route to refuse on expiry" is rejected.
- **Q4.** Confirm one firing per tick for graph shapes (recommended, keeps parity with today's
  drive), rather than firing to a fixpoint.
- **Q5.** PR grouping: five PRs (recommended) or four (substrate folded into parallel). See the
  plan.
- **Q6.** Confirm that the drive, as system actor, may create child rooms and complete or abandon
  them.
- **Q7.** The label for the new choice: "Send back" (proposed).

## 15. Documentation impact

- **GPP §12.4.3 and Annex A.** "Executable model" gains "parallel, rework, deadline and sub-shape
  constructs executable since 3c". Each flag-flip PR updates its own row.
- **This spec's §5 table** of executable constructs is mirrored by the header of
  `executable-constructs.ts`, which each flip PR edits.
- **The workroom flow map spec** (`2026-10-02-workroom-flow-map-and-measurement-design.md:94, 297`)
  defers drawing these constructs until their flags flip. Each flip PR notes the flag in that spec's
  status line. The rendering itself belongs to that spec.
- **User-facing.** The "Send back" choice and the overdue-deadline notice are new copy. They appear
  only for shapes that declare a refuse route or a deadline, so the first consumer's PR (R2D)
  carries the user guide entry. No coworker prompt changes.
- **Runbooks.** None. The drive's cadence and lease are unchanged.
