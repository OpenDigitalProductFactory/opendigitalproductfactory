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

The owner status card and the state-appropriate next step stay visible on
arrival. An available update shows one install action. A current or running
install shows status without a redundant start command. A failed or blocked
install points to recovery instead of asking you to retry blindly. Open
**Deploy controls & history** only when you need technical controls, run
history, logs, or the local-changes ledger; a failed update opens that recovery
detail automatically.

During an active upgrade, the portal enters quiescence and refuses new mutating
MCP writes. Delivery agents can still read quiescence status and release an
owned nonproduction lease, then retry evidence publication after the portal
returns to normal.

## What Happens If You Do Nothing

When automatic updates are enabled, an available update waits for the next
governed quiet window and then installs on its own. When automatic updates are
disabled or a prerequisite is blocked, the current version stays in place
until an operator resolves the blocker and explicitly starts the update.
Nothing is lost by waiting.

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

- If an upgrade fails, use **Review recovery controls**. Restore the governed
  recovery point when needed, read the retryable diagnosis, and only then
  decide whether to run the update again.
- Operators on unusually slow hosts can raise the shared build budget by setting
  `DPF_PROMOTER_TIMEOUT_MS` (milliseconds) in the environment.
- Deployment windows and change-request lifecycle are managed from the wider
  Operations area.

## What To Watch

- triggering an upgrade outside an approved deployment window
- treating a failed, rolled-back deployment as if the swap had succeeded
- re-running an upgrade without first reading the failure diagnosis in the log
- starting expensive local-CI work while the portal reports active quiescence
