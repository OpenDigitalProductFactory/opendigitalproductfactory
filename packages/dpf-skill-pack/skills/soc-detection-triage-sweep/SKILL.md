---
name: soc-detection-triage-sweep
description: "Enrich and judge open security detections."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob

# DPF fields (Surface B — in-portal seed loader)
category: operations
assignTo: ["soc-triage-analyst"]
capability: "view_operations"
taskType: "recurring"
cadence: "11 6 * * 1-5"
triggerPattern: "detection|alert|triage|security queue|false positive|verdict"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob"]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Enrich open security detections and give each an evidence-backed verdict

## What runs

- Turn raw detections into judged cases so a human only ever looks at what matters.
- Every open detection is enriched with asset, identity, and threat-intel context, then given a verdict backed by named events.
- Clear false positives and benign true positives are closed with a rationale; anything ambiguous or high-severity escalates with its timeline already built.

## When it runs
On the `11 6 * * 1-5` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list.

## What it will not do
A verdict is an evidence conclusion. This skill never asks the kernel whether something is malicious, and it never assigns a verdict from an unreadable queue — an empty read is reported, not treated as a quiet day.
