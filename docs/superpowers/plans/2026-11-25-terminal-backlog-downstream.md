---
status: active
---

# A finished backlog item closes what points at it

**Backlog item:** `BI-F4A9BBF4`. **Program:** [closure program slice 2](2026-11-25-closure-program.md) (EP-C00F61F4, BI-97C56E20).

## Problem

A BacklogItem reaches done or retired through many writers: the governed terminal transition, the acceptance sweep, the REST route, portal actions, MCP tools and federation sync. Only two MCP paths ever synced the item's WorkItem, through `bridgeBacklogItemToWorkItem`. No code closed its ImprovementSignals. ImprovementProposals moved only on the skills path.

Measured 2026-11-25:
- **WorkItems:** 830+ live WorkItems sat behind finished items. The "Work Anchor" queue read 1,443 waiting with zero throughput.
- **Completion times:** 193 completed WorkItems had no `completedAt`.
- **Signals:** 456 open and none ever closed; 95 belong to a finished item.
- **Proposals:** 61 open behind a finished item.

## Options considered

1. **Call the bridge from `completeBacklogItemTransition` and the retire path.** Rejected as the only fix. It covers two writers, and the next writer added (or federation sync, which writes status directly) reopens the gap.
2. **A database trigger on BacklogItem.status.** Rejected. It hides behaviour from the application layer and its tests, and it cannot record queue telemetry through `recordQueueTransition`.
3. **Chosen: a level-triggered reconcile on a cron.** Each pass reads the item's terminal state and converges eligible downstream records. Repeated bounded passes drain the existing backlog after opt-in. The precedent is `budget-reservation-settle` (BI-EF265C9A), which settles reservations against item status for writers that do not settle themselves.

## Implementation surfaces

- **Pure orchestration.** `apps/web/lib/queue/bridges/terminal-backlog-downstream.ts` decides the queue transition per closed row and the summary; it has unit tests.
- **Postgres ports.** `terminal-backlog-downstream.server.ts` runs set-based `UPDATE … RETURNING` with the locks and eligibility checks in R1.
- **Matching.** The WorkItem `sourceId` is matched on either the item's semantic id or its row id; both forms exist in production.
- **Status mapping:**

  | Record | Item done | Item retired |
  |---|---|---|
  | WorkItem | live → `completed`, `completedAt` set | live → `cancelled`, `completedAt` set |
  | ImprovementSignal | `open` → `resolved` | `open` → `dismissed` |
  | ImprovementProposal | `prioritized` or `in_progress` → `implemented` | Unchanged. Route to the Manager for disposition. |

  The proposal lifecycle is the one in `2026-03-16-platform-feedback-loop-design.md`. `verifiedAt` stays reserved for the recurrence check (BI-D33412EA).
- **Queue telemetry.** After a committed WorkItem closure, attempt a `finished` or `cancelled` transition under `cwq:<queueId>` with its cycle time. Report telemetry successes separately from the ledgered closure count.
- **Schedule.** `ops/terminal-backlog-downstream-reconcile` runs at minutes 4, 19, 34 and 49 of each hour. It is catalogued as editable and honours the enabled gate and quiescence.

## Revision 5 (independent review of b886d32f106c)

The independent review of 581c8c2e and the design reviews of Revisions 2 and 3 all returned REQUEST_CHANGES. Revisions 2 and 3 are superseded and kept only in git history (84733f08, 510574082650).

Revision 5 keeps Revision 4's batch and opt-in boundaries. It preserves Manager-only proposal rejection, requires stable signal cutoffs, and makes disabled-state recovery explicit. It removes verification claims from the earlier draft. Revision 4 remains in Git history.

Safeguards retained from Revision 4:
- Automatic signal reopen is dropped; recurred signals are surfaced to people (R5).
- Quiescence admission fails closed (R2).
- The retention window is explicit (R3).
- A conflicting receipt is a rollback-and-read, never a skip (R6).
- There is one rolling human ask (R5).
- The drift promise is narrowed (R1).

### Terms

