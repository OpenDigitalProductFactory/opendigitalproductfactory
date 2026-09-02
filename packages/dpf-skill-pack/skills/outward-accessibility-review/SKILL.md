---
name: outward-accessibility-review
description: "Review outward surfaces for accessibility."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: platform
assignTo: ["ux-accessibility-agent"]
capability: "view_platform"
taskType: "recurring"
cadence: "33 10 * * 1-5"
triggerPattern: "accessibility|contrast|alt text|screen reader|a11y"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Review outward surfaces for accessibility before publication

## What runs

- Text alternatives, contrast, and semantic structure are checked on surfaces queued for publication.
- Each failure is reported with a specific, actionable fix.

## When it runs
On the `33 10 * * 1-5` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
Failures are blocking, never advisory. An accessibility failure downgraded to a suggestion is an accessibility failure that ships.
