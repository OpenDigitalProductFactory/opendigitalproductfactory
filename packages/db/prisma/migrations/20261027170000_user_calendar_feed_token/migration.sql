-- BI-051A74CE: the calendar .ics feed served any user's merged calendar to
-- anyone holding that user's id. Subscription now needs a per-user, revocable
-- token; only its SHA-256 is stored, on the account it belongs to.
--
-- Additive: two nullable columns and a unique index. Every existing row gets
-- NULL (no subscription link), which the feed treats as "refuse", so an install
-- with users and an empty install apply identically. Re-runnable.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "calendarFeedTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "calendarFeedTokenIssuedAt" TIMESTAMP(3);
-- @migration-safety: data-safe: calendarFeedTokenHash is added by this migration, so every existing row holds NULL when the unique index is built; Postgres unique indexes never treat NULLs as duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "User_calendarFeedTokenHash_key" ON "User"("calendarFeedTokenHash");
