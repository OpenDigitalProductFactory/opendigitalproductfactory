---
status: active
---

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

## Addendum 2026-09-17 — the fold is bounded (BI-FDECBE0A re-opened, D1)

The item was re-opened on 2026-09-16 because the mechanism above never fired on the threads it exists for: the advance loaded every message newer than the watermark with no `take` and offered all of them to the summarizer in one call, so a 1,100-message thread failed on every attempt, silently, forever, and the prune stayed gated on a watermark that was never set. Design of record: [`2026-09-16-coworker-dialog-compaction-and-thread-economy-design.md`](../specs/2026-09-16-coworker-dialog-compaction-and-thread-economy-design.md) §1 D1 and §7 Phase 2. What changed:

- **`loadMessagesAfter` takes a `take`.** One advance loads `checkpointLoadTake(keepRecentCount)` = `CHECKPOINT_FOLD_BATCH + keepRecentCount` rows: a full page proves a batch has aged out of the window; a short page is the whole remaining span.
- **`CHECKPOINT_FOLD_BATCH` (10) is a real batch size.** One advance folds at most one batch and moves the watermark to the end of *that* batch; `AdvanceResult.moreEligible` tells a caller another batch is probably waiting. A long thread converges across calls instead of failing once.
- **Summarizer input is bounded in estimated tokens.** `CHECKPOINT_FOLD_TOKEN_BUDGET` (6,000, chars/4 on the shared estimator) over whole messages, oldest-first; the per-message 800-char head truncation is gone because the budget is now the bound. A message that could never fit is skipped, announced in the transcript as omitted, and the watermark still passes it — so no single message can wedge a thread. The observed largest message (17,027 chars) fits whole.
- **A failed fold is visible.** `AdvanceResult` carries the failing stage (`load-state` / `load-messages` / `summarize` / `save`) and message; `AdvanceDeps.recordFoldOutcome` writes an `ImprovementSignal` (`sourceType` `thread_checkpoint_fold_failed` keyed `threadId:stage`, or `thread_checkpoint_message_skipped` keyed `threadId`), so failures dedupe, count recurrence, and file into the backlog when they persist. The `catch` stays: a failed fold never breaks a coworker turn.
- **The nightly sweep is the backfill path.** `runThreadCheckpointSweep` keeps advancing a thread while `moreEligible` holds, under `maxFoldsPerRun` (60) and `maxFoldsPerThread` (60) caps, counts `reason: "error"` results as failures (an advance never throws, so they were invisible), and reports folds, messages folded and messages skipped on the nightly result.

Liveness probe (registered at delivery, not awaited — BI-F6B8BADD): the `scheduled:discovery-taxonomy-gap-triage-daily` thread reaches a non-null `compactedSummary` with `compactedTurnCount` > 1,000 across repeated sweeps, and `pruneSummarizedThreadMessages` becomes non-zero for it. Tests: `thread-checkpoint.test.ts` (bounded take, one batch per advance, convergence over 1,100 messages, token budget, recorded skip, stage-attributed failure) and `memory-acquisition-runner.test.ts` (loop-to-convergence, both caps, error counting).

## Addendum 2026-09-23 — admission by message activity (BI-CA79DB7B)

The bounded fold and the nightly backfill from BI-FDECBE0A never reached the two wedged production threads (1,150 and 855 messages) because `sweepThreadCheckpoints` selected candidates by `AgentThread.updatedAt` within the 14-day lookback, and appending a message does not touch that column: both threads carried an `updatedAt` from June while receiving messages daily. The sweep now admits a second set, threads whose own timestamp is older than the window but which received at least one message inside it (`messages: { some: { createdAt: { gte: since } } }`), ordered oldest-first, capped separately (`DEFAULT_WEDGED_THREAD_TAKE`, 25) and appended after the recently-updated set, de-duplicated by id. Caps, batch size and the fold itself are unchanged. Closure probe unchanged: AC-FDECBE0A-1 and AC-FDECBE0A-2 observe on the live install after the next nightly sweep.
