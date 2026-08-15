# Deliberation on Work Rooms — Implementation Plan (BI-F8C5444A)

**Epic:** EP-DELIBERATION-ROOMS · **Date:** 2026-08-14 · **Scope:** platform (WWMD)
**Design of record:** `docs/superpowers/specs/2026-08-12-work-model-convergence-addendum-common-work-formula-design.md` §3 · **Kernel:** DI-A92A7184020F (intra-first)

Harmonize the deliberation/debate pattern onto the Work Room substrate: a completed deliberation becomes a finite room whose verdict is sealed as a durable outcome — the durable-use pilot that proves the room-comms concept on a live pattern.

## Slice delivered (this PR)

Reuses the room substrate rather than rewriting the deliberation orchestrator, and adds **no new MCP tool, source-registry entry, or migration** (zero grant/tool-surface/audit drift):

1. **Materialize the room** — the deliberation's adjudicator `TaskNode` is bridged to a finite `task-node` Work Room (`bridgeTaskNodeToWorkItem`, idempotent). The existing `task-node` source-registry entry already projects finite/evidence-only.
2. **Seal the verdict** — on runner completion (after `synthesizeDeliberation`), `sealDeliberationOnRoom` builds a `WorkRoomOutcomePacket` from the verdict and persists it as a `work-room-outcome-packet` message:
   - `consensus → achieved`, `partial-consensus → partially-achieved`, else `not-achieved`.
   - The evidence fact references the canonical `DeliberationOutcome` record (`kind:"evidence"`), satisfying `raw_chat_not_durable` and the task-node evidence requirement.
   - Idempotent (skips a room already carrying an outcome packet); NON-FATAL (the deliberation stands if sealing fails).

- Pure core: `apps/web/lib/deliberation/deliberation-room.ts` (`mapConsensusToOutcomeState`, `verdictNeedsEscalation`, `buildDeliberationOutcomeSeal`) + tests.
- Server bridge: `deliberation-room-bridge.server.ts`; wired into `apps/web/lib/queue/functions/deliberation-run.ts`.

## Follow-ups (deliberately scoped out)

- **DecisionInteraction write + escalation attention:** `DecisionInteraction.deliberationRunId` FK exists but is never written today. Sealing the verdict to the decision ledger (and lighting the `attention/sources/ai-decision.ts` escalation path for no-consensus via `outcomeType:"escalate"`, `humanOutcome:null`) is the next slice — the `not-achieved` packet is the interim review signal.
- **Live debate on the room feed:** admit each branch's principal (`appendRoomPolicyParticipant`) and post its position (`post_room_message`) so the debate is visible in the room as it happens, not only at seal.
