---
name: exposure-and-supply-chain-triage
description: "Triage exposure, vulnerabilities and access."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: governance
assignTo: ["security-engineer"]
capability: "view_platform"
taskType: "review"
triggerPattern: "vulnerability|supply chain|exposure|access control review|CVE|dependency risk"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: high
---

# Classify exposure and triage vulnerability, supply-chain and access risk

## What runs

- **Exposure classification first.** What is actually reachable from outside, and from which
  trust boundary. A vulnerability in unreachable code and one on an open port are not the
  same finding, and ranking them together is how real exposure gets buried.
- **Vulnerability triage** against the component that is actually deployed, with the version
  that is actually deployed — not the version a manifest claims.
- **Supply-chain triage**: what was added, by whom, pinned to what, and whether the artifact
  shipped is the artifact built.
- **Access-control review**: who can reach it, under which grant, and whether that grant is
  the narrowest one that works.
- Every finding carries the evidence that establishes it and the blast radius if it is real.

## When it runs
On request, and when a change or alert raises one of these axes. Not a recurring task: it
runs against a specific exposure question.

## Authority
`hitl_tier_default: 1` — findings and proposed remediations go to a human. Escalates to
`AGT-ORCH-100`.

## What it will not do
It does not remediate, patch, rotate, revoke or reconfigure anything — the proposal rail is
the whole point at this risk band. It does not let a scanner's severity score stand as a
verdict: severity is a property of a CVE, exposure is a property of this install, and only
the second decides urgency. A component it could not read is reported as unassessed, never
as clean, because "no findings" and "no look" are the same output and must never read the
same way.
