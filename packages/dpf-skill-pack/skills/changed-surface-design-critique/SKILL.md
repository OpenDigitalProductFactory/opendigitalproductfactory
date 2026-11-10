---
name: changed-surface-design-critique
description: "Critique the surfaces that changed."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: design
assignTo: ["ux-design-critic"]
capability: "view_platform"
taskType: "recurring"
cadence: "29 5 * * 1-5"
triggerPattern: "design critique|ux review|surface changed|heuristic review"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Critique the surfaces that changed

## What runs

- The screens under review are captured and identified by route.
- Each finding cites the corpus principle it rests on.
- The list stops at 30 findings and escalates rather than growing past reading length.

## When it runs
On the `29 5 * * 1-5` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list. `check-self-task-cadence-parity` keeps the two equal.

## What it will not do
A finding that cannot be cited is DROPPED, not softened — an uncited critique is the
failure this role was scoped around. Nothing is filed and nothing is blocked; a human
decides which findings are real. If the surface cannot be rendered or the corpus
cannot be read, that is reported and the run stops. Critiquing from memory is the one
thing this role must never do.
