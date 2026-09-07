---
name: cross-cutting-finance-position-read
description: "Report the recorded money position."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: operations
assignTo: ["finance-agent"]
capability: "view_operations"
taskType: "recurring"
cadence: "19 8 * * *"
triggerPattern: "burn|runway|revenue|money position|financial state"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Report the recorded money position

## What runs

- Recorded invoices, bills, expenses and balances are read and reported with the window they cover.

## When it runs
On the `19 8 * * *` cadence at Balanced proactivity, and more often at Assertive.

## What it will not do
It records nothing and invents nothing. An unmeasurable figure is reported as unknown with the record that would resolve it, never as zero.