| Term | Meaning |
|---|---|
| **Parent** | The BacklogItem. |
| **Child** | A WorkItem, ImprovementSignal or ImprovementProposal linked to the parent. |
| **Signal finish cutoff** | The parent's `completedAt`, read under the parent lock and retained for each closed signal. No signal closes if that timestamp is absent. Never use the parent's mutable `updatedAt` to admit a signal. |
| **Run key** | `TBD-<yyyymmddhhmm>`, taken from the scheduled cron slot (UTC) the invocation was fired for. It is stable across step retries and across a duplicate firing of the same slot. |
| **Batch key** | `<run key>:<batch name>`, one per batch in a run. |

### R1. Locking order and full rechecks

Every batch is one interactive transaction, with `SET LOCAL lock_timeout = '5s'` and `statement_timeout = '15s'`. Each batch runs these steps in order:

1. **Receipt check.** If `TerminalDownstreamBatch` already holds the batch key, return its stored result and write nothing (R6).
2. **Select candidates.** Run a non-locking select of up to 250 child ids that satisfy every eligibility condition (R5), ordered by `createdAt, id`. Children are selected rather than parents, so the cap counts real targets and a parent with no eligible child takes no slot.
3. **Lock parents.** Lock those candidates' parents `FOR SHARE`, ordered by `id`, and keep only those still `done` or `retired`. READ COMMITTED re-evaluates the predicate after any lock wait, and a parent reopen that starts after this point waits for the batch to commit.
4. **Lock children.** Lock the children `FOR UPDATE`, ordered by `id`, re-checking the full typed link and every eligibility condition against the locked parents.
   - **WorkItem link:** `sourceType = 'backlog-item'` and `sourceId` matches exactly one parent across both namespaces. An ID that matches different parents by `itemId` and `id` is ambiguous even if only one parent is terminal. Skip it and report the count. Recheck uniqueness of the match at write time.
   - **Signal and proposal link:** `backlogItemId` equal to the parent's `itemId`.

   The before-image is captured from these locked rows.
5. **Admission (R2).** Read the opt-in and quiescence rows `FOR SHARE`.
6. **Update and record.** Run the UPDATE, whose final WHERE repeats the full link and eligibility predicate. Insert one ledger row per updated child, and the batch receipt, in the same transaction.

**The backfill follows the same rules.** For a backlog-linked child, use the locked parent's `completedAt`. Skip the backfill when the close time cannot be established. A child relinked while the batch waited fails the typed-link recheck and is skipped. A child with no parent link (sourceType other than `backlog-item`) takes its own `updatedAt`, under the child lock only. This timestamp is not a signal eligibility cutoff.

**Drift after commit is reported for parent reopens only.**
- Each run's result lists active ledger entries whose parent is no longer `done` or `retired`, with record ids, so an operator can revert them (R3). They are not reopened automatically, since that would race with whichever writer reopened the parent.
- A child relinked after commit to another parent while the original parent stays terminal is **not detected** by this job.

### R2. Opt-in and quiescence: admission fails closed

**Executable default-off.** `isJobOptedIn(jobId)` returns true only when all of the following hold:
- the `ScheduledJob` row exists;
- `enabled = true`;
- `metadata.optIn` holds `{ by, at }`.

Only the operator enable action in `control.ts` writes `metadata.optIn`, and only for catalog entries with `requiresOptIn: true`. So the schema default `enabled = true` cannot opt the job in: a row created implicitly (by registration, an edit, bootstrap or anything else) has no marker, and the job stays off. A read error returns false.

The create-only seed writes the row disabled, so the register shows the true state. There is no run-now path: `runNowEvent` is null, and the cron body is the only caller of the batch functions.

**Quiescence fails closed.** Admission reads the quiescence `PlatformConfig` row directly with the existing config parser, bypassing the process cache. The batch writes nothing when:
- the row is missing;
- its value fails to parse;
- the level is anything but `normal`.

The entry gate (`gateAtEntry`) stays only as a cheap early exit; it is not the admission check.

**Serialized with control changes.** In step 5 the batch locks the `ScheduledJob` row and the quiescence `PlatformConfig` row `FOR SHARE`, immediately before the mutation and after every other lock wait.
- An operator disable or a quiescence change is an UPDATE of one of those rows, so it waits for the admitted batch to commit.
- A batch that reads "stop" writes nothing.

