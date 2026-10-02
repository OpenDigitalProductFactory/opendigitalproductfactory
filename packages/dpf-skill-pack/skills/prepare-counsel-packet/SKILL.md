---
name: prepare-counsel-packet
description: "Prepare a counsel-ready review packet."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep

# DPF fields (Surface B — in-portal seed loader)
category: compliance
assignTo: ["legal-operations-counsel"]
capability: "view_compliance"
taskType: "on-demand"
triggerPattern: "counsel packet|contract review|clause risk|legal questions|terms review"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: high
---

# Prepare a counsel-ready packet from contract or terms

## What runs

- The facts are separated from the reading of them: what the document SAYS, quoted
  by clause, before any characterisation of what it means.
- Each issue is listed with the clause it arises from and why it matters to this
  business context.
- The QUESTIONS for counsel are written out — the packet's purpose is to make a
  lawyer's hour productive, not to replace it.
- Risk notes are ranked, and anything resting on an unread document is marked.

## When it runs
On request, and when the `svc-legal-counsel-packet` coworker service is invoked. It is NOT a
recurring task: it runs against a specific inbound case, so it has no cadence.

## The contract it backs
This skill is the backing skill for `svc-legal-counsel-packet`, which declares its inputs and
outputs. It takes the contract or terms, plus the business context and produces a counsel packet and an issue list. The service's authority boundary is
`proposal-only`, and the "will not do" below is that boundary, not a style note.

## What it will not do
No legal advice is given and no position is taken. This is proposal-only: it
prepares, counsel decides. A clause that cannot be located or read is listed as
unread rather than summarised from the surrounding text, because a confident
paraphrase of a clause nobody read is the worst possible output here.
