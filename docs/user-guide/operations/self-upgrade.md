---
title: "Self-Upgrade"
area: operations
order: 2
---

## Use This Doc For

- `/ops/self-upgrade`

## Overview

Self-upgrade upgrades the platform itself. A source-backed install builds from
approved source; a consumer install resolves the verification-gated registry
channel to an immutable release image. Both shapes use the same recovery,
quiescence, health, and rollback lifecycle. This is a higher-consequence
operation than editing backlog work, so it is operator-gated and governed by
deployment windows.

For a consumer install, the page compares the running container's image-config
digest with the verified platform-specific config digest behind the registry
channel. A matching digest means the installed bytes are current. A different
digest exposes the immutable target version and **Upgrade now**. If registry or
running-image identity cannot be verified, the page reports that update status
is unavailable and does not offer or queue an upgrade.

## Workflow

1. Confirm the status card shows a resolved immutable update. If it says current
   or unavailable, there is no upgrade action to trigger.
2. Review the pending upgrade and what it will change before triggering anything.
3. Trigger the upgrade only inside an approved deployment window. The server
   durably admits the request and assigns its `SUR-*` run identity before queue
   dispatch begins. Normal changes respect the window; only an emergency change
   may override it.
4. Watch the deployment status — the page distinguishes a request waiting for
   dispatch, active dispatch, indeterminate dispatch reconciliation, and a
   definite dispatch failure. It updates automatically while the build and swap
   are in progress. A normal upgrade completes in a few minutes.
5. Confirm the health check passed after the swap, and read the deployment log if
   it did not.

You may navigate away after the upgrade has been accepted. Leaving the page stops
only that page's live status reads; it does not cancel or pause the durable upgrade.
When you return, the page reloads the current run state and resumes live updates.
If the browser loses the trigger response, do not click again. The action remains
disabled until the server reports a durable disposition for the admitted run.
The same `SUR-*` identity is reconciled after a delayed or ambiguous dispatch, so
a page reload or process restart cannot create a second physical upgrade.

The owner status card and upgrade action stay visible on arrival. Open
**Deploy controls & history** only when you need technical controls, run
history, logs, or the local-changes ledger.

During an active upgrade, the portal enters quiescence and refuses new mutating
MCP writes. Delivery agents can still read quiescence status and release an
owned nonproduction lease, then retry evidence publication after the portal
returns to normal.

## What Happens If You Do Nothing

The install stays on its current version. The consumer channel keeps being
checked, but newer bytes are not applied until an operator approves and runs the
upgrade. Nothing is lost by waiting.

## What Is Reversible

- A failed upgrade is **automatically rolled back** and its promoter container is
  force-removed, so a broken build cannot leave the install in a half-swapped
  state.
- Candidate promoter preparation and the application build use Docker BuildKit
  and the same bounded wall-clock budget (default **25 minutes**). If either
  build stalls, it is killed and the deployment is marked failed with a
  retryable `promoter-timeout` diagnosis instead of hanging. Candidate
  preparation finishes before the platform begins quiescing.
- A periodic watchdog force-removes any promoter container orphaned by a
  mid-deployment restart, so a stalled build can never linger and cause an
  unexpected later swap.

## Recovery And Help

- If an upgrade fails, open the deployment log for the retryable diagnosis, then
  re-run the upgrade.
- If dispatch is indeterminate, leave the action alone while the server
  reconciles the admitted `SUR-*` run. A definite pre-dispatch refusal is shown
  against that same run identity and means no upgrade mutation began.
- If update status is unavailable, read the technical reason under **Deploy
  controls & history**. Repair registry access or install identity before
  retrying; the unavailable state has not queued or mutated anything.
- Operators on unusually slow hosts can raise the shared build budget by setting
  `DPF_PROMOTER_TIMEOUT_MS` (milliseconds) in the environment.
- Deployment windows and change-request lifecycle are managed from the wider
  Operations area.

## What To Watch

- triggering an upgrade outside an approved deployment window
- treating a failed, rolled-back deployment as if the swap had succeeded
- re-running an upgrade without first reading the failure diagnosis in the log
- starting expensive local-CI work while the portal reports active quiescence
