---
name: leave-policy-practice-check
description: "Check leave policy against practice."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep

# DPF fields (Surface B — in-portal seed loader)
category: compliance
assignTo: ["time-off-advisor"]
capability: "view_compliance"
taskType: "recurring"
cadence: "21 4 * * 1"
triggerPattern: "time off policy|leave policy|pto rules|leave practice"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Check the written leave policy against practice

## What runs

- The published policy and the leave practice actually in force are both read.
- Each divergence is named with the clause and the practice that contradicts it.
- Where none is found, that is recorded — silence is not a finding.
- The jurisdictional constraint is cited wherever one applies.

## When it runs
On the `21 4 * * 1` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list. `check-self-task-cadence-parity` keeps the two equal.

## What it will not do
Nothing is published; this drafts and a human publishes. If the applicable jurisdiction
cannot be established the run stops and says so — drafting leave rules against the
wrong statute is worse than drafting none.
