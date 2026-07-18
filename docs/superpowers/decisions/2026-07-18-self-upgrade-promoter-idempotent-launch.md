# Self-Upgrade Promoter Idempotent Launch

| Field | Value |
| --- | --- |
| Date | 2026-07-18 |
| Status | Accepted |
| Incident | SUR-E2BF265E |
| Guard | BI-98AF1066 (bundle boundary) |

## Context

The promoter container name is deterministic — `dpf-promoter-<runId>` — added
so the timeout path and the watchdog backstop can `docker rm -f` a hung build by
name (SUR-756751D1). The launch itself, however, was **not idempotent**: when a
second dispatch of the *same* runId reached `runPromoter` (an Inngest retry, a
duplicate trigger event, or the stuck-run reconciler), it issued a second
`docker run --name dpf-promoter-<runId>`. Docker refused with "The container
name is already in use", and the orchestrator recorded that collision as a build
**failure** — for a run whose *first* promoter was still healthily building.

Live symptom: run **SUR-E2BF265E** flipped to `failed` 4 seconds after starting
while its promoter container was past Step 40/119 (`next build`). The persisted
`failureLog` was the docker name-conflict, not a real build error. The false
failure also triggered a cooldown, delaying the next legitimate attempt.

## Decision

`runPromoter` inspects the deterministic container name before launching and
acts on its state (pure, unit-tested helpers `interpretContainerInspect` +
`decidePromoterLaunch`):

- **running** → *defer*: return the internal sentinel
  `PROMOTER_ALREADY_RUNNING_EXIT_CODE`. The orchestrator special-cases it to
  leave run state untouched (no `failRun`, no cooldown, no `upgrade.failed`
  event) and lets the owning dispatch — and, as a backstop, the stuck-run
  watchdog — finalize the run.
- **present** (an exited corpse `--rm` never cleaned, e.g. after a daemon
  restart) → *reclaim*: `docker rm -f` it, then launch fresh.
- **absent** → *launch* normally.

The sentinel constant lives in a dedicated spawn-free module
`apps/web/lib/self-upgrade/promoter-exit-codes.ts` so the Inngest orchestrator
imports it **statically** without pulling the Docker-spawning `./promoter`
runtime into the server bundle — the boundary the bundle-boundary guard
(BI-98AF1066) enforces; the host-only runtime is still reached only through the
dynamic `loadPromoterRuntime()`.

## Scope / follow-ups (not in this change)

- A deferring dispatch that started its own quiescence run leaves that record for
  the watchdog rather than finalizing it here — a known follow-up, not a
  regression over the prior false-fail behavior.
- Surfacing skip/failure **reasons** per row in the Self-Upgrade *Run History*
  table (persisted on `SelfUpgradeRun.reason` / `.failureLog` but not rendered)
  is a separate UI change.
