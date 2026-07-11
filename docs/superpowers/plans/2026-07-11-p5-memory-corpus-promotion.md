# P5 — Memory → corpus automatic promotion

- **BI:** BI-BC37727B · **Epic:** EP-27FD96BC
- **Scope spec:** `docs/superpowers/specs/2026-07-11-coworker-reasoning-economy-scope.md`
- **Kernel:** approach routed via `principle_decide` 2026-07-11 (guard off on the source branch). **Batch-nightly** over real-time fire-and-forget — composite 8.94 vs 7.04, high confidence; governing profile: platform. Rationale: keep LLM inference off the interactive write path; match the proof-point "a fact learned in chat appears in the corpus next day."

## Problem (from the audit)

Two information planes never touched. `enrichOrgCorpus` (the WWWD org-corpus façade) is fed only by onboarding market-context, business-document upload, and AI research (`EnrichmentSourceType` has `qa`/`data-entry` values but no feeder uses them). Coworker memory (`UserFact`) captures durable business facts in conversation but never routes them to the corpus. So a fact an employee tells a coworker ("we only ship to the EU on Tuesdays") stays private memory and never becomes reviewable org knowledge.

## The signal already exists

`UserFact.scope="org"` + `sensitivity="normal"` (set at write time by the memory-scope classifier, EP-8C706944 P4) is *exactly* "a durable business fact that belongs to the organization, readable across every employee." Those facts are org-corpus material — they were simply never promoted. No new classifier is needed; this BI is the missing adapter.

## Approach — a nightly promoter through the existing façade

Substrate-verify-first: reuse `enrichOrgCorpus` (draft-by-default, idempotent on sourceKey, embeds to Qdrant, links `PerspectiveMaterial`) and the existing nightly `runMemoryConsolidationSweep` (04:20 UTC, quiescence-gated). No new store, no new scheduler.

1. **Schema** — one additive, nullable column `UserFact.corpusPromotedAt DateTime?` (migration `20260711130000_add_user_fact_corpus_promoted`). NULL = not yet promoted. Makes the pass idempotent (never re-infer a promoted fact) and lets a superseded fact's replacement row (fresh NULL) re-promote and refresh the same corpus page.
2. **`apps/web/lib/tak/memory-corpus-promotion.ts`** (new):
   - `isPromotableFact` (pure): `scope==="org" && sensitivity==="normal" && !supersededAt && !corpusPromotedAt && category ∉ {preference}`. Preference facts are per-user relationship memory, not org knowledge.
   - `buildFactCorpusInput` (pure): fact → `enrichOrgCorpus` input; `sourceType:"qa"`, `trust:"first-party"`, `sourceRef` keyed on the stable `factKey` so a re-promotion upserts the same page.
   - `promoteOrgFactsToCorpus(deps)`: install-wide (one org), bounded per pass, per-fact isolated (one failure logged, pass continues), stamps `corpusPromotedAt` on success. Deps injectable for tests.
3. **Wire** — call it in `runMemoryConsolidationSweep` *after* the dedupe/expire pass, so the promoted fact is the settled survivor. Add `factsPromotedToCorpus` to the result.

## Non-goals
- Publishing corpus pages (stays draft — humans review via the existing overlay-draft affordance).
- Promoting per-user (`scope="user"`) or `sensitive` facts — those never leave their originating user.

## Verification
- Unit (`memory-corpus-promotion.test.ts`): the guard (org+normal+unpromoted+business-category only; rejects user-scope, sensitive, superseded, already-promoted, preference); the mapping (statement text, qa/first-party provenance, stable factKey sourceRef); the promoter (promotes eligible, stamps `corpusPromotedAt`, skips ineligible, survives a per-fact failure, no-op when no org).
- Behavioral: an org-scoped normal fact written today has `corpusPromotedAt` set and a draft WWWD overlay page after the nightly pass; re-running is a no-op (idempotent).
