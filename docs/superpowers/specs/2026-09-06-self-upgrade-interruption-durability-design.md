---
status: active
---

# Self-Upgrade Interruption Durability

**Backlog item:** BI-41D7A057

## Evidence and cause

`SUR-E18E0141` ended `failed` on this install with no account of how far it got.
Its recorded failure is the watchdog's own prose:

```
Reconciled by watchdog (stuck "running" > 15m): orchestrator did not complete
the swap. deployed=<sha> expected=<sha> target=<sha>
```

That sentence is the entire surviving record. It says the swap did not complete;
it cannot say whether the swap had **started**, which is the only fact that
distinguishes an install the run never touched from one it left half-changed.

The cause is structural, not a defect in any one module. A self-upgrade is
orchestrated by the very portal it replaces, so its progress exists only as
stdout of a process that is expected to die. When the process dies for a reason
that is NOT the swap — a Docker Desktop restart, a host reboot, a power cut —
the progress dies with it and nothing durable is left behind. The reconciler
that later marks the run `failed` runs in a different process, often several
boots later, so there is no moment at which it could have recorded what it did
not witness.

`scripts/promote.sh` already announces each phase it enters through `emit_step`,
at sixteen call sites covering the whole promotion. Every one of those
announcements went to stdout alone.

## Governed scope manifest

- **OBJ-SUI-001:** An interrupted self-upgrade must leave a durable record of how
  far it got, surviving loss of the orchestrating process and of host power.
- **OBJ-SUI-002:** A terminal failure must carry a recorded verdict on whether
  the container swap could have been applied, including an explicit
  indeterminate verdict when it cannot be established.
- **OBJ-SUI-003:** Recovery eligibility, admission authority and the operator's
  next action are unchanged, on every install and in either direction of
  portal/promoter version skew.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-SUI-001 | OBJ-SUI-001 | Every step `promote.sh` announces is appended to a host-backed file on the shared state mount, with its UTC time, mode and target SHA. |
| AC-SUI-002 | OBJ-SUI-001 | A promotion never fails, and its stdout never changes, because the trail could not be written; an absent, unwritable or full state mount is a no-op. |
| AC-SUI-003 | OBJ-SUI-002 | A dispatched terminal failure is classified against the trail and the verdict persisted on the run, including `swapApplied: null` with its basis when indeterminate. |
| AC-SUI-004 | OBJ-SUI-002 | `swapApplied: false` is returned only for a trail whose newest real entry for that target is a step known to precede container replacement. |
| AC-SUI-005 | OBJ-SUI-003 | Typed recovery remains never-dispatched-only (AC-SUA-016) and a dispatched failure still admits a fresh run with no `recoveryOfRunId` (AC-SUA-015). |
| AC-SUI-006 | OBJ-SUI-003 | An unrecognised step name, an absent trail, or a failure to read or persist yields the pre-change behaviour and never a false `swapApplied: false`. |

## Design

### The trail

`emit_step` gains `_persist_step`, which appends
`<utc>\t<mode>\t<step>\t<target-sha>` to
`$DPF_PROMOTER_STATE_DIR/self-upgrade-steps.log`.

The state mount is the deliberate choice and the reason no new plumbing is
needed anywhere. The promoter already mounts the host state directory
read-write; the portal already mounts the same host path read-only. So the trail
crosses the container boundary with **no new mount, no compose change and no new
environment contract between portal and promoter**. That matters more than
elegance here: an install whose portal and promoter differ in version — the
normal state during a fleet rollout, and unavoidable because a self-upgrade is
precisely the act of changing one of them — is unaffected in either direction. A
newer promoter writing a trail an older portal never reads costs nothing; an
older promoter writing no trail leaves a newer portal with "unknown", which is
exactly today's behaviour.

Writing is best-effort by construction: no mount, no unwritable directory and no
write error can fail a promotion or alter a single byte of its stdout. A
promotion must not be lost because its own progress log could not be kept.

The file is bounded at 2000 lines and rotated to the newest 1000 through a temp
file in the same directory, so a crash mid-rotate leaves either the whole old
file or the whole new one — never a partial read. Dry runs are tagged `dry-run`
and are never read as real progress.

### The verdict

`interruption-trail.ts` turns the trail into the one fact recovery needs: was
the new container ever created? It answers `false` only when the newest real
entry for the run's target is a step known to precede `docker-up`, and `null`
for everything else — an absent trail, no entry for that target, a step at or
past the swap, or a step name this portal does not recognise.

The asymmetry is the design. A false "not applied" would authorise re-running a
promotion that had already replaced the portal; a false "unknown" costs an
operator one click. Pre-swap steps are therefore listed explicitly rather than
derived from position in a sequence, so a promote.sh newer than the portal
produces unrecognised names — and an unrecognised name is never guessed onto the
safe side of the boundary.

`migrate` counts as pre-swap. Schema migrations run before the container is
replaced and are forward-only, so re-running the same target after an
interruption there re-applies nothing. It is the container swap, not the
database, that makes a re-run unsafe.

### Where classification happens

`resolveRecoveryPredecessor` classifies lazily, on the next recovery decision,
rather than at failure time. A run interrupted by a power cut is failed by a
reconciler in a later process, so failure time is not a moment at which anything
could be written. The next decision is the first moment that reliably exists —
and classifying there means runs that failed *before* this ships are explained
from the same evidence as ones that fail after it, with no backfill migration
and no per-run bookkeeping.

The verdict is persisted on `SelfUpgradeRun.completionEvidence.interruption`,
merged with whatever else that column holds. Indeterminate verdicts are recorded
too: "we looked and could not tell" is what an operator needs when a failure
cannot be explained, and the absence of exactly that record is what left
`SUR-E18E0141` unexplainable.

### What is deliberately NOT changed

Recovery eligibility. `isEligibleRecoveryPredecessor` still admits only a
never-dispatched failure as a typed predecessor, as
[the exact-target recovery design](2026-08-30-self-upgrade-exact-target-recovery-design.md#completed-dispatched-failures--bi-54284e21)
froze it.

Widening it to accept a proven-not-applied dispatched failure was designed and
rejected. It would have made an interrupted run an eligible predecessor, and
`triggerSelfUpgrade` refuses an eligible predecessor without a `targetBinding`
with `recovery-binding-required` — so the operator's plain "Upgrade now" click,
which works today via fresh admission (AC-SUA-015), would have started failing.
A change meant to make interruptions survivable would have broken the recovery
path for every install that had one. The verdict is recorded for diagnosis and
for whatever consumes it later; it does not move the admission boundary.

## Verification

Unit coverage pins each acceptance, including the negative direction: an
unrecognised step, a dry-run entry, an entry for another target, a torn final
line and a rotated trail all yield `null` rather than `false`. The shell
function is exercised directly against a real state directory, an absent one and
a rotation, asserting stdout is byte-identical in every case.

Live acceptance is one self-upgrade on this install: the trail exists on the
state mount afterwards and lists the promotion's steps in order.

## Rollback

Revert the single commit. The trail file is inert data that nothing else reads;
leaving it in place after a revert has no effect.
