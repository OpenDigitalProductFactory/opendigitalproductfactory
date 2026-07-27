-- BI-FS-003: additive notification preference fields on CustomerContact.
-- @migration-safety: data-safe: both columns are nullable with no NOT NULL and no UNIQUE;
-- existing rows stay valid with NULL meaning "preference not set yet".

ALTER TABLE "CustomerContact"
ADD COLUMN "preferredNotificationChannel" TEXT,
ADD COLUMN "phoneType" TEXT;
