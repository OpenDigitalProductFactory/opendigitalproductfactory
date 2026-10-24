---
name: integration-surface-inventory
description: "Inventory the live integration surface."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: platform
assignTo: ["integration-engineer"]
capability: "view_platform"
taskType: "recurring"
cadence: "37 3 * * 1"
triggerPattern: "integration inventory|mcp surface|tool drift|contract drift"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Inventory the live integration surface

## What runs

- The surface is enumerated from the RUNNING registry, never from documentation.
- What is exposed, what is reachable, and what has drifted from its contract are named separately.
- Documentation that disagrees with the running registry is itself reported as a finding.

## When it runs
On the `37 3 * * 1` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list. `check-self-task-cadence-parity` keeps the two equal.

## What it will not do
Nothing is re-registered, re-pointed or disabled. Drift is raised for a human to decide
on. An endpoint that cannot be reached is recorded as unreachable — never assumed healthy.
