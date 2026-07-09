# Durable rolling compaction checkpoint — implementation plan

- **BI:** BI-FDECBE0A (EP-8C706944 — AI Coworker Memory & Context Architecture, Phase 1)
- **Date:** 2026-07-09
- **Kernel ledger:** DI-F69AE978B70C (program-level; hybrid-lifecycle-plus-projections)
- **Status:** Substrate + core + send-path wiring (this PR)

## Problem

The coworker send path (`apps/web/lib/actions/agent-coworker.ts`) loads only a bounded recency window — `RECENT_WINDOW` = 8 (chat) / 20 (build) messages — plus Qdrant semantic recall. Everything older is invisible unless recall happens to surface it. The in-flight `thread-compaction.ts` summary only fires when the *assembled window* exceeds 20, and when it does it recomputes the summary from scratch every turn and discards it. So: no durable "conversation so far", and any summarization spend is repaid each turn. The DB `AgentMessage` log itself is unbounded (retention is BI-153F7E4A, Phase 2).

## Design

A persisted running summary of every turn **older than the recency window**, advanced incrementally behind a watermark.

1. **Schema** (`AgentThread`, additive migration `20260709120000_add_thread_compaction_checkpoint`):
   - `compactedSummary String?` — the durable running summary.
   - `compactionWatermarkAt DateTime?` — createdAt of the newest message already folded; the advance only reads messages strictly newer, so no span is summarized twice.
   - `compactedTurnCount Int @default(0)` — how many turns the summary condenses.
   All nullable/defaulted → safe against existing rows (attested in-file).

2. **Pure core** (`apps/web/lib/tak/thread-checkpoint.ts`): `advanceThreadCheckpoint(threadId, keepRecentCount, deps)` folds the messages that have aged out of the window (all-but-newest-`keepRecentCount`, newer than the watermark) once `CHECKPOINT_FOLD_BATCH` (10) have accumulated; folds the prior summary + new transcript into one updated summary; caps at `CHECKPOINT_SUMMARY_CHAR_CAP` (4000). `formatCheckpointMessage` renders it as a prependable history message, null when empty. Summarizer + store are dependency-injected → unit-tested with no DB/model (`thread-checkpoint.test.ts`, 9 cases).

3. **Server runner** (`thread-checkpoint-runner.ts`): binds prisma + the routed `analysis`-tier summarizer to the core. `loadThreadCheckpointMessage` (read) and `advanceThreadCheckpointForThread` (advance). Kept separate so the P2 sleep-time pass reuses the same advance.

4. **Send-path wiring** (`agent-coworker.ts`): after the recency window is assembled, prepend the checkpoint message (strict no-op when absent, non-fatal on error); after the turn, fire-and-forget `advanceThreadCheckpointForThread` with `keepRecentCount` matching the route's window.

## Non-goals (own BIs)

- Retention/pruning of the raw `AgentMessage` log now that summaries are durable → BI-153F7E4A.
- Per-thread token/cost accounting of the fold spend → BI-CCF1ACBB.
- Consolidation/dedup of the summary content across threads → BI-840FDD43 / BI-907C4327.

## Verification

- Unit: `thread-checkpoint.test.ts` — no-thread/not-enough no-ops, exact fold boundary, incremental (watermark-respecting) fold, summary cap, non-fatal summarizer failure, message formatting.
- Runtime (post-merge, canonical install): a >30-turn chat thread accumulates a non-null `compactedSummary`, `compactionWatermarkAt` advances monotonically, and the fold LLM call fires once per batch (not per turn).
