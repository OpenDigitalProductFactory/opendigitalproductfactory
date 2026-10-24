---
name: seasonal-operations-read
description: "File what the season needs attention on."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep

# DPF fields (Surface B — in-portal seed loader)
category: operations
assignTo: ["farm-ranch-steward"]
capability: "view_operations"
taskType: "recurring"
cadence: "43 4 * * 1"
triggerPattern: "season|planting|herd|field operations|seasonal attention"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Read the season and file what needs attention

## What runs

- The current season's state is read against what the operation planned for it.
- What needs attention now is filed with the window it has to happen in.
- A reading that cannot be taken is reported as missing, not inferred from the calendar.

## When it runs
On the `43 4 * * 1` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list. `check-self-task-cadence-parity` keeps the two equal.

## What it will not do
No operational action is taken and nothing is scheduled on the operator's behalf. A
seasonal window that has already closed is reported as missed rather than quietly dropped.
