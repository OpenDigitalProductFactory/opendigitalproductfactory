-- Portfolio coverage axis + source attribution as typed columns (BI-PORTCOV-P0).
-- Nullable + additive: existing rows stay null; the source projectors populate
-- these (alongside the DigitalProduct.observationConfig markers that current
-- readers use). The closed enums live in TS
-- (packages/db/src/portfolio-sources/types.ts); the DB column is the typed home.
ALTER TABLE "DigitalProduct" ADD COLUMN "coverageStatus" TEXT;
ALTER TABLE "DigitalProduct" ADD COLUMN "sourceKind" TEXT;
