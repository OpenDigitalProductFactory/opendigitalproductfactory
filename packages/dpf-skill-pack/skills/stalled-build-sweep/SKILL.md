---
name: stalled-build-sweep
description: "Name the builds that stopped moving."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: build
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "recurring"
cadence: "31 6 * * 1"
triggerPattern: "stalled build|build not moving|what is blocked|pipeline stall"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Name the builds that have stopped moving

## What runs

- Builds in flight are read with the phase each sits in.
- A build that has not advanced is named with its phase, how long it has been there,
  and the specific thing it waits on.
- "Waiting on a human" is separated from "waiting on nothing" — only the second is a
  defect; a build waiting on a named person is working as designed.
- A build that could not be read is reported UNREAD, never as moving.

## When it runs
On the `31 6 * * 1` cadence at Balanced proactivity, and more often at Assertive. The
schedule is declared here as well as in the self-task registry so the coworker's
own definition says when it runs; `check-self-task-cadence-parity` keeps the two
equal.

This role's acumen room shape declares `cadence: "standing"` with
`standingShape: "craft-stewardship"` — this skill is what that declaration
actually does.

## What it will not do
Nothing is abandoned, advanced or approved. The stall IS the finding, and clearing it
belongs to whoever owns the phase. An empty read is never reported as a healthy
pipeline — that is the one way this sweep could do harm.
