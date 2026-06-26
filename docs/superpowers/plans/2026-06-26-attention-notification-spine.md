# Attention Surface — notification spine (BI-094A124F)

| Field | Value |
| ----- | ----- |
| Status | **Slice 1 implemented in this branch** — canonical notifier + live binding + bus event + escalation producer. Verified: 67 vitest green. Remaining producers + badge are a clean fast-follow. |
| Date | 2026-06-26 |
| Spec | [2026-06-23 human attention surface design](../specs/2026-06-23-human-attention-surface-design.md) §4.2 |
| Epic / BI | `EP-ATTENTION-SURFACE` / `BI-094A124F` |
| Predecessor | Keystone + triage + business adapters (PR #2342, merged `d568aec91`). |

## Problem
The "Needs you" inbox is **passive** — you must open `/workspace` to see it. The `Notification` backbone, `/api/v1/notifications`, `agent-event-bus`, and the `/api/agent/stream` SSE route all exist, but **nothing rides them for attention items**: only `taskrun-recovery` and tax-remittance write `Notification` rows, each hand-rolling its own shape, and no producer emits a realtime event. So a new escalation/approval/paused-AI item arrives silently.

## Design
One canonical notifier — no per-producer Notification hand-rolling.

- **`lib/attention/notify.ts`** (pure core, tested): `notifyAttention(deps, input)` writes **one deduped `Notification`** + emits a `HitlAttentionEvent`. Idempotent per `(userId, source, itemKey)`: the dedup key is carried in `Notification.type` as `attention:<source>:<itemKey>` (migration-free — no dedup column), and an existing **unread** notification of that type makes it a no-op (no bell spam on re-entry/re-render).
- **`lib/attention/notify-live.ts`** (production binding): wires the core to `prisma` (the `Notification` row) and `agentEventBus.broadcastSystem` (the realtime event), and resolves the operator recipient via `resolveScheduledOwnerUserId` (the bootstrap owner). **Best-effort by contract** — `notifyAttentionLive` never throws, so a notify failure can't break the producer path it hooks into.
- **`agent-event-bus.ts`**: a new `attention:created` member on the `AgentEvent` union → the existing SSE stream auto-delivers it for live inbox refresh.
- **Consumer**: the notifications flow to the existing `/api/v1/notifications` feed (the bell) immediately; the dedicated nav **badge** is the next slice.

## Wired this slice
- **Escalation producer** — `escalateBuildToHuman` (`apps/web/lib/build/escalate-build-to-human.ts`): after the `PlatformIssueReport` is filed, notify the operator (best-effort). This is the dominant source (18 live items at verification time), and the function is already runtime-coupled (real `prisma`), so the hook adds no test-hermeticity risk — `escalate-build-to-human.test.ts` stays green.

## Deferred (fast-follow, same pattern)
- **paused-AI** (`mcp-task-submit.ts` → `input-required`) — recipient is the `TaskRun.userId` owner; resolve from the run.
- **agent-proposal** (`agent-coworker.ts` → `AgentActionProposal` `proposed`) — recipient is the conversation's user.
- **ai-decision** (`persistDecisionInteraction`) — this function takes an **injected `db`** (hermetic, unit-tested), so the notify must hook its **caller** (the build-studio gate flow), not the persist function, to avoid polluting its tests. Only fire on `outcomeType ∈ {escalate, defer}`.
- **Nav badge** on the "Needs you" entry — a cheap unread-`attention:`-notification count (the "new since you looked" signal); SSE refresh via the `attention:created` event.

## Verification
- `pnpm --filter web exec vitest run lib/attention lib/build/escalate-build-to-human` — **67 tests pass** (6 files), incl. the new `notify.test.ts` (5: dedup, create+emit, body passthrough, bus-optional) and the unbroken escalation test.
- `pnpm --filter web typecheck` — clean (gate).
- Runtime: a `build-stall-escalation` writes one `attention:escalation:<reportId>` `Notification` to the operator + broadcasts `attention:created`; re-entry while unread is a no-op.

## Files
- New: `apps/web/lib/attention/notify.ts`, `notify.test.ts`, `notify-live.ts`.
- Modified: `apps/web/lib/tak/agent-event-bus.ts` (event member), `apps/web/lib/build/escalate-build-to-human.ts` (escalation hook).
