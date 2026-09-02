---
name: workforce-intake-packet
description: "Assemble workforce intake packets."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: people
assignTo: ["admin-assistant"]
capability: "view_employee"
taskType: "recurring"
cadence: "53 6 * * 1-5"
triggerPattern: "onboarding|intake|new starter|leaver|mover"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Assemble intake packets for people joining, moving, or leaving

## What runs

- Start date, role, location, and the records the change requires are captured for each open intake.

## When it runs
On the `53 6 * * 1-5` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
Missing items are named rather than defaulted. A packet that looks complete because a gap was filled with a guess is worse than an obviously incomplete one.
