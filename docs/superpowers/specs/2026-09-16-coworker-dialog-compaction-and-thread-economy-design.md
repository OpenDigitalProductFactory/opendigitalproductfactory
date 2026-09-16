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

A second reading confirms the blindness. Over 14 days, `anthropic-sub` accounts for the largest share of runs (~7,600 across Haiku 4.5, Sonnet 4.5/4.6, Opus 4.7) yet reports `avg(inputTokens) = 16` — usage is not captured on that path at all. Only the local model (`qwen3.8-27b`, avg 3,087 input tokens) reports honestly.

**This is not doctrine drift, and the distinction sets the design target.** Frontier models are **opt-in per workroom and per subject**, governed by the organization's privacy requirements and risk tolerance at a granular level. Frontier capacity is therefore a *conditional* privilege, not the baseline. The baseline — the path that must work for every subject, including every one whose risk profile forbids sending it off the install — is the **raw local model behind a 24,576-token window, with no prompt caching and no provider-side context management.**

Two consequences follow, and they reorder this plan:

- **The local window is the primary design target, not the fallback.** Anything that only works when a frontier model is attached fails the subjects that most need to stay local.
- **Cache-aware ordering (Phase 3) is real but secondary** — it can only help workrooms that have opted in. It must not be allowed to set the architecture.

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

## 4. What the local path actually needs: a transactional dialog

A raw local model gets no server-side context management, no cached prefix, and ~24,576 tokens. Feeding it a growing dialogue is the wrong shape regardless of how well that dialogue is compacted, because **the context grows with the conversation instead of with the work.** Compaction alone only slows that down.

The requirement is to make each turn **transactional and deliverable without destroying the details of the activity.** Those pull in opposite directions only if detail must live in the transcript. Given §3, it does not.

### The principle

> **Bound context by work state, not by conversation length.**

Today context is a function of turn count. It should be a function of open work. A thread carrying 1,126 messages across a dozen deliverables should cost roughly a dozen deliverables of context — not 1,126 messages of it, and not a lossy paragraph standing in for them.

A transactional turn carries three layers, **none of which grows with turn count**:

1. **The objective** — the goal and its open steps. Bounded by plan size.
2. **The activity** — what has actually been done in this transaction, reconstructed exactly from `ToolExecution` (§3). Bounded by the transaction, not the thread.
3. **The deliverable state** — what has been produced or committed so far. This is what makes a turn *deliverable* rather than conversational: the turn advances an artifact, and the artifact (not the transcript) carries the work forward.

### Detail is demoted, not destroyed

This is the crux of the concern, and it is worth stating precisely, because the two are easy to conflate:

- **Summarization destroys.** Prose folded into a summary cannot be recovered; what the summarizer dropped is gone, and what it got wrong is now the record.
- **Demotion does not.** An action moved out of standing context still exists verbatim in `ToolExecution` — parameters, result, success, audit class — and can be retrieved on demand by query (P4, just-in-time).

So the details of the activity are not being traded away for a smaller window. They are being moved from *standing context* to *retrievable context*. That is only possible because DPF has a system of record; it is the same advantage §3 identifies, applied to the turn rather than to the fold.

### The substrate exists, and it is switched off

This needs almost no new machinery — which matters, because §1 requires extending proven substrate rather than adding a parallel one. `apps/web/lib/tak/execution-plan.ts` (BI-2AC48661, EP-F7E35344) is **exactly layer 1**, and its design notes state the intent directly: the plan is *"a durable artifact, not a message that scrolls out of context."* It already provides:

- `ExecutionPlan { goal, steps[] { id, description, status } }`, persisted crash-durably on `AgentThread.executionPlan` and reloaded on resume;
- held in loop state **outside** the compacted message array and **re-rendered fresh into the prompt every iteration**, so it survives compaction by construction;
- completion gated on open steps rather than on a bare text reply — the mechanism that makes a turn terminate on *work done* instead of on the model deciding it has said enough;
- two plan-mutation tools intercepted inside the loop, needing no grant and writing no audit row;
- fully pure and unit-testable.

**It is inert.** `enableExecutionPlan` is declared at `agentic-loop.ts:1067` and read at `:1221` — and **set by no caller anywhere in the codebase**. Live confirmation: `AgentThread.executionPlan` is populated on **0 of 1,000 threads**.

