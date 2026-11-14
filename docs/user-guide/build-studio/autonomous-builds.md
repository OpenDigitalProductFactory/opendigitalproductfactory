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

GitHub sometimes has not yet worked out whether a pull request can merge, usually because main
has just moved. Build Studio treats that as a wait, not a failure. It keeps checking, and after six
undecided checks in a row it checks less often, down to once an hour, and tells you once. It
carries on by itself as soon as GitHub decides. A pull request that was stopped for a conflict or
for falling behind main is looked at again every half hour, and Build Studio resumes it once
GitHub no longer reports that problem. The room's activity trail records the resume.

Some repository checks need a stated decision, such as how a change reaches existing installs or
whether it changed the user guide. The coding agent records those decisions on its own commits.
When Build Studio opens the pull request, it copies them into the pull request's **Readiness
decisions** section, so the checks read the same decisions the build's review accepted. It copies
only decisions the build recorded and never writes one itself.

The pull request's commit is not the commit the build was first reviewed on. Build Studio
publishes the change on top of the current main branch, so the published commit is new, and a
republished or repaired pull request gets another new commit. The required Failure Readiness
check only accepts evidence and a review for the exact commit it checks. When a pull request's
commit has no review of its own, Build Studio moves the build onto that exact commit and sends it
back to review. Its checks, tests and semantic review then run on the commit that ships, and
the build returns to the pull request with nothing republished. Each pull request commit gets
at most three attempts, spaced six hours apart; the build's activity trail records each one.
After the pull request is open, Build Studio does not rebase the build onto a newer main. The
merge queue keeps it current.

Autonomy can be disabled without deleting build history, evidence, or the active Living Playbook.
See the [operator runbook](../../operations/autonomous-build-completion.md) for rollout and
kill-switch details.
