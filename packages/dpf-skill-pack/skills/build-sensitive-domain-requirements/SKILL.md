---
name: build-sensitive-domain-requirements
description: "Bound sensitive-domain build requirements."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: architecture
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "on-demand"
triggerPattern: "regulated build|sensitive domain|paid provider|requirements packet|specialist routing"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: high
---

# Bound a sensitive-domain build and route it to the right specialist

## What runs

- The brief, design doc or plan is read for the axes that make a build sensitive:
  regulated subject matter, a paid or external provider, personal or financial data.
- Each axis found is stated with the text that establishes it. An axis nobody can
  point to in the input is not asserted.
- The requirements are BOUNDED: what must be true before this build proceeds, and
  explicitly what this packet does not cover.
- The build is routed to the specialist who owns the strictest axis found.

## When it runs
On request, and when the `svc-build-sensitive-requirements` coworker service is invoked. It is NOT a
recurring task: it runs against a specific inbound case, so it has no cadence.

## The contract it backs
This skill is the backing skill for `svc-build-sensitive-requirements`, which declares its inputs and
outputs. It takes a build brief, design doc or build plan and produces a bounded requirements packet and a specialist routing. The service's authority boundary is
`requirements-gate`, and the "will not do" below is that boundary, not a style note.

## What it will not do
This is a requirements GATE, so it does not clear the build. Where an axis is
present but its requirements cannot be established, that is reported as unresolved
and the build does not proceed on silence. Routing to no specialist because the
input was unreadable is never recorded as "no sensitivity found".
