# Docs quick-help — owner-area coverage + overload ceilings (BI-2DD18122 final slice)

Date: 2026-07-22
Backlog: BI-2DD18122 (EP-UX-COGLOAD)

## Context

BI-2DD18122's acceptance requires every contextual Docs entry from the main
owner areas to land on a route-specific quick-help panel, with representative
sourceRoute tests and density ceilings. #3398 shipped the panel + resolver and
covered Storefront/Ops/Marketing; #3417 adds the archetype-aware storefront
help panel. This slice closes the remaining coverage: Workspace, People
(/employee), Finance, and Compliance (+ the /compliance/licensing leaf), plus
the acceptance-route test and a word-budget ceiling over every panel.

## Design grounding

Extends the existing SSOT — `apps/web/lib/docs-quick-help.ts` (data-only
route→five-question map from #3398) and its test. No new components, routes, or
contracts; the duplicate-Docs-label clause is already satisfied by
`CONTEXTUAL_DOCS_LABEL` ("Help for this page") in the shell action contract.

## Verification

- `docs-quick-help.test.ts`: acceptance-route coverage (all 9 named routes,
  five questions each), 60-word per-answer / 220-word per-panel ceilings across
  every registered route, leaf-over-family resolution for licensing.
- `ContextualQuickHelp.test.tsx` no-curated-help case re-pointed at a genuinely
  unmapped route (the /finance family is now covered).
