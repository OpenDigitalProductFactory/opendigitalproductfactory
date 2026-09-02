---
name: role-credential-readiness
description: "Flag credentials a role legally requires."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: people
assignTo: ["hr-specialist"]
capability: "view_employee"
taskType: "recurring"
cadence: "59 6 * * 1-5"
triggerPattern: "credential|licence required|employment record|onboarding readiness"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Prepare employment records and flag legally required credentials

## What runs

- Employment records and onboarding curriculum are prepared for each open intake.
- Credentials the role legally requires are identified and any absent or unverifiable one is flagged as blocking.

## When it runs
On the `59 6 * * 1-5` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
It never grants access. Admission is a human act, and a complete packet is not evidence that a required licence is held.
