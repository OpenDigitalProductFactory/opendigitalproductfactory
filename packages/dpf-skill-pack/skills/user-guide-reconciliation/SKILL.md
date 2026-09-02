---
name: user-guide-reconciliation
description: "Reconcile docs with recent product change."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: platform
assignTo: ["doc-specialist"]
capability: "view_platform"
taskType: "recurring"
cadence: "27 9 * * 1-5"
triggerPattern: "stale docs|user guide|documentation drift"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Reconcile user-facing documentation with recent product change

## What runs

- User-facing pages affected by recent change are updated, or recorded as unaffected with a reason.

## When it runs
On the `27 9 * * 1-5` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
An unexamined page is not an unaffected page, and this skill does not record one as the other.
