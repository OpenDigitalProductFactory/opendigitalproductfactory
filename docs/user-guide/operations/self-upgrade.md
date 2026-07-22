---
title: "Self-Upgrade"
area: operations
order: 2
---

## Use This Doc For

- `/ops/self-upgrade`

## Overview

Self-upgrade upgrades the platform itself. It builds a fresh application image
from the approved source and swaps the running install over to it. This is a
higher-consequence operation than editing backlog work, so it is operator-gated
and governed by deployment windows.

## Workflow

1. Review the pending upgrade and what it will change before triggering anything.
2. Trigger the upgrade only inside an approved deployment window. Normal changes
   respect the window; only an emergency change may override it.
3. Watch the deployment status — the page updates automatically while the build
   and swap are in progress. A normal upgrade completes in a few minutes.
4. Confirm the health check passed after the swap, and read the deployment log if
   it did not.

## What Happens If You Do Nothing

The install stays on its current version. Queued fixes and improvements are not
applied until an operator approves and runs the upgrade. Nothing is lost by
waiting, but the platform does not move forward on its own.

## What Is Reversible

- A failed upgrade is **automatically rolled back** and its promoter container is
  force-removed, so a broken build cannot leave the install in a half-swapped
  state.
- The build is bounded by a hard wall-clock budget (default **25 minutes**). If a
  build step stalls, the promoter is killed and the deployment is marked failed
  with a retryable `promoter-timeout` diagnosis instead of hanging.
- A periodic watchdog force-removes any promoter container orphaned by a
  mid-deployment restart, so a stalled build can never linger and cause an
  unexpected later swap.

## Recovery And Help

- If an upgrade fails, open the deployment log for the retryable diagnosis, then
  re-run the upgrade.
- Operators on unusually slow hosts can raise the build budget by setting
  `DPF_PROMOTER_TIMEOUT_MS` (milliseconds) in the environment.
- Deployment windows and change-request lifecycle are managed from the wider
  Operations area.

## What To Watch

- triggering an upgrade outside an approved deployment window
- treating a failed, rolled-back deployment as if the swap had succeeded
- re-running an upgrade without first reading the failure diagnosis in the log
