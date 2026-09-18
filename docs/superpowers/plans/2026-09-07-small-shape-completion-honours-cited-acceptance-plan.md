---
status: active
title: Small-shape completion honours cited acceptance — fix plan
backlog_item: BI-05F8860A
design: docs/superpowers/specs/2026-09-07-small-shape-completion-honours-cited-acceptance-design.md
---

# Small-shape completion honours cited acceptance — fix plan

- **Backlog item:** `BI-05F8860A` (fix profile, atomic)
- **Design:** [`2026-09-07-small-shape-completion-honours-cited-acceptance-design.md`](../specs/2026-09-07-small-shape-completion-honours-cited-acceptance-design.md)

## Backlog coverage

- Decision: atomic
- Parent: `BI-05F8860A`
- Receipt: `blocked-by: the coverage receipt is minted against this plan blob once it is on the bound Workroom head; recorded on the next push`
- Rationale: the transition, the recovery packet and the claim window are three
  halves of one contract. Fixing the transition alone still sends authors down
  the objective-mapping escalations; fixing recovery alone still leaves the
  item unclosable; fixing the claim alone still loses evidence the moment an
  author refreshes readiness.
- Dependencies: none

| Key | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- |
| small-shape-completion | OBJ-SMALL-SHAPE-CLOSE-1 | acceptance-evidence-required, record_execution_evidence, reentered | read the bound work shape before computing acceptance; same-owner re-entry on a fresh active claim | AC-1, AC-2, AC-3, AC-4 |

## Fix sequence (all complete)

1. `apps/web/lib/backlog/initiative-readiness/backlog-terminal-transition.ts`: read the bound work shape before computing acceptance; small and break-fix items with cited acceptance evidence pass acceptance and reconciliation.
2. `apps/web/lib/backlog/initiative-readiness/terminal-recovery.ts`: a `delivery-coordinator` acceptance lane returns one `acceptance-evidence-required` escalation that names `record_execution_evidence`.
3. `apps/web/lib/backlog/claim-on-start.ts`: same-owner re-entry on a fresh active claim keeps `claimedAt` and reports `reentered`.
4. Tests: AC-1 and AC-2 in `backlog-terminal-transition.test.ts`, AC-3 in `terminal-recovery.test.ts`, AC-4 in `claim-on-start.test.ts`.

## Verification

Red-then-green: the new assertions fail against `origin/main` source and pass with the fix. OBJ-SMALL-SHAPE-CLOSE-1 is covered by AC-1, AC-2, AC-3, AC-4.