So the platform already built the transaction artifact this request needs, proved it in unit tests, gave it crash durability, and never turned it on. That is the cheapest available move in this entire plan, and it is Phase 1.

### The risk that has to be designed for

A 27B Q4 local model cannot be trusted to faithfully call `update_execution_plan_step` every time it finishes something. If plan state depends on the model's diligence, the plan drifts from reality and becomes worse than no plan — a confidently wrong objective re-injected every iteration. P10 is explicit that non-negotiables are enforced deterministically, not by prompt hope.

**Therefore step status must be derived from the record wherever it can be.** A step whose completion corresponds to an observable action (a tool executed successfully, an artifact written, a governed transition recorded) is marked from `ToolExecution` / the work record, not from the model's self-report. The model proposes the plan; the record settles what is done. Self-reported status is the fallback for steps with no observable correlate, and should be marked as such so a reader can grade it.

## 5. Why instructions stop being followed: everything in a thread is treated as equally losable

The most common complaint about LLMs — *they don't follow instructions properly* — shows up here as a specific, measurable failure: on a long thread, truncation and compaction destroy critical detail. Those are the same problem. A constraint stated in turn 3 competes for window space with everything since, then becomes summarizer input, then becomes a clause in a paragraph, then is gone. The model is not disobeying a rule; **the rule stopped being present.**

### DPF already solved this for doctrine

Platform doctrine is not carried as prose the model is asked to remember. It is **reduced to weighted, tiered, dimensioned vectors that gate decisions** — verified live: `WikiPage.principleDimensionVector` is populated on **226 of 410 pages**, with `principleTier` on 213 (**47 commandment-tier, 144 core**, 15 contextual) and a `principleWeight` per page. `principle_decide` scores options against those magnitudes; `wiki_query` retrieves the reasoning only when it is wanted. The prose is a read, not a round-trip.

That is the right architecture, and it is worth naming why it works: **a commandment does not have to survive a context window, because it was never in one.** It gates the decision from outside the dialogue.

### The gap: thread-level constraints get none of that treatment

What doctrine has, a conversation does not. When an operator says *"never contact this customer directly,"* *"use the Q3 figures, not Q2,"* or *"this stays confidential"* in turn 3 of a coworker thread, that instruction is stored as an ordinary `AgentMessage`. It is indistinguishable, to every mechanism in the pipeline, from a pleasantry. It sits in the 8-message window until it ages out, gets folded into a summary, and then — at best — survives as a clause someone hopes the summarizer preserved.

**The channel for this exists and is effectively unused.** `UserFact` already carries exactly the right shape: `category` is a closed set of `preference | decision | constraint | domain_context`, with confidence, scope, sensitivity, supersession-not-deletion, and usage-based expiry. And critically, per P11's verified note, **memory facts live in the system prompt, which compaction never touches and which is rebuilt every turn.** A fact promoted into `UserFact` is *structurally* immune to the failure above.

Live state across the whole install — 3,543 messages, 1,000 threads, 144 facts total:

| category | rows | **live (not superseded)** |
|---|---|---|
| `preference` | 127 | **9** |
| `decision` | 11 | **0** |
| `domain_context` | 5 | **0** |
| `constraint` | **1** | **1** |

**One live constraint. Zero live decisions.** The compaction-proof channel was built, wired into the system prompt, and is essentially empty — so critical detail is never promoted out of the transcript into the place designed to protect it. It stays prose, and prose is what the fold destroys.

That is the mechanism behind the complaint. Not the model's obedience: the routing.

### The principle

> **Classify thread content by what its loss costs, and give each class the treatment that cost demands.** Compaction's defect is not that it drops things — it must — but that it drops a governing constraint and a pleasantry with equal willingness.

Three classes, each with a home that already exists:

| Class | Cost of loss | Treatment | Substrate |
|---|---|---|---|
| **Constraint / instruction** | Behavior changes — the visible "doesn't follow instructions" failure | **Never compactible.** Promote out of the transcript; enforce deterministically where it has a mechanical correlate | `UserFact` (`constraint` / `decision`), system prompt, kernel gate (P10) |
| **Activity / evidence** | Detail is destroyed; audit is broken | **Demoted, not destroyed** — exact, retrievable by query | `ToolExecution` (§3) |
| **Prose / intent** | Tolerable — gist suffices | **Compactible** — the LLM fold | `compactedSummary` (§6 Phase 3) |

