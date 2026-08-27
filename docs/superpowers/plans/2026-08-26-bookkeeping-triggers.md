---
title: "Plan — recurring + on-arrival triggers for the Bookkeeping Work Room (S-TRIG)"
date: 2026-08-26
bi: BI-DC738330
epic: EP-EMAIL-COMMS
status: active
---

# Plan — Bookkeeping Work Room triggers (BI-DC738330, slice S-TRIG)

**Parent:** BI-1585FA9E (Bookkeeping Work Room). **Spec:** `docs/superpowers/specs/2026-08-16-bookkeeping-work-room-design.md`. **Depends on:** S-ROOM (BI-F8B6CF81, merged #4715) for the `bookkeeping-period` room kind + lifecycle grammar; S-BK (#4690), S-FIN (#4658).

## What

Wire the two triggers that make the Bookkeeping Work Room recurring rather than a one-off, per the ratified spec scope (weekly cadence + on-arrival). Both funnel through one shared, idempotent open/advance operation — the first production driver of `openWorkroomCycle` for the `bookkeeping-period` room. **Pure composition — no schema, no migration.**

## Substrate audit (grounded 2026-08-26 on this branch's `main`)

| Capability | State | Use |
| --- | --- | --- |
| Scheduled tasks | `ScheduledAgentTask` (cron `schedule`, `taskKind String?`, `taskConfig Json?`); dispatcher `agent-task-dispatch`; executor `executeScheduledAgentTask` branches deterministically by `taskKind` | Add a `bookkeeping-cycle` kind + a deterministic executor branch (off the LLM path, like the data-model mirror). `taskKind` is a plain string — no migration. |
| Room cycle API | `openWorkroomCycle` (`room-cycle-store.ts`) — materializes a cycle under a standing room, idempotent on `cycleKey`, emits a `work-room-cycle-opened` receipt; `prismaWorkroomCycleDb` is the prod adapter | First production caller. Both triggers call the shared wrapper. |
| Room materialization | source→WorkItem bridge pattern (`booking-bridge.ts`) | `ensureBookkeepingPeriodRoom` upserts the single standing room WorkItem (idempotent). |
| Inbound seam | `ingestWorkroomChannelEvent` (`room-channel-ingress.ts`) resolves a verified inbound event → the bound room's WorkItem | Compose over it for on-arrival — no coupling into the marketing email classifier. |

## Deliverable

1. **Shared core** (`apps/web/lib/finance/bookkeeping/bookkeeping-period-room.ts`): `bookkeepingPeriodKey` (pure ISO-week key), `buildBookkeepingCycleInput` (pure input builder with the no-fabrication stop conditions), `ensureBookkeepingPeriodRoom` (idempotent room upsert), `openOrAdvanceBookkeepingPeriod` (idempotent; a prior period's still-open cycle is "already being worked", not an error).
2. **Weekly trigger**: `bookkeeping-cycle` task kind (`agent-task-kind.ts`) + a deterministic executor branch (`agent-task-scheduler.ts`) that derives the current period and opens/advances the cycle.
3. **On-arrival trigger** (`bookkeeping-inbound-trigger.ts`): `ingestBookkeepingInbound` composes over `ingestWorkroomChannelEvent`; when a verified statement/receipt is accepted onto the bookkeeping room it advances the cycle. Non-bookkeeping rooms pass through untouched.

## Verification

- Unit tests: period-key determinism, the pure cycle-input builder (no-fabrication stop conditions present), the weekly + on-arrival paths against a mock cycle store (opens once, idempotent on re-fire, prior-active handled, non-bookkeeping inbound passes through). Full `apps/web` typecheck clean; local-CI pregate green.
- **Owner-gated:** the live cadence and a live inbound address require the operator's setup and real statement export — no fictitious data on the live instance. The machinery is verified with fixtures; the reconciled period waits on the owner.

## Risks & rollback

- A weekly tick that fires while a prior cycle is still open is handled (treated as already-active), not an error.
- Rollback: remove the two trigger modules + the task kind + executor branch; pure additions, no migration.
