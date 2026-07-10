# Session-start projection briefing — implementation plan

- **BI:** BI-A9052DCB (EP-8C706944 — AI Coworker Memory & Context Architecture, Phase 3)
- **Date:** 2026-07-09
- **Kernel ledger:** DI-F69AE978B70C
- **Status:** Projection substrate + builder + lazy generation + injection (this PR)

## Problem

A coworker rehydrates cross-session context only via the recency window + vector recall. There is no precomputed "what you already know about this user" briefing, so continuity depends on RAG over transcripts — opaque, cache-unfriendly, and weak for non-technical conversational use.

## Design

ChatGPT's reference-chat-history model: derived profile sections refreshed offline, injected at session start — not transcript search.

1. **Projection store** `CoworkerBriefing` (new table, additive migration `20260709140000_add_coworker_briefing`): keyed `(agentId, scope, scopeKey)` — `scope="user"` keyed by userId (org scope reserved for BI-1772D0B7). Holds `content`, `sourceDigest`, `generatedAt`. New table only → data-safe.
2. **Pure builder** `coworker-briefing.ts`: `buildBriefingContent(sources)` assembles a capped, sectioned block (facts, working notes, recent context, spend) from already-selected source data, null when there is no signal; `briefingSourceDigest` (FNV-1a) lets the refresh skip an unchanged rebuild; `formatBriefingMessage` renders the prependable message. Deterministic → 9 unit tests.
3. **Runner** `coworker-briefing-runner.ts`: `gatherUserBriefingSources` pulls governed records (user facts, the coworker's working notes via cuid resolution, the most recent thread's durable checkpoint), `generateUserBriefing` upserts the projection (skips when digest unchanged, deletes when signal drops to nothing), `loadUserBriefingMessage` reads it and fire-and-forget refreshes when older than `BRIEFING_STALE_MS` (24h) — offline/lazy so no session waits.
4. **Injection** (`agent-coworker.ts`): prepend the briefing ahead of the recency window (same proven pattern as the BI-FDECBE0A checkpoint — strict no-op when absent, non-fatal on error).

## Non-goals (own BIs)

- Org-scoped briefings and the two-scope private/shared split → BI-1772D0B7 (the `scope="org"` key is reserved here).
- Surfacing/pruning briefings in the audit UI → BI-DC8B03AB.
- Nightly (vs lazy) regeneration — the lazy 24h refresh is self-maintaining; moving generation into the autoDream pass is a later optimization.

## Verification

- Unit: `coworker-briefing.test.ts` (9 — no-signal null, section rendering, business-line-only, fact cap, content cap, digest stability/change, message formatting).
- Runtime (post-merge): a returning user's second session prepends a `[SESSION BRIEFING]` block summarizing their known facts + the coworker's notes; a brand-new relationship injects nothing; the row refreshes at most daily.
