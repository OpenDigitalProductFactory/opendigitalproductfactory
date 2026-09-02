---
name: soc-coverage-gap-hunt
description: "Hunt detection coverage gaps."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: operations
assignTo: ["soc-threat-hunter"]
capability: "view_operations"
taskType: "recurring"
cadence: "23 5 * * 1"
triggerPattern: "hunt|coverage gap|detection rule|ioc sweep|threat hypothesis"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Hunt named detection coverage gaps and propose rule content

## What runs

- Coverage gaps are enumerated — techniques and asset classes with no detection, named rather than characterised.
- A structured hunt runs against the highest-value gap, recording what was looked for and what was found, including when nothing was.

## When it runs
On the `23 5 * * 1` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
Confirmed gaps become proposed rule tunings for an operator to review. It does not activate detection content.
