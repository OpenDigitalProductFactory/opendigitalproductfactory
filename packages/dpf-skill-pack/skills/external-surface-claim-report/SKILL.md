---
name: external-surface-claim-report
description: "Report claimed workrooms and their evidence."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: platform
assignTo: ["external-claude-code"]
capability: "view_platform"
taskType: "recurring"
cadence: "21 4 * * *"
triggerPattern: "external build|claimed workroom|delivery evidence|stale claim"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Report claimed workrooms and recorded evidence from this delivery surface

## What runs

- Each claimed workroom is reported with its branch and whether evidence has been recorded.

## When it runs
On the `21 4 * * *` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
Stale claims — no branch, no evidence, no heartbeat — are named so the workroom can be reaped rather than silently held.