Today all three are one undifferentiated `AgentMessage` array, compacted uniformly. Every finding in this spec is downstream of that single flattening.

### What this adds to the plan

**Constraint promotion becomes a first-class step, not a nightly nicety.** When a turn states a constraint or a decision, it is extracted and promoted to `UserFact` **at the turn**, before it can age out — not left to a sweep that has produced one live constraint in the platform's lifetime. This joins Phase 1: the ExecutionPlan anchors the *objective*, `UserFact` anchors the *constraints on how it may be met*, and the record anchors *what was actually done*. None of the three lives in the compactible array.

It also sets the honest acceptance test for this whole effort, which is not a token count:

> **State a constraint in turn 3. Run the thread past 200 turns and past a compaction fold. The constraint is still enforced — and it is enforced because it was promoted out of the dialogue, not because a summarizer happened to keep the sentence.**

## 6. Design

Six phases. Phase 0 is a precondition; Phases 1–3 are what the request actually asks for; 4 and 5 are the durable economy. The ordering follows §4: **the local path sets the architecture, and the frontier-only optimization comes last.**

### Phase 0 — Make it measurable (blocks everything else)
Nothing here should be tuned against an install that reports zeros.

- **Attribute inference to its thread.** Populate `AdapterRunTelemetry.threadId` (and `agentMessageId`) on every write via `adapter-telemetry-writer.ts`. This alone revives `getThreadSpend`.
- **Capture usage on the `anthropic-sub` path.** It carries the largest share of runs and reports `avg(inputTokens) = 16`. Until it reports honestly, cost governance is fiction.
- **Record `firstEventLatencyMs`** on every streamed run — the only honest answer to "it takes longer to come up."
- **Record `cachedInputTokens`.** `chat-adapter.ts:545` already reads `cache_read_input_tokens`; persist it. Joins BI-4761F54E and BI-3EC91596.
- **Populate `contextTrace`.** Written only inside the `useUnified` branch and has produced zero rows; establish whether that branch is inert here and either fix the write or record why the flag is off.
- **Link tool executions to their turn.** `ToolExecution.chatMessageId` is NULL on all 329,398 rows; populating it is what makes §3's record-based reconstruction span-accurate.
- **Populate `ToolExecution.inputTokens`** going forward (not retroactively — 329k rows).

*Acceptance:* a thread's spend, per-turn input tokens, TTFT and cache-hit rate are readable for a real thread. **No behavior change ships in this phase.**

### Phase 1 — Turn on the transaction anchor, and start promoting constraints
The cheapest move in the plan (§4, §5): both artifacts exist, are durable, are unit-tested, and are unused.

- **Set `enableExecutionPlan`** on the coworker path, starting where the objective is explicit and the window is tightest — local-served and workroom-scoped turns.
- **Derive step status from the record, not the model's self-report**, wherever a step has an observable correlate (§4, "the risk that has to be designed for"). Mark self-reported steps as self-reported.
- **Render the plan as layer 1 of the turn**, outside the compacted array — the loop already does this; it needs enabling, not building.
- **Keep it opt-out per route.** A short conversational turn should not be forced to author a plan.
- **Promote constraints and decisions at the turn (§5).** Extract stated constraints into `UserFact` (`constraint` / `decision`) as they are said, so they reach the compaction-proof system-prompt channel before they can age out. One live constraint install-wide is the baseline to beat.
- **Enforce deterministically where a constraint has a mechanical correlate** (P10) rather than re-stating it to the model and hoping.

*Acceptance:* `AgentThread.executionPlan` is non-null for planned turns; a thread resumed after a restart still knows its objective; measured (Phase 0) input tokens on a long thread stop tracking turn count; and the §5 test passes — a constraint stated in turn 3 is still enforced past turn 200 and past a fold.

### Phase 2 — Bound the fold, and make its failures loud
The direct fix for D1. Contained to `thread-checkpoint.ts` + its prisma binding.

