-- CRM Foundation: Contact & Account Extensions
-- EP-CRM-001 P1-P4: Extended contact model, many-to-many Contact↔Account,
-- extended account model, full-text search vectors

-- AlterTable: CustomerAccount extensions
ALTER TABLE "CustomerAccount" ADD COLUMN     "annualRevenue" DECIMAL(65,30),
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'GBP',
ADD COLUMN     "employeeCount" INTEGER,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "parentAccountId" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceSystem" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable: CustomerContact extensions
ALTER TABLE "CustomerContact" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "doNotContact" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "linkedinUrl" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable: ContactAccountRole (many-to-many junction)
CREATE TABLE "ContactAccountRole" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "roleTitle" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactAccountRole_pkey" PRIMARY KEY ("id")
);

-- Indexes for ContactAccountRole
CREATE INDEX "ContactAccountRole_contactId_idx" ON "ContactAccountRole"("contactId");
CREATE INDEX "ContactAccountRole_accountId_idx" ON "ContactAccountRole"("accountId");
CREATE INDEX "ContactAccountRole_isPrimary_idx" ON "ContactAccountRole"("isPrimary");
CREATE UNIQUE INDEX "ContactAccountRole_contactId_accountId_startedAt_key" ON "ContactAccountRole"("contactId", "accountId", "startedAt");

-- Indexes for CustomerAccount
CREATE INDEX "CustomerAccount_status_idx" ON "CustomerAccount"("status");
CREATE INDEX "CustomerAccount_parentAccountId_idx" ON "CustomerAccount"("parentAccountId");

-- Indexes for CustomerContact
CREATE INDEX "CustomerContact_lastName_idx" ON "CustomerContact"("lastName");
CREATE INDEX "CustomerContact_phone_idx" ON "CustomerContact"("phone");

-- Foreign Keys
ALTER TABLE "CustomerAccount" ADD CONSTRAINT "CustomerAccount_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContactAccountRole" ADD CONSTRAINT "ContactAccountRole_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CustomerContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactAccountRole" ADD CONSTRAINT "ContactAccountRole_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: backfill ContactAccountRole from existing accountId FK
-- Every existing contact gets a primary role for their current account
INSERT INTO "ContactAccountRole" ("id", "contactId", "accountId", "isPrimary", "startedAt", "createdAt")
SELECT
  gen_random_uuid()::text,
  cc.id,
  cc."accountId",
  true,
  cc."createdAt",
  NOW()
FROM "CustomerContact" cc
WHERE cc."accountId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Data migration: split existing name field into firstName/lastName
UPDATE "CustomerContact"
SET
  "firstName" = CASE
    WHEN "name" IS NOT NULL AND position(' ' in "name") > 0
    THEN trim(substring("name" from 1 for position(' ' in "name") - 1))
    ELSE "name"
  END,
  "lastName" = CASE
    WHEN "name" IS NOT NULL AND position(' ' in "name") > 0
    THEN trim(substring("name" from position(' ' in "name") + 1))
    ELSE NULL
  END
WHERE "name" IS NOT NULL AND "firstName" IS NULL;

-- Full-text search: add tsvector columns and GIN indexes
ALTER TABLE "CustomerContact" ADD COLUMN IF NOT EXISTS "searchVector" tsvector;
ALTER TABLE "CustomerAccount" ADD COLUMN IF NOT EXISTS "searchVector" tsvector;

CREATE INDEX IF NOT EXISTS "CustomerContact_searchVector_idx" ON "CustomerContact" USING GIN ("searchVector");
CREATE INDEX IF NOT EXISTS "CustomerAccount_searchVector_idx" ON "CustomerAccount" USING GIN ("searchVector");

-- Populate search vectors for existing data
UPDATE "CustomerContact"
SET "searchVector" = to_tsvector('english',
  coalesce("firstName", '') || ' ' ||
  coalesce("lastName", '') || ' ' ||
  coalesce("name", '') || ' ' ||
  coalesce("email", '') || ' ' ||
  coalesce("phone", '') || ' ' ||
  coalesce("jobTitle", '')
);

UPDATE "CustomerAccount"
SET "searchVector" = to_tsvector('english',
  coalesce("name", '') || ' ' ||
  coalesce("industry", '') || ' ' ||
  coalesce("website", '') || ' ' ||
  coalesce("notes", '')
);

-- Trigger: auto-update CustomerContact searchVector on insert/update
CREATE OR REPLACE FUNCTION customer_contact_search_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector('english',
    coalesce(NEW."firstName", '') || ' ' ||
    coalesce(NEW."lastName", '') || ' ' ||
    coalesce(NEW."name", '') || ' ' ||
    coalesce(NEW."email", '') || ' ' ||
    coalesce(NEW."phone", '') || ' ' ||
    coalesce(NEW."jobTitle", '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_contact_search ON "CustomerContact";
CREATE TRIGGER trg_customer_contact_search
  BEFORE INSERT OR UPDATE ON "CustomerContact"
  FOR EACH ROW EXECUTE FUNCTION customer_contact_search_update();

-- Trigger: auto-update CustomerAccount searchVector on insert/update
CREATE OR REPLACE FUNCTION customer_account_search_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector('english',
    coalesce(NEW."name", '') || ' ' ||
    coalesce(NEW."industry", '') || ' ' ||
    coalesce(NEW."website", '') || ' ' ||
    coalesce(NEW."notes", '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_account_search ON "CustomerAccount";
CREATE TRIGGER trg_customer_account_search
  BEFORE INSERT OR UPDATE ON "CustomerAccount"
  FOR EACH ROW EXECUTE FUNCTION customer_account_search_update();
