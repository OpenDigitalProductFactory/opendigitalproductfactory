---
name: estate-record-vs-observed-sweep
description: "Compare recorded estate against observed."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: platform
assignTo: ["data-steward"]
capability: "view_platform"
taskType: "recurring"
cadence: "29 4 * * *"
triggerPattern: "estate drift|recorded vs observed|data conformance|asset divergence"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Compare the recorded estate against what the platform can observe

## What runs

- Each asset class is read twice — as recorded, and as observed — and every divergence between the two is listed.
- Classes that could not be read on either side are named explicitly.

## When it runs
On the `29 4 * * *` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
It never reconciles the record to the observation. Raising the divergence is the work; the response belongs to the data owner. An unreadable class reported honestly beats a clean diff nobody can stand behind.
