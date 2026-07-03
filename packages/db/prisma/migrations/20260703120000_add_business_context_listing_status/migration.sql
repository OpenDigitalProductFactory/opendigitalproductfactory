-- Add corporate-law legal-form / market-listing status to BusinessContext.
-- Orthogonal to the industry archetype: any archetype can be a listed or private
-- company. Gates listing-specific governance regimes such as the UK Corporate
-- Governance Code Provision 29 (UK premium-listed companies). Nullable + no
-- default: an existing install is "undeclared" until the operator confirms it,
-- so a listing-gated regulation is surfaced as "review", never silently applied.
ALTER TABLE "BusinessContext" ADD COLUMN "listingStatus" TEXT;
