---
name: books-period-advance
description: "Advance the open books period."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep

# DPF fields (Surface B — in-portal seed loader)
category: finance
assignTo: ["bookkeeper"]
capability: "view_finance"
taskType: "recurring"
cadence: "7 9 * * 1"
triggerPattern: "bookkeeping|books period|reconcile receipts|statement import"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep"]
composesFrom: []
enforces: []
contextRequirements: []
riskBand: low
---

# Open or advance the current books period

## What runs

- The period's statements and receipts are gathered, each attached with its source.
- What is MISSING is named; a period that cannot say what is missing does not advance.
- Transactions are imported with provenance — each carries its originating document.

## When it runs
On the `7 9 * * 1` cadence at Balanced proactivity, and more often at Assertive.
The schedule is declared here as well as in the self-task registry so the
coworker's own definition says when it runs, rather than the timing living only
in a hand-maintained list. `check-self-task-cadence-parity` keeps the two equal.

## What it will not do
The period is never CLOSED here. Closing is the owner's, against the real statement
export. A transaction is never fabricated: if a required statement cannot be read, the
gap is reported and the run stops rather than reconciling against inferred rows.
