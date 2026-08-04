-- Functional-domain attribution on Regulation (BI-0B867B67).
-- Which part of the business owns tracking a regulation (privacy-security,
-- hr-employment, finance, ai-governance, …). ATTRIBUTION/REPORTING ONLY — does
-- NOT affect applicability. Additive + nullable: existing rows tolerate NULL
-- (treated as cross-cutting) until the companion backfill sets them.
ALTER TABLE "Regulation" ADD COLUMN "domain" TEXT;
