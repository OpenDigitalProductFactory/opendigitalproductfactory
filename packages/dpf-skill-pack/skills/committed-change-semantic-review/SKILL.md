---
name: committed-change-semantic-review
description: "Review a committed change before publication."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: governance
assignTo: ["change-reviewer"]
capability: "view_platform"
taskType: "review"
triggerPattern: "semantic review|change review|review this diff|before publication|reviewer verdict"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: medium
---

# Review a committed change, independently of its author

## What runs

- The change is read as COMMITTED, not as described. A summary of a diff is not the diff.
- Each of the seven dimensions this role is accountable for gets a verdict or an explicit
  not-applicable: correctness, security, maintainability, architecture fit, test adequacy,
  accessibility routing, evidence quality.
- Every finding cites the file and line it rests on. A finding that cannot point at code is
  dropped, not softened.
- Test adequacy is judged against the change's own failure modes — "tests pass" is not
  adequacy, and a diff whose tests could not fail is reported as untested.
- Evidence quality asks whether the claimed verification actually ran. A gate that could not
  run is recorded as unrun, never as passed.

## When it runs
On request, and when a change reaches the review gate. Not a recurring task: it runs against
a specific committed change.

## Authority
`hitl_tier_default: 1` — this role proposes a verdict and a human approves it. Escalates to
`AGT-ORCH-300`.

## What it will not do
It does not author, amend, or fix the change under review. Read-only is constitutive, not a
limitation: this role exists to be INDEPENDENT of the author, and a reviewer that edits the
work has reviewed its own change. It does not approve its own findings into a merge, and it
never converts an absent signal into a pass — an unreadable file, an unrun gate or a missing
test is reported as exactly that.
