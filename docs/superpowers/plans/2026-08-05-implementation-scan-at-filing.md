# Implementation scan at filing time — implementation plan

> **BI-1A1EC5EC**, epic `EP-CODE-GRAPH`. Extends the work-intake unification
> spec ([2026-06-06](../specs/2026-06-06-work-intake-unification-design.md),
> EP-INTAKE-UNIFY), which established the shared ingest front door this hooks into.

## The gap

The platform detects that a new BI duplicates **another BI**
(`apps/web/lib/demand/dedup.ts`, trigram Dice over backlog text) and has dozens of
gates comparing **code to code**. Nothing compared a proposed BI to **the code that
already exists**.

**Live case, 2026-08-05.** BI-3E5969DF was filed to "detect semantic doc staleness".
`scripts/build-docs-staleness.mjs` — a working detector with a weekly refresh
workflow — had existed for weeks. The filing session ran `query_backlog` per epic,
`search_portfolio_context` on the topic, and an epic sweep. All came back clean,
because **all of them search backlog rows and products, not source.**

The kernel principle `verify-substrate-before-proposing-new` already requires
"grep the codebase **and** query the live backlog." The rule was not missing — it
was unenforced, and a half-done check produced a report indistinguishable from a
complete one. Same shape as `gate-coverage-matches-blast-radius`, one level up.

## Why filenames, not semantics

The heuristic that would have caught it is `ls scripts/*stale*`. **Implementations
are named literally** (`build-docs-staleness.mjs`); **backlog items are named
conceptually** ("detect semantic doc staleness"). Embedding and trigram search both
operate on the concept side and are weakest at exactly this crossing.

This also makes the scan **independent of the code-graph index**. BI-1A3CC151 is
open: the index is built off a behind-main branch and is missing files. A check on a
stale index yields **false negatives** — worse than no check, because it
manufactures confidence in the very place confidence already failed. A walk of the
working tree cannot be stale. **That is how this ships without waiting on
BI-1A3CC151.**

## Shape

| File | Role | Touches disk? |
| ---- | ---- | ------------- |
| `apps/web/lib/operate/implementation-scan.ts` | pure scorer: title + file list → ranked candidates | no |
| `apps/web/lib/operate/repo-file-inventory.ts` | the working-tree walk | yes |
| `apps/web/lib/operate/backlog-ingest.ts` | calls the scan after create, records an activity row | via injected dep |
| `apps/web/lib/mcp/packs/backlog-pack.ts` | appends the advisory to the filer's message | no |
| `scripts/measure-implementation-scan.mts` | replay harness for tuning | yes |

Three precision guards, each earned rather than assumed:

1. **Build intent only.** A bug report's subject exists by definition — telling a
   timesheet bug that timesheet code exists is pure noise.
2. **Two salient terms minimum** in the title.
3. **Two matched terms minimum** per candidate. One term finds the *topic*, not the
   *thing*.

## Measured, then tuned

Replayed 16 real backlog titles against the real tree
(`npx tsx scripts/measure-implementation-scan.mts --titles titles.json`).

**First run: fired on 6/16 (37.5%)**, and the output exposed two defects that
review had not:

- `harness` stemmed to `har` — a fragment that then matched `hardware`/`harbor`.
  The `-ness` rule now requires the remainder to still look like a word.
- "Create a payroll remittance reconciliation ledger" returned five unrelated files
  matched on `ledger` **alone**. Single-term hits were the entire false-positive
  population, hence guard 3.

**After tuning: fired on 5/16 (31.3%)**, and all five firings are defensible:

| Title | Top hit |
| ----- | ------- |
| Detect semantic doc staleness | `scripts/build-docs-staleness.mjs` ← **the case** |
| Project doc↔code edges into the graph mirror | `packages/db/src/doc-impact-graph-sync.ts` |
| Add JSDoc to self-upgrade/completion.ts | `apps/web/lib/self-upgrade/completion.ts` |
| Surface code graph freshness | `apps/web/lib/integrate/code-graph-refresh.ts` |
| Add benchmark harness governance | `apps/web/lib/routing/activity-harness-governance.ts` |

All four bug-report titles stayed silent, as did the payroll case.

## Advisory, deliberately

The scan **ranks and returns; it never blocks.** The item is created either way, a
scan failure is swallowed, and an install with no source checkout files normally.

**Mandatory dismissal is deliberately not shipped.** At a 31% fire rate that would
be a control people learn to click through — the noise failure the BI-3E5969DF
spike recommended against, repeated one level up. The advisory wording asks
("confirm this is not already built") rather than asserting a duplicate, because
the heuristic is crude enough that asserting would train filers to ignore it.

The advisory is recorded as a `BacklogItemActivity` row as well as returned in the
tool message, because the failure being fixed **is a check whose output vanished
when the call returned.**

## Verification

- 22 scanner tests (pure — no filesystem, database, or index).
- 30 ingest tests, including 5 new integration tests: advisory recorded, item still
  filed, empty inventory tolerated, scan failure swallowed, no row when silent.
- 1,095 tests green across `lib/mcp/packs` and `lib/operate`.
- `tsc --noEmit`: zero errors in the new files.

Two pre-existing failures in `lib/operate/issue-report-triage.test.ts` and
`process-observer-triage.test.ts` (`Cannot find package 'react'`) reproduce on a
clean stashed tree — a source-only worktree artifact, not this change.

## Follow-on

Re-run the replay after a few weeks of real filings. If the fire rate holds near
30% **and** the useful-hit share stays high, mandatory dismissal becomes arguable.
If it drifts up, tune before requiring anything.
