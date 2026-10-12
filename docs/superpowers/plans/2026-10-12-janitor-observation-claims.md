---
status: active
---

# Restore janitor Workroom ownership reads

BI-CFA49FAE; WC-F27AE4C8. Delivery shape: small. Kernel decision
DI-2B3F7F4F31B1 selects repair of the existing observation and consumer.

## Problem and measured evidence

On DEV on October 12 the host has 334 registered worktrees and 1,361 local
branches. The janitor's dry run reports `no workroom list in response` and
keeps every tree. At source commit
`1cf5311615da456dff8679d1d112b2237cb7c280`, the observation's `compact`
projection removes `worktreePath`, while `scripts/lib/worktree-liveness.mjs`
requires that field and consumes only one response. Supplying the configured
endpoint and trusted CA removes the certificate error but reproduces the
projection failure. Thus certificate repair alone cannot restore cleanup.

## Design grounding

Extend [typed Workroom traversal](../specs/2026-09-07-typed-workroom-pagination-design.md)
and its existing observation, liveness inventory, shared MCP transport and
credential resolver. Do not add a tool, table or duplicate ownership classifier.
The read remains authority-bound. Ownership status protects a tree even when
the room's liveness classifier calls it stale. Staleness alone grants no
destructive authority.

## Atomic implementation

1. Preserve exact nullable worktree identity and status in compact and minimal
   observation records. Oversized identity must refuse, never be shortened.
2. Replace the recursive envelope scan with explicit supported envelope reads.
   Follow one cursor chain to completion, validating identity, population,
   page counts, uniqueness and terminal disposition. Missing fields, expiry,
   truncation, errors or resource limits return unavailable with no partial
   ownership set. Keep legacy complete lists readable.
3. Reuse shared credential resolution and transport. Keep all janitor
   protections: active status, heartbeat, lease, open PR, pin and dirty files.
4. Verify regression tests for later-page ownership, empty populations,
   corrupted/incomplete pages and oversized identity. Run affected typechecks
   and governed build gate. Exercise the ownership reader against the served
   target after deployment; do not run live deletion in this change.

All steps deliver BI-CFA49FAE together: changing only the producer or consumer
leaves the ownership read broken. This is one compatibility repair, not a new
cleanup policy. Runtime wiring BIs BI-B3370CB2 and BI-8914E888 remain separate.

## Acceptance mapping

AC-1: Exact identity survives both page projections (observation tests).
AC-2: Complete traversal protects later-page owners; any invalid prefix fails
safe (loader tests and served dry run).
AC-3: Shared credentials and every existing cleanup protection remain intact
(credential seam and existing janitor regressions).
AC-4: No deletion or installed-runtime edits occur.

## Portfolio findings

The initial live census has 2,172 open items, 44 in progress and 729 awaiting
acceptance; Build Studio reports 16 active builds and one sandbox slot, intake
four per day and shadow WIP admission. Prioritize existing acceptance wakeup
BI-E3B918C2, closure reconciliation and this cleanup reader repair before
increasing intake. Preserve deployment closure and independent acceptance as
separate facts under the existing contract. Do not turn pending checks into
passes, or treat archived history as active WIP. The UI should present the next
action, owner, waiting reason and closure basis, with technical evidence in
details; UI implementation belongs to its existing Workroom surface work.

## Authoring closeout and current admission

The live kernel already publishes
[Submitting Work Is Not Accepting It](../../founder-kernel/wiki/principles/submitting-work-is-not-accepting-it.md):
an author ends the thread after opening the evidenced PR and naming what remains
unproven. Do not retain the authoring chat to watch merge, deployment or acceptance,
or create a per-author watcher. Pending acceptance belongs on the backlog.
BI-E3B918C2 owns native release acceptance; it was raised to priority 0 and the
operator's October 12 clarification was recorded as activity
`cmv5lzs8raz8p01mwsqz0n168`. Its implementation is still unfinished. Ending the
authoring thread does not assert that the outcome passed acceptance.

For this repair, the current connection refused `record_initiative_evidence`
with `AUTHORIZATION_DENIED`. Implementation admission `IRD-807F4A1379BF`
therefore refused `RESEARCH_REQUIRED`. Its alternative requires named-source
verification plus a passing failing-to-passing test before implementation;
no passing repair evidence exists yet. The refusal and this timing problem
were recorded on existing BI-6EB2DBBB as `cmv5m400xazfn01mw26kz2rpf`.
The operator subsequently approved a bounded DEV operational override to move
past internal defects. That direction is recorded in WC-F27AE4C8; implementation
proceeds under that explicit authority without pretending the refused receipt
passed. Tool-write grants, DCO, protected publication and cleanup safety remain.

The initial review made no runtime edits or deletions. The repair now changes
the source projection and ownership reader only. The full fleet dry run was stopped after its ownership
read had already failed; no complete safe-removal classification is claimed.

## Verification handoff

The new loader regressions failed before repair. The repaired loader protects
later-page owners, accepts explicit empty populations, rejects missing paths,
partial/scoped observations, changed snapshots, duplicates, count drift and
cursor loops, and uses the shared credential resolver. Projection tests retain
exact identity in ordinary and minimum-budget rows and reject oversized identity.
The current served release predates these fields, so it must continue returning
unavailable to the new reader until the protected release deploys. Acceptance is
then a read-only ownership traversal and janitor dry run; no live deletion is
part of this delivery. The authoring session ends at evidenced PR submission.
