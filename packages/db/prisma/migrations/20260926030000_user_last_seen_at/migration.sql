-- BI-61DE8177: record when a workforce user last used the portal, so a coworker
-- approval routed to an account nobody reads can be flagged to an operator
-- instead of waiting silently.
--
-- Forward-only and additive. The column is nullable and never backfilled:
-- there is no historical sign-in record to derive it from, and NULL honestly
-- means "not seen since tracking began". IF NOT EXISTS keeps a re-run harmless
-- against any data state.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
