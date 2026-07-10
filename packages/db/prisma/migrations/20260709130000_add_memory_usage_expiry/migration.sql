-- BI-153F7E4A (EP-8C706944 P2): usage-based expiry tracking on the memory stores.
-- Additive, nullable + defaulted — safe against any existing row.
-- @migration-safety: data-safe: every added column is nullable or has a DEFAULT, so no existing UserFact/CoworkerMemoryNote row can violate it.
ALTER TABLE "UserFact" ADD COLUMN "lastAccessedAt" TIMESTAMP(3);
ALTER TABLE "UserFact" ADD COLUMN "useCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CoworkerMemoryNote" ADD COLUMN "lastAccessedAt" TIMESTAMP(3);
ALTER TABLE "CoworkerMemoryNote" ADD COLUMN "useCount" INTEGER NOT NULL DEFAULT 0;
