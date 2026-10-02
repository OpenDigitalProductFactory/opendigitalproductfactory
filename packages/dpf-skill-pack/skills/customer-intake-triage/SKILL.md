---
name: customer-intake-triage
description: "Triage an inbound customer request."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep

# DPF fields (Surface B — in-portal seed loader)
category: customer
assignTo: ["customer-advisor"]
capability: "view_customer"
taskType: "on-demand"
triggerPattern: "customer inquiry|quote request|support request|service request|intake triage"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: medium
---

# Triage an inbound customer request

## What runs

- The request is classified by what the customer actually asked for — inquiry,
  quote, support, or service request — not by which team it would be easiest to send it to.
- The account context is read before qualifying: an existing customer's history
  changes what the same sentence means.
- A qualified request carries what is needed to act on it, and names what is still missing.
- Anything time-sensitive, contractual or unhappy is ESCALATED rather than qualified.

## When it runs
On request, and when the `svc-customer-sales-intake` coworker service is invoked. It is NOT a
recurring task: it runs against a specific inbound case, so it has no cadence.

## The contract it backs
This skill is the backing skill for `svc-customer-sales-intake`, which declares its inputs and
outputs. It takes the customer's intent and the account context and produces a qualified request or an escalation. The service's authority boundary is
`proposal-only`, and the "will not do" below is that boundary, not a style note.

## What it will not do
Nothing is promised to the customer: no price, no date, no commitment. This is
proposal-only. An ambiguous request is escalated rather than guessed into a
category, because a misrouted customer waits twice.
