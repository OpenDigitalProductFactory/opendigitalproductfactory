# Coworker Dialog Compaction & Thread Economy

**Status:** DESIGN — research complete, implementation not started.
**Date:** 2026-09-16
**Standard:** `docs/architecture/context-engineering-standards.md` (P1, P6, P8, P11, P12).
**Prior art this extends (not replaces):** EP-8C706944 (Memory & Context Architecture, closed), EP-27FD96BC (Reasoning Economy, closed), `2026-06-20-compaction-digest-design.md` (R9a, in-turn digest), `2026-04-03-context-budget-arbitration-design.md` (EP-CTX-001).
**Backlog item:** BI-D0DEEFE9.
**Open backlog this must join rather than duplicate:** BI-4761F54E (prompt-cache TTL / prefix hardening), BI-3EC91596 (workroom spend + cache-rate telemetry), BI-0A6B8B38 (per-phase token metering), BI-B195F224 (local context overflow).

## 1. The reported symptom, and what the install actually shows

Reported: *the AI coworker dialog grows unbounded, and it takes longer to come up.*

The intuitive reading — "we send the whole transcript, so add compaction" — is **wrong on this install**, and acting on it would have built a second compactor next to a working one. Measured against this operator install on 2026-09-16:

- The model-facing dialogue is already tightly bounded. `sendCoworkerMessage` loads a recency window of **8 messages (20 for `/build`)** and then trims it to **2,000 estimated tokens (4,000 for `/build`)** before anything else runs (`apps/web/lib/actions/agent-coworker.ts:560-592`).
- Durable cross-turn compaction already exists and works: `AgentThread.compactedSummary` / `compactionWatermarkAt` / `compactedTurnCount`, folded by `advanceThreadCheckpoint` and injected ahead of the window.
- Threads under roughly 70 messages fold correctly — the workroom watch threads show `compactedTurnCount` of 49–58 against 57–68 messages.

So the substrate is present. What is broken is **the fold's own bounds, and every instrument that would have caught it.** Four findings, each reproducible from the live database.

### D1 — The fold that bounds a thread is itself unbounded, and fails silently on exactly the threads that need it

`advanceThreadCheckpoint` (`apps/web/lib/tak/thread-checkpoint.ts`) loads **every** message newer than the watermark, with no `take`, and sends **all** of them to the summarizer in a single call:

```
const sinceWatermark = await deps.loadMessagesAfter(threadId, state.compactionWatermarkAt);
const eligible = keepRecentCount > 0 ? sinceWatermark.slice(0, -keepRecentCount) : sinceWatermark;
if (eligible.length < CHECKPOINT_FOLD_BATCH) return { advanced: false, reason: "not-enough" };
```

`CHECKPOINT_FOLD_BATCH = 10` reads as a batch size and is used only as a **threshold**. Nothing caps `eligible`. The prisma binding (`thread-checkpoint-runner.ts:30`) has no `take` either.

Live evidence:

| contextKey | msgs | content | folded | checkpoint |
|---|---|---|---|---|
| `scheduled:discovery-taxonomy-gap-triage-daily` | 1,126 | 678 kB | **0** | **none** |
| `scheduled:external-catalog-scout-weekly` | 839 | 423 kB | **0** | **none** |
| `scheduled:self-marketing-specialist-…` | 156 | 102 kB | **0** | **none** |
| `scheduled:workroom-WC-A69BCABB-…` | 68 | 33 kB | 58 | yes |
| `coworker:/workspace` | 27 | 12 kB | 10 | yes |

678 kB of transcript is roughly **170,000 tokens** offered to a summarizer whose served local window is 24,576. The call fails, `advanceThreadCheckpoint` catches it, returns `{ advanced: false, reason: "error" }`, logs a `console.warn`, and the turn proceeds. Nothing surfaces. Every subsequent attempt re-reads the same oversized span and fails the same way.

The failure then **compounds**, because the prune is gated on the artifact the fold never produced:

