---
name: codex-surface-claim-report
description: "Report Codex workrooms and their evidence."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: platform
assignTo: ["external-codex"]
capability: "view_platform"
taskType: "recurring"
cadence: "23 4 * * *"
triggerPattern: "codex build|claimed workroom|delivery evidence"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Report claimed workrooms and recorded evidence from the Codex surface

## What runs

- Each claimed workroom is reported with its branch and whether evidence has been recorded.

## When it runs
On the `23 4 * * *` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
Governance approves evidence, not provenance: this surface is held to the same contract as every other, and a stale claim is named rather than held.
