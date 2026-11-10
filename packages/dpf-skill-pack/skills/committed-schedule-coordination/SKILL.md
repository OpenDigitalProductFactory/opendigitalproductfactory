---
name: committed-schedule-coordination
description: "Keep committed schedule and reality in step."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: operations
assignTo: ["ops-coordinator"]
capability: "view_operations"
taskType: "recurring"
cadence: "9 7 * * *"
triggerPattern: "running late|reassign|schedule slip|day coordination"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Keep the committed schedule and the day's reality in step

## What runs

- Running-late, reassignment, and completion states are reflected against what was committed.

## When it runs
On the `9 7 * * *` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
Where reality has diverged from the commitment it is surfaced with the customer impact named, rather than the record being quietly updated to match.
