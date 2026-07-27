# PR delivery post-mortem routine

Use this routine after a long, costly, or repeatedly red PR iteration. The goal
is to convert delivery-loop waste into a platform improvement, not to retell the
whole PR.

## Trigger

Run the routine when any of these are true:

- Local-CI or PR checks consumed a full expensive run that did not produce
  usable evidence.
- A platform state such as quiescence, sandbox drift, stale lease contention, or
  main freshness invalidated otherwise-good work.
- Agents had to scrape noisy truncated logs to identify the next action.
- The PR required three or more mechanical iterations after the code change was
  already understood.

## Capture

Record the case study with these fields:

- PR number and head SHA.
- Local-CI lease id, evidence id, or pending evidence file.
- Quiescence status from `get_quiescence_status`, including `level`, `runId`,
  `trigger`, `retryAfterSeconds`, and drain blockers.
- The compact `failureSummary` from local-CI evidence before quoting raw logs.
- Whether the impacted-test question belongs to BI-A4EC0EA6 rather than this
  PR's ad hoc analysis.
- The wasted loop: what was rerun, why it was avoidable, and the cheapest
  platform signal that would have prevented it.

## Route Learnings

Create or update backlog/docs/commons in this order:

1. Backlog: file the smallest platform improvement with a concrete acceptance
   test. Link the PR and evidence ids.
2. Docs/runbooks: update the operator or agent routine that would have changed
   the next agent's first action.
3. Commons: if the lesson changes standing agent doctrine, update the relevant
   founder-kernel principle, AGENTS.md rule, or skill instruction.
4. Tests: add a contract test for the failure mode before editing the substrate.

## PR #3480 Reference Pattern

PR #3480 is the post-mortem case study for BI-C22152E7. It showed that:

- A self-upgrade drain can refuse MCP evidence writes after local-CI already
  passed.
- The lease cleanup path must remain available during quiescence.
- A passed gate with pending evidence needs finalize-only recovery, not a full
  rerun.
- Failure evidence must carry compact summaries so agents do not burn context on
  truncated log tails.
- Code graph impacted-test recommendations are owned by BI-A4EC0EA6; local-CI
  should point there instead of duplicating the recommender.
