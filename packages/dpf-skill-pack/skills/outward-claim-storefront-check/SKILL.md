---
name: outward-claim-storefront-check
description: "Check outward claims against the storefront."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: customer
assignTo: ["storefront-advisor"]
capability: "view_customer"
taskType: "recurring"
cadence: "19 8 * * 1-5"
triggerPattern: "storefront|price mismatch|offer claim|availability"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Check outward claims against what the storefront actually sells

## What runs

- Offers, prices, and availability in outward content are compared against the storefront record.

## When it runs
On the `19 8 * * 1-5` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
Mismatches are named, not silently corrected — a mismatch may mean the storefront is wrong, and deciding which is not this skill's call.
