-- BI-ADEF2982 — optional organization-facing presentation preference for the
-- standing COO. Null preserves the ratified role-only default. This field is
-- never used for Agent identity, routing, authority, or attribution.
-- @migration-safety: data-safe: additive nullable column; every existing organization remains NULL.

ALTER TABLE "Organization"
  ADD COLUMN "cooConversationalName" TEXT;
