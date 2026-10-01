---
name: acquisition-brief-refresh
description: "Keep the acquisition brief current."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep

# DPF fields (Surface B — in-portal seed loader)
category: marketing
assignTo: ["marketing-specialist"]
capability: "view_marketing"
taskType: "recurring"
cadence: "7 14 * * 1"
triggerPattern: "campaign brief|acquisition|icp|positioning refresh"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Refresh the acquisition campaign brief

## What runs

- Saved acquisition assumptions, ICP and positioning are reviewed.
- With no active or recent brief, one is created for the most promising segment: objective, audience, channels, core message, and 3-5 concrete next actions.
- With a recent brief already in place it is REFRESHED, never duplicated.

## When it runs
On the `7 14 * * 1` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list. `check-self-task-cadence-parity` keeps the two equal.

## What it will not do
Nothing is published or sent. A brief is not invented against an unknown segment: where
the assumptions are not recorded, that gap is the output. Duplicating an existing brief
to look productive is the specific failure this cadence guards against.
