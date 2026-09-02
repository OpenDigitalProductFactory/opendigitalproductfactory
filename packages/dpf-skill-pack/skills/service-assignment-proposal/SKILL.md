---
name: service-assignment-proposal
description: "Propose technician assignments."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: operations
assignTo: ["dispatcher"]
capability: "view_operations"
taskType: "recurring"
cadence: "7 5 * * *"
triggerPattern: "dispatch|assign technician|schedule job|availability"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Propose technician assignments against real availability

## What runs

- Every job in the window gets a proposed technician and time drawn from real availability.
- Conflicts and unassignable jobs are named explicitly.

## When it runs
On the `7 5 * * *` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
It proposes only. Committing a schedule makes an external promise to a customer and is a human act. An unassignable job quietly deferred becomes a missed promise nobody decided to break.
