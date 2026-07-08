# Coworker goal / stop-condition primitive — plan (BI-D6F6A313)

- **Date:** 2026-07-08
- **Epic:** EP-CLAUDE-INSIDE-OUT (harness-parity Cluster 1, matrix row #11)
- **BI:** BI-D6F6A313
- **Kernel altitude ledger:** DI-D1C96829E6BD (deliver-tractable-block-rest)

## Problem

The Claude harness `/goal` attaches a natural-language completion condition to a
task and blocks *stopping* until that condition verifiably holds, re-invoking the
agent each turn. DPF coworkers have no equivalent: an autonomous run self-declares
"done" with only the inline-review deliberation pass (`coworker-inline-review.ts`)
approximating a check. There is no persisted, judged completion condition.

## Approach (substrate-first)

Reuse the existing judge seam (`routeAndCall`, the same bounded capable-model call
the inline-review pass uses with no `agentId`, so it cannot recurse into a
coworker's posture). Add the smallest primitive that is genuinely functional, not
a dormant table.

### Slice 1 (this PR)

1. **Schema** — `CoworkerTaskGoal` (agentId FK→Agent, condition, status
   active|met|unmet|abandoned, optional scheduledTaskId link, verdictRationale,
   lastEvaluatedAt, resolvedAt). Additive migration, data-safe.
2. **Core** — `lib/tak/coworker-task-goal.ts`:
   - Pure: `buildGoalJudgePrompt`, `interpretGoalVerdict` (defaults UNMET on an
     ambiguous/missing verdict so an unfinished goal never passes),
     `classifyGoalStatus`.
   - IO: `createCoworkerGoal`, `listActiveGoals`, `evaluateCoworkerGoal`
     (fail-closed — the goal stays unmet if the judge throws; `judge` injectable
     for tests).
3. **MCP door** — `coworker-goal-pack.ts`, self-scoped to the calling coworker
   (mirrors `coworker-memory` — ungated, resolves target from `context.agentId`,
   ignores caller-supplied agent): `set_task_goal`, `list_task_goals`,
   `evaluate_task_goal`.
4. **Tests** — pure verdict/classifier/prompt + core create/evaluate
   (met stamps resolvedAt; unmet does not; judge-throw fails closed; unknown goal
   not-found) + pack self-scope.

### Slice 2 (follow-up BI, not this PR)

Wire the autonomous completion seam (`autonomous-work-run.ts`, beside the
deliberation pass + reflection trigger — additive, fail-open, void) to
auto-evaluate a run's active goal against its output and gate re-dispatch of the
linked `ScheduledAgentTask` (met → resolve/deactivate; unmet → leave active so the
existing cron re-fires, bounded by existing attempt caps). Deferred because it
touches the shared run seam and the scheduler dispatch path — its own reviewable
slice, same discipline as the working-memory BI's prompt-injection Slice 2.

## Safety

- No change to the hot agentic loop or any authorization read path.
- Judge call is bounded, single, no `agentId` (no posture recursion).
- Fail-closed evaluation: a goal is only `met` on an explicit MET verdict.
- Self-scoped door: a coworker can only touch its own goals.
