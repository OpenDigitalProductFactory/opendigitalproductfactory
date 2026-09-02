---
name: estate-divergence-classification
description: "Classify estate divergences with evidence."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: platform
assignTo: ["data-architect"]
capability: "view_platform"
taskType: "recurring"
cadence: "31 5 * * *"
triggerPattern: "divergence|schema drift|classify drift|record defect"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Classify each estate divergence as record defect, observation defect, or real change

## What runs

- Every open divergence is classified with the evidence for the classification.
- Where schema is implicated, the specific model and field are named, not just the table.

## When it runs
On the `31 5 * * *` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
A classification without evidence is a guess wearing a category, and this skill does not produce one.
