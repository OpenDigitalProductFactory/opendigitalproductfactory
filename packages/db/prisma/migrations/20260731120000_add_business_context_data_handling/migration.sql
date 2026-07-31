-- Data-handling predicate profile on BusinessContext (BI-242F344C).
-- Carries the DATA_HANDLING_PREDICATES an org declares at setup (processes-
-- personal-data, sends-marketing, deploys-automated-decisioning, …). Drives
-- horizontal-regulation scoping (privacy, breach, AI, marketing, accessibility)
-- which gate on WHAT the org does with data, not on its industry archetype.
-- Empty default → a data-handling-gated regulation surfaces as "review" until
-- the operator declares the profile, never silently applied.
ALTER TABLE "BusinessContext" ADD COLUMN "dataHandling" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
