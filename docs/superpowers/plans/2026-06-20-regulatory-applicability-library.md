# Regulatory Applicability Library Plan

Backlog item: `BI-A6EF7E2C`

## Context

The installed business archetype is `software-platform`, but the Compliance > Library
regulation and obligation pages show every active seeded compliance record. Most seeded
records are for banking, credit union, cooperative, public-sector, public-safety, or
state municipal contexts. The library also hides the canonical source URL until the
regulation detail page, and many seed records do not currently populate `sourceUrl`.

## Objectives

1. Classify regulations and obligations against the installed business archetype and
   regional profile before rendering the library.
2. Default the library to records that apply to the installed business, while keeping
   reference records reachable for research and onboarding.
3. Add list-level details and source actions so the operator can validate why a record
   applies or why it is only reference material.
4. Backfill official source URLs in seed upserts where the source is stable and
   canonical.
5. Preserve theme-aware styling and use report-kit status components for badges.

## Design

- Add a small compliance-library read model in `apps/web/lib/compliance-library.ts`.
- Reuse `@dpf/db/regulation-applicability` for CADA's regional applicability logic.
- Map existing seeded industry values to installed archetype categories:
  - exact category or business context industry matches apply;
  - `financial` applies to banking/financial archetypes;
  - `cooperative` applies to cooperative archetypes;
  - `public-sector` applies to public-sector archetypes;
  - `public-safety` applies to law-enforcement/public-safety archetypes.
- Classify each record as `applies`, `review`, or `reference`, with a concise reason.
- Add scope filters (`Applies`, `Needs review`, `Reference`, `All`) that preserve the
  existing source-type, regulation, category, and status filters.
- Convert full-card links to explicit `Details` and `Source` actions.
- Show missing source metadata explicitly instead of implying it is documented.

## Verification

- Unit tests for applicability classification and scope filtering.
- Seed invariant tests for source URL coverage on seeded regulations where added.
- Render-level checks for the library panels so action links and applicability text are
  present.
- Source-local tests will run in the worktree if dependencies are available; runtime UI
  verification and production build require the canonical local install or shared
  local-CI convergence sandbox because this worktree is currently `source-only`.
