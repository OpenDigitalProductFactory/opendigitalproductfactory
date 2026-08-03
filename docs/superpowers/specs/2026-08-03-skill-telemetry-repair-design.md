# Skill Telemetry Repair Design (BI-901A567C)

## Problem
In the last 30 days, `SkillUsageEvent` records only hit the `eligible` stage and never transition to `invoked`, `completed`, or `failed`. Consequently, `SkillMetric` aggregates are empty, and `ToolExecution` rows lack attribution to the active skill, crippling the marketplace effectiveness loop.

## Solution
1. **Invocation**: When a skill's tools are called by the agent, emit a `SkillUsageEvent` with stage=`invoked`.
2. **Completion/Failure**: When the agentic turn concludes successfully with an active skill, emit stage=`completed`. If it fails/aborts, emit `failed`.
3. **Attribution**: Pass the `skillId` to the execution context so that `ToolExecution` records capture the active skill.
4. **Metrics Rollup**: Verify `SkillMetric` captures duration, success, tokens/cost, and retries based on the repaired event path.
5. **No Parallel Tables**: Continue using existing `SkillUsageEvent`, `SkillMetric`, `TaskRun`, `ToolExecution`, and `CoworkerTurnMetric`.

## Acceptance Criteria
- Interactive/autonomous paths record eligible, invoked, and terminal stages exactly once with correlation IDs.
- Tool executions attribute to selected skill/work-pattern without leaking prompt content.
- Metrics roll up properly.
- Abandoned/failed runs remain terminal and auditable.
- Dashboards/queries reconcile source events to aggregates.
