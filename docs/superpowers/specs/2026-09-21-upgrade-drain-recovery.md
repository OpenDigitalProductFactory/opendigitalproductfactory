---
status: active
---
# Bounded upgrade drain and historical recording repair

Backlog: BI-7289199B. Workroom: WC-7F1B0F19.
This is an operator-authorized live break-fix, declared 2026-09-21;
independent post-implementation review is due 2026-09-23T02:21:58.943Z.
Extends the activity-quiescence-protocol design, without a new lifecycle or table.

## Evidence and objective

On installed revision 0961596a94fc, QR-2026-09-21-y6ho73hv entered draining
at 01:36:14.994Z with a 300000 ms budget. The watchdog failed it at 01:41:26,
but the coordinator later heartbeated and overwrote failure with deferred at
01:47:33. The same replay-local deadline and unconditional writes exist at
source base 5cdafb1e4ea. Three new mutation tests fail against that source;
a durable replay harness exercises repeated suspension with scheduler delay.

The portal and database respond. This is not a port-listener failure. Delayed
local inference can keep blockers active but must not extend the drain budget
or authorize a failed coordinator to resume writes.

## Implementation order and acceptance

1. Persist the drain start through the existing enteredStateAt timestamp. Read
   wall time inside checkpointed steps so replay cannot reset the budget or
   change an earlier loop branch. A delayed replay still defers at five minutes.
2. Refactor state writes out of the large caller API, preserving its exports.
   Fence transitions on the observed state. Reject terminal writes and heartbeats;
   retain only the existing evidence-backed failed-to-completed boot correction.
3. Fence watchdog writes on the state and heartbeat originally observed. Clear
   the global drain level only if that run still owns it. An old coordinator
   cannot release a newer drain.
4. Preserve timestamps when an already-committed step repeats before its durable
   checkpoint lands. A same-state terminal retry can finish cleanup without
   changing terminal evidence. Watchdog comparisons remain strict.
5. Recover a ready-to-swap or swapping orphan only when its parent upgrade has
   definitively failed for over an hour. Use the existing clear-event broadcaster
   to wake suspended work and clear the operator banner; preserve active parents.
6. Run affected tests, typecheck, source guards, independent review, protected
   publication and the canonical upgrade path. A green source test is not live
   upgrade verification.

## Recording repair already performed

The operator explicitly authorized repairing data and housekeeping. Four
historical execution rooms (WC-3C5F0D4D, WC-80340674, WC-F0AFD099, WC-8B2C866E)
were administratively archived through MCP after verifying merged PRs 5185,
5270, 5346 and 5315. This does not assert missing PIR or failure reviews passed.
Their backlog items and review obligations remain intact. Only the first had
a break_fix_declared activity, and its PIR and backlog completion already passed.
The newer task using the rename workspace was preserved.

QR-2026-09-06-nzm0l2n4 was still ready-to-swap while its parent SUR-E18E0141
had failed on September 6. After saving a before-image, an operator-authorized
conditional transaction reconciled it to failed, requiring the parent still be
failed and no active upgrade exist. There are no remaining nonterminal drain
rows at reconciliation time. Before-image:
D:/DPF-backups/upgrade-repair-20260921/quiescence-before.jsonl.

A subsequent manual upgrade, SUR-3CB41940, succeeded to 5cdafb1e4ea and its
drain completed. The browser now shows the installed release as current.
This establishes live recovery, not deployment of this branch's safeguards.

The deployedSha field is populated from expectedDeployedSha at admission; it
does not itself prove a swap happened. Preserve that contract during this repair.

## Boundaries and recovery

No authentication bypass, fabricated review receipt, deleted history, new
runtime, or installed-file source patch. Old review requirements still block
formal completion where evidence is absent; archival retires execution only.
The change uses existing columns and needs no migration. Rollback is a reverted
PR through the normal release path; never revive archived execution as a rollback
or restore an orphan to an active state without evidence of a live owner.
