# Extractive Compaction Digest (R9a)

**Status:** SHIPPED. Pure digest builder unit-tested; the `compactAgenticMessages` integration is a pure transform, also covered.
**Date:** 2026-06-20
**Standard:** `docs/architecture/context-engineering-standards.md` (P11). **Parent:** `docs/superpowers/specs/2026-06-20-context-engineering-tool-efficiency-design.md` (R9a — the real residual surfaced when R9-as-reinjection was closed as a non-problem).

## 1. Why

`compactAgenticMessages` keeps `messages[0]` + the last N and **drops the middle of a long turn entirely**. Whatever the agent did in that dropped span — the tools it already ran, the ones that failed — vanishes silently. On a long local-window turn the model can then repeat completed work or re-hit a known failure. Anthropic's compaction *summarizes* the dropped span; DPF's *truncates* it. This was the genuine residual P11 gap (memory facts already survive — they live in the system prompt; this is about the dropped message history).

## 2. The local-first constraint shapes the design

A full **LLM summarization pass is the wrong tool on the single-GPU local-first path**: it would block the one model and consume the very window we're economizing. So the digest is **extractive — deterministic, zero-inference**: it distills the *tool activity* of the dropped span (which tools ran, how often, what failed), which is the reliably-extractable, high-signal part. Plain prose ("I'll try approach X") is not extracted — preserving arbitrary text faithfully would need an LLM, exactly what we avoid; truncating it is acceptable, while losing *actions* is not (actions are what cause repeated/again-failing work).

## 3. Design

- **`apps/web/lib/tak/compaction-digest.ts`** — pure, import-free (mirrors `context-pressure.ts`). `summarizeDroppedMessages(dropped)` walks the dropped span, tallies tool calls per tool (from assistant `toolCalls`) and failures (a failed tool result is serialized `Error: …` by the loop), and returns one line: *"Earlier this turn, N message(s) were compacted… Tools already used: search_knowledge ×2, run_sandbox_tests ×1 (1 failed). Don't repeat completed work; recheck any failures before retrying."* Returns `null` when the span has no tool activity.
- **`compactAgenticMessages`** — when `messages.length > maxHistory`, computes the dropped span, builds the digest, and re-inserts it as a short `[System notice]` **assistant** message right after `messages[0]` (assistant role avoids the consecutive-*user*-turn issue `withPlanReminder` documents). The digest then flows through the existing orphan-filter + content-truncation unchanged, so it's bounded like any other message. Unknown/short turns are byte-identical to before (no digest).

## 4. Scope & non-goals

- Preserves **tool activity**, not arbitrary prose (that needs an LLM — out of scope on local).
- Zero extra inference; deterministic; on by default (a strict improvement over silent dropping; trivially revertible — it only triggers when a turn exceeds `maxHistory` and has tool activity in the dropped middle).
- Does **not** change what survives for short turns, nor the caps, nor the system prompt (memory facts already survive there — see the R9 finding).

## 5. Tests

`apps/web/lib/tak/compaction-digest.test.ts` — null on empty / no-tool-activity spans, tool tallies, failure flagging via `Error:`, deterministic sort. Pure, runs in CI.

## 6. Files

- `apps/web/lib/tak/compaction-digest.ts` (+ `.test.ts`).
- `apps/web/lib/tak/agentic-loop.ts` — `compactAgenticMessages` digest insertion.
