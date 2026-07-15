-- EP-DELIVERY-FLOW BI-E731A6C1 (write-model): estimate-provenance facets on
-- BacklogItem. The effort estimate (jobSize) is the value/effort score's
-- denominator; these columns attribute WHOSE number it is (an AI coworker's
-- first-pass proposal, a human's confirm/overrule), carry an agreement flag, and
-- let the Delivery Flow surface AI<->human divergence. jobSize stays the
-- effective denominator scoring reads. Resolver:
-- apps/web/lib/demand/estimate-provenance.ts.
-- @migration-safety: data-safe: every column is a nullable addition; no drops,
-- no NOT NULL on existing rows, no backfill, no new constraints.
ALTER TABLE "BacklogItem"
    ADD COLUMN "estimateAiJobSize" DOUBLE PRECISION,
    ADD COLUMN "estimateAiById" TEXT,
    ADD COLUMN "estimateAiAt" TIMESTAMP(3),
    ADD COLUMN "estimateHumanJobSize" DOUBLE PRECISION,
    ADD COLUMN "estimateHumanById" TEXT,
    ADD COLUMN "estimateHumanAt" TIMESTAMP(3),
    ADD COLUMN "estimateSource" TEXT,
    ADD COLUMN "estimateAgreed" BOOLEAN;