The boundary is **one admitted batch**: a disable or quiescence change issued while a batch holds its admission locks takes effect at the next batch. This is a statement about batches, not a time guarantee.

### R3. The closure ledger, within its retention window

**Table `TerminalDownstreamClosure`** holds one row per child change. It is typed by ruling, because no existing substrate fits.

| Column | Contents |
|---|---|
| `id`, `runKey`, `batchKey` | Identity, and the run and batch that wrote it |
| `action` | `close` or `backfill` |
| `recordType`, `recordId` | The child |
| `backlogItemId` | The parent's row id |
| `link` | JSON: the typed link as written |
| `finishCutoff` | The stable parent cutoff when present. It is required for a signal closure. |
| `preImage` | JSON: every column the write changed, before the write |
| `postImage` | JSON: the full expected after-image, link columns included |
| `writeGeneration` | The child's `updatedAt` as set by this write (transaction timestamp) |
| `consumedAt`, `consumedReason` | `reverted` or `superseded` |
| `surfacedAt` | Set when a recurrence was raised to people (R5) |
| `createdAt` | When the row was written |

**Ownership.** The job owns a child while its current values equal `postImage` and its `updatedAt` equals `writeGeneration`. Every Prisma writer bumps `updatedAt`, so an edit, a relink, or a reopen and re-close into the same status all change the generation. A writer that bypasses Prisma and leaves every column identical would go undetected. The design accepts that residual case, because v1 has no automatic reopen that could act on it.

**Claiming.** Ledger rows are inserted in the same transaction as the child UPDATE, fed from `UPDATE … RETURNING`. The record and the change commit together or not at all.

**`revertTerminalDownstreamRun(runKey)`:**
- This is a separately authorized `manage_platform` operator action, not a cron execution. The forward job must already be disabled and the transaction must observe readable normal quiescence. Missing or unreadable control state refuses the revert. Hold the relevant control rows through the transaction so re-enabling the job waits.
- For each entry, it locks the ledger row `FOR UPDATE`, then the child `FOR UPDATE`.
- If the entry is active (`consumedAt IS NULL`) and the child is still owned, it restores `preImage` and consumes the entry as `reverted`.
- If the child no longer matches, it consumes the entry as `superseded` and leaves the child alone.
- It reports skipped entries. Each entry is single-use.
- It is the only consumer of entries in v1, so there is no lock-order conflict.

**No re-close after revert, within the retention window.** The close and backfill predicates exclude a child that has a `reverted` entry for the same parent. The exception is a parent whose `completedAt` is later than that entry's `consumedAt`, which is a genuinely new finish. A parent without a `completedAt` (retired) never automatically re-closes a reverted child.

This guarantee holds **only while the ledger entry exists**. Once an entry is purged, a child that a person reopened can be closed again by a later pass, if it still meets full eligibility (R5).

**Retention.** The model carries `@dpf lifecycle=telemetry-bounded retention=365d sensitivity=internal categories=operational timeAxis=createdAt`, and the existing annotation-driven retention executor (`lib/operate/retention`) purges it. No retention override is needed now that recurrence reopen is gone. Expiry means three things:
- that closure can no longer be reverted;
- the no-re-close guarantee lapses;
- the change becomes permanent history.

**Indexes:**
- `(recordType, recordId, consumedAt)` for ownership and re-close lookups;
- `(runKey)` for revert;
- `(backlogItemId, consumedAt)` for drift reporting;
- `(createdAt)` for retention.

**Batch receipt table `TerminalDownstreamBatch`:**
- **Columns:** `batchKey` (unique), `runKey`, `batchName`, `rowsChanged`, `result` (JSON), `createdAt`.
- **Write:** in the batch transaction, including empty batches.
- **Lifecycle:** same annotation, `retention=90d`.

