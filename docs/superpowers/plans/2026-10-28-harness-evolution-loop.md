---
status: draft
---

# Harness evolution loop implementation plan

- **Backlog item:** BI-49BC21C1 (epic EP-C00F61F4)
- **Workroom:** WC-0FFA96A5
- **Design:** [Harness evolution loop](../specs/2026-10-28-harness-evolution-loop-design.md), Slice 6 of the [Governed Hermes learning loop](../specs/2026-05-15-governed-hermes-learning-loop-design.md)
- **Decision:** four independently shippable slices; this plan delivers slice 1 and names the rest.

## Slice 1 — typed job and ranked queue (AC-1 – AC-4)

| Step | File | Test |
| --- | --- | --- |
| Pure ranking, budget clamp, seed-queue parse | `apps/web/lib/harness-evolution/rank-candidates.ts` | `rank-candidates.test.ts` |
| Executor: one TaskRun per UTC day, candidates artifact, task/job status | `apps/web/lib/harness-evolution/harness-evolution-task.ts` | `harness-evolution-task.test.ts` |
| Kind `harness-evolution-loop` | `apps/web/lib/operate/scheduled-jobs/agent-task-kind.ts` | `agent-task-kind.test.ts` |
| Deterministic dispatch | `apps/web/lib/actions/agent-task-scheduler-deterministic.ts` | `agent-task-scheduler-deterministic.test.ts` |
| Config + seed, wired into `seed.ts` | `packages/db/src/harness-evolution-loop-config.ts`, `seed-harness-evolution-loop.ts` | `seed-harness-evolution-loop.test.ts`, `seed-task-owner-preserved.test.ts` |

No schema change and no migration. Verification after deploy: the task row
`harness-evolution-loop-daily` exists, its first tick ends `lastStatus = ok`,
and a TaskRun with `repeatedPatternKey = harness-evolution:<day>` carries
`progressPayload.budget` and `progressPayload.spend`.

## Later slices (children of BI-49BC21C1)

- **Slice 2 (AC-5, AC-6).** Bounded editor plus a harness-text variant kind
  for the WorkPattern experiment runtime, keyed on `promptOrSkillDigest`;
  hermetic baseline-versus-candidate replay; spend charged to the run's caps.
- **Slice 3 (AC-7, AC-8).** Compose ADOPT edits into one seed PR; write
  EXPERIENCE records to `work-pattern-effective-ledger.ts`; the ranking reads
  them.
- **Slice 4 (AC-9).** Weekly before/after recurrence rollup.
