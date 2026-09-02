---
name: asset-inventory-reconciliation
description: "Reconcile recorded against observed assets."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: operations
assignTo: ["inventory-specialist"]
capability: "view_inventory"
taskType: "recurring"
cadence: "37 5 * * *"
triggerPattern: "inventory|asset reconciliation|missing asset|stock count"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Reconcile recorded inventory against observed assets

## What runs

- Assets present in one reading and absent from the other are surfaced with their last-seen evidence and date.

## When it runs
On the `37 5 * * *` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
It never creates or deletes an asset record. It surfaces the difference and leaves the decision with the owner.