**Rollback procedure** (also in the data-impact manifest). It covers runs whose ledger entries are still within the 365-day window. Older runs cannot be reverted.
1. Disable the job on the scheduled-jobs surface, which removes the opt-in.
2. Confirm disablement is effective before using the authorized revert action for each run in the window. A quiescence pause or unreadable state holds the revert. Do not re-enable the forward job to work around that hold.
3. Inspect the ledger and the skipped entries. Resolve superseded entries through normal ownership routes. Disabling the job alone does not revert any closure. Entries past their retention window cannot be recovered by this job.
4. Keep both tables while any rollback or reconciliation is owed. Removing them is a separate forward migration that requires a reviewed disposition for retained history. This procedure never drops tables during incident recovery.

**Telemetry.** Queue transitions stay best-effort after commit and are not used for rollback. A crash between commit and emit can leave missing telemetry, and a revert does not erase telemetry already recorded. The ledger, not queue throughput, is the audit source. Report committed closures and observed telemetry successes separately. Any difference is a telemetry gap, not a failed closure or evidence of a duplicate. Replay does not emit transitions again.

**R3 amendment — preserve the committed ledger migration**

This is a plan-only correction to Revision 5. The five acceptance statements below, scheduler admission, child writes, typed eligibility, receipt keys, ledger retention (365 days), batch receipt retention (90 days), and disabled-state revert ownership do not change. The correction is not independently shippable.

- Keep the committed `packages/db/prisma/migrations/20261126030000_terminal_downstream_ledger/migration.sql` byte-for-byte unchanged. Its migration checksum must not change.
- Add `packages/db/prisma/migrations/20261126030100_terminal_downstream_retained_references/migration.sql` after it. In one transaction rename `recordId` to `recordRef` and `backlogItemId` to `parentBacklogRef` on `TerminalDownstreamClosure`, then rename `TerminalDownstreamClosure_recordType_recordId_consumedAt_idx` to `TerminalDownstreamClosure_recordType_recordRef_consumedAt_idx` and `TerminalDownstreamClosure_backlogItemId_consumedAt_idx` to `TerminalDownstreamClosure_parentBacklogRef_consumedAt_idx`. Preserve the existing index keys and nullability. Child references are polymorphic with `recordType`; parent references are historical and may be null on an unlinked backfill. Do not add FKs or change delete behavior.
- Add the named `TerminalDownstreamClosure_recordType_closed_set` CHECK with exactly `work-item`, `signal`, and `proposal`. Apply a validated CHECK in the correction. Before signing the ordinary migration-safety `data-safe` attestation, verify that the original migration and its writers have not shipped and that managed installs apply both files before the new writer can run. Cite that proof in the attestation. Do not use `NOT VALID` to avoid the check, or rewrite, delete or silently tolerate invalid values. If the source or release history cannot establish that proof, stop for the data steward's decision on safe forward recovery.
- Keep the staged schema and its call sites tied to the renamed columns. Update `changes/terminal-downstream-ledger.data-impact.json` to describe the ordered create-and-correct sequence, historical references, zero row rewrites, and forward-only recovery. Preserve the manifest's retention and rollback dispositions. Regenerate `docs/architecture/architecture-counts.generated.md` with the canonical generator.

### R4. Quiescence and opt-in are part of admission

Both are read inside the batch transaction under a row lock (R2), so a retried step re-reads them.

### R5. Eligibility, and what goes to people

**WorkItem close:**
- `status` is live;
- the typed link is present;
- the parent is `done` or `retired`;
- the no-re-close rule (R3) allows it.

**WorkItem backfill:**
- `status IN ('completed','cancelled')` and `completedAt IS NULL`;
- the typed link, if any;
- the no-re-close rule allows it.

**Signal close:**
- `status = 'open'`;
- `backlogItemId` names a `done` or `retired` parent;
- the locked parent has a stable `completedAt`. Missing cutoffs are triage cases, not eligible signals;
- `lastSeenAt <= finishCutoff`;
- the no-re-close rule allows it.

A signal seen after its parent finished therefore stays open.

**Proposal close:**
- `status IN ('prioritized','in_progress')`;
- the parent is `done` (→ `implemented`). This is the developer/agent lifecycle transition recorded in the feedback-loop spec;
- the no-re-close rule allows it.

