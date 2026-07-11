-- BI-BC37727B (EP-27FD96BC P5): memory→corpus automatic promotion marker.
-- Records when a durable org-scoped UserFact was promoted into the WWWD org
-- corpus by the nightly promoter, so the pass never re-infers an unchanged fact.
-- Additive + nullable — every existing fact stays NULL (not yet promoted), so no
-- existing row can violate this and no backfill runs.
-- @migration-safety: data-safe: nullable column, no default, no backfill.
ALTER TABLE "UserFact" ADD COLUMN "corpusPromotedAt" TIMESTAMP(3);
