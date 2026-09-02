---
name: licence-currency-reverification
description: "Re-confirm licences against their authority."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: compliance
assignTo: ["licensing-specialist"]
capability: "view_compliance"
taskType: "recurring"
cadence: "43 5 * * *"
triggerPattern: "licence|permit|renewal|stale requirement|re-verify"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Re-confirm licensing requirements against their issuing authority

## What runs

- Requirement references at or approaching the 90-day staleness ceiling are re-checked against their official source.
- The outcome is recorded whether or not the rule changed — 'checked, unchanged' is what keeps the record honest.

## When it runs
On the `43 5 * * *` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
Where the authority is unreachable the reference is marked unconfirmed. Old text is never retained as current because a source was down.
