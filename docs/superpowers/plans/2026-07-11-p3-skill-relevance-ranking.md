# P3 — Relevance-ranked skill eligibility

- **BI:** BI-2435BD7F · **Epic:** EP-27FD96BC
- **Scope spec:** `docs/superpowers/specs/2026-07-11-coworker-reasoning-economy-scope.md`
- **Kernel:** approach routed via `principle_decide` 2026-07-11 (guard off on the source branch). **THRESHOLD-CAP** (keep all when small; top-N by relevance only when the set exceeds the cap) over reorder-only (doesn't cut the tax) or hard-cap (hides skills from light agents) — composite 8.21 vs 6.73 / 6.22, high confidence.

## Problem (from the audit)

`getSkillsForAgent` returns every active+enabled skill assigned to a coworker, and `toSkillSummariesForPrompt` → `assembleSystemPrompt` injects *every* summary into the system prompt on *every* turn (`prompt-assembler.ts:218`), with no relevance filtering or cap. There is no ranking anywhere in the skills code. On a skill-heavy coworker this is a growing per-turn token tax the model mostly pays to ignore.

## Approach — rank, cap only when large

Substrate-verify-first: the seam is exactly between `getSkillsForAgent` (`runtime.ts:69`) and `toSkillSummariesForPrompt` (`runtime.ts:163`); no store or schema change.

1. `apps/web/lib/skills/skill-relevance.ts` (new, pure): `rankSkillsByRelevance(skills, query, cap=12)`. At or below the cap → returned **unchanged** (byte-for-byte today's behavior — regression guard). Above the cap → the top-`cap` by cheap token-overlap relevance (query tokens ∩ skill label/description/category/tags/id) plus a trigger-pattern-match bonus; ties keep the caller's priority order. No embedding call on the hot path.
2. Apply in `agent-coworker.ts` at both the unified (`:941`) and legacy (`:1194`) skill-assembly sites, ranking against the user's turn (`trimmedContent`) before projecting to summaries — so the `eligible` telemetry reflects exactly what is injected.

## Verification
- Unit (`skill-relevance.test.ts`): tokenizer; scoring (token overlap + trigger bonus + invalid-pattern safety); ranker returns the set unchanged at/below cap, keeps the most-relevant top-N above cap, and breaks ties by priority order for an irrelevant query.
- Typecheck clean. Behavioral: a coworker with ≤12 skills is unchanged; a skill-heavy coworker injects only the 12 most relevant to the turn.

## Non-goals
- Embedding-based semantic ranking (a token-overlap heuristic keeps this off the per-turn hot path; the cliff being solved is token tax, not recall precision).
- Changing skill *invocation* — only which summaries are *disclosed*.
