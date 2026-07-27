---
title: "Autonomous Build Studio lanes"
area: build-studio
order: 4
---

# Autonomous Build Studio lanes

Build Studio can carry an evidence-cleared, lower-risk change through routine design, build,
review, pull-request, merge-queue, and release steps without asking you to approve each one.
Autonomy is per lane and per checkpoint. It is not a blanket permission.

## What qualifies

Build Studio checks the active Living Playbook, its evidence freshness and scope, the selected AI
provider, current verification evidence, the regulatory ceiling, the change's sensitivity, and
the remaining recovery budget. It checks again before every consequential transition.

High-risk changes, regulatory or authority ceilings, ambiguous feedback, missing evidence, and
exhausted recovery still need a decision. A previously eligible build can therefore pause later
if its evidence or operating conditions change.

## Reading the status

The **What we're building** band carries the current custody state:

- **Build Studio is working** — the lane is eligible and the next routine step is in progress.
- **Build Studio is recovering** — a bounded repair or eligible fallback is in progress.
- **Checking the pull request** — exact-head checks, review threads, or merge-queue state are being
  reconciled.
- **Waiting for governed release** — the change merged, but the running install has not yet proved
  that version is live.
- **Needs your decision** — Build Studio reached an evidence or authority boundary and stopped
  before acting.
- **Build Studio may be stalled** — the autonomous heartbeat is stale; inspect evidence before
  continuing.
- **Live and complete** — the deployed version was verified before the build closed.

Open **Engineer details** only when you need the method version, checkpoint, provider/model, or
evidence blocker. You do not need those identifiers to supervise normal work.

## Recovery and control

Provider capacity, tool-protocol, context, verification, review, CI, queue, and SHA-race failures
have small retry budgets. Build Studio records attempts and resumes after restart. It never
force-pushes a queued branch, directly merges, reopens a human-closed pull request, or bypasses the
governed self-upgrade path.

If recovery is exhausted, you receive one decision request rather than repeated alerts. If a
human closes the pull request, Build Studio honors that closure.

Autonomy can be disabled without deleting build history, evidence, or the active Living Playbook.
See the [operator runbook](../../operations/autonomous-build-completion.md) for rollout and
kill-switch details.