```
fold loads unbounded span → summarizer call exceeds the window → fails silently
  → compactionWatermarkAt never set
      → loadThreadCheckpointMessage injects nothing (continuity falls back to vector recall alone)
      → pruneSummarizedThreadMessages returns 0 (it no-ops when the watermark is null)
          → the thread grows forever
```

This is the defect behind the reported symptom class: **compaction is weakest precisely where it is needed most, and it is designed to be quiet about it.** The `catch` that keeps a failed fold from breaking a coworker turn is correct; discarding the fact that it failed is not.

### D2 — The platform cannot see any of this

Every instrument specified to answer "what did this turn cost, and why" is dark:

| Instrument | Specified by | Live state |
|---|---|---|
| `AgentMessage.contextTrace` | BI-3E218D80 | **0 of 3,543 rows populated** |
| `AdapterRunTelemetry.threadId` | BI-CCF1ACBB | **NULL on all 73,326 rows** |
| `AdapterRunTelemetry.firstEventLatencyMs` | — | **NULL on all rows** |
| `AdapterRunTelemetry.cachedInputTokens` | P8 | **NULL on all rows** |
| `ToolExecution.inputTokens` | BI-CCF1ACBB | **NULL on all 329,328 rows** (threadId is present on all) |

The consequence is structural, not cosmetic: `getThreadSpend` (`thread-cost-ledger-runner.ts`) joins `AdapterRunTelemetry` on `threadId` and `ToolExecution` on token columns. **Both halves are unable to contribute, so the per-thread cost ledger returns zero for every thread that has ever existed.** The rollup shipped; it has never once reported a real number.

A second reading confirms the blindness. Over 14 days, `anthropic-sub` is the **dominant** serving provider (~7,600 runs across Haiku 4.5, Sonnet 4.5/4.6, Opus 4.7) yet reports `avg(inputTokens) = 16` — usage is not being captured on that path at all. Only the local model (`qwen3.8-27b`, avg 3,087 input tokens) reports honestly. Note the doctrine drift this exposes: `context-engineering-standards.md` still frames the binding constraint as "cloud frontier models are disabled by choice." On this install they are not, and that changes which lever matters most (see §4, Phase 3).

**This is why the problem "gets worse" without anyone catching it earlier.** There is no signal. Anything we build in this area before fixing measurement is unfalsifiable.

### D3 — Storage growth is dominated by tool execution, not by dialogue

- `ToolExecution`: **890 MB**, 329,328 rows.
- `AgentMessage`: **3.4 MB**, 3,543 rows.
- `AdapterRunTelemetry`: 35 MB, 73,326 rows.

And the largest message threads are not a token cost at all: the `scheduled:*` class dispatches **no history**. `agent-task-scheduler.ts:500` builds `chatHistory` as exactly one synthetic user message. Those 1,126 rows are append-only storage that no model ever reads.

That distinction matters for the plan: the scheduled threads are a **retention** problem, the interactive threads are a **context** problem, and `ToolExecution` is the real disk pressure. Treating all three as "compaction" would put an LLM summarizer in front of a problem that wants a delete policy.

### D4 — "Takes longer to come up" is largely not token count, and is currently unmeasurable

`sendCoworkerMessage` is 2,758 lines containing **179 `await`s**, a substantial number of them serial and many of them dynamic `import()` calls sitting in the critical path before the first token: lifecycle gate, portal context, room turn authority, withheld-history resolution, checkpoint load, briefing load, profession-identity lookup, install-variant context, profession corpus, local serving posture, skill-catalog cap, tool budget. Several are independent of one another and are nonetheless awaited in sequence.

But `firstEventLatencyMs` is NULL on every row, so **there is no measurement of time-to-first-token anywhere on this install.** Optimizing this path before instrumenting it would be guesswork. Phase 0 exists for exactly this reason.

## 2. Research & Benchmarking (required by AGENTS.md §7)

Three current leaders, compared against what DPF already does.

