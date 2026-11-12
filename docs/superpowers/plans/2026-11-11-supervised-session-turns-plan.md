---
status: active
---

# Supervised sessions hear the room: implementation plan (BI-F5D58F29)

Design: [agent dialog broker §7 and §7.1](../specs/2026-10-27-agent-dialog-broker-design.md). Item D in §11. It depends on B2 (`BI-31C1FDEC`), which has shipped.

## Research

Three comparable systems were checked for two questions: how a message reaches a running agent, and how state survives a restart.

| System | Message into a running agent | Survives restart | What DPF takes |
| --- | --- | --- | --- |
| Temporal (signals) | A signal goes into a durable history. The workflow consumes it on its next step, and signals that arrive mid-step queue. | History replays on any worker, so a worker loss loses nothing. | The message store remains the record. A turn only accelerates delivery. Input that arrives mid-turn queues as the next turn, which the supervisor already does. |
| LangGraph (checkpointer + `interrupt`) | `Command(resume=…)` resumes a thread. A pending human interrupt is persisted with the checkpoint. | Interrupts are persisted, so a human can answer after a restart. | Held requests are persisted (on `CoworkerActionEnvelope`) and stay decidable after a restart. |
| T3 Code Orchestration V2 / Codex app-server `thread/resume` / Claude Code `--resume` | `startTurn` / `steerTurn` on a provider thread | The provider thread id is stored, and a resume reopens it. | Already adopted in BI-05715F4C. D adds a boot-time re-attach using the stored thread. |

**Standards.**
- GAID §6.9: a session is operating state, never its own subject. The address is `<client GAID>#session=<threadId>`.
- MCP 2025-11-25 and A2A `input-required`: a held request is a task waiting on input, not a failure.

**Rejected:**
- A new `SupervisedSession` table. `workspaceState.runtimeSession` already holds the record, and §7 places it there.
- A new approvals table. `CoworkerActionEnvelope` already carries proposed, decided and expired states, plus inbox surfacing.
- Delivering every message held for an executor as a turn. A message to a platform coworker in an executor-held room is not addressed to the session. Turning it into a turn would spend the session's model on messages meant for someone else. It is batched into the next turn's context instead.
- Re-running the interrupted turn at boot. Re-attach starts no turn and spends nothing. The next addressed message or person starts one.

## Phases (one PR; the deliverable is atomic)

1. **Durable record.** Covers `apps/web/lib/workroom-runtime/supervisor.ts` and `supervised-session.ts`.
   - Extend the stored session (status, actor, `addressedAs`, heartbeat, `deliveredCursor`).
   - Read the legacy `open` value as `supervised`.
   - Tests: the stored shape on start; legacy read.
2. **Held requests on envelopes.** Covers `supervisor.ts`.
   - Write a `CoworkerActionEnvelope` per held request.
   - `decide` settles it, live or not.
   - A fingerprint-approved call passes.
   - `status` lists proposed envelopes.
   - Tests: a held Codex request and a held Claude call; decide after a simulated restart (new supervisor, same DB); an inbox-approved envelope lets the re-asked call pass.
3. **Boot re-attach.** Covers `supervisor.ts`, `runtime-tools.ts` and `instrumentation.ts`.
   - `reattachSupervisedSessions()` resumes, or marks the session `supervision-lost`, posts a room notice and wakes the coordinators.
   - Tests: resume; lost for each cause; a coordinator wake event is sent.
4. **Addressed message becomes a turn.** Covers `room-message-wake.server.ts` and `supervised-session.ts`.
   - Match the addressing to the stored session.
   - Build the batched prompt.
   - Call `turn` and write the wake state.
   - Tests: a session-qualified message starts a turn; an unsupervised one stays held; a lost one stays held; hop and budget refuse; a platform coworker in an executor-held room is still not dispatched (`BI-A659C3BD`); room-wide messages are batched and the cursor advances.

## Verification

- Unit tests for each phase, `pnpm --filter web typecheck`, then `pnpm run pregate`.
- Live, after the operator upgrades:
  - Start a supervised runtime on a room.
  - Post a message addressed to its `addressedAs`, and see a turn in the room log within 10 s.
  - Post one addressed to an unsupervised `#session=`, and see `held-for-executor`.

## Acceptance (quoted from `BI-F5D58F29`)

- (AC-ADB-12) A message addressed to a supervised session's GAID qualifier arrives as its next turn.
- (AC-ADB-13) After a portal restart the session is re-attached, or marked `supervision-lost` on the room with its messages on the cursor and the coordinator woken.
- A held permission request survives the restart and is still decidable.

## Backlog coverage and traceability

One deliverable, `D-supervision` (phases 1–4), covered by `BI-F5D58F29`.

| Kind | References |
| --- | --- |
| Requirements | `AC-ADB-12`, `AC-ADB-13`, `BI-F5D58F29 AC-3` |
| Contract | `docs/superpowers/specs/2026-10-27-agent-dialog-broker-design.md#71-what-item-d-builds-bi-f5d58f29` |
| Flows | `room/message.posted -> room/message-dispatch -> supervisor.deliver`; `instrumentation boot -> reattachSupervised` |
| Verification | `apps/web/lib/workroom-runtime/supervised-session.test.ts`, `apps/web/lib/workroom-runtime/supervisor.durable.test.ts`, `apps/web/lib/workroom-runtime/supervised-turn-delivery.test.ts` |
