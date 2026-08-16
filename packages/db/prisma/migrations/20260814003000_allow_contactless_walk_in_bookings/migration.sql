-- Walk-in parties may not have supplied contact information. Preserve every
-- existing value while allowing the canonical booking record to state that
-- truth instead of manufacturing a placeholder address.
ALTER TABLE "StorefrontBooking"
  ALTER COLUMN "customerEmail" DROP NOT NULL;
