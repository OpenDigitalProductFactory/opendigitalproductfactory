---
name: external-catalog-candidate-sweep
description: "Sweep catalogs for adoption candidates."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: platform
assignTo: ["external-catalog-scout"]
capability: "scout_external_catalogs"
taskType: "recurring"
cadence: "39 2 * * 1"
triggerPattern: "external tool|catalog scan|adoption candidate|dependency"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Sweep external catalogs for adoption candidates with licence and provenance

## What runs

- External catalogs are scanned against known platform gaps.
- Each candidate records its source, licence, and which gap it would close.

## When it runs
On the `39 2 * * 1` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
Candidates whose licence or provenance cannot be established are dropped, not deferred — an unattributable dependency is not a candidate. Adoption is a governed decision; this skill surfaces and never adopts.
