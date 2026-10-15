---
name: burn-revenue-runway-read
description: "Report burn, revenue and runway."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep

# DPF fields (Surface B — in-portal seed loader)
category: operations
assignTo: ["finance-controller"]
capability: "view_finance"
taskType: "recurring"
cadence: "23 13 * * 3"
triggerPattern: "burn|runway|revenue position|how long do we have"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Review burn, revenue, and runway

## What runs

- The recorded finance state is reviewed: paid invoices, bills, expenses, balances, commitments.
- Monthly burn and revenue are reported ONLY where measurable from recorded data, naming the window they cover.
- What is UNKNOWN is stated with exactly what to record to make it known.

## When it runs
On the `23 13 * * 3` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list. `check-self-task-cadence-parity` keeps the two equal.

## What it will not do
A number is never estimated into existence. "No supplier bills are recorded, so burn is
unknown" is the correct output when that is the case, and is more useful than a figure
the records do not support. This is the owner-facing read of burn and runway; the
recorded money position itself belongs to `cross-cutting-finance-position-read`.
