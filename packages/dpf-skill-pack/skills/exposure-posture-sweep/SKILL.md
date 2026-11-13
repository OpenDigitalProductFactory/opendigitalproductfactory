---
name: exposure-posture-sweep
description: "Re-read what changed in exposure."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: governance
assignTo: ["security-engineer"]
capability: "view_platform"
taskType: "recurring"
cadence: "33 6 * * 1"
triggerPattern: "exposure posture|what changed exposure|reachable surface|periodic security read"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: high
---

# Re-read the exposure posture

## What runs

- What is reachable from outside, and from which trust boundary, is re-read.
- What CHANGED since the last sweep is named: a newly exposed surface, a dependency
  that moved, a grant that widened. No change is itself a finding and is stated.
- Ranking is by exposure on THIS install, never by a scanner's severity for a CVE in
  the abstract — severity belongs to the vulnerability, exposure belongs to us.
- A component that could not be read is UNASSESSED, never clean.

## When it runs
On the `33 6 * * 1` cadence at Balanced proactivity, and more often at Assertive. The
schedule is declared here as well as in the self-task registry so the coworker's
own definition says when it runs; `check-self-task-cadence-parity` keeps the two
equal.

This role's acumen room shape declares `cadence: "standing"` with
`standingShape: "craft-stewardship"` — this skill is what that declaration
actually does.

## What it will not do
Nothing is remediated — no patch, rotation, revocation or reconfiguration. At this risk
band the proposal rail is the whole point, and a sweep that quietly fixed things would
be worse than no sweep. This is the STANDING counterpart to
`exposure-and-supply-chain-triage`, which handles one specific case on request; this one
only asks what moved.
