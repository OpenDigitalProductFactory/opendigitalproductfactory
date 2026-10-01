---
name: provider-cost-intake
description: "Capture a paid provider's cost impact."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep

# DPF fields (Surface B — in-portal seed loader)
category: finance
assignTo: ["finance-controller"]
capability: "view_finance"
taskType: "on-demand"
triggerPattern: "provider cost|subscription|renewal terms|token spend|purchasing intake"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: medium
---

# Capture the cost impact of a paid provider

## What runs

- The cost is recorded against named terms: unit price, the usage it assumes, the
  renewal date and what happens at renewal.
- Expected usage is stated as the figure given AND where it came from. An estimate
  with no source is recorded as unsourced.
- The recommendation says what is being committed to over what period, including
  the cost of NOT renewing where an exit has one.
- Anything the terms do not settle is listed as an open term, not assumed.

## When it runs
On request, and when the `svc-finance-provider-cost-intake` coworker service is invoked. It is NOT a
recurring task: it runs against a specific inbound case, so it has no cadence.

## The contract it backs
This skill is the backing skill for `svc-finance-provider-cost-intake`, which declares its inputs and
outputs. It takes the provider name, expected usage and renewal terms and produces a cost record and an approval recommendation. The service's authority boundary is
`approval-required`, and the "will not do" below is that boundary, not a style note.

## What it will not do
Nothing is purchased, signed or renewed — this is approval-required, so it ends in
a recommendation an owner acts on. A price is never inferred from a public pricing
page when the actual terms were not supplied; that is recorded as an unknown term.
