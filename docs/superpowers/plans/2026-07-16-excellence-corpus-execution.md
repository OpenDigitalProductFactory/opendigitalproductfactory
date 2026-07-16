# Excellence Corpus — execution plan (workstream B)

**Program:** [Living Business Excellence](../specs/2026-07-15-living-business-excellence-program-design.md) §2 (row B)
**Epic / BI:** `EP-LIVING-BUSINESS-EXCELLENCE` · `BI-44EF78DE`
**Started:** 2026-07-16

## Why

A new business starts closer to a blank slate than it should. The program's thesis is *priming, not
blank slate*: seed each archetype with a picture of **what great looks like** so the AI cog starts
from excellence. The demo-flavor `notes` authored in A·P3 are the seed; workstream B turns them into
per-archetype priming material in the org's WWWD corpus.

## What landed

- `apps/web/lib/onboarding/excellence-corpus.ts` — `deriveExcellenceCorpus({ archetypeId, industry,
  ctaType })` → `{ whatGreatLooksLike, northStarKpis, goodOperatorMoves, primaryGoal }`. Composes the
  shipped per-archetype signal — the demo-flavor `notes` (A·P3, the "what great feels like" line),
  `getPlaybook` KPIs (north-star metrics) — with a thin authored per-category **good-operator moves**
  floor. Derive-with-override; pure and deterministic. `excellenceCorpusToMarkdown` renders it as a
  WWWD wiki-page body.
- `apps/web/lib/onboarding/seed-org-wwwd-corpus.ts` — seeds an **`org-what-great-looks-like`** page
  (pageKind `principle`, `plan-readiness` bundle) alongside the existing identity + stance pages, at
  the same **unconfirmed B/0.6** confidence. It clears nothing on its own (effective 0.45 < every
  band) — the owner confirms/refines it, upgrading to A/0.9, exactly like the stance vectors.

This is the convergence the program names: the same curated material (the flavor `notes`) now feeds
**both** demo fidelity (workstream A) and WWWD priming (this).

**Verified:** `deriveExcellenceCorpus` + markdown unit tests; the seed corpus now lands **10 pages /
13 materials** (was 9/12) at B/0.6, asserted in `seed-org-wwwd-corpus.test.ts`; idempotent re-run
unchanged; typecheck clean.

## Non-goals / follow-ons

- Not auto-confirmed: seeded at B/0.6 so it primes but does not act until the owner confirms
  (matches the stance-onboarding contract).
- Per-archetype good-operator moves start at the category floor; fan out to flagship-specific moves
  as fidelity is raised (same incremental path as the flavor registry).
