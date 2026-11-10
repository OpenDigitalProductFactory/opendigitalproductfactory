---
name: jurisdiction-layered-requirement-read
description: "Read changed regulations by jurisdiction."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: compliance
assignTo: ["legal-operations-counsel"]
capability: "view_compliance"
taskType: "recurring"
cadence: "47 6 * * *"
triggerPattern: "regulation change|jurisdiction|legal reading|statutory update"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Read changed regulatory requirements by jurisdiction layer

## What runs

- Each changed requirement is read for what changed, in which jurisdiction, and for whom it applies.
- Federal, state or province, and local obligations are treated as distinct layers.

## When it runs
On the `47 6 * * *` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
A conclusion at one layer is not a conclusion at another, and no legal conclusion is asserted beyond what the source supports. Adoption is the compliance owner's decision.
