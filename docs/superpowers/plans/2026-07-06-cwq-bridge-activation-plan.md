# EP-3516E23D — Activate dormant CWQ bridges (BI-C585535E)

**Spec:** [docs/superpowers/specs/2026-07-06-reusable-queueing-substrate-design.md](../specs/2026-07-06-reusable-queueing-substrate-design.md) §2.2 / §4.4
**BI:** BI-C585535E (EP-3516E23D). Depends on Phase 1 (flow-telemetry spine, #2652).
**Goal:** Wire the dormant CWQ bridges so real work items flow into the queues the
Phase-1 spine measures and the Phase-3 surfaces display. Until now only the
sandbox-pool lane emitted telemetry and the work queues were empty (0 rows,
bridges had zero callers).

## What changed

- **`lib/queue/bridges/backlog-bridge.ts`** — made idempotent (returns an existing
  live WorkItem for the BacklogItem instead of duplicating on re-claim) and now
  records a `recordQueueTransition("enqueued")` into the shared telemetry (it
  creates WorkItems directly, bypassing the emitting server action). 3 unit tests.
- **`lib/mcp-tools.ts`** — `update_backlog_item_status` now bridges the BI to a
  triage-queue WorkItem on a claim-on-start (`→ in-progress`), via a lazy import,
  best-effort and post-commit (never fails the claim). This is the concrete
  activation: a coworker starting a BI now surfaces it as queued work with flow
  telemetry.
- **`lib/queue/bridges/task-node-bridge.ts`** — same idempotency + telemetry
  hardening so it is activation-ready. **Not wired**: the current TaskNode
  lifecycle has no `awaiting_human` transition site to call it from (the only
  reference is the bridge's own doc), so wiring it now would be inventing a
  caller. It activates when that transition is introduced.

## Verification

- 46 tests green across the bridges + telemetry + mcp-tools suites; `tsc --noEmit`
  clean; module-size re-baselined; MCP tool-pack guard OK.
- Live (post-merge): claim a triaged BI → a WorkItem appears in the triage queue,
  a `QueueTelemetryEvent` (enqueued) row lands, and after the hourly rollup a
  `cwq:*` tile shows on `/platform/ai/runtime-health` / `get_queue_status`.
  Re-claiming the same BI does not create a second WorkItem.

## Not in this phase

Field-service dispatch (Phase 4, BI-10E350A6); routing WorkItems to workers
(EP-CWQ Phase 2 router); the atomic-claim hardening BI-B62B9F1E (the claim gate
here is the existing advisory-with-staleness check — the bridge rides on top of it
and is idempotent, so a claim race produces at most one WorkItem).
