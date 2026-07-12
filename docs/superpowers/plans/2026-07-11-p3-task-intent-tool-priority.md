# P3 — Task-intent-driven tool prioritization

- **BI:** BI-ACE1EBA4 · **Epic:** EP-27FD96BC
- **Scope spec:** `docs/superpowers/specs/2026-07-11-coworker-reasoning-economy-scope.md`
- **Kernel:** no work-scope/altitude sub-decision — a within-tier ordering refinement; authority and tier priority are unchanged.

## Problem (from the audit)

`selectCoworkerToolBudget` ranks tools by a static 4-tier priority (tier 0 essentials, 1 role, 2 core, 3 breadth) and, **within a tier, by original index**. So when the cap forces deferral, which tier-1/tier-3 tools survive is decided by whichever happened to come first in the list — never by relevance to what the turn is actually about. There was no task-intent signal anywhere in tool selection.

## Approach — intent as a within-tier tiebreaker

Substrate-verify-first: extend the existing budget selector; no new store, no change to tiers or authority. Composes with P1's `EffortWarrant.toolBudgetTarget` and BI-2B2F59EB's accuracy-cliff cap (they set the cap; this decides which tools fill it).

1. `coworker-tool-budget.ts` — add `scoreToolIntentRelevance` / `tokenizeIntent` (pure, cheap token overlap of the turn against a tool's name + description; no embedding on the hot path) and an optional `intentQuery` param. The sort becomes `tier ASC, intent-score DESC, original index` — so within a priority tier the most task-relevant tools are kept under the cap. Absent `intentQuery` every score is 0 and it reduces to the prior `tier, index` order **exactly** (regression guard).
2. `agent-coworker.ts` — pass the user's turn (`trimmedContent`) as `intentQuery`.

## Verification
- Unit (`coworker-tool-budget.test.ts`, 22/22): scorer overlap; the relevant tool survives the cap within a tier while irrelevant ones defer; intent never overrides tier priority (a highly-relevant breadth tool still loses to a role tool); no-intent path is byte-identical to the prior stable order.
- Typecheck clean.

## Non-goals
- Cross-tier reordering (tier priority is intentionally authoritative — a role tool always outranks a breadth tool).
- Embedding-based ranking (token overlap keeps this off the per-turn hot path).
