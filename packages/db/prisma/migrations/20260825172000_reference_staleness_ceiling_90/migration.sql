-- Acquired external reference corpora carry a staleness budget describing how
-- long a mirrored row may go unconfirmed against its issuing authority. The
-- operator-set ceiling is 90 days (founder-directed 2026-08-25): a row may be
-- re-verified sooner, never later.
--
-- Two changes, both required. Lowering the column default only governs rows
-- inserted from here on; existing installs already hold rows at 120 and 180
-- days, and those are exactly the rows most likely to have drifted. The UPDATE
-- clamps them, so the ceiling applies to the estate rather than only to new
-- data.

ALTER TABLE "TaxJurisdictionReference" ALTER COLUMN "staleAfterDays" SET DEFAULT 90;
ALTER TABLE "LicenseRequirementReference" ALTER COLUMN "staleAfterDays" SET DEFAULT 90;

UPDATE "TaxJurisdictionReference"
SET "staleAfterDays" = 90
WHERE "staleAfterDays" > 90;

UPDATE "LicenseRequirementReference"
SET "staleAfterDays" = 90
WHERE "staleAfterDays" > 90;

-- A non-positive budget would read as "never stale" everywhere the clock is
-- evaluated, which is the failure this work exists to remove.
UPDATE "TaxJurisdictionReference"
SET "staleAfterDays" = 90
WHERE "staleAfterDays" <= 0;

UPDATE "LicenseRequirementReference"
SET "staleAfterDays" = 90
WHERE "staleAfterDays" <= 0;
