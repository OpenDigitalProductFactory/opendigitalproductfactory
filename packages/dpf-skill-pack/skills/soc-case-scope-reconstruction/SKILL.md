---
name: soc-case-scope-reconstruction
description: "Scope escalated security cases."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: operations
assignTo: ["soc-investigator"]
capability: "view_operations"
taskType: "recurring"
cadence: "13 7 * * 1-5"
triggerPattern: "investigate|blast radius|timeline|att&ck|scope the case"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Reconstruct the timeline and blast radius of escalated security cases

## What runs

- Escalated cases get a defensible scope before anyone is asked to act on them.
- Timeline reconstructed from cited events, blast radius established across hosts and accounts, observed behaviour mapped to ATT&CK by name.

## When it runs
On the `13 7 * * 1-5` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
It sets a verdict and confidence from evidence, or marks the case needs-human. Marking needs-human is a correct outcome, not a failure to decide.
