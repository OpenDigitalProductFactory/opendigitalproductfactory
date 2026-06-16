# Profession-corpus runtime injection (WSID Phase 3)

**Date:** 2026-06-16
**Status:** Implemented
**Predecessor:** PR #2016 — *fix: close AI Workforce profession coverage gaps* (coverage/mapping/visibility)
**Epic context:** EP-WSID (WSID — per-coworker professional corpus & knowledge graph)

## Problem — coverage is not usage

PR #2016 guaranteed that every one of the 82 AI coworkers **resolves** to exactly
one profession family with a **seeded** corpus, and surfaced that on `/platform/ai`.
But it stopped at *visibility*. A profession-substrate audit confirmed the harder
gap:

- `resolveProfessionProfile` / `findProfessionFamilyForAgentIdentity` had **zero
  runtime consumers** — they were called only by HRIS/display surfaces
  (`coworker-record/*`, `wiki/perspectives`).
- Nothing **injected** a coworker's profession corpus into its prompt at runtime.
  The generic `recallWikiContext` is org-scoped vector search; profession pages are
  seeded with `organizationId = null` and are **not embedded in Qdrant** (Phase 2
  seeded Postgres rows only) — so generic recall essentially never surfaced them.
- No **evidence** that corpus was used or missed; no profession-specific **gap
  capture**; no operator view of usage vs. growth.

Net: the corpus existed but coworkers reasoned without it.

## Design decision — retrieval + arbitration, not prompt-stuffing

The WSID spec (`docs/superpowers/specs/2026-06-09-wsid-coworker-professional-corpus-design.md`)
intended runtime access via the **decision gate** (`evaluateDecisionPerspective` +
Qdrant material recall) and §3 lists *"prompt-stuffed expertise / giant role
prompts"* as an anti-pattern. The operator directive for this work is explicit:
inject the corpus into **every coworker response**, high-priority in context
arbitration, subject to token budget.

These are **complementary, not contradictory**:

- The gate covers *decision points*; the directive covers *every response*.
- The anti-pattern targets *static, hardcoded* expertise. This implementation is
  **retrieval-based, token-bounded, context-arbitrated, and cited** — the opposite
  of a giant static prompt.

So Phase 3 here implements the "every response" layer as retrieval under the
existing context-arbitration budget. (Wiring `resolveProfessionProfile` into the
decision gate itself remains valid future work and is not foreclosed.)

Retrieval ranks via a deterministic **lexical** scorer rather than Qdrant because
profession pages are not embedded; the lexical path needs no vector sidecar, works
on a cold install, and is fully unit-testable. It can swap to vector recall behind
the same return shape once profession pages are embedded.

## Architecture

```
Agent identity ──► findProfessionFamilyForAgentIdentity ──► professionKey
   │                                                            │
   │                                              wsid-<key> profileId
   ▼                                                            │
prisma.wikiPage (slug startsWith `professions/<key>/`, published)
   │
   ▼  rankCorpusPages (lexical, deterministic)
prompt-ready excerpts ──► Block 5 (above generic wiki) ──► coworker prompt
   │
   ▼  recordProfessionCorpusEvidence (fire-and-forget, fail-open)
ProfessionCorpusUsageStat (injected/missed per family/day)
ProfessionCorpusGap        (deduped growth backlog: unmapped | empty-corpus | low-relevance | deferred)
```

### New code
- `apps/web/lib/decision-perspective/profession-corpus.ts` — `resolveProfessionCorpusContext`
  (the single retrieval entry point) + lexical ranker + formatter. Pure, db-injected.
- `apps/web/lib/decision-perspective/profession-corpus-evidence.ts` — `recordProfessionCorpusUsage`,
  `recordProfessionCorpusGap` (deduped upsert by fingerprint), `recordProfessionCorpusEvidence`
  orchestrator. Fail-open.
- `apps/web/lib/coworker-record/corpus-signals.ts` — operator rollups (usage + open gaps).
- `apps/web/components/platform/coworker-record/ProfessionCorpusPanel.tsx` — report-kit
  StatCards + growth-queue DataTable on `/platform/ai`.
- DB: `ProfessionCorpusGap`, `ProfessionCorpusUsageStat` (+ migration
  `20260616120000_add_profession_corpus_runtime`).

### Wiring
- `assembleSystemPrompt` gains `professionContext?` rendered at the TOP of Block 5,
  **above** generic `wikiContext`.
- `agent-coworker.ts` `sendMessage` (both unified + legacy paths): resolves the
  corpus once, registers it as an **L1 priority-1** arbitrated source (compressible
  to abstracts-only), passes the survivor to the assembler, and records evidence +
  telemetry fire-and-forget. Fail-open throughout — a corpus/DB failure never
  blocks a coworker response.

### Operator UX
- `/platform/ai`: usage/miss StatCards + deduped growth-queue table.
- Coworker record → *Profession & Knowledge* tab: per-family injections / misses /
  injection-rate / open gaps.

## Invariants (tests)
- Every active coworker → exactly one profession family *(existing, PR #2016)*.
- Every family has non-empty corpus *(existing, PR #2016)*.
- A resolved coworker prompt includes profession corpus context, OR a miss is
  recorded — `profession-corpus.test.ts`, `prompt-assembler.test.ts`.
- Misses recorded, not swallowed; gap/usage upserts idempotent —
  `profession-corpus-evidence.test.ts`.
- The sendMessage prompt path attempts retrieval + records evidence —
  `profession-corpus-wiring.test.ts`.

## Fail-open posture
Every runtime write is fire-and-forget and swallows its own errors; the identity
lookup is guarded against synchronous throws (partial mocks / DB outage). Corpus
retrieval failure degrades to a normal (corpus-blind) response plus a recorded
`error` status — never an exception into the response path.
