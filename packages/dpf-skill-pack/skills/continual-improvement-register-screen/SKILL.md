---
name: continual-improvement-register-screen
description: "Screen the register's recurring misses."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep

# DPF fields (Surface B — in-portal seed loader)
category: platform
assignTo: ["continual-improvement-manager"]
capability: "view_platform"
taskType: "recurring"
cadence: "49 4 * * 1"
triggerPattern: "continual improvement|improvement register|recurring miss|harness edit candidate|dmaic"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Screen the register's recurring misses

## What runs

- The latest `harness-evolution-loop-daily` run's cycle ledger is read, with the improvement items it recorded.
- Each recurring miss is either eligible or skipped with its reason: single run, shape too rare, below the cost floor, outside the Pareto cut, parked after KEEP_BASE, or inside control limits.
- A miss with neither is the finding. The screen is recorded on the continual improvement register room as Define-stage evidence.

The operating criteria are typed configuration in `apps/web/lib/continual-improvement/operating-criteria.ts`. This skill applies them. It does not restate or tune them.

## When it runs

On the `49 4 * * 1` cadence at Balanced proactivity, and twice weekly at Assertive. That is after the daily typed job at 04:17 UTC, so the screen reads a finished run. The schedule is declared here as well as in the self-task registry so the coworker's own definition says when it runs. `check-self-task-cadence-parity` keeps the two equal.

## What it will not do

It never adopts an edit. Adoption is the register's governed `decide` stage (`harness-edit-adoption`) and lands as governed change. It never edits a room's harness from outside the room. If the ledger or the room activity cannot be read, it reports the failed read and stops: a failed read is not a register with no misses.
