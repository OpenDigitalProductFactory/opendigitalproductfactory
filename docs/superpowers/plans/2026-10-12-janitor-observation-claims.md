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
