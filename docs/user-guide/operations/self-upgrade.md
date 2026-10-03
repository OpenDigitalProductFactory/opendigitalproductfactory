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

1. Confirm the status card shows a resolved immutable update. The card reports
   **You’re current** only when nothing newer is waiting; if it says that, or
   says updates are unavailable on this install, there is no upgrade action to
   trigger.

   A waiting update stays named on the card while an upgrade is running
   (**Installing now**) and after one fails (**Update still pending**), so a
   failed or in-progress attempt never reads as being up to date.
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

### When work is still running

An upgrade no longer gives up because work is in progress. When you press
**Upgrade now**, or the hourly check starts one, the portal stops accepting
new work and waits for builds and coworker tasks that are already running to
finish. It does not interrupt them. The upgrade installs as soon as they are
done. The wait lasts up to 60 minutes by default (`drainWaitBudgetMs` in the
self-upgrade settings). If work is still running after that, the upgrade
pauses as **awaiting operator**: new work stays paused and nothing is
interrupted. The upgrade page then offers three choices:

- **Keep waiting** gives the running work another 60 minutes.
- **Force now** installs immediately, interrupting whatever is still running.
- **Abort** cancels this upgrade and reopens the portal to new work.

While it waits, the page shows how long it has waited and the limit. Force
now and Abort are also available during the wait itself. These controls keep
working while the portal refuses other changes.

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
  preparation finishes before the platform begins quiescing, and so does the
  application build itself: the portal keeps accepting work while the new
  version builds, and pauses new work only for the swap.
- A periodic watchdog force-removes any promoter container orphaned by a
  mid-deployment restart, so a stalled build can never linger and cause an
  unexpected later swap.

## Recovery And Help

- If an upgrade fails, the status card states the cause in plain language — for
  example **The server ran out of memory** or **A software download failed** —
  along with whether re-running is likely to help. Some causes (your changes
  clashing with the update, uncommitted local edits) will not clear on a retry
  and say so; those need a decision rather than another attempt.
- The deployment log remains the full diagnosis behind that summary. Read it
  when the stated cause is not enough, not to discover what the cause was.
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
- re-running an upgrade the card has already said a retry will not fix
- starting expensive local-CI work while the portal reports active quiescence


## When required services are degraded

A completed portal upgrade can still show **Degraded** when required supporting
services could not start. The banner lists the failed services; it does not mean
those capabilities are working. A later upgrade retries missing containers and
containers whose first startup never succeeded. Services that have run before
and were subsequently stopped are left alone.

Monitoring configuration paths are resolved for the Docker host, including when
an upgrade runs inside a separate container. The sandbox installs the dependencies
for its current source before starting its preview server; dependency failures
remain visible in container logs and health status.

On Apple Silicon Macs, speech runs as the native Chatterbox service. It is checked
through its speech endpoint, not by requiring a Docker speech container. If voice
is unavailable, use the existing native speech setup/recovery procedure in the
[Apple Silicon speech design](../../superpowers/specs/2026-05-28-tts-apple-silicon-local-design.md).
