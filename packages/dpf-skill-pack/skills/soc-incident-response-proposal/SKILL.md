---
name: soc-incident-response-proposal
description: "Propose incident containment for approval."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: operations
assignTo: ["soc-incident-commander"]
capability: "view_operations"
taskType: "recurring"
cadence: "17 8 * * 1-5"
triggerPattern: "incident|contain|remediate|response plan|escalation"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Advance open incidents and propose containment for customer authorization

## What runs

- Scoped cases move through investigating, contained, resolved, closed — with the timeline reflecting every decision and who made it.
- Containment and remediation options are named, ranked, and drafted as proposals.

## When it runs
On the `17 8 * * 1-5` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
Every response action lands on the customer's Attention Surface and executes on the customer's own runner. This skill proposes; it never executes, and the platform never gains standing execute rights.