### Microsoft Agent Framework — compaction strategies
A strategy taxonomy with two independent predicates, **trigger** (when compaction begins) and **target** (when it stops), over a `MessageIndex` of atomic `MessageGroup`s. The group kinds matter: an assistant message carrying tool calls and its tool results form one **atomic unit**, because removing one without the other is an API error. Strategies compose into a pipeline ordered gentlest-first: collapse old tool results → summarize older spans → sliding window → truncate as an emergency backstop. Their summarizer bounds its own input to ~8,000 estimated tokens by default and **selects only complete groups that fit that budget** — if no complete group fits, summarization is skipped rather than attempted.

**DPF adopts:** trigger/target separation; the gentlest-first pipeline; and above all the **bounded summarizer input** — that single property is the direct fix for D1. **DPF rejects:** their sliding-window-by-turns as a primary strategy — DPF's window is already far tighter than theirs.

### Anthropic — context editing and compaction
Server-side `clear_tool_uses_20250919` clears the oldest tool results past a threshold and replaces each with a placeholder telling the model it was removed; `clear_thinking_20251015` does the same for thinking blocks. Crucially it runs **after prompt-cache lookup and before token counting**, so editing preserves the cached prefix instead of invalidating it. Compaction proper is the SDK-level complement: summarize history and replace it, rather than clear.

