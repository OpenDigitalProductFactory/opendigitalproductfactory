---
name: consume-stream-orchestration-sweep
description: "Survey and route the consume value stream."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: operations
assignTo: ["consume-orchestrator"]
capability: "view_operations"
taskType: "recurring"
cadence: "13 7 * * 1-5"
triggerPattern: "consume stream|orchestrate|route work|unowned item"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Survey and route the consume value stream

## What runs

- Every open item in the consume stream is read and either routed to a named specialist or surfaced as unowned.

## When it runs
On the `13 7 * * 1-5` cadence at Balanced proactivity, and more often at Assertive.

## What it will not do
It coordinates and never decides the stream's direction — that is the stream owner's governed decision. An empty survey is reported as unreadable, not as a quiet stream.
