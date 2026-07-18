-- EP-ORG-LOCALE-CURRENCY / BI-0530BB74 — retire the British-by-default bias.
--
-- DPF defaulted `currency` to GBP across ~two dozen finance/commerce models and
-- StorefrontConfig.timezone to Europe/London, with no org-level locale source.
-- This migration:
--   1. Extends OrgSettings (the single-org spine) into the locale/currency source
--      of truth: adds `locale` + `countryCode`, and flips baseCurrency's DEFAULT
--      from GBP to the neutral USD (matching the app-create default).
--   2. Flips the hardcoded GBP column DEFAULTs to USD so new rows are no longer
--      British-by-default. Existing amounts are NOT re-denominated — changing a
--      column DEFAULT never rewrites existing rows, and silently relabelling a
--      persisted amount's currency would be wrong. Re-denomination of any real
--      GBP data is a separate, operator-visible decision under EP-ORG-LOCALE-CURRENCY.
--   3. Flips StorefrontConfig.timezone DEFAULT to the neutral UTC.
--   4. Backfills the existing OrgSettings singleton: locale derived from its
--      baseCurrency, countryCode from the org's tax profile home country when set.

-- 1. OrgSettings: new locale/currency spine columns + neutral baseCurrency default.
ALTER TABLE "OrgSettings"
  ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en-US',
  ADD COLUMN "countryCode" TEXT;

ALTER TABLE "OrgSettings" ALTER COLUMN "baseCurrency" SET DEFAULT 'USD';

-- 2. Flip the hardcoded GBP column defaults to USD (new-row defaults only).
ALTER TABLE "CustomerAccount" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "CustomerConfigurationItem" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "Opportunity" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "Quote" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "SalesOrder" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "Subscription" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "TaxLiabilityEntry" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "StorefrontItem" ALTER COLUMN "priceCurrency" SET DEFAULT 'USD';
ALTER TABLE "StorefrontOrder" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "RentalAgreement" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "StorefrontDonation" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "Invoice" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "Payment" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "Supplier" ALTER COLUMN "defaultCurrency" SET DEFAULT 'USD';
ALTER TABLE "Bill" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "PurchaseOrder" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "BankAccount" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "RecurringSchedule" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "ExpenseClaim" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "ExpenseItem" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "FixedAsset" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "LedgerAccount" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "JournalEntry" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "JournalLine" ALTER COLUMN "currency" SET DEFAULT 'USD';

-- 3. StorefrontConfig: neutral timezone default (was Europe/London).
ALTER TABLE "StorefrontConfig" ALTER COLUMN "timezone" SET DEFAULT 'UTC';

-- 4. Backfill the existing single-org OrgSettings row.
--    countryCode from the org's tax profile home country (single-org install).
UPDATE "OrgSettings"
SET "countryCode" = (
  SELECT UPPER("homeCountryCode")
  FROM "OrganizationTaxProfile"
  WHERE "homeCountryCode" IS NOT NULL AND "homeCountryCode" <> ''
  ORDER BY "updatedAt" DESC
  LIMIT 1
)
WHERE "countryCode" IS NULL;

--    locale derived from the established baseCurrency signal (so an existing GBP
--    install reads en-GB, a USD install en-US, etc.).
UPDATE "OrgSettings"
SET "locale" = CASE "baseCurrency"
  WHEN 'GBP' THEN 'en-GB'
  WHEN 'EUR' THEN 'en-IE'
  WHEN 'AUD' THEN 'en-AU'
  WHEN 'CAD' THEN 'en-CA'
  WHEN 'NZD' THEN 'en-NZ'
  WHEN 'CHF' THEN 'de-CH'
  WHEN 'SEK' THEN 'sv-SE'
  WHEN 'NOK' THEN 'nb-NO'
  WHEN 'DKK' THEN 'da-DK'
  WHEN 'JPY' THEN 'ja-JP'
  WHEN 'INR' THEN 'en-IN'
  WHEN 'SGD' THEN 'en-SG'
  WHEN 'ZAR' THEN 'en-ZA'
  ELSE 'en-US'
END;