**DPF adopts:** the placeholder-not-silence principle (a cleared span must announce itself — DPF's R9a digest already does this within a turn; it must also hold across turns), and cache-prefix preservation as an explicit ordering constraint. **DPF rejects:** dependence on the server-side beta — P8 and "platform function never depends on a client" both require the guarantee to hold on the local path with no Anthropic API present.

### Letta / MemGPT — recursive summarization and sleep-time compute
Evicted messages are summarized **together with the prior summary**, so older content decays in influence rather than vanishing — DPF's watermark fold is already this shape. The newer contribution is **sleep-time compute**: a separate agent maintains memory asynchronously instead of bundling memory management into the responding agent, reported at ~18% accuracy improvement and ~2.5× cost reduction per query.

**DPF adopts:** moving the fold fully off the interactive turn. DPF is half-way there already — `advanceThreadCheckpointForThread` is fired-and-forgotten after the turn (`agent-coworker.ts:2502`) and swept nightly — so this is a completion, not a new architecture. **DPF rejects:** a self-editing memory agent; DPF's memory writes are governed (`UserFact` scope/sensitivity, supersession-not-deletion) and an autonomous editor would route around that.

**Standards check:** nothing here proposes a parallel utility. Every adoption lands inside `thread-checkpoint.ts`, the existing telemetry writer, or the existing nightly sweep.

## 3. The differentiator: DPF has a system of record, so compaction need not be generative

Every system benchmarked in §2 summarizes **prose**, because prose is all they have. An agent framework's transcript is the only evidence that anything happened; if the span is dropped without an LLM summary, the work is genuinely lost. That constraint is why Letta recursively summarizes and why Anthropic's clearing leaves a placeholder rather than a fact.

**DPF is not in that position.** Activities here produce durable, traceable records, and those records are already joined to the thread:

- `ToolExecution` — **329,398 rows, `threadId` NOT NULL on every one**, carrying `toolName`, `parameters`, `result`, `success`, `auditClass`, `durationMs`, `createdAt`, and a human-readable `summary` on **266,737** of them (81%). Failures are flagged: 11,518 rows are `success = false`.
- `AgentActionProposal`, `TaskRun`, `BacklogItemActivity`, `AdapterRunTelemetry` — the same shape for proposals, runs, governed work transitions, and inference.

So for any dropped span of a DPF thread, **what the coworker did is recoverable by query, not by inference.** And it is already condensed: 14 MB of `summary` against 96 MB of raw `result` — roughly a 7× reduction sitting in the record, free, faithful, and governed.

This reframes the design. It elevates the R9a principle — *preserve actions, not prose, and preserve them extractively* — from a local-GPU workaround into the platform's actual advantage:

- **The action half of a compacted span should be reconstructed from `ToolExecution`, not summarized.** Deterministic, zero-inference, exactly faithful, and auditable — a summarizer can hallucinate a tool outcome; a query cannot. It also survives when the summarizer is unavailable, which satisfies "platform function never depends on a client."
- **The LLM fold narrows to what is genuinely only in prose** — intent, the user's stated preferences and constraints, decisions and their reasons. That is a much smaller input, which independently mitigates D1: the oversized-transcript failure shrinks when tool traffic is excluded from the fold in the first place.
- **The two halves have different trust and retention properties.** The record half is evidence and is already governed by audit class; the prose half is a lossy reconstruction. A compacted span should say which is which rather than blending them into one paragraph the reader cannot grade.
- **The record is queryable on demand**, which makes just-in-time retrieval (P4) viable where other frameworks can only front-load a summary: "what did I already try on this thread" can be a tool call against the record instead of standing context.

**One gap blocks this.** `ToolExecution.chatMessageId` is **NULL on all 329,398 rows**, so a tool execution can be attributed to a thread but not to the turn within it. Span-accurate reconstruction ("what happened between the watermark and here") needs that link, or an equivalent `createdAt` range join. This belongs in Phase 0 alongside the other attribution fixes — it is the same defect family as D2, and it is the one that unlocks this section's design.

**Benchmark position:** none of Microsoft Agent Framework, Anthropic context editing, or Letta can do this, and not because they chose otherwise — they have no system of record to read. This is a genuine DPF advantage, and the plan below should spend it rather than reimplementing their generative approach.

## 4. Design

Five phases, ordered so each one is verifiable when it lands. Phases 0 and 1 are the ones that address the reported symptom; 2–4 are the durable economy.

### Phase 0 — Make it measurable (blocks everything else)
Nothing in this area should be tuned against an install that reports zeros.

- **Attribute inference to its thread.** Populate `AdapterRunTelemetry.threadId` (and `agentMessageId`) on every write via `adapter-telemetry-writer.ts`. This alone revives `getThreadSpend`.
- **Capture usage on the `anthropic-sub` path.** It serves the majority of runs and reports `avg(inputTokens) = 16`. Until it reports honestly, cost governance is fiction.
- **Record `firstEventLatencyMs`** on every streamed run — the only honest answer to "it takes longer to come up."
- **Record `cachedInputTokens`.** `chat-adapter.ts:545` already reads `cache_read_input_tokens` from the provider; persist it. Joins BI-4761F54E and BI-3EC91596 rather than duplicating them.
- **Populate `contextTrace`.** It is written only inside the `useUnified` branch and has produced zero rows; establish whether the branch is inert on this install and either fix the write or record why the flag is off.
- **Backfill `ToolExecution.inputTokens`** going forward (not retroactively — 329k rows).
- **Link tool executions to their turn.** `ToolExecution.chatMessageId` is NULL on all 329,398 rows; populating it is what makes §3's record-based reconstruction span-accurate.

*Acceptance:* a coworker thread's spend, its per-turn input tokens, its TTFT, and its cache-hit rate are all readable from the runtime-health page for a real thread. No behavior change ships in this phase.

### Phase 1 — Bound the fold, and make its failures loud
The direct fix for D1. Contained to `thread-checkpoint.ts` + its prisma binding.

- **Bound the load.** Add a `take` to `loadMessagesAfter`.
- **Make `CHECKPOINT_FOLD_BATCH` an actual batch size.** Fold *at most* one batch per advance and move the watermark to the end of that batch. A 1,126-message thread then converges over successive sweeps instead of failing forever on attempt one.
- **Bound the summarizer input in tokens, not just message count** — follow the Agent Framework rule: select whole messages that fit the budget; if none fits, skip rather than attempt. A single 17,027-character message (the observed maximum) must not be able to wedge a thread.
- **A failed fold must be visible.** Promote the `console.warn` to a durable, queryable failure signal with its reason, so a thread that has been failing to fold for weeks is discoverable. Keep the `catch` — a failed fold still must never break a coworker turn — but stop discarding the outcome.
- **Backfill the wedged threads** once the batch loop exists.

*Acceptance:* the `scheduled:discovery-taxonomy-gap-triage-daily` thread reaches a non-null `compactedSummary` with `compactedTurnCount` > 1,000 after repeated sweeps, `pruneSummarizedThreadMessages` becomes non-zero for it, and a deliberately oversized message produces a recorded skip rather than a silent stall. Unit tests are pure (the module is already fully dependency-injected).

### Phase 2 — Gentlest-first strategy pipeline
Today compaction is one move (summarize the aged-out span) applied after one other move (a hard token trim of the window). Adopt the ordered pipeline so cheap reductions run before expensive ones:

1. **Reconstruct aged tool activity from the record (§3)** — zero-inference and exactly faithful, read from `ToolExecution` (`toolName`, `success`, `summary`) for the span rather than re-summarized from the transcript. This is the single largest reclaim, and R9a's `compaction-digest.ts` already has the output shape; generalize it across turns and source it from the record instead of writing a second digest.
2. **Summarize only the prose residue** — intent, preferences, constraints, decisions and their reasons — using Phase 1's bounded fold. With tool traffic served by step 1, this input is far smaller than today's.
3. **Recency window** — what exists today.
4. **Hard trim** — the existing token walk, demoted to an emergency backstop.

**Atomic tool-call groups are a hard constraint here.** DPF's current trim walks flat messages and can split an assistant tool call from its result. Group-awareness must land with this phase.

*Acceptance:* measured (Phase 0) input-token reduction on a long thread with no loss of the tool-activity signal R9a preserves; no orphaned tool-call/result pairs.

### Phase 3 — Cache-aware ordering
With `cachedInputTokens` finally recorded, P8 becomes verifiable instead of *[REVIEW]*. Given that `anthropic-sub` now serves most runs, prefix-cache hit rate is plausibly a **larger** cost lever than compaction itself — a stable cached prefix is cheaper than a shorter uncached one. The compaction pipeline must not rewrite the stable prefix on every turn: injected blocks (checkpoint, briefing) belong behind `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, ordered stable-first. Joins BI-4761F54E.

*Acceptance:* cache-read rate reported per provider; compaction changes are shown not to have degraded it.

### Phase 4 — Retention, and the latency path
- **Retention.** `scheduled:*` threads dispatch no history; they need a delete/archive policy, not a summarizer. `ToolExecution` at 890 MB needs the same. Routes through the existing `2026-06-14-data-retention-lifecycle-governance-design.md` rather than a new policy surface.
- **Latency.** With TTFT measured, parallelize the independent pre-inference awaits in `sendCoworkerMessage` and hoist the dynamic imports out of the critical path. Evidence first: this phase does not start until Phase 0 has produced a TTFT baseline.

## 5. Scope & non-goals

- **Not** a new compaction engine. Every change lands in `thread-checkpoint.ts`, `compaction-digest.ts`, the telemetry writer, or the nightly sweep.
- **Not** a change to what the interactive window sends today (8 messages / 2,000 tokens). That bound is already aggressive; if anything Phase 0's measurements may argue for *widening* it once the checkpoint is reliable.
- **Not** a memory-model change. `UserFact` scope, sensitivity, and supersession are untouched.
- **Not** a Build Studio / CLI-surface change. In-turn `compactAgenticMessages` behavior is unchanged.

## 6. Risks

- **Phase 0 may reveal the problem is elsewhere.** That is the point of sequencing it first, and it is a cheap phase.
- **Backfilling wedged threads spends inference.** The 1,126-message thread costs ~113 summarizer calls at a 10-message batch. Run it on the nightly sweep, not interactively, and cap per-run work.
- **`useUnified` may be off on this install**, which would mean the arbitrator path itself is inert — a materially larger finding than this spec assumes. Phase 0 resolves it.

## 7. Open question for the operator

D3 established that `scheduled:*` threads dispatch no history, so their unbounded growth is storage, not tokens. If the reported symptom was observed on a **scheduled or workroom coworker** rather than an interactive chat panel, the causal chain is different from the one in D1 and Phase 4 (retention) outranks Phase 1. Worth confirming which surface the symptom was seen on before implementation starts.