- **Bound the load.** Add a `take` to `loadMessagesAfter`.
- **Make `CHECKPOINT_FOLD_BATCH` an actual batch size.** Fold at most one batch per advance and move the watermark to the end of it, so a 1,126-message thread converges across sweeps instead of failing forever on attempt one.
- **Bound the summarizer input in tokens**, following the Agent Framework rule: select whole messages that fit; if none fits, skip rather than attempt. A single 17,027-character message must not be able to wedge a thread.
- **A failed fold must be visible.** Promote the `console.warn` to a durable, queryable failure signal with its reason. Keep the `catch` — a failed fold must never break a turn — but stop discarding the outcome.
- **Backfill the wedged threads** once the batch loop exists.

*Acceptance:* the 1,126-message thread reaches a non-null `compactedSummary` with `compactedTurnCount` > 1,000 across repeated sweeps; `pruneSummarizedThreadMessages` becomes non-zero for it; a deliberately oversized message produces a recorded skip, not a silent stall. Tests stay pure — the module is already fully dependency-injected.

### Phase 3 — Record-first compaction pipeline
Gentlest-first, with the record ahead of the summarizer:

1. **Reconstruct aged tool activity from the record (§3)** — zero-inference and exactly faithful, read from `ToolExecution` (`toolName`, `success`, `summary`) for the span rather than re-summarized from the transcript. The largest reclaim; R9a's `compaction-digest.ts` already has the output shape, so generalize it across turns and source it from the record instead of writing a second digest.
2. **Summarize only the prose residue** — intent, preferences, constraints, decisions and their reasons — via Phase 2's bounded fold. With tool traffic served by step 1, this input is far smaller than today's.
3. **Recency window** — what exists today.
4. **Hard trim** — the existing token walk, demoted to an emergency backstop.

**Atomic tool-call groups are a hard constraint.** The current trim walks flat messages and can split an assistant tool call from its result; group-awareness lands with this phase.

*Acceptance:* measured input-token reduction on a long thread with no loss of tool-activity signal, and no orphaned call/result pairs.

### Phase 4 — Retention, and the latency path
- **Retention.** `scheduled:*` threads dispatch no history; they need a delete/archive policy, not a summarizer. `ToolExecution` at 890 MB needs the same. Routes through `2026-06-14-data-retention-lifecycle-governance-design.md` rather than a new policy surface.
- **Latency.** With TTFT measured, parallelize the independent pre-inference awaits in `sendCoworkerMessage` and hoist dynamic imports out of the critical path. Does not start until Phase 0 has a baseline.

### Phase 5 — Cache-aware ordering (frontier-only, secondary)
With `cachedInputTokens` recorded, P8 becomes verifiable rather than *[REVIEW]*. Injected blocks (plan, checkpoint, briefing) belong behind `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, ordered stable-first, so compaction does not rewrite the cached prefix each turn. **Last deliberately:** it only benefits workrooms that have opted into frontier capacity (§1, D2), so it must not shape the architecture the local path depends on. Joins BI-4761F54E.

## 7. Scope & non-goals

- **Not** a new compaction engine. Every change lands in `thread-checkpoint.ts`, `compaction-digest.ts`, the telemetry writer, or the nightly sweep.
- **Not** a change to what the interactive window sends today (8 messages / 2,000 tokens). That bound is already aggressive; if anything Phase 0's measurements may argue for *widening* it once the checkpoint is reliable.
- **Not** a memory-model change. `UserFact` scope, sensitivity, and supersession are untouched.
- **Not** a Build Studio / CLI-surface change. In-turn `compactAgenticMessages` behavior is unchanged.

## 8. Risks

- **Phase 0 may reveal the problem is elsewhere.** That is the point of sequencing it first, and it is a cheap phase.
- **Backfilling wedged threads spends inference.** The 1,126-message thread costs ~113 summarizer calls at a 10-message batch. Run it on the nightly sweep, not interactively, and cap per-run work.
- **`useUnified` may be off on this install**, which would mean the arbitrator path itself is inert — a materially larger finding than this spec assumes. Phase 0 resolves it.

## 9. Open question for the operator

D3 established that `scheduled:*` threads dispatch no history, so their unbounded growth is storage, not tokens. If the reported symptom was observed on a **scheduled or workroom coworker** rather than an interactive chat panel, the causal chain is different from the one in D1 and Phase 4 (retention) outranks Phase 1. Worth confirming which surface the symptom was seen on before implementation starts.