**Recurred signals are surfaced, never reopened (v1).** A signal the job closed whose current `lastSeenAt` is later than its entry's stored `finishCutoff` has recurred. This includes an occurrence between the finish and the closure, and an upsert that waited on the batch's child lock. The job never changes such a signal; it sets the entry's `surfacedAt` and adds the signal to the human ask below. Automatic reopen needs a closure-generation column on the child tables to prove ownership against a manual reopen and re-close, so it is filed as a follow-up, BI-949B6B74.

**Proposals before prioritization:** a `proposed` or `reviewed` proposal with a backlink to a finished parent is never changed, and each run counts these.

**Proposals linked to retired items:** never reject or otherwise change the proposal in this job. Route prioritized or in-progress proposals linked to a retired item to the authorized Manager with the linked item and reason for triage. The Manager remains responsible for rejection through the existing workflow.

**The human ask.** Persistent cases go to people through the existing `routeToHuman`:
- **What is routed:** a pre-prioritization proposal with a parent known to have been terminal for more than seven days, a recurred signal, an open signal with no stable finish cutoff, or a prioritized or in-progress proposal linked to a retired item. When the age cannot be established, count the pre-prioritization case without calling it persistent. Route the existing rolling ask to the improvement triage owner, with Manager action explicitly identified for proposal rejection.
- **One open ask at a time,** under the stable dedupe key `terminal-downstream:needs-triage`. While it is open, each run refreshes its rolling list: the first 50 record ids, the total count, and a query reference that reproduces the full set.
- **After it closes:** if an unresolved eligible case remains, the next run raises a new ask under the same dedupe key.
- **No work item** is created on any pass.

**A new parent lifecycle.** A parent that reopens and finishes again gets a later `completedAt`, and that later cutoff lets its children close again.

### R6. Bounds on committed work

Four batches run per run key, each capped at 250 child targets:

| Batch | Cap |
|---|---|
| `workitem-close` | 250 |
| `workitem-backfill` | 250 |
| `signal-close` | 250 |
| `proposal-close` | 250 |

Each batch commits at most once per run key, because its receipt is written atomically with its changes. Committed work per run is therefore at most 1,000 rows, of which at most 500 are WorkItems.

**Receipt conflicts.** Two sessions on the same batch key race on the unique insert. The loser's insert fails, and its whole transaction rolls back, including its child updates and ledger rows. It then reads and returns the winner's receipt. `ON CONFLICT DO NOTHING` is not used, because it would let the loser's child updates commit.

**Replay:**
- A step retry, or a duplicate firing of the same cron slot, finds the receipt and returns the stored result.
- Empty batches write a receipt too, so a replay cannot pick up rows that became eligible later under the same key.
- Replay is guaranteed only within the receipt's 90-day retention. No scheduler retries that late.

The cron runs at most once per slot (`concurrency 1`). `batchCapped` means a batch reached 250, not that more eligible work is confirmed.

### R7. Tests

All tests run on real Postgres through the repo's `*.postgres.test.ts` harness, alongside the pure orchestration tests.

**Two-session tests:**
- a parent reopened during the parent-lock wait;
- a relink during close;
- a relink during backfill;
- an eligible status change while the UPDATE waits (stale before-image);
- revert while a batch holds the child;
- a disable or quiescence change during admission;
- the same batch key in two sessions: the loser rolls back entirely and returns the winner's receipt.

**Single-session tests:**
- preserved statuses;
- no re-close after revert, and the same case after the entry is purged;
- recurrence detection against the stored cutoff, including occurrences between finish and closure, which are surfaced and never reopened;
- an ownership mismatch, consumed as superseded;
- default-off: an implicit row, the opt-in marker, a read error;
- quiescence fail-closed: a missing row, an invalid value, a non-normal level;
- the real caps;
- partial failure (a later batch throws after an earlier one committed) and its retry;
- a commit-before-acknowledgement replay, proving repeated replays never exceed 1,000 committed rows per run;
- the rolling ask: one open ask, refreshed list, and a new ask only after closure.
- an ambiguous WorkItem ID where the other match is not terminal;
- a retired parent without a stable finish cutoff, even after later edits;
- a retired parent's prioritized proposal remains unchanged and reaches Manager triage;
- revert works with the job disabled and refuses unreadable or non-normal quiescence.

