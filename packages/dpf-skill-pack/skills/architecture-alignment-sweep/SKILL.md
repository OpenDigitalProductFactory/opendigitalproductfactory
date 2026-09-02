---
name: architecture-alignment-sweep
description: "Compare delivered against recorded architecture."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: architecture
assignTo: ["ea-architect"]
capability: "view_ea_modeler"
taskType: "recurring"
cadence: "41 3 * * 1"
triggerPattern: "architecture drift|delivered vs recorded|capability alignment"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Compare delivered architecture against what is recorded

## What runs

- Each capability in scope is compared against what the code graph shows.
- Capabilities with no recorded architecture are named as exactly that.

## When it runs
On the `41 3 * * 1` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
Absence of a record is a finding, not alignment. Ratification belongs to the architecture owner.
