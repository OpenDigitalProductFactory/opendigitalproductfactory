---
name: marketing-collaboration-intake
description: "Intake a partner or channel collaboration."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep

# DPF fields (Surface B — in-portal seed loader)
category: customer
assignTo: ["marketing-specialist"]
capability: "view_marketing"
taskType: "on-demand"
triggerPattern: "partner campaign|channel collaboration|lead source|co-marketing|consent"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: medium
---

# Intake a partner or channel marketing collaboration

## What runs

- The goal is restated as something measurable, or recorded as unmeasurable as given.
- The audience is described by how it was BUILT — the lead source and the basis on
  which those people can be contacted.
- The CONSENT context is explicit: what permission exists, for which audience, for
  which channel. This is the input most often assumed and least often recorded.
- The approval checklist names each thing a human must confirm before launch.

## When it runs
On request, and when the `svc-marketing-partner-intake` coworker service is invoked. It is NOT a
recurring task: it runs against a specific inbound case, so it has no cadence.

## The contract it backs
This skill is the backing skill for `svc-marketing-partner-intake`, which declares its inputs and
outputs. It takes the campaign goal, the audience and the consent context and produces a campaign brief and an approval checklist. The service's authority boundary is
`proposal-only`, and the "will not do" below is that boundary, not a style note.

## What it will not do
Nothing is launched, sent or published — proposal-only. Where the consent basis for
an audience cannot be established, that is the finding and the brief does not
proceed on the assumption that a list is contactable because it exists.