**R7 amendment — exact ordered migration pair**

The original R7 harness in `apps/web/lib/queue/bridges/terminal-backlog-downstream.postgres.test.ts` and the supplemental harness in `apps/web/lib/queue/bridges/terminal-backlog-downstream-triage.postgres.test.ts` both apply the two exact repository migration files in order, only to their own disposable fixture schemas. Bind the committed original blob and scope the second migration to the two column renames, the two corresponding index renames, and the named CHECK plus validation. Reject swapped, missing, or unexpected SQL using source-local fixtures. Preserve the 21 original named runtime cases and 2 supplemental cases and both schema-absence assertions. The database-specific constraint probe stays in the existing fixture test.

Source-only exit criteria: exact affected synthetic suites with the DB environment variables empty, web production/test typecheck, migration immutability, migration safety, schema regression, closed-set, FK index coverage, connector lifecycle, module size, data-impact, and generated-artifact freshness checks. Confirm the original migration blob and the substrate baseline are unchanged. The canonical Postgres gate, migration execution, and 23 real cases remain due and must not be reported as passed.

## Acceptance

- AC-1: For each eligible WorkItem selected in a bounded batch, match exactly one terminal backlog item by semantic or row ID, close it as completed or cancelled, and set completedAt. Skip ambiguous matches. Backfill missing completion timestamps only after rechecking the typed link and eligibility.
- AC-2: Record each committed child change in the closure ledger. Attempt the matching finished or cancelled WorkItem telemetry after commit and report successful transitions separately from ledgered closures. Receipt replay must not repeat the mutation or emit duplicate telemetry.
- AC-3: Resolve or dismiss eligible open signals only when a stable parent completedAt exists and lastSeenAt is no later than that cutoff. For done parents, mark only prioritized or in-progress proposals implemented. Surface retired-parent proposals to the Manager without rejecting them. Route recurrences, missing signal cutoffs, and persistent pre-prioritization proposals for triage without changing them.
- AC-4: Each scheduled slot commits at most four replay-safe batches of 250 changes, at most 500 of them WorkItems. Lock and recheck eligibility before writing. Revert within the 365-day ledger window only while the job still owns the row.
- AC-5: The cron is disabled by default and never writes without explicit operator opt-in and readable normal quiescence. In shared nonproduction, verify locking, opt-in, replay and revert against Postgres. After a separately authorized production enablement, verify the first bounded run and confirm the closure scorecard reflects eligible signal and proposal closures as the backlog drains.

## Backlog coverage

- Decision: atomic
- Parent: `BI-F4A9BBF4`
- Rationale: The ledger, the opt-in gate, the batch store, the cron and the revert are one safety envelope for a bulk mutator. None of them can ship alone without either running unguarded or shipping dead code, so the slice is delivered and reviewed as one change.
- Dependencies: none (the follow-up BI-949B6B74 depends on this slice, not the reverse)
- Coverage: the forward correction stays within the same atomic deliverable and adds no dependency. Record current coverage for the immutable amended plan before implementing it. The model-budget disposition is separate.
- Receipt: blocked-by: the repository provider must be able to read this exact docs-only commit at the live docs Workroom head before fresh plan coverage can be issued.

## Verification

- **Planned implementation checks:** test transition mapping, replay without duplicate telemetry, the empty pass and the Postgres cases in R7. No test of the revised worker or revised SQL is claimed by this documentation PR.
- **After separately authorized production enablement:** verify the first bounded run. Use the closure scorecard (BI-97C56E20) to see whether eligible signal and proposal closures are reflected as the backlog drains. Compare ledgered WorkItem closures against successfully recorded queue transitions.

## Not in this slice

- **Automatic reopen of recurred signals.** It needs a closure-generation column on the child tables; filed as BI-949B6B74 (R5).
- **Anchor WorkItems of ad-hoc capsules.** Their terminal source is the room, not a backlog item. They belong with merged-room closure in BI-D5830561.
