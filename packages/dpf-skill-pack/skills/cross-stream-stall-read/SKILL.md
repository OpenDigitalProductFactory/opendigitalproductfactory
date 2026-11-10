---
name: cross-stream-stall-read
description: "Name what is stalled across the streams."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep

# DPF fields (Surface B — in-portal seed loader)
category: operations
assignTo: ["coo"]
capability: "view_portfolio"
taskType: "recurring"
cadence: "47 5 * * 1"
triggerPattern: "what is stalled|cross stream|portfolio stall|where is work stuck"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Read across the streams and name what is stalled

## What runs

- Each value stream is read for work that has stopped moving.
- A stall is named with the item, how long it has been still, and who is accountable.
- A stream that cannot be read is reported as unread, not as quiet.

## When it runs
On the `47 5 * * 1` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list. `check-self-task-cadence-parity` keeps the two equal.

## What it will not do
Nothing is reassigned, reprioritised or closed. Naming the stall is the work; deciding
what to do about it belongs to the accountable owner. An empty read is never reported
as a healthy stream.
