-- BI-997503EC: user-configurable notification subscription rules. A user-owned
-- rule = event category + optional equality filter + channel + cadence; matching
-- immediate rules produce a Notification row when an event is dispatched.
-- Additive-only.
--
-- @migration-safety: data-safe: creates one new table with FK to "User"
-- (ON DELETE CASCADE) and no changes to existing tables or rows; nothing to
-- backfill and no existing row can violate the new indexes.

CREATE TABLE "NotificationSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventCategory" TEXT NOT NULL,
    "filter" JSONB,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "cadence" TEXT NOT NULL DEFAULT 'immediate',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationSubscription_userId_active_idx" ON "NotificationSubscription"("userId", "active");

CREATE INDEX "NotificationSubscription_eventCategory_active_idx" ON "NotificationSubscription"("eventCategory", "active");

ALTER TABLE "NotificationSubscription" ADD CONSTRAINT "NotificationSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
