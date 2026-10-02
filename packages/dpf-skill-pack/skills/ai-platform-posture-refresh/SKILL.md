---
name: ai-platform-posture-refresh
description: "Report AI platform and host health."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep

# DPF fields (Surface B — in-portal seed loader)
category: platform
assignTo: ["platform-engineer"]
capability: "view_platform"
taskType: "recurring"
cadence: "19 17 * * 4"
triggerPattern: "ai platform posture|provider health|host resources|disk space|failover"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Refresh AI platform posture and host resource health

## What runs

- The real AI-layer state is reviewed: provider status, model profiles and tiers, token spend, failover chains, agent-to-provider assignments, scheduled jobs.
- Host resource health is reviewed from the available signals: alerts, telemetry, prune jobs, disk/container/filesystem headroom.
- Open critical and warning conditions are named, and the posture is left recorded where the platform surface can show it without anyone asking.

## When it runs
On the `19 17 * * 4` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list. `check-self-task-cadence-parity` keeps the two equal.

## What it will not do
Nothing is restarted, pruned, re-provisioned or failed over. A signal that cannot be read
is reported as unavailable — reporting unread telemetry as healthy is the failure mode
that makes a posture article worse than none.
